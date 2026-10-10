import { EventEmitter } from 'node:events';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';

export const H = { 'X-Requested-By': 'flagkit-dashboard' };

export function testEnv(overrides = {}) {
  return loadEnv({
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb://localhost:27017/flagkit-test',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'test-signing-key-0123456789-abcdefghijklmnop',
    BCRYPT_COST: '4',
    CORS_ORIGINS: 'http://localhost:5173',
    ...overrides,
  });
}

let counter = 0;
const newId = () => String(++counter).padStart(24, '0');

export function memoryUserStore() {
  const users = new Map();
  return {
    users,
    async findByEmail(email) {
      return [...users.values()].find((u) => u.email === email) ?? null;
    },
    async findById(id) {
      return users.get(id) ?? null;
    },
    async create({ email, name, passwordHash }) {
      const user = { id: newId(), email, name, passwordHash };
      users.set(user.id, user);
      return user;
    },
  };
}

export function memoryAuditStore() {
  const records = [];
  return {
    records,
    async record(entry) {
      records.push({ id: newId(), ts: new Date(), ...entry });
    },
    async list({ projectId, flagKey, envKey, before, limit }) {
      return records
        .filter((r) => r.projectId === projectId)
        .filter((r) => !flagKey || r.flagKey === flagKey)
        .filter((r) => !envKey || r.envKey === envKey)
        .filter((r) => !before || r.ts < new Date(before))
        .reverse()
        .slice(0, limit)
        .map((r) => ({
          id: r.id,
          action: r.action,
          flagKey: r.flagKey ?? null,
          envKey: r.envKey ?? null,
          before: r.before ?? null,
          after: r.after ?? null,
          ts: r.ts,
          actor: { id: r.actorId, name: null, email: null },
        }));
    },
  };
}

export function memoryCache({ fail = false } = {}) {
  const boom = () => new Error('redis is down (redis://user:secret@host:6379)');
  const expiresAt = new Map();
  const live = (cache, key) => {
    const until = expiresAt.get(key);
    if (until !== undefined && until <= Date.now()) {
      cache.store.delete(key);
      cache.ttls.delete(key);
      expiresAt.delete(key);
      return false;
    }
    return cache.store.has(key);
  };
  return {
    failing: fail, // tests can flip this to simulate Redis going down
    deleted: [],
    store: new Map(),
    ttls: new Map(),
    async get(key) {
      if (this.failing) {
        throw boom();
      }
      return live(this, key) ? this.store.get(key) : null;
    },
    async set(key, value, mode, ttl) {
      if (this.failing) {
        throw boom();
      }
      this.store.set(key, value);
      if (mode === 'EX') {
        this.ttls.set(key, ttl);
        expiresAt.set(key, Date.now() + Number(ttl) * 1000);
      }
      if (mode === 'PX') {
        this.ttls.set(key, Number(ttl) / 1000);
        expiresAt.set(key, Date.now() + Number(ttl));
      }
      return 'OK';
    },
    async del(key) {
      if (this.failing) {
        throw boom();
      }
      this.deleted.push(key);
      this.store.delete(key);
      this.ttls.delete(key);
      expiresAt.delete(key);
      return 1;
    },
    async incr(key) {
      if (this.failing) {
        throw boom();
      }
      live(this, key);
      const next = Number(this.store.get(key) ?? 0) + 1;
      this.store.set(key, String(next));
      return next;
    },
    async pexpire(key, ms) {
      if (this.failing) {
        throw boom();
      }
      if (!live(this, key)) {
        return 0;
      }
      expiresAt.set(key, Date.now() + Number(ms));
      this.ttls.set(key, Number(ms) / 1000);
      return 1;
    },
    async pttl(key) {
      if (this.failing) {
        throw boom();
      }
      if (!live(this, key)) {
        return -2;
      }
      const until = expiresAt.get(key);
      return until === undefined ? -1 : Math.max(0, until - Date.now());
    },
    // COMPARE_AND_SET for rulesets, INCR+PEXPIRE for rate limits.
    async eval(script, numKeys, key, ...argv) {
      if (this.failing) {
        throw boom();
      }
      if (typeof script === 'string' && script.includes("redis.call('INCR'")) {
        const windowMs = Number(argv[0]);
        live(this, key);
        const n = Number(this.store.get(key) ?? 0) + 1;
        this.store.set(key, String(n));
        if (n === 1) {
          expiresAt.set(key, Date.now() + windowMs);
        }
        const until = expiresAt.get(key);
        const ttl = until === undefined ? -1 : Math.max(0, until - Date.now());
        return [n, ttl];
      }
      const json = argv[0];
      const version = argv[1];
      const current = live(this, key) ? this.store.get(key) : null;
      if (current) {
        const stored = Number(JSON.parse(current).version);
        if (Number.isFinite(stored) && stored >= Number(version)) {
          return 0;
        }
      }
      this.store.set(key, json);
      return 1;
    },
  };
}

