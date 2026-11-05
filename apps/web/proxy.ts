import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';

import {
  CLERK_BOT_PROTECTION_ORIGIN,
  CLERK_IMG_ORIGIN,
  clerkFrontendApiOrigin,
  clerkIsConfigured,
  clerkPublishableKey,
} from '@/lib/clerk';
import { env } from '@/lib/env';

/**
 * The gate's cookie, retired at AUTH-1 1d. `withRetiredCookies` clears it; nothing reads it.
 * Removal trigger: 2027-02-04 (docs/tech-debt.md), by when any live holder's cookie has expired.
 * `proxy.test.ts` pins the value — the one sanctioned place a literal belongs on the assertion side,
 * replacing the pin that `lib/access-gate.test.ts` carried before `1d` deleted it.
 */
const RETIRED_GATE_COOKIE = 'mp_gate';

/**
 * Proxy (Next 16's renamed Middleware). Three responsibilities:
 *
 *  1. Security headers — a nonce-based CSP plus the standard hardening headers
 *     on every document response (see .github/SECURITY.md).
 *  2. Clerk (AUTH-1 1a) — `clerkMiddleware()` composed so `auth()` can answer in a page, action or
 *     handler. It authorizes NOTHING here; see `withClerk` below.
 *  3. Retiring `mp_gate` (AUTH-1 1d) — a `Set-Cookie` tombstone for callers who still hold the
 *     deleted gate cookie; see `withRetiredCookies`.
 *
 * 🔴 **This layer ENFORCES NOTHING, and `1d` is what made that literally true.** Until `1d` it also
 * bounced un-gated requests to `/gate`, which was the one thing the proxy itself enforced. That is
 * gone with the gate, and the boundary is now a Clerk session with a `household_members` row,
 * re-checked in every page, action and handler that reads household data. SEC-1's lesson is the
 * reason the bounce was never the boundary even while it existed: a matcher condition decides
 * whether this code runs AT ALL, any client can shape a request to dodge one (SEC-1's scar was a
 * prefetch header), and CVE-2025-29927 is the general case. ⚠️ Do not add an authorization check
 * here. A check in this file is unreachable for any request the matcher misses, which is why
 * `app/pages-are-gated.test.ts` asserts the per-route calls instead.
 *
 * Nonce-based CSP requires dynamic rendering; the root layout opts the app in
 * with `export const dynamic = 'force-dynamic'` (this is an inherently per-user
 * app, so nothing is statically cacheable anyway).
 */

/**
 * 🔴 **The Clerk widening, by EXACT ORIGIN, and only when Clerk is configured.**
 *
 * `clerkOrigin` is the instance's Frontend API origin, derived from the publishable key
 * (`lib/clerk.ts:clerkFrontendApiOrigin`) — so the policy is exact for the development instance and
 * the production instance without a per-environment edit, and `null` the whole time 1a is dark.
 * `proxy.test.ts` pins every added source by its literal origin; a wildcard here is the one security-
 * header change in Beta 0 that nobody will ever revisit, in the CSP that protects a public app
 * holding minors' health data.
 *
 * **What is NOT widened, and why — the three answers § Design 6b asked for:**
 *
 * - **`script-src` gets no new origin.** Clerk's `clerk.browser.js` and `ui.browser.js` are served
 *   from `clerkOrigin`, but this policy carries `'strict-dynamic'`, which makes a browser IGNORE every
 *   host and scheme source in `script-src` — so adding one would be dead weight that reads like a
 *   protection. The scripts load on the NONCE instead: `<ClerkProvider nonce dynamic>` (app/layout.tsx)
 *   feeds the same per-request `x-nonce` this proxy already forwards into
 *   `@clerk/nextjs`'s `DynamicClerkScripts`, which stamps it onto both the `<script>`
 *   (`buildClerkJSScriptAttributes`) and the `<link rel=preload as=script>`. Verified at the pinned
 *   7.9.22; `@clerk/shared`'s own type for the prop says "Requires the `dynamic` prop to also be set",
 *   which is why both are passed together.
 * - **`style-src` keeps its nonce and gains NOTHING.** Clerk's own recommended policy is
 *   `style-src 'self' 'unsafe-inline'`, and under CSP3 a nonce in `style-src` makes `'unsafe-inline'`
 *   inert — so "add it as well" is not available: relaxing style-src for Clerk means DELETING the
 *   nonce, for the whole app, on every route. That is not a trade 1a makes silently. ⚠️ **Open box for
 *   the maintainer, recorded rather than guessed:** whether Clerk's UI injects un-nonced inline styles
 *   is NOT answerable from the lockfile — the UI bundle is fetched from Clerk's CDN at runtime
 *   (`clerkUIScriptUrl`), outside `pnpm-lock.yaml` and outside the `audit:check` gate. 1a ships dark,
 *   so nothing is broken today; the first person to configure an instance must load `/sign-in` and
 *   check for `style-src` violations before 1c relies on the screen.
 * - **`connect-src` does NOT gain `clerk-telemetry.com`.** `next.config.ts` pins
 *   `NEXT_PUBLIC_CLERK_TELEMETRY_DISABLED`, so there is nothing to allow.
 */
