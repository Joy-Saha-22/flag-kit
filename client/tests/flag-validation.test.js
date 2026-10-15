import { describe, expect, it } from 'vitest';
import {
  parseTypedValue,
  validateCondition,
  validateEnvironmentConfig,
  validateRule,
} from '../src/lib/flagValidation';
import { parseVariationValue } from '../src/pages/FlagSettingsPage';

describe('flag validation', () => {
  it('enforces server rule and condition limits', () => {
    expect(validateRule({ id: 'bad id', conditions: [], serve: { variation: 'on' } }, 0, new Set(['on']))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'rules.0.id' }),
        expect.objectContaining({ path: 'rules.0.conditions' }),
      ]),
    );
    expect(validateCondition({ attribute: 'a'.repeat(101), operator: 'startsWith', values: [2] })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('Attribute names') }),
        expect.objectContaining({ message: expect.stringContaining('startsWith') }),
      ]),
    );
  });

  it('enforces condition count, unique ids, and valid referenced variations', () => {
    const config = {
      enabled: false,
      offVariation: 'missing',
      fallthrough: { variation: 'missing' },
      rules: [{ id: 'same', conditions: [{ attribute: 'country', operator: 'equals', values: ['US'] }], serve: { variation: 'missing' } }],
    };
    const errors = validateEnvironmentConfig(config, ['on']);
    expect(errors.map((error) => error.path)).toContain('offVariation');
    expect(errors.map((error) => error.path)).toContain('fallthrough.variation');
    expect(errors.map((error) => error.path)).toContain('rules.0.serve.variation');
  });

  it('parses typed values and rejects invalid number and boolean values', () => {
    expect(parseTypedValue('number', '12.5')).toEqual({ value: 12.5 });
    expect(parseTypedValue('number', 'nope').error).toBe('Enter a valid number.');
    expect(parseTypedValue('boolean', 'true')).toEqual({ value: true });
    expect(parseTypedValue('boolean', 'maybe').error).toBe('Choose true or false.');
    expect(parseVariationValue('text', 'value')).toEqual({ value: 'value' });
  });
});
