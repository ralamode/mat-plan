/**
 * Redirect safety (SEC-4) — clamp a caller-supplied redirect target to this origin.
 *
 * Split out of `lib/access-gate.ts` by AUTH-1 1a. It was never about the gate: the gate page, the
 * gate Server Action and (at 1c) Clerk's post-sign-in return all write a caller-supplied path into a
 * response header, and the rule that makes that safe must not drift between them. `access-gate.ts`
 * is deleted at AUTH-1 1d; this rule outlives it, so it lives here.
 *
 * Pure and edge-safe — no secrets, no IO — so the proxy can import it.
 */

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
