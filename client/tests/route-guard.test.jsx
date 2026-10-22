import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authLoader, loginAction } from '../src/routes';

afterEach(() => vi.restoreAllMocks());

describe('authenticated route loader', () => {
  it('redirects unauthenticated users to login with the requested path', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        error: { code: 'unauthorized', message: 'Not signed in.', requestId: 'req-auth' },
      }), { status: 401, headers: { 'Content-Type': 'application/json' } }),
    );

    const router = createMemoryRouter([
      { path: '/login', element: <div>Login page</div> },
      {
        path: '/',
        loader: authLoader,
        element: <Outlet />,
        children: [{ path: 'p/:pid/flags', element: <div>Flags page</div> }],
      },
    ], { initialEntries: ['/p/project-1/flags?env=prod'] });

    render(<RouterProvider router={router} />);

    expect(await screen.findByText('Login page')).toBeTruthy();
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toContain('next=');
    expect(decodeURIComponent(router.state.location.search)).toContain('/p/project-1/flags?env=prod');
  });
});

describe('login redirect', () => {
  it.each(['/\\attacker.example', '//attacker.example'])(
    'keeps a network-path redirect on the app origin (%s)',
    async (next) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ user: { id: 'user-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      const request = new Request(
        `https://flagkit.test/login?next=${encodeURIComponent(next)}`,
        {
          method: 'POST',
          body: new URLSearchParams({ email: 'user@example.test', password: 'test-password' }),
        },
      );

      const response = await loginAction({ request });

      expect(response.headers.get('Location')).toBe('/');
    },
  );

  it('preserves a same-origin path after login', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ user: { id: 'user-1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const request = new Request(
      `https://flagkit.test/login?next=${encodeURIComponent('/p/project-1/flags?env=prod')}`,
      {
        method: 'POST',
        body: new URLSearchParams({ email: 'user@example.test', password: 'test-password' }),
      },
    );

    const response = await loginAction({ request });

    expect(response.headers.get('Location')).toBe('/p/project-1/flags?env=prod');
  });
});
