import { Environment } from '../models/Environment.js';
import { Event } from '../models/Event.js';

/**
 * MongoDB-backed lookups for the SDK API. Routes depend on this interface,
 * so tests use an in-memory copy.
 */
export const mongoSdkStore = {
  /**
   * @param {string} keyHash SHA-256 hex of the SDK key
   * @returns {Promise<{ envId: string, projectId: string, envKey: string, type: string, revokedAt: Date | null } | null>}
   */
  async findEnvironmentByKeyHash(keyHash) {
    if (!/^[a-f0-9]{64}$/.test(keyHash)) {
      return null;
    }
    const env = await Environment.findOne({ 'sdkKeys.keyHash': keyHash }).select('projectId key sdkKeys').lean();
    if (!env) {
      return null;
    }
    const key = (env.sdkKeys ?? []).find((candidate) => candidate.keyHash === keyHash);
    if (!key) {
      return null;
    }
    return {
      envId: String(env._id),
      projectId: String(env.projectId),
      envKey: env.key,
      type: key.type,
      revokedAt: key.revokedAt ?? null,
    };
  },

  /** @param {Array<object>} docs */
  async insertEvents(docs) {
    await Event.insertMany(docs, { ordered: false });
  },
};
