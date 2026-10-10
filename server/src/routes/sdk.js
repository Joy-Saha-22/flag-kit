import { createHash } from 'node:crypto';
import { Router } from 'express';
import { AppError, asyncHandler, serializeError } from '../errors.js';
import { validate } from '../middleware/validate.js';

const MAX_BACKLOG_BYTES = 1_000_000;
const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no', // stop reverse proxies from buffering the stream
};

const sseFrame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function etagMatches(header, etag) {
  if (!header) {
    return false;
  }
  if (header.trim() === '*') {
    return true;
  }
  return header
    .split(',')
    .map((part) => part.trim().replace(/^W\//, ''))
    .includes(etag);
}

/**
 * Routes used by SDKs, authenticated with an SDK key (never a cookie).
 *
 *   GET  /flags   the environment's full ruleset (ETag / If-None-Match supported)
 *   GET  /stream  Server-Sent Events: "put" (full ruleset) on connect, then "patch" per change
 *   POST /events  batches of exposure and conversion events
 *
 * @param {{ env: any, auth: any, loadRuleset: Function, hub: any, sdkStore: any, schemas: any, rateLimits?: any, logger: any }} deps
 */
export function createSdkRouter({ env, auth, loadRuleset, hub, sdkStore, schemas, rateLimits = {}, logger }) {
  const router = Router();
  /** @type {Map<string, number>} open streams per SDK key on this instance */
  const connections = new Map();
  const noop = (req, res, next) => next();
  const sdkIp = rateLimits.sdkIp ?? noop;
  const sdkKey = rateLimits.sdkKey ?? noop;
  const sdkEventsBody = rateLimits.sdkEventsBody ?? noop;

  router.use(sdkIp);

  router.get(
    '/flags',
    auth.middleware,
    sdkKey,
    asyncHandler(async (req, res) => {
      const json = await loadRuleset(req.sdk);
      const etag = `"${createHash('sha1').update(json).digest('hex').slice(0, 20)}"`;
      res.set({ ETag: etag, 'Cache-Control': 'private, no-cache' });
      if (etagMatches(req.get('if-none-match'), etag)) {
        res.status(304).end();
        return;
      }
      res.type('application/json').send(json);
    }),
  );

  router.get(
    '/stream',
    auth.middleware,
    sdkKey,
    asyncHandler(async (req, res) => {
      const { envId, keyHash } = req.sdk;
      const open = connections.get(keyHash) ?? 0;
      if (open >= env.MAX_SSE_CONNECTIONS_PER_KEY) {
        res.set('Retry-After', '5');
        throw new AppError(429, 'too_many_streams', 'Too many open streams for this SDK key.');
      }
      connections.set(keyHash, open + 1);

      let closed = false;
      let ready = false;
      let heartbeat = null;
      const buffered = [];

      const write = (text) => {
        if (closed) {
          return;
        }
        res.write(text);
        // A client that is not reading would make memory grow without bound.
        if (res.writableLength > MAX_BACKLOG_BYTES) {
          client.close();
        }
      };
      const client = {
        deliver(message) {
          if (!ready) {
            buffered.push(message);
            return;
          }
          write(sseFrame('patch', message));
        },
        close() {
          res.end();
        },
      };
      const cleanup = () => {
        if (closed) {
          return;
        }
        closed = true;
        clearInterval(heartbeat);
        hub.remove(envId, client);
        const left = (connections.get(keyHash) ?? 1) - 1;
        if (left <= 0) {
          connections.delete(keyHash);
        } else {
          connections.set(keyHash, left);
        }
      };
      // "close" on the response fires when the client disconnects (the request's does not).
      res.on('close', cleanup);

      try {
        // Subscribe first, then load: a change made in between is buffered, not lost.
        await hub.add(envId, client);
        const json = await loadRuleset(req.sdk);
        if (closed) {
          return;
        }
        res.writeHead(200, SSE_HEADERS);
        res.write('retry: 3000\n\n');
        res.write(`event: put\ndata: ${json}\n\n`);
        const { version } = JSON.parse(json);
        ready = true;
        for (const message of buffered.splice(0)) {
          // Changes at or below the loaded version are already inside it.
          if (message.version > version) {
            write(sseFrame('patch', message));
          }
        }
        heartbeat = setInterval(async () => {
          if (closed) {
            return;
          }
          let active = true;
          try {
            active = await auth.isActive(keyHash);
          } catch (err) {
            logger.warn({ msg: 'stream_key_check_failed', err: serializeError(err) });
          }
          if (closed) {
            return;
          }
          if (!active) {
            // The key was revoked while the stream was open.
            res.write(sseFrame('error', { code: 'unauthorized' }));
            res.end();
            return;
          }
          res.write(': ping\n\n');
        }, env.SSE_HEARTBEAT_SECONDS * 1000);
        heartbeat.unref?.();
      } catch (err) {
        cleanup();
        logger.error({ msg: 'stream_setup_failed', requestId: req.id, err: serializeError(err) });
        if (res.headersSent) {
          res.end();
          return;
        }
        throw new AppError(503, 'stream_unavailable', 'Live updates are temporarily unavailable.');
      }
    }),
  );

  router.post(
    '/events',
    auth.middleware,
    sdkKey,
    sdkEventsBody,
    validate({ body: schemas.eventsBatch }),
    asyncHandler(async (req, res) => {
      const { events } = req.valid.body;
      const ruleset = JSON.parse(await loadRuleset(req.sdk));
      const flags = new Map(ruleset.flags.map((flag) => [flag.key, flag]));
      const now = Date.now();

      // Only experiments need events. Events for unknown flags, other flags, or
      // variations and metrics the flag does not have are counted as dropped, not errors:
      // an SDK may still be sending them for a flag that was just edited or deleted.
      const docs = [];
      for (const event of events) {
        const flag = flags.get(event.flagKey);
        if (!flag || !flag.isExperiment) {
          continue;
        }
        if (!flag.variations.some((variation) => variation.key === event.variation)) {
          continue;
        }
        if (event.type === 'conversion' && event.metricKey !== flag.goalMetricKey) {
          continue;
        }
        docs.push({
          projectId: req.sdk.projectId,
          envKey: req.sdk.envKey,
          type: event.type,
          flagKey: event.flagKey,
          variation: event.variation,
          userKey: event.userKey,
          metricKey: event.type === 'conversion' ? event.metricKey : null,
          ts: new Date(event.ts ?? now),
        });
      }
      if (docs.length > 0) {
        await sdkStore.insertEvents(docs);
      }
      res.status(202).json({ accepted: docs.length, dropped: events.length - docs.length });
    }),
  );

  return router;
}
