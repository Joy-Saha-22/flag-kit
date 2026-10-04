import { Router } from 'express';
import { asyncHandler } from '../errors.js';
import { requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

/**
 * Project audit log, newest first. Editors and admins only.
 * @param {{ auditStore: any, schemas: any }} deps
 */
export function createAuditRouter({ auditStore, schemas }) {
  const router = Router();

  router.get(
    '/',
    requireRole('editor'),
    validate({ query: schemas.auditQuery }),
    asyncHandler(async (req, res) => {
      const { flag, env, before, limit } = req.valid.query;
      const entries = await auditStore.list({
        projectId: req.project.id,
        flagKey: flag,
        envKey: env,
        before,
        limit,
      });
      res.json({ entries, nextBefore: entries.length === limit ? entries.at(-1).ts : null });
    }),
  );

  return router;
}
