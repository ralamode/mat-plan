import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { GATE_COOKIE_NAME, GATE_PATH, isValidGateCookie } from '@/lib/access-gate';
import { env } from '@/lib/env';

/**
 * The access gate, re-checked where the work happens (SEC-1).
 *
 * The proxy redirects un-gated requests, but it is a matcher-driven layer and NOT the auth boundary
 * (.github/SECURITY.md; CVE-2025-29927). Until SEC-1 its matcher excluded prefetch-flagged requests,
 * so any request carrying a prefetch header skipped the gate entirely. Every gated ENTRY POINT
 * reaches one of these first — the seven mutating actions through `enterMutation`
 * (`app/p/[profileId]/mutation-entry.ts`), the four pages through `requireGatedPage()`, the export
 * handler directly. ⚠️ Not *every* Server Action: `app/gate/actions.ts` issues the gate and cannot
 * require what it is about to grant, which is why it is allowlisted BY NAME in
 * `app/pages-are-gated.test.ts`. So a future matcher edit, rewrite or route move can't open the app.
 * Still a stopgap, and the date moved: Clerk does not replace it at v1.5 but at **`AUTH-1` 1d**,
 * which `1c-4` gates — until the household scope is membership-derived, a session alone means
 * "anyone this Clerk instance admits", so deleting the gate first would WIDEN access.
 */
export async function hasGateAccess(): Promise<boolean> {
  return isValidGateCookie(
    (await cookies()).get(GATE_COOKIE_NAME)?.value,
    env.ACCESS_GATE_PASSWORD,
  );
}

/** For gated pages: an un-gated render goes to the gate, as the proxy would have sent it. */
export async function requireGatedPage(): Promise<void> {
  if (!(await hasGateAccess())) redirect(GATE_PATH);
}
