// @vitest-environment jsdom
import { lowerCaseUuidSchema, PROGRAM_REFUSAL, type ProgramActions } from '@mat-plan/shared';
import { heavyADraft, newWorkoutEmpty, programsList } from '@mat-plan/shared/program/fixtures';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
/** The back link's props as Next's `<Link>` received them. */
const linked: Record<string, unknown>[] = [];
vi.mock('next/link', () => ({
  default: ({ replace, prefetch: _, ...props }: ComponentProps<'a'> & Record<string, unknown>) => {
    linked.push({ href: props.href, replace });
    return <a {...props} />;
  },
}));

import { EDITOR_COPY } from './builder-text';
import { WorkoutEditorPage, type NewWorkoutDraft } from './workout-editor-page';

afterEach(() => {
  cleanup();
  linked.length = 0;
});

const actions = (): ProgramActions => ({
  createProgram: vi.fn(),
  renameProgram: vi.fn(),
  saveWorkout: vi
    .fn()
    .mockResolvedValue({ ok: true, workoutPublicId: heavyADraft.workoutPublicId }),
  saveWeek: vi.fn(),
  copyWorkout: vi.fn(),
  newItem: vi.fn(),
});

const FAMILY = programsList.find((p) => p.programPublicId === heavyADraft.programPublicId)!;

/** The new-workout page's draft: no client id (the page never mints one). */
const NEW: NewWorkoutDraft = {
  programPublicId: newWorkoutEmpty.programPublicId,
  workoutPublicId: null,
  name: '',
  description: null,
  items: [],
};

/** Opens the editor on `draft`, names the workout, saves, and answers the id Save sent. */
async function savedClientId(draft: NewWorkoutDraft | typeof heavyADraft): Promise<string> {
  const all = actions();
  render(
    <WorkoutEditorPage draft={draft} picker={{ options: [] }} program={FAMILY} actions={all} />,
  );
  if (!draft.name) {
    fireEvent.change(screen.getByLabelText(EDITOR_COPY.workoutName), {
      target: { value: 'Conditioning' },
    });
  }
  fireEvent.click(screen.getByRole('button', { name: EDITOR_COPY.save }));
  await waitFor(() => expect(all.saveWorkout).toHaveBeenCalledTimes(1));
  cleanup();
  return vi.mocked(all.saveWorkout).mock.calls[0]![0].workoutClientId;
}

describe('WorkoutEditorPage (FAM-1 7b-ii)', () => {
  it('🔴 a new workout’s client id is minted on the device, once per opened editor', async () => {
    const first = await savedClientId(NEW);
    const second = await savedClientId(NEW);
    expect(lowerCaseUuidSchema.safeParse(first).success).toBe(true);
    // A second "+ New workout" is a second workout, never a replay of the first.
    expect(second).not.toBe(first);
  });

  it('a re-rendered page keeps the id it minted, so a retried Save replays the same attempt', async () => {
    const all = actions();
    // The first try gets no answer worth keeping (a dropped connection); the second is the retry.
    vi.mocked(all.saveWorkout).mockResolvedValueOnce({ ok: false, reason: PROGRAM_REFUSAL.retry });
    const { rerender } = render(
      <WorkoutEditorPage draft={NEW} picker={{ options: [] }} program={FAMILY} actions={all} />,
    );
    rerender(
      <WorkoutEditorPage
        draft={{ ...NEW }}
        picker={{ options: [] }}
        program={FAMILY}
        actions={all}
      />,
    );
    fireEvent.change(screen.getByLabelText(EDITOR_COPY.workoutName), {
      target: { value: 'Conditioning' },
    });
    fireEvent.click(screen.getByRole('button', { name: EDITOR_COPY.save }));
    await waitFor(() => expect(all.saveWorkout).toHaveBeenCalledTimes(1));
    rerender(
      <WorkoutEditorPage
        draft={{ ...NEW }}
        picker={{ options: [] }}
        program={FAMILY}
        actions={all}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: EDITOR_COPY.save }));
    await waitFor(() => expect(all.saveWorkout).toHaveBeenCalledTimes(2));
    const ids = vi.mocked(all.saveWorkout).mock.calls.map(([draft]) => draft.workoutClientId);
    expect(new Set(ids).size).toBe(1);
  });

  it('a saved workout keeps the client id its read loaded', async () => {
    expect(await savedClientId(heavyADraft)).toBe(heavyADraft.workoutClientId);
  });

  it('the back link replaces the editor’s history entry, as Save and Discard do', () => {
    render(
      <WorkoutEditorPage
        draft={heavyADraft}
        picker={{ options: [] }}
        program={FAMILY}
        actions={actions()}
      />,
    );
    expect(linked).toContainEqual(expect.objectContaining({ replace: true }));
  });
});
