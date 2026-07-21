import { ENTRY_KIND, ENTRY_STATUS } from '@mat-plan/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EmptyState } from '@/components/ui/empty-state';
import { formatDayLong, todayIso } from '@/lib/date';
import { listEntriesForDay, type EntryDTO } from '@/lib/dal/entries';
import { getProfileByPublicId } from '@/lib/dal/profiles';

import { BodyweightForm } from './bodyweight-form';
import { StrengthForm } from './strength-form';

// Route-segment config must be a static inline literal (Next can't follow an
// imported const), so 'nodejs' stays here. pg → Node runtime, not Edge.
export const runtime = 'nodejs';

function entryLabel(e: EntryDTO): string {
  if (e.kind === ENTRY_KIND.bodyweight) {
    return e.value === null ? 'Bodyweight' : `Bodyweight — ${e.value} ${e.unit}`;
  }
  return e.movementName ?? 'Strength';
}

export default async function TodayPage({ params }: { params: Promise<{ profileId: string }> }) {
  const { profileId } = await params;
  // Re-validate the URL-supplied public id server-side (the V1-3 ownership seam;
  // profile tiles are a UX switch, not a security boundary). Unknown → 404.
  const profile = await getProfileByPublicId(profileId);
  if (!profile) notFound();

  const day = todayIso();
  const entries = await listEntriesForDay(profile.id, day);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-2">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring w-fit rounded-sm text-sm outline-none focus-visible:ring-3"
        >
          ← All profiles
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">{profile.name}</h1>
        <p className="text-muted-foreground">Today · {formatDayLong(day)}</p>
      </header>

      <div className="flex flex-col gap-6">
        <section aria-labelledby="log-bw-heading" className="flex flex-col gap-3">
          <h2 id="log-bw-heading" className="text-lg font-medium">
            Log bodyweight
          </h2>
          <BodyweightForm profileId={profile.id} />
        </section>
        <section aria-labelledby="log-str-heading" className="flex flex-col gap-3">
          <h2 id="log-str-heading" className="text-lg font-medium">
            Log strength
          </h2>
          <StrengthForm profileId={profile.id} />
        </section>
      </div>

      <section aria-labelledby="entries-heading">
        <h2 id="entries-heading" className="sr-only">
          Logged entries
        </h2>

        {entries.length === 0 ? (
          <EmptyState>No entries logged today.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {entries.map((e) => (
              <li key={e.id} className="flex flex-col gap-1 rounded-lg border px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{entryLabel(e)}</span>
                  {e.status !== ENTRY_STATUS.done ? (
                    <span className="text-muted-foreground text-sm">{e.status}</span>
                  ) : null}
                </div>
                {e.sets.length > 0 ? (
                  <ul className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 text-sm tabular-nums">
                    {e.sets.map((s) => (
                      <li key={s.idx}>
                        {s.reps ?? '?'} × {s.weightLabel ?? `${s.weight ?? '?'} ${e.unit}`}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
