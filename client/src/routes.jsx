import { createBrowserRouter, isRouteErrorResponse, Outlet, redirect, useNavigation, useRouteError } from 'react-router-dom';
import { ApiError } from './lib/api';
import {
  createFlag,
  createProject,
  deleteFlag,
  deleteSdkKey,
  evaluateFlag,
  getCurrentUser,
  getFlag,
  getFlagResults,
  handleApiError,
  listEnvironments,
  listAudit,
  listFlags,
  listProjects,
  listSdkKeys,
  login,
  logout,
  register,
  updateFlag,
  updateFlagEnvironment,
} from './lib/api';
import AppLayout from './pages/AppLayout';
import AuditPage from './pages/AuditPage';
import CreateProjectPage from './pages/CreateProjectPage';
import DemoPage from './pages/DemoPage';
import FlagDetailLayout from './pages/FlagDetailLayout';
import FlagSettingsPage from './pages/FlagSettingsPage';
import FlagsPage from './pages/FlagsPage';
import LoginPage from './pages/LoginPage';
import ProjectHome from './pages/ProjectHome';
import RegisterPage from './pages/RegisterPage';
import SdkKeysPage from './pages/SdkKeysPage';
import TargetingPage from './pages/TargetingPage';

export async function authLoader({ request }) {
  try {
    const [userResponse, projectResponse] = await Promise.all([getCurrentUser(), listProjects()]);
    return { user: userResponse.user, projects: projectResponse.projects || [] };
  } catch (error) {
    return handleLoaderError(error, request);
  }
}

export async function projectLoader({ params, request }) {
  try {
    const [projectsResponse, environmentResponse] = await Promise.all([
      listProjects(),
      listEnvironments(params.pid),
    ]);
    const project = (projectsResponse.projects || []).find((item) => item.id === params.pid);
    if (!project) throw new Response('Not found', { status: 404 });
    return { pid: params.pid, project, environments: environmentResponse.environments || [] };
  } catch (error) {
    return handleLoaderError(error, request);
  }
}

export async function flagsLoader({ params, request }) {
  try {
    const url = new URL(request.url);
    const response = await listFlags(params.pid, {
      search: url.searchParams.get('search') || undefined,
      tag: url.searchParams.get('tag') || undefined,
      limit: 500,
    });
    return { flags: response.flags || [] };
  } catch (error) {
    return handleLoaderError(error, request);
  }
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function handleLoaderError(error, request) {
  if (error instanceof ApiError && error.status === 401) {
    return handleApiError(error, request);
  }
  throw error;
}

async function handleRestrictedLoaderError(error, request) {
  if (error instanceof ApiError && error.status === 403) return { forbidden: true };
  return handleLoaderError(error, request);
}

export async function resultsLoader({ params, request }) {
  const envKey = new URL(request.url).searchParams.get('env') || 'prod';
  try {
    return await getFlagResults(params.pid, params.key, envKey);
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && error.code === 'not_an_experiment') {
      return { notExperiment: true };
    }
    return handleLoaderError(error, request);
  }
}

export async function sdkKeysLoader({ params, request }) {
  const envKey = new URL(request.url).searchParams.get('env') || 'prod';
  try {
    const response = await listSdkKeys(params.pid, envKey);
    return { ...response, envKey };
  } catch (error) {
    return handleRestrictedLoaderError(error, request);
  }
}

export async function sdkKeysAction({ params, request }) {
  const body = await readJson(request);
  try {
    if (body.intent !== 'revoke' || !body.id) {
      return {
        ok: false,
        error: {
          status: 400,
          code: 'invalid_intent',
          message: 'Unsupported SDK key action.',
          requestId: null,
          details: [],
          retryAfterSeconds: null,
        },
      };
    }
    const envKey = body.envKey || new URL(request.url).searchParams.get('env') || 'prod';
    await deleteSdkKey(params.pid, envKey, body.id);
    return { ok: true };
  } catch (error) {
    return handleApiError(error, request);
  }
}

