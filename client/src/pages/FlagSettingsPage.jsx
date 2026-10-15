import { useEffect, useMemo, useState } from 'react';
import { useBlocker, useFetcher, useLocation, useRevalidator, useRouteLoaderData } from 'react-router-dom';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';
import Input from '../ui/Input';
import Textarea from '../ui/Textarea';
import Select from '../ui/Select';
import Switch from '../ui/Switch';

function typedValue(value) {
  if (typeof value === 'boolean') return { type: 'boolean', value: String(value) };
  if (typeof value === 'number') return { type: 'number', value: String(value) };
  return { type: 'text', value: String(value ?? '') };
}

export function parseVariationValue(type, value) {
  if (type === 'boolean') {
    if (value === 'true' || value === true) return { value: true };
    if (value === 'false' || value === false) return { value: false };
    return { error: 'Choose true or false.' };
  }
  if (type === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) return { value };
    if (typeof value !== 'string' || value.trim() === '') return { error: 'Enter a valid number.' };
    const parsed = Number(value);
    return Number.isFinite(parsed) ? { value: parsed } : { error: 'Enter a valid number.' };
  }
  return { value: String(value ?? '') };
}

export default function FlagSettingsPage() {
  const { flag } = useRouteLoaderData('flag');
  const project = useRouteLoaderData('project');
  const canEdit = project.project.role === 'editor' || project.project.role === 'admin';
  const projectData = useRouteLoaderData('project');
  const location = useLocation();
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const [draft, setDraft] = useState(null);
  const [localErrors, setLocalErrors] = useState({});
  const [savedNotice, setSavedNotice] = useState('');

  useEffect(() => {
    setDraft({
      name: flag.name || '',
      description: flag.description || '',
      tags: (flag.tags || []).join(', '),
      isExperiment: Boolean(flag.isExperiment),
      goalMetricKey: flag.goalMetricKey || '',
      variations: (flag.variations || []).map((variation) => ({ ...variation, ...typedValue(variation.value) })),
    });
    setLocalErrors({});
  }, [flag]);

  const initial = useMemo(() => ({
    name: flag.name || '',
    description: flag.description || '',
    tags: (flag.tags || []).join(', '),
    isExperiment: Boolean(flag.isExperiment),
    goalMetricKey: flag.goalMetricKey || '',
    variations: (flag.variations || []).map((variation) => ({ ...variation, ...typedValue(variation.value) })),
  }), [flag]);

  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(initial);
  const blocker = useBlocker(dirty && fetcher.state === 'idle');
  const values = draft || initial;
  const formErrors = fetcher.data?.ok === false ? fetcher.data.error.details?.reduce((all, detail) => {
    if (detail.path) all[detail.path] = detail.message;
    return all;
  }, {}) || {} : {};

  function update(field, value) {
    setDraft((current) => ({ ...(current || initial), [field]: value }));
    setLocalErrors({});
    fetcher.reset();
  }

  function validate() {
    const errors = {};
    if (!values.name.trim()) errors.name = 'Name is required.';
    if (values.name.length > 80) errors.name = 'Name can have at most 80 characters.';
    if (values.isExperiment && !/^[a-z0-9][a-z0-9-_.]{1,63}$/.test(values.goalMetricKey)) {
      errors.goalMetricKey = 'Use 2 to 64 lowercase letters, digits, hyphen, underscore, or dot.';
    }
    if (!values.isExperiment && values.goalMetricKey.trim()) errors.goalMetricKey = 'Only experiments have a goal metric key.';
    if (values.variations.length < 2 || values.variations.length > 10) errors.variations = 'Add 2 to 10 variations.';
    const keys = new Set();
    values.variations.forEach((variation, index) => {
      if (!variation.name.trim()) errors[`variations.${index}.name`] = 'Variation name is required.';
      if (keys.has(variation.key)) errors[`variations.${index}.key`] = 'Variation keys must be unique.';
      keys.add(variation.key);
      const parsed = parseVariationValue(variation.type, variation.value);
      if (parsed.error) errors[`variations.${index}.value`] = parsed.error;
      if (typeof parsed.value === 'string' && parsed.value.length > 2000) errors[`variations.${index}.value`] = 'Text values can have at most 2000 characters.';
    });
    const tags = values.tags.split(',').map((tag) => tag.trim()).filter(Boolean);
    if (tags.length > 10 || tags.some((tag) => !/^[a-z0-9][a-z0-9-_]{0,31}$/.test(tag))) {
      errors.tags = 'Use up to 10 tags with lowercase letters, digits, hyphen, and underscore (max 32 characters).';
    }
    if (new Set(tags).size !== tags.length) errors.tags = 'Tags must be unique.';
    setLocalErrors(errors);
    return errors;
  }

  function submit(event) {
    event.preventDefault();
    if (Object.keys(validate()).length > 0) return;
    fetcher.submit(
      {
        intent: 'save',
        name: values.name.trim(),
        description: values.description,
        tags: values.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        isExperiment: values.isExperiment,
        goalMetricKey: values.isExperiment ? values.goalMetricKey : null,
        variations: values.variations.map((variation) => ({
          key: variation.key,
          name: variation.name.trim(),
          value: parseVariationValue(variation.type, variation.value).value,
        })),
      },
      { method: 'post', encType: 'application/json', action: `${location.pathname}${location.search}` },
    );
  }

  function discard() {
    setDraft(initial);
    setLocalErrors({});
    setSavedNotice('');
  }

  useEffect(() => {
    if (fetcher.data?.ok && fetcher.data.sync === 'delayed') setSavedNotice('Saved. Live updates may lag.');
    else if (fetcher.data?.ok) setSavedNotice('Saved.');
  }, [fetcher.data]);

  const errorFor = (key) => localErrors[key] || formErrors[key];

  return (
    <section className="stack detail-section">
      {dirty ? <p className="unsaved-note" role="status">Unsaved changes</p> : null}
      {fetcher.data?.ok === false ? (
        <div className="error-state" role="alert">
          <strong>{fetcher.data.error.message}</strong>
          {fetcher.data.error.code === 'version_conflict' ? (
            <Button onClick={() => revalidator.revalidate()}>Reload</Button>
          ) : null}
          {fetcher.data.error.requestId ? <div className="mono text-small">Request ID: {fetcher.data.error.requestId}</div> : null}
        </div>
      ) : null}
      {savedNotice ? <div className="notice-state" role="status">{savedNotice}</div> : null}
      {Object.entries(formErrors).map(([path, message]) => (
        <div className="error-text" key={path}>{path}: {message}</div>
      ))}

      {!canEdit ? <p className="text-small text-muted">You have read-only access to this project.</p> : null}
      <form className="settings-form stack" onSubmit={submit}>
        <fieldset className="editor-fieldset" disabled={!canEdit}>
        <Input label="Name" value={values.name} onChange={(event) => update('name', event.target.value)} error={errorFor('name')} maxLength={80} />
        <Textarea label="Description" value={values.description} onChange={(event) => update('description', event.target.value)} maxLength={500} />
        <Input label="Tags" value={values.tags} onChange={(event) => update('tags', event.target.value)} error={errorFor('tags')} />
        <Switch
          label="Experiment"
          checked={values.isExperiment}
          onCheckedChange={(checked) => {
            update('isExperiment', checked);
            if (!checked) update('goalMetricKey', '');
          }}
        />
        {values.isExperiment ? (
          <Input label="Goal metric key" value={values.goalMetricKey} onChange={(event) => update('goalMetricKey', event.target.value)} error={errorFor('goalMetricKey')} />
        ) : null}

        <div className="stack">
          <div className="inline-row">
            <h2>Variations</h2>
            <Button type="button" disabled={values.variations.length >= 10} onClick={() => update('variations', [...values.variations, { key: `variation-${values.variations.length + 1}`, name: '', type: 'boolean', value: 'false' }])}>
              Add variation
            </Button>
          </div>
          {errorFor('variations') ? <span className="error-text">{errorFor('variations')}</span> : null}
          {values.variations.map((variation, index) => (
            <div className="variation-editor panel" key={`${variation.key}-${index}`}>
              <div className="form-grid variation-grid">
                <label className="form-field">
                  <span className="field-label">Key</span>
                  <input className="mono" value={variation.key} readOnly aria-readonly="true" />
                </label>
                <Input
                  label="Name"
                  value={variation.name}
                  error={errorFor(`variations.${index}.name`)}
                  onChange={(event) => update('variations', values.variations.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))}
                />
                <Select
                  label="Value type"
                  value={variation.type}
                  onChange={(event) => {
                    const type = event.target.value;
                    const value = type === 'boolean' ? 'false' : '';
                    update('variations', values.variations.map((item, itemIndex) => itemIndex === index ? { ...item, type, value } : item));
                  }}
                >
                  <option value="boolean">Boolean</option>
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                </Select>
                {variation.type === 'boolean' ? (
                  <Select
                    label="Value"
                    value={variation.value}
                    error={errorFor(`variations.${index}.value`)}
                    onChange={(event) => update('variations', values.variations.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))}
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </Select>
                ) : (
                  <Input
                    label="Value"
                    type={variation.type === 'number' ? 'number' : 'text'}
                    value={variation.value}
                    error={errorFor(`variations.${index}.value`)}
                    onChange={(event) => update('variations', values.variations.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))}
                  />
                )}
              </div>
              <Button
                type="button"
                disabled={values.variations.length <= 2}
                onClick={() => {
                  const used = new Set();
                  Object.values(flag.environments || {}).forEach((config) => {
                    if (config.offVariation) used.add(config.offVariation);
                    const addServe = (serve) => {
                      if (serve?.variation) used.add(serve.variation);
                      (serve?.rollout || []).forEach((bucket) => used.add(bucket.variation));
                    };
                    addServe(config.fallthrough);
                    (config.rules || []).forEach((rule) => addServe(rule.serve));
                  });
                  if (used.has(variation.key)) {
                    setLocalErrors((current) => ({ ...current, variations: 'A removed variation is still used by an environment.' }));
                    return;
                  }
                  update('variations', values.variations.filter((_, itemIndex) => itemIndex !== index));
                }}
              >
                Remove variation
              </Button>
            </div>
          ))}
        </div>

        <div className="dialog-actions settings-actions">
          {fetcher.state === 'submitting' ? <span className="text-muted">Loading...</span> : null}
          <Button type="button" disabled={!dirty || fetcher.state !== 'idle'} onClick={discard}>Discard</Button>
          <Button type="submit" variant="primary" disabled={!dirty || fetcher.state !== 'idle' || Object.keys(localErrors).length > 0}>
            Save
          </Button>
        </div>
        </fieldset>
      </form>
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => { if (!open) blocker.reset(); }}
        title="Discard unsaved changes?"
        description="You have unsaved flag settings. Leaving this page will discard them."
        onConfirm={() => blocker.proceed()}
        confirmLabel="Discard changes"
      />
    </section>
  );
}
