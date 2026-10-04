import { Router } from 'express';
import { AppError, asyncHandler, serializeError } from '../errors.js';
import { requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { generateSdkKey, toStoredSdkKey } from '../lib/sdkKeys.js';
import { sdkKeyCacheKey } from '../lib/redisKeys.js';
import { createSdkKeySchema, envParamsSchema, sdkKeyParamsSchema } from '../projects/schemas.js';

/**
 * Environment and SDK key routes. Mounted inside the project scope, so
 * req.project and req.projectRole are already set.
 *
 * Roles: any member lists environments; editors and admins list SDK keys;
 * only admins create or revoke them.
 *
 * @param {{ env: any, projectStore: any, auditStore: any, cache: any, logger: any }} deps
 */
export function createEnvironmentsRouter({ env, projectStore, auditStore, cache, logger }) {
  const router = Router();

  router.get(
    '/',
    requireRole('viewer'),
    asyncHandler(async (req, res) => {
      const environments = await projectStore.listEnvironments(req.project.id);
      res.json({ environments });
    }),
  );

  router.get(
    '/:envKey/sdk-keys',
    requireRole('editor'),
    validate({ params: envParamsSchema }),
    asyncHandler(async (req, res) => {
      const sdkKeys = await projectStore.listSdkKeys({
        projectId: req.project.id,
        envKey: req.valid.params.envKey,
      });
      if (!sdkKeys) {
        throw new AppError(404, 'not_found', 'Not found.');
      }
      res.json({ sdkKeys });
    }),
  );

  router.post(
    '/:envKey/sdk-keys',
    requireRole('admin'),
    validate({ params: envParamsSchema, body: createSdkKeySchema }),
    asyncHandler(async (req, res) => {
      const { envKey } = req.valid.params;
      const { type } = req.valid.body;
      const material = generateSdkKey(type);
      const result = await projectStore.addSdkKey({
        projectId: req.project.id,
        envKey,
        key: toStoredSdkKey(material),
        maxKeys: env.MAX_SDK_KEYS_PER_ENV,
      });
      if (result.status === 'env_not_found') {
        throw new AppError(404, 'not_found', 'Not found.');
      }
      if (result.status === 'limit_reached') {
        throw new AppError(409, 'limit_reached', 'SDK key limit reached for this environment.');
      }
      await auditStore.record({
        projectId: req.project.id,
        actorId: req.user.id,
        action: 'sdk_key.create',
        envKey,
        after: { keyId: result.key.id, prefix: result.key.prefix, type: result.key.type },
      });
      // The full key is returned exactly once. Never cache this response.
      res.set('Cache-Control', 'no-store');
      res.status(201).json({ sdkKey: { ...result.key, key: material.raw } });
    }),
  );

  router.delete(
    '/:envKey/sdk-keys/:keyId',
    requireRole('admin'),
    validate({ params: sdkKeyParamsSchema }),
    asyncHandler(async (req, res) => {
      const { envKey, keyId } = req.valid.params;
      const result = await projectStore.revokeSdkKey({ projectId: req.project.id, envKey, keyId });
      if (result.status === 'not_found') {
        throw new AppError(404, 'not_found', 'Not found.');
      }
      if (!result.alreadyRevoked) {
        // Drop the cached key so revocation takes effect now instead of after the cache TTL.
        try {
          await cache.del(sdkKeyCacheKey(result.keyHash));
        } catch (err) {
          logger.warn({
            msg: 'sdk_key_cache_clear_failed',
            requestId: req.id,
            err: serializeError(err),
          });
        }
        await auditStore.record({
          projectId: req.project.id,
          actorId: req.user.id,
          action: 'sdk_key.revoke',
          envKey,
          before: { keyId, prefix: result.prefix, type: result.type },
        });
      }
      res.status(204).end();
    }),
  );

  return router;
}
