import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AppShell } from '@/components/layout/app-shell';
import { TimeZoneSync } from '@/components/layout/tz-sync';
import { BUILDER_COPY } from '@/components/program-builder/builder-text';
import { ProgramScreen } from '@/components/program-builder/program-screen';
import { getActiveTimeZone } from '@/lib/active-timezone';
import { localDayIso } from '@/lib/date';
import { getProgramView } from '@/lib/dal/program/reads';
import { listProfiles } from '@/lib/dal/profiles';
import { requireSession } from '@/lib/dal/session';

import { PROGRAM_ACTIONS } from '../actions.contract';

// Route-segment config must be a static inline literal. pg → Node runtime, not Edge.
export const runtime = 'nodejs';

/**
 * 🔴 **"Program", never the program's name** (PROF-1 D8): a title is spoken on every route change
 * and kept in the browser's history, and a program's name can be "<child>'s program".
 */
export const metadata: Metadata = { title: BUILDER_COPY.programTitle };

/**
 * One program's page (FAM-1 7b-i). A program that is not the household's, or an id that is not a
 * uuid, is `notFound()` (`app/programs/not-found.tsx`); the DAL reports the miss once. The day and
 * the zone are resolved here, once, and passed down as primitives (`cache()` compares by identity).
 */
export default async function ProgramPage({ params }: { params: Promise<{ programId: string }> }) {
  await requireSession();
  const { programId } = await params;
  const timeZone = await getActiveTimeZone();
  const program = await getProgramView(programId, localDayIso(timeZone), timeZone);
  if (!program) notFound();
  return (
    <AppShell athletes={await listProfiles()} current="programs">
      <ProgramScreen program={program} actions={PROGRAM_ACTIONS} />
      <TimeZoneSync serverTimeZone={timeZone} />
    </AppShell>
  );
}
