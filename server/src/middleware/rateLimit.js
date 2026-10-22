import { AppError, asyncHandler, serializeError } from '../errors.js';
import { rateLimitKey } from '../lib/redisKeys.js';

/**
 * Increment a counter and set its TTL on first hit. Atomic in Redis so two
 * overlapping requests cannot both see count=1 and skip the expiry.
 */
export const INCR_WINDOW_SCRIPT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 or redis.call('PTTL', KEYS[1]) < 0 then
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]))
end
local ttl = redis.call('PTTL', KEYS[1])
return {n, ttl}
`;

export const INCR_EXPIRE_SCRIPT = `
local n = redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]))
return n
`;

const RATE_LIMITED_MESSAGE = 'Too many requests.';

/**
 * @param {number} retryAfterSeconds
 * @returns {AppError}
 */
export function rateLimited(retryAfterSeconds) {
  const retryAfter = Math.max(1, Math.ceil(retryAfterSeconds));
  return new AppError(429, 'rate_limited', RATE_LIMITED_MESSAGE, undefined, retryAfter);
}

/**
 * Best-effort client IP. X-Forwarded-For is ignored so callers cannot pick
 * someone else's bucket by spoofing a header.
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
export function normalizeIp(raw) {
  if (!raw) return 'unknown';
  let ip = String(raw).trim().toLowerCase().split('%')[0];
  if (ip.startsWith('::ffff:') && ip.includes('.')) ip = ip.slice(7);
  if (!ip.includes(':')) return ip;
  // IPv6: keep the /64 prefix, so one subnet shares one bucket.
  const [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail === undefined ? [] : tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  const prefix = groups.slice(0, 4).map((g) => parseInt(g || '0', 16));
  if (prefix.length < 4 || prefix.some(Number.isNaN)) return ip;
  return `${prefix.map((g) => g.toString(16)).join(':')}::/64`;
}

export function clientIp(req) {
  // req.ip honours the "trust proxy" setting, and is the socket address when it is 0.
  return normalizeIp(req.ip ?? req.socket?.remoteAddress);
}

/**
 * @param {any} cache
 * @param {string} key
 * @param {number} windowMs
 * @returns {Promise<{ count: number, ttlMs: number }>}
 */
export async function incrementWindow(cache, key, windowMs) {
  const result = await cache.eval(INCR_WINDOW_SCRIPT, 1, key, String(windowMs));
  const count = Number(Array.isArray(result) ? result[0] : result);
  const ttlMs = Number(Array.isArray(result) ? result[1] : 0);
  return { count, ttlMs };
}

function retrySeconds(ttlMs, windowSeconds) {
  if (Number.isFinite(ttlMs) && ttlMs > 0) {
    return Math.max(1, Math.ceil(ttlMs / 1000));
  }
  return windowSeconds;
}

/**
 * Redis-backed fixed-window limiter. If Redis is down we fail open: serving
 * flags and login is more important than shedding load, and the next instance
 * with a working cache still enforces the limit.
 *
 * @param {{ cache?: any, logger: { warn: Function }, name: string, max: number, windowSeconds: number, keyFn: (req: any) => string | null | undefined }} opts
 */
export function createWindowLimit({ cache, logger, name, max, windowSeconds, keyFn }) {
  return asyncHandler(async (req, res, next) => {
    if (!cache || typeof cache.eval !== 'function') {
      return next();
    }
    const id = keyFn(req);
    if (!id) {
      return next();
    }
    try {
      const { count, ttlMs } = await incrementWindow(cache, `${name}:${id}`, windowSeconds * 1000);
      if (count > max) {
        throw rateLimited(retrySeconds(ttlMs, windowSeconds));
      }
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      logger.warn({ msg: 'rate_limit_failed', err: serializeError(err) });
    }
    return next();
  });
}

/**
 * @param {{ env: any, cache?: any, logger: { warn: Function } }} deps
 */
export function createRateLimits({ env, cache, logger }) {
  const window = (name, max, windowSeconds, keyFn) =>
    createWindowLimit({ cache, logger, name, max, windowSeconds, keyFn });

  const publicIp = window(
    'ratelimit:public:ip',
    env.PUBLIC_RATE_LIMIT_IP_MAX,
    env.PUBLIC_RATE_LIMIT_IP_WINDOW_SECONDS,
    clientIp,
  );
  const authIp = window(
    'ratelimit:auth:ip',
    env.AUTH_RATE_LIMIT_IP_MAX,
    env.AUTH_RATE_LIMIT_IP_WINDOW_SECONDS,
    clientIp,
  );
  const authEmail = window(
    'ratelimit:auth:email',
    env.AUTH_RATE_LIMIT_EMAIL_MAX,
    env.AUTH_RATE_LIMIT_EMAIL_WINDOW_SECONDS,
    (req) => req.valid?.body?.email,
  );
  const dashboardUser = window(
    'ratelimit:dash:user',
    env.DASHBOARD_RATE_LIMIT_USER_MAX,
    env.DASHBOARD_RATE_LIMIT_USER_WINDOW_SECONDS,
    (req) => req.user?.id,
  );
  const sdkIp = window(
    'ratelimit:sdk:ip',
    env.SDK_RATE_LIMIT_IP_MAX,
    env.SDK_RATE_LIMIT_IP_WINDOW_SECONDS,
    clientIp,
  );
  const sdkKey = window(
    'ratelimit:sdk:key',
    env.SDK_RATE_LIMIT_KEY_MAX,
    env.SDK_RATE_LIMIT_KEY_WINDOW_SECONDS,
    (req) => req.sdk?.keyHash,
  );

  const loginBackoff = asyncHandler(async (req, res, next) => {
    if (!cache || typeof cache.pttl !== 'function') {
      return next();
    }
    const email = req.valid?.body?.email;
    if (!email) {
      return next();
    }
    const scope = `${email}|${clientIp(req)}`;
    try {
      const ttlMs = Number(await cache.pttl(rateLimitKey.authBackoff(scope)));
      if (ttlMs > 0) {
        throw rateLimited(Math.ceil(ttlMs / 1000));
      }
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      logger.warn({ msg: 'rate_limit_failed', err: serializeError(err) });
    }
    return next();
  });

  /**
   * Delay doubles with each failed login for this email, up to a cap, and the
   * counter expires after a quiet period. There is no permanent lockout.
   *
   * @param {string} email
   */
  async function recordLoginFailure(email, ip) {
    const scope = ip ? `${email}|${ip}` : email;
    if (!cache || typeof cache.eval !== 'function') {
      return;
    }
    try {
      const failsKey = rateLimitKey.authFails(scope);
      const n = Number(
        await cache.eval(INCR_EXPIRE_SCRIPT, 1, failsKey, String(env.AUTH_BACKOFF_QUIET_SECONDS * 1000)),
      );
      const shift = Math.min(Math.max(n, 1) - 1, 30);
      const delay = Math.min(env.AUTH_BACKOFF_BASE_MS * 2 ** shift, env.AUTH_BACKOFF_CAP_MS);
      await cache.set(rateLimitKey.authBackoff(scope), '1', 'PX', delay);
    } catch (err) {
      logger.warn({ msg: 'rate_limit_failed', err: serializeError(err) });
    }
  }

  /**
   * @param {string} email
   */
  async function clearLoginFailures(email, ip) {
    const scope = ip ? `${email}|${ip}` : email;
    if (!cache || typeof cache.del !== 'function') {
      return;
    }
    try {
      await cache.del(rateLimitKey.authFails(scope));
      await cache.del(rateLimitKey.authBackoff(scope));
    } catch (err) {
      logger.warn({ msg: 'rate_limit_failed', err: serializeError(err) });
    }
  }

  /**
   * Extra body-size cap for POST /sdk/v1/events (batch size is a separate schema cap).
   */
  const sdkEventsBody = (req, res, next) => {
    const size = Buffer.byteLength(JSON.stringify(req.body ?? {}), 'utf8');
    if (size > env.SDK_EVENTS_MAX_BYTES) {
      return next(new AppError(413, 'payload_too_large', 'Request body is too large.'));
    }
    return next();
  };

  return {
    publicIp,
    authIp,
    authEmail,
    dashboardUser,
    sdkIp,
    sdkKey,
    loginBackoff,
    recordLoginFailure,
    clearLoginFailures,
    clientIp,
    sdkEventsBody,
  };
}
