import { useState } from 'react';
import { Form, Link, useFetcher, useLoaderData, useLocation, useRouteLoaderData, useSearchParams } from 'react-router-dom';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Switch from '../ui/Switch';
import Badge from '../ui/Badge';
import CreateFlagDialog from '../features/flags/CreateFlagDialog';
import ConfirmDialog from '../ui/ConfirmDialog';

export default function FlagsPage() {
  const { flags } = useLoaderData();
  const { project } = useRouteLoaderData('project');
  const fetcher = useFetcher();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmFlag, setConfirmFlag] = useState(null);
  const [pendingToggle, setPendingToggle] = useState(null);
  const env = searchParams.get('env') || 'prod';
  const canEdit = project.role === 'editor' || project.role === 'admin';

  function submitToggle(flag) {
    fetcher.submit(
      { intent: 'toggle', key: flag.key, env },
      { method: 'post', encType: 'application/json', action: location.pathname + location.search },
    );
  }

  function handleToggle(flag) {
    if (env === 'prod') {
      setPendingToggle(flag);
      setConfirmFlag(flag);
    } else {
      submitToggle(flag);
    }
  }

  function handleCreate(payload) {
    fetcher.submit(
      { intent: 'create', flag: payload },
      { method: 'post', encType: 'application/json', action: location.pathname + location.search },
    );
    setDialogOpen(false);
  }

  const actionError = fetcher.data?.ok === false ? fetcher.data.error : null;

  return (
    <div className="page">
      <div className="stack">
        <div className="inline-row list-toolbar">
          <Form method="get" className="inline-row">
            <Input name="search" defaultValue={searchParams.get('search') || ''} placeholder="Search flags" aria-label="Search flags" />
            <Select name="tag" defaultValue={searchParams.get('tag') || ''} aria-label="Filter by tag">
              <option value="">All tags</option>
              {Array.from(new Set(flags.flatMap((flag) => flag.tags || []))).map((tag) => (
                <option key={tag} value={tag}>{tag}</option>
              ))}
            </Select>
            {env !== 'prod' ? <input type="hidden" name="env" value={env} /> : null}
            <Button type="submit">Filter</Button>
          </Form>
          {canEdit ? <Button variant="primary" onClick={() => setDialogOpen(true)}>New flag</Button> : null}
        </div>

        {actionError ? (
          <div className="error-state" role="alert">
            <strong>{actionError.message}</strong>
            {actionError.requestId ? <div className="mono text-small">Request ID: {actionError.requestId}</div> : null}
          </div>
        ) : null}
        {fetcher.data?.ok && fetcher.data.sync === 'delayed' ? <div className="notice-state">Saved. Live updates may lag.</div> : null}
        {searchParams.get('sync') === 'delayed' ? <div className="notice-state">Saved. Live updates may lag.</div> : null}
        {fetcher.state !== 'idle' ? <div className="loading-line">Loading...</div> : null}

        {flags.length === 0 ? (
          <div className="empty-state">No flags found.</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Key</th>
                  <th>Tags</th>
                  <th>Experiment</th>
                  <th>Status</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {flags.map((flag) => {
                  const config = flag.environments?.[env] || { enabled: false };
                  return (
                    <tr key={flag.id || flag.key}>
                      <td><Link to={`/p/${project.id}/flags/${encodeURIComponent(flag.key)}${location.search}`}>{flag.name}</Link></td>
                      <td><Link className="mono" to={`/p/${project.id}/flags/${encodeURIComponent(flag.key)}${location.search}`}>{flag.key}</Link></td>
                      <td>{(flag.tags || []).map((tag) => <Badge key={tag}>{tag}</Badge>)}</td>
                      <td>{flag.isExperiment ? <Badge tone="success">Experiment</Badge> : <span className="text-muted">Standard</span>}</td>
                      <td>
                        <Switch checked={Boolean(config.enabled)} disabled={!canEdit || fetcher.state !== 'idle'} onCheckedChange={() => handleToggle(flag)} label={config.enabled ? 'On' : 'Off'} />
                      </td>
                      <td>{flag.updatedAt ? new Date(flag.updatedAt).toLocaleString() : 'Unknown'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CreateFlagDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreate={handleCreate} />
      <ConfirmDialog
        open={Boolean(confirmFlag)}
        onOpenChange={(open) => { if (!open) { setConfirmFlag(null); setPendingToggle(null); } }}
        title="Change production flag"
        description={`Change the enabled state for "${confirmFlag?.name || ''}" in prod?`}
        confirmLabel="Confirm change"
        onConfirm={() => {
          if (pendingToggle) submitToggle(pendingToggle);
          setConfirmFlag(null);
          setPendingToggle(null);
        }}
      />
    </div>
  );
}
