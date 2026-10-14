import { evaluate } from '@flagkit/evaluator';
import { parseSse } from './sse.js';

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const MAX_TIMER_MS = 2147483647;
const MAX_EVENT_QUEUE = 1000;
const MAX_EXPOSURE_DEDUPE = 10000;
const EVENT_BATCH_SIZE = 100;
const EVENT_FLUSH_THRESHOLD = 50;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;

class HttpFailure extends Error {
  constructor(status, retryAfterMs = 0) {
    super(`SDK request failed with status ${status}.`);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

class ClientClosedError extends Error {
  constructor() {
    super('SDK client closed before initialization.');
  }
}

function retryAfterMs(value) {
  if (!value) {
    return 0;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

function validateRuleset(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    !Number.isInteger(value.version) ||
    !Array.isArray(value.flags) ||
    value.flags.some((flag) => !flag || typeof flag !== 'object' || typeof flag.key !== 'string')
  ) {
    throw new Error('Invalid ruleset response.');
  }
  return value;
}

/**
 * Create a local-evaluation FlagKit SDK client.
 * @param {{
 *   sdkKey: string,
 *   baseUrl: string,
 *   streaming?: boolean,
 *   pollIntervalMs?: number,
 *   flushIntervalMs?: number,
 *   events?: boolean,
 *   logger?: {info?: Function, warn?: Function, error?: Function},
 *   fetch?: typeof globalThis.fetch
 * }} options
 */
export function createClient(options) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('createClient expects an options object.');
  }
  const {
    sdkKey,
    baseUrl,
    streaming = true,
    pollIntervalMs = 30000,
    flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
    events: eventsEnabled = true,
    logger,
    fetch: fetchImpl = globalThis.fetch,
  } = options;
  if (typeof sdkKey !== 'string' || sdkKey.length === 0) {
    throw new TypeError('sdkKey must be a non-empty string.');
  }
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
    throw new TypeError('baseUrl must be a non-empty URL.');
  }
  let parsedBaseUrl;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    throw new TypeError('baseUrl must be a valid HTTP(S) URL.');
  }
  if (
    !['http:', 'https:'].includes(parsedBaseUrl.protocol) ||
    parsedBaseUrl.username ||
    parsedBaseUrl.password ||
    parsedBaseUrl.search ||
    parsedBaseUrl.hash ||
    baseUrl.includes(sdkKey)
  ) {
    throw new TypeError('baseUrl must be an HTTP(S) URL without credentials, query, or fragment.');
  }
  if (typeof streaming !== 'boolean') {
    throw new TypeError('streaming must be a boolean.');
  }
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new TypeError('pollIntervalMs must be a positive number.');
  }
  if (!Number.isFinite(flushIntervalMs) || flushIntervalMs <= 0) {
    throw new TypeError('flushIntervalMs must be a positive number.');
  }
  if (typeof eventsEnabled !== 'boolean') {
    throw new TypeError('events must be a boolean.');
  }
  if (logger !== undefined && (!logger || typeof logger !== 'object')) {
    throw new TypeError('logger must be an object.');
  }
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetch must be a function.');
  }

  const rootUrl = parsedBaseUrl.toString().replace(/\/+$/, '');
  const flagsUrl = `${rootUrl}/sdk/v1/flags`;
  const streamUrl = `${rootUrl}/sdk/v1/stream`;
  const eventsUrl = `${rootUrl}/sdk/v1/events`;
  const flags = new Map();
  const listeners = new Set();
  const controllers = new Set();
  const pollControllers = new Set();
  const waiters = new Set();
  const eventQueue = [];
  const exposureDedupe = new Map();
  const lastReceived = new Map();
  let etag = null;
  let version = -1;
  let ready = false;
  let closed = false;
  let unauthorized = false;
  let polling = false;
  let initSettled = false;
  let flushTimer = null;
  let eventRetryTimer = null;
  let eventRetryBackoffMs = INITIAL_BACKOFF_MS;
  let flushInProgress = null;
  let closePromise = null;
  let resolveInit;
  let rejectInit;

  const initPromise = new Promise((resolve, reject) => {
    resolveInit = resolve;
    rejectInit = reject;
  });
  initPromise.catch(() => {});

  const log = (level, msg, status) => {
    const method = logger?.[level];
    if (typeof method === 'function') {
      method.call(logger, status === undefined ? { msg } : { msg, status });
    }
  };

  const setUnrefTimeout = (callback, delayMs) => {
    const scheduled = { timer: null, cancelled: false };
    const schedule = (remainingMs) => {
      const delay = Math.min(remainingMs, MAX_TIMER_MS);
      scheduled.timer = setTimeout(() => {
        if (scheduled.cancelled) {
          return;
        }
        if (remainingMs > delay) {
          schedule(remainingMs - delay);
        } else {
          callback();
        }
      }, delay);
      scheduled.timer.unref?.();
    };
    schedule(Math.max(0, delayMs));
    return {
      cancel() {
        scheduled.cancelled = true;
        clearTimeout(scheduled.timer);
      },
    };
  };

  const clearEventTimers = () => {
    if (flushTimer !== null) {
      flushTimer.cancel();
      flushTimer = null;
    }
    if (eventRetryTimer !== null) {
      eventRetryTimer.cancel();
      eventRetryTimer = null;
    }
  };

  const lruSet = (map, key, value, limit) => {
    map.delete(key);
    map.set(key, value);
    if (map.size > limit) {
      map.delete(map.keys().next().value);
    }
  };

  const identityKey = (flagKey, userKey) => JSON.stringify([flagKey, userKey]);
  const exposureKey = (flagKey, userKey, variationKey) => JSON.stringify([flagKey, userKey, variationKey]);

  const enqueueEvent = (event) => {
    if (!eventsEnabled || closed || unauthorized) {
      return false;
    }
    if (eventQueue.length >= MAX_EVENT_QUEUE) {
      eventQueue.shift();
      log('warn', 'sdk_event_queue_overflow');
    }
    eventQueue.push(event);
    if (eventQueue.length >= EVENT_FLUSH_THRESHOLD) {
      if (flushTimer !== null) {
        flushTimer.cancel();
        flushTimer = null;
      }
      Promise.resolve().then(() => flushEvents());
    } else {
      scheduleEventFlush();
    }
    return true;
  };

  const queueExposure = (flag, userKey, variationKey) => {
    if (!eventsEnabled || !flag.isExperiment || userKey.length < 1 || userKey.length > 200) {
      return;
    }
    const dedupeKey = exposureKey(flag.key, userKey, variationKey);
    if (exposureDedupe.has(dedupeKey)) {
      exposureDedupe.delete(dedupeKey);
      exposureDedupe.set(dedupeKey, true);
      return;
    }
    lruSet(exposureDedupe, dedupeKey, true, MAX_EXPOSURE_DEDUPE);
    enqueueEvent({
      type: 'exposure',
      flagKey: flag.key,
      variation: variationKey,
      userKey,
      ts: new Date().toISOString(),
    });
  };

  const scheduleEventFlush = () => {
    if (!eventsEnabled || closed || unauthorized || eventQueue.length === 0 || flushTimer !== null || eventRetryTimer !== null) {
      return;
    }
    flushTimer = setUnrefTimeout(() => {
      flushTimer = null;
      void flushEvents();
    }, flushIntervalMs);
  };

  const scheduleEventRetry = (minimumMs = 0) => {
    if (!eventsEnabled || closed || unauthorized || eventRetryTimer !== null) {
      return;
    }
    const delay = getRetryDelay(eventRetryBackoffMs, minimumMs);
    eventRetryBackoffMs = Math.min(eventRetryBackoffMs * 2, MAX_BACKOFF_MS);
    eventRetryTimer = setUnrefTimeout(() => {
      eventRetryTimer = null;
      void flushEvents();
    }, delay);
  };

  const sendEventBatch = async (batch, keepalive = false) => {
    let acquired;
    try {
      acquired = await request(
        eventsUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ events: batch }),
          keepalive,
        },
      );
      const { response, release } = acquired;
      try {
        if (response.status === 401) {
          markUnauthorized();
          return 'unauthorized';
        }
        if (response.status === 429) {
          scheduleEventRetry(retryAfterMs(response.headers.get('Retry-After')));
          return 'retry';
        }
        if (response.status === 400 || response.status === 413) {
          log('warn', 'sdk_event_batch_dropped', response.status);
          return 'drop';
        }
        if (response.status >= 500) {
          log('warn', 'sdk_event_request_failed', response.status);
          scheduleEventRetry(retryAfterMs(response.headers.get('Retry-After')));
          return 'retry';
        }
        if (!response.ok) {
          log('warn', 'sdk_event_batch_dropped', response.status);
          return 'drop';
        }
        eventRetryBackoffMs = INITIAL_BACKOFF_MS;
        return 'sent';
      } finally {
        release();
      }
    } catch {
      if (!closed && !unauthorized) {
        log('warn', 'sdk_event_request_failed');
        scheduleEventRetry();
      }
      return 'retry';
    }
  };

  const flushEvents = ({ keepalive = false } = {}) => {
    if (!eventsEnabled || unauthorized || eventQueue.length === 0) {
      return Promise.resolve();
    }
    if (flushInProgress) {
      return flushInProgress;
    }
    if (flushTimer !== null) {
      flushTimer.cancel();
      flushTimer = null;
    }
    if (eventRetryTimer !== null) {
      eventRetryTimer.cancel();
      eventRetryTimer = null;
    }
    flushInProgress = (async () => {
      while (eventQueue.length > 0 && !unauthorized) {
        const batch = eventQueue.slice(0, EVENT_BATCH_SIZE);
        const outcome = await sendEventBatch(batch, keepalive);
        if (outcome === 'sent' || outcome === 'drop') {
          for (const event of batch) {
            const index = eventQueue.indexOf(event);
            if (index >= 0) {
              eventQueue.splice(index, 1);
            }
          }
          continue;
        }
        return;
      }
    })().finally(() => {
      flushInProgress = null;
      if (eventQueue.length > 0 && !unauthorized && !closed && eventRetryTimer === null) {
        scheduleEventFlush();
      }
    });
    return flushInProgress;
  };

  const flushOnPageLifecycle = () => {
    void flushEvents({ keepalive: true });
  };

  const documentObject = typeof globalThis.document === 'object' ? globalThis.document : null;
  const windowObject = typeof globalThis.window === 'object' ? globalThis.window : null;
  const onVisibilityChange = () => {
    if (documentObject?.visibilityState === 'hidden') {
      flushOnPageLifecycle();
    }
  };
  if (eventsEnabled) {
    windowObject?.addEventListener?.('pagehide', flushOnPageLifecycle);
    documentObject?.addEventListener?.('visibilitychange', onVisibilityChange);
  }

  const settleInit = (error) => {
    if (initSettled) {
      return;
    }
    initSettled = true;
    if (error) {
      rejectInit(error);
    } else {
      resolveInit();
    }
  };

  const wakeWaiters = () => {
    for (const wake of [...waiters]) {
      wake();
    }
  };

  const sleep = (durationMs, shouldContinue = () => !closed) =>
    new Promise((resolve) => {
      let remaining = Math.max(0, durationMs);
      let timer;
      const finish = (continued) => {
        clearTimeout(timer);
        waiters.delete(wake);
        resolve(continued);
      };
      const wake = () => {
        if (!shouldContinue()) {
          finish(false);
        }
      };
      const schedule = () => {
        if (!shouldContinue()) {
          finish(false);
          return;
        }
        const chunk = Math.min(remaining, MAX_TIMER_MS);
        timer = setTimeout(() => {
          remaining -= chunk;
          if (remaining > 0) {
            schedule();
          } else {
            finish(shouldContinue());
          }
        }, chunk);
        timer.unref?.();
      };
      waiters.add(wake);
      schedule();
    });

  const markUnauthorized = () => {
    if (unauthorized) {
      return;
    }
    unauthorized = true;
    log('error', 'sdk_unauthorized', 401);
    clearEventTimers();
    settleInit(new HttpFailure(401));
    for (const controller of controllers) {
      controller.abort();
    }
    wakeWaiters();
  };

  const request = async (url, init = {}, isPoll = false) => {
    const controller = new AbortController();
    controllers.add(controller);
    if (isPoll) {
      pollControllers.add(controller);
    }
    try {
      const response = await fetchImpl(url, {
        ...init,
        headers: {
          ...init.headers,
          Authorization: sdkKey,
        },
        signal: controller.signal,
      });
      return {
        response,
        release() {
          controllers.delete(controller);
          pollControllers.delete(controller);
        },
      };
    } catch (error) {
      controllers.delete(controller);
      pollControllers.delete(controller);
      throw error;
    }
  };

  const loadRuleset = async ({ force = false, isPoll = false } = {}) => {
    const headers = {};
    if (etag && !force) {
      headers['If-None-Match'] = etag;
    }
    const { response, release } = await request(flagsUrl, { headers }, isPoll);
    try {
      if (response.status === 401) {
        throw new HttpFailure(401);
      }
      if (response.status === 429) {
        throw new HttpFailure(429, retryAfterMs(response.headers.get('Retry-After')));
      }
      if (response.status === 304) {
        return { changed: false, retryAfterMs: 0 };
      }
      if (!response.ok) {
        throw new HttpFailure(response.status, retryAfterMs(response.headers.get('Retry-After')));
      }
      const ruleset = validateRuleset(await response.json());
      flags.clear();
      for (const flag of ruleset.flags) {
        flags.set(flag.key, flag);
      }
      version = ruleset.version;
      etag = response.headers.get('ETag') || etag;
      ready = true;
      settleInit();
      return { changed: true, retryAfterMs: 0, version };
    } finally {
      release();
    }
  };

  const notify = (flagKey, currentVersion) => {
    for (const callback of [...listeners]) {
      try {
        callback({ flagKey, version: currentVersion });
      } catch {
        log('error', 'sdk_change_listener_failed');
      }
    }
  };

  const applyRuleset = (ruleset, notifyListeners) => {
    validateRuleset(ruleset);
    flags.clear();
    for (const flag of ruleset.flags) {
      flags.set(flag.key, flag);
    }
    version = ruleset.version;
    ready = true;
    settleInit();
    if (notifyListeners) {
      notify(null, version);
    }
  };

  const applyPatch = async (patch) => {
    if (
      !patch ||
      typeof patch !== 'object' ||
      !Number.isInteger(patch.version) ||
      typeof patch.flagKey !== 'string' ||
      !(patch.flag === null || (patch.flag && typeof patch.flag === 'object'))
    ) {
      throw new Error('Invalid patch response.');
    }
    if (patch.version <= version) {
      return;
    }
    if (patch.version > version + 1) {
      const result = await loadRuleset({ force: true });
      if (result.changed) {
        notify(null, result.version);
      }
      return;
    }
    if (patch.flag === null) {
      flags.delete(patch.flagKey);
    } else {
      flags.set(patch.flagKey, patch.flag);
    }
    version = patch.version;
    notify(patch.flagKey, version);
  };

  const getRetryDelay = (backoffMs, minimumMs = 0) => {
    const jittered = Math.min(MAX_BACKOFF_MS, backoffMs + Math.random() * backoffMs * 0.2);
    return Math.max(jittered, minimumMs);
  };

  const pollLoop = async () => {
    while (!closed && !unauthorized && polling) {
      let retryDelay = pollIntervalMs;
      try {
        const result = await loadRuleset({ isPoll: true });
        if (result.changed) {
          notify(null, result.version);
        }
      } catch (error) {
        if (error instanceof HttpFailure && error.status === 401) {
          markUnauthorized();
          return;
        }
        if (error instanceof HttpFailure) {
          retryDelay = Math.max(retryDelay, error.retryAfterMs);
          log('warn', 'sdk_poll_request_failed', error.status);
        } else if (!closed && polling) {
          log('warn', 'sdk_poll_request_failed');
        }
      }
      if (!(await sleep(retryDelay, () => !closed && !unauthorized && polling))) {
        return;
      }
    }
  };

  const runPolling = async () => {
    polling = true;
    await pollLoop();
  };

  const streamOnce = async () => {
    const { response, release } = await request(streamUrl);
    let reader;
    try {
      if (response.status === 401) {
        throw new HttpFailure(401);
      }
      if (response.status === 429) {
        throw new HttpFailure(429, retryAfterMs(response.headers.get('Retry-After')));
      }
      if (!response.ok) {
        throw new HttpFailure(response.status, retryAfterMs(response.headers.get('Retry-After')));
      }
      if (!response.body || typeof response.body.getReader !== 'function') {
        throw new Error('SSE response does not provide a readable stream.');
      }
      reader = response.body.getReader();
      let receivedPut = false;
      for await (const frame of parseSse(reader)) {
        if (frame.event === 'error') {
          let payload;
          try {
            payload = JSON.parse(frame.data);
          } catch {
            payload = null;
          }
          if (payload?.code === 'unauthorized') {
            markUnauthorized();
            return { success: false, retryAfterMs: 0 };
          }
        } else if (frame.event === 'put') {
          applyRuleset(JSON.parse(frame.data), true);
          receivedPut = true;
          polling = false;
          for (const controller of pollControllers) {
            controller.abort();
          }
          wakeWaiters();
        } else if (frame.event === 'patch') {
          await applyPatch(JSON.parse(frame.data));
        }
      }
      return { success: receivedPut, retryAfterMs: 0 };
    } finally {
      if (reader) {
        try {
          await reader.cancel();
        } catch {
          // The request may already have been aborted.
        }
        try {
          reader.releaseLock();
        } catch {
          // parseSse may already have released the reader.
        }
      }
      release();
    }
  };

  const run = async () => {
    let initialBackoff = INITIAL_BACKOFF_MS;
    while (!closed && !unauthorized && !ready) {
      try {
        const result = await loadRuleset();
        if (result.changed) {
          break;
        }
        throw new Error('Initial ruleset request returned not modified.');
      } catch (error) {
        if (error instanceof HttpFailure && error.status === 401) {
          markUnauthorized();
          return;
        }
        const retryDelay = getRetryDelay(
          initialBackoff,
          error instanceof HttpFailure ? error.retryAfterMs : 0,
        );
        log('warn', 'sdk_initial_request_failed', error instanceof HttpFailure ? error.status : undefined);
        if (!(await sleep(retryDelay))) {
          return;
        }
        initialBackoff = Math.min(initialBackoff * 2, MAX_BACKOFF_MS);
      }
    }

    if (closed || unauthorized || !ready) {
      return;
    }
    if (!streaming) {
      await runPolling();
      return;
    }

    let failures = 0;
    let backoffMs = INITIAL_BACKOFF_MS;
    let pollTask = null;
    while (!closed && !unauthorized) {
      let retryAfter = 0;
      let connected = false;
      try {
        const result = await streamOnce();
        connected = result.success;
      } catch (error) {
        if (error instanceof HttpFailure && error.status === 401) {
          markUnauthorized();
          return;
        }
        if (error instanceof HttpFailure) {
          retryAfter = error.retryAfterMs;
          log('warn', 'sdk_stream_request_failed', error.status);
        } else if (!closed && !unauthorized) {
          log('warn', 'sdk_stream_request_failed');
        }
      }

      if (closed || unauthorized) {
        return;
      }
      if (connected) {
        failures = 0;
        backoffMs = INITIAL_BACKOFF_MS;
      } else {
        failures += 1;
      }
      if (failures >= 3 && !polling) {
        polling = true;
        pollTask = pollLoop();
      }
      const retryDelay = getRetryDelay(backoffMs, retryAfter);
      if (!(await sleep(retryDelay))) {
        return;
      }
      if (!connected) {
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      }
      if (!polling && pollTask) {
        await pollTask;
        pollTask = null;
      }
    }
  };

  const runner = run().catch((error) => {
    if (error instanceof HttpFailure && error.status === 401) {
      markUnauthorized();
      return;
    }
    if (!closed && !unauthorized) {
      log('error', 'sdk_runtime_failed');
      settleInit(new Error('SDK initialization failed.'));
    }
  });

  return {
    waitForInit({ timeoutMs = 5000 } = {}) {
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new TypeError('timeoutMs must be a positive number.');
      }
      if (ready) {
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for SDK initialization.')), timeoutMs);
        timer.unref?.();
        initPromise.then(
          () => {
            clearTimeout(timer);
            resolve();
          },
          (error) => {
            clearTimeout(timer);
            reject(error);
          },
        );
      });
    },
    variation(flagKey, userContext, defaultValue) {
      return variationDetail(flagKey, userContext, defaultValue).value;
    },
    variationDetail,
    onChange(callback) {
      if (typeof callback !== 'function') {
        throw new TypeError('onChange expects a callback function.');
      }
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    isReady() {
      return ready && !closed && !unauthorized;
    },
    track(metricKey, userContext) {
      try {
        if (
          !eventsEnabled ||
          typeof metricKey !== 'string' ||
          !metricKey ||
          !userContext ||
          typeof userContext !== 'object' ||
          typeof userContext.key !== 'string' ||
          userContext.key.length < 1 ||
          userContext.key.length > 200 ||
          !ready ||
          closed ||
          unauthorized
        ) {
          return;
        }
        const userKey = userContext.key;
        for (const flag of flags.values()) {
          if (!flag.isExperiment || flag.goalMetricKey !== metricKey) {
            continue;
          }
          const identity = identityKey(flag.key, userKey);
          let variationKey = lastReceived.get(identity);
          if (variationKey === undefined) {
            variationDetail(flag.key, userContext, undefined);
            variationKey = lastReceived.get(identity);
          }
          if (variationKey === undefined) {
            continue;
          }
          enqueueEvent({
            type: 'conversion',
            flagKey: flag.key,
            variation: variationKey,
            userKey,
            metricKey,
            ts: new Date().toISOString(),
          });
        }
      } catch {
        log('warn', 'sdk_track_failed');
      }
    },
    flush() {
      return flushEvents();
    },
    async close() {
      if (!closePromise) {
        closePromise = (async () => {
          if (eventsEnabled && !unauthorized) {
            await flushEvents();
          }
          if (!closed) {
            closed = true;
            polling = false;
            clearEventTimers();
            windowObject?.removeEventListener?.('pagehide', flushOnPageLifecycle);
            documentObject?.removeEventListener?.('visibilitychange', onVisibilityChange);
            settleInit(new ClientClosedError());
            for (const controller of controllers) {
              controller.abort();
            }
            wakeWaiters();
          }
          await runner;
        })();
      }
      await closePromise;
    },
  };

  function variationDetail(flagKey, userContext, defaultValue) {
    const fallback = (errorKind) => ({
      value: defaultValue,
      variationKey: null,
      reason: { kind: 'error', errorKind },
    });
    try {
      if (typeof flagKey !== 'string' || flagKey.length === 0) {
        return fallback('invalid_flag_key');
      }
      if (!ready || closed || unauthorized) {
        return fallback('not_ready');
      }
      if (!userContext || typeof userContext !== 'object' || typeof userContext.key !== 'string') {
        return fallback('user_key_missing');
      }
      const flag = flags.get(flagKey);
      if (!flag) {
        return fallback('flag_not_found');
      }
      const result = evaluate({ key: flag.key }, flag, userContext);
      if (result.reason?.kind === 'error' || typeof result.variation !== 'string') {
        return fallback(result.reason?.errorKind || 'evaluation_failed');
      }
      const variation = flag.variations.find((entry) => entry.key === result.variation);
      if (!variation) {
        return fallback('variation_not_found');
      }
      if (eventsEnabled && typeof userContext.key === 'string') {
        lruSet(lastReceived, identityKey(flag.key, userContext.key), variation.key, MAX_EXPOSURE_DEDUPE);
        queueExposure(flag, userContext.key, variation.key);
      }
      return { value: variation.value, variationKey: variation.key, reason: result.reason };
    } catch {
      return fallback('evaluation_failed');
    }
  }
}
