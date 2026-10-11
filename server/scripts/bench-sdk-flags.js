/**
 * Benchmark GET /sdk/v1/flags with autocannon.
 *
 * live (default): hits a server you already started, with its real MongoDB and Redis.
 *   Windows PowerShell:
 *     $env:BENCH_SDK_KEY = "<an SDK key>"; npm run bench -w @flagkit/server
 *   For numbers worth quoting, run the server against a LOCAL Redis and with the SDK rate
 *   limits raised (SDK_RATE_LIMIT_KEY_MAX / SDK_RATE_LIMIT_IP_MAX), otherwise the limiter
 *   or a remote Redis caps the result. Optional: BENCH_URL, BENCH_DURATION, BENCH_CONNECTIONS.
 *
 * inprocess: BENCH_MODE=inprocess. One process, in-memory stores and a fake Redis.
 *   This shows framework overhead only. It is NOT a deployment number.
 *
 * The SDK key is read from the environment only and is never printed or saved.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import autocannon from 'autocannon';

/**
 * Turn an autocannon result into one summary row and decide if it passed.
 * expect: 'full' means every response must be 200, 'not-modified' means every response must be 304.
 */
export function summarize(scenario, result, expect) {
  const total = result.requests.total;
  const ok2xx = result['2xx'] ?? 0;
  const notModified = result['3xx'] ?? 0;
  const wanted = expect === 'not-modified' ? notModified : ok2xx;
  const unexpected = total - wanted;
  const errors = result.errors ?? 0;
  const timeouts = result.timeouts ?? 0;
  return {
    scenario,
    requestsPerSecond: Math.round(result.requests.average),
    latencyMs: { p50: result.latency.p50, p97_5: result.latency.p97_5, p99: result.latency.p99 },
    total,
    ok2xx,
    notModified3xx: notModified,
    other: total - ok2xx - notModified,
    errors,
    timeouts,
    passed: total > 0 && unexpected === 0 && errors === 0 && timeouts === 0,
  };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function startInProcess() {
  // Loaded only in this mode, because the test helpers need dev dependencies.
  const { makeApp } = await import('../tests/helpers.js');
  const { generateSdkKey, toStoredSdkKey } = await import('../src/lib/sdkKeys.js');
  const { app, projectStore, cache } = makeApp({
    env: { SDK_RATE_LIMIT_KEY_MAX: '10000000', SDK_RATE_LIMIT_IP_MAX: '10000000' },
  });
  const material = generateSdkKey('server');
  const envId = '0'.repeat(23) + '1';
  projectStore.envs.push({
    id: envId,
    projectId: '0'.repeat(23) + '2',
    key: 'prod',
    sdkKeys: [{ id: '0'.repeat(23) + '3', ...toStoredSdkKey(material) }],
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
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    key: material.raw,
    stop: async () => {
      app.locals.hub.closeAll();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function main() {
  const mode = process.env.BENCH_MODE ?? 'live';
  const duration = Number(process.env.BENCH_DURATION ?? 15);
  const connections = Number(process.env.BENCH_CONNECTIONS ?? 50);
  if (!['live', 'inprocess'].includes(mode)) {
    fail('BENCH_MODE must be "live" or "inprocess".');
  }

  let target;
  if (mode === 'inprocess') {
    target = await startInProcess();
  } else {
    const key = process.env.BENCH_SDK_KEY;
    if (!key) {
      fail('Set BENCH_SDK_KEY to an SDK key for the environment you want to benchmark.');
    }
    target = { base: process.env.BENCH_URL ?? 'http://localhost:3000', key, stop: async () => {} };
  }
  const url = `${target.base}/sdk/v1/flags`;

  // One normal request first: proves the key works and gives us the ETag for the 304 scenario.
  const first = await fetch(url, { headers: { Authorization: target.key } }).catch((err) => {
    fail(`Could not reach ${target.base}: ${err.cause?.code ?? err.message}`);
  });
  if (first.status !== 200) {
    await target.stop();
    fail(`The first request returned ${first.status}, expected 200. Check the server, the URL, and the key.`);
  }
  const etag = first.headers.get('etag');
  await first.arrayBuffer();

  const scenarios = [
    { name: 'full response (200)', headers: { Authorization: target.key }, expect: 'full' },
    {
      name: 'conditional request (304)',
      headers: { Authorization: target.key, 'If-None-Match': etag },
      expect: 'not-modified',
    },
  ];

  const rows = [];
  for (const scenario of scenarios) {
    console.log(`Running: ${scenario.name} (${connections} connections, ${duration}s)...`);
    const result = await autocannon({ url, headers: scenario.headers, connections, duration, pipelining: 1 });
    rows.push(summarize(scenario.name, result, scenario.expect));
  }
  await target.stop();

  console.log(`\nMode: ${mode}${mode === 'inprocess' ? ' (fake stores, NOT a deployment number)' : ''}`);
  console.table(
    rows.map((r) => ({
      scenario: r.scenario,
      'req/s': r.requestsPerSecond,
      'p50 ms': r.latencyMs.p50,
      'p97.5 ms': r.latencyMs.p97_5,
      'p99 ms': r.latencyMs.p99,
      total: r.total,
      '2xx': r.ok2xx,
      '304': r.notModified3xx,
      other: r.other,
      errors: r.errors + r.timeouts,
      result: r.passed ? 'PASS' : 'FAIL',
    })),
  );

  const dir = new URL('../benchmarks/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    new URL('last-run.json', dir),
    JSON.stringify({ mode, connections, durationSeconds: duration, ranAt: new Date().toISOString(), rows }, null, 2),
  );

  if (rows.some((r) => !r.passed)) {
    console.error(
      '\nSome requests were not the expected status or errored. Rate limits and a remote Redis cap throughput:' +
        ' benchmark against a local Redis with the SDK rate limits raised.',
    );
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
