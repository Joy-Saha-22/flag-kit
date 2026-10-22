import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRedisClients } from '../src/db/redis.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Redis client logging', () => {
  it('redacts connection strings from driver errors', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const clients = createRedisClients('redis://user:password@example.test:6379');

    clients.cache.emit('error', new Error('Connection failed: redis://user:password@example.test:6379'));

    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain('user:password');
    expect(logged).toContain('[redacted-uri]');
  });
});
