import mongoose from 'mongoose';
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

  /**
   * Per-variation counts for an experiment.
   * exposures: distinct users with an exposure event for the variation.
   * conversions: distinct users with an exposure AND a conversion for the goal metric, same variation.
   * @returns {Promise<Array<{ variation: string, exposures: number, conversions: number }>>}
   */
  async variationCounts({ projectId, envKey, flagKey, goalMetricKey }) {
    const rows = await Event.aggregate(
      [
        { $match: { projectId: new mongoose.Types.ObjectId(projectId), envKey, flagKey } },
        {
          $group: {
            _id: { variation: '$variation', userKey: '$userKey' },
            exposed: { $max: { $cond: [{ $eq: ['$type', 'exposure'] }, 1, 0] } },
            converted: {
              $max: {
                $cond: [
                  { $and: [{ $eq: ['$type', 'conversion'] }, { $eq: ['$metricKey', { $literal: goalMetricKey }] }] },
                  1,
                  0,
                ],
              },
            },
          },
        },
        {
          $group: {
            _id: '$_id.variation',
            exposures: { $sum: '$exposed' },
            conversions: {
              $sum: { $cond: [{ $and: [{ $eq: ['$exposed', 1] }, { $eq: ['$converted', 1] }] }, 1, 0] },
            },
          },
        },
      ],
      { allowDiskUse: true },
    );
    return rows.map((row) => ({ variation: row._id, exposures: row.exposures, conversions: row.conversions }));
  },
};
