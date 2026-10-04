import { AuditLog } from '../models/AuditLog.js';
import { User } from '../models/User.js';

/**
 * Append-only audit log. Never pass raw SDK keys or key hashes as before/after.
 */
export const mongoAuditStore = {
  /**
   * @param {{ projectId: string, actorId: string, action: string, flagKey?: string | null, envKey?: string | null, before?: unknown, after?: unknown }} entry
   */
  async record({ projectId, actorId, action, flagKey = null, envKey = null, before = null, after = null }) {
    await AuditLog.create({ projectId, actorId, action, flagKey, envKey, before, after });
  },

  /**
   * Newest first. `before` is an ISO timestamp used as a cursor.
   * @param {{ projectId: string, flagKey?: string, envKey?: string, before?: string, limit: number }} query
   */
  async list({ projectId, flagKey, envKey, before, limit }) {
    const filter = { projectId };
    if (flagKey) {
      filter.flagKey = flagKey;
    }
    if (envKey) {
      filter.envKey = envKey;
    }
    if (before) {
      filter.ts = { $lt: new Date(before) };
    }
    const docs = await AuditLog.find(filter).sort({ ts: -1 }).limit(limit).lean();
    const actorIds = [...new Set(docs.map((doc) => String(doc.actorId)))];
    const users = await User.find({ _id: { $in: actorIds } }).select('name email').lean();
    const byId = new Map(users.map((user) => [String(user._id), user]));
    return docs.map((doc) => {
      const actor = byId.get(String(doc.actorId));
      return {
        id: String(doc._id),
        action: doc.action,
        flagKey: doc.flagKey,
        envKey: doc.envKey,
        before: doc.before,
        after: doc.after,
        ts: doc.ts,
        actor: { id: String(doc.actorId), name: actor?.name ?? null, email: actor?.email ?? null },
      };
    });
  },
};
