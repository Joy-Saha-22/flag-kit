import { bucketForUser } from './hash.js';

/**
 * @typedef {object} Variation
 * @property {string} key
 * @property {unknown} [value]
 */

/**
 * @typedef {object} RolloutEntry
 * @property {string} variation
 * @property {number} weight
 */

/**
 * @typedef {{ variation: string } | { rollout: RolloutEntry[] }} Serve
 */

/**
 * @typedef {object} Condition
 * @property {string} attribute
 * @property {'equals'|'notEquals'|'in'|'contains'|'startsWith'|'gt'|'lt'} operator
 * @property {unknown[]} values
 */

/**
 * @typedef {object} TargetingRule
 * @property {string} id
 * @property {Condition[]} conditions
 * @property {Serve} serve
 */

/**
 * @typedef {object} EnvConfig
 * @property {boolean} [enabled]
 * @property {string} [offVariation]
 * @property {Serve} [fallthrough]
 * @property {TargetingRule[]} [rules]
 * @property {string} [salt] environment key used as rollout salt
 * @property {string} [envKey] alias for salt
 */

/**
 * @typedef {object} Flag
 * @property {string} [key]
 * @property {Variation[]} [variations]
 * @property {boolean} [enabled]
 * @property {string} [offVariation]
 * @property {Serve} [fallthrough]
 * @property {TargetingRule[]} [rules]
 * @property {string} [salt]
 * @property {string} [envKey]
 */

/**
 * @typedef {Record<string, unknown> & { key?: string, userKey?: string }} UserContext
 */

/**
 * @typedef {object} EvalReason
 * @property {'off'|'rule'|'fallthrough'|'error'} kind
 * @property {string} [ruleId]
 * @property {string} [errorKind]
 */

/**
 * @typedef {object} EvalResult
 * @property {string|null} variation
 * @property {EvalReason} reason
 */

/**
 * Walk a dotted path (`custom.country`) on a plain object.
 * Only own properties are visible, including at each nested step, so values
 * inherited from Object.prototype (e.g. `toString`, `__proto__`) cannot be
 * selected as targeting attributes.
 * @param {unknown} obj
 * @param {string} path
 * @returns {unknown}
 */
function getAttribute(obj, path) {
  if (obj == null || typeof path !== 'string' || path.length === 0) {
    return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(obj, path)) {
    return /** @type {Record<string, unknown>} */ (obj)[path];
  }
  const parts = path.split('.');
  let cur = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') {
      return undefined;
    }
    if (!Object.prototype.hasOwnProperty.call(cur, part)) {
      return undefined;
    }
    cur = /** @type {Record<string, unknown>} */ (cur)[part];
  }
  return cur;
}

/**
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function valuesEqual(a, b) {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) {
    return true;
  }
  return false;
}

/**
 * @param {unknown} value
 * @param {unknown[]} values
 * @returns {boolean}
 */
function valueInList(value, values) {
  if (!Array.isArray(values)) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => values.some((candidate) => valuesEqual(item, candidate)));
  }
  return values.some((candidate) => valuesEqual(value, candidate));
}

/**
 * @param {unknown} value
 * @param {unknown} other
 * @returns {number|null} negative if value < other, 0 if equal, positive if greater
 */
function compareOrdered(value, other) {
  if (typeof value === 'number' && typeof other === 'number') {
    if (!Number.isFinite(value) || !Number.isFinite(other)) {
      return null;
    }
    return value - other;
  }
  if (typeof value === 'string' && typeof other === 'string') {
    if (value < other) {
      return -1;
    }
    if (value > other) {
      return 1;
    }
    return 0;
  }
  return null;
}

/**
 * @param {unknown} attrValue
 * @param {Condition} condition
 * @returns {boolean}
 */
function conditionMatches(attrValue, condition) {
  const values = Array.isArray(condition.values) ? condition.values : [];
  const first = values[0];

  switch (condition.operator) {
    case 'equals':
      return valueInList(attrValue, values);
    case 'notEquals':
      // Missing attributes do not satisfy notEquals: absence is not a value
      // to compare, so the condition is a non-match rather than a match-all.
      if (attrValue === undefined) {
        return false;
      }
      return !valueInList(attrValue, values);
    case 'in':
      return valueInList(attrValue, values);
    case 'contains': {
      if (typeof attrValue === 'string') {
        return values.some((v) => typeof v === 'string' && attrValue.includes(v));
      }
      if (Array.isArray(attrValue)) {
        return valueInList(attrValue, values);
      }
      return false;
    }
    case 'startsWith': {
      if (typeof attrValue !== 'string') {
        return false;
      }
      return values.some((v) => typeof v === 'string' && attrValue.startsWith(v));
    }
    case 'gt': {
      const cmp = compareOrdered(attrValue, first);
      return cmp != null && cmp > 0;
    }
    case 'lt': {
      const cmp = compareOrdered(attrValue, first);
      return cmp != null && cmp < 0;
    }
    default:
      return false;
  }
}

/**
 * @param {TargetingRule} rule
 * @param {UserContext} userContext
 * @returns {boolean}
 */
function ruleMatches(rule, userContext) {
  const conditions = Array.isArray(rule.conditions) ? rule.conditions : [];
  if (conditions.length === 0) {
    return true;
  }
  return conditions.every((condition) => {
    const attrValue = getAttribute(userContext, condition.attribute);
    return conditionMatches(attrValue, condition);
  });
}

