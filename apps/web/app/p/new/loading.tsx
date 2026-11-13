import { AppShell } from '@/components/layout/app-shell';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The add-athlete screen's Suspense fallback (`UI-5`).
 *
 * 🔴 **The third `loading.tsx`, and it exists because the first fix was incomplete.** `UI-5` gave
 * the day subtree its own fallback so the content column would stop jumping 32px at `lg` when a
 * page resolved — but `/p/new` renders a rail too (`page.tsx` passes `athletes`), and its nearest
 * boundary was still `app/p/loading.tsx`, which reserves NO frame. So the jump survived on exactly
 * the path a parent takes from the picker to "Add an athlete". A review lens found it after the
 * first fix shipped.
 *
 * ⚠️ **`busy` with no `athletes`**, like the day page's: a fallback cannot await the household, so
 * the shell reserves the rail's column with an inert placeholder and fills it when the page lands.
 * The frame matches the common state — a household that already has an athlete. The no-household
 * branch renders no rail, and is the rare one.
 */
export default function Loading() {
  return (
    <AppShell busy>
      <span className="sr-only">Loading…</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-11 w-36" />
        <Skeleton className="h-9 w-56" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-32" />
      </div>
    </AppShell>
  );
}
