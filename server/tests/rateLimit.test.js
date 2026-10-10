import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { H, makeApp, signUp } from './helpers.js';

const loginBody = (email) => ({ email, password: 'a-long-test-password' });

async function expect429(res) {
  expect(res.status).toBe(429);
  expect(res.body.error.code).toBe('rate_limited');
  expect(res.body.error.message).toBe('Too many requests.');
  expect(res.body.error.requestId).toBeTruthy();
  expect(res.headers['retry-after']).toMatch(/^\d+$/);
  expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
  expect(JSON.stringify(res.body)).not.toContain('stack');
}

describe('rate limiting tiers', () => {
  it('returns 429 on the public IP tier after the configured threshold', async () => {
    const { app } = makeApp({
      env: { PUBLIC_RATE_LIMIT_IP_MAX: '2', PUBLIC_RATE_LIMIT_IP_WINDOW_SECONDS: '60' },
    });
    expect((await request(app).get('/healthz')).status).toBe(200);
    expect((await request(app).get('/healthz')).status).toBe(200);
    await expect429(await request(app).get('/healthz'));
  });

  it('returns 429 on the auth IP tier after the configured threshold', async () => {
    const { app } = makeApp({
      env: { AUTH_RATE_LIMIT_IP_MAX: '2', AUTH_RATE_LIMIT_EMAIL_MAX: '100' },
    });
    const post = (email) => request(app).post('/api/auth/register').set(H).send({ ...loginBody(email), name: 'T' });
    expect((await post('a@example.com')).status).toBe(201);
    expect((await post('b@example.com')).status).toBe(201);
    await expect429(await post('c@example.com'));
  });

  it('returns 429 on the auth email tier after the configured threshold', async () => {
    const { app } = makeApp({
      env: { AUTH_RATE_LIMIT_IP_MAX: '100', AUTH_RATE_LIMIT_EMAIL_MAX: '2' },
    });
    const email = 'same@example.com';
    expect((await request(app).post('/api/auth/register').set(H).send({ ...loginBody(email), name: 'T' })).status).toBe(
      201,
    );
    expect((await request(app).post('/api/auth/login').set(H).send(loginBody(email))).status).toBe(200);
    await expect429(await request(app).post('/api/auth/login').set(H).send(loginBody(email)));
  });

  it('applies exponential backoff after failed logins without locking the account', async () => {
    const { app } = makeApp({
      env: {
        AUTH_RATE_LIMIT_IP_MAX: '100',
        AUTH_RATE_LIMIT_EMAIL_MAX: '100',
        AUTH_BACKOFF_BASE_MS: '60000',
        AUTH_BACKOFF_CAP_MS: '120000',
      },
    });
    await request(app).post('/api/auth/register').set(H).send({ ...loginBody('joy@example.com'), name: 'Joy' });
    const wrong = { email: 'joy@example.com', password: 'wrong-password-123' };
    const unknown = { email: 'nobody@example.com', password: 'wrong-password-123' };

    const firstWrong = await request(app).post('/api/auth/login').set(H).send(wrong);
    const firstUnknown = await request(app).post('/api/auth/login').set(H).send(unknown);
    expect(firstWrong.status).toBe(401);
    expect(firstUnknown.status).toBe(401);
    expect(firstWrong.body.error.message).toBe(firstUnknown.body.error.message);

    await expect429(await request(app).post('/api/auth/login').set(H).send(wrong));
    await expect429(await request(app).post('/api/auth/login').set(H).send(unknown));
  });

  it('returns 429 on authenticated dashboard actions after the per-user threshold', async () => {
    const ctx = makeApp({
      env: { DASHBOARD_RATE_LIMIT_USER_MAX: '2', DASHBOARD_RATE_LIMIT_USER_WINDOW_SECONDS: '60' },
    });
    const { agent } = await signUp(ctx.app, 'owner@example.com');
    expect((await agent.get('/api/projects')).status).toBe(200);
    expect((await agent.get('/api/projects')).status).toBe(200);
    await expect429(await agent.get('/api/projects'));
  });

  it('returns 429 on SDK requests after the per-key threshold', async () => {
    const ctx = makeApp({
      env: {
        SDK_RATE_LIMIT_KEY_MAX: '2',
        SDK_RATE_LIMIT_IP_MAX: '100',
      },
    });
    const owner = await signUp(ctx.app, 'owner@example.com');
    const created = await owner.agent.post('/api/projects').set(H).send({ name: 'Acme', key: 'acme' });
    const pid = created.body.project.id;
    const keyRes = await owner.agent.post(`/api/projects/${pid}/environments/prod/sdk-keys`).set(H).send({ type: 'server' });
    const key = keyRes.body.sdkKey.key;
    const hit = () => request(ctx.app).get('/sdk/v1/flags').set('Authorization', key);
    expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(200);
    await expect429(await hit());
  });

  it('returns 429 on SDK requests after the per-IP backstop', async () => {
    const ctx = makeApp({
      env: {
        SDK_RATE_LIMIT_KEY_MAX: '100',
        SDK_RATE_LIMIT_IP_MAX: '2',
      },
    });
    const owner = await signUp(ctx.app, 'owner@example.com');
    const created = await owner.agent.post('/api/projects').set(H).send({ name: 'Acme', key: 'acme' });
    const pid = created.body.project.id;
    const keyRes = await owner.agent.post(`/api/projects/${pid}/environments/prod/sdk-keys`).set(H).send({ type: 'server' });
    const key = keyRes.body.sdkKey.key;
    const hit = () => request(ctx.app).get('/sdk/v1/flags').set('Authorization', key);
    expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(200);
    await expect429(await hit());
  });

  it('rejects oversized SDK event bodies', async () => {
    const ctx = makeApp({ env: { SDK_EVENTS_MAX_BYTES: '256' } });
    const owner = await signUp(ctx.app, 'owner@example.com');
    const created = await owner.agent.post('/api/projects').set(H).send({ name: 'Acme', key: 'acme' });
    const pid = created.body.project.id;
    const keyRes = await owner.agent
      .post(`/api/projects/${pid}/environments/prod/sdk-keys`)
      .set(H)
      .send({ type: 'server' });
    const key = keyRes.body.sdkKey.key;
    const send = (userKeys) =>
      request(ctx.app)
        .post('/sdk/v1/events')
        .set('Authorization', key)
        .send({
          events: userKeys.map((userKey) => ({
            type: 'exposure',
            flagKey: 'checkout',
            variation: 'on',
            userKey,
          })),
        });

    // About 560 bytes: clearly over the 256 byte limit, and every field is still valid.
    const big = await send(['u'.repeat(200), 'v'.repeat(200)]);
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe('payload_too_large');

    // About 85 bytes: under the limit. The flag does not exist, so the event is dropped, not rejected.
    const small = await send(['u']);
    expect(small.status).toBe(202);
    expect(small.body.dropped).toBe(1);
  });
});
