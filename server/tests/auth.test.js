import { afterEach, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { requireRole } from '../src/middleware/auth.js';
import { createErrorHandler } from '../src/errors.js';
import { silentLogger } from '../src/logger.js';

const SECRET = 'test-signing-key-0123456789-abcdefghijklmnop';

const env = loadEnv({
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://localhost:27017/flagkit-test',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: SECRET,
  BCRYPT_COST: '4',
  CORS_ORIGINS: 'http://localhost:5173',
  JSON_BODY_LIMIT: '2kb',
});

const H = { 'X-Requested-By': 'flagkit-dashboard' };

afterEach(() => {
  vi.restoreAllMocks();
});

function memoryUserStore() {
  const users = new Map();
  let counter = 0;
  return {
    users,
    async findByEmail(email) {
      return [...users.values()].find((u) => u.email === email) ?? null;
    },
    async findById(id) {
      return users.get(id) ?? null;
    },
    async create({ email, name, passwordHash }) {
      counter += 1;
      const user = { id: `u${counter}`, email, name, passwordHash };
      users.set(user.id, user);
      return user;
    },
  };
}

function setup(overrides = {}) {
  const userStore = overrides.userStore ?? memoryUserStore();
  const logs = [];
  const logger = { info() {}, warn: (e) => logs.push(e), error: (e) => logs.push(e) };
  const app = createApp({ env: overrides.env ?? env, userStore, logger });
  return { app, userStore, logs };
}

const newUser = {
  email: 'Joy@Example.com',
  password: 'a-long-test-password',
  name: 'Joy',
};

describe('registration', () => {
  it('creates a user, sets a safe session cookie, and never returns the hash', async () => {
    const { app, userStore } = setup();
    const res = await request(app).post('/api/auth/register').set(H).send(newUser);
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('joy@example.com');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(JSON.stringify(res.body)).not.toContain(newUser.password);
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toContain('fk_session=');
    expect(/HttpOnly/i.test(cookie)).toBe(true);
    expect(/SameSite=Lax/i.test(cookie)).toBe(true);
    const stored = [...userStore.users.values()][0];
    expect(stored.passwordHash).not.toBe(newUser.password);
  });

  it('returns registration_closed when registration is disabled', async () => {
    const disabledEnv = loadEnv({
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://localhost:27017/flagkit-test',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: SECRET,
      BCRYPT_COST: '4',
      CORS_ORIGINS: 'http://localhost:5173',
      REGISTRATION_ENABLED: 'false',
    });
    const { app, userStore } = setup({ env: disabledEnv });
    const res = await request(app).post('/api/auth/register').set(H).send(newUser);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('registration_closed');
    expect(res.body.error.message).toBe('Registration is currently closed.');
    expect(userStore.users.size).toBe(0);
  });

  it('rejects state-changing requests without the X-Requested-By header', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/auth/register').send(newUser);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf_header_missing');
  });

  it('rejects a duplicate email with a generic 409', async () => {
    const { app } = setup();
    await request(app).post('/api/auth/register').set(H).send(newUser);
    const res = await request(app).post('/api/auth/register').set(H).send(newUser);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');
  });

  it('rejects invalid input instead of sanitizing it', async () => {
    const { app } = setup();
    const cases = [
      { ...newUser, isAdmin: true },
      { ...newUser, password: 'short' },
      { ...newUser, password: 'x'.repeat(73) },
      { ...newUser, email: { $ne: null } },
      { ...newUser, email: 'not-an-email' },
      { ...newUser, name: '' },
      { email: newUser.email },
    ];
    for (const body of cases) {
      const res = await request(app).post('/api/auth/register').set(H).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_failed');
    }
  });
});

describe('login', () => {
  it('logs in with the right password', async () => {
    const { app } = setup();
    await request(app).post('/api/auth/register').set(H).send(newUser);
    const res = await request(app)
      .post('/api/auth/login')
      .set(H)
      .send({ email: 'joy@example.com', password: newUser.password });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie'][0]).toContain('fk_session=');
  });

  it('initializes dummy bcrypt once and verifies unknown and wrong passwords at the configured cost', async () => {
    const hashSpy = vi.spyOn(bcrypt, 'hash');
    const compareSpy = vi.spyOn(bcrypt, 'compare');
    const { app } = setup();
    expect(hashSpy).toHaveBeenCalledTimes(1);
    await request(app).post('/api/auth/register').set(H).send(newUser);
    expect(hashSpy).toHaveBeenCalledTimes(2);
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .set(H)
      .send({ email: 'joy@example.com', password: 'wrong-password-123' });
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .set(H)
      .send({ email: 'nobody@example.com', password: 'wrong-password-123' });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe(unknownEmail.body.error.code);
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
    expect(Object.keys(wrongPassword.body.error).sort()).toEqual(Object.keys(unknownEmail.body.error).sort());
    expect(compareSpy).toHaveBeenCalledTimes(2);
    for (const [, hash] of compareSpy.mock.calls) {
      expect(bcrypt.getRounds(hash)).toBe(env.BCRYPT_COST);
    }
    expect(hashSpy).toHaveBeenCalledTimes(4);
  });

  it('rejects operator-injection payloads', async () => {
    const { app } = setup();
    const res = await request(app)
      .post('/api/auth/login')
      .set(H)
      .send({ email: { $ne: null }, password: { $ne: null } });
    expect(res.status).toBe(400);
  });
});

