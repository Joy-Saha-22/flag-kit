import { Form, Link, useActionData } from 'react-router-dom';
import Button from '../ui/Button';
import Input from '../ui/Input';

export default function RegisterPage() {
  const actionData = useActionData();
  const error = actionData?.ok === false ? actionData.error : null;

  return (
    <div className="page">
      <div className="panel auth-panel">
        <h1>Create account</h1>
        <Form method="post" className="stack">
          <Input label="Name" name="name" autoComplete="name" maxLength={80} required />
          <Input label="Email" name="email" type="email" autoComplete="email" required />
          <Input label="Password" name="password" type="password" autoComplete="new-password" minLength={12} required />
          {error ? (
            <div className="error-state" role="alert">
              <strong>{error.message}</strong>
              {error.requestId ? <span className="mono text-small">Request ID: {error.requestId}</span> : null}
            </div>
          ) : null}
          <Button type="submit" variant="primary">Create account</Button>
        </Form>
        <p className="text-small">Have an account? <Link to="/login">Sign in</Link></p>
      </div>
    </div>
  );
}
