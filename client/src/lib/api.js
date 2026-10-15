import { redirect } from 'react-router-dom';

export class ApiError extends Error {
  constructor({ status, code, message, requestId, details, retryAfterSeconds }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.message = message;
    this.requestId = requestId;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const unauthorizedSignal = 'flagkit:unauthorized';

export function emitUnauthorized() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(unauthorizedSignal));
  }
}

export async function apiFetch(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headerObject = { ...(options.headers || {}) };

  if (method !== 'GET') {
    headerObject['X-Requested-By'] = 'flagkit-dashboard';
  }

  if (options.body && typeof options.body !== 'string' && !(options.body instanceof FormData)) {
    headerObject['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    ...options,
    method,
    credentials: 'include',
    headers: headerObject,
    body: options.body && typeof options.body !== 'string' && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body,
  });

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json().catch(() => null) : await response.text();

  if (!response.ok) {
    const errorBody = payload && typeof payload === 'object' && 'error' in payload ? payload.error : payload;
    const details = errorBody?.details ?? payload?.details ?? undefined;
    const requestId = errorBody?.requestId ?? payload?.requestId ?? null;
    const retryAfterSeconds = response.headers.get('Retry-After') ? Number(response.headers.get('Retry-After')) : undefined;

    if (response.status === 401) {
      emitUnauthorized();
    }

    throw new ApiError({
      status: response.status,
      code: errorBody?.code ?? payload?.code ?? 'request_failed',
      message: errorBody?.message ?? payload?.message ?? 'Request failed.',
      requestId,
      details,
      retryAfterSeconds,
    });
  }

  return payload ?? null;
}

/**
 * Get the current signed-in user.
 * @returns {Promise<{ user: { id: string, email: string, name: string } }>}
 */
export async function getCurrentUser() {
  return apiFetch('/api/auth/me');
}

/**
 * Login a user.
 * @param {{ email: string, password: string }} body
 * @returns {Promise<{ user: { id: string, email: string, name: string } }>}
 */
export async function login(body) {
  return apiFetch('/api/auth/login', { method: 'POST', body });
}

/**
 * Register a user.
 * @param {{ email: string, password: string, name: string }} body
 * @returns {Promise<{ user: { id: string, email: string, name: string } }>}
 */
export async function register(body) {
  return apiFetch('/api/auth/register', { method: 'POST', body });
}

/**
 * Log out the current user.
 * @returns {Promise<null>}
 */
export async function logout() {
  return apiFetch('/api/auth/logout', { method: 'POST' });
}

/**
 * List projects for the signed-in user.
 * @returns {Promise<{ projects: Array<{ id: string, name: string, key: string, role: string, createdAt?: string }> }>} 
 */
export async function listProjects() {
  return apiFetch('/api/projects');
}

/**
 * Create a project.
 * @param {{ name: string, key: string }} body
 * @returns {Promise<{ project: { id: string, name: string, key: string, role: string }, environments: Array<{ id: string, key: string, name: string }> }>} 
 */
export async function createProject(body) {
  return apiFetch('/api/projects', { method: 'POST', body });
}

/**
 * List environments for a project.
 * @param {string} projectId
 * @returns {Promise<{ environments: Array<{ id: string, key: string, name: string }> }>}
 */
export async function listEnvironments(projectId) {
  return apiFetch(`/api/projects/${projectId}/environments`);
}

/**
 * List flags in a project.
 * @param {string} projectId
 * @param {{ search?: string, tag?: string, limit?: number }} query
 * @returns {Promise<{ flags: Array<any> }>}
 */
export async function listFlags(projectId, query = {}) {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  if (query.tag) params.set('tag', query.tag);
  if (query.limit) params.set('limit', String(query.limit));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return apiFetch(`/api/projects/${projectId}/flags${suffix}`);
}

/**
 * Create a flag.
 * @param {string} projectId
 * @param {any} body
 * @returns {Promise<{ flag: any, sync: string }>}
 */
export async function createFlag(projectId, body) {
  return apiFetch(`/api/projects/${projectId}/flags`, { method: 'POST', body });
}

/**
 * Load one flag.
 * @param {string} projectId
 * @param {string} key
 * @returns {Promise<{ flag: any }>}
 */
export async function getFlag(projectId, key) {
  return apiFetch(`/api/projects/${projectId}/flags/${key}`);
}

