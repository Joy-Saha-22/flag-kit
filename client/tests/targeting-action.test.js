import { afterEach, describe, expect, it, vi } from 'vitest';
import { targetingAction } from '../src/routes';

afterEach(() => vi.restoreAllMocks());

describe('targeting action', () => {
  it('sends the loaded expectedVersion with the config', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ flag: {}, sync: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const body = {
      enabled: true,
      offVariation: 'off',
      fallthrough: { variation: 'on' },
      rules: [],
      expectedVersion: 7,
    };

    await expect(targetingAction({
      params: { pid: 'project-1', key: 'sample-flag' },
      request: new Request('http://localhost/p/project-1/flags/sample-flag?env=staging', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      }),
    })).resolves.toMatchObject({ ok: true, sync: 'ok' });

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/projects/project-1/flags/sample-flag/environments/staging',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    );
  });

  it('returns version conflict as action data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        error: {
          code: 'version_conflict',
          message: 'This flag was changed by someone else. Reload and try again.',
          requestId: 'req-conflict',
        },
      }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(targetingAction({
      params: { pid: 'project-1', key: 'sample-flag' },
      request: new Request('http://localhost/p/project-1/flags/sample-flag?env=prod', {
        method: 'POST',
        body: JSON.stringify({ expectedVersion: 4 }),
        headers: { 'Content-Type': 'application/json' },
      }),
    })).resolves.toMatchObject({
      ok: false,
      error: {
        status: 409,
        code: 'version_conflict',
        requestId: 'req-conflict',
      },
    });
  });
});
