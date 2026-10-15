export default function FormField({ label, error, children }) {
  return (
    <label className="form-field">
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="error-text">{error}</span> : null}
    </label>
  );
}
