import { useMemo, useState } from 'react';
import Dialog from '../../ui/Dialog';
import Input from '../../ui/Input';
import Textarea from '../../ui/Textarea';
import Select from '../../ui/Select';
import Button from '../../ui/Button';
import { validateFlagDraft } from '../../lib/validation';

const defaultVariations = [
  { key: 'on', name: 'On', value: true },
  { key: 'off', name: 'Off', value: false },
];

export default function CreateFlagDialog({ open, onOpenChange, onCreate }) {
  const [draft, setDraft] = useState({
    key: '',
    name: '',
    description: '',
    tags: '',
    variations: defaultVariations,
    isExperiment: false,
    goalMetricKey: '',
    offVariation: 'off',
    defaultVariation: 'on',
  });
  const [errors, setErrors] = useState({});

  const variationOptions = useMemo(
    () => (draft.variations || []).map((variation) => ({ value: variation.key, label: variation.name || variation.key })),
    [draft.variations],
  );

  function updateField(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    const nextErrors = validateFlagDraft(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    onCreate({
      ...draft,
      tags: draft.tags ? draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean) : [],
      variations: draft.variations.map((variation) => ({
        key: variation.key,
        name: variation.name,
        value: variation.value,
      })),
      goalMetricKey: draft.isExperiment ? draft.goalMetricKey : null,
    });
  }

  function addVariation() {
    const nextKey = `v${(draft.variations || []).length + 1}`;
    setDraft((current) => ({
      ...current,
      variations: [...(current.variations || []), { key: nextKey, name: nextKey, value: false }],
    }));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New flag"
      description="Create a flag with audit-friendly defaults."
      trigger={null}
    >
      <form onSubmit={handleSubmit} className="stack">
        <div className="form-grid">
          <Input label="Key" value={draft.key} onChange={(event) => updateField('key', event.target.value)} error={errors.key} />
          <Input label="Name" value={draft.name} onChange={(event) => updateField('name', event.target.value)} error={errors.name} />
          <Textarea label="Description" value={draft.description} onChange={(event) => updateField('description', event.target.value)} />
          <Input label="Tags" value={draft.tags} onChange={(event) => updateField('tags', event.target.value)} placeholder="alpha, beta" />
          <label className="switch-row">
            <span className="field-label">Experiment</span>
            <input type="checkbox" checked={draft.isExperiment} onChange={(event) => updateField('isExperiment', event.target.checked)} />
          </label>
          {draft.isExperiment ? (
            <Input
              label="Goal metric key"
              value={draft.goalMetricKey}
              onChange={(event) => updateField('goalMetricKey', event.target.value)}
              error={errors.goalMetricKey}
            />
          ) : null}

          <div className="stack">
            <div className="inline-row">
              <span className="field-label">Variations</span>
              <Button type="button" onClick={addVariation}>Add variation</Button>
            </div>
            {(draft.variations || []).map((variation, index) => (
              <div key={variation.key || index} className="inline-row" style={{ alignItems: 'flex-end' }}>
                <Input
                  label="Key"
                  value={variation.key}
                  onChange={(event) => {
                    const next = [...draft.variations];
                    next[index] = { ...variation, key: event.target.value };
                    setDraft((current) => ({ ...current, variations: next }));
                  }}
                />
                <Input
                  label="Name"
                  value={variation.name}
                  onChange={(event) => {
                    const next = [...draft.variations];
                    next[index] = { ...variation, name: event.target.value };
                    setDraft((current) => ({ ...current, variations: next }));
                  }}
                />
                <Select
                  label="Value"
                  value={String(variation.value)}
                  onChange={(event) => {
                    const next = [...draft.variations];
                    const value = event.target.value === 'true' ? true : event.target.value === 'false' ? false : Number(event.target.value);
                    next[index] = { ...variation, value };
                    setDraft((current) => ({ ...current, variations: next }));
                  }}
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                  <option value="0">0</option>
                  <option value="1">1</option>
                </Select>
              </div>
            ))}
          </div>

          <Select label="Off variation" value={draft.offVariation} onChange={(event) => updateField('offVariation', event.target.value)} error={errors.offVariation}>
            {variationOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
          <Select label="Default variation" value={draft.defaultVariation} onChange={(event) => updateField('defaultVariation', event.target.value)} error={errors.defaultVariation}>
            {variationOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </div>

        {errors.variations ? <span className="error-text">{errors.variations}</span> : null}

        <div className="dialog-actions">
          <Button type="button" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary">Create flag</Button>
        </div>
      </form>
    </Dialog>
  );
}
