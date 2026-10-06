import mongoose from 'mongoose';
import { Environment } from '../models/Environment.js';
import { Flag } from '../models/Flag.js';

// Flags are read and written with the raw driver (Flag.collection) on purpose.
// Per-environment configs live in a Map, and Mongoose's Map casting is awkward
// for dotted-path updates. Input has already been validated by zod, and the
// unique (projectId, key) index still applies.

const oid = (id) => new mongoose.Types.ObjectId(id);
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const envPath = (envKey) => `environments.${envKey}`;
const flags = () => Flag.collection;

/**
 * MongoDB-backed flag store. Routes depend on this interface, so tests use an
 * in-memory copy.
 */
export const mongoFlagStore = {
  async list({ projectId, search, tag, limit }) {
    const filter = { projectId: oid(projectId) };
    if (tag) {
      filter.tags = tag;
    }
    if (search) {
      const pattern = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ key: pattern }, { name: pattern }];
    }
    return flags().find(filter).sort({ key: 1 }).limit(limit).toArray();
  },

  async count({ projectId }) {
    return flags().countDocuments({ projectId: oid(projectId) });
  },

  async get({ projectId, key }) {
    return flags().findOne({ projectId: oid(projectId), key });
  },

  /** A duplicate (projectId, key) raises Mongo error 11000, which the error handler maps to 409. */
  async create({ projectId, flag }) {
    const now = new Date();
    const doc = { _id: new mongoose.Types.ObjectId(), projectId: oid(projectId), ...flag, createdAt: now, updatedAt: now };
    await flags().insertOne(doc);
    return doc;
  },

  async update({ projectId, key, patch }) {
    const filter = { projectId: oid(projectId), key };
    const result = await flags().updateOne(filter, { $set: { ...patch, updatedAt: new Date() } });
    return result.matchedCount === 0 ? null : flags().findOne(filter);
  },

  async delete({ projectId, key }) {
    const doc = await flags().findOne({ projectId: oid(projectId), key });
    if (!doc) {
      return null;
    }
    await flags().deleteOne({ _id: doc._id });
    return doc;
  },

  /**
   * Replace one environment's config. Only succeeds if the stored version still
   * equals currentVersion, so two editors cannot silently overwrite each other.
   * @returns {Promise<{ status: 'ok', config: object } | { status: 'version_conflict' } | { status: 'not_found' }>}
   */
  async setEnvironmentConfig({ projectId, key, envKey, config, currentVersion }) {
    const path = envPath(envKey);
    const newConfig = { ...config, version: (currentVersion ?? 0) + 1 };
    const filter = { projectId: oid(projectId), key };
    if (currentVersion === undefined) {
      filter[path] = { $exists: false };
    } else {
      filter[`${path}.version`] = currentVersion;
    }
    const result = await flags().updateOne(filter, { $set: { [path]: newConfig, updatedAt: new Date() } });
    if (result.matchedCount === 1) {
      return { status: 'ok', config: newConfig };
    }
    const exists = await flags().findOne({ projectId: oid(projectId), key }, { projection: { _id: 1 } });
    return { status: exists ? 'version_conflict' : 'not_found' };
  },

  /** Every flag that has a config for this environment. */
  async listEnvironmentFlags({ projectId, envKey }) {
    return flags()
      .find({ projectId: oid(projectId), [envPath(envKey)]: { $exists: true } })
      .toArray();
  },

  /** Current ruleset version without changing it (0 if the environment was never synced). */
  async getRulesetVersion(envId) {
    const doc = await Environment.findById(envId).select('rulesetVersion').lean();
    return doc?.rulesetVersion ?? 0;
  },

  /** Atomically bump and return the environment's ruleset version. */
  async nextRulesetVersion(envId) {
    const doc = await Environment.findOneAndUpdate(
      { _id: envId },
      { $inc: { rulesetVersion: 1 } },
      { new: true, projection: { rulesetVersion: 1 } },
    ).lean();
    if (!doc) {
      throw new Error('Environment not found while bumping ruleset version');
    }
    return doc.rulesetVersion;
  },
};
