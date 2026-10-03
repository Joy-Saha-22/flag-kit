import jwt from 'jsonwebtoken';

const ALGORITHM = 'HS256';
const ISSUER = 'flagkit';

/**
 * @param {string} userId
 * @param {{ secret: string, ttlSeconds: number }} options
 * @returns {string}
 */
export function signSessionToken(userId, { secret, ttlSeconds }) {
  return jwt.sign({}, secret, {
    algorithm: ALGORITHM,
    subject: String(userId),
    issuer: ISSUER,
    expiresIn: ttlSeconds,
  });
}

/**
 * Returns the user ID, or null for anything invalid, expired, or forged.
 * The algorithm is pinned so tokens using "none" or another algorithm fail.
 *
 * @param {string} token
 * @param {{ secret: string }} options
 * @returns {{ userId: string } | null}
 */
export function verifySessionToken(token, { secret }) {
  try {
    const payload = jwt.verify(token, secret, { algorithms: [ALGORITHM], issuer: ISSUER });
    if (typeof payload === 'object' && payload !== null && typeof payload.sub === 'string') {
      return { userId: payload.sub };
    }
    return null;
  } catch {
    return null;
  }
}
