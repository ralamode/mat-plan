import type { Metadata } from 'next';
import Link from 'next/link';

import { newId } from '@mat-plan/shared';

import { NoHouseholdState } from '@/components/onboarding/no-household-state';
import { HOUSEHOLD_STATE, householdState } from '@/lib/dal/household';
import { householdProgramsAnything } from '@/lib/dal/programming';
import { requireSession } from '@/lib/dal/session';
import {
  ADD_ATHLETE_COPY,
  ALL_ATHLETES_LINK,
  APP_HOME_PATH,
  NAV_LINK_CLASS,
  PAGE_SHELL_CLASS,
  QUIET_LINK_CLASS,
  SETTINGS_COPY,
  SETTINGS_PATH,
} from '@/lib/constants';

import { AddAthleteForm } from './add-athlete-form';

/**
 * A static title (PROF-1 D8), never the athlete's name — Next's route announcer reads it aloud on
 * navigation, and a name in a document title is a name spoken in a room.
 */
export const metadata: Metadata = { title: ADD_ATHLETE_COPY.pageHeading };

/**
 * `/p/new` — the add-athlete screen (PROF-1 a-1u).
 *
 * RSC. The only client code is the form island, which needs state for the controlled name field and
 * the refusal focus.
 *
 * 🔴 **An unresolved household renders `<NoHouseholdState />`, NOT `notFound()`.** `/p` and
 * `/settings` both do, and `settings/page.tsx` says why: it is the same cause-free screen the picker
 * shows, and a 404 on a route the app itself linked to reads as "we broke" rather than "this account
 * has no household yet". The five causes are indistinguishable to the reader and the copy is true for
 * all of them.
 *
 * ⚠️ **`requireSession()` runs in this body, not only in middleware.** The matcher is not the
 * boundary (AGENTS.md → Server conventions); every page re-checks.
 *
 * ⚠️ **`householdState()` is the page-level seam, NOT `getHouseholdScope()`.** A page may not name
 * the scope resolver — `packages/db/src/scope.test.ts` fails the build on it, and `household.ts`'s
 * own docblock says why: the capability must not leave `lib/dal`. `householdState()` hands back a
 * discriminator and a BOOLEAN, which is all a page needs. The first draft of this file imported
 * `getHouseholdScope` and would have broken that guard.
 *
 * **`client_id` is minted HERE, once per render, and handed to the island.** Minting it inside the
 * client component would re-mint on every remount — a double submit after a remount would then create
 * two athletes instead of collapsing onto one. The server mints it, the hidden field carries it, and
 * `createProfile`'s replay-first lookup makes a resubmit idempotent.
 */
export default async function AddAthletePage() {
  await requireSession();

  const { state, canArchiveAthletes } = await householdState();
  if (state === HOUSEHOLD_STATE.none) {
    return (
      <main className={PAGE_SHELL_CLASS}>
        <NoHouseholdState />
      </main>
    );
  }

  const programsAnything = await householdProgramsAnything();

  return (
    <main className={PAGE_SHELL_CLASS}>
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">{ADD_ATHLETE_COPY.pageHeading}</h1>
      </header>

      <AddAthleteForm clientId={newId()} programsAnything={programsAnything} />

      {/* The owner/member line the rename screen already carries, composed the same way. This is the
          screen where the commitment is made, so it is where "this is undoable, and by whom" belongs
          — not discovered afterwards on `/settings`. A member sees `ownerOnly` instead, because
          sending them to a control they will be refused is worse than telling them now. */}
      <p className="text-muted-foreground max-w-prose text-sm">
        {canArchiveAthletes ? (
          <>
            {SETTINGS_COPY.archiveElsewhere}{' '}
            <Link href={SETTINGS_PATH} className={QUIET_LINK_CLASS}>
              {SETTINGS_COPY.heading}
            </Link>
            .
          </>
        ) : (
          SETTINGS_COPY.ownerOnly
        )}
      </p>

      <nav aria-label="Back">
        <Link href={APP_HOME_PATH} className={NAV_LINK_CLASS}>
          {ALL_ATHLETES_LINK}
        </Link>
      </nav>
    </main>
  );
}
