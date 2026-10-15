export default function PlaceholderPage({ title, description }) {
  return (
    <div className="page">
      <div className="panel" style={{ padding: '1.25rem' }}>
        <h2>{title}</h2>
        <p className="text-muted">{description}</p>
      </div>
    </div>
  );
}
