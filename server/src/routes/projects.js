import { Router } from 'express';
import { AppError, asyncHandler } from '../errors.js';
import { validate } from '../middleware/validate.js';
import { createProjectSchema } from '../projects/schemas.js';

/**
 * Project list and creation. Everything under /api/projects/:pid lives in the
 * project scope set up in app.js.
 *
 * @param {{ env: any, projectStore: any, auditStore: any, requireAuth: Function, dashboardLimit?: Function }} deps
 */
export function createProjectsRouter({ env, projectStore, auditStore, requireAuth, dashboardLimit = (req, res, next) => next() }) {
  const router = Router();

  router.get(
    '/',
    requireAuth,
    validate({}),
    dashboardLimit,
    asyncHandler(async (req, res) => {
      const projects = await projectStore.listForUser(req.user.id);
      res.json({ projects });
    }),
  );

  router.post(
    '/',
    requireAuth,
    dashboardLimit,
    validate({ body: createProjectSchema }),
    asyncHandler(async (req, res) => {
      const { name, key } = req.valid.body;
      const existing = await projectStore.listForUser(req.user.id);
      if (existing.length >= env.MAX_PROJECTS_PER_USER) {
        throw new AppError(403, 'limit_reached', 'Project limit reached.');
      }
      // A duplicate key raises Mongo error 11000, which the error handler maps to 409.
      const { project, environments } = await projectStore.createWithEnvironments({
        name,
        key,
        ownerId: req.user.id,
      });
      await auditStore.record({
        projectId: project.id,
        actorId: req.user.id,
        action: 'project.create',
        after: { name, key },
      });
      res.status(201).json({ project: { ...project, role: 'admin' }, environments });
    }),
  );

  return router;
}
