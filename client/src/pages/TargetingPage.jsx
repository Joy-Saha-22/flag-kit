import { useMemo, useState } from 'react';
import {
  useBlocker,
  useFetcher,
  useLocation,
  useRevalidator,
  useRouteLoaderData,
  useSearchParams,
} from 'react-router-dom';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Switch from '../ui/Switch';
import Textarea from '../ui/Textarea';
import { validateEnvironmentConfig, parseTypedValue, OPERATORS } from '../lib/flagValidation';
import { percentagesToRollout, serveToPercentages } from '../lib/rollout';

function toTypedInput(value) {
  if (typeof value === 'boolean') return { type: 'boolean', value: String(value) };
  if (typeof value === 'number') return { type: 'number', value: String(value) };
  return { type: 'text', value: String(value ?? '') };
}

function serveToDraft(serve, variationKeys) {
  if (serve?.rollout) {
    return { mode: 'rollout', buckets: serveToPercentages(serve, variationKeys) };
  }
  return { mode: 'variation', variation: serve?.variation || variationKeys[0] };
}

function configToDraft(config, variationKeys) {
  return {
    enabled: Boolean(config?.enabled),
    offVariation: config?.offVariation || variationKeys[0],
    fallthrough: serveToDraft(config?.fallthrough || { variation: variationKeys[0] }, variationKeys),
    rules: (config?.rules || []).map((rule) => ({
      ...rule,
      conditions: (rule.conditions || []).map((condition) => ({
        ...condition,
        values: (condition.values || []).map(toTypedInput),
      })),
      serve: serveToDraft(rule.serve, variationKeys),
    })),
  };
}

