import { AppShell } from '@/components/layout/app-shell';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Suspense fallback for **the picker** while it fetches from the DB (V0-10). Lives under `p/`
 * (OSS-2), not the root: at the root it would front the public landing, which awaits nothing.
 *
 * ⚠️ **No longer "the picker and Today".** `UI-5` gave the day subtree its own
 * `app/p/[profileId]/loading.tsx`, because the two routes reserve opposite frames at `lg` — `/p`
 * has no rail and a day page does. `nav={false}` here matches the page this actually fronts.
 */
export default function Loading() {
  return (
    <AppShell busy nav={false}>
      <span className="sr-only">Loading…</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-5 w-56" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    </AppShell>
  );
}
