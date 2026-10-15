import { useState } from 'react';
import { useFetcher, useLoaderData, useLocation, useNavigate, useRevalidator, useRouteLoaderData } from 'react-router-dom';
import { ApiError, createSdkKey, handleApiError } from '../lib/api';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';
import Dialog from '../ui/Dialog';

export default function SdkKeysPage() {
  const { sdkKeys = [], forbidden } = useLoaderData();
  const { project } = useRouteLoaderData('project');
  const location = useLocation();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const revokeFetcher = useFetcher();
  const [createOpen, setCreateOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyType, setKeyType] = useState('server');
  const [createdKey, setCreatedKey] = useState(null);
  const [createError, setCreateError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [revokeTarget, setRevokeTarget] = useState(null);
  const env = new URLSearchParams(location.search).get('env') || 'prod';
  const admin = project.role === 'admin';

  async function createKey(event) {
    event.preventDefault();
    setCreateError('');
    try {
      const response = await createSdkKey(project.id, env, { type: keyType });
      setCreatedKey(response.sdkKey);
      setCreateOpen(false);
      setKeyOpen(true);
      revalidator.revalidate();
    } catch (error) {
      if (error instanceof ApiError) {
        try {
          const handled = await handleApiError(error, new Request(window.location.href));
          setCreateError(handled?.error?.message || error.message);
        } catch (routed) {
          if (routed instanceof Response && routed.headers.get('Location')) {
            navigate(routed.headers.get('Location'));
          } else {
            setCreateError(routed instanceof Error ? routed.message : 'The key could not be created.');
          }
        }
      } else {
        setCreateError(error instanceof Error ? error.message : 'The key could not be created.');
      }
    }
  }

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(createdKey.key);
      setCopyStatus('Copied.');
    } catch (error) {
      setCopyStatus(error instanceof Error ? 'Copy failed. Select and copy the key manually.' : 'Copy failed.');
    }
  }

  function closeKeyDialog(open) {
    setKeyOpen(open);
    if (!open) {
      setCreatedKey(null);
      setCopyStatus('');
    }
  }

  function confirmRevoke() {
    revokeFetcher.submit(
      { intent: 'revoke', id: revokeTarget.id, envKey: env },
      { method: 'post', encType: 'application/json', action: `${location.pathname}${location.search}` },
    );
    setRevokeTarget(null);
  }

  if (forbidden) {
    return <div className="page"><div className="empty-state">Editor access is needed to view SDK keys.</div></div>;
  }

  return (
    <main className="page stack">
      <header className="page-heading">
        <div>
          <h1>SDK Keys</h1>
          <p className="text-muted">Environment: <span className="mono">{env}</span></p>
        </div>
        {admin ? <Button variant="primary" onClick={() => { setCreateError(''); setCreateOpen(true); }}>Create key</Button> : null}
      </header>

      {revokeFetcher.data?.ok === false ? (
        <div className="error-state" role="alert">{revokeFetcher.data.error.message}</div>
      ) : null}
      {revokeFetcher.state !== 'idle' ? <p className="loading-line" role="status">Loading...</p> : null}
      {sdkKeys.length ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Prefix</th><th>Type</th><th>Created</th><th>State</th>{admin ? <th>Action</th> : null}</tr></thead>
            <tbody>
              {sdkKeys.map((sdkKey) => (
                <tr key={sdkKey.id}>
                  <td className="mono">{sdkKey.prefix}</td>
                  <td>{sdkKey.type}</td>
                  <td>{new Date(sdkKey.createdAt).toLocaleString()}</td>
                  <td>{sdkKey.revokedAt ? `Revoked ${new Date(sdkKey.revokedAt).toLocaleString()}` : 'Active'}</td>
                  {admin ? (
                    <td>
                      {!sdkKey.revokedAt ? (
                        <Button onClick={() => setRevokeTarget(sdkKey)}>Revoke</Button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="empty-state">No SDK keys in this environment.</div>}

      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Create SDK key"
        description="Server keys stay on trusted servers. Client keys are public, ship in browser code, and expose all targeting rules. Do not put secrets in rule values."
      >
        <form className="stack" onSubmit={createKey}>
          <label className="form-field">
            <span className="field-label">Key type</span>
            <select value={keyType} onChange={(event) => setKeyType(event.target.value)}>
              <option value="server">Server</option>
              <option value="client">Client</option>
            </select>
          </label>
          {createError ? <div className="error-state" role="alert">{createError}</div> : null}
          <div className="dialog-actions">
            <Button type="button" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit">Create key</Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={keyOpen}
        onOpenChange={closeKeyDialog}
        title="Copy your SDK key"
        description="This full key is shown once and cannot be shown again after this dialog closes."
      >
        {createdKey ? (
          <div className="stack">
            <label className="form-field">
              <span className="field-label">Full key</span>
              <input className="mono" readOnly value={createdKey.key} />
            </label>
            <div className="dialog-actions">
              {copyStatus ? <span role="status">{copyStatus}</span> : null}
              <Button variant="primary" onClick={copyKey}>Copy</Button>
            </div>
          </div>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => { if (!open) setRevokeTarget(null); }}
        title="Revoke SDK key"
        description={`Revoke the ${revokeTarget?.type || ''} key with prefix ${revokeTarget?.prefix || ''}? Existing uses of this key will stop authenticating.`}
        confirmLabel="Revoke key"
        onConfirm={confirmRevoke}
      />
    </main>
  );
}
