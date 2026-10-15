export default function Textarea({ label, error, ...props }) {
  const field = (
    <textarea {...props} aria-invalid={Boolean(error)} />
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
