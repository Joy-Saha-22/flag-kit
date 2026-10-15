import { createClient } from 'flagkit-sdk';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../ui/Button';

const demoSdkKey = import.meta.env.VITE_DEMO_CLIENT_SDK_KEY || '';
const apiUrl = import.meta.env.VITE_API_URL || window.location.origin;

export default function DemoPage() {
  const [flagKey, setFlagKey] = useState('checkout');
  const [userKey, setUserKey] = useState('user-1');
  const [metricKey, setMetricKey] = useState('');
  const [client, setClient] = useState(null);
  const [status, setStatus] = useState('starting');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [evaluated, setEvaluated] = useState(false);

  useEffect(() => {
    if (!demoSdkKey) {
      setStatus('missing-key');
      return undefined;
    }
    let mounted = true;
    const sdkClient = createClient({ sdkKey: demoSdkKey, baseUrl: apiUrl });
    const unsubscribe = sdkClient.onChange(() => {
      if (mounted) {
        setRevision((current) => current + 1);
        setEvaluated(false);
      }
    });
    setClient(sdkClient);
    setStatus('starting');
    sdkClient.waitForInit().then(() => {
      if (mounted) setStatus('ready');
    }).catch((initializationError) => {
      if (mounted) {
        setError(initializationError instanceof Error ? initializationError.message : 'SDK initialization failed.');
        setStatus('error');
      }
    });
    return () => {
      mounted = false;
      unsubscribe();
      void sdkClient.close();
    };
  }, []);

  const userContext = useMemo(() => ({ key: userKey }), [userKey]);
  const liveDetail = client?.isReady() && flagKey && userKey
    ? client.variationDetail(flagKey, userContext, null)
    : null;
  void revision;

  function evaluateFlag() {
    if (!client?.isReady()) return;
    client.variationDetail(flagKey, userContext, null);
    setEvaluated(true);
  }

  function trackMetric() {
    if (!client?.isReady() || !metricKey) return;
    client.track(metricKey, userContext);
  }

  return (
    <main className="page demo-page stack">
      <header className="page-heading">
        <div>
          <h1>SDK Demo</h1>
          <p className="text-muted">Live local evaluation using a client SDK key.</p>
        </div>
        <Link to="/">Dashboard</Link>
      </header>

      {!demoSdkKey ? (
        <section className="empty-state">
          <h2>Client SDK key required</h2>
          <p>Set VITE_DEMO_CLIENT_SDK_KEY to a client key for this project, then restart the dashboard.</p>
          <p>Set VITE_API_URL only when the API is not available through the local development proxy.</p>
        </section>
      ) : (
        <>
          {status === 'starting' ? <p className="loading-line" role="status">Loading...</p> : null}
          {status === 'error' ? <div className="error-state" role="alert">{error}</div> : null}

          <section className="panel demo-controls">
            <label className="form-field">
              <span className="field-label">Flag key</span>
              <input className="mono" value={flagKey} onChange={(event) => { setFlagKey(event.target.value); setEvaluated(false); }} />
            </label>
            <label className="form-field">
              <span className="field-label">User key</span>
              <input className="mono" value={userKey} onChange={(event) => { setUserKey(event.target.value); setEvaluated(false); }} />
            </label>
          </section>
          <section className="panel demo-value">
            <h2>Live value</h2>
            <dl className="result-list">
              <div><dt>Variation</dt><dd className="mono">{liveDetail?.variationKey || 'No variation served'}</dd></div>
              <div><dt>Value</dt><dd className="mono">{liveDetail ? JSON.stringify(liveDetail.value) : 'Waiting for SDK'}</dd></div>

              <div>
                <dt>Reason</dt>
                <dd>
                  {typeof liveDetail?.reason === 'string'
                    ? liveDetail.reason
                    : liveDetail?.reason
                      ? JSON.stringify(liveDetail.reason)
                      : status}
                </dd>
              </div>

            </dl>
            <Button variant="primary" disabled={status !== 'ready' || !flagKey || !userKey} onClick={evaluateFlag}>
              Evaluate flag
            </Button>
            {evaluated ? <span className="text-small">Evaluation requested.</span> : null}
          </section>
          <section className="panel demo-controls">
            <label className="form-field">
              <span className="field-label">Metric key</span>
              <input className="mono" value={metricKey} onChange={(event) => setMetricKey(event.target.value)} />
            </label>
            <p className="text-muted">Track records a conversion for matching experiments after the user is evaluated.</p>
            <Button disabled={status !== 'ready' || !metricKey || !userKey} onClick={trackMetric}>Track metric</Button>
          </section>
        </>
      )}
    </main>
  );
}
