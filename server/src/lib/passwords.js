import bcrypt from 'bcryptjs';

const DEFAULT_COST = 12;

/**
 * @param {string} password
 * @param {number} [cost] bcrypt cost factor; the API passes env.BCRYPT_COST
 * @returns {Promise<string>}
 */
export async function hashPassword(password, cost = DEFAULT_COST) {
  return bcrypt.hash(password, cost);
}

/**
 * @param {string} password
 * @param {string} passwordHash
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}
