import { describe, expect, it, vi } from 'vitest';
import { apiFetch, ApiError } from '../src/lib/api';

describe('apiFetch', () => {
  it('sends credentials and required headers for non-GET requests', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await apiFetch('/api/projects', {
      method: 'POST',
      body: { name: 'Test', key: 'test' },
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/projects',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({
          'X-Requested-By': 'flagkit-dashboard',
          'Content-Type': 'application/json',
        }),
      }),
    );

    fetchSpy.mockRestore();
  });

  it('parses JSON errors and includes retry information for 429', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'rate_limited',
            message: 'Too many requests',
            requestId: 'req-123',
          },
        }),
        {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '7' },
        },
      ),
    );

    await expect(apiFetch('/api/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 429,
      code: 'rate_limited',
      retryAfterSeconds: 7,
    });

    fetchSpy.mockRestore();
  });

  it('returns null for 204 responses', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    await expect(apiFetch('/api/auth/logout', { method: 'POST' })).resolves.toBeNull();

    fetchSpy.mockRestore();
  });

  it('throws ApiError with requestId and details', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: 'validation_failed',
                message: 'Request validation failed.',
                requestId: 'req-42',
                details: [{ in: 'body', path: 'name', message: 'Required' }],
              },
            }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        ),
    );

    await expect(apiFetch('/api/projects', { method: 'POST', body: {} })).rejects.toBeInstanceOf(ApiError);

    try {
      await apiFetch('/api/projects', { method: 'POST', body: {} });
    } catch (error) {
      expect(error.status).toBe(400);
      expect(error.requestId).toBe('req-42');
      expect(error.details).toEqual([{ in: 'body', path: 'name', message: 'Required' }]);
    }

    fetchSpy.mockRestore();
  });
});
