import { Skeleton } from '@/components/ui/skeleton';

/** Suspense fallback for the picker and Today while they fetch from the DB (V0-10). Lives under `p/`
 *  (OSS-2), not the root: at the root it would front the public landing, which awaits nothing. */
export default function Loading() {
  return (
    <main
      aria-busy="true"
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-12"
    >
      <span className="sr-only">Loading…</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-5 w-56" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    </main>
  );
}
