import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FlagDetailLayout from '../src/pages/FlagDetailLayout';
import TargetingPage from '../src/pages/TargetingPage';
import { targetingAction } from '../src/routes';

afterEach(() => vi.restoreAllMocks());

describe('targeting save flow', () => {
  it('shows the version conflict banner after a save attempt', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        error: {
          code: 'version_conflict',
          message: 'This flag was changed by someone else. Reload and try again.',
          requestId: 'req-conflict',
        },
      }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const flag = {
      key: 'sample-flag',
      name: 'Sample flag',
      tags: [],
      isExperiment: false,
      variations: [
        { key: 'on', name: 'On', value: true },
        { key: 'off', name: 'Off', value: false },
      ],
      environments: {
        prod: {
          enabled: false,
          version: 4,
          offVariation: 'off',
          fallthrough: { variation: 'on' },
          rules: [],
        },
      },
    };
    const router = createMemoryRouter([{
      path: '/p/:pid',
      id: 'project',
      loader: () => ({ pid: 'project-1', project: { id: 'project-1', name: 'Project', role: 'editor' }, environments: [] }),
      element: <Outlet />,
      children: [{
        path: 'flags/:key',
        id: 'flag',
        loader: () => ({ flag }),
        action: targetingAction,
        element: <FlagDetailLayout />,
        children: [{ index: true, element: <TargetingPage /> }],
      }],
    }], { initialEntries: ['/p/project-1/flags/sample-flag?env=prod'] });

    render(<RouterProvider router={router} />);

    fireEvent.click(await screen.findByRole('switch', { name: 'Enabled' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enable in production' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('This flag was changed by someone else. Reload and try again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });
});
