import { NextResponse, type NextRequest } from 'next/server';

import { GATE_COOKIE_NAME, GATE_PATH, isPublicPath, isValidGateCookie } from '@/lib/access-gate';
import { APP_HOME_PATH } from '@/lib/constants';
import { env } from '@/lib/env';

/**
 * Proxy (Next 16's renamed Middleware). Two responsibilities:
 *
 *  1. Access-gate stopgap — bounce un-gated requests to `/gate` (see
 *     lib/access-gate.ts for why this is a deterrent, not real authz).
 *  2. Security headers — a nonce-based CSP plus the standard hardening headers
 *     on every document response (see .github/SECURITY.md).
 *
 * Nonce-based CSP requires dynamic rendering; the root layout opts the app in
 * with `export const dynamic = 'force-dynamic'` (this is an inherently per-user
 * app, so nothing is statically cacheable anyway).
 */

function buildCsp(nonce: string, isDev: boolean): string {
  return [
    `default-src 'self'`,
    // 'strict-dynamic' + nonce: trust scripts Next injects, ignore host allowlists.
    // Dev needs 'unsafe-eval' (React uses eval for richer stack traces).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    `img-src 'self' blob: data:`,
    `font-src 'self'`,
    // Dev HMR talks over a websocket to the dev server origin.
    `connect-src 'self'${isDev ? ' ws:' : ''}`,
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

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const isDev = env.NODE_ENV === 'development';
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce, isDev);

  const { pathname } = request.nextUrl;

  const authed = await isValidGateCookie(
    request.cookies.get(GATE_COOKIE_NAME)?.value,
    env.ACCESS_GATE_PASSWORD,
  );

  // Un-gated → send everything to the gate, except the gate itself and the public paths (OSS-2).
  // `from` is always set: `/` is public now, so the old "no `from` for `/`" guard became unreachable.
  if (!authed && pathname !== GATE_PATH && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = GATE_PATH;
    url.search = '';
    url.searchParams.set('from', pathname);
    return withSecurityHeaders(NextResponse.redirect(url), csp);
  }

  // Already gated, on the gate or the public landing → straight to the app. Convenience routing
  // between two pages the caller may already see, NOT authorization: it lives here rather than in
  // `app/page.tsx` so the public page stays branchless, and because a page-level `redirect()` under
  // the root layout's `force-dynamic` streams a 200 (landing HTML) before the redirect lands.
  if (authed && (pathname === GATE_PATH || pathname === '/')) {
    const url = request.nextUrl.clone();
    url.pathname = APP_HOME_PATH;
    url.search = '';
    return withSecurityHeaders(NextResponse.redirect(url), csp);
  }

  return withSecurityHeaders(forward(request, nonce, csp), csp);
}

/**
 * Forward the nonce to the renderer via request headers; Next reads it from the
 * CSP header and stamps its own script/style tags automatically.
 */
function forward(request: NextRequest, nonce: string, csp: string): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
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
    // `/apiary`, `/favicon.icon` and `/_next/imagex` are gated. Unanchored, it skipped any path that
    // merely STARTED with an excluded string — the `startsWith('/x')` mistake DUALS-1 warned about.
    '/((?!api(?:/|$)|_next/static/|_next/image(?:/|$)|favicon\\.ico$).*)',
  ],
};
