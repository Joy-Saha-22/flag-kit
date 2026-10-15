export default function Input({ label, error, ...props }) {
  const field = (
    <input {...props} aria-invalid={Boolean(error)} />
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