/** Exported for `proxy.test.ts`: every Clerk source is pinned against this pure function by exact
 *  origin, which is cheaper and stricter than reaching it through a configured `env`. */
export function buildCsp(nonce: string, isDev: boolean, clerkOrigin: string | null): string {
  return [
    `default-src 'self'`,
    // 'strict-dynamic' + nonce: trust scripts Next injects, ignore host allowlists.
    // Dev needs 'unsafe-eval' (React uses eval for richer stack traces).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    // Clerk serves OAuth provider logos (and, later, avatars) from its image host.
    `img-src 'self' blob: data:${clerkOrigin ? ` ${CLERK_IMG_ORIGIN}` : ''}`,
    `font-src 'self'`,
    // Dev HMR talks over a websocket to the dev server origin. clerk-js talks to the Frontend API.
    `connect-src 'self'${isDev ? ' ws:' : ''}${clerkOrigin ? ` ${clerkOrigin}` : ''}`,
    // Both directives exist ONLY when Clerk does: absent, they fall through to `default-src 'self'`,
    // which is the tighter policy and the one every pre-AUTH-1 route keeps.
    ...(clerkOrigin
      ? [
          // Clerk's bot protection renders a Cloudflare Turnstile iframe.
          `frame-src 'self' ${CLERK_BOT_PROTECTION_ORIGIN}`,
          // clerk-js uses a blob: worker; Clerk's own default policy is `worker-src 'self' blob:`.
          `worker-src 'self' blob:`,
        ]
      : []),
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join('; ');
}

function withSecurityHeaders(response: NextResponse, csp: string): NextResponse {
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY'); // legacy backstop for frame-ancestors
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  );
  response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  return response;
}

/**
 * Clerk composed INSIDE the proxy — the shape matters more than the call (AUTH-1 1a, § Design 6/6.1).
 *
 * **Composed only when both keys are present.** With no keys, `clerkMiddleware()` asserts them and
 * throws (`assertKey` → `throwMissingPublishableKeyError`), and a throw HERE is a 500 on every matched
 * route — including the two unauthenticated ones — in exactly the environments that legitimately run
 * without keys (local dev, CI's `next build`, un-wired previews). So "dark, not broken" is a branch in
 * our code rather than a vendor behaviour we hoped for, and `getCurrentUser()` will return `null` by
 * construction in that state.
 *
 * **Our response is MERGED, never replaced.** `forward()` is passed as Clerk's *handler*, so Clerk
 * decorates the response WE built — `handlerResult = userHandlerResult || NextResponse.next()` in
 * `clerkMiddleware.js` — appending its `requestState` headers and its `x-middleware-request-*`
 * overrides onto ours. The `x-nonce` / `x-pathname` forwarding the theme script and the footer depend
 * on therefore survives (verified: `setRequestHeadersOnNextResponse` only re-seeds the override list
 * when `x-middleware-override-headers` is absent, and `NextResponse.next({ request })` has already set
 * it). Returning Clerk's OWN `next()` instead would silently drop both, and a rotated session cookie
 * in the other direction — R3's "a dark app for the only user, blamed on Clerk".
 *
 * 🔴 **Clerk now runs on ALL matched traffic, which is a change `1d` made.** It used to run second,
 * on the pass-through path only: a gate-bounced request rendered nothing, so nothing could call
 * `auth()`, and keeping vendor middleware off those requests avoided widening the unauthenticated
 * surface for no benefit. With the bounce deleted there is no such path left — every matched request
 * reaches here, including from a caller with no session at all. That is required, not incidental:
 * `auth()` THROWS when `clerkMiddleware()` did not run on the request, and after `1d` the only way
 * in is `/sign-in`, whose whole SUBTREE must work (`PUBLIC_PATH_TREES`, not `PUBLIC_PATHS` — Clerk's
 * prebuilt page is a catch-all and the OAuth handshake arrives on its children).
 * ⚠️ This is still NOT "the proxy is the boundary": pages, actions and handlers re-check
 * independently, and the `/api` matcher inclusion below is about `auth()` being ABLE to answer.
 */
