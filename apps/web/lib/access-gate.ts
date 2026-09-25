/**
 * Access-gate stopgap (V0-4) — pure, edge-safe helpers.
 *
 * This is a DELIBERATE STOPGAP, not an authorization boundary. It keeps the
 * public preview/prod URL from being wide open before Clerk household login
 * lands (v1.5) and before any real data exists (the DB arrives in V0-5). Real
 * authorization lives in the server-only DAL — ownership checks scoped by
 * `household_id`, re-verified on every read and write (see .github/SECURITY.md).
 * The proxy/middleware layer is explicitly NOT trusted as authz (CVE-2025-29927).
 *
 * No secrets or IO live here, so this module is safe to import from the Edge
 * proxy and trivial to unit-test. The shared code is read once in lib/env.ts and
 * passed in by the caller.
 */

export const GATE_COOKIE_NAME = 'mp_gate';

/** Route of the access-gate entry page (also the `app/gate/` segment). */
export const GATE_PATH = '/gate';

/**
 * Clamp a caller-supplied redirect target to a same-origin absolute path, so a
 * `?from=` value can never become an open redirect (`//evil.com`, `https://…`)
 * or an XSS sink. Falls back to the site root. Shared by the proxy, the gate
 * page, and the gate Server Action so the rule can't drift between them.
 */
export function safeInternalPath(path: string | null | undefined): string {
  return path && path.startsWith('/') && !path.startsWith('//') ? path : '/';
}

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
 * deterrent; the durable, revocable session model is Clerk at v1.5.
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

// ---------------------------------------------------------------------------
// Public routes (DUALS-1, decision D4)
// ---------------------------------------------------------------------------

/**
 * Routes that render without the household access code.
 *
 * Only the tournament day sheets. They read static event JSON — no DB, no
 * Clerk, no household data (see docs/plans/duals-1-public-day-sheet.md D1/D3) —
 * so opening them exposes nothing about the logger, which stays gated.
 */
export const PUBLIC_PATH_PREFIX = '/duals';

/**
 * Exact segment-prefix match: `/duals` and `/duals/…` only.
 *
 * NOT `startsWith('/duals')` — that would also open `/dualsecret`. This is the
 * entire public surface of the app, so both the positive and the negative cases
 * are pinned by tests.
 */
export function isPublicPath(pathname: string): boolean {
  return pathname === PUBLIC_PATH_PREFIX || pathname.startsWith(`${PUBLIC_PATH_PREFIX}/`);
}
