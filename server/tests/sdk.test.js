import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { H, makeApp, signUp } from './helpers.js';
import { sha256Hex } from '../src/lib/sdkKeys.js';

const variations = [
  { key: 'on', name: 'On', value: true },
  { key: 'off', name: 'Off', value: false },
];
const experiment = { key: 'checkout', name: 'Checkout', variations, isExperiment: true, goalMetricKey: 'signup_completed' };
const plain = { key: 'plain', name: 'Plain', variations };
const prodConfig = {
  enabled: true,
  offVariation: 'off',
  fallthrough: { rollout: [{ variation: 'on', weight: 30000 }, { variation: 'off', weight: 70000 }] },
  rules: [],
};

const keysPath = (pid, envKey) => `/api/projects/${pid}/environments/${envKey}/sdk-keys`;

/** A project with an experiment flag and a plain flag, both configured, and a client key for prod. */
async function setup(options) {
  const ctx = makeApp(options);
  const owner = await signUp(ctx.app, 'owner@example.com');
  const created = await owner.agent.post('/api/projects').set(H).send({ name: 'Acme', key: 'acme' });
  const pid = created.body.project.id;
  const envIds = Object.fromEntries(created.body.environments.map((e) => [e.key, e.id]));
  for (const flag of [experiment, plain]) {
    await owner.agent.post(`/api/projects/${pid}/flags`).set(H).send(flag);
    await owner.agent
      .put(`/api/projects/${pid}/flags/${flag.key}/environments/prod`)
      .set(H)
      .send(prodConfig);
  }
  const makeKey = async (type, envKey = 'prod') => {
    const res = await owner.agent.post(keysPath(pid, envKey)).set(H).send({ type });
    return { id: res.body.sdkKey.id, key: res.body.sdkKey.key };
  };
  const client = await makeKey('client');
  return { ...ctx, owner, pid, envIds, makeKey, client };
}

const sdkGet = (app, path, key) => {
  const req = request(app).get(path);
  return key ? req.set('Authorization', key) : req;
};

describe('SDK authentication', () => {
  it('answers every bad key with the same 401', async () => {
    const ctx = await setup();
    const revoked = await ctx.makeKey('server');
    await ctx.owner.agent.delete(`${keysPath(ctx.pid, 'prod')}/${revoked.id}`).set(H);

    const attempts = [
      undefined,
      '',
      'not-a-key',
      `fk_client_${'x'.repeat(10)}`,
      `fk_client_${'A'.repeat(43)}`, // well-formed but unknown
      revoked.key,
      `${ctx.client.key}x`,
    ];
    const bodies = [];
    for (const key of attempts) {
      const res = await sdkGet(ctx.app, '/sdk/v1/flags', key);
      expect(res.status).toBe(401);
      bodies.push(res.body.error.message);
    }
    expect(new Set(bodies).size).toBe(1);
    expect((await request(ctx.app).get(`/sdk/v1/flags?key=${ctx.client.key}`)).status).toBe(401);
  });

  it('caches active keys, revokes immediately, and keeps working when Redis is down', async () => {
    const ctx = await setup();
    const first = await sdkGet(ctx.app, '/sdk/v1/flags', ctx.client.key);
    expect(first.status).toBe(200);
    const lookupsAfterFirst = ctx.sdkStore.lookups;
    expect(ctx.cache.store.has(`sdkkey:${sha256Hex(ctx.client.key)}`)).toBe(true);
    expect(ctx.cache.ttls.get(`sdkkey:${sha256Hex(ctx.client.key)}`)).toBe(60);

    expect((await sdkGet(ctx.app, '/sdk/v1/flags', ctx.client.key)).status).toBe(200);
    expect(ctx.sdkStore.lookups).toBe(lookupsAfterFirst);

    ctx.cache.failing = true;
    const degraded = await sdkGet(ctx.app, '/sdk/v1/flags', ctx.client.key);
    expect(degraded.status).toBe(200);
    expect(degraded.body.flags.length).toBe(2);
    expect(JSON.stringify(ctx.logs)).not.toContain('user:secret');
    ctx.cache.failing = false;

    await ctx.owner.agent.delete(`${keysPath(ctx.pid, 'prod')}/${ctx.client.id}`).set(H);
    expect((await sdkGet(ctx.app, '/sdk/v1/flags', ctx.client.key)).status).toBe(401);
  });
});

