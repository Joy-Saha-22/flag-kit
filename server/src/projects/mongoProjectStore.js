import mongoose from 'mongoose';
import { Environment } from '../models/Environment.js';
import { Project } from '../models/Project.js';

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const DEFAULT_ENVIRONMENTS = [
  { key: 'dev', name: 'Development' },
  { key: 'staging', name: 'Staging' },
  { key: 'prod', name: 'Production' },
];
const ENV_ORDER = { dev: 0, staging: 1, prod: 2 };

const roleOf = (doc, userId) =>
  doc.members.find((member) => String(member.userId) === String(userId))?.role ?? null;

const publicKey = (key) => ({
  id: String(key._id),
  prefix: key.prefix,
  type: key.type,
  createdAt: key.createdAt,
  revokedAt: key.revokedAt ?? null,
});

/**
 * MongoDB-backed project, environment, and SDK key store.
 * Routes depend on this interface, not on Mongoose, so tests use an in-memory copy.
 */
export const mongoProjectStore = {
  async listForUser(userId) {
    if (!OBJECT_ID.test(userId)) {
      return [];
    }
    const docs = await Project.find({ 'members.userId': userId })
      .select('name key members createdAt')
      .sort({ createdAt: -1 })
      .lean();
    return docs.map((doc) => ({
      id: String(doc._id),
      name: doc.name,
      key: doc.key,
      role: roleOf(doc, userId),
      createdAt: doc.createdAt,
    }));
  },

  async findForMember({ projectId, userId }) {
    if (!OBJECT_ID.test(projectId) || !OBJECT_ID.test(userId)) {
      return null;
    }
    const doc = await Project.findOne({ _id: projectId, 'members.userId': userId })
      .select('name key members')
      .lean();
    if (!doc) {
      return null;
    }
    return { id: String(doc._id), name: doc.name, key: doc.key, role: roleOf(doc, userId) };
  },

  async createWithEnvironments({ name, key, ownerId }) {
    const project = await Project.create({ name, key, members: [{ userId: ownerId, role: 'admin' }] });
    try {
      const now = new Date();
      // Inserted with the raw driver on purpose: environments start with NO sdkKeys field.
      // A unique index on an array field can treat every empty array as the same key,
      // which would make the second project's environments fail to insert.
      const docs = DEFAULT_ENVIRONMENTS.map((env) => ({
        projectId: project._id,
        key: env.key,
        name: env.name,
        createdAt: now,
      }));
      await Environment.collection.insertMany(docs);
      return {
        project: { id: String(project._id), name: project.name, key: project.key },
        environments: docs.map((doc) => ({ id: String(doc._id), key: doc.key, name: doc.name })),
      };
    } catch (err) {
      await Environment.deleteMany({ projectId: project._id }).catch(() => {});
      await Project.deleteOne({ _id: project._id }).catch(() => {});
      throw err;
    }
  },

  async listEnvironments(projectId) {
    const docs = await Environment.find({ projectId }).select('key name').lean();
    return docs
      .map((doc) => ({ id: String(doc._id), key: doc.key, name: doc.name }))
      .sort((a, b) => (ENV_ORDER[a.key] ?? 99) - (ENV_ORDER[b.key] ?? 99) || a.key.localeCompare(b.key));
  },

  /** @returns {Promise<Array | null>} null when the environment does not exist */
  async listSdkKeys({ projectId, envKey }) {
    const env = await Environment.findOne({ projectId, key: envKey }).select('sdkKeys').lean();
    return env ? (env.sdkKeys ?? []).map(publicKey) : null;
  },

  /** @returns {Promise<{ status: 'ok', key: object } | { status: 'env_not_found' } | { status: 'limit_reached' }>} */
  async addSdkKey({ projectId, envKey, key, maxKeys }) {
    const keyId = new mongoose.Types.ObjectId();
    // 'sdkKeys.<maxKeys - 1>' not existing means there are fewer than maxKeys keys.
    const result = await Environment.updateOne(
      { projectId, key: envKey, [`sdkKeys.${maxKeys - 1}`]: { $exists: false } },
      { $push: { sdkKeys: { _id: keyId, ...key } } },
    );
    if (result.matchedCount === 1) {
      return { status: 'ok', key: publicKey({ _id: keyId, ...key }) };
    }
    const exists = await Environment.exists({ projectId, key: envKey });
    return { status: exists ? 'limit_reached' : 'env_not_found' };
  },

  /** @returns {Promise<{ status: 'not_found' } | { status: 'ok', keyHash: string, prefix: string, type: string, alreadyRevoked: boolean }>} */
  async revokeSdkKey({ projectId, envKey, keyId }) {
    const env = await Environment.findOne({ projectId, key: envKey }).select('sdkKeys').lean();
    const key = (env?.sdkKeys ?? []).find((candidate) => String(candidate._id) === keyId);
    if (!env || !key) {
      return { status: 'not_found' };
    }
    const alreadyRevoked = Boolean(key.revokedAt);
    if (!alreadyRevoked) {
      await Environment.updateOne(
        { _id: env._id, 'sdkKeys._id': keyId },
        { $set: { 'sdkKeys.$.revokedAt': new Date() } },
      );
    }
    return { status: 'ok', keyHash: key.keyHash, prefix: key.prefix, type: key.type, alreadyRevoked };
  },
};
