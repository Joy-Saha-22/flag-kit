import { Router } from 'express';
import { z } from 'zod';
import { evaluate } from '@flagkit/evaluator';
import { AppError, asyncHandler, serializeError } from '../errors.js';
import { requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { defaultEnvConfig, normalizeEnvConfig, serializeFlag, summarizeFlag } from '../flags/ruleset.js';
import { computeResults } from '../flags/results.js';
import { checkEnvConfig, referencedVariations } from '../flags/validation.js';
import { SLUG } from '../projects/schemas.js';

const resultsQuery = z.object({ env: z.string().regex(SLUG, 'Invalid environment key.') }).strict();

const notFound = () => new AppError(404, 'not_found', 'Not found.');
const invalid = (issues) =>
  new AppError(400, 'validation_failed', 'Request validation failed.', issues.map((issue) => ({ in: 'body', ...issue })));

/**
 * Flag routes, mounted inside the project scope (req.project and req.projectRole are set).
 * Viewers read, editors create and change flags, admins delete them.
 *
 * @param {{ env: any, projectStore: any, flagStore: any, eventStore?: any, auditStore: any, sync: Function, schemas: any, logger: any }} deps
 */
export function createFlagsRouter({ env, projectStore, flagStore, eventStore, auditStore, sync, schemas, logger }) {
  const router = Router();

  const findEnvironments = (projectId) => projectStore.listEnvironments(projectId);

  /** Rebuild and publish every environment. Returns 'ok' only if all succeeded. */
  async function syncAll(req, environments, flagKey) {
    const results = await Promise.all(
      environments.map((environment) =>
        sync({ projectId: req.project.id, env: environment, flagKey, requestId: req.id }),
      ),
    );
    return results.every((result) => result === 'ok') ? 'ok' : 'delayed';
  }

  router.get(
    '/',
    requireRole('viewer'),
    validate({ query: schemas.listQuery }),
    asyncHandler(async (req, res) => {
      const docs = await flagStore.list({ projectId: req.project.id, ...req.valid.query });
      res.json({ flags: docs.map(summarizeFlag) });
    }),
  );

  router.post(
    '/',
    requireRole('editor'),
    validate({ body: schemas.createFlag }),
    asyncHandler(async (req, res) => {
      const body = req.valid.body;
      const variationKeys = new Set(body.variations.map((v) => v.key));
      const offVariation = body.offVariation ?? body.variations.at(-1).key;
      const defaultVariation = body.defaultVariation ?? body.variations[0].key;
      const issues = [];
      if (!variationKeys.has(offVariation)) {
        issues.push({ path: 'offVariation', message: `Unknown variation "${offVariation}".` });
      }
      if (!variationKeys.has(defaultVariation)) {
        issues.push({ path: 'defaultVariation', message: `Unknown variation "${defaultVariation}".` });
      }
      if (issues.length > 0) {
        throw invalid(issues);
      }

      if ((await flagStore.count({ projectId: req.project.id })) >= env.MAX_FLAGS_PER_PROJECT) {
        throw new AppError(403, 'limit_reached', 'Flag limit reached for this project.');
      }

      const environments = await findEnvironments(req.project.id);
      const config = defaultEnvConfig({ offVariation, defaultVariation });
      const doc = await flagStore.create({
        projectId: req.project.id,
        flag: {
          key: body.key,
          name: body.name,
          description: body.description,
          tags: body.tags,
          variations: body.variations,
          isExperiment: body.isExperiment,
          goalMetricKey: body.goalMetricKey,
          environments: Object.fromEntries(environments.map((e) => [e.key, structuredClone(config)])),
        },
      });
      const flag = serializeFlag(doc);
      await auditStore.record({
        projectId: req.project.id,
        actorId: req.user.id,
        action: 'flag.create',
        flagKey: flag.key,
        after: { name: flag.name, variations: flag.variations.map((v) => v.key), isExperiment: flag.isExperiment },
      });
      const syncStatus = await syncAll(req, environments, flag.key);
      res.status(201).json({ flag, sync: syncStatus });
    }),
  );

  router.get(
    '/:key',
    requireRole('viewer'),
    validate({ params: schemas.flagParams }),
    asyncHandler(async (req, res) => {
      const doc = await flagStore.get({ projectId: req.project.id, key: req.valid.params.key });
      if (!doc) {
        throw notFound();
      }
      res.json({ flag: serializeFlag(doc) });
    }),
  );

  router.get(
    '/:key/results',
    requireRole('viewer'),
    validate({ params: schemas.flagParams, query: resultsQuery }),
    asyncHandler(async (req, res) => {
      const { key } = req.valid.params;
      const { env: envKey } = req.valid.query;
      const environments = await findEnvironments(req.project.id);
      const flag = await flagStore.get({ projectId: req.project.id, key });
      if (!flag || !environments.some((e) => e.key === envKey)) {
        throw notFound();
      }
      if (flag.isExperiment !== true) {
        throw new AppError(400, 'not_an_experiment', 'This flag is not an experiment.');
      }
      const counts = await eventStore.variationCounts({
        projectId: req.project.id,
        envKey,
        flagKey: key,
        goalMetricKey: flag.goalMetricKey,
      });
      // The first variation is the control.
      res.json(
        computeResults({
          flagKey: key,
          envKey,
          goalMetricKey: flag.goalMetricKey,
          variations: flag.variations.map((v) => v.key),
          counts,
        }),
      );
    }),
  );

  router.put(
    '/:key',
    requireRole('editor'),
    validate({ params: schemas.flagParams, body: schemas.updateFlag }),
    asyncHandler(async (req, res) => {
      const { key } = req.valid.params;
      const patch = req.valid.body;
      const current = await flagStore.get({ projectId: req.project.id, key });
      if (!current) {
        throw notFound();
      }

      const isExperiment = patch.isExperiment ?? current.isExperiment === true;
      const goalMetricKey = patch.goalMetricKey !== undefined ? patch.goalMetricKey : (current.goalMetricKey ?? null);
      const issues = [];
      if (isExperiment && !goalMetricKey) {
        issues.push({ path: 'goalMetricKey', message: 'An experiment needs a goal metric key.' });
      }
      if (!isExperiment && goalMetricKey) {
        issues.push({ path: 'goalMetricKey', message: 'Only experiments have a goal metric key.' });
      }
      if (patch.variations) {
        // Removing a variation that an environment still points at would break evaluation.
        const keep = new Set(patch.variations.map((v) => v.key));
        const stillUsed = new Set();
        for (const config of Object.values(current.environments ?? {})) {
          for (const used of referencedVariations(config)) {
            if (!keep.has(used)) {
              stillUsed.add(used);
            }
          }
        }
        if (stillUsed.size > 0) {
          throw new AppError(409, 'variation_in_use', 'A removed variation is still used by an environment.', [
            { in: 'body', path: 'variations', message: `Still in use: ${[...stillUsed].join(', ')}.` },
          ]);
        }
      }
      if (issues.length > 0) {
        throw invalid(issues);
      }

      const stored = { ...patch, isExperiment, goalMetricKey };
      const updated = await flagStore.update({ projectId: req.project.id, key, patch: stored });
      if (!updated) {
        throw notFound();
      }

      const before = {};
      const after = {};
      for (const field of Object.keys(patch)) {
        before[field] = current[field] ?? null;
        after[field] = updated[field] ?? null;
      }
      await auditStore.record({
        projectId: req.project.id,
        actorId: req.user.id,
        action: 'flag.update',
        flagKey: key,
        before,
        after,
      });

      // SDKs only see variations and experiment settings, so only those need a republish.
      const affectsSdks = ['variations', 'isExperiment', 'goalMetricKey'].some((field) => field in patch);
      const syncStatus = affectsSdks ? await syncAll(req, await findEnvironments(req.project.id), key) : 'ok';
      res.json({ flag: serializeFlag(updated), sync: syncStatus });
    }),
  );

  router.delete(
    '/:key',
    requireRole('admin'),
    validate({ params: schemas.flagParams }),
    asyncHandler(async (req, res) => {
      const { key } = req.valid.params;
      const removed = await flagStore.delete({ projectId: req.project.id, key });
      if (!removed) {
        throw notFound();
      }
      const flag = serializeFlag(removed);
      await auditStore.record({
        projectId: req.project.id,
        actorId: req.user.id,
        action: 'flag.delete',
        flagKey: key,
        before: { name: flag.name, variations: flag.variations.map((v) => v.key), environments: flag.environments },
      });
      const syncStatus = await syncAll(req, await findEnvironments(req.project.id), key);
      res.json({ deleted: true, sync: syncStatus });
    }),
  );

  router.put(
    '/:key/environments/:envKey',
    requireRole('editor'),
    validate({ params: schemas.flagEnvParams, body: schemas.envConfig }),
    asyncHandler(async (req, res) => {
      const { key, envKey } = req.valid.params;
      const { expectedVersion, ...input } = req.valid.body;

      const environments = await findEnvironments(req.project.id);
      const environment = environments.find((e) => e.key === envKey);
      const flag = await flagStore.get({ projectId: req.project.id, key });
      if (!environment || !flag) {
        throw notFound();
      }

      const issues = checkEnvConfig(input, new Set(flag.variations.map((v) => v.key)));
      if (issues.length > 0) {
        throw invalid(issues);
      }

      const existing = flag.environments?.[envKey];
      if (expectedVersion !== undefined && expectedVersion !== (existing?.version ?? 0)) {
        throw new AppError(409, 'version_conflict', 'This flag was changed by someone else. Reload and try again.');
      }

      const { version: ignored, ...config } = normalizeEnvConfig(input);
      const result = await flagStore.setEnvironmentConfig({
        projectId: req.project.id,
        key,
        envKey,
        config,
        currentVersion: existing?.version,
      });
      if (result.status === 'not_found') {
        throw notFound();
      }
      if (result.status === 'version_conflict') {
        throw new AppError(409, 'version_conflict', 'This flag was changed by someone else. Reload and try again.');
      }

      await auditStore.record({
        projectId: req.project.id,
        actorId: req.user.id,
        action: 'flag.env_update',
        flagKey: key,
        envKey,
        before: existing ? normalizeEnvConfig(existing) : null,
        after: normalizeEnvConfig(result.config),
      });
      const syncStatus = await sync({
        projectId: req.project.id,
        env: environment,
        flagKey: key,
        requestId: req.id,
      });
      const updated = { ...flag, environments: { ...flag.environments, [envKey]: result.config } };
      res.json({ flag: serializeFlag(updated), sync: syncStatus });
    }),
  );

  router.post(
    '/:key/environments/:envKey/evaluate-test',
    requireRole('viewer'),
    validate({ params: schemas.flagEnvParams, body: schemas.evaluateTest }),
    asyncHandler(async (req, res) => {
      const { key, envKey } = req.valid.params;
      const { userContext } = req.valid.body;
      const flag = await flagStore.get({ projectId: req.project.id, key });
      const config = flag?.environments?.[envKey];
      if (!flag || !config) {
        throw notFound();
      }

      let result;
      try {
        // The environment key is the rollout salt, exactly as in the ruleset SDKs receive.
        result = evaluate({ key: flag.key }, { ...normalizeEnvConfig(config), salt: envKey }, userContext);
      } catch (err) {
        logger.error({ msg: 'evaluate_test_failed', requestId: req.id, err: serializeError(err) });
        result = { variation: null, reason: { kind: 'error', errorKind: 'evaluation_failed' } };
      }
      const match = flag.variations.find((v) => v.key === result.variation);
      // Error reasons are an answer, not a failure: they come back as a normal 200.
      res.json({ variation: result.variation, value: match ? match.value : null, reason: result.reason });
    }),
  );

  return router;
}