function createRuleId(existingIds) {
  let id = '';
  do {
    const suffix = Array.from({ length: 6 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
    id = `rule-${suffix}`;
  } while (existingIds.has(id));
  return id;
}

function serializeServe(serve, path, errors) {
  if (serve.mode === 'variation') {
    return { variation: serve.variation };
  }
  const result = percentagesToRollout(serve.buckets);
  if (!result.rollout) {
    errors.push({ path: `${path}.rollout`, message: result.error });
    return null;
  }
  return { rollout: result.rollout };
}

function serializeConfig(draft, variations) {
  const errors = [];
  const variationKeys = variations.map((item) => item.key);
  const config = {
    enabled: draft.enabled,
    offVariation: draft.offVariation,
    fallthrough: serializeServe(draft.fallthrough, 'fallthrough', errors),
    rules: draft.rules.map((rule, ruleIndex) => ({
      id: rule.id,
      conditions: rule.conditions.map((condition, conditionIndex) => ({
        attribute: condition.attribute,
        operator: condition.operator,
        values: condition.values.map((item, valueIndex) => {
          const parsed = parseTypedValue(item.type, item.value);
          if (parsed.error) {
            errors.push({
              path: `rules.${ruleIndex}.conditions.${conditionIndex}.values.${valueIndex}`,
              message: parsed.error,
            });
            return null;
          }
          return parsed.value;
        }),
      })),
      serve: serializeServe(rule.serve, `rules.${ruleIndex}.serve`, errors),
    })),
  };
  errors.push(...validateEnvironmentConfig(config, variationKeys));
  return { config, errors };
}

function ServeEditor({ label, value, variations, onChange, errorText }) {
  const variationKeys = variations.map((variation) => variation.key);
  const buckets = value.mode === 'rollout'
    ? variationKeys.map((variation) => value.buckets.find((item) => item.variation === variation) || { variation, percent: '0' })
    : serveToPercentages(value, variationKeys);
  const total = buckets.reduce((sum, bucket) => sum + (Number(bucket.percent) || 0), 0);

  return (
    <fieldset className="serve-editor">
      <legend>{label}</legend>
      <Select
        label="Serve mode"
        value={value.mode}
        onChange={(event) => {
          if (event.target.value === 'rollout') {
            onChange({ mode: 'rollout', buckets: serveToPercentages(value, variationKeys) });
          } else {
            onChange({ mode: 'variation', variation: value.variation || variationKeys[0] });
          }
        }}
      >
        <option value="variation">One variation</option>
        <option value="rollout">Percentage rollout</option>
      </Select>
      {value.mode === 'variation' ? (
        <Select label="Variation" value={value.variation} onChange={(event) => onChange({ ...value, variation: event.target.value })}>
          {variations.map((variation) => <option key={variation.key} value={variation.key}>{variation.name} ({variation.key})</option>)}
        </Select>
      ) : (
        <div className="stack">
          {buckets.map((bucket) => (
            <Input
              key={bucket.variation}
              label={`${variations.find((item) => item.key === bucket.variation)?.name || bucket.variation} percent`}
              type="number"
              min="0"
              max="100"
              step="any"
              value={bucket.percent}
              onChange={(event) => onChange({
                mode: 'rollout',
                buckets: buckets.map((item) => item.variation === bucket.variation ? { ...item, percent: event.target.value } : item),
              })}
            />
          ))}
          <p className="mono text-small">Total: {Number(total.toFixed(6))}%</p>
          {Math.abs(total - 100) > 1e-9 ? <span className="error-text">Percentages must add up to exactly 100.</span> : null}
        </div>
      )}
      {errorText ? <span className="error-text">{errorText}</span> : null}
    </fieldset>
  );
}

function ConditionEditor({ condition, onChange, onRemove, attributeError, operatorError, errorText }) {
  const singleValueOperator = ['gt', 'lt', 'startsWith'].includes(condition.operator);
  const values = condition.values.length ? condition.values : [{ type: 'text', value: '' }];

  function changeOperator(operator) {
    let nextValues = condition.values;
    if (['gt', 'lt'].includes(operator)) nextValues = nextValues.slice(0, 1).map((item) => item.type === 'boolean' ? { type: 'text', value: item.value } : item);
    if (operator === 'startsWith') nextValues = nextValues.slice(0, 1).map((item) => ({ type: 'text', value: item.value }));
    onChange({ ...condition, operator, values: nextValues.length ? nextValues : [{ type: 'text', value: '' }] });
  }

  return (
    <div className="condition-editor panel">
      <div className="form-grid condition-grid">
        <Input label="Attribute" value={condition.attribute} onChange={(event) => onChange({ ...condition, attribute: event.target.value })} maxLength={100} error={attributeError} />
        <Select label="Operator" value={condition.operator} onChange={(event) => changeOperator(event.target.value)} error={operatorError}>
          {OPERATORS.map((operator) => <option key={operator} value={operator}>{operator}</option>)}
        </Select>
      </div>
      <div className="stack value-list">
        {values.map((item, index) => (
          <div className="inline-row typed-value-row" key={index}>
            <Select
              label="Value type"
              value={item.type}
              disabled={condition.operator === 'startsWith'}
              onChange={(event) => {
                const type = event.target.value;
                const newValue = type === 'boolean' ? 'false' : '';
                onChange({ ...condition, values: values.map((current, itemIndex) => itemIndex === index ? { type, value: newValue } : current) });
              }}
            >
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="boolean">Boolean</option>
            </Select>
            {item.type === 'boolean' ? (
              <Select
                label={`Value ${index + 1}`}
                value={item.value}
                onChange={(event) => onChange({ ...condition, values: values.map((current, itemIndex) => itemIndex === index ? { ...current, value: event.target.value } : current) })}
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </Select>
            ) : (
              <Input
                label={`Value ${index + 1}`}
                type={item.type === 'number' ? 'number' : 'text'}
                value={item.value}
                maxLength={2000}
                onChange={(event) => onChange({ ...condition, values: values.map((current, itemIndex) => itemIndex === index ? { ...current, value: event.target.value } : current) })}
              />
            )}
            {!singleValueOperator && values.length > 1 ? <Button type="button" onClick={() => onChange({ ...condition, values: values.filter((_, itemIndex) => itemIndex !== index) })}>Remove value</Button> : null}
          </div>
        ))}
      </div>
      {!singleValueOperator && values.length < 100 ? (
        <Button type="button" onClick={() => onChange({ ...condition, values: [...values, { type: 'text', value: '' }] })}>Add value</Button>
      ) : null}
      {errorText ? <span className="error-text">{errorText}</span> : null}
      <Button type="button" onClick={onRemove}>Remove condition</Button>
    </div>
  );
}

function createEmptyCondition() {
  return { attribute: '', operator: 'equals', values: [{ type: 'text', value: '' }] };
}

function TargetingEditor({ flag, envKey, config }) {
  const location = useLocation();
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const variationKeys = useMemo(() => flag.variations.map((variation) => variation.key), [flag.variations]);
  const project = useRouteLoaderData('project');
  const canEdit = project.project.role === 'editor' || project.project.role === 'admin';
  const [draft, setDraft] = useState(() => configToDraft(config, variationKeys));
  const [prodConfirmationOpen, setProdConfirmationOpen] = useState(false);
  const [pendingEnabled, setPendingEnabled] = useState(null);
  const initial = useMemo(() => configToDraft(config, variationKeys), [config, variationKeys]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const serialized = useMemo(() => serializeConfig(draft, flag.variations), [draft, flag.variations]);
  const localErrors = serialized.errors;
  const actionError = fetcher.data?.ok === false ? fetcher.data.error : null;
  const blocker = useBlocker(dirty && fetcher.state === 'idle');
  const fieldError = (path) => localErrors.find((issue) => issue.path === path || issue.path.startsWith(`${path}.`))?.message
    || actionError?.details?.find((detail) => detail.path === path || detail.path?.startsWith(`${path}.`))?.message;

  function updateConfig(partial) {
    setDraft((current) => ({ ...current, ...partial }));
  }

  function save(event) {
    event.preventDefault();
    if (localErrors.length > 0) return;
    fetcher.submit(
      { ...serialized.config, expectedVersion: config.version },
      { method: 'post', encType: 'application/json', action: `${location.pathname}${location.search}` },
    );
  }

  function discard() {
    setDraft(initial);
  }

  function setEnabled(enabled) {
    if (envKey === 'prod') {
      setPendingEnabled(enabled);
      setProdConfirmationOpen(true);
      return;
    }
    updateConfig({ enabled });
  }

  const actionErrors = actionError?.details || [];

  return (
    <div className="stack">
      {dirty ? <p className="unsaved-note" role="status">Unsaved changes</p> : null}
      {actionError ? (
        <div className="error-state" role="alert">
          <strong>{actionError.message}</strong>
          {actionError.code === 'version_conflict' ? <Button onClick={() => revalidator.revalidate()}>Reload</Button> : null}
          {actionError.requestId ? <span className="mono text-small">Request ID: {actionError.requestId}</span> : null}
        </div>
      ) : null}
      {actionErrors.length > 0 ? actionErrors.map((detail, index) => (
        <div className="error-text" key={`${detail.path}-${index}`}>{detail.path}: {detail.message}</div>
      )) : null}
      {fetcher.data?.ok && fetcher.data.sync === 'delayed' ? (
        <div className="notice-state" role="status">Saved. Live updates may lag.</div>
      ) : null}

      <form className="stack" onSubmit={save}>
        <fieldset className="editor-fieldset" disabled={!canEdit}>
        <section className="panel detail-panel stack">
          <div className="switch-row">
            <div>
              <h2>Environment targeting</h2>
              <p className="text-muted">Set where this flag is available in {envKey}.</p>
            </div>
            <Switch label="Enabled" checked={draft.enabled} onCheckedChange={setEnabled} />
          </div>
          <Select label="Off variation" value={draft.offVariation} onChange={(event) => updateConfig({ offVariation: event.target.value })} error={fieldError('offVariation')}>
            {flag.variations.map((variation) => <option key={variation.key} value={variation.key}>{variation.name} ({variation.key})</option>)}
          </Select>
          <ServeEditor
            label="Fallthrough"
            value={draft.fallthrough}
            variations={flag.variations}
            onChange={(fallthrough) => updateConfig({ fallthrough })}
            errorText={fieldError('fallthrough.rollout') || fieldError('fallthrough')}
          />
        </section>

        <section className="panel detail-panel stack">
          <div>
            <h2>Rules</h2>
            <p className="text-muted">The first matching rule wins.</p>
          </div>
          {draft.rules.map((rule, ruleIndex) => (
            <article className="rule-editor panel" key={rule.id}>
              <div className="inline-row rule-heading">
                <strong>Rule {ruleIndex + 1}</strong>
                <span className="mono text-small">{rule.id}</span>
                <Button type="button" disabled={ruleIndex === 0} onClick={() => {
                  const rules = [...draft.rules];
                  [rules[ruleIndex - 1], rules[ruleIndex]] = [rules[ruleIndex], rules[ruleIndex - 1]];
                  updateConfig({ rules });
                }}>Move up</Button>
                <Button type="button" disabled={ruleIndex === draft.rules.length - 1} onClick={() => {
                  const rules = [...draft.rules];
                  [rules[ruleIndex + 1], rules[ruleIndex]] = [rules[ruleIndex], rules[ruleIndex + 1]];
                  updateConfig({ rules });
                }}>Move down</Button>
                <Button type="button" onClick={() => updateConfig({ rules: draft.rules.filter((_, index) => index !== ruleIndex) })}>Remove rule</Button>
              </div>
              {fieldError(`rules.${ruleIndex}.id`) ? <span className="error-text">{fieldError(`rules.${ruleIndex}.id`)}</span> : null}
              <div className="stack">
                <h3>Conditions</h3>
                {rule.conditions.map((condition, conditionIndex) => (
                  <ConditionEditor
                    key={`${rule.id}-${conditionIndex}`}
                    condition={condition}
                    onChange={(changed) => updateConfig({
                      rules: draft.rules.map((item, index) => index === ruleIndex
                        ? { ...item, conditions: item.conditions.map((part, partIndex) => partIndex === conditionIndex ? changed : part) }
                        : item),
                    })}
                    onRemove={() => updateConfig({
                      rules: draft.rules.map((item, index) => index === ruleIndex
                        ? { ...item, conditions: item.conditions.filter((_, partIndex) => partIndex !== conditionIndex) }
                        : item),
                    })}
                    attributeError={fieldError(`rules.${ruleIndex}.conditions.${conditionIndex}.attribute`)}
                    operatorError={fieldError(`rules.${ruleIndex}.conditions.${conditionIndex}.operator`)}
                    errorText={fieldError(`rules.${ruleIndex}.conditions.${conditionIndex}.values`)}
                  />
                ))}
                {fieldError(`rules.${ruleIndex}.conditions`) ? <span className="error-text">{fieldError(`rules.${ruleIndex}.conditions`)}</span> : null}
                <Button
                  type="button"
                  disabled={rule.conditions.length >= 10}
                  onClick={() => updateConfig({
                    rules: draft.rules.map((item, index) => index === ruleIndex ? { ...item, conditions: [...item.conditions, createEmptyCondition()] } : item),
                  })}
                >
                  Add condition
                </Button>
              </div>
              <ServeEditor
                label="Serve"
                value={rule.serve}
                variations={flag.variations}
                onChange={(serve) => updateConfig({ rules: draft.rules.map((item, index) => index === ruleIndex ? { ...item, serve } : item) })}
                errorText={fieldError(`rules.${ruleIndex}.serve.rollout`) || fieldError(`rules.${ruleIndex}.serve`)}
              />
            </article>
          ))}
          {fieldError('rules') ? <span className="error-text">{fieldError('rules')}</span> : null}
          <Button
            type="button"
            disabled={draft.rules.length >= 50}
            onClick={() => {
              const ids = new Set(draft.rules.map((rule) => rule.id));
              const id = createRuleId(ids);
              updateConfig({
                rules: [...draft.rules, {
                  id,
                  conditions: [createEmptyCondition()],
                  serve: { mode: 'variation', variation: variationKeys[0] },
                }],
              });
            }}
          >
            Add rule
          </Button>
        </section>

        <div className="inline-row action-row">
          <span className="mono text-small text-muted">Version {config.version}</span>
          <span className="grow" />
          {fetcher.state !== 'idle' ? <span className="text-muted">Loading...</span> : null}
          <Button type="button" disabled={!dirty} onClick={discard}>Discard</Button>
          <Button type="submit" variant="primary" disabled={!dirty || localErrors.length > 0 || fetcher.state !== 'idle'}>Save</Button>
        </div>
        </fieldset>
      </form>

      {!canEdit ? <p className="text-small text-muted">You have read-only access to this project.</p> : null}
      <TestPanel pid={project.pid} flagKey={flag.key} envKey={envKey} />

      <ConfirmDialog
        open={prodConfirmationOpen}
        onOpenChange={setProdConfirmationOpen}
        title="Change production flag"
        description={`Confirm that you want to ${pendingEnabled ? 'enable' : 'disable'} this flag in production.`}
        onConfirm={() => {
          updateConfig({ enabled: pendingEnabled });
          setPendingEnabled(null);
        }}
        confirmLabel={pendingEnabled ? 'Enable in production' : 'Disable in production'}
      />
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => { if (!open) blocker.reset(); }}
        title="Discard unsaved changes?"
        description="You have unsaved targeting changes. Leaving this page will discard them."
        onConfirm={() => blocker.proceed()}
        confirmLabel="Discard changes"
      />
    </div>
  );
}

function TestPanel({ pid, flagKey, envKey }) {
  const location = useLocation();
  const fetcher = useFetcher();
  const [contextText, setContextText] = useState('{"key": "user-1"}');
  const [parseError, setParseError] = useState('');
  const result = fetcher.data?.ok ? fetcher.data.result : null;
  const requestError = fetcher.data?.ok === false ? fetcher.data.error : null;

  function runTest(event) {
    event.preventDefault();
    let userContext;
    try {
      userContext = JSON.parse(contextText);
      if (!userContext || typeof userContext !== 'object' || Array.isArray(userContext)) {
        throw new Error('User context must be a JSON object.');
      }
    } catch (error) {
      setParseError(error instanceof SyntaxError ? 'Enter valid JSON for user context.' : error.message);
      return;
    }
    setParseError('');
    fetcher.submit(
      { envKey, userContext },
      { method: 'post', encType: 'application/json', action: `/p/${pid}/flags/${encodeURIComponent(flagKey)}/evaluate${location.search}` },
    );
  }

  return (
    <section className="panel detail-panel stack">
      <div>
        <h2>Test evaluation</h2>
        <p className="text-muted">This test uses the saved configuration for {envKey}.</p>
      </div>
      <form className="stack" onSubmit={runTest}>
        <Textarea label="User context JSON" className="mono json-input" value={contextText} onChange={(event) => setContextText(event.target.value)} />
        {parseError ? <span className="error-text" role="alert">{parseError}</span> : null}
        {requestError ? <div className="error-state" role="alert">{requestError.message}</div> : null}
        <div className="inline-row">
          <Button type="submit" variant="primary" disabled={fetcher.state !== 'idle'}>Run test</Button>
          {fetcher.state !== 'idle' ? <span className="text-muted">Loading...</span> : null}
        </div>
      </form>
      {result ? (
        <>
          <h3>Evaluation result</h3>
          <dl className="result-list">
            <div><dt>Variation</dt><dd className="mono">{result.variation ?? 'None'}</dd></div>
            <div><dt>Value</dt><dd className="mono">{JSON.stringify(result.value)}</dd></div>
            <div><dt>Reason</dt><dd>{result.reason?.kind}{result.reason?.ruleId ? ` (${result.reason.ruleId})` : ''}</dd></div>
            {result.reason?.errorKind ? (
              <div><dt>Details</dt><dd>{result.reason.errorKind === 'user_key_missing' ? 'Add a "key" to the context.' : result.reason.errorKind}</dd></div>
            ) : null}
          </dl>
        </>
      ) : null}
    </section>
  );
}

export default function TargetingPage() {
  const { flag } = useRouteLoaderData('flag');
  const [searchParams] = useSearchParams();
  const envKey = searchParams.get('env') || 'prod';
  const config = flag.environments?.[envKey];

  if (!config) {
    return <div className="error-state">No configuration is available for {envKey}.</div>;
  }

  return <TargetingEditor key={config.version} flag={flag} envKey={envKey} config={config} />;
}
