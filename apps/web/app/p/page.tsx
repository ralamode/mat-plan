import { EmptyState } from '@/components/ui/empty-state';
import { ProfileTile } from '@/components/profiles/profile-tile';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { requireGatedPage } from '@/lib/dal/gate';
import { PICKER_COPY } from '@/lib/constants';
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

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">{PICKER_COPY.heading}</h1>
        <p className="text-muted-foreground">{PICKER_COPY.subhead}</p>
      </header>

      {profiles.length === 0 ? (
        <EmptyState>No profiles found. Seed the database to get started.</EmptyState>
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