/**
 * Update a flag.
 * @param {string} projectId
 * @param {string} key
 * @param {any} patch
 * @returns {Promise<{ flag: any, sync: string }>}
 */
export async function updateFlag(projectId, key, patch) {
  return apiFetch(`/api/projects/${projectId}/flags/${key}`, { method: 'PUT', body: patch });
}

/**
 * Delete a flag.
 * @param {string} projectId
 * @param {string} key
 * @returns {Promise<{ deleted: boolean, sync: string }>}
 */
export async function deleteFlag(projectId, key) {
  return apiFetch(`/api/projects/${projectId}/flags/${key}`, { method: 'DELETE' });
}

/**
 * Update a flag environment config.
 * @param {string} projectId
 * @param {string} key
 * @param {string} envKey
 * @param {any} config
 * @returns {Promise<{ flag: any, sync: string }>}
 */
export async function updateFlagEnvironment(projectId, key, envKey, config) {
  return apiFetch(`/api/projects/${projectId}/flags/${key}/environments/${envKey}`, { method: 'PUT', body: config });
}

/**
 * Evaluate a flag in test mode.
 * @param {string} projectId
 * @param {string} key
 * @param {string} envKey
 * @param {{ userContext: Record<string, any> }} body
 * @returns {Promise<{ variation: string|null, value: any, reason: any }>}
 */
export async function evaluateFlag(projectId, key, envKey, body) {
  return apiFetch(`/api/projects/${projectId}/flags/${key}/environments/${envKey}/evaluate-test`, { method: 'POST', body });
}

/**
 * Convert known API errors into action data and redirect unauthenticated requests.
 * @param {unknown} thrown
 * @param {Request} request
 */
export async function handleApiError(thrown, request) {
  const error = thrown instanceof ApiError ? thrown : null;
  if (!error) throw thrown;

  if (error.status === 401) {
    const url = new URL(request.url);
    const next = `${url.pathname}${url.search}`;
    throw redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  if ([400, 403, 404, 409, 429].includes(error.status)) {
    return {
      ok: false,
      error: {
        status: error.status,
        code: error.code,
        message: error.message,
        requestId: error.requestId,
        details: error.details,
        retryAfterSeconds: error.retryAfterSeconds,
      },
    };
  }

  throw thrown;
}

/**
 * List SDK keys for an environment.
 * @param {string} projectId
 * @param {string} envKey
 * @returns {Promise<{ sdkKeys: Array<any> }>}
 */
export async function listSdkKeys(projectId, envKey) {
  return apiFetch(`/api/projects/${projectId}/environments/${envKey}/sdk-keys`);
}

/**
 * Create an SDK key.
 * @param {string} projectId
 * @param {string} envKey
 * @param {{ type: 'server' | 'client' }} body
 * @returns {Promise<{ sdkKey: any }>}
 */
export async function createSdkKey(projectId, envKey, body) {
  return apiFetch(`/api/projects/${projectId}/environments/${envKey}/sdk-keys`, { method: 'POST', body });
}

/**
 * Revoke an SDK key.
 * @param {string} projectId
 * @param {string} envKey
 * @param {string} id
 * @returns {Promise<null>}
 */
export async function deleteSdkKey(projectId, envKey, id) {
  return apiFetch(`/api/projects/${projectId}/environments/${envKey}/sdk-keys/${id}`, { method: 'DELETE' });
}

/**
 * Get experiment results for an environment.
 * @param {string} projectId
 * @param {string} key
 * @param {string} envKey
 * @returns {Promise<any>}
 */
export async function getFlagResults(projectId, key, envKey) {
  const params = new URLSearchParams({ env: envKey });
  return apiFetch(`/api/projects/${projectId}/flags/${key}/results?${params.toString()}`);
}

/**
 * Get project audit entries.
 * @param {string} projectId
 * @param {{ flag?: string, env?: string, before?: string, limit?: number }} query
 * @returns {Promise<{ entries: Array<any>, nextBefore?: string | null }>}
 */
export async function listAudit(projectId, query = {}) {
  const params = new URLSearchParams();
  if (query.flag) params.set('flag', query.flag);
  if (query.env) params.set('env', query.env);
  if (query.before) params.set('before', query.before);
  if (query.limit) params.set('limit', String(query.limit));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return apiFetch(`/api/projects/${projectId}/audit${suffix}`);
}
