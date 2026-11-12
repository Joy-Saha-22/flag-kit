import { NavLink, Outlet, useFetcher, useLoaderData, useLocation, useNavigate, useRouteLoaderData, useSearchParams } from 'react-router-dom';
import Button from '../ui/Button';

export default function AppLayout() {
  const { project, environments } = useLoaderData();
  const auth = useRouteLoaderData('auth');
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const logout = useFetcher();
  const currentEnv = searchParams.get('env') || 'prod';

  function changeEnvironment(event) {
    const nextSearch = new URLSearchParams(searchParams);
    nextSearch.set('env', event.target.value);
    navigate(`${location.pathname}?${nextSearch.toString()}`);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">F</span>
          <span>FlagKit</span>
        </div>
        <div className="sidebar-section-label">Workspace</div>
        <nav className="nav-list" aria-label="Workspace navigation">
          <NavLink className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} to={`/p/${project.id}/flags${location.search}`}>
            Flags
          </NavLink>
          <NavLink className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} to={`/p/${project.id}/sdk-keys${location.search}`}>
            SDK keys
          </NavLink>
          <NavLink className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} to={`/p/${project.id}/audit${location.search}`}>
            Audit log
          </NavLink>
          <NavLink className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} to="/demo">
            SDK demo
          </NavLink>
        </nav>
      </aside>

      <div className="main-panel">
        <header className="topbar">
          <div className="toolbar-group">
            <select className="selector project-selector" value={project.id} onChange={(event) => navigate(`/p/${event.target.value}/flags${location.search}`)} aria-label="Project">
              {auth.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <label className="environment-switcher">
              <span className="text-small">Environment</span>
              <select className="selector" value={currentEnv} onChange={changeEnvironment} aria-label="Environment">
                {environments.map((environment) => (
                  <option key={environment.key} value={environment.key}>
                    {environment.key === 'prod' ? 'prod (production)' : environment.key}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="toolbar-group">
            <span className="user-badge">{auth.user?.name || 'User'}</span>
            <logout.Form method="post" action="/logout">
              <Button type="submit">Sign out</Button>
            </logout.Form>
          </div>
        </header>
        <Outlet />
      </div>
    </div>
  );
}
