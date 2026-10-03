import { randomUUID } from 'node:crypto';

/**
 * Give every request a fresh ID (never trusted from the client), expose it as
 * a response header, and include it in logs and error bodies.
 */
export function requestId(req, res, next) {
  req.id = randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}
