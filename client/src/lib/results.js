export function formatRate(rate) {
  return formatPercent(rate);
}

export function formatLift(lift) {
  return formatPercent(lift);
}

export function formatDifference(difference) {
  return `${(difference * 100).toFixed(2)} pp`;
}

export function formatConfidenceInterval(interval) {
  if (!Array.isArray(interval) || interval.length !== 2) return 'Unavailable';
  return `${formatPercent(interval[0])} to ${formatPercent(interval[1])}`;
}

export function formatPValue(pValue) {
  if (!Number.isFinite(pValue)) return 'Unavailable';
  if (pValue < 0.0001) return '< 0.0001';
  return pValue.toFixed(4);
}

export function getVerdict(vsControl) {
  if (!vsControl) return null;
  if (!vsControl.sampleSizeOk) return 'Not enough data yet';
  return vsControl.significant ? 'Significant' : 'Not significant';
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : 'Unavailable';
}
