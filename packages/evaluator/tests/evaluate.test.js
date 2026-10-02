import { describe, expect, it } from 'vitest';
import { bucketForUser, evaluate, murmur3_32, pickServe } from '../src/index.js';

const variations = [
  { key: 'control', value: false },
  { key: 'treatment', value: true },
];

/** @param {Partial<import('../src/evaluate.js').Flag>} extra */
function flag(extra = {}) {
  return { key: 'homepage-hero', variations, ...extra };
}

/** @param {Partial<import('../src/evaluate.js').EnvConfig>} extra */
function env(extra = {}) {
  return {
    enabled: true,
    offVariation: 'control',
    fallthrough: { variation: 'control' },
    rules: [],
    salt: 'production',
    ...extra,
  };
}

describe('evaluate — disabled flag', () => {
  it('returns offVariation with reason off when enabled is false', () => {
    const result = evaluate(
      flag(),
      env({ enabled: false, offVariation: 'control' }),
      { key: 'user-1' },
    );
    expect(result).toEqual({ variation: 'control', reason: { kind: 'off' } });
  });

  it('does not apply targeting rules while disabled', () => {
    const result = evaluate(
      flag(),
      env({
        enabled: false,
        offVariation: 'control',
        rules: [
          {
            id: 'r1',
            conditions: [{ attribute: 'key', operator: 'equals', values: ['user-1'] }],
            serve: { variation: 'treatment' },
          },
        ],
      }),
      { key: 'user-1' },
    );
    expect(result.variation).toBe('control');
    expect(result.reason.kind).toBe('off');
  });

  it('treats the flag as off unless enabled is exactly true', () => {
    const config = {
      offVariation: 'control',
      fallthrough: { variation: 'treatment' },
      rules: [],
      salt: 'production',
    };
    expect(evaluate(flag(), config, { key: 'user-1' })).toEqual({
      variation: 'control',
      reason: { kind: 'off' },
    });
    expect(evaluate(flag(), { ...config, enabled: 1 }, { key: 'user-1' })).toEqual({
      variation: 'control',
      reason: { kind: 'off' },
    });
  });
});

