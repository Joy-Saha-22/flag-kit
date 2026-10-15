import { useEffect, useMemo, useState } from 'react';
import { Form, useFetcher, useLoaderData, useLocation, useRouteLoaderData } from 'react-router-dom';
import Button from '../ui/Button';
import { getChangedFields } from '../lib/audit';

const actionLabels = {
  'project.create': 'Created project',
  'flag.create': 'Created flag',
  'flag.update': 'Updated flag settings',
  'flag.delete': 'Deleted flag',
  'flag.env_update': 'Updated environment targeting',
  'sdk_key.create': 'Created SDK key',
  'sdk_key.revoke': 'Revoked SDK key',
};

function jsonText(value) {
  return JSON.stringify(value ?? null, null, 2);
}

export default function AuditPage() {
  const data = useLoaderData();
  const { environments } = useRouteLoaderData('project');
  const location = useLocation();
  const fetcher = useFetcher();
  const [additionalEntries, setAdditionalEntries] = useState([]);
  const [cursor, setCursor] = useState(data.nextBefore || null);
  const queryKey = `${location.pathname}?${new URLSearchParams([...new URLSearchParams(location.search).entries()].filter(([key]) => key !== 'before')).toString()}`;
  const [expandedId, setExpandedId] = useState(null);
  const fixedFlag = data.fixedFlag || null;

  useEffect(() => {
    setAdditionalEntries([]);
    setCursor(data.nextBefore || null);
    setExpandedId(null);
  }, [queryKey, data.nextBefore]);

  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.entries) {
      setAdditionalEntries((current) => {
        const knownIds = new Set(current.map((entry) => entry.id));
        return [...current, ...fetcher.data.entries.filter((entry) => !knownIds.has(entry.id))];
      });
      setCursor(fetcher.data.nextBefore || null);
    }
  }, [fetcher.data, fetcher.state]);

  const entries = useMemo(() => {
    const unique = new Map();
    for (const entry of [...(data.entries || []), ...additionalEntries]) unique.set(entry.id, entry);
    return [...unique.values()].sort((left, right) => new Date(right.ts) - new Date(left.ts));
  }, [data.entries, additionalEntries]);

  if (data.forbidden) {
    return <div className="empty-state">Editor access is needed to view the audit log.</div>;
  }

  const query = new URLSearchParams(location.search);
  const canLoadMore = Boolean(cursor) && entries.length > 0;

  function loadMore() {
    const params = new URLSearchParams(location.search);
    params.set('before', cursor);
    fetcher.load(`${location.pathname}?${params.toString()}`);
  }

  return (
    <section className="detail-section stack">
      {!fixedFlag ? (
        <div className="panel audit-filters">
          <Form method="get" action={location.pathname} className="audit-filter-form">
            <label className="form-field">
              <span className="field-label">Flag key</span>
              <input name="flag" defaultValue={query.get('flag') || ''} aria-label="Flag key filter" />
            </label>
            <label className="form-field">
              <span className="field-label">Environment</span>
              <select name="env" defaultValue={query.get('env') || ''} aria-label="Environment filter">
                <option value="">All environments</option>
                {environments.map((environment) => (
                  <option key={environment.key} value={environment.key}>{environment.key}</option>
                ))}
              </select>
            </label>
            <Button type="submit">Apply filters</Button>
          </Form>
        </div>
      ) : null}

      {entries.length === 0 ? (
        <div className="empty-state">No audit entries found.</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table audit-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Flag</th>
                <th>Environment</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const expanded = expandedId === entry.id;
                const changedFields = getChangedFields(entry.before, entry.after);
                return (
                  <FragmentRow
                    key={entry.id}
                    entry={entry}
                    expanded={expanded}
                    changedFields={changedFields}
                    onToggle={() => setExpandedId(expanded ? null : entry.id)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {fetcher.state !== 'idle' ? <p className="loading-line" role="status">Loading...</p> : null}
      {canLoadMore ? <Button onClick={loadMore} disabled={fetcher.state !== 'idle'}>Load more</Button> : null}
    </section>
  );
}

function FragmentRow({ entry, expanded, changedFields, onToggle }) {
  return (
    <>
      <tr>
        <td>{new Date(entry.ts).toLocaleString()}</td>
        <td>{entry.actor?.name || entry.actor?.email || 'Unknown'}</td>
        <td>{actionLabels[entry.action] || entry.action}</td>
        <td className="mono">{entry.flagKey || 'None'}</td>
        <td className="mono">{entry.envKey || 'None'}</td>
        <td>
          <Button variant="ghost" aria-expanded={expanded} onClick={onToggle}>
            {expanded ? 'Hide details' : 'Show details'}
          </Button>
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={6}>
            <div className="audit-details">
              <div>
                <strong>Fields changed</strong>
                {changedFields.length ? (
                  <ul>{changedFields.map((field) => <li key={field} className="mono">{field}</li>)}</ul>
                ) : <p className="text-muted">No top-level field changes.</p>}
              </div>
              <div className="audit-json">
                <div>
                  <strong>Before</strong>
                  <pre className="mono">{jsonText(entry.before)}</pre>
                </div>
                <div>
                  <strong>After</strong>
                  <pre className="mono">{jsonText(entry.after)}</pre>
                </div>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
