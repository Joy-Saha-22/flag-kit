import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '../src/index.js';
import { parseSse } from '../src/sse.js';

const sdkKey = 'fk_client_test-key';

function flag(overrides = {}) {
  return {
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
    ...overrides,
  };
}

function createFixture({ flags = [flag()] } = {}) {
  const state = { version: 1, flags };
  const streams = new Set();
  const flagWaiters = [];
  const streamWaiters = [];
  const eventWaiters = [];
  const logWaiters = [];
  const logs = [];
  const fixture = {
    state,
    streams,
    logs,
    flagRequests: 0,
    streamRequests: 0,
    eventRequests: 0,
    eventBatches: [],
    eventStatuses: [],
    eventRetryAfter: null,
    activeStreams: 0,
    flagStatus: 200,
    flagDelayMs: 0,
    streamStatuses: [],
    streamRetryAfter: null,
    observedHeaders: [],
    setState(next) {
      state.version = next.version;
      state.flags = next.flags;
    },
    notify(event, payload) {
      for (const response of streams) {
        response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      }
    },
    closeStreams() {
      for (const response of streams) {
        response.end();
      }
      streams.clear();
    },
    waitForFlagRequests(count) {
      if (fixture.flagRequests >= count) {
        return Promise.resolve();
      }
      return new Promise((resolve) => flagWaiters.push({ count, resolve }));
    },
    waitForStreamRequests(count) {
      if (fixture.streamRequests >= count) {
        return Promise.resolve();
      }
      return new Promise((resolve) => streamWaiters.push({ count, resolve }));
    },
    waitForEventRequests(count) {
      if (fixture.eventRequests >= count) {
        return Promise.resolve();
      }
      return new Promise((resolve) => eventWaiters.push({ count, resolve }));
    },
    waitForLog(message, count = 1) {
      if (logs.filter((entry) => entry.msg === message).length >= count) {
        return Promise.resolve();
      }
      return new Promise((resolve) => logWaiters.push({ message, count, resolve }));
    },
  };
  const notifyWaiters = (waiters, count) => {
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      const reached =
        typeof count === 'number'
          ? waiter.count <= count
          : waiter.message === count && logs.filter((entry) => entry.msg === count).length >= waiter.count;
      if (reached) {
        waiters.splice(index, 1)[0].resolve();
      }
    }
  };
  const server = createServer(async (request, response) => {
    if (request.headers.authorization !== sdkKey) {
      response.writeHead(401).end();
      return;
    }
    if (request.url === '/sdk/v1/flags') {
      fixture.flagRequests += 1;
      fixture.observedHeaders.push(request.headers);
      notifyWaiters(flagWaiters, fixture.flagRequests);
      const json = JSON.stringify(state);
      const etag = `"${state.version}"`;
      response.setHeader('ETag', etag);
      if (fixture.flagStatus !== 200) {
        response.writeHead(fixture.flagStatus, fixture.streamRetryAfter ? { 'Retry-After': fixture.streamRetryAfter } : {});
        response.end();
        return;
      }
      if (request.headers['if-none-match'] === etag) {
        response.writeHead(304).end();
        return;
      }
      const send = () => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(json);
      };
      if (fixture.flagDelayMs > 0) {
        setTimeout(send, fixture.flagDelayMs);
      } else {
        send();
      }
      return;
    }
    if (request.url === '/sdk/v1/stream') {
      fixture.streamRequests += 1;
      notifyWaiters(streamWaiters, fixture.streamRequests);
      const status = fixture.streamStatuses.shift() ?? 200;
      if (status !== 200) {
        const headers = fixture.streamRetryAfter ? { 'Retry-After': fixture.streamRetryAfter } : {};
        response.writeHead(status, headers).end();
        return;
      }
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      streams.add(response);
      fixture.activeStreams = streams.size;
      response.on('close', () => {
        streams.delete(response);
        fixture.activeStreams = streams.size;
      });
      response.write('retry: 3000\n\n');
      response.write(`event: put\ndata: ${JSON.stringify(state)}\n\n`);
      return;
    }
    if (request.url === '/sdk/v1/events') {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString('utf8');
      fixture.eventRequests += 1;
      fixture.eventBatches.push(JSON.parse(body));
      notifyWaiters(eventWaiters, fixture.eventRequests);
      const status = fixture.eventStatuses.shift() ?? 202;
      if (status === 429 || status >= 500) {
        const headers = fixture.eventRetryAfter ? { 'Retry-After': fixture.eventRetryAfter } : {};
        response.writeHead(status, headers).end();
        return;
      }
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(
        status === 202 ? JSON.stringify({ accepted: fixture.eventBatches.at(-1).events.length, dropped: 0 }) : '{}',
      );
      return;
    }
    response.writeHead(404).end();
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      fixture.baseUrl = `http://127.0.0.1:${address.port}`;
      fixture.close = async () => {
        fixture.closeStreams();
        const closed = new Promise((done) => server.close(done));
        server.closeAllConnections();
        await closed;
      };
      fixture.createClient = (options = {}) =>
        createClient({
          sdkKey,
          baseUrl: fixture.baseUrl,
          logger: {
            warn: (entry) => {
              logs.push(entry);
              notifyWaiters(logWaiters, entry.msg);
            },
            error: (entry) => {
              logs.push(entry);
              notifyWaiters(logWaiters, entry.msg);
            },
          },
          ...options,
        });
      resolve(fixture);
    });
  });
}

