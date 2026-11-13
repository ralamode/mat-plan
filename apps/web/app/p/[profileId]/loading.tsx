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
      {/*
        🔴 **These bars mirror the day page's HEADER, measured, not the picker's.** This file was
        first written by copying `app/p/loading.tsx`'s picker skeleton, which is the shape it exists
        to stop reserving: the real header is the back link (44) + `h1` (36) + `DayNav`'s arrow row
        and day strip (44 + 44) + the export link (44), so every element moved when the data landed.
        A frame that reserves the wrong shape buys nothing over reserving none.
      */}
      <div className="flex flex-col gap-2">
        <Skeleton className="h-11 w-32" />
        <Skeleton className="h-9 w-48" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-28" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    </AppShell>
  );
}
