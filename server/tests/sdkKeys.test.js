import { describe, expect, it } from 'vitest';
import { generateSdkKey, sha256Hex, toStoredSdkKey } from '../src/lib/sdkKeys.js';

describe('sdkKeys', () => {
  it('hashes with SHA-256 hex', () => {
    expect(sha256Hex('flagkit')).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256Hex('flagkit')).not.toBe(sha256Hex('other'));
    expect(sha256Hex('flagkit')).toBe(sha256Hex('flagkit'));
  });

  it('generates typed keys with prefix and hash of the plaintext', () => {
    const server = generateSdkKey('server');
    const client = generateSdkKey('client');

    expect(server.raw.startsWith('fk_server_')).toBe(true);
    expect(client.raw.startsWith('fk_client_')).toBe(true);
    expect(server.keyHash).toBe(sha256Hex(server.raw));
    expect(server.prefix).toBe(server.raw.slice(0, 16));
    expect(server.raw).not.toBe(client.raw);

    const stored = toStoredSdkKey(server);
    expect(stored).not.toHaveProperty('raw');
    expect(stored.keyHash).toBe(server.keyHash);
    expect(stored.revokedAt).toBeNull();
    expect(stored.type).toBe('server');
  });
});
