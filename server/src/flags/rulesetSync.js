import { serializeError } from '../errors.js';
import { flagUpdatesChannel, rulesetKey } from '../lib/redisKeys.js';
import { buildRuleset } from './ruleset.js';

/**
 * Write the ruleset only if it is newer than what Redis already holds, so two
 * overlapping changes can never leave an older ruleset on top of a newer one.
 * Returns 1 when written, 0 when a newer version was already there.
 */
export const COMPARE_AND_SET_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current then
  local ok, decoded = pcall(cjson.decode, current)
  if ok and type(decoded) == 'table' and tonumber(decoded.version) and tonumber(decoded.version) >= tonumber(ARGV[2]) then
    return 0
  end
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[3]))
return 1
`;

/**
 * Rebuild one environment's ruleset, cache it in Redis, and tell connected
 * SDK streams. MongoDB is the source of truth: if Redis fails, the change is
 * already saved and this returns 'delayed' (the cached ruleset expires on its
 * own and is rebuilt from MongoDB).
 *
 * @param {{ flagStore: any, cache: any, publisher: any, logger: any, ttlSeconds: number }} deps
 */
export function createRulesetSync({ flagStore, cache, publisher, logger, ttlSeconds }) {
  /**
   * @param {{ projectId: string, env: { id: string, key: string }, flagKey: string, requestId?: string }} args
   * @returns {Promise<'ok' | 'delayed'>}
   */
  return async function syncEnvironment({ projectId, env, flagKey, requestId }) {
    const version = await flagStore.nextRulesetVersion(env.id);
    try {
      const flags = await flagStore.listEnvironmentFlags({ projectId, envKey: env.key });
      const ruleset = buildRuleset({ version, envKey: env.key, flags });
      const written = await cache.eval(
        COMPARE_AND_SET_SCRIPT,
        1,
        rulesetKey(env.id),
        JSON.stringify(ruleset),
        String(version),
        String(ttlSeconds),
      );
      if (Number(written) === 1) {
        const entry = ruleset.flags.find((flag) => flag.key === flagKey) ?? null;
        await publisher.publish(
          flagUpdatesChannel(env.id),
          JSON.stringify({ version, flagKey, flag: entry }),
        );
      }
      return 'ok';
    } catch (err) {
      logger.error({
        msg: 'ruleset_sync_failed',
        requestId,
        envId: env.id,
        flagKey,
        err: serializeError(err),
      });
      return 'delayed';
    }
  };
}