describe('GET /sdk/v1/flags', () => {
  it('serves the ruleset with an ETag, answers 304, and changes the ETag when flags change', async () => {
    const ctx = await setup();
    const res = await sdkGet(ctx.app, '/sdk/v1/flags', ctx.client.key);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['cache-control']).toBe('private, no-cache');
    expect(res.body.flags.map((f) => f.key)).toEqual(['checkout', 'plain']);
    expect(res.body.flags[0].salt).toBe('prod');
    expect(res.body.flags[0].isExperiment).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('keyHash');

    const etag = res.headers.etag;
    expect(etag).toMatch(/^"[a-f0-9]{20}"$/);
    const same = await sdkGet(ctx.app, '/sdk/v1/flags', ctx.client.key).set('If-None-Match', etag);
    expect(same.status).toBe(304);
    const weak = await sdkGet(ctx.app, '/sdk/v1/flags', ctx.client.key).set('If-None-Match', `W/${etag}`);
    expect(weak.status).toBe(304);

    await ctx.owner.agent
      .put(`/api/projects/${ctx.pid}/flags/plain/environments/prod`)
      .set(H)
      .send({ ...prodConfig, enabled: false });
    const changed = await sdkGet(ctx.app, '/sdk/v1/flags', ctx.client.key).set('If-None-Match', etag);
    expect(changed.status).toBe(200);
    expect(changed.headers.etag).not.toBe(etag);
  });

  it('only shows the key\u2019s own environment, and accepts server keys and a Bearer prefix', async () => {
    const ctx = await setup();
    const devKey = await ctx.makeKey('server', 'dev');
    const dev = await sdkGet(ctx.app, '/sdk/v1/flags', devKey.key);
    expect(dev.status).toBe(200);
    expect(dev.body.flags.every((f) => f.salt === 'dev')).toBe(true);
    expect(dev.body.flags.every((f) => f.enabled === false)).toBe(true);

    const bearer = await request(ctx.app).get('/sdk/v1/flags').set('Authorization', `Bearer ${ctx.client.key}`);
    expect(bearer.status).toBe(200);
    expect(bearer.body.flags.every((f) => f.salt === 'prod')).toBe(true);
  });

  it('rebuilds a missing ruleset from the database and caches it again', async () => {
    const ctx = await setup();
    const rulesetKey = `ruleset:${ctx.envIds.prod}`;
    const before = JSON.parse(ctx.cache.store.get(rulesetKey));
    ctx.cache.store.delete(rulesetKey);

    const res = await sdkGet(ctx.app, '/sdk/v1/flags', ctx.client.key);
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(before.version);
    expect(res.body.flags.map((f) => f.key)).toEqual(['checkout', 'plain']);
    expect(ctx.cache.store.has(rulesetKey)).toBe(true);
  });
});

describe('POST /sdk/v1/events', () => {
  const post = (ctx, body, key = ctx.client.key) => {
    const req = request(ctx.app).post('/sdk/v1/events');
    return (key ? req.set('Authorization', key) : req).send(body);
  };

  it('stores exposures and conversions for experiments', async () => {
    const ctx = await setup();
    const res = await post(ctx, {
      events: [
        { type: 'exposure', flagKey: 'checkout', variation: 'on', userKey: 'u1' },
        { type: 'conversion', flagKey: 'checkout', variation: 'on', userKey: 'u1', metricKey: 'signup_completed', ts: new Date().toISOString() },
      ],
    });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: 2, dropped: 0 });
    expect(ctx.sdkStore.events.length).toBe(2);
    const [exposure, conversion] = ctx.sdkStore.events;
    expect(exposure).toMatchObject({ envKey: 'prod', type: 'exposure', flagKey: 'checkout', variation: 'on', userKey: 'u1', metricKey: null });
    expect(exposure.projectId).toBe(ctx.pid);
    expect(exposure.ts instanceof Date).toBe(true);
    expect(conversion.metricKey).toBe('signup_completed');
  });

  it('drops events that are not for an experiment, or do not match it', async () => {
    const ctx = await setup();
    const res = await post(ctx, {
      events: [
        { type: 'exposure', flagKey: 'plain', variation: 'on', userKey: 'u1' },
        { type: 'exposure', flagKey: 'missing', variation: 'on', userKey: 'u1' },
        { type: 'exposure', flagKey: 'checkout', variation: 'maybe', userKey: 'u1' },
        { type: 'conversion', flagKey: 'checkout', variation: 'on', userKey: 'u1', metricKey: 'other_metric' },
        { type: 'exposure', flagKey: 'checkout', variation: 'off', userKey: 'u2' },
      ],
    });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: 1, dropped: 4 });
    expect(ctx.sdkStore.events.map((e) => e.userKey)).toEqual(['u2']);
  });

  it('rejects malformed batches and requires a key', async () => {
    const ctx = await setup({ env: { MAX_EVENTS_PER_BATCH: '3' } });
    const ok = { type: 'exposure', flagKey: 'checkout', variation: 'on', userKey: 'u1' };
    const day = 24 * 60 * 60 * 1000;
    const bad = [
      {},
      { events: [] },
      [ok],
      { events: [ok, ok, ok, ok] },
      { events: [{ ...ok, extra: 1 }] },
      { events: [{ ...ok, type: 'click' }] },
      { events: [{ ...ok, metricKey: 'signup_completed' }] },
      { events: [{ type: 'conversion', flagKey: 'checkout', variation: 'on', userKey: 'u1' }] },
      { events: [{ ...ok, userKey: 'x'.repeat(201) }] },
      { events: [{ ...ok, userKey: { $ne: null } }] },
      { events: [{ ...ok, ts: new Date(Date.now() + day).toISOString() }] },
      { events: [{ ...ok, ts: new Date(Date.now() - 60 * day).toISOString() }] },
      { events: [{ ...ok, ts: 'yesterday' }] },
    ];
    for (const body of bad) {
      const res = await post(ctx, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_failed');
    }
    expect(ctx.sdkStore.events.length).toBe(0);
    expect((await post(ctx, { events: [ok] }, null)).status).toBe(401);
    expect((await post(ctx, { events: [ok] }, `fk_client_${'B'.repeat(43)}`)).status).toBe(401);
  });
});

