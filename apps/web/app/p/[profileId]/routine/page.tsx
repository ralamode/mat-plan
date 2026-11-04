import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireGatedPage } from '@/lib/dal/gate';
import { requireSession } from '@/lib/dal/session';
import { getProfileByPublicId } from '@/lib/dal/profiles';
import { routineCatalogItems } from '@/lib/routine/catalog';

import { RoutineEditor } from './routine-editor';

// Route-segment config must be a static inline literal (Next can't follow an imported const), so
// 'nodejs' stays here. pg → Node runtime, not Edge. Mirrors the sibling Today route.
export const runtime = 'nodejs';

/**
 * V1-18 PR 2: the coach routine editor. A parent authors which activities are in a kid's routine and their
 * order (the checklist + ▲▼ the panel settled on). **Linked from Today since V1-23 D3** (below the logged
 * entries) — the Clerk-era parent nav will place it properly. The profile is re-resolved server-side (the
 * ownership seam); its routine is already resolved by the DAL, so the editor seeds from a real order.
 *
 * ⚠️ This comment used to say "Reachable by URL only — NOT linked from the kid's Today", which #157
 * falsified and did not update. It cost ONB-0's plan a false scope exclusion and a whole wasted panel
 * question before anyone opened `../page.tsx`. `docs/features/programming.md` had it right the whole time.
 */
export default async function RoutineEditorPage({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  // 🔴 **BOTH, in-process. The gate is deleted at 1d, and 1c-4 is what made that safe.**
  // ⚠️ This said `getHouseholdScope()` "does not consult the principal until 1c-4" — it does now, so
  // a session proves WHOSE data this is rather than only that the caller is someone the Clerk
  // instance admits. That was the obligation blocking 1d, and it is discharged.
  // The gate check still stands until 1d because a swap would leave `mp_gate` enforced by the proxy
  // alone, which SECURITY.md refuses to call a boundary (CVE-2025-29927; SEC-1's own scar was a
  // prefetch header skipping the matcher).
  await requireGatedPage(); // SEC-1: the proxy is not the boundary
  await requireSession();
  const { profileId } = await params;
  const profile = await getProfileByPublicId(profileId);
  if (!profile) notFound();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-2">
        <Link
          href={`/p/${profile.id}`}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring w-fit rounded-sm text-sm outline-none focus-visible:ring-3"
        >
          ← Back to {profile.name}
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Edit routine</h1>
        <p className="text-muted-foreground">
          Choose {profile.name}&rsquo;s activities and the order they log them in.
        </p>
      </header>

      <RoutineEditor
        profileId={profile.id}
        initialOrder={profile.routine.order}
        catalog={routineCatalogItems()}
      />
    </main>
  );
}