export function memoryPublisher({ fail = false } = {}) {
  return {
    messages: [],
    async publish(channel, message) {
      if (fail) {
        throw new Error('publish failed');
      }
      this.messages.push({ channel, message: JSON.parse(message) });
      return 1;
    },
  };
}

/** Stands in for the ioredis subscriber connection. */
export function memorySubscriber({ failSubscribe = false } = {}) {
  const emitter = new EventEmitter();
  emitter.subscribed = new Set();
  emitter.subscribe = async (channel) => {
    if (failSubscribe) {
      throw new Error('subscribe failed');
    }
    emitter.subscribed.add(channel);
  };
  emitter.unsubscribe = async (channel) => {
    emitter.subscribed.delete(channel);
  };
  /** Deliver a message as Redis would. */
  emitter.publish = (channel, payload) => emitter.emit('message', channel, JSON.stringify(payload));
  return emitter;
}

export function memorySdkStore({ projectStore }) {
  const events = [];
  return {
    events,
    lookups: 0,
    async findEnvironmentByKeyHash(keyHash) {
      this.lookups += 1;
      for (const env of projectStore.envs) {
        const key = env.sdkKeys.find((k) => k.keyHash === keyHash);
        if (key) {
          return {
            envId: env.id,
            projectId: env.projectId,
            envKey: env.key,
            type: key.type,
            revokedAt: key.revokedAt ?? null,
          };
        }
      }
      return null;
    },
    async insertEvents(docs) {
      events.push(...docs.map((doc) => ({ ...doc })));
    },
  };
}

export function memoryProjectStore() {
  const projects = [];
  const envs = [];
  const find = (projectId, envKey) => envs.find((e) => e.projectId === projectId && e.key === envKey);
  const publicKey = ({ keyHash, ...rest }) => rest;

  return {
    projects,
    envs,
    setRole(projectId, userId, role) {
      const project = projects.find((p) => p.id === projectId);
      project.members = project.members.filter((m) => m.userId !== userId);
      project.members.push({ userId, role });
    },
    async listForUser(userId) {
      return projects
        .filter((p) => p.members.some((m) => m.userId === userId))
        .map((p) => ({
          id: p.id,
          name: p.name,
          key: p.key,
          role: p.members.find((m) => m.userId === userId).role,
          createdAt: p.createdAt,
        }));
    },
    async findForMember({ projectId, userId }) {
      const project = projects.find((p) => p.id === projectId);
      const member = project?.members.find((m) => m.userId === userId);
      return member ? { id: project.id, name: project.name, key: project.key, role: member.role } : null;
    },
    async createWithEnvironments({ name, key, ownerId }) {
      if (projects.some((p) => p.key === key)) {
        throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
      }
      const project = { id: newId(), name, key, createdAt: new Date(), members: [{ userId: ownerId, role: 'admin' }] };
      projects.push(project);
      const environments = [
        ['dev', 'Development'],
        ['staging', 'Staging'],
        ['prod', 'Production'],
      ].map(([envKey, envName]) => {
        const env = { id: newId(), projectId: project.id, key: envKey, name: envName, sdkKeys: [] };
        envs.push(env);
        return { id: env.id, key: envKey, name: envName };
      });
      return { project: { id: project.id, name, key }, environments };
    },
    async listEnvironments(projectId) {
      return envs.filter((e) => e.projectId === projectId).map((e) => ({ id: e.id, key: e.key, name: e.name }));
    },
    async listSdkKeys({ projectId, envKey }) {
      const env = find(projectId, envKey);
      return env ? env.sdkKeys.map(publicKey) : null;
    },
    async addSdkKey({ projectId, envKey, key, maxKeys }) {
      const env = find(projectId, envKey);
      if (!env) {
        return { status: 'env_not_found' };
      }
      if (env.sdkKeys.length >= maxKeys) {
        return { status: 'limit_reached' };
      }
      const stored = { id: newId(), ...key };
      env.sdkKeys.push(stored);
      return { status: 'ok', key: publicKey(stored) };
    },
    async revokeSdkKey({ projectId, envKey, keyId }) {
      const key = find(projectId, envKey)?.sdkKeys.find((k) => k.id === keyId);
      if (!key) {
        return { status: 'not_found' };
      }
      const alreadyRevoked = Boolean(key.revokedAt);
      if (!alreadyRevoked) {
        key.revokedAt = new Date();
      }
      return { status: 'ok', keyHash: key.keyHash, prefix: key.prefix, type: key.type, alreadyRevoked };
    },
  };
}

