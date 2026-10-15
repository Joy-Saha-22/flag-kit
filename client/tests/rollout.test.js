import { describe, expect, it } from 'vitest';
import { percentagesToRollout } from '../src/lib/rollout';

describe('percentagesToRollout', () => {
  it('converts repeating decimal percentages and assigns rounding remainder to the largest bucket', () => {
    const result = percentagesToRollout([
      { variation: 'a', percent: '33.333' },
      { variation: 'b', percent: '33.333' },
      { variation: 'c', percent: '33.334' },
    ]);

    expect(result.rollout).toEqual([
      { variation: 'a', weight: 33333 },
      { variation: 'b', weight: 33333 },
      { variation: 'c', weight: 33334 },
    ]);
    expect(result.rollout.reduce((sum, bucket) => sum + bucket.weight, 0)).toBe(100000);
  });

  it('rejects totals that do not reach 100 percent', () => {
    expect(percentagesToRollout([
      { variation: 'a', percent: 40 },
      { variation: 'b', percent: 59.9 },
    ])).toMatchObject({ error: 'Rollout percentages must add up to exactly 100.' });
  });

  it('assigns a rounding remainder to the largest percentage bucket', () => {
    expect(percentagesToRollout([
      { variation: 'largest', percent: '33.3334' },
      { variation: 'second', percent: '33.3333' },
      { variation: 'third', percent: '33.3333' },
    ]).rollout).toEqual([
      { variation: 'largest', weight: 33334 },
      { variation: 'second', weight: 33333 },
      { variation: 'third', weight: 33333 },
    ]);
  });

  it('rejects repeated variations and invalid percentages', () => {
    expect(percentagesToRollout([
      { variation: 'a', percent: 50 },
      { variation: 'a', percent: 50 },
    ]).error).toContain('same variation twice');
    expect(percentagesToRollout([{ variation: 'a', percent: 101 }]).error).toContain('from 0 to 100');
  });
});
