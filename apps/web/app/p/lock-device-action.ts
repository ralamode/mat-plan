'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { GATE_COOKIE_NAME, GATE_PATH } from '@/lib/access-gate';
import { hasGateAccess } from '@/lib/dal/gate';

/**
 * Clear the access-gate cookie — the picker's "Lock this device" control.
 *
 * **Why this module is NOT in `components/layout/site-footer.tsx`,** which is where it was first
 * proposed: `app/layout.tsx` renders the footer on every route, and
 * `pages-are-gated.test.ts` → "public pages pull no Server Action into their module graph" asserts
 * that a `'use server'` module is unreachable from `/`, `/privacy`, `/sign-in` and `/gate`. A footer
 * import would put this action in all four graphs — *"invokable by an unauthenticated POST to it with
 * only its own gate check in the way."* Living under `app/p/` keeps it in a gated page's graph only.
 *
 * ⚠️ **It re-checks the gate before clearing it, and is NOT allowlisted** in that suite's boundary
 * scan. `app/gate/actions.ts` is excused because it cannot require the thing it is about to grant;
 * this one has no such excuse — it can require the cookie before deleting it, and so it must.
 *
 * 🔴 **Deleted at AUTH-1 1d**, with the rest of the gate (`lib/access-gate.ts` says so about itself).
 * 1c/1d replace it with a real per-person sign-out; this is knowingly throwaway.
 */
export async function lockDeviceAction(): Promise<void> {
  // `return` is not redundant: `redirect()` works by throwing, so without it this function's
  // safety depends on a framework implementation detail rather than on its own control flow.
  // A test that stubs `redirect` (as the boundary suite does) clears the cookie anyway.
  if (!(await hasGateAccess())) return redirect(GATE_PATH);

  (await cookies()).delete(GATE_COOKIE_NAME);
  redirect(`${GATE_PATH}?locked=1`);
}
