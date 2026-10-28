import { NoHouseholdState } from '@/components/onboarding/no-household-state';
import { PickerEmptyState } from '@/components/onboarding/picker-empty-state';
import { ProfileTile } from '@/components/profiles/profile-tile';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { requireGatedPage } from '@/lib/dal/gate';
import { NO_HOUSEHOLD_COPY, PICKER_COPY, PICKER_EMPTY_COPY } from '@/lib/constants';
import { householdState } from '@/lib/dal/household';
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
  await requireGatedPage(); // SEC-1: the proxy is not the boundary
  const profiles = await listProfiles();
  // AUTH-1 1c-2: THREE states, not two. `listProfiles` returns `[]` for "no household" AND for "a
  // household with no athletes yet", so without this the first lands on `PICKER_EMPTY_COPY` — which
  // tells the reader to change this deployment's seed data. `householdState()` is the discriminator
  // and returns NO scope, so the capability never leaves the DAL (`write-path.md` invariant 2).
  const state = await householdState();
  const noHousehold = state === 'none';
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
            🔴 **AUTH-1 1c-2: the `<h1>` NOW BRANCHES, and the reason it did not has been fixed rather
            than worked around.** It used to be pinned because `e2e/login.ts`'s `gateLogin` asserted
            `pickerHeading` — but "Who's logging today?" above "No household for this account" is simply
            false, and keeping it would have made the login helper a weak health check: a 1c deploy where
            membership resolution silently broke would sail past `gateLogin` and fail confusingly in every
            spec on missing tiles. The helper now asserts that SOME `<h1>` is visible; the specs that
            genuinely need the picker still assert `pickerHeading`. */}
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

      {/* `mt-auto`: the switch sits at the BOTTOM of the page, below the thing the screen is for. */}
      <div className="mt-auto">
        <ThemeToggle />
      </div>
    </main>
  );
}
