import { AppError, asyncHandler } from '../errors.js';
import { projectParamsSchema } from '../projects/schemas.js';

/**
 * Load the project named by :pid and check the signed-in user is a member.
 * Sets req.project = { id, name, key } and req.projectRole.
 *
 * Non-members, unknown projects, and malformed IDs all get the same 404, so
 * project IDs cannot be probed.
 *
 * @param {{ projectStore: { findForMember: (args: { projectId: string, userId: string }) => Promise<any> } }} deps
 */
export function createLoadProject({ projectStore }) {
  return asyncHandler(async (req, res, next) => {
    const parsedParams = projectParamsSchema.safeParse(req.params);
    if (!parsedParams.success) {
      throw new AppError(404, 'not_found', 'Not found.');
    }
    const project = await projectStore.findForMember({
      projectId: parsedParams.data.pid,
      userId: req.user.id,
    });
    if (!project) {
      throw new AppError(404, 'not_found', 'Not found.');
    }
    req.project = { id: project.id, name: project.name, key: project.key };
    req.projectRole = project.role;
    next();
  });
}