async function withClerk(
  request: NextRequest,
  event: NextFetchEvent | undefined,
  response: NextResponse,
): Promise<NextResponse> {
  if (!clerkIsConfigured()) return response;
  // Clerk's `NextMiddleware` type requires the event; it only ever forwards it to the handler, which
  // here ignores it. Next always supplies one in production — `proxy.test.ts` is what calls `proxy`
  // with one argument, and it exercises the un-configured branch above.
  const composed = clerkMiddleware(() => response) as (
    request: NextRequest,
    event: NextFetchEvent | undefined,
  ) => Promise<NextResponse>;
  return composed(request, event);
}

// ⚠️ **Returns `Response`, not `NextResponse`, and that is deliberate.** `withRetiredCookies` takes
// and returns `Response` because `withClerk` can hand back a plain one (its auto-proxy branch), so
// narrowing this signature back to `NextResponse` would re-tell the lie that cast already tells.
// Next's proxy contract accepts any `Response`.
export async function proxy(request: NextRequest, event?: NextFetchEvent): Promise<Response> {
  const isDev = env.NODE_ENV === 'development';
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce, isDev, clerkFrontendApiOrigin(clerkPublishableKey()));

  const { pathname, search } = request.nextUrl;

  // 🔴 **Nothing is enforced here any more (AUTH-1 1d).** This function used to read `mp_gate` and
  // bounce an un-gated request to `/gate` before Clerk ran. Both are gone: the gate is deleted, and
  // the boundary is a session with a `household_members` row, checked where the work happens.
  //
  // ⚠️ **What went with the bounce, so nobody re-adds half of it.** `1c-3b` had already deleted the
  // `authed && (GATE_PATH | '/')` → `APP_HOME_PATH` forward (ARM 2) because it looped every
  // cookie-holder without a session. ARM 1 — the gate form forwarding to `/p`, where `requireSession()`
  // bounced back to `/sign-in` — survived that chunk and is deleted HERE, with the form itself. The
  // `?from=` escape hatch recorded at `app/sign-in/[[...rest]]/page.tsx` was the one thing that
  // needed the gate cookie to close, and `1d` closes it by removing the cookie's meaning instead.
  //
  // Committed rationales that referred to the forward or the bounce are corrected with it — listed,
  // not numbered. ⚠️ **NO COUNT**: the number was wrong every time it was written ("four" when none
  // had been made, then "five" when it was seven), and that correction also swapped a true file name
  // (`SIGN_IN_COPY`) for a false one (`GATE_COPY`). A list can be checked against the tree; a count
  // can only be checked by redoing the arithmetic, which is why it is the thing that goes stale.
  //
  //   `app/page.tsx`                     the branchless-landing note
  //   `APP_HOME_PATH`                    an HH-1 instruction to delete a rule already gone
  //   `SIGN_IN_COPY`                     the one-exit-serves-both argument
  //   `app/sign-in/[[...rest]]/page.tsx` the control's own copy of that argument
  //   `scripts/capture.ts`               why a logged-in `/` or `/gate` could not be screenshotted
  //   `docs/architecture.md` §2b         the routing diagram and the public-route asymmetry

  const response = withSecurityHeaders(
    await withClerk(request, event, forward(request, nonce, csp)),
    csp,
  );
  return withRetiredCookies(request, response);
}

/**
 * 🔴 **The `mp_gate` tombstone (AUTH-1 1d).** A caller who still holds the deleted gate cookie keeps
 * sending it forever; this clears it once, on the first matched response they receive.
 *
 * ⚠️ **A literal header, NOT `response.cookies.delete()`, and the distinction is load-bearing.**
 * Mutating `ResponseCookies` calls `replace()`, which does `headers.delete('set-cookie')` and
 * re-emits only the parsed bag — keyed by NAME ALONE and round-tripped through
 * `decodeURIComponent`/`encodeURIComponent`. On the very response that establishes a session that can
 * mangle `__clerk_handshake` and collapse same-name/different-`Domain` pairs. `headers.append` adds
 * one header and parses nothing.
 *
 * ⚠️ **The parameter is `Response`, not `NextResponse`, because `withClerk` does not always return
 * one.** `clerkMiddleware` auto-arms a frontend-API proxy branch when the publishable key is
 * production and the hostname matches, returning a plain `Response` whose `.cookies` is `undefined`
 * — laundered past TypeScript by the cast in `withClerk`. Typing this `NextResponse` would re-tell
 * that lie. (`Response.redirect()` headers ARE immutable and would throw on append; Clerk builds its
 * handshake with `NextResponse.redirect`, which is mutable, and `proxy.test.ts` → "rides on a Clerk
 * handshake redirect" pins that case so a vendor switch fails loudly rather than silently.)
 *
 * **Only when the cookie is present**, so an ordinary visitor never receives a spurious `Set-Cookie`.
 * `Path=/` matches what the gate action set since V0-4, so no stale `mp_gate` can exist at another
 * path and the `has()` guard cannot stick true. `Secure` is omitted deliberately — cookie identity is
 * name/domain/path, so it is not needed to match, and omitting it also clears the cookie on plain
 * HTTP in local dev.
 *
 * **Residual, benign, worth writing down:** any caller can send `Cookie: mp_gate=x` and force a
 * `Set-Cookie` onto any matched response. It discloses nothing and both arms of ADR 0006's
 * byte-identical refusal carry the same header, but it makes an otherwise-cacheable public response
 * uncacheable for that one request.
 */