export async function auditLoader({ params, request }) {
  const url = new URL(request.url);
  try {
    const response = await listAudit(params.pid, {
      flag: url.searchParams.get('flag') || undefined,
      env: url.searchParams.get('env') || undefined,
      before: url.searchParams.get('before') || undefined,
      limit: 50,
    });
    return response;
  } catch (error) {
    return handleRestrictedLoaderError(error, request);
  }
}

export async function flagHistoryLoader({ params, request }) {
  const url = new URL(request.url);
  try {
    const response = await listAudit(params.pid, {
      flag: params.key,
      env: url.searchParams.get('env') || undefined,
      before: url.searchParams.get('before') || undefined,
      limit: 50,
    });
    return { ...response, fixedFlag: params.key };
  } catch (error) {
    return handleRestrictedLoaderError(error, request);
  }
}

export async function flagsAction({ params, request }) {
  const body = await readJson(request);
  try {
    if (body.intent === 'create') {
      const response = await createFlag(params.pid, body.flag);
      return { ok: true, flag: response.flag, sync: response.sync };
    }
    if (body.intent === 'toggle') {
      const response = await getFlag(params.pid, body.key);
      const config = response.flag.environments?.[body.env];
      if (!config) return { ok: false, error: { status: 404, code: 'not_found', message: 'Not found.' } };
      const saved = await updateFlagEnvironment(params.pid, body.key, body.env, {
        enabled: !config.enabled,
        offVariation: config.offVariation,
        fallthrough: config.fallthrough,
        rules: config.rules,
        expectedVersion: config.version,
      });
      return { ok: true, flag: saved.flag, sync: saved.sync };
    }
    return { ok: false, error: { status: 400, code: 'invalid_intent', message: 'Unsupported flag action.' } };
  } catch (error) {
    return handleApiError(error, request);
  }
}

export async function flagLoader({ params, request }) {
  try {
    const response = await getFlag(params.pid, params.key);
    return { flag: response.flag };
  } catch (error) {
    return handleLoaderError(error, request);
  }
}

export async function targetingAction({ params, request }) {
  const body = await readJson(request);
  const url = new URL(request.url);
  const envKey = url.searchParams.get('env') || 'prod';
  try {
    const response = await updateFlagEnvironment(params.pid, params.key, envKey, body);
    return { ok: true, sync: response.sync, flag: response.flag };
  } catch (error) {
    return handleApiError(error, request);
  }
}

export async function flagSettingsAction({ params, request }) {
  const body = await readJson(request);
  const url = new URL(request.url);
  const env = url.searchParams.get('env') || 'prod';
  try {
    if (body.intent === 'delete') {
      const result = await deleteFlag(params.pid, params.key);
      const sync = result?.sync === 'delayed' ? '&sync=delayed' : '';
      return redirect(`/p/${params.pid}/flags?env=${encodeURIComponent(env)}${sync}`);
    }
    const { intent: ignoredIntent, ...patch } = body;
    const response = await updateFlag(params.pid, params.key, patch);
    return { ok: true, sync: response.sync, flag: response.flag };
  } catch (error) {
    return handleApiError(error, request);
  }
}

export async function evaluateAction({ params, request }) {
  const body = await readJson(request);
  const url = new URL(request.url);
  const envKey = body.envKey || url.searchParams.get('env') || 'prod';
  try {
    const result = await evaluateFlag(params.pid, params.key, envKey, { userContext: body.userContext });
    return { ok: true, result };
  } catch (error) {
    return handleApiError(error, request);
  }
}

export function flagShouldRevalidate({ currentUrl, nextUrl, formMethod, formAction, actionResult }) {
  const current = new URL(currentUrl);
  const next = new URL(nextUrl);
  const matchDetailPath = (pathname) => pathname.match(/^\/p\/([^/]+)\/flags\/([^/]+)(?:\/.*)?$/);
  const currentMatch = matchDetailPath(current.pathname);
  const nextMatch = matchDetailPath(next.pathname);
  if (!currentMatch || !nextMatch) return false;
  if (currentMatch[1] !== nextMatch[1] || currentMatch[2] !== nextMatch[2]) return true;
  if (current.searchParams.get('env') !== next.searchParams.get('env')) return true;
  if (formMethod) {
    const actionPath = new URL(formAction || current.pathname, current.origin).pathname;
    const basePath = `/p/${currentMatch[1]}/flags/${currentMatch[2]}`;
    return Boolean(actionResult?.ok) && (actionPath === basePath || actionPath === `${basePath}/settings`);
  }
  if (current.search !== next.search) return true;
  return false;
}

