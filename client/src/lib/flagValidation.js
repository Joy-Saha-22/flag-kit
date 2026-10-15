export const RULE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const ATTRIBUTE_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;
export const VARIATION_KEY_PATTERN = /^[a-z0-9][a-z0-9-_]{0,63}$/;
export const OPERATORS = ['equals', 'notEquals', 'in', 'contains', 'startsWith', 'gt', 'lt'];
export const MAX_RULES = 50;
export const MAX_CONDITIONS_PER_RULE = 10;
export const MAX_VALUES_PER_CONDITION = 100;

export function parseTypedValue(type, value) {
  if (type === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) return { value };
    if (typeof value !== 'string' || value.trim() === '') return { error: 'Enter a valid number.' };
    const parsed = Number(value);
    return Number.isFinite(parsed) ? { value: parsed } : { error: 'Enter a valid number.' };
  }
  if (type === 'boolean') {
    if (value === true || value === 'true') return { value: true };
    if (value === false || value === 'false') return { value: false };
    return { error: 'Choose true or false.' };
  }
  return typeof value === 'string' ? { value } : { error: 'Enter text.' };
}

export function validateServe(serve, variationKeys, path) {
  const errors = [];
  const hasVariation = typeof serve?.variation === 'string';
  const hasRollout = Array.isArray(serve?.rollout);
  if (hasVariation === hasRollout) {
    errors.push({ path, message: 'Choose one variation or a rollout.' });
    return errors;
  }

  if (hasVariation && !variationKeys.has(serve.variation)) {
    errors.push({ path: `${path}.variation`, message: `Unknown variation "${serve.variation}".` });
  }

  if (hasRollout) {
    if (serve.rollout.length < 1 || serve.rollout.length > 10) {
      errors.push({ path: `${path}.rollout`, message: 'A rollout needs 1 to 10 buckets.' });
    }
    const seen = new Set();
    let total = 0;
    serve.rollout.forEach((bucket, index) => {
      if (!variationKeys.has(bucket.variation)) {
        errors.push({ path: `${path}.rollout.${index}.variation`, message: `Unknown variation "${bucket.variation}".` });
      }
      if (seen.has(bucket.variation)) {
        errors.push({ path: `${path}.rollout.${index}.variation`, message: 'Duplicate variation in rollout.' });
      }
      seen.add(bucket.variation);
      if (!Number.isInteger(bucket.weight) || bucket.weight < 0 || bucket.weight > 100000) {
        errors.push({ path: `${path}.rollout.${index}.weight`, message: 'Weight must be an integer from 0 to 100000.' });
      }
      total += bucket.weight;
    });
    if (total !== 100000) {
      errors.push({ path: `${path}.rollout`, message: `Rollout weights must add up to exactly 100000 (got ${total}).` });
    }
  }
  return errors;
}

export function validateCondition(condition, path = 'condition') {
  const errors = [];
  if (typeof condition.attribute !== 'string' || !ATTRIBUTE_PATTERN.test(condition.attribute)) {
    errors.push({ path: `${path}.attribute`, message: 'Attribute names use 1 to 100 letters, digits, dot, hyphen, or underscore.' });
  }
  if (!OPERATORS.includes(condition.operator)) {
    errors.push({ path: `${path}.operator`, message: 'Choose a supported operator.' });
  }
  const values = condition.values || [];
  if (values.length < 1 || values.length > MAX_VALUES_PER_CONDITION) {
    errors.push({ path: `${path}.values`, message: 'A condition needs 1 to 100 values.' });
  }
  values.forEach((value, index) => {
    if (!['string', 'number', 'boolean'].includes(typeof value)) {
      errors.push({ path: `${path}.values.${index}`, message: 'Values must be text, numbers, or booleans.' });
    } else if (typeof value === 'string' && value.length > 2000) {
      errors.push({ path: `${path}.values.${index}`, message: 'Text values can have at most 2000 characters.' });
    } else if (typeof value === 'number' && !Number.isFinite(value)) {
      errors.push({ path: `${path}.values.${index}`, message: 'Number values must be finite.' });
    }
  });
  if (condition.operator === 'gt' || condition.operator === 'lt') {
    if (values.length !== 1 || !['number', 'string'].includes(typeof values[0])) {
      errors.push({ path: `${path}.values`, message: 'gt and lt need exactly one number or text value.' });
    }
  }
  if (condition.operator === 'startsWith' && !values.every((value) => typeof value === 'string')) {
    errors.push({ path: `${path}.values`, message: 'startsWith values must be text.' });
  }
  return errors;
}

export function validateRule(rule, index = 0, variationKeys = new Set()) {
  const path = `rules.${index}`;
  const errors = [];
  if (typeof rule.id !== 'string' || !RULE_ID_PATTERN.test(rule.id)) {
    errors.push({ path: `${path}.id`, message: 'Rule id must use 1 to 64 letters, digits, hyphens, or underscores.' });
  }
  if (!Array.isArray(rule.conditions) || rule.conditions.length < 1) {
    errors.push({ path: `${path}.conditions`, message: 'A rule needs at least one condition.' });
  } else if (rule.conditions.length > MAX_CONDITIONS_PER_RULE) {
    errors.push({ path: `${path}.conditions`, message: 'A rule can have at most 10 conditions.' });
  } else {
    rule.conditions.forEach((condition, conditionIndex) => {
      errors.push(...validateCondition(condition, `${path}.conditions.${conditionIndex}`));
    });
  }
  errors.push(...validateServe(rule.serve, variationKeys, `${path}.serve`));
  return errors;
}

export function validateEnvironmentConfig(config, variationList) {
  const variationKeys = new Set(variationList.map((item) => typeof item === 'string' ? item : item.key));
  const errors = [];

  if (!variationKeys.has(config.offVariation)) {
    errors.push({ path: 'offVariation', message: `Unknown variation "${config.offVariation}".` });
  }
  errors.push(...validateServe(config.fallthrough, variationKeys, 'fallthrough'));

  if (!Array.isArray(config.rules)) {
    errors.push({ path: 'rules', message: 'Rules must be a list.' });
  } else {
    if (config.rules.length > MAX_RULES) {
      errors.push({ path: 'rules', message: 'A maximum of 50 rules is allowed.' });
    }
    const ids = new Set();
    config.rules.forEach((rule, index) => {
      if (ids.has(rule.id)) {
        errors.push({ path: `rules.${index}.id`, message: 'Rule ids must be unique.' });
      }
      ids.add(rule.id);
      errors.push(...validateRule(rule, index, variationKeys));
    });
  }
  return errors;
}

export function mapServerDetails(details = []) {
  return details.reduce((mapped, detail) => {
    if (detail.path) mapped[detail.path] = detail.message;
    return mapped;
  }, {});
}
