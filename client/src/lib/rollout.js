/**
 * Convert percentage values into the evaluator's 100000-point scale.
 * @param {Array<{variation: string, percent: number|string}>} buckets
 * @returns {{rollout?: Array<{variation: string, weight: number}>, error?: string}}
 */
export function percentagesToRollout(buckets) {
  if (!Array.isArray(buckets) || buckets.length === 0) {
    return { error: 'Add at least one variation to the rollout.' };
  }

  const normalized = buckets.map(({ variation, percent }) => ({
    variation,
    percent: typeof percent === 'number' ? percent : Number(percent),
  }));

  if (normalized.some(({ variation, percent }) => !variation || !Number.isFinite(percent) || percent < 0 || percent > 100)) {
    return { error: 'Each percentage must be a number from 0 to 100.' };
  }

  if (new Set(normalized.map(({ variation }) => variation)).size !== normalized.length) {
    return { error: 'A rollout cannot contain the same variation twice.' };
  }

  const total = normalized.reduce((sum, { percent }) => sum + percent, 0);
  if (Math.abs(total - 100) > 1e-9) {
    return { error: 'Rollout percentages must add up to exactly 100.' };
  }

  const weights = normalized.map(({ variation, percent }) => ({
    variation,
    weight: Math.round(percent * 1000),
  }));
  const remainder = 100000 - weights.reduce((sum, { weight }) => sum + weight, 0);
  const largestIndex = normalized.reduce(
    (bestIndex, bucket, index) => (bucket.percent > normalized[bestIndex].percent ? index : bestIndex),
    0,
  );
  weights[largestIndex].weight += remainder;

  if (weights.some(({ weight }) => weight < 0 || weight > 100000)) {
    return { error: 'Rollout percentages cannot be represented as valid weights.' };
  }

  return { rollout: weights };
}

/**
 * Present server weights as percentages for an editor.
 * @param {{rollout?: Array<{variation: string, weight: number}>, variation?: string}} serve
 * @param {string[]} variationKeys
 * @returns {Array<{variation: string, percent: string}>}
 */
export function serveToPercentages(serve, variationKeys) {
  if (serve?.rollout) {
    return variationKeys.map((variation) => {
      const bucket = serve.rollout.find((item) => item.variation === variation);
      return { variation, percent: bucket ? String(bucket.weight / 1000) : '0' };
    });
  }
  return variationKeys.map((variation) => ({
    variation,
    percent: variation === serve?.variation ? '100' : '0',
  }));
}
