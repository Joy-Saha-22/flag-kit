import { randomUUID } from 'node:crypto';
import { loadSeedEnv } from '../env.js';
import { connectMongo, disconnectMongo } from '../db/mongoose.js';
import { generateSdkKey, toStoredSdkKey } from '../lib/sdkKeys.js';
import { hashPassword } from '../lib/passwords.js';
import { User } from '../models/User.js';
import { Project } from '../models/Project.js';
import { Environment } from '../models/Environment.js';
import { Flag } from '../models/Flag.js';
import { Event } from '../models/Event.js';
import { AuditLog } from '../models/AuditLog.js';

const PROJECT_KEY = 'acme';
const ENVIRONMENTS = [
  { key: 'development', name: 'Development' },
  { key: 'staging', name: 'Staging' },
  { key: 'production', name: 'Production' },
];

/**
 * @param {{ enabled: boolean, offVariation?: string, variation?: string, rollout?: { variation: string, weight: number }[], rules?: object[] }} opts
 */
function envConfig(opts) {
  const fallthrough = opts.rollout
    ? { rollout: opts.rollout }
    : { variation: opts.variation ?? opts.offVariation ?? 'off' };

  return {
    enabled: opts.enabled,
    offVariation: opts.offVariation ?? 'off',
    fallthrough,
    rules: opts.rules ?? [],
    version: 1,
  };
}

function forAllEnvs(factory) {
  /** @type {Record<string, object>} */
  const environments = {};
  for (const env of ENVIRONMENTS) {
    environments[env.key] = factory(env.key);
  }
  return environments;
}

async function resetProject(projectId) {
  await Promise.all([
    Flag.deleteMany({ projectId }),
    Environment.deleteMany({ projectId }),
    Event.deleteMany({ projectId }),
    AuditLog.deleteMany({ projectId }),
    Project.deleteOne({ _id: projectId }),
  ]);
}

