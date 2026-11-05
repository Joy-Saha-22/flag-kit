import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { makeApp } from './helpers.js';

describe('client serving', () => {
  it('serves the SPA for HTML navigation while preserving API and SDK JSON 404s', async () => {
    const { app } = makeApp({
      env: {
        SERVE_CLIENT: 'true',
        CLIENT_DIST_DIR: 'client',
      },
    });

    const page = await request(app).get('/projects/missing').set('Accept', 'text/html');
    expect(page.status).toBe(200);
    expect(page.text).toContain('<title>FlagKit</title>');
    expect(page.headers['cache-control']).toBe('no-cache');

    const apiNotFound = await request(app).get('/api/unknown').set('Accept', 'text/html');
    expect(apiNotFound.status).toBe(404);
    expect(apiNotFound.body.error.code).toBe('not_found');

    const sdkNotFound = await request(app).get('/sdk/unknown').set('Accept', 'text/html');
    expect(sdkNotFound.status).toBe(404);
    expect(sdkNotFound.body.error.code).toBe('not_found');
  });
});
