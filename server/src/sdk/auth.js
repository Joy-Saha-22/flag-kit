import { AppError, asyncHandler, serializeError } from '../errors.js';
import { sha256Hex } from '../lib/sdkKeys.js';

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
 * SDK key authentication always checks the source of truth so a stale cache
 * entry cannot authorize a revoked key.
 *
 * @param {{ sdkStore: any, logger: any }} deps
 */
export function createSdkAuth({ sdkStore, logger }) {
  /**
   * @param {string} keyHash
   * @returns {Promise<{ envId: string, projectId: string, envKey: string, type: string, keyHash: string } | null>}
   */
  async function lookup(keyHash) {
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
