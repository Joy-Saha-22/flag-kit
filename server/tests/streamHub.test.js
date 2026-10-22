import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createStreamHub } from '../src/sdk/streamHub.js';

describe('stream hub logging', () => {
  it('redacts connection strings in unsubscribe failures', async () => {
    const subscriber = new EventEmitter();
    subscriber.subscribe = async () => {};
    subscriber.unsubscribe = async () => {
      throw new Error('unsubscribe failed: redis://operator:private-password@redis.example:6379');
    };
    const warn = vi.fn();
    const hub = createStreamHub({ subscriber, logger: { warn } });
    const client = { deliver() {}, close() {} };

    await hub.add('environment-1', client);
    hub.remove('environment-1', client);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const logs = JSON.stringify(warn.mock.calls);
    expect(logs).toContain('[redacted-uri]');
    expect(logs).not.toContain('operator:private-password');
  });
});
