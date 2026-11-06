import { PRIVACY_PATH, SIGN_IN_PATH } from './constants';

/**
 * Public routes (OSS-2, PRIV-2, AUTH-1 1a) — "needs no session", the list AUTH-1 inherits.
 *
 * Split out of `lib/access-gate.ts` by AUTH-1 1a. It was never gate-shaped either: `access-gate.ts`
 * is deleted at 1d, and "which routes are public" is the rule that survives the gate. Pure and
 * edge-safe — no secrets, no IO — so the proxy and the
 * pages-are-gated test can both import it. ⚠️ Said "the proxy, the pages-are-gated test and the
 * screenshot capture all read the same one definition" — after `1d` the proxy routes on nothing and
 * `capture.ts` branches on nothing, so the source guard is the only reader.
 */

/**
 * Routes served without a session, matched EXACTLY: the public landing at `/` (OSS-2) and the
 * privacy notice at `PRIVACY_PATH` (PRIV-2). Neither reads a cookie or queries anything.
 * DUALS-1 removed the last public path (`/duals`, whose day sheets carried named minors' rosters);
 * this list is the only way back in, and `public-paths.test.ts` pins its contents so adding an entry
 * is a deliberate, visible test edit.
 *
 * ⚠️ **Exact membership, with a SEPARATE list for subtrees.** DUALS-1's lesson is that a public path
 * with children must match the segment (`p === '/x' || p.startsWith('/x/')`), never
 * `startsWith('/x')`, which would also open `/xsecret`. Neither entry here HAS children, so
 * generalising this list to a prefix match would quietly make `/privacy/x` public. A route that owns
 * its subtree goes in `PUBLIC_PATH_TREES` instead.
 */
export const PUBLIC_PATHS = ['/', PRIVACY_PATH] as const;

/**
 * Public routes that own their whole SUBTREE.
 *
 * `SIGN_IN_PATH` is here and NOT in `PUBLIC_PATHS` because Clerk's prebuilt sign-in is a catch-all
 * route (`app/sign-in/[[...rest]]`): the handshake and OAuth callback arrive on children of it. The
 * separate list is what keeps `/privacy/` and `/privacy/x` gated — both `PUBLIC_PATHS` entries are
 * leaves, so generalising that list to a prefix match would have opened them.
 *
 * Why the sign-in tree is public: Clerk's prebuilt page is a catch-all and the OAuth handshake
 * arrives on its CHILDREN, so the whole subtree must be reachable without a session.
 * ⚠️ **The original reasons are both deleted by `AUTH-1` 1d** and are recorded only so nobody
 * reinstates a narrower rule from them: the proxy's gate bounce did `url.search = ''`, which would
 * have destroyed the handshake parameters, and `app/pages-are-gated.test.ts` required every
 * `page.tsx` to await `requireGatedPage()` — a function that no longer exists. The
 * surface this widens is a screen that reads no household data and queries nothing, the same shape
 * as the public landing.
 */
export const PUBLIC_PATH_TREES = [SIGN_IN_PATH] as const satisfies readonly string[];

/**
 * `/x` and everything under it — never `/xsecret`. Exported so the matcher is tested in its own
 * right rather than only through the entries that happen to use it.
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
