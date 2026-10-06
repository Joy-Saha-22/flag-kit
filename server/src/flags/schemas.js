import { z } from 'zod';
import { SLUG } from '../projects/schemas.js';

const VARIATION_KEY = /^[a-z0-9][a-z0-9-_]{0,63}$/;
const TAG = /^[a-z0-9][a-z0-9-_]{0,31}$/;
const METRIC_KEY = /^[a-z0-9][a-z0-9-_.]{1,63}$/;
const RULE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ATTRIBUTE = /^[A-Za-z0-9_.-]{1,100}$/;
export { VARIATION_KEY, METRIC_KEY };

const OPERATORS = ['equals', 'notEquals', 'in', 'contains', 'startsWith', 'gt', 'lt'];
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_CONTEXT_DEPTH = 6;

function hasDangerousKey(value, depth = 0) {
  if (depth > MAX_CONTEXT_DEPTH) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasDangerousKey(item, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    return Object.keys(value).some((key) => DANGEROUS_KEYS.has(key) || hasDangerousKey(value[key], depth + 1));
  }
  return false;
}

/**
 * Build every flag-related schema from the configured limits.
 * @param {any} env
 */
export function createFlagSchemas(env) {
  const flagKey = z.string().regex(SLUG, 'Must be 2-64 characters: lowercase letters, digits, hyphen, underscore.');
  const variationKey = z.string().regex(VARIATION_KEY, 'Must be 1-64 characters: lowercase letters, digits, hyphen, underscore.');
  const scalar = z.union([z.string().max(2000), z.number().finite(), z.boolean()]);

  const variation = z
    .object({ key: variationKey, name: z.string().trim().min(1).max(80), value: scalar })
    .strict();

  const variations = z
    .array(variation)
    .min(2)
    .max(env.MAX_VARIATIONS)
    .superRefine((list, ctx) => {
      const seen = new Set();
      list.forEach((item, i) => {
        if (seen.has(item.key)) {
          ctx.addIssue({ code: 'custom', path: [i, 'key'], message: 'Duplicate variation key.' });
        }
        seen.add(item.key);
      });
    });

  const tags = z
    .array(z.string().regex(TAG, 'Tags are lowercase letters, digits, hyphen, underscore (max 32).'))
    .max(10)
    .superRefine((list, ctx) => {
      if (new Set(list).size !== list.length) {
        ctx.addIssue({ code: 'custom', message: 'Duplicate tags.' });
      }
    });

  const rollout = z
    .array(z.object({ variation: variationKey, weight: z.number().int().min(0).max(100000) }).strict())
    .min(1)
    .max(env.MAX_VARIATIONS)
    .superRefine((list, ctx) => {
      const total = list.reduce((sum, bucket) => sum + bucket.weight, 0);
      if (total !== 100000) {
        ctx.addIssue({ code: 'custom', message: `Rollout weights must add up to exactly 100000 (got ${total}).` });
      }
      const seen = new Set();
      list.forEach((bucket, i) => {
        if (seen.has(bucket.variation)) {
          ctx.addIssue({ code: 'custom', path: [i, 'variation'], message: 'Duplicate variation in rollout.' });
        }
        seen.add(bucket.variation);
      });
    });

  const serve = z
    .object({ variation: variationKey.optional(), rollout: rollout.optional() })
    .strict()
    .superRefine((value, ctx) => {
      if ((value.variation === undefined) === (value.rollout === undefined)) {
        ctx.addIssue({ code: 'custom', message: 'Provide either "variation" or "rollout", not both.' });
      }
    });

  const condition = z
    .object({
      attribute: z.string().regex(ATTRIBUTE, 'Attribute names use letters, digits, dot, hyphen, underscore.'),
      operator: z.enum(OPERATORS),
      values: z.array(scalar).min(1).max(env.MAX_VALUES_PER_CONDITION),
    })
    .strict()
    .superRefine((c, ctx) => {
      if (c.operator === 'gt' || c.operator === 'lt') {
        const [first] = c.values;
        if (c.values.length !== 1 || (typeof first !== 'number' && typeof first !== 'string')) {
          ctx.addIssue({ code: 'custom', path: ['values'], message: 'gt and lt need exactly one number or string.' });
        }
      }
      if (c.operator === 'startsWith' && !c.values.every((v) => typeof v === 'string')) {
        ctx.addIssue({ code: 'custom', path: ['values'], message: 'startsWith values must be strings.' });
      }
    });

  const rule = z
    .object({
      id: z.string().regex(RULE_ID, 'Rule ids use letters, digits, hyphen, underscore (max 64).'),
      conditions: z.array(condition).min(1).max(env.MAX_CONDITIONS_PER_RULE),
      serve,
    })
    .strict();

  const envConfig = z
    .object({
      enabled: z.boolean(),
      offVariation: variationKey,
      fallthrough: serve,
      rules: z
        .array(rule)
        .max(env.MAX_RULES_PER_ENV)
        .superRefine((list, ctx) => {
          const seen = new Set();
          list.forEach((item, i) => {
            if (seen.has(item.id)) {
              ctx.addIssue({ code: 'custom', path: [i, 'id'], message: 'Duplicate rule id.' });
            }
            seen.add(item.id);
          });
        }),
      expectedVersion: z.number().int().min(1).optional(),
    })
    .strict();

  const goalMetricKey = z.string().regex(METRIC_KEY, 'Metric keys are lowercase letters, digits, hyphen, underscore, dot.');

  const createFlag = z
    .object({
      key: flagKey,
      name: z.string().trim().min(1).max(80),
      description: z.string().max(500).default(''),
      tags: tags.default([]),
      variations,
      isExperiment: z.boolean().default(false),
      goalMetricKey: goalMetricKey.nullable().default(null),
      offVariation: variationKey.optional(),
      defaultVariation: variationKey.optional(),
    })
    .strict()
    .superRefine((flag, ctx) => {
      if (flag.isExperiment && !flag.goalMetricKey) {
        ctx.addIssue({ code: 'custom', path: ['goalMetricKey'], message: 'An experiment needs a goal metric key.' });
      }
      if (!flag.isExperiment && flag.goalMetricKey) {
        ctx.addIssue({ code: 'custom', path: ['goalMetricKey'], message: 'Only experiments have a goal metric key.' });
      }
    });

  const updateFlag = z
    .object({
      name: z.string().trim().min(1).max(80).optional(),
      description: z.string().max(500).optional(),
      tags: tags.optional(),
      variations: variations.optional(),
      isExperiment: z.boolean().optional(),
      goalMetricKey: goalMetricKey.nullable().optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to change.');

  // z.any() keeps the raw object. z.record() would silently drop a "__proto__" key
  // before any refine runs, hiding exactly the key we want to reject.
  const userContext = z.any().superRefine((value, ctx) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      ctx.addIssue({ code: 'custom', message: 'userContext must be an object.' });
      return;
    }
    if (Object.keys(value).some((key) => key.length > 100)) {
      ctx.addIssue({ code: 'custom', message: 'User context keys must be at most 100 characters.' });
    }
    if (hasDangerousKey(value)) {
      ctx.addIssue({ code: 'custom', message: 'User context contains a forbidden key or is nested too deeply.' });
    }
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > env.MAX_USER_CONTEXT_BYTES) {
      ctx.addIssue({ code: 'custom', message: `User context must be at most ${env.MAX_USER_CONTEXT_BYTES} bytes.` });
    }
  });

  return {
    flagParams: z.object({ key: flagKey }),
    flagEnvParams: z.object({ key: flagKey, envKey: flagKey }),
    listQuery: z
      .object({
        search: z.string().trim().max(100).optional(),
        tag: z.string().regex(TAG).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      })
      .strict(),
    auditQuery: z
      .object({
        flag: flagKey.optional(),
        env: flagKey.optional(),
        before: z.string().datetime().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .strict(),
    createFlag,
    updateFlag,
    envConfig,
    evaluateTest: z.object({ userContext }).strict(),
  };
}
