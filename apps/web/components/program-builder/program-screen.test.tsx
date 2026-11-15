// @vitest-environment jsdom
import type { ProgramActions } from '@mat-plan/shared';
import { familyProgram, newProgramEmpty } from '@mat-plan/shared/program/fixtures';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProgramScreen } from './program-screen';

afterEach(cleanup);

/** The stub's own output (FAM-1 step 0b). Lane B's: step 8a replaces the stub and this test. */
describe('ProgramScreen, the stub', () => {
  const actions: ProgramActions = {
    createProgram: vi.fn(),
    renameProgram: vi.fn(),
    saveWorkout: vi.fn(),
    saveWeek: vi.fn(),
    copyWorkout: vi.fn(),
    newItem: vi.fn(),
  };

  it('is the page: its <h1> is the program’s name, and it counts what it was given', () => {
    render(<ProgramScreen program={familyProgram} actions={actions} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(familyProgram.name);
    const slots = Object.values(familyProgram.week).flat().length;
    expect(
      screen.getByText(
        `${familyProgram.athletes.length} on it, ${familyProgram.workouts.length} workouts, ${slots} slots in the week`,
      ),
    ).toBeTruthy();
  });

  it('renders an empty program', () => {
    render(<ProgramScreen program={newProgramEmpty} actions={actions} />);
    expect(screen.getByText('0 on it, 0 workouts, 0 slots in the week')).toBeTruthy();
  });

  it('names Put on and Take off only once the route supplies them', () => {
    render(<ProgramScreen program={familyProgram} actions={actions} />);
    expect(screen.getByText(/^Actions:/).textContent).not.toMatch(/putOn|takeOff/);
    cleanup();
    render(
      <ProgramScreen
        program={familyProgram}
        actions={{ ...actions, putOn: vi.fn(), takeOff: vi.fn() }}
      />,
    );
    expect(screen.getByText(/^Actions:/).textContent).toMatch(/putOn, takeOff$/);
  });
});
