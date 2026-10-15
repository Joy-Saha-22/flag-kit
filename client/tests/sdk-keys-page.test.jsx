import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SdkKeysPage from '../src/pages/SdkKeysPage';

afterEach(() => vi.restoreAllMocks());

describe('SDK key creation', () => {
  it('keeps the returned key out of router action state and clears it when the dialog closes', async () => {
    const action = vi.fn();
    const fullKey = 'fk_client_one_time_secret';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options = {}) => {
      if (options.method === 'POST') {
        return new Response(JSON.stringify({
          sdkKey: {
            id: 'key-1',
            prefix: 'fk_client',
            type: 'client',
            createdAt: '2026-01-01T00:00:00.000Z',
            revokedAt: null,
            key: fullKey,
          },
        }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ sdkKeys: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const router = createMemoryRouter([{
      path: '/p/:pid',
      id: 'project',
      loader: () => ({ project: { id: 'project-1', role: 'admin' } }),
      element: <Outlet />,
      children: [{
        path: 'sdk-keys',
        loader: () => ({ sdkKeys: [] }),
        action,
        element: <SdkKeysPage />,
      }],
    }], { initialEntries: ['/p/project-1/sdk-keys?env=prod'] });

    render(<RouterProvider router={router} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create key' }));
    fireEvent.change(screen.getByLabelText('Key type'), { target: { value: 'client' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create key', exact: true }));

    expect(await screen.findByDisplayValue(fullKey)).toBeTruthy();
    expect(action).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    await waitFor(() => expect(screen.queryByDisplayValue(fullKey)).toBeNull());
    expect(router.state.actionData).toBeNull();
    router.dispose();
  });
});
