// @vitest-environment jsdom
import type { ProgramActions } from '@mat-plan/shared';
import { programsList } from '@mat-plan/shared/program/fixtures';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProgramsListScreen } from './programs-list-screen';

afterEach(cleanup);

/** The stub's own output (FAM-1 step 0b). Lane B's: step 8a replaces the stub and this test. */
describe('ProgramsListScreen, the stub', () => {
  const actions: ProgramActions = {
    createProgram: vi.fn(),
    renameProgram: vi.fn(),
    saveWorkout: vi.fn(),
    saveWeek: vi.fn(),
    copyWorkout: vi.fn(),
    newItem: vi.fn(),
  };

  it('is the page: one <h1>, and what it was given', () => {
    render(<ProgramsListScreen programs={programsList} actions={actions} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Programs');
    expect(screen.getByText(`${programsList.length} programs: `, { exact: false })).toBeTruthy();
    expect(screen.getByText(/^Not built yet: FAM-1 step 8a/)).toBeTruthy();
  });

  it('names only the actions the route supplied', () => {
    render(<ProgramsListScreen programs={programsList} actions={actions} />);
    expect(screen.getByText(/^Actions:/).textContent).toBe(
      'Actions: createProgram, renameProgram, saveWorkout, saveWeek, copyWorkout, newItem',
    );
  });
});
