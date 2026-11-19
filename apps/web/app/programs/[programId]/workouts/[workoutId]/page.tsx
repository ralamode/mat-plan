import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AppShell } from '@/components/layout/app-shell';
import { TimeZoneSync } from '@/components/layout/tz-sync';
import { EDITOR_COPY } from '@/components/program-builder/builder-text';
import { WorkoutEditorPage } from '@/components/program-builder/workout-editor-page';
import { getActiveTimeZone } from '@/lib/active-timezone';
import { localDayIso } from '@/lib/date';
import { getItemPickerData } from '@/lib/dal/program/picker';
import { getProgramEntry, getWorkoutDraft } from '@/lib/dal/program/reads';
import { listProfiles } from '@/lib/dal/profiles';
import { requireSession } from '@/lib/dal/session';

import { PROGRAM_ACTIONS } from '../../../actions.contract';

// Route-segment config must be a static inline literal. pg → Node runtime, not Edge.
export const runtime = 'nodejs';

/** Static, never the workout's name (PROF-1 D8): a title is spoken and kept in history. */
export const metadata: Metadata = { title: EDITOR_COPY.editWorkout };

/**
 * One workout's editor (FAM-1 7b-ii). The draft first (`getWorkoutDraft` reports its own miss), so
 * a workout that is not this program's (another program's, or another household's) is
 * `notFound()` before anything else is read; then the picker's data and the program's entry, which
 * names it in the back link and says who a change applies to. Any `null` is `notFound()`.
 */
export default async function WorkoutPage({
  params,
}: {
  params: Promise<{ programId: string; workoutId: string }>;
}) {
  await requireSession();
  const { programId, workoutId } = await params;
  const draft = await getWorkoutDraft(programId, workoutId);
  if (!draft) notFound();
  const timeZone = await getActiveTimeZone();
  const [picker, program] = await Promise.all([
    getItemPickerData(),
    getProgramEntry(programId, localDayIso(timeZone)),
  ]);
  if (!picker || !program) notFound();
  return (
    <AppShell athletes={await listProfiles()} current="programs">
      <WorkoutEditorPage
        draft={draft}
        picker={picker}
        actions={PROGRAM_ACTIONS}
        program={program}
      />
      <TimeZoneSync serverTimeZone={timeZone} />
    </AppShell>
  );
}
