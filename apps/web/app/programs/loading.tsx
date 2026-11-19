import { AppShell } from '@/components/layout/app-shell';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The Suspense fallback for the program builder's pages (FAM-1 7b-i), as `app/p/loading.tsx` is the
 * picker's: on a slow connection a tap on Programs, or on a program, shows a busy frame at once
 * instead of the page it came from. `busy` keeps `aria-busy` on `<main>` and reserves the rail's
 * column, which every program page shows at `lg`.
 */
export default function Loading() {
  return (
    <AppShell busy>
      <span className="sr-only">Loading…</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-8 w-40" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    </AppShell>
  );
}
