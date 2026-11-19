'use client';

import { newId, type ProgramListEntry, type WorkoutDraft } from '@mat-plan/shared';
import { useState } from 'react';

import { howToLoader } from './how-to-loader';
import { WorkoutEditorScreen, type WorkoutEditorScreenProps } from './workout-editor-screen';

/** A new workout as its page loads it: no id yet, and no client id, which the editor mints. */
export type NewWorkoutDraft = Omit<WorkoutDraft, 'workoutClientId'> & { workoutPublicId: null };

/**
 * The workout editor as a real page mounts it (FAM-1 7b): the screen with the real "How to" loader.
 * A Server Component cannot pass a plain function to a Client Component, so the page renders this
 * wrapper and the loader is supplied on the client. The design preview mounts the screen itself,
 * with its own fixture loader.
 *
 * 🔴 **A new workout's `workoutClientId` is minted here, on the device, once per opened editor**
 * (7b-ii; the 7b plan's U1-1 / Co-S1). The new-workout page sends a draft without one, so no id the
 * server or a cached page holds is ever replayed: a second `/workouts/new` is a second workout, never
 * an overwrite of the first. `useState`'s initializer runs once per mount, so a page re-rendered
 * (`router.refresh`) keeps the id a retried Save sends. A browser reload remounts the editor and
 * mints a new one: the reloaded editor is a new attempt.
 */
export function WorkoutEditorPage({
  draft,
  ...props
}: Omit<WorkoutEditorScreenProps, 'howTo' | 'draft' | 'program'> & {
  draft: WorkoutDraft | NewWorkoutDraft;
  /** Required here, unlike on the screen (which the preview mounts without it): a real page names its program. */
  program: ProgramListEntry;
}) {
  const [opened] = useState<WorkoutDraft>(() =>
    'workoutClientId' in draft ? draft : { ...draft, workoutClientId: newId() },
  );
  return <WorkoutEditorScreen {...props} draft={opened} howTo={howToLoader} />;
}
