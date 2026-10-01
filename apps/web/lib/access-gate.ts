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

/** A backslash, or a C0 control character / DEL — all of which the URL parser rewrites or drops. */
function hasUnsafeChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 0x5c || c <= 0x1f || c === 0x7f) return true;
  }
  return false;
}

/** Any origin works: it only has to be one a same-origin path can't change. */
const PROBE_ORIGIN = 'http://internal.invalid';

/**
 * Clamp a caller-supplied redirect target to a same-origin absolute path, so a
 * `?from=` value can never become an open redirect or an XSS sink. Falls back to
 * the site root. Shared by the gate page and the gate Server Action so the rule
 * can't drift between them (SEC-4).
 *
 * A prefix check is not enough: browsers and the URL parser treat `\` as `/` and
 * drop tab/CR/LF, so a path that merely *starts* with one slash can still resolve
 * to another origin. So: reject backslashes and control characters (raw or
 * percent-encoded), then resolve the path against a fixed origin and require the
 * origin to be unchanged.
 */
export function safeInternalPath(path: string | null | undefined): string {
  if (!path || !path.startsWith('/') || path.startsWith('//')) return '/';
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return '/';
  }
  if (hasUnsafeChar(path) || hasUnsafeChar(decoded)) return '/';
  if (decoded.startsWith('//')) return '/';
  let url: URL;
  try {
    url = new URL(path, PROBE_ORIGIN);
  } catch {
    return '/';
  }
  return url.origin === PROBE_ORIGIN ? path : '/';
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
 * ⚠️ **There is no public path.** The `/duals` exemption was removed with DUALS-1 (2026-09-30) —
 * the tournament day sheets carried 986 named minors' rosters, which cannot ship in a repo that is
 * going public. Every route is gated again.
 *
 * If a public route is ever needed, the removed helper's lesson is the part worth keeping: match the
 * SEGMENT exactly (`p === '/x' || p.startsWith('/x/')`), never `startsWith('/x')`, which would also
 * open `/xsecret`. And pin both the positive and negative cases.
 */
