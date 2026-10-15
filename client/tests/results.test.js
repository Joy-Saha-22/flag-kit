import { describe, expect, it } from 'vitest';
import {
  formatConfidenceInterval,
  formatDifference,
  formatLift,
  formatPValue,
  formatRate,
  getVerdict,
} from '../src/lib/results';

describe('experiment result formatting', () => {
  it('formats rates, lifts, differences, intervals, and p-values', () => {
    expect(formatRate(0.1)).toBe('10.00%');
    expect(formatLift(0.125)).toBe('12.50%');
    expect(formatDifference(0.025)).toBe('2.50 pp');
    expect(formatConfidenceInterval([0.04, 0.16])).toBe('4.00% to 16.00%');
    expect(formatPValue(0.02346)).toBe('0.0235');
    expect(formatPValue(0.00001)).toBe('< 0.0001');
  });

  it('reports insufficient sample size before significance', () => {
    expect(getVerdict({ sampleSizeOk: false, significant: true })).toBe('Not enough data yet');
    expect(getVerdict({ sampleSizeOk: true, significant: true })).toBe('Significant');
    expect(getVerdict({ sampleSizeOk: true, significant: false })).toBe('Not significant');
    expect(getVerdict(null)).toBeNull();
  });
});
