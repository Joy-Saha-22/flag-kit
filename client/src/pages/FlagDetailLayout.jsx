import { useState } from 'react';
import { NavLink, Outlet, useFetcher, useLoaderData, useLocation, useParams, useRouteLoaderData } from 'react-router-dom';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';

export default function FlagDetailLayout() {
  const { flag } = useLoaderData();
  const projectData = useRouteLoaderData('project');
  const { pid } = projectData;
  const { key } = useParams();
  const location = useLocation();
  const search = location.search;
  const flagPath = `/p/${pid}/flags/${encodeURIComponent(key)}`;
  const role = projectData.project.role;
  const deletion = useFetcher();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [typedKey, setTypedKey] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const canDelete = role === 'admin';

  function confirmDelete() {
    if (typedKey !== flag.key) {
      setDeleteError('Enter the exact flag key to confirm deletion.');
      return false;
    }
    deletion.submit(
      { intent: 'delete' },
      { method: 'post', encType: 'application/json', action: `/p/${pid}/flags/${encodeURIComponent(flag.key)}/settings${search}` },
    );
    return true;
  }

  return (
    <>
      <main className="page">
        <header className="flag-detail-header">
          <div>
            <h1>{flag.name}</h1>
            <div className="inline-row">
              <span className="mono">{flag.key}</span>
              {(flag.tags || []).map((tag) => <Badge key={tag}>{tag}</Badge>)}
              {flag.isExperiment ? <Badge tone="success">Experiment</Badge> : null}
            </div>
          </div>
          {canDelete ? (
            <Button variant="secondary" onClick={() => { setTypedKey(''); setDeleteError(''); setDeleteOpen(true); }}>
              Delete
            </Button>
          ) : null}
        </header>

        <nav className="flag-tabs" aria-label="Flag sections">
          <NavLink end to={{ pathname: flagPath, search }}>Targeting</NavLink>
          <NavLink to={{ pathname: `${flagPath}/settings`, search }}>Variations and settings</NavLink>
          {flag.isExperiment ? <NavLink to={{ pathname: `${flagPath}/results`, search }}>Results</NavLink> : null}
          <NavLink to={{ pathname: `${flagPath}/history`, search }}>History</NavLink>
        </nav>

        {deletion.data?.ok === false ? (
          <div className="error-state" role="alert">
            <strong>{deletion.data.error.message}</strong>
            {deletion.data.error.requestId ? <div className="mono text-small">Request ID: {deletion.data.error.requestId}</div> : null}
          </div>
        ) : null}

        <Outlet />
      </main>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete flag"
        description="This removes the flag and its environment configuration. Enter the exact flag key to confirm."
        confirmLabel={deletion.state === 'submitting' ? 'Deleting...' : 'Delete flag'}
        onConfirm={confirmDelete}
      >
        <div className="stack">
          <label className="form-field">
            <span className="field-label">Flag key</span>
            <input className="mono" value={typedKey} onChange={(event) => setTypedKey(event.target.value)} />
          </label>
          {deleteError ? <span className="error-text">{deleteError}</span> : null}
        </div>
      </ConfirmDialog>
    </>
  );
}
