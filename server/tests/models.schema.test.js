import { describe, expect, it } from 'vitest';
import { User } from '../src/models/User.js';
import { Project } from '../src/models/Project.js';
import { Environment } from '../src/models/Environment.js';
import { Flag } from '../src/models/Flag.js';
import { Event, EVENT_TTL_SECONDS } from '../src/models/Event.js';
import { AuditLog } from '../src/models/AuditLog.js';

function indexKeys(schema) {
  return schema.indexes().map(([fields, options]) => ({ fields, options }));
}

describe('mongoose schemas', () => {
  it('declares unique email on users', () => {
    expect(User.schema.path('email')).toBeDefined();
    expect(User.schema.path('passwordHash')).toBeDefined();
    const emailIndex = User.schema.path('email').options.unique;
    expect(emailIndex).toBe(true);
  });

  it('declares unique project key and member roles', () => {
    expect(Project.schema.path('key').options.unique).toBe(true);
    expect(Project.schema.path('members').schema.path('role').enumValues).toEqual([
      'admin',
      'editor',
      'viewer',
    ]);
  });

  it('stores hashed SDK keys on environments', () => {
    expect(Environment.schema.path('sdkKeys').schema.path('keyHash')).toBeDefined();
    expect(Environment.schema.path('sdkKeys').schema.path('type').enumValues).toEqual([
      'server',
      'client',
    ]);
    const compound = indexKeys(Environment.schema).some(
      (idx) => idx.fields.projectId === 1 && idx.fields.key === 1 && idx.options.unique,
    );
    expect(compound).toBe(true);
  });

  it('maps per-environment flag config and unique (projectId, key)', () => {
    expect(Flag.schema.path('environments')).toBeDefined();
    expect(Flag.schema.path('variations')).toBeDefined();
    const compound = indexKeys(Flag.schema).some(
      (idx) => idx.fields.projectId === 1 && idx.fields.key === 1 && idx.options.unique,
    );
    expect(compound).toBe(true);
  });

  it('indexes events for aggregation and 30-day TTL', () => {
    expect(EVENT_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
    const indexes = indexKeys(Event.schema);
    const aggregation = indexes.some(
      (idx) =>
        idx.fields.envKey === 1 &&
        idx.fields.flagKey === 1 &&
        idx.fields.type === 1 &&
        idx.fields.variation === 1,
    );
    const ttl = indexes.some((idx) => idx.fields.ts === 1 && idx.options.expireAfterSeconds === EVENT_TTL_SECONDS);
    expect(aggregation).toBe(true);
    expect(ttl).toBe(true);
  });

  it('records audit before/after payloads', () => {
    expect(AuditLog.schema.path('before')).toBeDefined();
    expect(AuditLog.schema.path('after')).toBeDefined();
    expect(AuditLog.schema.path('actorId')).toBeDefined();
  });
});
