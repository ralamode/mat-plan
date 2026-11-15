// @vitest-environment jsdom
import { TRACKING_TYPE, type ProgramActions } from '@mat-plan/shared';
import { heavyADraft, newWorkoutEmpty } from '@mat-plan/shared/program/fixtures';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MovementPickerData } from '@/lib/movements/movement-option';

import { WorkoutEditorScreen } from './workout-editor-screen';

afterEach(cleanup);

/** The stub's own output (FAM-1 step 0b). Lane B's: step 8 replaces the stub and this test. */
describe('WorkoutEditorScreen, the stub', () => {
  const actions: ProgramActions = {
    createProgram: vi.fn(),
    renameProgram: vi.fn(),
    saveWorkout: vi.fn(),
    saveWeek: vi.fn(),
    copyWorkout: vi.fn(),
    newItem: vi.fn(),
  };
  const picker: MovementPickerData = {
    options: heavyADraft.items.map((item) => ({
      publicId: item.itemPublicId,
      name: item.itemName,
      trackingType: item.trackingType,
      owner: 'household',
      unitDefault: null,
      isBodyweight: false,
    })),
  };

  it('is the page: its <h1> is the workout’s name, and it counts what it was given', () => {
    render(<WorkoutEditorScreen draft={heavyADraft} picker={picker} actions={actions} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(heavyADraft.name);
    expect(
      screen.getByText(
        `${heavyADraft.items.length} items in the workout, ${picker.options.length} to pick from`,
      ),
    ).toBeTruthy();
    expect(picker.options.map((o) => o.trackingType)).toContain(TRACKING_TYPE.weight_reps);
  });

  it('a workout with no name yet has a heading all the same', () => {
    render(
      <WorkoutEditorScreen draft={newWorkoutEmpty} picker={{ options: [] }} actions={actions} />,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('New workout');
    expect(screen.getByText('0 items in the workout, 0 to pick from')).toBeTruthy();
  });
});
