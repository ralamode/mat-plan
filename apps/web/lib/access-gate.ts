/**
 * Access-gate stopgap (V0-4) — pure, edge-safe helpers.
 *
 * This is a DELIBERATE STOPGAP, not an authorization boundary. It keeps the
 * public preview/prod URL from being wide open before Clerk household login
 * lands (AUTH-1) and before any real data exists (the DB arrives in V0-5). Real
 * authorization lives in the server-only DAL — ownership checks scoped by
 * `household_id`, re-verified on every read and write (see .github/SECURITY.md).
 * The proxy/middleware layer is explicitly NOT trusted as authz (CVE-2025-29927).
 *
 * No secrets or IO live here, so this module is safe to import from the Edge
 * proxy and trivial to unit-test. The shared code is read once in lib/env.ts and
 * passed in by the caller.
 *
 * ⚠️ **This module is DELETED at AUTH-1 1d**, when the session becomes the boundary. 1a already
 * moved out the two rules that outlive it — `lib/safe-redirect.ts` (SEC-4's open-redirect clamp) and
 * `lib/public-paths.ts` ("routes that need no session") — so what is left here is only the gate, and
 * 1d is a pure delete rather than a rename sprawl inside the heaviest chunk.
 */

import { isPublicPath } from './public-paths';

export const GATE_COOKIE_NAME = 'mp_gate';

/** Route of the access-gate entry page (also the `app/gate/` segment). */
export const GATE_PATH = '/gate';

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Deterministic, stateless token derived from the shared code. The raw code
 * never travels in the cookie. Statelessness is acceptable for a stopgap
 * deterrent; the durable, revocable session model is Clerk at AUTH-1.
 */
export function gateTokenFor(password: string): Promise<string> {
  return sha256Hex(`mat-plan:access-gate:v1:${password}`);
}

/** Constant-time comparison of two equal-length hex strings. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/** True when the cookie carries the token derived from the current shared code. */
export async function isValidGateCookie(
  cookieValue: string | undefined,
  password: string,
): Promise<boolean> {
  if (!cookieValue) return false;
  return timingSafeEqualHex(cookieValue, await gateTokenFor(password));
}

/**
 * Served without the gate cookie: the public paths plus the gate itself (how a caller GETS the cookie).
 * ONE definition for the three places that must agree — the proxy's bounce, the screenshot capture's
 * "skip the login" and the pages-are-gated test — so AUTH-1's edit to the exemptions happens once.
 *
 * Gate-shaped, so it stays here and goes with the gate at 1d, leaving `isPublicPath`.
 */
export function isUngatedPath(pathname: string): boolean {
  return pathname === GATE_PATH || isPublicPath(pathname);
}
