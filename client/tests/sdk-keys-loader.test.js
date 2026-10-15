import { afterEach, describe, expect, it, vi } from 'vitest';
import { sdkKeysLoader } from '../src/routes';

afterEach(() => vi.restoreAllMocks());

describe('SDK keys loader', () => {
  it('returns forbidden when the key list endpoint responds with 403', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ error: { code: 'forbidden', message: 'Forbidden' } }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    ));

    const result = await sdkKeysLoader({
      params: { pid: 'project-1' },
      request: new Request('http://localhost/p/project-1/sdk-keys?env=prod'),
    });

    expect(result).toEqual({ forbidden: true });
  });
});