export function memoryFlagStore() {
  const docs = [];
  const versions = new Map();
  const clone = (value) => structuredClone(value);
  const find = (projectId, key) => docs.find((d) => d.projectId === projectId && d.key === key);

  return {
    docs,
    async list({ projectId, search, tag, limit }) {
      let out = docs.filter((d) => d.projectId === projectId);
      if (tag) {
        out = out.filter((d) => d.tags.includes(tag));
      }
      if (search) {
        const needle = search.toLowerCase();
        out = out.filter((d) => d.key.includes(needle) || d.name.toLowerCase().includes(needle));
      }
      return clone([...out].sort((a, b) => a.key.localeCompare(b.key)).slice(0, limit));
    },
    async count({ projectId }) {
      return docs.filter((d) => d.projectId === projectId).length;
    },
    async get({ projectId, key }) {
      const doc = find(projectId, key);
      return doc ? clone(doc) : null;
    },
    async create({ projectId, flag }) {
      if (find(projectId, flag.key)) {
        throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
      }
      const now = new Date();
      const doc = clone({ _id: newId(), projectId, ...flag, createdAt: now, updatedAt: now });
      docs.push(doc);
      return clone(doc);
    },
    async update({ projectId, key, patch }) {
      const doc = find(projectId, key);
      if (!doc) {
        return null;
      }
      Object.assign(doc, clone(patch), { updatedAt: new Date() });
      return clone(doc);
    },
    async delete({ projectId, key }) {
      const doc = find(projectId, key);
      if (!doc) {
        return null;
      }
      docs.splice(docs.indexOf(doc), 1);
      return clone(doc);
    },
    async setEnvironmentConfig({ projectId, key, envKey, config, currentVersion }) {
      const doc = find(projectId, key);
      if (!doc) {
        return { status: 'not_found' };
      }
      const existing = doc.environments[envKey];
      const matches = currentVersion === undefined ? existing === undefined : existing?.version === currentVersion;
      if (!matches) {
        return { status: 'version_conflict' };
      }
      const newConfig = { ...clone(config), version: (currentVersion ?? 0) + 1 };
      doc.environments[envKey] = newConfig;
      doc.updatedAt = new Date();
      return { status: 'ok', config: clone(newConfig) };
    },
    async listEnvironmentFlags({ projectId, envKey }) {
      return clone(docs.filter((d) => d.projectId === projectId && d.environments[envKey]));
    },
    async getRulesetVersion(envId) {
      return versions.get(envId) ?? 0;
    },
    async nextRulesetVersion(envId) {
      const next = (versions.get(envId) ?? 0) + 1;
      versions.set(envId, next);
      return next;
    },
  };
}

export function makeApp({
  env: envOverrides = {},
  cacheFails = false,
  publisherFails = false,
  subscribeFails = false,
} = {}) {
  const env = testEnv(envOverrides);
  const userStore = memoryUserStore();
  const projectStore = memoryProjectStore();
  const flagStore = memoryFlagStore();
  const sdkStore = memorySdkStore({ projectStore });
  const auditStore = memoryAuditStore();
  const cache = memoryCache({ fail: cacheFails });
  const publisher = memoryPublisher({ fail: publisherFails });
  const subscriber = memorySubscriber({ failSubscribe: subscribeFails });
  const logs = [];
  const logger = { info() {}, warn: (e) => logs.push(e), error: (e) => logs.push(e) };
  const app = createApp({
    env,
    userStore,
    projectStore,
    flagStore,
    sdkStore,
    auditStore,
    cache,
    publisher,
    subscriber,
    logger,
  });
  return { app, env, userStore, projectStore, flagStore, sdkStore, auditStore, cache, publisher, subscriber, logs };
}

export async function signUp(app, email) {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/register')
    .set(H)
    .send({ email, password: 'a-long-test-password', name: 'Tester' });
  return { agent, userId: res.body.user.id };
}
