import { createHash } from 'node:crypto';

/** Seconds a hashed SDK key may live in Redis before re-checking MongoDB. */
export const SDK_KEY_CACHE_TTL_SECONDS = 60;

function hashRateLimitIdentifier(identifier) {
  return createHash('sha256').update(identifier).digest('hex');
}

/**
 * Full flag ruleset JSON for an environment, including a version number.
 *
 * @param {string} envId MongoDB Environment `_id`
 * @returns {string}
 */
export function rulesetKey(envId) {
  return `ruleset:${envId}`;
}

/**
 * Maps SHA-256(SDK key) -> environment id.
 *
 * @param {string} keyHash
 * @returns {string}
 */
export function sdkKeyCacheKey(keyHash) {
  return `sdkkey:${keyHash}`;
}

/**
 * Pub/sub channel for ruleset change notifications.
 *
 * @param {string} envId
 * @returns {string}
 */
export function flagUpdatesChannel(envId) {
  return `flag-updates:${envId}`;
}

export const rateLimitKey = {
  authIp: (ip) => `ratelimit:auth:ip:${ip}`,
  authEmail: (email) => `ratelimit:auth:email:${hashRateLimitIdentifier(email)}`,
  authFails: (scope) => `ratelimit:auth:fails:${hashRateLimitIdentifier(scope)}`,
  authBackoff: (scope) => `ratelimit:auth:backoff:${hashRateLimitIdentifier(scope)}`,
  publicIp: (ip) => `ratelimit:public:ip:${ip}`,
  dashboardUser: (userId) => `ratelimit:dash:user:${userId}`,
  sdkKey: (keyHash) => `ratelimit:sdk:key:${keyHash}`,
  sdkIp: (ip) => `ratelimit:sdk:ip:${ip}`,
};
