export default function Badge({ children, tone = 'default' }) {
  const toneClass = tone === 'success' ? 'status enabled' : tone === 'danger' ? 'status disabled' : 'badge';
  return <span className={toneClass}>{children}</span>;
}
