import { EmptyState } from '@/components/ui/empty-state';
import { ProfileTile } from '@/components/profiles/profile-tile';
import { listProfiles } from '@/lib/dal/profiles';

// Route-segment config must be a static inline literal (Next can't follow an
// imported const), so 'nodejs' stays here. pg → Node runtime, not Edge.
export const runtime = 'nodejs';

/**
 * The profile picker (V1-3). `/` is now the "who's logging?" tiles screen; a tile
 * links to that profile's scoped Today at `/p/[profileId]`. Profile tiles are a
 * UX switch, not a security boundary — the destination re-validates the id.
 */
export default async function ProfilePickerPage() {
  const profiles = await listProfiles();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">Who&rsquo;s logging today?</h1>
        <p className="text-muted-foreground">Pick a profile to start logging.</p>
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
    </main>
  );
}
