import { Form, useActionData } from 'react-router-dom';
import Button from '../ui/Button';
import Input from '../ui/Input';

export default function CreateProjectPage() {
  const actionData = useActionData();
  const error = actionData?.ok === false ? actionData.error : null;

  return (
    <div className="page">
      <div className="panel auth-panel">
        <h1>Create your first project</h1>
        <Form method="post" action="/create-project" className="stack">
          <Input label="Project name" name="name" maxLength={80} required />
          <Input label="Project key" name="key" pattern="[a-z0-9][a-z0-9-_]{1,63}" required />
          {error ? (
            <div className="error-state" role="alert">
              <strong>{error.message}</strong>
              {error.requestId ? <span className="mono text-small">Request ID: {error.requestId}</span> : null}
            </div>
          ) : null}
          <Button type="submit" variant="primary">Create project</Button>
        </Form>
      </div>
    </div>
  );
}