describe('session', () => {
  it('returns the current user with a valid cookie', async () => {
    const { app } = setup();
    const agent = request.agent(app);
    await agent.post('/api/auth/register').set(H).send(newUser);
    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('joy@example.com');
  });

  it('returns 401 without a cookie', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejects unrecognized query parameters', async () => {
    const { app } = setup();
    const agent = request.agent(app);
    await agent.post('/api/auth/register').set(H).send(newUser);
    const res = await agent.get('/api/auth/me?unexpected=value');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('rejects tampered, expired, wrong-secret, alg-none, and unknown-user tokens', async () => {
    const { app } = setup();
    await request(app).post('/api/auth/register').set(H).send(newUser); // creates u1

    const sign = (secret, options) =>
      jwt.sign({}, secret, { algorithm: 'HS256', subject: 'u1', issuer: 'flagkit', ...options });
    const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const algNone = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'u1', iss: 'flagkit' })}.`;
    const valid = sign(SECRET, { expiresIn: 60 });

    const bad = [
      valid.slice(0, -3) + (valid.endsWith('abc') ? 'xyz' : 'abc'),
      sign(SECRET, { expiresIn: -10 }),
      sign('a-completely-different-secret-value-0000', { expiresIn: 60 }),
      algNone,
      jwt.sign({}, SECRET, { algorithm: 'HS256', subject: 'u999', issuer: 'flagkit', expiresIn: 60 }),
      'j:{"a":1}',
    ];
    for (const token of bad) {
      const res = await request(app).get('/api/auth/me').set('Cookie', `fk_session=${token}`);
      expect(res.status).toBe(401);
    }
    const ok = await request(app).get('/api/auth/me').set('Cookie', `fk_session=${valid}`);
    expect(ok.status).toBe(200);
  });

  it('logout clears the cookie', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/auth/logout').set(H);
    expect(res.status).toBe(204);
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toContain('fk_session=;');
    expect(cookie).toContain('Expires=Thu, 01 Jan 1970');
  });
});

describe('role checks', () => {
  function roleApp() {
    const app = express();
    app.use((req, res, next) => {
      req.projectRole = req.get('x-test-role');
      next();
    });
    app.get('/admin', requireRole('admin'), (req, res) => res.json({ ok: true }));
    app.get('/viewer', requireRole('viewer'), (req, res) => res.json({ ok: true }));
    app.use(createErrorHandler(silentLogger));
    return app;
  }

  it('allows equal or higher roles and denies lower, missing, and unknown roles', async () => {
    const app = roleApp();
    expect((await request(app).get('/admin').set('x-test-role', 'admin')).status).toBe(200);
    expect((await request(app).get('/admin').set('x-test-role', 'editor')).status).toBe(403);
    expect((await request(app).get('/admin').set('x-test-role', 'viewer')).status).toBe(403);
    expect((await request(app).get('/admin')).status).toBe(403);
    expect((await request(app).get('/admin').set('x-test-role', 'constructor')).status).toBe(403);
    expect((await request(app).get('/viewer').set('x-test-role', 'editor')).status).toBe(200);
  });
});

describe('errors and hardening', () => {
  it('returns a generic 500 with a request ID and logs the redacted detail', async () => {
    const userStore = memoryUserStore();
    userStore.findByEmail = async () => {
      throw new Error('boom: could not reach mongodb://user:pass@secret-host:27017/db');
    };
    const { app, logs } = setup({ userStore });
    const res = await request(app)
      .post('/api/auth/login')
      .set(H)
      .send({ email: 'joy@example.com', password: 'some-password-1' });
    expect(res.status).toBe(500);
    expect(res.body.error.message).toBe('Something went wrong.');
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('boom');
    expect(text).not.toContain('secret-host');
    expect(text).not.toContain('stack');
    const logged = JSON.stringify(logs);
    expect(logged).toContain('boom');
    expect(logged).not.toContain('user:pass');
    expect(logged).toContain('[redacted-uri]');
  });

  it('returns 400 for malformed JSON and 413 for oversized bodies', async () => {
    const { app } = setup();
    const malformed = await request(app)
      .post('/api/auth/login')
      .set(H)
      .set('Content-Type', 'application/json')
      .send('{bad json');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('invalid_json');
    expect(malformed.body.error.message).toBe('Request body is not valid JSON.');
    expect(JSON.stringify(malformed.body)).not.toMatch(/SyntaxError|stack|node_modules|server[\\/]/i);

    const big = await request(app)
      .post('/api/auth/login')
      .set(H)
      .send({ email: 'a@b.co', password: 'x'.repeat(5000) });
    expect(big.status).toBe(413);
    expect(big.body.error.message).toBe('Request body is too large.');
    expect(JSON.stringify(big.body)).not.toMatch(/stack|node_modules|server[\\/]/i);
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('only allows CORS from the configured origin and hides x-powered-by', async () => {
    const { app } = setup();
    const evil = await request(app)
      .options('/api/auth/login')
      .set('Origin', 'http://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(evil.headers['access-control-allow-origin']).toBe(undefined);

    const good = await request(app)
      .options('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST');
    expect(good.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(good.headers['access-control-allow-credentials']).toBe('true');

    const health = await request(app).get('/healthz');
    expect(health.headers['x-powered-by']).toBe(undefined);
  });
});
