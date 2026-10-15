import { Form, Link, useActionData, useSearchParams } from 'react-router-dom';
import Button from '../ui/Button';
import Input from '../ui/Input';

export default function LoginPage() {
  const actionData = useActionData();
  const [searchParams] = useSearchParams();
  const error = actionData?.ok === false ? actionData.error : null;

  return (
    <div className="page">
      <div className="panel auth-panel">
        <h1>Sign in</h1>
        <Form method="post" className="stack">
          <Input label="Email" name="email" type="email" autoComplete="email" required />
          <Input label="Password" name="password" type="password" autoComplete="current-password" required />
          {error ? (
            <div className="error-state" role="alert">
              <strong>{error.status === 401 ? 'Invalid email or password.' : error.message}</strong>
              {error.retryAfterSeconds ? <p>Try again in {error.retryAfterSeconds} seconds.</p> : null}
              {error.requestId ? <span className="mono text-small">Request ID: {error.requestId}</span> : null}
            </div>
          ) : null}
          {searchParams.get('next') ? <input type="hidden" name="next" value={searchParams.get('next')} /> : null}
          <Button type="submit" variant="primary">Sign in</Button>
        </Form>
        <p className="text-small">Need an account? <Link to="/register">Create one</Link></p>
      </div>
    </div>
  );
}
