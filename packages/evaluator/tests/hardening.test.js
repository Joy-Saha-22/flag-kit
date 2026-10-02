import { describe, it, expect } from 'vitest';
import { evaluate } from '../src/evaluate.js';
import { murmur3_32, bucketForUser, ROLLOUT_BUCKETS } from '../src/hash.js';

const flag = { key: 'checkout', variations: [{ key: 'on' }, { key: 'off' }] };
const rollout30 = {
  rollout: [
    { variation: 'on', weight: 30000 },
    { variation: 'off', weight: 70000 },
  ],
};
const env = (over = {}) => ({
  enabled: true,
  offVariation: 'off',
  salt: 'prod',
  fallthrough: rollout30,
  rules: [],
  ...over,
});

describe('missing inputs', () => {
  it('returns user_key_missing when a rollout has no user key', () => {
    const expected = { variation: null, reason: { kind: 'error', errorKind: 'user_key_missing' } };
    expect(evaluate(flag, env(), {})).toEqual(expected);
    expect(evaluate(flag, env(), { key: '' })).toEqual(expected);
  });

  it('still serves a single variation when there is no user key', () => {
    const result = evaluate(flag, env({ fallthrough: { variation: 'on' } }), {});
    expect(result).toEqual({ variation: 'on', reason: { kind: 'fallthrough' } });
  });

  it('returns salt_missing when the salt is empty or absent', () => {
    const expected = { variation: null, reason: { kind: 'error', errorKind: 'salt_missing' } };
    expect(evaluate(flag, env({ salt: '' }), { key: 'u1' })).toEqual(expected);
    const { salt, ...withoutSalt } = env();
    expect(evaluate(flag, withoutSalt, { key: 'u1' })).toEqual(expected);
  });

  it('is off unless enabled is exactly true', () => {
    const { enabled, ...withoutEnabled } = env();
    const off = { variation: 'off', reason: { kind: 'off' } };
    expect(evaluate(flag, withoutEnabled, { key: 'u1' })).toEqual(off);
    expect(evaluate(flag, env({ enabled: false }), { key: 'u1' })).toEqual(off);
  });
});

describe('attribute matching', () => {
  const serveOn = { variation: 'on' };
  const fallOff = { variation: 'off' };

  it('does not read inherited properties through a dotted path', () => {
    const rule = {
      id: 'r1',
      conditions: [{ attribute: 'constructor.name', operator: 'equals', values: ['Object'] }],
      serve: serveOn,
    };
    const result = evaluate(flag, env({ rules: [rule], fallthrough: fallOff }), { key: 'u1' });
    expect(result).toEqual({ variation: 'off', reason: { kind: 'fallthrough' } });
  });

  it('notEquals does not match when the attribute is missing', () => {
    const rule = {
      id: 'r2',
      conditions: [{ attribute: 'country', operator: 'notEquals', values: ['US'] }],
      serve: serveOn,
    };
    const e = env({ rules: [rule], fallthrough: fallOff });
    expect(evaluate(flag, e, { key: 'u1' })).toEqual({ variation: 'off', reason: { kind: 'fallthrough' } });
    expect(evaluate(flag, e, { key: 'u1', country: 'IN' })).toEqual({
      variation: 'on',
      reason: { kind: 'rule', ruleId: 'r2' },
    });
  });
});

describe('golden buckets', () => {
  const cases = [
    ['homepage-hero', 'prod', 'user-1', 73310],
    ['homepage-hero', 'prod', 'user-2', 68077],
    ['homepage-hero', 'dev', 'user-1', 98601],
    ['new-checkout', 'prod', 'alice@example.com', 16251],
    ['new-checkout', 'staging', 'bob', 7955],
  ];

  it('maps fixed inputs to fixed buckets', () => {
    for (const [flagKey, salt, userKey, bucket] of cases) {
      expect(bucketForUser(flagKey, salt, userKey)).toBe(bucket);
    }
  });

  it('gives the same user different buckets in different environments', () => {
    expect(bucketForUser('homepage-hero', 'prod', 'user-1')).not.toBe(
      bucketForUser('homepage-hero', 'dev', 'user-1'),
    );
  });

  it('serves fixed users fixed variations in a 30% rollout', () => {
    // buckets: u4 -> 26809 (< 30000), u0 -> 41070 (>= 30000)
    expect(evaluate(flag, env(), { key: 'u4' }).variation).toBe('on');
    expect(evaluate(flag, env(), { key: 'u0' }).variation).toBe('off');
  });

  it('always returns a bucket from 0 to 99999', () => {
    for (let i = 0; i < 2000; i += 1) {
      const bucket = bucketForUser('checkout', 'prod', `user-${i}`);
      expect(Number.isInteger(bucket)).toBe(true);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThanOrEqual(ROLLOUT_BUCKETS - 1);
    }
  });
});

describe('murmur3_32 reference vectors', () => {
  const vectors = [
    ['', 0, 0x00000000],
    ['', 1, 0x514e28b7],
    ['test', 0, 0xba6bd213],
    ['Hello, world!', 0, 0xc0363e43],
    ['The quick brown fox jumps over the lazy dog', 0, 0x2e4ff723],
  ];

  it('matches the published MurmurHash3 x86_32 values', () => {
    for (const [input, seed, expected] of vectors) {
      expect(murmur3_32(input, seed)).toBe(expected);
    }
  });
});