const fixtures = new Set();

async function makeFixture(options) {
  const fixture = await createFixture(options);
  fixtures.add(fixture);
  return fixture;
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all([...fixtures].map((fixture) => fixture.close()));
  fixtures.clear();
});

describe('FlagKit SDK', () => {
  it('loads the initial ruleset and evaluates rollout and targeting locally', async () => {
    const rolloutFlag = flag({
      fallthrough: {
        rollout: [
          { variation: 'on', weight: 30000 },
          { variation: 'off', weight: 70000 },
        ],
      },
      rules: [
        {
          id: 'premium',
          conditions: [{ attribute: 'plan', operator: 'equals', values: ['premium'] }],
          serve: { variation: 'on' },
        },
      ],
    });
    const brokenFlag = flag({
      key: 'broken',
      salt: '',
      fallthrough: { rollout: [{ variation: 'on', weight: 100000 }] },
    });
    const fixture = await makeFixture({ flags: [rolloutFlag, brokenFlag] });
    const client = fixture.createClient();
    await client.waitForInit();

    expect(client.isReady()).toBe(true);
    expect(client.variation('checkout', { key: 'u4' }, 'default')).toBe(true);
    expect(client.variation('checkout', { key: 'u0' }, 'default')).toBe(false);
    expect(client.variationDetail('checkout', { key: 'other', plan: 'premium' }, null)).toEqual({
      value: true,
      variationKey: 'on',
      reason: { kind: 'rule', ruleId: 'premium' },
    });
    expect(client.variation('missing', { key: 'u4' }, 'default')).toBe('default');
    expect(client.variation('checkout', {}, 'default')).toBe('default');
    expect(client.variationDetail('broken', { key: 'u4' }, 'default')).toEqual({
      value: 'default',
      variationKey: null,
      reason: { kind: 'error', errorKind: 'salt_missing' },
    });
    expect(fixture.observedHeaders[0].authorization).toBe(sdkKey);
    await client.close();
  });

  it('returns defaults before readiness and rejects waitForInit on timeout or unauthorized responses', async () => {
    const delayed = await makeFixture();
    delayed.flagDelayMs = 60;
    const waitingClient = delayed.createClient({ streaming: false });
    expect(waitingClient.variation('checkout', { key: 'u4' }, 'fallback')).toBe('fallback');
    await expect(waitingClient.waitForInit({ timeoutMs: 10 })).rejects.toThrow(/Timed out/);
    await waitingClient.close();

    const unauthorized = await makeFixture();
    unauthorized.flagStatus = 401;
    const unauthorizedClient = unauthorized.createClient();
    await expect(unauthorizedClient.waitForInit()).rejects.toThrow(/status 401/);
    expect(unauthorized.logs.some((entry) => entry.msg === 'sdk_unauthorized')).toBe(true);
    await unauthorizedClient.close();
  });

  it('parses chunked SSE frames, CRLF, multiple data lines, comments, and unknown fields', async () => {
    const chunks = [
      'retry: 3000\r',
      '\n\r\n: heartbeat\r\nx-extra: ignored\r\nevent: patch\r',
      '\ndata: first\r\ndata: second\r\n\r',
      '\n',
    ];
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });
    const frames = [];
    for await (const frame of parseSse(stream.getReader())) {
      frames.push(frame);
    }
    expect(frames).toEqual([
      { event: 'message', data: '', retry: 3000 },
      { event: 'patch', data: 'first\nsecond', retry: undefined },
    ]);
  });

  it('applies new patches, ignores old patches, deletes flags, and refetches on version gaps', async () => {
    const fixture = await makeFixture();
    const client = fixture.createClient();
    const changes = [];
    const unsubscribe = client.onChange((change) => changes.push(change));
    await client.waitForInit();
    await fixture.waitForStreamRequests(1);
    await new Promise((resolve) => setImmediate(resolve));

    fixture.notify('patch', { version: 2, flagKey: 'checkout', flag: flag({ fallthrough: { variation: 'off' } }) });
    await vi.waitFor(() => expect(changes.some((change) => change.version === 2)).toBe(true));
    expect(client.variation('checkout', { key: 'u4' }, 'default')).toBe(false);

    const countAfterUpdate = changes.length;
    fixture.notify('patch', { version: 1, flagKey: 'checkout', flag: flag() });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(changes).toHaveLength(countAfterUpdate);

    fixture.notify('patch', { version: 3, flagKey: 'checkout', flag: null });
    await vi.waitFor(() => expect(changes.some((change) => change.version === 3)).toBe(true));
    expect(client.variation('checkout', { key: 'u4' }, 'default')).toBe('default');

    fixture.setState({ version: 5, flags: [flag({ fallthrough: { variation: 'off' } })] });
    fixture.notify('patch', { version: 5, flagKey: 'checkout', flag: fixture.state.flags[0] });
    await fixture.waitForFlagRequests(2);
    await vi.waitFor(() => expect(changes.some((change) => change.version === 5)).toBe(true));
    expect(client.variation('checkout', { key: 'u4' }, 'default')).toBe(false);
    unsubscribe();
    await client.close();
  });

  it('backs off with fake timers, falls back to conditional polling after three failures, and honours Retry-After', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fixture = await makeFixture();
    fixture.streamStatuses = [503, 503, 503, 200];
    const client = fixture.createClient({ pollIntervalMs: 60000 });
    await client.waitForInit();

    await fixture.waitForStreamRequests(1);
    await fixture.waitForLog('sdk_stream_request_failed', 1);
    await vi.advanceTimersByTimeAsync(999);
    expect(fixture.streamRequests).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await fixture.waitForStreamRequests(2);
    await fixture.waitForLog('sdk_stream_request_failed', 2);
    await vi.advanceTimersByTimeAsync(2000);
    await fixture.waitForStreamRequests(3);
    await fixture.waitForLog('sdk_stream_request_failed', 3);
    await fixture.waitForFlagRequests(2);
    expect(fixture.observedHeaders[1]['if-none-match']).toBe('"1"');
    await vi.advanceTimersByTimeAsync(3999);
    expect(fixture.streamRequests).toBe(3);
    await vi.advanceTimersByTimeAsync(1);
    await fixture.waitForStreamRequests(4);
    await client.close();

    const retryFixture = await makeFixture();
    retryFixture.streamStatuses = [429, 200];
    retryFixture.streamRetryAfter = '5';
    const retryClient = retryFixture.createClient();
    await retryClient.waitForInit();
    await retryFixture.waitForStreamRequests(1);
    await retryFixture.waitForLog('sdk_stream_request_failed');
    await vi.advanceTimersByTimeAsync(4999);
    expect(retryFixture.streamRequests).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await retryFixture.waitForStreamRequests(2);
    await retryClient.close();
  }, 15000);

  it('stops permanently on a stream 401 and close aborts its open SSE request', async () => {
    const fixture = await makeFixture();
    fixture.streamStatuses = [401];
    const client = fixture.createClient();
    await client.waitForInit();
    await fixture.waitForStreamRequests(1);
    await vi.waitFor(() => expect(fixture.logs.some((entry) => entry.msg === 'sdk_unauthorized')).toBe(true));
    expect(JSON.stringify(fixture.logs)).not.toContain(sdkKey);
    const requestCount = fixture.streamRequests;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fixture.streamRequests).toBe(requestCount);
    await client.close();

    const connectedFixture = await makeFixture();
    const connectedClient = connectedFixture.createClient();
    await connectedClient.waitForInit();
    await connectedFixture.waitForStreamRequests(1);
    await vi.waitFor(() => expect(connectedFixture.activeStreams).toBe(1));
    await connectedClient.close();
    await vi.waitFor(() => expect(connectedFixture.activeStreams).toBe(0));
  });

  it('supports polling-only mode with ETag/304 and never logs the SDK key', async () => {
    const fixture = await makeFixture();
    const client = fixture.createClient({ streaming: false, pollIntervalMs: 15 });
    await client.waitForInit();
    await fixture.waitForFlagRequests(2);
    expect(fixture.observedHeaders[1]['if-none-match']).toBe('"1"');
    expect(fixture.logs).not.toContain(sdkKey);
    expect(JSON.stringify(fixture.logs)).not.toContain(sdkKey);
    await client.close();
  });

  it('queues experiment exposures once per flag, user, and variation and emits valid event payloads', async () => {
    const experiment = flag({
      isExperiment: true,
      goalMetricKey: 'signup_completed',
    });
    const fixture = await makeFixture({ flags: [experiment] });
    const client = fixture.createClient({ streaming: false, flushIntervalMs: 60000 });
    await client.waitForInit();

    client.variation('checkout', { key: 'exposure-user' }, false);
    client.variationDetail('checkout', { key: 'exposure-user' }, false);
    client.variation('checkout', { key: 'exposure-user' }, false);
    await client.flush();

    expect(fixture.eventRequests).toBe(1);
    expect(fixture.eventBatches[0].events).toHaveLength(1);
    expect(fixture.eventBatches[0].events[0]).toMatchObject({
      type: 'exposure',
      flagKey: 'checkout',
      variation: 'on',
      userKey: 'exposure-user',
    });
    expect(fixture.eventBatches[0].events[0].ts).toEqual(expect.any(String));
    expect(fixture.eventBatches[0].events[0]).not.toHaveProperty('metricKey');
    expect(JSON.stringify(fixture.eventBatches)).not.toContain(sdkKey);
    await client.close();

    const notExperiment = await makeFixture();
    const nonExperimentClient = notExperiment.createClient({ streaming: false });
    await nonExperimentClient.waitForInit();
    nonExperimentClient.variation('checkout', { key: 'ordinary-user' }, false);
    await nonExperimentClient.flush();
    expect(notExperiment.eventRequests).toBe(0);
    await nonExperimentClient.close();
  });

  it('tracks previously served variations and exposes before a conversion on first track', async () => {
    const fixtures = await makeFixture({
      flags: [
        flag({ isExperiment: true, goalMetricKey: 'signup_completed' }),
        flag({
          key: 'checkout-alt',
          isExperiment: true,
          goalMetricKey: 'signup_completed',
          variations: [{ key: 'control', value: 'control-value' }],
          offVariation: 'control',
          fallthrough: { variation: 'control' },
        }),
      ],
    });
    const client = fixtures.createClient({ streaming: false, flushIntervalMs: 60000 });
    await client.waitForInit();

    client.variation('checkout', { key: 'known-user' }, null);
    client.track('signup_completed', { key: 'known-user' });
    client.track('signup_completed', { key: 'new-user' });
    client.track('signup_completed', {});
    await client.flush();

    const sentEvents = fixtures.eventBatches.flatMap((batch) => batch.events);
    expect(sentEvents.filter((event) => event.type === 'conversion')).toHaveLength(4);
    const known = sentEvents.filter((event) => event.userKey === 'known-user');
    expect(known.map((event) => `${event.flagKey}:${event.type}`)).toEqual([
      'checkout:exposure',
      'checkout:conversion',
      'checkout-alt:exposure',
      'checkout-alt:conversion',
    ]);
    const newUser = sentEvents.filter((event) => event.userKey === 'new-user');
    expect(newUser.map((event) => `${event.flagKey}:${event.type}`)).toEqual([
      'checkout:exposure',
      'checkout:conversion',
      'checkout-alt:exposure',
      'checkout-alt:conversion',
    ]);
    expect(newUser.filter((event) => event.type === 'conversion').every((event) => event.metricKey === 'signup_completed')).toBe(
      true,
    );
    await client.close();
  });

  it('batches at 50 events, caps requests at 100, and also flushes on the interval', async () => {
    const experiment = flag({ isExperiment: true });
    const fixture = await makeFixture({ flags: [experiment] });
    const client = fixture.createClient({ streaming: false, flushIntervalMs: 60000 });
    await client.waitForInit();

    for (let index = 0; index < 120; index += 1) {
      client.variation('checkout', { key: `batch-${index}` }, false);
    }
    await fixture.waitForEventRequests(2);
    expect(fixture.eventBatches.map((batch) => batch.events.length)).toEqual([100, 20]);
    await client.close();

    const timedFixture = await makeFixture({ flags: [experiment] });
    const timedClient = timedFixture.createClient({ streaming: false, flushIntervalMs: 20 });
    await timedClient.waitForInit();
    timedClient.variation('checkout', { key: 'timer-user' }, false);
    await timedFixture.waitForEventRequests(1);
    expect(timedFixture.eventBatches[0].events).toHaveLength(1);
    await timedClient.close();
  });

  it('drops malformed/oversized batches, retries 429 and 5xx, and stops permanently on event 401', async () => {
    const experiment = flag({ isExperiment: true });
    const badFixture = await makeFixture({ flags: [experiment] });
    badFixture.eventStatuses = [400, 413];
    const badClient = badFixture.createClient({ streaming: false, flushIntervalMs: 60000 });
    await badClient.waitForInit();
    badClient.variation('checkout', { key: 'bad-1' }, false);
    await badClient.flush();
    badClient.variation('checkout', { key: 'bad-2' }, false);
    await badClient.flush();
    expect(badFixture.eventRequests).toBe(2);
    expect(badFixture.logs.filter((entry) => entry.msg === 'sdk_event_batch_dropped')).toHaveLength(2);
    await badClient.close();

    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const retryFixture = await makeFixture({ flags: [experiment] });
    retryFixture.eventStatuses = [429, 503, 202];
    retryFixture.eventRetryAfter = '3';
    const retryClient = retryFixture.createClient({ streaming: false, flushIntervalMs: 60000 });
    await retryClient.waitForInit();
    retryClient.variation('checkout', { key: 'retry-user' }, false);
    await retryClient.flush();
    await retryFixture.waitForEventRequests(1);
    await vi.advanceTimersByTimeAsync(2999);
    expect(retryFixture.eventRequests).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await retryFixture.waitForEventRequests(2);
    await vi.advanceTimersByTimeAsync(2999);
    expect(retryFixture.eventRequests).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    await retryFixture.waitForEventRequests(3);
    expect(retryFixture.eventBatches.map((batch) => batch.events[0].userKey)).toEqual([
      'retry-user',
      'retry-user',
      'retry-user',
    ]);
    await retryClient.close();
    vi.useRealTimers();

    const unauthorizedFixture = await makeFixture({ flags: [experiment] });
    unauthorizedFixture.eventStatuses = [401];
    const unauthorizedClient = unauthorizedFixture.createClient({ streaming: false });
    await unauthorizedClient.waitForInit();
    unauthorizedClient.variation('checkout', { key: 'unauthorized-user' }, false);
    await unauthorizedClient.flush();
    await unauthorizedFixture.waitForEventRequests(1);
    await vi.waitFor(() => expect(unauthorizedFixture.logs.some((entry) => entry.msg === 'sdk_unauthorized')).toBe(true));
    expect(unauthorizedClient.isReady()).toBe(false);
    unauthorizedClient.variation('checkout', { key: 'no-more-events' }, false);
    expect(JSON.stringify(unauthorizedFixture.logs)).not.toContain(sdkKey);
    await unauthorizedClient.close();
  });

  it('bounds the queue, flushes on close, and disables events when configured', async () => {
    const closeFixture = await makeFixture({ flags: [flag({ isExperiment: true })] });
    const closeClient = closeFixture.createClient({ streaming: false, flushIntervalMs: 60000 });
    await closeClient.waitForInit();
    closeClient.variation('checkout', { key: 'close-user' }, false);
    expect(closeFixture.eventRequests).toBe(0);
    await closeClient.close();
    expect(closeFixture.eventRequests).toBe(1);
    expect(closeFixture.eventBatches[0].events[0].userKey).toBe('close-user');

    const experiment = flag({ isExperiment: true });
    const fixture = await makeFixture({ flags: [experiment] });
    const client = fixture.createClient({ streaming: false, flushIntervalMs: 60000 });
    await client.waitForInit();
    for (let index = 0; index < 1001; index += 1) {
      client.variation('checkout', { key: `queue-${index}` }, false);
    }
    expect(fixture.logs.some((entry) => entry.msg === 'sdk_event_queue_overflow')).toBe(true);
    await client.close();
    const events = fixture.eventBatches.flatMap((batch) => batch.events);
    expect(events).toHaveLength(1000);
    expect(events.some((event) => event.userKey === 'queue-0')).toBe(false);
    expect(fixture.eventBatches.every((batch) => batch.events.length <= 100)).toBe(true);

    const disabledFixture = await makeFixture({ flags: [experiment] });
    const disabledClient = disabledFixture.createClient({ streaming: false, events: false });
    await disabledClient.waitForInit();
    disabledClient.variation('checkout', { key: 'disabled-user' }, false);
    disabledClient.track('signup_completed', { key: 'disabled-user' });
    await disabledClient.flush();
    await disabledClient.close();
    expect(disabledFixture.eventRequests).toBe(0);
  });

  it('flushes on pagehide and hidden visibility using fetch keepalive', async () => {
    const windowListeners = new Map();
    const documentListeners = new Map();
    const browserDocument = {
      visibilityState: 'visible',
      addEventListener: (name, callback) => documentListeners.set(name, callback),
      removeEventListener: (name) => documentListeners.delete(name),
    };
    vi.stubGlobal('window', {
      addEventListener: (name, callback) => windowListeners.set(name, callback),
      removeEventListener: (name) => windowListeners.delete(name),
    });
    vi.stubGlobal('document', browserDocument);

    const fixture = await makeFixture({ flags: [flag({ isExperiment: true })] });
    const keepaliveValues = [];
    const fetch = (url, init) => {
      if (url.endsWith('/sdk/v1/events')) {
        keepaliveValues.push(init.keepalive);
      }
      return globalThis.fetch(url, init);
    };
    const client = fixture.createClient({ streaming: false, fetch });
    await client.waitForInit();
    client.variation('checkout', { key: 'lifecycle-user' }, false);

    windowListeners.get('pagehide')();
    await fixture.waitForEventRequests(1);
    expect(keepaliveValues).toEqual([true]);

    client.variation('checkout', { key: 'lifecycle-user-2' }, false);
    browserDocument.visibilityState = 'hidden';
    documentListeners.get('visibilitychange')();
    await fixture.waitForEventRequests(2);
    expect(keepaliveValues).toEqual([true, true]);
    await client.close();
    expect(windowListeners.has('pagehide')).toBe(false);
    expect(documentListeners.has('visibilitychange')).toBe(false);
  });
});
