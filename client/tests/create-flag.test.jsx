import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CreateFlagDialog from '../src/features/flags/CreateFlagDialog';

describe('CreateFlagDialog', () => {
  it('validates required inputs and flag experiment requirement', () => {
    render(
      <CreateFlagDialog
        open={true}
        onOpenChange={vi.fn()}
        onCreate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Create flag'));

    expect(screen.getByText('Key is required.')).toBeTruthy();
    expect(screen.getByText('Name is required.')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Experiment'));
    fireEvent.click(screen.getByText('Create flag'));

    expect(screen.getByText('Goal metric key is required for experiment flags.')).toBeTruthy();
  });
});
