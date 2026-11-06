import { NoHouseholdState } from '@/components/onboarding/no-household-state';
import { PickerEmptyState } from '@/components/onboarding/picker-empty-state';
import { ProfileTile } from '@/components/profiles/profile-tile';
import {
  SIGN_OUT_CONSEQUENCE_ID,
  SignOutButton,
  SignOutPlaceholder,
} from '@/components/profiles/sign-out';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { requireSession } from '@/lib/dal/session';
import { clerkIsConfigured } from '@/lib/clerk';
import { NO_HOUSEHOLD_COPY, PICKER_COPY, PICKER_EMPTY_COPY, SIGN_OUT_COPY } from '@/lib/constants';
import { HOUSEHOLD_STATE, householdState } from '@/lib/dal/household';
import { listProfiles } from '@/lib/dal/profiles';

// Route-segment config must be a static inline literal (Next can't follow an
// imported const), so 'nodejs' stays here. pg → Node runtime, not Edge.
export const runtime = 'nodejs';

/**
 * The profile picker (V1-3), at `APP_HOME_PATH` since OSS-2 made `/` the public landing. A tile
 * links to that profile's scoped Today at `/p/[profileId]`. Profile tiles are a
 * UX switch, not a security boundary — the destination re-validates the id.
 *
 * UI-4 puts the THEME SWITCH here, and only here, after the panel priced the alternative. In the root
 * layout it would cost ~52px at the top of every screen — and on Today that is the screen with ~300px
 * of header before the first logging surface, on a phone, at 6:30pm. A theme is a settings-grade
 * preference set once per device; the picker is the app's front door past the gate (every "← All
 * profiles" tap returns here), it is not a task screen, so a mis-tap costs nothing, and at the bottom
 * of a short page it takes no attention from "who's logging today?". The provider still lives in the
 * root layout, so the choice applies everywhere and the gate and the landing still follow the device.
 */
export default async function ProfilePickerPage() {
  // 🔴 **BOTH, in-process. The gate is deleted at 1d, and 1c-4 is what made that safe.**
  // 🔴 **The session IS the boundary (AUTH-1 1d).** `getHouseholdScope()` resolves the signed-in
  // principal's `household_members` row, so a session proves WHOSE data this is rather than only
  // that the caller is someone this Clerk instance admits — the obligation 1d was blocked on, and
  // the reason the gate could not simply be deleted before `1c-4`.
  // Re-checked HERE rather than inherited from the proxy: SECURITY.md refuses to call a
  // matcher-driven layer a boundary (CVE-2025-29927), and SEC-1's own scar was a prefetch header
  // skipping the matcher entirely. `app/pages-need-a-session.test.ts` is what keeps this call here
  // (PR C renames that file to `pages-need-a-session.test.ts`; its contents already moved here).
  await requireSession();
  const profiles = await listProfiles();
  // AUTH-1 1c-2: THREE states, not two. `listProfiles` returns `[]` for "no household" AND for "a
  // household with no athletes yet", so without this the first lands on `PICKER_EMPTY_COPY` — which
  // tells the reader to change this deployment's seed data. `householdState()` is the discriminator
  // and returns NO scope, so the capability never leaves the DAL (`write-path.md` invariant 2).
  const state = await householdState();
  const noHousehold = state === HOUSEHOLD_STATE.none;
  const empty = !noHousehold && profiles.length === 0;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">
          {noHousehold ? NO_HOUSEHOLD_COPY.heading : PICKER_COPY.heading}
        </h1>
        {/* ONB-0: the subhead BRANCHES. `PICKER_COPY.subhead` ("Pick a profile to start logging.") is an
            imperative with no object when the list is empty — it tells the reader to pick from nothing,
            40px above the block that says there is nothing to pick, and a screen reader hears both with
            nothing to supersede the false one.
            🔴 **AUTH-1 1c-2: the `<h1>` BRANCHES.** It used to be pinned because the deleted
            `e2e/login.ts` helper asserted the picker's heading on every login, and "Who's logging
            today?" above "No household for this account" is simply false. What forced the change was
            the screenshot harness: the helper ran BEFORE navigating, so `--state no-household` could
            not be captured at all while it demanded that heading. The picker assertion did not
            disappear — it moved to `e2e/global.setup.ts`, the one consumer that needs it, so a deploy
            where household resolution silently breaks still fails loudly at setup instead of as a
            missing tile. ⚠️ `1d` deleted the helper itself; the assertion's new home is unaffected. */}
        <p className="text-muted-foreground">
          {noHousehold
            ? NO_HOUSEHOLD_COPY.subhead
            : empty
              ? PICKER_EMPTY_COPY.subhead
              : PICKER_COPY.subhead}
        </p>
      </header>

      {noHousehold ? (
        <NoHouseholdState />
      ) : empty ? (
        <PickerEmptyState />
      ) : (
        <ul className="flex flex-col gap-3">
          {profiles.map((profile) => (
            <li key={profile.id}>
              <ProfileTile profile={profile} />
            </li>
          ))}
        </ul>
      )}

      {/* `mt-auto`: the block sits at the BOTTOM of the page, below the thing the screen is for.
          🔴 **`gap-6` and a `border-t`, not a bare stack — AUTH-1 1c-3b.** `ThemeToggle`'s committed
          argument for living here is that "a mis-tap costs nothing". That stops being true for the
          BLOCK the moment sign-out joins it: on a two-profile household the page is short, so
          `mt-auto` puts this in the fat part of the thumb zone. The rule separates them and the
          order puts the consequential control last, in reading order.
          **Stacked, never a row:** at 200% text the theme group alone is ~356px against a 328px
          budget at 360px, and survives only by `flex-wrap` INSIDE a child — the "width math, not
          wrap luck" trap. Stacking makes no arithmetic load-bearing. */}
      <div className="mt-auto flex flex-col gap-6">
        <ThemeToggle />
        <div className="flex flex-col items-start gap-2 border-t pt-6">
          {/* `clerkIsConfigured()` gates the live control because `app/layout.tsx` renders no
              `<ClerkProvider>` without keys, and `useClerk()` would throw. Both harnesses blank the
              keys on purpose, so the placeholder is what they capture and axe measures — see
              `components/profiles/sign-out.tsx`. */}
          {clerkIsConfigured() ? <SignOutButton /> : <SignOutPlaceholder />}
          <p id={SIGN_OUT_CONSEQUENCE_ID} className="text-foreground max-w-prose text-sm">
            {SIGN_OUT_COPY.consequence}
          </p>
        </div>
      </div>
    </main>
  );
}
