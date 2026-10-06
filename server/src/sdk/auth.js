import { AppError, asyncHandler, serializeError } from '../errors.js';
import { sha256Hex } from '../lib/sdkKeys.js';
import { SDK_KEY_CACHE_TTL_SECONDS, sdkKeyCacheKey } from '../lib/redisKeys.js';

// "fk_server_" or "fk_client_" plus 43 base64url characters (32 random bytes).
const KEY_FORMAT = /^fk_(server|client)_[A-Za-z0-9_-]{43}$/;

// One message for every failure, so a caller cannot tell a revoked key from a made-up one.
const unauthorized = () => new AppError(401, 'unauthorized', 'Invalid or missing SDK key.');

/** The key comes from the Authorization header, with or without a "Bearer " prefix. Never from the URL. */
function extractKey(req) {
  const header = req.get('authorization');
  if (!header) {
    return null;
  }
  return header.replace(/^Bearer\s+/i, '').trim();
}

/**
 * SDK key authentication. Active keys are cached in Redis for a short time;
 * revoking a key deletes its cache entry, so revocation is immediate.
 *
 * @param {{ sdkStore: any, cache: any, logger: any, ttlSeconds?: number }} deps
 */
export function createSdkAuth({ sdkStore, cache, logger, ttlSeconds = SDK_KEY_CACHE_TTL_SECONDS }) {
  /**
   * @param {string} keyHash
   * @returns {Promise<{ envId: string, projectId: string, envKey: string, type: string, keyHash: string } | null>}
   */
  async function lookup(keyHash) {
    const cacheKey = sdkKeyCacheKey(keyHash);
    try {
      const cached = await cache.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      // Redis trouble must not lock customers out: fall back to MongoDB.
      logger.warn({ msg: 'sdk_key_cache_read_failed', err: serializeError(err) });
    }

    const found = await sdkStore.findEnvironmentByKeyHash(keyHash);
    if (!found || found.revokedAt) {
      return null;
    }
    const record = {
      envId: found.envId,
      projectId: found.projectId,
      envKey: found.envKey,
      type: found.type,
      keyHash,
    };
    try {
      // Only active keys are ever cached.
      await cache.set(cacheKey, JSON.stringify(record), 'EX', ttlSeconds);
    } catch (err) {
      logger.warn({ msg: 'sdk_key_cache_write_failed', err: serializeError(err) });
    }
    return record;
  }

  const middleware = asyncHandler(async (req, res, next) => {
    const raw = extractKey(req);
    if (!raw || !KEY_FORMAT.test(raw)) {
      throw unauthorized();
    }
    const record = await lookup(sha256Hex(raw));
    if (!record) {
      throw unauthorized();
    }
    req.sdk = record;
    next();
  });

  return {
    middleware,
    /** Used by open streams to notice a revoked key. */
    isActive: async (keyHash) => Boolean(await lookup(keyHash)),
  };
}
