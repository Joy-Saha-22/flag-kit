import { describe, expect, it } from 'vitest';
import { envSchema, seedEnvSchema } from '../src/env.js';

const valid = {
  NODE_ENV: 'development',
  PORT: '3000',
  MONGODB_URI: 'mongodb://flagkit:a-long-mongo-password-ok@localhost:27017/flagkit?authSource=admin',
  REDIS_URL: 'redis://:a-long-redis-password-ok@localhost:6379',
  JWT_SECRET: 'abcdefghijklmnopqrstuvwxyz012345',
};

describe('envSchema', () => {
  it('accepts a complete strong configuration', () => {
    const parsed = envSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.PORT).toBe(3000);
    }
  });

  it('rejects a missing Mongo URI', () => {
    const parsed = envSchema.safeParse({ ...valid, MONGODB_URI: undefined });
    expect(parsed.success).toBe(false);
  });

  it('rejects a short JWT secret', () => {
    const parsed = envSchema.safeParse({ ...valid, JWT_SECRET: 'too-short' });
    expect(parsed.success).toBe(false);
  });

  it('rejects placeholder secrets copied from .env.example', () => {
    const parsed = envSchema.safeParse({
      ...valid,
      JWT_SECRET: 'replace-with-at-least-32-char-secret!!',
      MONGODB_URI: 'mongodb://flagkit:replace-with-a-long-mongo-password@localhost:27017/flagkit?authSource=admin',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('seedEnvSchema', () => {
  it('requires a strong demo password', () => {
    const parsed = seedEnvSchema.safeParse({
      ...valid,
      SEED_USER_EMAIL: 'admin@example.com',
      SEED_USER_NAME: 'Demo',
      SEED_USER_PASSWORD: 'short',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts seed fields when the password is strong', () => {
    const parsed = seedEnvSchema.safeParse({
      ...valid,
      SEED_USER_EMAIL: 'admin@example.com',
      SEED_USER_NAME: 'Demo',
      SEED_USER_PASSWORD: 'a-strong-demo-password',
    });
    expect(parsed.success).toBe(true);
  });
});
