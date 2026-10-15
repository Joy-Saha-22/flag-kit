export default function Select({ label, error, children, ...props }) {
  const field = (
    <select {...props} aria-invalid={Boolean(error)}>
      {children}
    </select>
  );

  if (!label) {
    return field;
  }

  return (
    <label className="form-field">
      <span className="field-label">{label}</span>
      {field}
      {error ? <span className="error-text">{error}</span> : null}
    </label>
  );
}
