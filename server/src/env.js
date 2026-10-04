import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

dotenv.config({ path: path.join(repoRoot, '.env') });

const PLACEHOLDER_FRAGMENTS = [
  'replace-with',
  'change-me',
  'changeme',
  'your-secret',
  'example-secret',
];

/**
 * @param {string} value
 * @returns {boolean}
 */
function notPlaceholder(value) {
  const lowered = value.toLowerCase();
  return !PLACEHOLDER_FRAGMENTS.some((fragment) => lowered.includes(fragment));
}

/**
 * Split a comma-separated list of allowed browser origins.
 *
 * @param {string} value
 * @returns {string[]}
 */
export function parseOrigins(value) {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  MONGODB_URI: z
    .string()
    .min(1, 'MONGODB_URI is required')
    .refine((value) => value.startsWith('mongodb://') || value.startsWith('mongodb+srv://'), {
      message: 'MONGODB_URI must start with mongodb:// or mongodb+srv://',
    })
    .refine(notPlaceholder, {
      message: 'MONGODB_URI still contains a placeholder value',
    }),
  REDIS_URL: z
    .string()
    .min(1, 'REDIS_URL is required')
    .refine((value) => value.startsWith('redis://') || value.startsWith('rediss://'), {
      message: 'REDIS_URL must start with redis:// or rediss://',
    })
    .refine(notPlaceholder, {
      message: 'REDIS_URL still contains a placeholder value',
    }),
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters')
    .refine(notPlaceholder, {
      message: 'JWT_SECRET still contains a placeholder value',
    })
    .refine((value) => !/^(secret|password|jwt_secret)+$/i.test(value), {
      message: 'JWT_SECRET is too weak',
    }),
  // Comma-separated browser origins allowed to call the dashboard API.
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .refine(
      (value) => {
        const origins = parseOrigins(value);
        return origins.length > 0 && origins.every((origin) => /^https?:\/\/[^\s/*]+$/.test(origin));
      },
      { message: 'CORS_ORIGINS must be a comma-separated list of origins like https://app.example.com (no paths, no wildcards)' },
    ),
  JWT_TTL_SECONDS: z.coerce.number().int().min(60).max(60 * 60 * 24 * 30).default(60 * 60 * 8),
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
  JSON_BODY_LIMIT: z
    .string()
    .regex(/^\d+(kb|mb)$/i, 'JSON_BODY_LIMIT must look like 100kb or 1mb')
    .default('100kb'),
  MAX_PROJECTS_PER_USER: z.coerce.number().int().min(1).max(1000).default(20),
  MAX_SDK_KEYS_PER_ENV: z.coerce.number().int().min(1).max(200).default(25),
});

const seedEnvSchema = envSchema.extend({
  SEED_USER_EMAIL: z.string().email(),
  SEED_USER_NAME: z.string().min(1),
  SEED_USER_PASSWORD: z
    .string()
    .min(12, 'SEED_USER_PASSWORD must be at least 12 characters')
    .refine(notPlaceholder, {
      message: 'SEED_USER_PASSWORD still contains a placeholder value',
    }),
});

/**
 * @typedef {z.infer<typeof envSchema>} AppEnv
 * @typedef {z.infer<typeof seedEnvSchema>} SeedEnv
 */

/**
 * @param {z.ZodError} error
 * @returns {string}
 */
function formatZodError(error) {
  return error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`).join('; ');
}

/**
 * Validate process.env and return typed config. Throws if a required
 * variable is missing or too weak. Does not log secret values.
 *
 * @param {NodeJS.ProcessEnv} [source]
 * @returns {AppEnv}
 */
export function loadEnv(source = process.env) {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${formatZodError(parsed.error)}`);
  }
  return parsed.data;
}

/**
 * @param {NodeJS.ProcessEnv} [source]
 * @returns {SeedEnv}
 */
export function loadSeedEnv(source = process.env) {
  const parsed = seedEnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid seed environment: ${formatZodError(parsed.error)}`);
  }
  return parsed.data;
}

export { envSchema, seedEnvSchema };