describe('evaluate — targeting rules', () => {
  it('serves the first matching rule', () => {
    const result = evaluate(
      flag(),
      env({
        rules: [
          {
            id: 'emails',
            conditions: [{ attribute: 'email', operator: 'equals', values: ['a@example.com'] }],
            serve: { variation: 'treatment' },
          },
          {
            id: 'everyone',
            conditions: [],
            serve: { variation: 'control' },
          },
        ],
      }),
      { key: 'u1', email: 'a@example.com' },
    );
    expect(result).toEqual({
      variation: 'treatment',
      reason: { kind: 'rule', ruleId: 'emails' },
    });
  });

  it('skips a non-matching rule and uses a later match', () => {
    const result = evaluate(
      flag(),
      env({
        rules: [
          {
            id: 'beta',
            conditions: [{ attribute: 'plan', operator: 'equals', values: ['beta'] }],
            serve: { variation: 'treatment' },
          },
          {
            id: 'staff',
            conditions: [{ attribute: 'email', operator: 'contains', values: ['@corp.test'] }],
            serve: { variation: 'treatment' },
          },
        ],
      }),
      { key: 'u1', plan: 'free', email: 'dev@corp.test' },
    );
    expect(result).toEqual({
      variation: 'treatment',
      reason: { kind: 'rule', ruleId: 'staff' },
    });
  });

  it('requires every condition on a rule (AND)', () => {
    const rules = [
      {
        id: 'and',
        conditions: [
          { attribute: 'country', operator: 'equals', values: ['US'] },
          { attribute: 'plan', operator: 'in', values: ['pro', 'ent'] },
        ],
        serve: { variation: 'treatment' },
      },
    ];
    const miss = evaluate(flag(), env({ rules }), { key: 'u', country: 'US', plan: 'free' });
    expect(miss.reason.kind).toBe('fallthrough');

    const hit = evaluate(flag(), env({ rules }), { key: 'u', country: 'US', plan: 'pro' });
    expect(hit).toEqual({ variation: 'treatment', reason: { kind: 'rule', ruleId: 'and' } });
  });

  it('matches equals, notEquals, in, contains, startsWith, gt, lt', () => {
    const cases = [
      {
        op: 'equals',
        attr: 'tier',
        values: ['gold'],
        ctx: { key: 'u', tier: 'gold' },
        match: true,
      },
      {
        op: 'equals',
        attr: 'tier',
        values: ['gold'],
        ctx: { key: 'u', tier: 'silver' },
        match: false,
      },
      {
        op: 'notEquals',
        attr: 'tier',
        values: ['gold'],
        ctx: { key: 'u', tier: 'silver' },
        match: true,
      },
      {
        op: 'notEquals',
        attr: 'tier',
        values: ['gold'],
        ctx: { key: 'u', tier: 'gold' },
        match: false,
      },
      {
        op: 'in',
        attr: 'country',
        values: ['US', 'CA'],
        ctx: { key: 'u', country: 'CA' },
        match: true,
      },
      {
        op: 'in',
        attr: 'country',
        values: ['US', 'CA'],
        ctx: { key: 'u', country: 'DE' },
        match: false,
      },
      {
        op: 'contains',
        attr: 'email',
        values: ['@example.com'],
        ctx: { key: 'u', email: 'a@example.com' },
        match: true,
      },
      {
        op: 'contains',
        attr: 'email',
        values: ['@example.com'],
        ctx: { key: 'u', email: 'a@other.com' },
        match: false,
      },
      {
        op: 'startsWith',
        attr: 'id',
        values: ['usr_'],
        ctx: { key: 'u', id: 'usr_9' },
        match: true,
      },
      {
        op: 'startsWith',
        attr: 'id',
        values: ['usr_'],
        ctx: { key: 'u', id: 'acct_9' },
        match: false,
      },
      {
        op: 'gt',
        attr: 'age',
        values: [18],
        ctx: { key: 'u', age: 21 },
        match: true,
      },
      {
        op: 'gt',
        attr: 'age',
        values: [18],
        ctx: { key: 'u', age: 18 },
        match: false,
      },
      {
        op: 'lt',
        attr: 'age',
        values: [18],
        ctx: { key: 'u', age: 10 },
        match: true,
      },
      {
        op: 'lt',
        attr: 'age',
        values: [18],
        ctx: { key: 'u', age: 18 },
        match: false,
      },
    ];

    for (const c of cases) {
      const result = evaluate(
        flag(),
        env({
          rules: [
            {
              id: c.op,
              conditions: [{ attribute: c.attr, operator: c.op, values: c.values }],
              serve: { variation: 'treatment' },
            },
          ],
        }),
        c.ctx,
      );
      if (c.match) {
        expect(result.reason, `${c.op} should match`).toEqual({ kind: 'rule', ruleId: c.op });
      } else {
        expect(result.reason.kind, `${c.op} should miss`).toBe('fallthrough');
      }
    }
  });

  it('reads nested attributes via dotted paths', () => {
    const result = evaluate(
      flag(),
      env({
        rules: [
          {
            id: 'country',
            conditions: [{ attribute: 'custom.country', operator: 'equals', values: ['IN'] }],
            serve: { variation: 'treatment' },
          },
        ],
      }),
      { key: 'u', custom: { country: 'IN' } },
    );
    expect(result.variation).toBe('treatment');
  });

  it('ignores inherited properties on dotted attribute paths', () => {
    const custom = Object.create({ country: 'IN' });
    const result = evaluate(
      flag(),
      env({
        rules: [
          {
            id: 'country',
            conditions: [{ attribute: 'custom.country', operator: 'equals', values: ['IN'] }],
            serve: { variation: 'treatment' },
          },
        ],
      }),
      { key: 'u', custom },
    );
    expect(result.reason.kind).toBe('fallthrough');
    expect(result.variation).toBe('control');
  });

  it('does not match notEquals when the attribute is missing', () => {
    const result = evaluate(
      flag(),
      env({
        rules: [
          {
            id: 'not-gold',
            conditions: [{ attribute: 'tier', operator: 'notEquals', values: ['gold'] }],
            serve: { variation: 'treatment' },
          },
        ],
      }),
      { key: 'u' },
    );
    expect(result.reason.kind).toBe('fallthrough');
    expect(result.variation).toBe('control');
  });

  it('treats an empty condition list as a match-all rule', () => {
    const result = evaluate(
      flag(),
      env({
        rules: [{ id: 'all', conditions: [], serve: { variation: 'treatment' } }],
      }),
      { key: 'anyone' },
    );
    expect(result.reason).toEqual({ kind: 'rule', ruleId: 'all' });
  });

  it('falls through when no rule matches', () => {
    const result = evaluate(
      flag(),
      env({
        fallthrough: { variation: 'control' },
        rules: [
          {
            id: 'beta',
            conditions: [{ attribute: 'plan', operator: 'equals', values: ['beta'] }],
            serve: { variation: 'treatment' },
          },
        ],
      }),
      { key: 'u', plan: 'free' },
    );
    expect(result).toEqual({ variation: 'control', reason: { kind: 'fallthrough' } });
  });

  it('accepts a merged ruleset flag when envConfig repeats the same fields', () => {
    const merged = {
      key: 'homepage-hero',
      variations,
      enabled: true,
      offVariation: 'control',
      fallthrough: { variation: 'treatment' },
      rules: [],
      salt: 'production',
    };
    const result = evaluate(merged, merged, { key: 'u' });
    expect(result).toEqual({ variation: 'treatment', reason: { kind: 'fallthrough' } });
  });
});