async function loginAction({ request }) {
  const form = await request.formData();
  const next = new URL(request.url).searchParams.get('next');
  try {
    await login({ email: String(form.get('email') || ''), password: String(form.get('password') || '') });
    return redirect(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return {
        ok: false,
        error: {
          status: 401,
          code: error.code,
          message: 'Invalid email or password.',
          requestId: error.requestId,
        },
      };
    }
    return handleApiError(error, request);
  }
}

async function registerAction({ request }) {
  const form = await request.formData();
  try {
    await register({
      name: String(form.get('name') || ''),
      email: String(form.get('email') || ''),
      password: String(form.get('password') || ''),
    });
    return redirect('/');
  } catch (error) {
    return handleApiError(error, request);
  }
}

async function logoutAction({ request }) {
  try {
    await logout();
    return redirect('/login');
  } catch (error) {
    return handleApiError(error, request);
  }
}

async function createProjectAction({ request }) {
  const form = await request.formData();
  try {
    const response = await createProject({
      name: String(form.get('name') || ''),
      key: String(form.get('key') || ''),
    });
    return redirect(`/p/${response.project.id}/flags`);
  } catch (error) {
    return handleApiError(error, request);
  }
}

function AppRoot() {
  const navigation = useNavigation();
  return (
    <>
      {navigation.state !== 'idle' ? <div className="route-loading" role="status">Loading...</div> : null}
      <Outlet />
    </>
  );
}

function RouteError() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : error?.status;
  const message = status === 404 ? 'The requested item was not found.' : 'The request could not be completed.';
  const requestId = error?.requestId || error?.data?.requestId;
  return (
    <main className="page">
      <section className="error-state" role="alert">
        <h1>{status === 404 ? 'Not found' : 'Unable to load this page'}</h1>
        <p>{message}</p>
        {requestId ? <div className="mono text-small">Request ID: {requestId}</div> : null}
      </section>
    </main>
  );
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppRoot />,
    errorElement: <RouteError />,
    children: [
      { path: 'login', element: <LoginPage />, action: loginAction },
      { path: 'register', element: <RegisterPage />, action: registerAction },
      { path: 'logout', action: logoutAction },
      { path: 'demo', element: <DemoPage /> },
      {
        id: 'auth',
        loader: authLoader,
        children: [
          { index: true, element: <ProjectHome /> },
          { path: 'create-project', element: <CreateProjectPage />, action: createProjectAction },
          {
            id: 'project',
            path: 'p/:pid',
            loader: projectLoader,
            element: <AppLayout />,
            children: [
              { index: true, element: <ProjectHome /> },
              {
                path: 'flags',
                loader: flagsLoader,
                action: flagsAction,
                element: <FlagsPage />,
              },
              {
                path: 'flags/:key/evaluate',
                action: evaluateAction,
              },
              {
                id: 'flag',
                path: 'flags/:key',
                loader: flagLoader,
                action: targetingAction,
                shouldRevalidate: flagShouldRevalidate,
                element: <FlagDetailLayout />,
                children: [
                  { index: true, element: <TargetingPage /> },
                  { path: 'settings', action: flagSettingsAction, element: <FlagSettingsPage /> },
                  {
                    path: 'results',
                    loader: resultsLoader,
                    lazy: async () => {
                      const { default: Component } = await import('./pages/ResultsPage');
                      return { Component };
                    },
                  },
                  { path: 'history', loader: flagHistoryLoader, element: <AuditPage /> },
                ],
              },
              { path: 'sdk-keys', loader: sdkKeysLoader, action: sdkKeysAction, element: <SdkKeysPage /> },
              { path: 'audit', loader: auditLoader, element: <AuditPage /> },
            ],
          },
        ],
      },
    ],
  },
]);
