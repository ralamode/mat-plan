import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AppShell } from '@/components/layout/app-shell';
import { TimeZoneSync } from '@/components/layout/tz-sync';
import { EDITOR_COPY } from '@/components/program-builder/builder-text';
import { WorkoutEditorPage } from '@/components/program-builder/workout-editor-page';
import { getActiveTimeZone } from '@/lib/active-timezone';
import { localDayIso } from '@/lib/date';
import { getItemPickerData } from '@/lib/dal/program/picker';
import { getProgramEntry } from '@/lib/dal/program/reads';
import { listProfiles } from '@/lib/dal/profiles';
import { requireSession } from '@/lib/dal/session';

import { PROGRAM_ACTIONS } from '../../../actions.contract';

// Route-segment config must be a static inline literal. pg → Node runtime, not Edge.
export const runtime = 'nodejs';

export const metadata: Metadata = { title: EDITOR_COPY.newWorkout };

/**
 * A new workout in a program (FAM-1 7b-ii). The program's entry is found in the household's list
 * (`getProgramEntry`, which reports a miss once); a program that is not the household's is
 * `notFound()`. 🔴 **The draft carries no client id**: the editor mints one on the device when it
 * opens (`WorkoutEditorPage`), so no id held by the server or a cached page is ever replayed, and
 * every way out of the editor replaces this entry, so Back never returns to `/workouts/new`.
 */
export default async function NewWorkoutPage({
  params,
}: {
  params: Promise<{ programId: string }>;
}) {
  await requireSession();
  const { programId } = await params;
  const timeZone = await getActiveTimeZone();
  const [program, picker] = await Promise.all([
    getProgramEntry(programId, localDayIso(timeZone)),
    getItemPickerData(),
  ]);
  if (!program || !picker) notFound();
  return (
    <AppShell athletes={await listProfiles()} current="programs">
      <WorkoutEditorPage
        draft={{
          programPublicId: program.programPublicId,
          workoutPublicId: null,
          name: '',
          description: null,
          items: [],
        }}
        picker={picker}
        actions={PROGRAM_ACTIONS}
        program={program}
      />
      <TimeZoneSync serverTimeZone={timeZone} />
    </AppShell>
  );
}
