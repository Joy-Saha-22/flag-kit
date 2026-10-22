export const CONFLICT_MESSAGE = 'The request conflicts with existing data.';

/**
 * An error that is safe to show to the client: status, a stable code, and a
 * message written for end users. Anything that is NOT an AppError is treated
 * as internal and never has its message sent to the client.
 */
export class AppError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {string} code stable machine-readable code
   * @param {string} message safe public message
   * @param {unknown} [details] safe extra data (for example validation issues)
   * @param {number} [retryAfterSeconds] set Retry-After on 429 responses
   */
  constructor(status, code, message, details, retryAfterSeconds) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.publicMessage = message;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Wrap an async route handler so rejected promises reach the error handler.
 *
 * @param {(req: any, res: any, next: any) => Promise<unknown> | unknown} fn
 * @returns {(req: any, res: any, next: any) => void}
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const URI_PATTERN = /\b(?:mongodb(?:\+srv)?|rediss?):\/\/[^\s'"]+/gi;
const SDK_KEY_PATTERN = /\bfk_(?:server|client)_[A-Za-z0-9_-]{43}\b/g;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const AUTHORIZATION_PATTERN = /\bAuthorization\s*:\s*(?:Bearer\s+)?[^\s,;]+/gi;
const COOKIE_PATTERN = /\b(?:Cookie|Set-Cookie)\s*:\s*[^\r\n]+/gi;
const SESSION_COOKIE_PATTERN = /\bfk_session=[^;\s,]+/gi;
const PASSWORD_PATTERN = /\b(?:password|passwd|pwd)\s*[:=]\s*[^\s,;]+/gi;

/**
 * Remove connection strings from text before it is logged.
 *
 * @param {unknown} text
 * @returns {unknown}
 */
export function redact(text) {
  if (typeof text !== 'string') {
    return text;
  }
  return text
    .replace(URI_PATTERN, '[redacted-uri]')
    .replace(SDK_KEY_PATTERN, '[redacted-sdk-key]')
    .replace(JWT_PATTERN, '[redacted-jwt]')
    .replace(AUTHORIZATION_PATTERN, 'Authorization: [redacted]')
    .replace(COOKIE_PATTERN, 'Cookie: [redacted]')
    .replace(SESSION_COOKIE_PATTERN, 'fk_session=[redacted]')
    .replace(PASSWORD_PATTERN, 'password=[redacted]');
}

/**
 * @param {unknown} err
 * @returns {{ name?: string, message: unknown, code?: unknown, stack?: unknown }}
 */
export function serializeError(err) {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: redact(err.message),
      code: /** @type {any} */ (err).code,
      stack: redact(err.stack),
    };
  }
  return { message: redact(String(err)) };
}

/**
 * Map any thrown value to a response that is safe to send.
 *
 * @param {any} err
 * @returns {{ status: number, code: string, message: string, details?: unknown }}
 */
function mongoCode(err) {
  return err?.code ?? err?.cause?.code;
}

function toPublic(err) {
  if (err instanceof AppError) {
    return {
      status: err.status,
      code: err.code,
      message: err.publicMessage,
      details: err.details,
      retryAfterSeconds: err.retryAfterSeconds,
    };
  }
  if (err?.type === 'entity.parse.failed') {
    return { status: 400, code: 'invalid_json', message: 'Request body is not valid JSON.' };
  }
  if (err?.type === 'entity.too.large') {
    return { status: 413, code: 'payload_too_large', message: 'Request body is too large.' };
  }
  if (err?.name === 'ValidationError' || err?.name === 'CastError') {
    return { status: 400, code: 'invalid_request', message: 'The request could not be processed.' };
  }
  // Duplicate key from MongoDB / Mongoose (including wrapped BulkWriteError).
  if (mongoCode(err) === 11000) {
    return { status: 409, code: 'conflict', message: CONFLICT_MESSAGE };
  }
  return { status: 500, code: 'internal_error', message: 'Something went wrong.' };
}

/**
 * Central error handler. Clients get a generic message and a request ID.
 * Full details (with connection strings redacted) are logged server-side.
 *
 * @param {{ warn: Function, error: Function }} logger
 */
export function createErrorHandler(logger) {
  // Express recognises error handlers by their four parameters.
  // eslint-disable-next-line no-unused-vars
  return function errorHandler(err, req, res, next) {
    if (res.headersSent) {
      return next(err);
    }
    const publicError = toPublic(err);
    const level = publicError.status >= 500 ? 'error' : 'warn';
    logger[level]({
      msg: 'request_failed',
      requestId: req.id,
      method: req.method,
      path: req.path,
      status: publicError.status,
      err: serializeError(err),
    });

    const body = {
      code: publicError.code,
      message: publicError.message,
      requestId: req.id,
    };
    if (publicError.details !== undefined) {
      body.details = publicError.details;
    }
    if (publicError.retryAfterSeconds) {
      res.set('Retry-After', String(publicError.retryAfterSeconds));
    }
    return res.status(publicError.status).json({ error: body });
  };
}
