import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/layout/app-shell';
import { TimeZoneSync } from '@/components/layout/tz-sync';
import { BUILDER_COPY } from '@/components/program-builder/builder-text';
import { ProgramsListScreen } from '@/components/program-builder/programs-list-screen';
import { getActiveTimeZone } from '@/lib/active-timezone';
import { APP_HOME_PATH } from '@/lib/constants';
import { localDayIso } from '@/lib/date';
import { getProgramList } from '@/lib/dal/program/reads';
import { listProfiles } from '@/lib/dal/profiles';
import { requireSession } from '@/lib/dal/session';

import { PROGRAM_ACTIONS } from './actions.contract';

// Route-segment config must be a static inline literal. pg → Node runtime, not Edge.
export const runtime = 'nodejs';

export const metadata: Metadata = { title: BUILDER_COPY.programs };

/**
 * The Programs list (FAM-1 7b-i): thin, as every page. The session first
 * (`app/pages-need-a-session.test.ts`), the household's list through the DAL, and lane B's screen
 * with the real actions. No household is Home's no-household state, so the caller is sent there.
 * "Today" is the route's to resolve: only a route reads the tz cookie (AGENTS.md → Time).
 */
export default async function ProgramsPage() {
  await requireSession();
  const timeZone = await getActiveTimeZone();
  const programs = await getProgramList(localDayIso(timeZone));
  if (!programs) redirect(APP_HOME_PATH);
  return (
    <AppShell athletes={await listProfiles()} current="programs">
      <ProgramsListScreen programs={programs} actions={PROGRAM_ACTIONS} />
      <TimeZoneSync serverTimeZone={timeZone} />
    </AppShell>
  );
}
