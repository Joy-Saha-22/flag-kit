import { AppError } from '../errors.js';

/**
 * Validate body, query, and path params against strict zod schemas.
 * Anything that does not match is rejected with a 400 (no sanitizing).
 * Parsed values are placed on req.valid.{body,query,params}. Handlers must
 * read from req.valid, not from the raw request.
 *
 * @param {{ body?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny }} schemas
 */
export function validate(schemas) {
  return (req, res, next) => {
    const valid = {};
    const issues = [];

    for (const part of /** @type {const} */ (['body', 'query', 'params'])) {
      const schema = schemas[part];
      if (!schema) {
        continue;
      }
      const input = part === 'body' ? (req.body ?? {}) : req[part];
      const result = schema.safeParse(input);
      if (result.success) {
        valid[part] = result.data;
      } else {
        for (const issue of result.error.issues) {
          issues.push({ in: part, path: issue.path.join('.'), message: issue.message });
        }
      }
    }

    if (issues.length > 0) {
      return next(new AppError(400, 'validation_failed', 'Request validation failed.', issues));
    }
    req.valid = valid;
    return next();
  };
}
