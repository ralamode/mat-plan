import { AppShell } from '@/components/layout/app-shell';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The day subtree's Suspense fallback (`UI-5`).
 *
 * 🔴 **It exists because `app/p/loading.tsx` serves two routes with opposite frames.** That file is
 * the fallback for everything under `p/`, and `/p` itself renders no rail while `/p/[profileId]`
 * renders one. A single fallback has to be wrong for one of them, and at `lg` "wrong" means the
 * content column jumps 32px when the page resolves — on the very interaction the rail adds, since
 * clicking an athlete in the rail unmounts it and streams this. Next uses the NEAREST `loading.tsx`,
 * so a second one here lets each route reserve its own frame.
 *
 * ⚠️ **`busy` with no `athletes`**, deliberately: a Suspense fallback cannot await the household, so
 * the shell reserves the rail's column with an inert placeholder and fills it when the page lands.
 * The frame is reserved; the names arrive with the data.
 */
export default function Loading() {
  return (
    <AppShell busy>
      <span className="sr-only">Loading…</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-5 w-64" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    </AppShell>
  );
}
