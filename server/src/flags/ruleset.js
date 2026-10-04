/**
 * Pure helpers that turn stored flag documents into the shapes the API returns
 * and the shape SDKs receive. No I/O here.
 */

export function normalizeServe(serve) {
  if (serve && Array.isArray(serve.rollout) && serve.rollout.length > 0) {
    return { rollout: serve.rollout.map((b) => ({ variation: b.variation, weight: b.weight })) };
  }
  return { variation: serve?.variation ?? null };
}

function normalizeRule(rule) {
  return {
    id: rule.id,
    conditions: (rule.conditions ?? []).map((c) => ({
      attribute: c.attribute,
      operator: c.operator,
      values: [...(c.values ?? [])],
    })),
    serve: normalizeServe(rule.serve),
  };
}

export function normalizeEnvConfig(config) {
  return {
    enabled: config?.enabled === true,
    offVariation: config?.offVariation ?? null,
    fallthrough: normalizeServe(config?.fallthrough),
    rules: (config?.rules ?? []).map(normalizeRule),
    version: config?.version ?? 1,
  };
}

/** Full flag as returned by the dashboard API. */
export function serializeFlag(doc) {
  return {
    id: String(doc._id),
    key: doc.key,
    name: doc.name,
    description: doc.description ?? '',
    tags: [...(doc.tags ?? [])],
    variations: (doc.variations ?? []).map((v) => ({ key: v.key, name: v.name, value: v.value })),
    isExperiment: doc.isExperiment === true,
    goalMetricKey: doc.goalMetricKey ?? null,
    environments: Object.fromEntries(
      Object.entries(doc.environments ?? {}).map(([envKey, config]) => [envKey, normalizeEnvConfig(config)]),
    ),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/** Short form for the flags list. */
export function summarizeFlag(doc) {
  return {
    id: String(doc._id),
    key: doc.key,
    name: doc.name,
    description: doc.description ?? '',
    tags: [...(doc.tags ?? [])],
    isExperiment: doc.isExperiment === true,
    goalMetricKey: doc.goalMetricKey ?? null,
    environments: Object.fromEntries(
      Object.entries(doc.environments ?? {}).map(([envKey, config]) => [
        envKey,
        { enabled: config?.enabled === true, version: config?.version ?? 1 },
      ]),
    ),
    updatedAt: doc.updatedAt,
  };
}

/** One flag as SDKs see it for a single environment. The salt is the environment key. */
export function buildRulesetFlag(doc, envKey) {
  const config = normalizeEnvConfig(doc.environments[envKey]);
  return {
    key: doc.key,
    variations: (doc.variations ?? []).map((v) => ({ key: v.key, value: v.value })),
    isExperiment: doc.isExperiment === true,
    goalMetricKey: doc.goalMetricKey ?? null,
    enabled: config.enabled,
    offVariation: config.offVariation,
    fallthrough: config.fallthrough,
    rules: config.rules,
    salt: envKey,
    version: config.version,
  };
}

/** The full ruleset for one environment. */
export function buildRuleset({ version, envKey, flags }) {
  return {
    version,
    flags: flags
      .filter((doc) => doc.environments?.[envKey])
      .map((doc) => buildRulesetFlag(doc, envKey))
      .sort((a, b) => a.key.localeCompare(b.key)),
  };
}

/** Starting config for every environment when a flag is created: off, serving the default. */
export function defaultEnvConfig({ offVariation, defaultVariation }) {
  return {
    enabled: false,
    offVariation,
    fallthrough: { variation: defaultVariation },
    rules: [],
    version: 1,
  };
}
