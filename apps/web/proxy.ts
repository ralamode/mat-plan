import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';

import { GATE_COOKIE_NAME, GATE_PATH, isUngatedPath, isValidGateCookie } from '@/lib/access-gate';
import {
  CLERK_BOT_PROTECTION_ORIGIN,
  CLERK_IMG_ORIGIN,
  clerkFrontendApiOrigin,
  clerkIsConfigured,
  clerkPublishableKey,
} from '@/lib/clerk';
import { APP_HOME_PATH } from '@/lib/constants';
import { env } from '@/lib/env';

/**
 * Proxy (Next 16's renamed Middleware). Three responsibilities:
 *
 *  1. Access-gate stopgap — bounce un-gated requests to `/gate` (see
 *     lib/access-gate.ts for why this is a deterrent, not real authz).
 *  2. Security headers — a nonce-based CSP plus the standard hardening headers
 *     on every document response (see .github/SECURITY.md).
 *  3. Clerk (AUTH-1 1a) — `clerkMiddleware()` composed on the pass-through path, so `auth()` can
 *     answer in a page, action or handler. It authorizes NOTHING in 1a; see `withClerk` below.
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
 *   7.9.15; `@clerk/shared`'s own type for the prop says "Requires the `dynamic` prop to also be set",
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
 * **Order: the gate runs FIRST, Clerk second, on the pass-through path only.** A bounced request
 * renders nothing, so nothing can call `auth()` and Clerk has no question to answer; running vendor
 * middleware on every request from an un-gated stranger would widen the unauthenticated surface for
 * no benefit while the gate is still the only boundary. Every request that DOES render — including the
 * ungated `/`, `/privacy` and `/sign-in` — passes through here, which is what `auth()` needs. ⚠️ This
 * is NOT "the matcher/proxy is the boundary": SEC-1's lesson stands, pages and actions re-check
 * independently, and the `/api` matcher change below is about `auth()` being ABLE to answer.
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

export async function proxy(request: NextRequest, event?: NextFetchEvent): Promise<NextResponse> {
  const isDev = env.NODE_ENV === 'development';
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce, isDev, clerkFrontendApiOrigin(clerkPublishableKey()));

  const { pathname, search } = request.nextUrl;

  const authed = await isValidGateCookie(
    request.cookies.get(GATE_COOKIE_NAME)?.value,
    env.ACCESS_GATE_PASSWORD,
  );

  // Un-gated → send everything to the gate, except the gate itself and the public paths (OSS-2).
  // `from` is always set: `/` is public now, so the old "no `from` for `/`" guard became unreachable.
  //
  // `from` carries the QUERY STRING as well as the pathname (AUTH-1 1a). It used to be the pathname
  // alone, and `url.search = ''` discarded the rest — so a gated `/p/x/routine?d=2026-09-30` came back
  // from the gate as a bare `/p/x/routine`, silently on the wrong day. `safeInternalPath` (the gate
  // page and the gate action both clamp through it) already preserves and normalizes a query string,
  // and `internalPathname` already strips it where only the path is wanted, so this needs no new rule.
  if (!authed && !isUngatedPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = GATE_PATH;
    url.search = '';
    url.searchParams.set('from', `${pathname}${search}`);
    return withSecurityHeaders(NextResponse.redirect(url), csp);
  }

  // Already gated, on the gate or the public landing → straight to the app. `'/'` and not
  // `isPublicPath`: a public path with a purpose of its own (`/privacy`, `/sign-in`) must NOT bounce
  // to the app. Convenience routing between two pages the caller may already see, NOT authorization:
  // it lives here rather than in `app/page.tsx` so the public page stays branchless, and because a
  // page-level `redirect()` under the root layout's `force-dynamic` streams a 200 (landing HTML)
  // before the redirect lands.
  if (authed && (pathname === GATE_PATH || pathname === '/')) {
    const url = request.nextUrl.clone();
    url.pathname = APP_HOME_PATH;
    url.search = '';
    return withSecurityHeaders(NextResponse.redirect(url), csp);
  }

  return withSecurityHeaders(await withClerk(request, event, forward(request, nonce, csp)), csp);
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
    // Run on documents/actions; skip Next internals + static assets (which must
    // load un-gated so the gate page itself can render).
    //
    // ⚠️ NO `missing:` prefetch exclusion (SEC-1). A matcher condition decides whether the gate runs
    // AT ALL, and any client can send a prefetch header, so excluding prefetches let every request
    // that carried one skip the gate. Gating prefetches costs nothing: a gated user's prefetches
    // carry the cookie and pass. Pages and actions re-check the gate too (lib/dal/gate.ts).
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
    '/((?!_next/static/|_next/image(?:/|$)|favicon\\.ico$).*)',
  ],
};
