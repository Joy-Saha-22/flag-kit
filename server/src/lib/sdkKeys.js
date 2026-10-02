import { createHash, randomBytes } from 'node:crypto';

/**
 * @typedef {'server' | 'client'} SdkKeyType
 *
 * @typedef {Object} SdkKeyMaterial
 * @property {string} raw plaintext key; return to the caller once and never persist
 * @property {string} keyHash SHA-256 hex digest of `raw`
 * @property {string} prefix first 16 characters for dashboard display
 * @property {SdkKeyType} type
 */

/**
 * @param {string} value
 * @returns {string}
 */
export function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Generate an SDK key. The plaintext is meant to be shown once.
 *
 * @param {SdkKeyType} type
 * @returns {SdkKeyMaterial}
 */
export function generateSdkKey(type) {
  const body = randomBytes(32).toString('base64url');
  const raw = type === 'server' ? `fk_server_${body}` : `fk_client_${body}`;
  return {
    raw,
    keyHash: sha256Hex(raw),
    prefix: raw.slice(0, 16),
    type,
  };
}

/**
 * Document fragment stored on Environment.sdkKeys. Never includes `raw`.
 *
 * @param {SdkKeyMaterial} material
 * @returns {{ keyHash: string, prefix: string, type: SdkKeyType, createdAt: Date, revokedAt: Date | null }}
 */
export function toStoredSdkKey(material) {
  return {
    keyHash: material.keyHash,
    prefix: material.prefix,
    type: material.type,
    createdAt: new Date(),
    revokedAt: null,
  };
}
