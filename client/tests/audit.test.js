import { describe, expect, it } from 'vitest';
import { getChangedFields } from '../src/lib/audit';

describe('audit field changes', () => {
  it('returns sorted top-level fields whose values changed', () => {
    expect(getChangedFields(
      { name: 'Old', enabled: false, nested: { key: 'a' }, removed: true },
      { name: 'New', enabled: false, nested: { key: 'b' }, added: 1 },
    )).toEqual(['added', 'name', 'nested', 'removed']);
  });

  it('treats missing snapshots as empty objects', () => {
    expect(getChangedFields(null, { key: 'value' })).toEqual(['key']);
  });
});
