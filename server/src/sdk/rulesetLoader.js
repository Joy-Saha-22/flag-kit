import { serializeError } from '../errors.js';
import { rulesetKey } from '../lib/redisKeys.js';
import { COMPARE_AND_SET_SCRIPT } from '../flags/rulesetSync.js';
import { buildRuleset } from '../flags/ruleset.js';

/**
 * Returns an environment's ruleset as a JSON string: from Redis when cached,
 * otherwise rebuilt from MongoDB (the source of truth) and cached again.
 *
 * @param {{ cache: any, flagStore: any, logger: any, ttlSeconds: number }} deps
 */
export function createRulesetLoader({ cache, flagStore, logger, ttlSeconds }) {
  /** @type {Map<string, Promise<string>>} */
  const inflight = new Map();

  async function rebuild({ envId, projectId, envKey }) {
    // Read the version BEFORE the flags: a flag change is saved before its version is bumped,
    // so flags read after the version are at least as new as that version.
    const version = await flagStore.getRulesetVersion(envId);
    const flags = await flagStore.listEnvironmentFlags({ projectId, envKey });
    const json = JSON.stringify(buildRuleset({ version, envKey, flags }));
    try {
      await cache.eval(COMPARE_AND_SET_SCRIPT, 1, rulesetKey(envId), json, String(version), String(ttlSeconds));
    } catch (err) {
      logger.warn({ msg: 'ruleset_cache_write_failed', envId, err: serializeError(err) });
    }
    return json;
  }

  return async function loadRuleset(sdk) {
    try {
      const cached = await cache.get(rulesetKey(sdk.envId));
      if (cached) {
        return cached;
      }
    } catch (err) {
      logger.warn({ msg: 'ruleset_cache_read_failed', envId: sdk.envId, err: serializeError(err) });
    }
    // Many SDKs asking at once after a cache miss share one rebuild.
    let pending = inflight.get(sdk.envId);
    if (!pending) {
      pending = rebuild(sdk).finally(() => inflight.delete(sdk.envId));
      inflight.set(sdk.envId, pending);
    }
    return pending;
  };
}
