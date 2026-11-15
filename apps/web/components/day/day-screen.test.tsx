// @vitest-environment jsdom
import type { DayActions } from '@mat-plan/shared';
import { noProgram, todayTwoPrograms } from '@mat-plan/shared/program/fixtures';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DayScreen } from './day-screen';

afterEach(cleanup);

/** The stub's own output (FAM-1 step 0b). Lane C's: step 13 replaces the stub and this test. */
describe('DayScreen, the stub', () => {
  const actions: DayActions = { logRow: vi.fn(), untickRow: vi.fn(), retickRow: vi.fn() };

  it('is a section of the day page: an <h2>, never the page’s <h1>', () => {
    render(<DayScreen plan={todayTwoPrograms} actions={actions} />);
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getByRole('region', { name: 'Workouts' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Workouts');
  });

  it('counts the day it was given', () => {
    const done = todayTwoPrograms.workouts.reduce((sum, w) => sum + w.progress.done, 0);
    const total = todayTwoPrograms.workouts.reduce((sum, w) => sum + w.progress.total, 0);
    render(<DayScreen plan={todayTwoPrograms} actions={actions} />);
    expect(
      screen.getByText(
        `${todayTwoPrograms.day}: ${todayTwoPrograms.workouts.length} workouts, ${done} of ${total} rows logged`,
      ),
    ).toBeTruthy();
    cleanup();
    render(<DayScreen plan={noProgram} actions={actions} />);
    expect(screen.getByText(`${noProgram.day}: 0 workouts, 0 of 0 rows logged`)).toBeTruthy();
  });

  it('names Change and Program order only once the route supplies them', () => {
    render(<DayScreen plan={todayTwoPrograms} actions={actions} />);
    expect(screen.getByText(/^Actions:/).textContent).toBe('Actions: logRow, untickRow, retickRow');
    cleanup();
    render(
      <DayScreen
        plan={todayTwoPrograms}
        actions={{ ...actions, amendRow: vi.fn(), reorderPrograms: vi.fn() }}
      />,
    );
    expect(screen.getByText(/^Actions:/).textContent).toMatch(/amendRow, reorderPrograms$/);
  });
});