function withRetiredCookies(request: NextRequest, response: Response): Response {
  if (request.cookies.has(RETIRED_GATE_COOKIE)) {
    response.headers.append(
      'set-cookie',
      `${RETIRED_GATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
    );
  }
  return response;
}

/**
 * Forward the nonce to the renderer via request headers; Next reads it from the
 * CSP header and stamps its own script/style tags automatically.
 *
 * `x-pathname` rides the same mechanism (PRIV-2) so the root layout's footer can set
 * `aria-current="page"` while staying a SERVER component — the alternative is a `usePathname()`
 * client component on every route in the app, for one attribute. Both are `.set()` on a COPY of the
 * inbound headers, so an inbound `x-pathname` (or `x-nonce`) is overwritten on every forwarded
 * request; `proxy.test.ts` asserts that for both. The worst case of a spoof here is a wrong
 * `aria-current`, not a security property.
 *
 * `x-nonce` is also what `<ClerkProvider nonce>` is given in `app/layout.tsx`, and what
 * `@clerk/nextjs`'s own `DynamicClerkScripts` reads straight off this header — so one nonce covers
 * Next's tags, the theme script and Clerk's script tag.
 */
function forward(request: NextRequest, nonce: string, csp: string): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('x-pathname', request.nextUrl.pathname);
  requestHeaders.set('Content-Security-Policy', csp);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    // Run on documents/actions; skip Next internals + static assets.
    //
    // 🔴 **The matcher body is UNCHANGED by `1d`; its justification is what changed.** It used to be
    // "this is what decides whether the gate runs". There is no gate, so it is now: `auth()` must be
    // able to answer, and the security headers must land. Both are properties of every matched
    // request, which is why the body stays wide rather than narrowing to the routes that read data.
    //
    // ⚠️ NO `missing:` prefetch exclusion, and SEC-1's lesson OUTLIVES the gate it was learned on.
    // A matcher condition decides whether this file runs AT ALL, and any client can send a prefetch
    // header — so excluding prefetches once let every request carrying one skip the gate entirely.
    // The same shape would now skip `clerkMiddleware()`, making `auth()` throw on exactly the
    // requests an attacker chooses. Including prefetches costs nothing. ⚠️ This is also why the
    // matcher is not the boundary: pages, actions and handlers re-check in-process
    // (`app/pages-are-gated.test.ts`), and `proxy.test.ts` pins the matcher's SHAPE so a narrowing
    // edit fails a test rather than silently un-authenticating a route.
    //
    // The lookahead is ANCHORED (OSS-2): each exclusion must end at a segment boundary or the end, so
    // `/favicon.icon` and `/_next/imagex` are gated. Unanchored, it skipped any path that
    // merely STARTED with an excluded string — the `startsWith('/x')` mistake DUALS-1 warned about.
    //
    // 🔴 `api` IS NO LONGER EXCLUDED (AUTH-1 1a). It was, and `.github/SECURITY.md` and
    // `docs/tech-debt.md` both carried that as the "/api matcher hole": a Route Handler added under
    // `/api` would have been served with no gate bounce and no security headers. It was latent rather
    // than live (the export handler sits at `/p/[profileId]/export` precisely for this reason), and
    // 1a has to close it anyway — `auth()` THROWS when `clerkMiddleware()` did not run on the
    // request, so an excluded `/api` handler could not authenticate at all after 1a: it would 500,
    // or refuse every caller including a legitimate one. ⚠️ The honest claim is still NOT "no
    // matcher-shaped gap": `_next/static/`, `_next/image` and `favicon.ico` remain excluded, and
    // `/_next/image` is a live surface. The claim is "no gap at any entry point that reads household
    // data", and it is held by the per-page / per-action / per-handler checks —
    // `app/pages-are-gated.test.ts`, with the non-vacuity floor 1a added to its handler suite.
    // ⚠️ After `1d` that claim rests on those checks ALONE, since the bounce that used to back it up
    // is gone. `/_next/image` remains an excluded live surface and is still not a data entry point.
    '/((?!_next/static/|_next/image(?:/|$)|favicon\\.ico$).*)',
  ],
};
