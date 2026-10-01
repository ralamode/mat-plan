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
 * so any request carrying a prefetch header skipped the gate entirely. Every Server Action and every
 * gated page calls one of these first, so a future matcher edit, rewrite or route move can't open
 * the app again. Same check as the export Route Handler. Still a stopgap: Clerk replaces it at v1.5.
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
