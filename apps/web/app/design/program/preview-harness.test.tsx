// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PreviewHarness } from './preview-harness';
import { previewEntries, previewLabel } from './preview-registry';

afterEach(cleanup);

/**
 * The wiring the lanes build on: every state on the route mounts its screen with its fixture and a
 * full fake actions object. What a screen then shows is the lane's own test.
 */
describe('the preview harness', () => {
  const PROGRAM_ACTIONS =
    /createProgram, renameProgram, saveWorkout, saveWeek, copyWorkout, newItem, putOn, takeOff/;
  const ACTIONS = {
    'programs-list': PROGRAM_ACTIONS,
    program: PROGRAM_ACTIONS,
    'workout-editor': PROGRAM_ACTIONS,
    day: /logRow, untickRow, retickRow, amendRow, reorderPrograms/,
  } as const;

  it.each(previewEntries().map((entry) => [previewLabel(entry), entry] as const))(
    '%s mounts its screen with one <h1> and every action',
    (_label, entry) => {
      render(<PreviewHarness {...entry} />);
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByText(ACTIONS[entry.screen])).toBeTruthy();
      expect(screen.getByText(/^Not built yet: FAM-1 step/)).toBeTruthy();
    },
  );

  it('hands each screen its own fixture', () => {
    render(<PreviewHarness screen="program" fixture="new-program-empty" failNext={false} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('New program');
    expect(screen.getByText(/0 on it, 0 workouts, 0 slots/)).toBeTruthy();
    cleanup();

    render(<PreviewHarness screen="day" fixture="no-program" failNext={false} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Test Athlete');
    expect(screen.getByText(/0 workouts, 0 of 0 rows logged/)).toBeTruthy();
    cleanup();

    render(<PreviewHarness screen="workout-editor" fixture="heavy-a-draft" failNext={false} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Heavy A');
    expect(screen.getByText(/5 items in the workout, 26 to pick from/)).toBeTruthy();
  });
});
