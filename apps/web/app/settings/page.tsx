import type { Metadata } from 'next';
import Link from 'next/link';

import { AppShell } from '@/components/layout/app-shell';
import { AthleteList } from '@/app/settings/athlete-list';
import { NoHouseholdState } from '@/components/onboarding/no-household-state';
import {
  APP_HOME_PATH,
  HOME_LINK,
  NAV_LINK_CLASS,
  NO_HOUSEHOLD_COPY,
  SETTINGS_COPY,
} from '@/lib/constants';
import { HOUSEHOLD_STATE, householdState } from '@/lib/dal/household';
import { listHouseholdAthletes, listProfiles } from '@/lib/dal/profiles';
import { requireSession } from '@/lib/dal/session';

export const metadata: Metadata = { title: SETTINGS_COPY.heading };

/**
 * **Household settings** (PROF-1 b) — the one screen that lists an archived athlete.
 *
 * ## Why this page exists rather than an archive control on the picker
 *
 * Acceptance criterion 8: the picker never carries an archive control. `/p` is the screen a kid opens
 * to start logging, and a destructive-looking verb beside their own name on that screen is the wrong
 * thing to put under a thumb. Archiving is a parent's administrative act, so it lives on an
 * administrative screen.
 *
 * ## `requireSession()` first, in the page body
 *
 * The middleware matcher is **not** the boundary (CVE-2025-29927; SEC-1's own scar was a prefetch
 * header that skipped the matcher entirely), so every page re-checks. `app/pages-need-a-session.test.ts`
 * globs every `page.tsx` and fails the build on a page that does not, which is what keeps this call here.
 *
 * ## The split with the island
 *
 * This component owns the data and the headings; `athlete-list.tsx` owns the forms, the one live
 * region and focus. Keeping the fetch here is what lets `revalidatePath(SETTINGS_PATH)` after an
 * archive re-render the list from the server rather than the island maintaining a second copy of it.
 */
export default async function SettingsPage() {
  await requireSession();

  const { state, canArchiveAthletes } = await householdState();
  // A signed-in account with no membership reaches this page too (AUTH-1 state C). It must render the
  // same cause-free screen the picker does, not an empty settings page implying the household is
  // there but has nobody in it.
  if (state === HOUSEHOLD_STATE.none) {
    return (
      <AppShell athletes={await listProfiles()} current={'settings'}>
        {/* The way back matters MOST here: with no household there is no rail at any width, and
            the screen tells the reader to sign out, which only `/p` offers. The `<h1>` is the one
            `NoHouseholdState` requires its page to supply. */}
        <header className="flex flex-col gap-2">
          <Link href={APP_HOME_PATH} className={NAV_LINK_CLASS}>
            {HOME_LINK}
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">{NO_HOUSEHOLD_COPY.heading}</h1>
        </header>
        <NoHouseholdState />
      </AppShell>
    );
  }

  const athletes = await listHouseholdAthletes();

  return (
    <AppShell athletes={await listProfiles()} current={'settings'}>
      {/* Visible at every width, as the day page's way back is (its comment says why): the rail never
          lists `/p`, the only home of sign out, the theme toggle and Add an athlete. */}
      <header className="flex flex-col gap-2">
        <Link href={APP_HOME_PATH} className={NAV_LINK_CLASS}>
          {HOME_LINK}
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">{SETTINGS_COPY.heading}</h1>
      </header>
      <AthleteList athletes={athletes} canArchive={canArchiveAthletes} />
    </AppShell>
  );
}
