import { AuditLog } from '../models/AuditLog.js';

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
};
