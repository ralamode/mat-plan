import type { Metadata } from 'next';
import Link from 'next/link';

import { newId } from '@mat-plan/shared';

import { AppShell } from '@/components/layout/app-shell';
import { listProfiles } from '@/lib/dal/profiles';

import { NoHouseholdState } from '@/components/onboarding/no-household-state';
import { HOUSEHOLD_STATE, householdState } from '@/lib/dal/household';
import { householdProgramsAnything } from '@/lib/dal/programming';
import { requireSession } from '@/lib/dal/session';
import {
  ADD_ATHLETE_COPY,
  ATHLETE_FORM_COPY,
  ALL_ATHLETES_LINK,
  APP_HOME_PATH,
  NAV_LINK_CLASS,
  QUIET_LINK_CLASS,
  SETTINGS_COPY,
  SETTINGS_PATH,
} from '@/lib/constants';

import { AddAthleteForm } from './add-athlete-form';

// Route-segment config must be a static inline literal (Next cannot follow an imported const), so
// 'nodejs' stays here — the same declaration, for the same reason, as the four sibling `/p` pages:
// this body reaches the DAL, the DAL reaches `pg`, and `pg` is Node-only, not Edge. `runtime` is
// per-segment and is NOT inherited from `/p`, so leaving it off would make this the one DAL-backed
// page in the segment without it.
export const runtime = 'nodejs';

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
 * **`client_id` is minted HERE, once per request, and handed to the island.** Minting it inside the
 * client component would re-mint on every remount — a double submit after a remount would then create
 * two athletes instead of collapsing onto one. The server mints it, the hidden field carries it, and
 * `createProfile`'s replay-first lookup makes a resubmit idempotent.
 *
 * 🔴 **Once per REQUEST is the correct granularity, and it depends on this page being dynamic.**
 * `requireSession()` → `getCurrentUser()` → Clerk's `auth()` reads request headers, which opts this
 * segment out of static rendering. That matters more than it looks: a statically cached `/p/new`
 * would hand **every visitor the same `client_id`**, and the second athlete anyone added would
 * collapse onto the first by replay. Nothing in CI asserts that, so it is written down here —
 * ⚠️ **do not add `revalidate`, `force-static`, or a `generateStaticParams` to this segment.**
 *
 * What each case then does, which is the test of whether per-request is right:
 * a **double tap** reuses the key (one athlete); a **retry after a refusal** reuses it, because the
 * RSC does not re-run when `useActionState` re-renders the island (so a name typo fixed and
 * resubmitted still adds one); an **add that succeeded but whose redirect was interrupted** replays
 * onto the existing row and lands on the athlete; and a **deliberate page reload** mints a new key,
 * which is correct — that is a new intent, not a retry.
 */
export default async function AddAthletePage() {
  await requireSession();

  const { state, canArchiveAthletes } = await householdState();
  if (state === HOUSEHOLD_STATE.none) {
    return (
      <AppShell athletes={await listProfiles()}>
        <NoHouseholdState />
      </AppShell>
    );
  }

  const programsAnything = await householdProgramsAnything();

  return (
    <AppShell athletes={await listProfiles()}>
      {/* 🔴 **The back link is ABOVE the form, in the header — the day page's placement.** It was
          below the submit in the first version, which a UX lens measured at ~5 tab stops and ~y=700
          on a phone: this is the one screen a person may want to leave WITHOUT committing, so the
          exit cannot be past the irreversible choice. A single link needs no `<nav>` landmark. */}
      <header className="flex flex-col gap-2">
        <Link href={APP_HOME_PATH} className={NAV_LINK_CLASS}>
          {ALL_ATHLETES_LINK}
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">{ADD_ATHLETE_COPY.pageHeading}</h1>
      </header>

      <AddAthleteForm clientId={newId()} programsAnything={programsAnything} />

      {/* 🔴 **The RECOVERY lives here, role-branched — it is not part of the permanence sentence.**
          The form says "Set once — the app can't change it afterwards."; what to do about a wrong
          choice depends on who is reading. An owner gets the real procedure INCLUDING its cost (the
          archived athlete keeps its history, so adding again splits one person's record in two). A
          member gets `ownerOnly`, because the first version told every member to "archive them in
          Household settings" on a page that said two inches lower that they cannot — a contradiction
          on one screen, found by a UX lens. */}
      <p className="text-muted-foreground max-w-prose text-sm">
        {canArchiveAthletes ? (
          <>
            {ATHLETE_FORM_COPY.kindRecoveryOwnerBefore}{' '}
            <Link href={SETTINGS_PATH} className={QUIET_LINK_CLASS}>
              {SETTINGS_COPY.heading}
            </Link>{' '}
            {ATHLETE_FORM_COPY.kindRecoveryOwnerAfter}
          </>
        ) : (
          // A lead-in plus the shared refusal, so the line reads as an answer to the choice above
          // rather than a standalone rule. `ownerOnly` is `OWNER_ONLY_ATHLETE`, which the edit screen
          // shows too — one definition, two surfaces.
          `${ATHLETE_FORM_COPY.kindRecoveryMemberBefore} ${SETTINGS_COPY.ownerOnly}`
        )}
      </p>
    </AppShell>
  );
}
