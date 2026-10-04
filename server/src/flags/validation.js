/**
 * Checks that depend on the flag a config belongs to. Shape checks (types,
 * lengths, weights summing to 100000) live in the zod schemas.
 */

/** Every variation key an environment config points at. */
export function referencedVariations(config) {
  const keys = new Set();
  const addServe = (serve) => {
    if (serve?.variation) {
      keys.add(serve.variation);
    }
    for (const bucket of serve?.rollout ?? []) {
      keys.add(bucket.variation);
    }
  };
  if (config?.offVariation) {
    keys.add(config.offVariation);
  }
  addServe(config?.fallthrough);
  for (const rule of config?.rules ?? []) {
    addServe(rule.serve);
  }
  return keys;
}

/**
 * @param {any} config
 * @param {Set<string>} variationKeys keys that exist on the flag
 * @returns {{ path: string, message: string }[]}
 */
export function checkEnvConfig(config, variationKeys) {
  const issues = [];
  const unknown = (path, key) => {
    if (!variationKeys.has(key)) {
      issues.push({ path, message: `Unknown variation "${key}".` });
    }
  };
  const checkServe = (serve, base) => {
    if (serve?.variation) {
      unknown(`${base}.variation`, serve.variation);
    }
    (serve?.rollout ?? []).forEach((bucket, i) => unknown(`${base}.rollout.${i}.variation`, bucket.variation));
  };

  unknown('offVariation', config.offVariation);
  checkServe(config.fallthrough, 'fallthrough');
  (config.rules ?? []).forEach((rule, i) => {
    if ((rule.conditions ?? []).length === 0) {
      issues.push({ path: `rules.${i}.conditions`, message: 'A rule needs at least one condition.' });
    }
    checkServe(rule.serve, `rules.${i}.serve`);
  });
  return issues;
}
