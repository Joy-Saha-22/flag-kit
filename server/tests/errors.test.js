import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { H, makeApp, signUp } from './helpers.js';

describe('central error handler', () => {
  it('returns a generic body when a store throws a database error', async () => {
    const ctx = makeApp();
    const { agent } = await signUp(ctx.app, 'owner@example.com');
    ctx.projectStore.listForUser = async () => {
      throw new Error('ECONNREFUSED mongodb://flagkit:hunter2@localhost:27017/flagkit');
    };
    const res = await agent.get('/api/projects');
    expect(res.status).toBe(500);
    expect(res.body.error).toEqual({
      code: 'internal_error',
      message: 'Something went wrong.',
      requestId: res.headers['x-request-id'],
    });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('ECONNREFUSED');
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('mongodb://');
    expect(text).not.toContain('stack');
    const logged = JSON.stringify(ctx.logs);
    expect(logged).toContain('ECONNREFUSED');
    expect(logged).toContain('[redacted-uri]');
    expect(logged).not.toContain('hunter2');
  });

  it('maps Mongo duplicate-key errors to a generic 409', async () => {
    const ctx = makeApp();
    const { agent } = await signUp(ctx.app, 'owner@example.com');
    ctx.projectStore.createWithEnvironments = async () => {
      throw Object.assign(new Error('E11000 duplicate key error collection: flagkit.projects'), { code: 11000 });
    };
    const res = await agent.post('/api/projects').set(H).send({ name: 'Acme', key: 'acme' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');
    expect(JSON.stringify(res.body)).not.toContain('flagkit.projects');
  });
});
