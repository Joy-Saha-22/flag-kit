import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useLoaderData } from 'react-router-dom';
import {
  formatConfidenceInterval,
  formatDifference,
  formatLift,
  formatPValue,
  formatRate,
  getVerdict,
} from '../lib/results';

export default function ResultsPage() {
  const data = useLoaderData();

  if (data.notExperiment) {
    return <div className="empty-state">Results are available for experiments only.</div>;
  }

  const variations = data.variations || [];
  const hasExposures = variations.some((variation) => variation.exposures > 0);
  const chartData = variations.map((variation) => ({
    key: variation.key,
    rate: Number.isFinite(variation.rate) ? variation.rate * 100 : 0,
  }));

  return (
    <section className="detail-section stack">
      <h2 className="section-title">Results</h2>
      {!hasExposures ? (
        <div className="empty-state">
          <strong>No exposures yet.</strong>
          <p>Only experiments record exposure and conversion events.</p>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table results-table">
              <thead>
                <tr>
                  <th>Variation</th>
                  <th>Exposures</th>
                  <th>Conversions</th>
                  <th>Conversion rate</th>
                  <th>Lift</th>
                  <th>Difference</th>
                  <th>95% confidence interval</th>
                  <th>p-value</th>
                  <th>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {variations.map((variation, index) => {
                  const control = index === 0;
                  const comparison = variation.vsControl;
                  const verdict = getVerdict(comparison);
                  return (
                    <tr key={variation.key}>
                      <td className="mono">
                        {variation.key}{control ? ' (control)' : ''}
                      </td>
                      <td className="mono">{Number(variation.exposures || 0).toLocaleString()}</td>
                      <td className="mono">{Number(variation.conversions || 0).toLocaleString()}</td>
                      <td className="mono">{formatRate(variation.rate)}</td>
                      <td className="mono">{control ? 'Control' : formatLift(comparison?.lift)}</td>
                      <td className="mono">{control ? 'Control' : formatDifference(comparison?.difference)}</td>
                      <td className="mono">{control ? 'Control' : formatConfidenceInterval(comparison?.ci95)}</td>
                      <td className="mono">{control ? 'Control' : formatPValue(comparison?.pValue)}</td>
                      <td>{control ? 'Control' : verdict || 'Unavailable'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <section className="panel chart-panel" aria-label="Conversion rate by variation">
            <h3>Conversion rate by variation</h3>
            <div className="results-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="key" tick={{ fill: 'var(--text)', fontSize: 12 }} />
                  <YAxis
                    width={58}
                    tick={{ fill: 'var(--muted)', fontSize: 12 }}
                    tickFormatter={(value) => `${Number(value).toFixed(0)}%`}
                  />
                  <Tooltip
                    formatter={(value) => [`${Number(value).toFixed(2)}%`, 'Conversion rate']}
                    contentStyle={{
                      backgroundColor: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 4,
                      color: 'var(--text)',
                    }}
                  />
                  <Bar dataKey="rate" fill="var(--accent)" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </>
      )}
      <p className="text-muted">
        Rates are compared with the control using a two-sided two-proportion z-test. The returned alpha is {data.alpha}.
      </p>
    </section>
  );
}
