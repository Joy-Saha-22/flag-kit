import { AppError } from '../errors.js';

export const CSRF_HEADER = 'X-Requested-By';
export const CSRF_VALUE = 'flagkit-dashboard';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated routes. A browser will not add a
 * custom header to a cross-site request unless CORS allows it, and the CORS
 * allowlist only allows our own dashboard origin.
 */
export function requireCustomHeader(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }
  if (req.get(CSRF_HEADER) !== CSRF_VALUE) {
    return next(new AppError(403, 'csrf_header_missing', 'Missing or invalid X-Requested-By header.'));
  }
  return next();
}
