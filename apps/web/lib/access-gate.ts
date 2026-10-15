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

import { PRIVACY_PATH } from './constants';

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
 * origin to be unchanged. Return the parser's NORMALIZED form, never the input:
 * dot segments (`/.//x`) normalize to a `//` pathname that Next's client router
 * would push as a scheme-relative href, and non-ASCII characters must come back
 * percent-encoded because the target is written into a response header.
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
  if (url.origin !== PROBE_ORIGIN || url.pathname.startsWith('//')) return '/';
  return url.pathname + url.search + url.hash;
}

/** The pathname of a path `safeInternalPath` returned (`/?x=1` → `/`), parsed the same way it was. */
export function internalPathname(path: string): string {
  return new URL(path, PROBE_ORIGIN).pathname;
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
// Public routes (OSS-2, PRIV-2)
// ---------------------------------------------------------------------------

/**
 * Routes served WITHOUT the gate, matched EXACTLY: the public landing at `/` (OSS-2) and the privacy
 * notice at `PRIVACY_PATH` (PRIV-2). Neither reads a cookie or queries anything. DUALS-1 removed the
 * last public path (`/duals`, whose day sheets carried named minors' rosters); this list is the only
 * way back in, and `access-gate.test.ts` pins its contents so adding an entry is a deliberate,
 * visible test edit.
 *
 * ⚠️ **Exact membership, with a SEPARATE list for subtrees.** DUALS-1's lesson is that a public path
 * with children must match the segment (`p === '/x' || p.startsWith('/x/')`), never
 * `startsWith('/x')`, which would also open `/xsecret`. Neither entry here HAS children, so
 * generalising this list to a prefix match would quietly make `/privacy/x` public. A route that owns
 * its subtree goes in `PUBLIC_PATH_TREES` instead — including AUTH-1 1a's `/sign-in`.
 *
 * AUTH-1 inherits both lists as "routes that need no session".
 */
export const PUBLIC_PATHS = ['/', PRIVACY_PATH] as const;

/**
 * Public routes that own their whole SUBTREE. Empty today, and that is the point: both
 * `PUBLIC_PATHS` entries are leaves, so exact membership still holds for them. AUTH-1 1a's
 * `/sign-in` catch-all adds its entry HERE — NOT to `PUBLIC_PATHS` — which is what keeps
 * `/privacy/` and `/privacy/x` gated through that PR rather than flipping two of this module's
 * negative tests on a PR that has nothing to do with the notice.
 */
export const PUBLIC_PATH_TREES = [] as const satisfies readonly string[];

/**
 * `/x` and everything under it — never `/xsecret`. Exported so the matcher is TESTED before any
 * entry exists: an unreachable branch is what the previous docblock refused to ship, and a tested
 * branch with no entry answers that objection without waiting for AUTH-1.
 */
export function matchesPathTree(root: string, pathname: string): boolean {
  return pathname === root || pathname.startsWith(`${root}/`);
}

export function isPublicPath(pathname: string): boolean {
  return (
    (PUBLIC_PATHS as readonly string[]).includes(pathname) ||
    (PUBLIC_PATH_TREES as readonly string[]).some((root) => matchesPathTree(root, pathname))
  );
}

/**
 * Served without the gate cookie: the public paths plus the gate itself (how a caller GETS the cookie).
 * ONE definition for the three places that must agree — the proxy's bounce, the screenshot capture's
 * "skip the login" and the pages-are-gated test — so AUTH-1's edit to the exemptions happens once.
 */
export function isUngatedPath(pathname: string): boolean {
  return pathname === GATE_PATH || isPublicPath(pathname);
}
