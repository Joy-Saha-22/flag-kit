import { Navigate, useParams, useRouteLoaderData } from 'react-router-dom';
import CreateProjectPage from './CreateProjectPage';

export default function ProjectHome() {
  const { pid } = useParams();
  const auth = useRouteLoaderData('auth');

  if (pid) return <Navigate to={`/p/${pid}/flags`} replace />;
  if (!auth.projects.length) return <CreateProjectPage />;
  return <Navigate to={`/p/${auth.projects[0].id}/flags`} replace />;
}