async function seed() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Seed refused: NODE_ENV is production');
    process.exit(1);
  }

  const env = loadSeedEnv();
  await connectMongo(env.MONGODB_URI);

  const existingProject = await Project.findOne({ key: PROJECT_KEY });
  if (existingProject) {
    await resetProject(existingProject._id);
  }

  const passwordHash = await hashPassword(env.SEED_USER_PASSWORD);
  const user = await User.findOneAndUpdate(
    { email: env.SEED_USER_EMAIL.toLowerCase() },
    { email: env.SEED_USER_EMAIL.toLowerCase(), passwordHash, name: env.SEED_USER_NAME },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const project = await Project.create({
    name: 'Acme',
    key: PROJECT_KEY,
    members: [{ userId: user._id, role: 'admin' }],
  });

  /** @type {{ envKey: string, type: string, prefix: string, raw: string }[]} */
  const issuedKeys = [];

  for (const spec of ENVIRONMENTS) {
    const serverKey = generateSdkKey('server');
    const clientKey = generateSdkKey('client');
    await Environment.create({
      projectId: project._id,
      key: spec.key,
      name: spec.name,
      sdkKeys: [toStoredSdkKey(serverKey), toStoredSdkKey(clientKey)],
    });
    issuedKeys.push(
      { envKey: spec.key, type: 'server', prefix: serverKey.prefix, raw: serverKey.raw },
      { envKey: spec.key, type: 'client', prefix: clientKey.prefix, raw: clientKey.raw },
    );
  }

  const acmeEmailRule = {
    id: randomUUID(),
    conditions: [{ attribute: 'email', operator: 'contains', values: ['@acme.com'] }],
    serve: { variation: 'on' },
  };

  const enterpriseUploadRule = {
    id: randomUUID(),
    conditions: [{ attribute: 'plan', operator: 'equals', values: ['enterprise'] }],
    serve: { variation: '50mb' },
  };

  await Flag.insertMany([
    {
      projectId: project._id,
      key: 'dark-mode',
      name: 'Dark mode',
      description: 'Global dark theme',
      tags: ['ui'],
      variations: [
        { key: 'off', name: 'Off', value: false },
        { key: 'on', name: 'On', value: true },
      ],
      isExperiment: false,
      goalMetricKey: null,
      environments: forAllEnvs(() => envConfig({ enabled: true, offVariation: 'off', variation: 'on' })),
    },
    {
      projectId: project._id,
      key: 'new-checkout',
      name: 'New checkout',
      description: 'Acme emails get the redesigned checkout; everyone else stays on the old flow',
      tags: ['checkout', 'ui'],
      variations: [
        { key: 'off', name: 'Legacy', value: false },
        { key: 'on', name: 'Redesign', value: true },
      ],
      isExperiment: false,
      goalMetricKey: null,
      environments: forAllEnvs((envKey) =>
        envConfig({
          enabled: envKey !== 'production',
          offVariation: 'off',
          variation: 'off',
          rules: [acmeEmailRule],
        }),
      ),
    },
    {
      projectId: project._id,
      key: 'homepage-hero',
      name: 'Homepage hero',
      description: 'A/B/C experiment on the marketing hero. Goal: signup_completed',
      tags: ['experiment', 'growth'],
      variations: [
        { key: 'control', name: 'Original', value: 'original' },
        { key: 'variant-a', name: 'Social proof', value: 'social-proof' },
        { key: 'variant-b', name: 'Short copy', value: 'short-copy' },
      ],
      isExperiment: true,
      goalMetricKey: 'signup_completed',
      environments: forAllEnvs(() =>
        envConfig({
          enabled: true,
          offVariation: 'control',
          rollout: [
            { variation: 'control', weight: 33334 },
            { variation: 'variant-a', weight: 33333 },
            { variation: 'variant-b', weight: 33333 },
          ],
        }),
      ),
    },
    {
      projectId: project._id,
      key: 'search-algorithm',
      name: 'Search algorithm',
      description: '50/50 percentage rollout of the v2 ranker',
      tags: ['search'],
      variations: [
        { key: 'v1', name: 'Legacy ranker', value: 'v1' },
        { key: 'v2', name: 'Neural ranker', value: 'v2' },
      ],
      isExperiment: false,
      goalMetricKey: null,
      environments: forAllEnvs((envKey) =>
        envConfig({
          enabled: true,
          offVariation: 'v1',
          rollout:
            envKey === 'production'
              ? [
                  { variation: 'v1', weight: 90000 },
                  { variation: 'v2', weight: 10000 },
                ]
              : [
                  { variation: 'v1', weight: 50000 },
                  { variation: 'v2', weight: 50000 },
                ],
        }),
      ),
    },
    {
      projectId: project._id,
      key: 'max-upload-mb',
      name: 'Max upload size',
      description: 'Multivariate upload cap; enterprise plan gets 50MB',
      tags: ['limits'],
      variations: [
        { key: '10mb', name: '10 MB', value: 10 },
        { key: '25mb', name: '25 MB', value: 25 },
        { key: '50mb', name: '50 MB', value: 50 },
      ],
      isExperiment: false,
      goalMetricKey: null,
      environments: forAllEnvs(() =>
        envConfig({
          enabled: true,
          offVariation: '10mb',
          variation: '10mb',
          rules: [enterpriseUploadRule],
        }),
      ),
    },
  ]);

  await AuditLog.create({
    projectId: project._id,
    actorId: user._id,
    action: 'seed.bootstrap',
    flagKey: null,
    envKey: null,
    before: null,
    after: { projectKey: PROJECT_KEY, flagCount: 5 },
    ts: new Date(),
  });

  console.log('Seed complete');
  console.log(`User: ${user.email}`);
  console.log(`Project: ${project.key}`);
  console.log('SDK keys (plaintext shown once; only hashes are stored):');
  for (const key of issuedKeys) {
    console.log(`  ${key.envKey} ${key.type} prefix=${key.prefix} key=${key.raw}`);
  }

  await disconnectMongo();
}

seed().catch(async (error) => {
  const message = error instanceof Error ? error.message : 'unknown error';
  console.error(`Seed failed: ${message}`);
  try {
    await disconnectMongo();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
