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
      records.push(entry);
    },
  };
}

export function memoryCache({ fail = false } = {}) {
  return {
    deleted: [],
    async del(key) {
      if (fail) {
        throw new Error('redis is down (redis://user:secret@host:6379)');
      }
      this.deleted.push(key);
      return 1;
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

export function makeApp({ env: envOverrides = {}, cacheFails = false } = {}) {
  const env = testEnv(envOverrides);
  const userStore = memoryUserStore();
  const projectStore = memoryProjectStore();
  const auditStore = memoryAuditStore();
  const cache = memoryCache({ fail: cacheFails });
  const logs = [];
  const logger = { info() {}, warn: (e) => logs.push(e), error: (e) => logs.push(e) };
  const app = createApp({ env, userStore, projectStore, auditStore, cache, logger });
  return { app, env, userStore, projectStore, auditStore, cache, logs };
}

export async function signUp(app, email) {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/register')
    .set(H)
    .send({ email, password: 'a-long-test-password', name: 'Tester' });
  return { agent, userId: res.body.user.id };
}
