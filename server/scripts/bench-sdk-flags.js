/**
 * Benchmark GET /sdk/v1/flags against an in-process server with memory stores.
 * This measures the hot path (auth cache + cached ruleset) without needing
 * MongoDB or Redis running locally.
 *
 * Usage: npm run bench -w @flagkit/server
 * Optional: BENCH_DURATION=10 BENCH_CONNECTIONS=50
 */
import autocannon from 'autocannon';
import { generateSdkKey, toStoredSdkKey } from '../src/lib/sdkKeys.js';
import { makeApp } from '../tests/helpers.js';

const duration = Number(process.env.BENCH_DURATION ?? 5);
const connections = Number(process.env.BENCH_CONNECTIONS ?? 50);

const { app, projectStore, cache } = makeApp();
const material = generateSdkKey('server');
const envId = 'bench-env-000000000001';
projectStore.envs.push({
  id: envId,
  projectId: 'bench-project-00000000001',
  key: 'prod',
  sdkKeys: [{ id: 'k1', ...toStoredSdkKey(material) }],
});
await cache.set(
  `ruleset:${envId}`,
  JSON.stringify({
    version: 1,
    flags: [
      {
        key: 'checkout',
        variations: [
          { key: 'on', value: true },
          { key: 'off', value: false },
        ],
        isExperiment: false,
        goalMetricKey: null,
        enabled: true,
        offVariation: 'off',
        fallthrough: { variation: 'on' },
        rules: [],
        salt: 'prod',
        version: 1,
      },
    ],
  }),
  'EX',
  3600,
);

const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const { port } = server.address();

const result = await autocannon({
  url: `http://127.0.0.1:${port}/sdk/v1/flags`,
  headers: { Authorization: material.raw },
  connections,
  duration,
  pipelining: 1,
});

console.log(autocannon.printResult(result));

app.locals.hub.closeAll();
await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