describe('CORS', () => {
  it('lets any origin call the SDK API, while the dashboard API stays restricted', async () => {
    const ctx = await setup();
    const sdk = await request(ctx.app)
      .options('/sdk/v1/flags')
      .set('Origin', 'https://customer-site.example')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization');
    expect(sdk.headers['access-control-allow-origin']).toBe('*');
    expect(sdk.headers['access-control-allow-credentials']).toBe(undefined);
    expect(sdk.headers['access-control-allow-headers']).toContain('Authorization');

    const dashboard = await request(ctx.app)
      .options('/api/auth/login')
      .set('Origin', 'https://customer-site.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(dashboard.headers['access-control-allow-origin']).toBe(undefined);
  });
});

// ---------- streaming: needs a real HTTP server, so these use fetch ----------

async function listen(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const stop = async () => {
    app.locals.hub.closeAll();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  };
  return { url: `http://127.0.0.1:${server.address().port}`, stop };
}

function sseReader(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const read = (ms) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for stream data')), ms);
      reader.read().then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });

  /** Next frame as { event, data, comment }, or null once the stream has ended. */
  async function nextFrame(ms = 3000) {
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end !== -1) {
        const raw = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const lines = raw.split('\n');
        const dataLine = lines.find((l) => l.startsWith('data: '));
        return {
          event: lines.find((l) => l.startsWith('event: '))?.slice(7) ?? null,
          data: dataLine ? JSON.parse(dataLine.slice(6)) : null,
          comment: lines.find((l) => l.startsWith(':')) ?? null,
        };
      }
      const { done, value } = await read(ms);
      if (done) {
        return null;
      }
      buffer += decoder.decode(value, { stream: true });
    }
  }

  async function nextEvent(name, ms = 3000) {
    for (;;) {
      const frame = await nextFrame(ms);
      if (frame === null || frame.event === name) {
        return frame;
      }
    }
  }

  return { nextFrame, nextEvent, cancel: () => reader.cancel().catch(() => {}) };
}

async function openStream(url, key, signal) {
  return fetch(`${url}/sdk/v1/stream`, { headers: { Authorization: key }, signal });
}

