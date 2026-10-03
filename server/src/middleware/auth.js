import { AppError, asyncHandler } from '../errors.js';
import { SESSION_COOKIE } from '../auth/cookies.js';
import { verifySessionToken } from '../auth/tokens.js';

const unauthorized = () => new AppError(401, 'unauthorized', 'Authentication required.');

/**
 * Authenticate from the httpOnly session cookie and load the user.
 * Sets req.user = { id, email, name }.
 *
 * @param {{ env: { JWT_SECRET: string }, userStore: { findById: (id: string) => Promise<any> } }} deps
 */
export function createRequireAuth({ env, userStore }) {
  return asyncHandler(async (req, res, next) => {
    const token = req.cookies?.[SESSION_COOKIE];
    // cookie-parser turns values starting with "j:" into objects, so check the type.
    if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
      throw unauthorized();
    }
    const claims = verifySessionToken(token, { secret: env.JWT_SECRET });
    if (!claims) {
      throw unauthorized();
    }
    const user = await userStore.findById(claims.userId);
    if (!user) {
      throw unauthorized();
    }
    req.user = { id: user.id, email: user.email, name: user.name };
    next();
  });
}

const ROLE_RANK = { viewer: 1, editor: 2, admin: 3 };

/**
 * Require at least the given project role. The role comes from req.projectRole,
 * which the project-membership middleware (added with the project routes) sets.
 * If it is not set, access is denied.
 *
 * @param {'viewer' | 'editor' | 'admin'} minRole
 */
export function requireRole(minRole) {
  if (!Object.hasOwn(ROLE_RANK, minRole)) {
    throw new Error(`Unknown role: ${minRole}`);
  }
  return (req, res, next) => {
    const role = req.projectRole;
    if (typeof role !== 'string' || !Object.hasOwn(ROLE_RANK, role) || ROLE_RANK[role] < ROLE_RANK[minRole]) {
      return next(new AppError(403, 'forbidden', 'You do not have permission to do that.'));
    }
    return next();
  };
}
