/**
 * Experiment statistics: conversion rate per variation and a two-sided,
 * two-proportion z-test of each variation against the first one (the control).
 * Pure functions, no I/O.
 */

const SQRT_PI = Math.sqrt(Math.PI);
export const Z_95 = 1.959963984540054;
export const ALPHA = 0.05;

/**
 * Complementary error function. A positive-term series for small x (no cancellation)
 * and a continued fraction for the tail, so small p-values keep their precision.
 * @param {number} x
 * @returns {number}
 */
export function erfc(x) {
  if (Number.isNaN(x)) {
    return NaN;
  }
  if (x < 0) {
    return 2 - erfc(-x);
  }
  if (x < 3) {
    // erf(x) = 2/sqrt(pi) * exp(-x^2) * sum( 2^n x^(2n+1) / (1*3*5*...*(2n+1)) )
    let term = x;
    let sum = x;
    for (let n = 1; n < 200; n += 1) {
      term *= (2 * x * x) / (2 * n + 1);
      sum += term;
      if (term < sum * 1e-17) {
        break;
      }
    }
    return 1 - (2 / SQRT_PI) * Math.exp(-x * x) * sum;
  }
  if (x > 27) {
    return 0;
  }
  // erfc(x) = exp(-x^2) / (x sqrt(pi)) * 1 / (1 + (1/(2x^2)) / (1 + (2/(2x^2)) / (1 + ...)))
  const a = 1 / (2 * x * x);
  let fraction = 1;
  for (let k = 120; k >= 1; k -= 1) {
    fraction = 1 + (k * a) / fraction;
  }
  return Math.exp(-x * x) / (x * SQRT_PI * fraction);
}

/** Two-sided p-value for a standard normal z statistic. */
export function twoSidedPValue(z) {
  return erfc(Math.abs(z) / Math.SQRT2);
}

/**
 * @param {{ exposures: number, conversions: number }} control
 * @param {{ exposures: number, conversions: number }} variant
 * @param {number} minSample
 */
function compareToControl(control, variant, minSample) {
  const n1 = control.exposures;
  const n2 = variant.exposures;
  if (n1 === 0 || n2 === 0) {
    return { lift: null, difference: null, ci95: null, pValue: null, significant: false, sampleSizeOk: false };
  }
  const p1 = control.conversions / n1;
  const p2 = variant.conversions / n2;
  const difference = p2 - p1;

  const pooled = (control.conversions + variant.conversions) / (n1 + n2);
  const pooledSe = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  let pValue = null;
  if (pooledSe > 0) {
    pValue = twoSidedPValue(difference / pooledSe);
  } else if (difference === 0) {
    pValue = 1; // identical rates and no variation at all (for example 0 conversions in both)
  }

  const unpooledSe = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2);
  // Rule of thumb for the normal approximation: enough users and at least a few conversions.
  const sampleSizeOk = n1 >= minSample && n2 >= minSample && control.conversions + variant.conversions >= 5;

  return {
    lift: p1 === 0 ? null : difference / p1,
    difference,
    ci95: [difference - Z_95 * unpooledSe, difference + Z_95 * unpooledSe],
    pValue,
    significant: pValue !== null && pValue < ALPHA && sampleSizeOk,
    sampleSizeOk,
  };
}

/**
 * @param {{ flagKey: string, envKey: string, goalMetricKey: string | null, variations: string[], counts: Array<{ variation: string, exposures: number, conversions: number }>, minSample?: number }} input
 */
export function computeResults({ flagKey, envKey, goalMetricKey, variations, counts, minSample = 30 }) {
  const byVariation = new Map(counts.map((row) => [row.variation, row]));
  const rows = variations.map((key) => ({
    key,
    exposures: byVariation.get(key)?.exposures ?? 0,
    conversions: byVariation.get(key)?.conversions ?? 0,
  }));
  const control = rows[0];
  return {
    flagKey,
    env: envKey,
    goalMetricKey,
    control: control.key,
    alpha: ALPHA,
    variations: rows.map((row, i) => ({
      ...row,
      rate: row.exposures === 0 ? null : row.conversions / row.exposures,
      vsControl: i === 0 ? null : compareToControl(control, row, minSample),
    })),
  };
}