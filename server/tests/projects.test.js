import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { H, makeApp, signUp } from './helpers.js';
import { projectParamsSchema, sdkKeyParamsSchema } from '../src/projects/schemas.js';
import { sha256Hex } from '../src/lib/sdkKeys.js';

const acme = { name: 'Acme', key: 'acme' };
const ZERO_ID = '0'.repeat(24);

const createProject = (agent, body = acme) => agent.post('/api/projects').set(H).send(body);
const keysPath = (pid, envKey = 'dev') => `/api/projects/${pid}/environments/${envKey}/sdk-keys`;

describe('projects', () => {
  it('rejects unknown project and SDK key path parameter fields', () => {
    expect(projectParamsSchema.safeParse({ pid: 'a'.repeat(24), unexpected: 'value' }).success).toBe(false);
    expect(
      sdkKeyParamsSchema.safeParse({
        envKey: 'prod',
        keyId: 'a'.repeat(24),
        unexpected: 'value',
      }).success,
    ).toBe(false);
  });

  it('creates a project with three environments, audits it, and lists it for the owner only', async () => {
    const { app, auditStore } = makeApp();
    const a = await signUp(app, 'a@example.com');
    const b = await signUp(app, 'b@example.com');

    const res = await createProject(a.agent);
    expect(res.status).toBe(201);
    expect(res.body.project.role).toBe('admin');
    expect(res.body.environments.map((e) => e.key)).toEqual(['dev', 'staging', 'prod']);
    expect(auditStore.records[0].action).toBe('project.create');
    expect(auditStore.records[0].actorId).toBe(a.userId);

    const mine = await a.agent.get('/api/projects');
    expect(mine.body.projects.length).toBe(1);
    const theirs = await b.agent.get('/api/projects');
    expect(theirs.body.projects).toEqual([]);
  });

  it('requires a signed-in user', async () => {
    const { app } = makeApp();
    expect((await request(app).get('/api/projects')).status).toBe(401);
    expect((await request(app).post('/api/projects').set(H).send(acme)).status).toBe(401);
  });

  it('rejects unrecognized query parameters on project routes', async () => {
    const { app } = makeApp();
    const a = await signUp(app, 'query@example.com');
    expect((await a.agent.get('/api/projects?unexpected=value')).status).toBe(400);

    const pid = (await createProject(a.agent)).body.project.id;
    const res = await a.agent.get(`/api/projects/${pid}/environments?unexpected=value`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('rejects invalid input and duplicate project keys', async () => {
    const { app } = makeApp();
    const a = await signUp(app, 'a@example.com');
    const bad = [
      { name: 'Acme', key: 'Has Spaces' },
      { name: 'Acme', key: 'a' },
      { name: '', key: 'acme' },
      { name: 'Acme', key: 'acme', members: [] },
      { name: { $ne: null }, key: 'acme' },
      { key: 'acme' },
    ];
    for (const body of bad) {
      const res = await createProject(a.agent, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_failed');
    }
    expect((await createProject(a.agent)).status).toBe(201);
    const dup = await createProject(a.agent);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('conflict');
  });

  it('enforces the per-user project limit', async () => {
    const { app } = makeApp({ env: { MAX_PROJECTS_PER_USER: '1' } });
    const a = await signUp(app, 'a@example.com');
    expect((await createProject(a.agent)).status).toBe(201);
    const second = await createProject(a.agent, { name: 'Two', key: 'two' });
    expect(second.status).toBe(403);
    expect(second.body.error.code).toBe('limit_reached');
  });

  it('answers 404 for non-members, unknown projects, and malformed IDs', async () => {
    const { app } = makeApp();
    const a = await signUp(app, 'a@example.com');
    const b = await signUp(app, 'b@example.com');
    const pid = (await createProject(a.agent)).body.project.id;

    const paths = [
      `/api/projects/${pid}/environments`,
      keysPath(pid),
      `/api/projects/${ZERO_ID}/environments`,
      '/api/projects/abc/environments',
      '/api/projects/%7B%22%24ne%22%3Anull%7D/environments',
    ];
    for (const path of paths) {
      expect((await b.agent.get(path)).status).toBe(404);
    }
    expect((await request(app).get(`/api/projects/${pid}/environments`)).status).toBe(401);
  });
});

describe('roles on project routes', () => {
  it('viewers see environments but not SDK keys', async () => {
    const { app, projectStore } = makeApp();
    const a = await signUp(app, 'a@example.com');
    const b = await signUp(app, 'b@example.com');
    const pid = (await createProject(a.agent)).body.project.id;
    projectStore.setRole(pid, b.userId, 'viewer');

    const envs = await b.agent.get(`/api/projects/${pid}/environments`);
    expect(envs.status).toBe(200);
    expect(envs.body.environments.length).toBe(3);
    expect((await b.agent.get(keysPath(pid))).status).toBe(403);
    expect((await b.agent.post(keysPath(pid)).set(H).send({ type: 'server' })).status).toBe(403);
  });

  it('editors list keys but only admins create and revoke them', async () => {
    const { app, projectStore } = makeApp();
    const a = await signUp(app, 'a@example.com');
    const b = await signUp(app, 'b@example.com');
    const pid = (await createProject(a.agent)).body.project.id;
    projectStore.setRole(pid, b.userId, 'editor');

    expect((await b.agent.get(keysPath(pid))).status).toBe(200);
    expect((await b.agent.post(keysPath(pid)).set(H).send({ type: 'server' })).status).toBe(403);
    expect((await b.agent.delete(`${keysPath(pid)}/${ZERO_ID}`).set(H)).status).toBe(403);
    expect((await a.agent.post(keysPath(pid)).set(H).send({ type: 'server' })).status).toBe(201);
  });
});

describe('SDK keys', () => {
  async function setup(options) {
    const ctx = makeApp(options);
    const a = await signUp(ctx.app, 'a@example.com');
    const pid = (await createProject(a.agent)).body.project.id;
    return { ...ctx, a, pid };
  }

  it('returns the full key once and never exposes it or its hash again', async () => {
    const { a, pid, auditStore } = await setup();
    const created = await a.agent.post(keysPath(pid)).set(H).send({ type: 'server' });
    expect(created.status).toBe(201);
    const raw = created.body.sdkKey.key;
    expect(raw.startsWith('fk_server_')).toBe(true);
    expect(created.headers['cache-control']).toContain('no-store');

    const list = await a.agent.get(keysPath(pid));
    const text = JSON.stringify(list.body);
    expect(text).not.toContain(raw);
    expect(text).not.toContain('keyHash');
    expect(list.body.sdkKeys[0].prefix).toBe(raw.slice(0, 16));
    expect(list.body.sdkKeys[0].type).toBe('server');

    const audit = auditStore.records.find((r) => r.action === 'sdk_key.create');
    expect(audit.envKey).toBe('dev');
    expect(JSON.stringify(audit)).not.toContain(raw);
  });

  it('validates the key type and the environment', async () => {
    const { a, pid } = await setup();
    for (const body of [{ type: 'admin' }, { type: 'server', extra: 1 }, {}]) {
      const res = await a.agent.post(keysPath(pid)).set(H).send(body);
      expect(res.status).toBe(400);
    }
    expect((await a.agent.post(keysPath(pid, 'nope')).set(H).send({ type: 'client' })).status).toBe(404);
    expect((await a.agent.get(keysPath(pid, 'nope'))).status).toBe(404);
    expect((await a.agent.get(keysPath(pid, 'Bad Key'))).status).toBe(400);
  });

  it('limits the number of keys per environment', async () => {
    const { a, pid } = await setup({ env: { MAX_SDK_KEYS_PER_ENV: '2' } });
    expect((await a.agent.post(keysPath(pid)).set(H).send({ type: 'client' })).status).toBe(201);
    expect((await a.agent.post(keysPath(pid)).set(H).send({ type: 'client' })).status).toBe(201);
    const third = await a.agent.post(keysPath(pid)).set(H).send({ type: 'client' });
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe('limit_reached');
  });

  it('revokes a key, clears its cache entry, and is safe to repeat', async () => {
    const { a, pid, cache, auditStore } = await setup();
    const created = await a.agent.post(keysPath(pid)).set(H).send({ type: 'server' });
    const { id, key } = created.body.sdkKey;

    const first = await a.agent.delete(`${keysPath(pid)}/${id}`).set(H);
    expect(first.status).toBe(204);
    expect(cache.deleted).toContain(`sdkkey:${sha256Hex(key)}`);

    const list = await a.agent.get(keysPath(pid));
    expect(list.body.sdkKeys[0].revokedAt).not.toBe(null);

    expect((await a.agent.delete(`${keysPath(pid)}/${id}`).set(H)).status).toBe(204);
    expect(auditStore.records.filter((r) => r.action === 'sdk_key.revoke').length).toBe(1);

    expect((await a.agent.delete(`${keysPath(pid)}/${'1'.repeat(24)}`).set(H)).status).toBe(404);
    expect((await a.agent.delete(`${keysPath(pid)}/not-an-id`).set(H)).status).toBe(400);
  });

  it('still revokes when Redis is down, and logs the failure without the connection string', async () => {
    const { a, pid, logs } = await setup({ cacheFails: true });
    const created = await a.agent.post(keysPath(pid)).set(H).send({ type: 'client' });
    const res = await a.agent.delete(`${keysPath(pid)}/${created.body.sdkKey.id}`).set(H);
    expect(res.status).toBe(204);
    const entry = logs.find((l) => l.msg === 'sdk_key_cache_clear_failed');
    expect(entry).not.toBe(undefined);
    expect(JSON.stringify(entry)).not.toContain('user:secret');
  });
});