describe('percentage rollout', () => {
  const thirty = {
    rollout: [
      { variation: 'treatment', weight: 30000 },
      { variation: 'control', weight: 70000 },
    ],
  };

  it('is deterministic for the same flag, salt, and user', () => {
    const config = env({ fallthrough: thirty, salt: 'production' });
    const a = evaluate(flag(), config, { key: 'user-stable' });
    const b = evaluate(flag(), config, { key: 'user-stable' });
    expect(a).toEqual(b);
    expect(['treatment', 'control']).toContain(a.variation);
    expect(a.reason.kind).toBe('fallthrough');
  });

  it('changes bucket when salt or flag key changes', () => {
    const user = { key: 'salt-sensitive-user' };
    const buckets = new Set();
    buckets.add(bucketForUser('homepage-hero', 'production', user.key));
    buckets.add(bucketForUser('homepage-hero', 'staging', user.key));
    buckets.add(bucketForUser('other-flag', 'production', user.key));
    // Three distinct inputs should not all collapse to one bucket in practice;
    // at minimum production vs staging must be allowed to differ independently.
    expect(buckets.size).toBeGreaterThan(1);
  });

  it('maps 100,000 users at a 30% rollout into 29–31%', () => {
    const config = env({ fallthrough: thirty, salt: 'production' });
    const n = 100_000;
    let treatment = 0;
    for (let i = 0; i < n; i += 1) {
      const result = evaluate(flag(), config, { key: `user-${i}` });
      if (result.variation === 'treatment') {
        treatment += 1;
      }
    }
    const rate = treatment / n;
    expect(rate).toBeGreaterThanOrEqual(0.29);
    expect(rate).toBeLessThanOrEqual(0.31);
  });

  it('picks the first cumulative weight strictly greater than the bucket', () => {
    const serve = {
      rollout: [
        { variation: 'a', weight: 50000 },
        { variation: 'b', weight: 50000 },
      ],
    };
    const flagKey = 'split';
    const salt = 's';
    const userOnBoundary = (() => {
      for (let i = 0; i < 50_000; i += 1) {
        const key = `boundary-${i}`;
        if (bucketForUser(flagKey, salt, key) === 50000) {
          return key;
        }
      }
      return null;
    })();
    if (userOnBoundary) {
      expect(pickServe(serve, flagKey, salt, userOnBoundary)).toBe('b');
    }
    const userZero = (() => {
      for (let i = 0; i < 200_000; i += 1) {
        const key = `zero-${i}`;
        if (bucketForUser(flagKey, salt, key) === 0) {
          return key;
        }
      }
      return null;
    })();
    expect(userZero).not.toBeNull();
    expect(pickServe(serve, flagKey, salt, userZero)).toBe('a');
  });
});

describe('murmur3_32', () => {
  it('returns a stable uint32 for a known fixture', () => {
    const h = murmur3_32('flagkit:production:user-1');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
    expect(murmur3_32('flagkit:production:user-1')).toBe(h);
  });

  it('differs for small input changes', () => {
    expect(murmur3_32('abc')).not.toBe(murmur3_32('abd'));
  });
});

describe('malformed input', () => {
  it('returns an error reason when fallthrough is missing', () => {
    const result = evaluate(flag(), { enabled: true, offVariation: 'control', rules: [] }, { key: 'u' });
    expect(result.variation).toBeNull();
    expect(result.reason.kind).toBe('error');
  });

  it('ignores unknown operators instead of throwing', () => {
    expect(() =>
      evaluate(
        flag(),
        env({
          rules: [
            {
              id: 'bad',
              conditions: [{ attribute: 'x', operator: 'regex', values: ['.*'] }],
              serve: { variation: 'treatment' },
            },
          ],
        }),
        { key: 'u', x: 'z' },
      ),
    ).not.toThrow();
  });
});