/**
 * Pick a variation from a Serve clause. Rollout uses cumulative weights
 * against a stable 0–99999 bucket (weights are expected to sum to 100000).
 *
 * @param {Serve|undefined} serve
 * @param {string} flagKey
 * @param {string} salt
 * @param {string} userKey
 * @returns {string|null}
 */
export function pickServe(serve, flagKey, salt, userKey) {
  if (serve == null || typeof serve !== 'object') {
    return null;
  }
  if ('variation' in serve && typeof serve.variation === 'string' && !('rollout' in serve && serve.rollout)) {
    return serve.variation;
  }
  const rollout = 'rollout' in serve ? serve.rollout : undefined;
  if (!Array.isArray(rollout) || rollout.length === 0) {
    if ('variation' in serve && typeof serve.variation === 'string') {
      return serve.variation;
    }
    return null;
  }

  const bucket = bucketForUser(flagKey, salt, userKey);
  let cumulative = 0;
  for (const entry of rollout) {
    if (!entry || typeof entry.weight !== 'number') {
      continue;
    }
    cumulative += entry.weight;
    if (cumulative > bucket) {
      return typeof entry.variation === 'string' ? entry.variation : null;
    }
  }
  const last = rollout[rollout.length - 1];
  return last && typeof last.variation === 'string' ? last.variation : null;
}

/**
 * @param {Serve|undefined} serve
 * @returns {boolean}
 */
function isRolloutServe(serve) {
  return Boolean(
    serve &&
      typeof serve === 'object' &&
      'rollout' in serve &&
      Array.isArray(serve.rollout) &&
      serve.rollout.length > 0,
  );
}

/**
 * Resolve salt so buckets stay stable per environment without baking secrets
 * into the hash input.
 *
 * @param {Flag} flag
 * @param {EnvConfig} envConfig
 * @returns {string}
 */
function resolveSalt(flag, envConfig) {
  const salt =
    envConfig.salt ??
    envConfig.envKey ??
    flag.salt ??
    flag.envKey ??
    '';
  return String(salt);
}

/**
 * Evaluate a flag for one user context.
 *
 * Pure on purpose: no I/O, clocks, or process-local randomness. Server, SDK,
 * and the dashboard "test evaluate" path all call this same function so a
 * given (flag, env config, user) tuple cannot disagree across processes.
 *
 * Order: disabled → offVariation; else first matching rule; else fallthrough.
 *
 * @param {Flag} flag
 * @param {EnvConfig} envConfig
 * @param {UserContext} [userContext]
 * @returns {EvalResult}
 */
export function evaluate(flag, envConfig, userContext = {}) {
  const source = flag && typeof flag === 'object' ? flag : {};
  const config = envConfig && typeof envConfig === 'object' ? envConfig : {};
  const ctx = userContext && typeof userContext === 'object' ? userContext : {};

  const flagKey = typeof source.key === 'string' ? source.key : '';
  const enabled = config.enabled ?? source.enabled;
  const offVariation = config.offVariation ?? source.offVariation;
  const fallthrough = config.fallthrough ?? source.fallthrough;
  const rules = config.rules ?? source.rules ?? [];
  const salt = resolveSalt(source, config);
  const userKey =
    typeof ctx.key === 'string' && ctx.key.length > 0
      ? ctx.key
      : typeof ctx.userKey === 'string'
        ? ctx.userKey
        : '';

  // Anything other than an explicit true is off (missing, false, or junk).
  if (enabled !== true) {
    if (typeof offVariation !== 'string') {
      return { variation: null, reason: { kind: 'error', errorKind: 'malformed_off_variation' } };
    }
    return { variation: offVariation, reason: { kind: 'off' } };
  }

  if (Array.isArray(rules)) {
    for (const rule of rules) {
      if (!rule || typeof rule !== 'object') {
        continue;
      }
      if (ruleMatches(rule, ctx)) {
        const rolloutError = rolloutPrerequisiteError(rule.serve, salt, userKey);
        if (rolloutError) {
          return rolloutError;
        }
        const variation = pickServe(rule.serve, flagKey, salt, userKey);
        if (variation == null) {
          return { variation: null, reason: { kind: 'error', errorKind: 'malformed_serve', ruleId: rule.id } };
        }
        return { variation, reason: { kind: 'rule', ruleId: rule.id } };
      }
    }
  }

  const rolloutError = rolloutPrerequisiteError(fallthrough, salt, userKey);
  if (rolloutError) {
    return rolloutError;
  }
  const variation = pickServe(fallthrough, flagKey, salt, userKey);
  if (variation == null) {
    return { variation: null, reason: { kind: 'error', errorKind: 'malformed_fallthrough' } };
  }
  return { variation, reason: { kind: 'fallthrough' } };
}

/**
 * Hashing an empty user key or salt would still produce a bucket, but that
 * bucket would lump every anonymous request together. Refuse instead.
 *
 * @param {Serve|undefined} serve
 * @param {string} salt
 * @param {string} userKey
 * @returns {EvalResult|null}
 */
function rolloutPrerequisiteError(serve, salt, userKey) {
  if (!isRolloutServe(serve)) {
    return null;
  }
  if (typeof userKey !== 'string' || userKey.length === 0) {
    return { variation: null, reason: { kind: 'error', errorKind: 'user_key_missing' } };
  }
  if (typeof salt !== 'string' || salt.length === 0) {
    return { variation: null, reason: { kind: 'error', errorKind: 'salt_missing' } };
  }
  return null;
}