const waitFor = async (condition, ms = 2000) => {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('condition not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe('GET /sdk/v1/stream', () => {
  it('sends the ruleset first, then every change as a patch', async () => {
    const ctx = await setup();
    const { url, stop } = await listen(ctx.app);
    const abort = new AbortController();
    try {
      const response = await openStream(url, ctx.client.key, abort.signal);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      const stream = sseReader(response);

      const put = await stream.nextEvent('put');
      expect(put.data.flags.map((f) => f.key)).toEqual(['checkout', 'plain']);
      const baseVersion = put.data.version;
      expect(ctx.subscriber.subscribed.has(`flag-updates:${ctx.envIds.prod}`)).toBe(true);

      // A real change: the route saves it, publishes it, and the hub delivers it.
      ctx.subscriber.publish(`flag-updates:${ctx.envIds.prod}`, null); // ignored: not an object message
      const change = await ctx.owner.agent
        .put(`/api/projects/${ctx.pid}/flags/plain/environments/prod`)
        .set(H)
        .send({ ...prodConfig, enabled: false });
      expect(change.status).toBe(200);
      const published = ctx.publisher.messages.at(-1);
      ctx.subscriber.publish(published.channel, published.message);

      const patch = await stream.nextEvent('patch');
      expect(patch.data.flagKey).toBe('plain');
      expect(patch.data.flag.enabled).toBe(false);
      expect(patch.data.version).toBeGreaterThan(baseVersion);

      // Other environments' changes are not delivered here.
      ctx.subscriber.publish(`flag-updates:${ctx.envIds.dev}`, { version: 99, flagKey: 'plain', flag: null });
      ctx.subscriber.publish(published.channel, { ...published.message, flagKey: 'checkout', version: patch.data.version + 1 });
      const next = await stream.nextEvent('patch');
      expect(next.data.flagKey).toBe('checkout');
      await stream.cancel();
    } finally {
      abort.abort();
      await stop();
    }
  });

  it('unsubscribes and frees the slot when the client disconnects', async () => {
    const ctx = await setup();
    const { url, stop } = await listen(ctx.app);
    const abort = new AbortController();
    try {
      const response = await openStream(url, ctx.client.key, abort.signal);
      const stream = sseReader(response);
      await stream.nextEvent('put');
      const channel = `flag-updates:${ctx.envIds.prod}`;
      expect(ctx.subscriber.subscribed.has(channel)).toBe(true);
      expect(ctx.app.locals.hub.connectionCount()).toBe(1);

      await stream.cancel();
      abort.abort();
      await waitFor(() => ctx.app.locals.hub.connectionCount() === 0);
      await waitFor(() => !ctx.subscriber.subscribed.has(channel));
    } finally {
      abort.abort();
      await stop();
    }
  });

  it('shares one Redis subscription between streams and limits streams per key', async () => {
    const ctx = await setup({ env: { MAX_SSE_CONNECTIONS_PER_KEY: '2' } });
    const { url, stop } = await listen(ctx.app);
    const abort = new AbortController();
    try {
      const a = sseReader(await openStream(url, ctx.client.key, abort.signal));
      const b = sseReader(await openStream(url, ctx.client.key, abort.signal));
      await a.nextEvent('put');
      await b.nextEvent('put');
      expect(ctx.subscriber.subscribed.size).toBe(1);
      expect(ctx.app.locals.hub.connectionCount()).toBe(2);

      const third = await openStream(url, ctx.client.key, abort.signal);
      expect(third.status).toBe(429);
      expect(third.headers.get('retry-after')).toBe('5');
      await third.body?.cancel();

      const other = await ctx.makeKey('client');
      const fine = await openStream(url, other.key, abort.signal);
      expect(fine.status).toBe(200);
      await fine.body?.cancel();
    } finally {
      abort.abort();
      await stop();
    }
  });

  it('refuses a stream with 401 for a bad key and 503 when Redis cannot subscribe', async () => {
    const bad = await setup();
    const first = await listen(bad.app);
    try {
      const res = await fetch(`${first.url}/sdk/v1/stream`);
      expect(res.status).toBe(401);
      await res.body?.cancel();
    } finally {
      await first.stop();
    }

    const down = await setup({ subscribeFails: true });
    const second = await listen(down.app);
    try {
      const res = await openStream(second.url, down.client.key);
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error.code).toBe('stream_unavailable');
      expect(down.app.locals.hub.connectionCount()).toBe(0);
    } finally {
      await second.stop();
    }
  });

  it('sends heartbeats, and ends the stream soon after its key is revoked', async () => {
    const ctx = await setup({ env: { SSE_HEARTBEAT_SECONDS: '1' } });
    const { url, stop } = await listen(ctx.app);
    const abort = new AbortController();
    try {
      const stream = sseReader(await openStream(url, ctx.client.key, abort.signal));
      await stream.nextEvent('put');

      let frame = await stream.nextFrame(3000);
      while (frame && !frame.comment) {
        frame = await stream.nextFrame(3000);
      }
      expect(frame.comment).toBe(': ping');

      await ctx.owner.agent.delete(`${keysPath(ctx.pid, 'prod')}/${ctx.client.id}`).set(H);
      const error = await stream.nextEvent('error', 4000);
      expect(error.data.code).toBe('unauthorized');
      expect(await stream.nextFrame(2000)).toBe(null);
      await waitFor(() => ctx.app.locals.hub.connectionCount() === 0);
    } finally {
      abort.abort();
      await stop();
    }
  });
});
