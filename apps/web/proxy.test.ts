import { createRequire } from 'node:module';

import { NextRequest, type NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CLERK_IMG_ORIGIN } from '@/lib/clerk';
import { APP_HOME_PATH, PRIVACY_PATH, SIGN_IN_PATH } from '@/lib/constants';

import { buildCsp, config, proxy } from './proxy';

/**
 * The proxy's behaviour and its matcher.
 *
 * 🔴 **`1d` deleted the whole routing suite, and that is the honest consequence of the proxy no
 * longer routing.** Every case in it asserted a gate bounce — "bounces un-gated `/p` to the gate with
 * `?from=`", "serves the gate itself", "preserves the query string in `?from=`". There is no bounce
 * and no `/gate`, so those cases could only have been kept by inventing a new subject for them.
 * What replaces them is narrower and real: the proxy REDIRECTS NOTHING (a reintroduced redirect is a
 * loop, so it is worth one assertion), the matcher's SHAPE is pinned, and the `mp_gate` tombstone is
 * covered five ways.
 *
 * This file still proves what only it can: the CSP widening by exact origin, that `clerkMiddleware()`
 * is composed without replacing our response, and that none of it arms itself while Clerk is
 * un-configured.
 */

const ORIGIN = 'http://localhost:3000';

/**
 * A synthetic development publishable key — `btoa('tidy-lion-42.clerk.accounts.dev$')`. Not a
 * credential: a publishable key is public by design (`lib/env.ts`) and this one names a host that
 * does not exist. It exists so the configured branch can be exercised with no instance.
 */
const TEST_PUBLISHABLE_KEY = `pk_test_${Buffer.from('tidy-lion-42.clerk.accounts.dev$', 'utf8')
  .toString('base64')
  .replace(/=+$/, '')}`;
const TEST_FRONTEND_ORIGIN = 'https://tidy-lion-42.clerk.accounts.dev';

/**
 * `env` is validated at import time, so the configured branch cannot be reached by setting
 * `process.env` later. The predicate module is stubbed instead, and `lib/clerk.test.ts` covers the
 * real `env` → predicate half (with no keys it is `false`, which is 1a's shipped state).
 */
let clerkConfigured = false;
vi.mock('@/lib/clerk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/clerk')>();
  return {
    ...actual,
    clerkIsConfigured: () => clerkConfigured,
    clerkPublishableKey: () => (clerkConfigured ? TEST_PUBLISHABLE_KEY : undefined),
  };
});

/**
 * A stand-in for `clerkMiddleware()` that mimics the ONE contract this proxy depends on, read off
 * `@clerk/nextjs@7.9.22`'s `clerkMiddleware.js`: it calls the handler, and
 * `handlerResult = userHandlerResult || NextResponse.next()` — so OUR response is the one decorated.
 * It then appends a rotated session cookie the way `requestState.headers.forEach(… append)` does.
 *
 * ⚠️ This pins OUR half of the contract (we pass a handler; we do not discard what comes back). It
 * cannot pin the VENDOR's half — a future `@clerk/nextjs` that ignores the handler's response would
 * pass this test, which is why AGENTS.md wants a Clerk bump treated as its own reviewed PR.
 */
// 🔴 **An APPENDED cookie, which is what makes the byte-identity case below able to fail.** A first
// version put the special characters in the inbound request `Cookie` header, where no implementation
// re-emits them — green under both implementations, i.e. unable to fail on the thing it was named for.
// ⚠️ The `+`, `/` and `=` are a secondary guard, NOT the mechanism; see that case's own note.
const ROTATED_COOKIE = '__clerk_handshake=a+b/c==; Path=/; HttpOnly';
const clerkCalls: { handled: boolean }[] = [];
/**
 * 🔴 **AUTH-1 1d — the auto-proxy branch, which returns a PLAIN `Response`.** `clerkMiddleware.js`
 * arms a frontend-API proxy when the publishable key is production and the hostname matches, and
 * that branch returns a plain `Response` whose `.cookies` is `undefined` — a shape `withClerk`'s cast
 * hides from TypeScript. The tombstone has to survive it, so the mock can produce it on demand.
 */
let clerkReturnsPlainResponse = false;
/** Clerk's handshake: `NextResponse.redirect`, built WITHOUT calling our handler. */
let clerkReturnsRedirect = false;
vi.mock('@clerk/nextjs/server', () => ({
  clerkMiddleware:
    (handler: () => NextResponse) =>
    async (_request: unknown, _event: unknown): Promise<NextResponse | Response> => {
      clerkCalls.push({ handled: true });
      if (clerkReturnsRedirect) {
        // ⚠️ Built WITHOUT calling the handler — which is what `clerkMiddleware` does for a
        // handshake, and the reason the tombstone must wrap the function's single `return`.
        // ⚠️ `await import` inside the factory: `vi.mock` is hoisted above the module's own imports,
        // so closing over the top-level `NextResponse` throws `ReferenceError` at call time.
        const { NextResponse: NR } = await import('next/server');
        const redirect = NR.redirect(new URL('/sign-in', ORIGIN));
        redirect.headers.append('set-cookie', ROTATED_COOKIE);
        return redirect;
      }
      const res = handler();
      res.headers.append('set-cookie', ROTATED_COOKIE);
      if (clerkReturnsPlainResponse) {
        // A genuinely plain Response: no `.cookies`, headers carried across.
        return new Response(null, { status: 200, headers: res.headers });
      }
      return res;
    },
}));

beforeEach(() => {
  clerkConfigured = false;
  clerkReturnsPlainResponse = false;
  clerkReturnsRedirect = false;
  clerkCalls.length = 0;
});

/**
 * ⚠️ **`run()` lost its `gated` flag at `1d`** — it minted a gate token and set the cookie, and
 * there is nothing to mint. `cookie` replaces it: an explicit header string, used only by the
 * tombstone cases, which are the one remaining reason this proxy cares about a cookie at all.
 */
async function run(
  pathname: string,
  { cookie, inbound = {} }: { cookie?: string; inbound?: Record<string, string> } = {},
) {
  const headers = new Headers();
  if (cookie !== undefined) headers.set('cookie', cookie);
  for (const [name, value] of Object.entries(inbound)) headers.set(name, value);
  const res = await proxy(new NextRequest(new URL(pathname, ORIGIN), { headers }));
  const location = res.headers.get('location');
  return { res, location: location ? new URL(location) : null };
}

/** What the RENDERER will see. `NextResponse.next({ request: { headers } })` encodes each override
 *  as `x-middleware-request-<name>`, which is how the root layout reads `x-nonce` today. */
function forwarded(res: { headers: Headers }, name: string): string | null {
  return res.headers.get(`x-middleware-request-${name}`);
}

describe('the proxy redirects nothing (AUTH-1 1d)', () => {
  // 🔴 One assertion where there were ~24, because there is one behaviour where there were two.
  // A reintroduced redirect here is a LOOP (every path bouncing to a path that bounces), so it is
  // worth pinning even though "no redirect" sounds like asserting an absence.
  // ⚠️ These are not "a stranger is served the app": the proxy never authorized anything, and after
  // `1d` it does not even route. What a caller may SEE is proved per route in
  // `app/pages-are-gated.test.ts` and in the e2e suite.
  it.each([
    '/',
    PRIVACY_PATH,
    APP_HOME_PATH,
    '/p/x',
    '/p/x/routine',
    SIGN_IN_PATH,
    `${SIGN_IN_PATH}/sso-callback`,
    `${SIGN_IN_PATH}evil`,
    `${PRIVACY_PATH}/x`,
    '/api/sync',
    '/%2F',
  ])('passes %s through without a redirect', async (path) => {
    const { location } = await run(path);
    expect(location).toBeNull();
  });

  it('sets the security headers on a public path too', async () => {
    const { res } = await run('/');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });
});

/**
 * 🔴 **The `mp_gate` tombstone (AUTH-1 1d, § Design 3).** Five cases, and the fifth is what makes the
 * other four mean anything.
 *
 * ⚠️ **Count OURS, never theirs.** Clerk builds its handshake with `requestState.headers.forEach(…)`,
 * and `Headers.forEach` COMBINES multi-value headers, so a total `set-cookie` count is vendor-shaped
 * and would drift with a Clerk bump. `getSetCookie()` returns the uncombined array, so filtering it
 * by prefix is assertable — and that count is what catches a double-append if the wrapper is ever
 * nested twice.
 */
describe('the mp_gate tombstone', () => {
  const RETIRED = 'mp_gate';
  const tombstones = (res: { headers: Headers }) =>
    res.headers.getSetCookie().filter((c) => c.startsWith(`${RETIRED}=`));

  /**
   * 🔴 **The value, pinned exactly once, on the assertion side.** This replaces the pin that
   * `lib/access-gate.test.ts` carried before `1d` deleted it. AGENTS.md § Constants sanctions a
   * contract test pinning a const's literal — without it the const and its five uses here could be
   * renamed in lockstep and clear a cookie nobody holds.
   */
  it('clears exactly the cookie the gate set', async () => {
    const { res } = await run('/', { cookie: `${RETIRED}=whatever` });
    expect(tombstones(res)).toHaveLength(1);
    const [tombstone] = tombstones(res);
    expect(tombstone).toContain(`${RETIRED}=;`);
    expect(tombstone).toContain('Max-Age=0');
    // `Path=/` is what the gate action used since V0-4 — a different path would not match the
    // cookie's identity and the deletion would silently do nothing.
    expect(tombstone).toContain('Path=/');
  });

  /**
   * 🔴 **THE case that gives the others meaning.** Without it, deleting the `has()` guard leaves
   * every case above green while every visitor receives a spurious `Set-Cookie` on every matched
   * response. Probed: removing the guard turns this red and nothing else.
   */
  it('sends NO tombstone to a caller who does not hold the cookie', async () => {
    const { res } = await run('/');
    expect(tombstones(res)).toHaveLength(0);
  });

  it('rides on a response Clerk has decorated', async () => {
    clerkConfigured = true;
    const { res } = await run(APP_HOME_PATH, { cookie: `${RETIRED}=x` });
    expect(clerkCalls).toHaveLength(1);
    expect(tombstones(res)).toHaveLength(1);
    // Clerk's own rotated cookie survives alongside it — the tombstone appends, it does not replace.
    expect(res.headers.getSetCookie()).toContain(ROTATED_COOKIE);
  });

  /**
   * 🔴 **The MECHANISM-CHOICE tripwire.** It asserts that the Clerk cookie Clerk appended survives
   * alongside our tombstone.
   * ✅ **Probed RED, and the probe corrected what this comment used to claim.** Swapping
   * `withRetiredCookies`'s `headers.append` for
   * `(response as NextResponse).cookies.delete(RETIRED_GATE_COOKIE)` reddens it — but **not** because
   * the value is re-encoded. Measured: after the swap the header set is exactly
   * `['mp_gate=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT']`. **Clerk's cookie is dropped
   * entirely.** `NextResponse` builds its `ResponseCookies` bag eagerly at construction
   * (`next/dist/server/web/spec-extension/response.js`), so anything appended afterwards is not in
   * the bag that `replace()` re-emits — it is lost, not mangled.
   * ⚠️ An earlier version of this note said the value "comes back `a%2Bb%2Fc%3D%3D`". That is wrong,
   * and it matters: an author who "fixed" the special characters would think they had changed this
   * case's power. The characters are a secondary guard against a future re-encoding implementation;
   * the thing that makes it fail today is that the cookie must be APPENDED, not inbound.
   */
  it('leaves a Clerk cookie containing +, / and = byte-identical', async () => {
    clerkConfigured = true;
    const { res } = await run('/', { cookie: `${RETIRED}=x` });
    expect(res.headers.getSetCookie()).toContain(ROTATED_COOKIE);
    expect(tombstones(res)).toHaveLength(1);
  });

  /**
   * 🔴 **The Clerk HANDSHAKE case, which `withRetiredCookies`'s docblock claimed was pinned and was
   * not.** Clerk builds its handshake with `NextResponse.redirect`, whose headers are MUTABLE.
   * `Response.redirect()`'s are not, and `headers.append` on one throws — which would be a 500 for
   * every visitor still carrying `mp_gate`. This is the case that fails loudly if a Clerk bump
   * switches construction, instead of that landing in production.
   */
  it('rides on a Clerk handshake redirect', async () => {
    clerkConfigured = true;
    clerkReturnsRedirect = true;
    const { res } = await run('/', { cookie: `${RETIRED}=x` });
    expect(res.status).toBe(307);
    expect(tombstones(res)).toHaveLength(1);
  });

  /**
   * 🔴 **The plain-`Response` case — where `withClerk`'s cast is a lie.** `clerkMiddleware` auto-arms
   * a frontend-API proxy branch (production key + matching hostname) and returns a plain `Response`
   * whose `.cookies` is `undefined`. `withRetiredCookies` takes `Response` precisely so this works;
   * a `response.cookies.*` implementation would throw here.
   */
  it('works when Clerk returns a plain Response, not a NextResponse', async () => {
    clerkConfigured = true;
    clerkReturnsPlainResponse = true;
    const { res } = await run('/', { cookie: `${RETIRED}=x` });
    expect(tombstones(res)).toHaveLength(1);
  });
});

/**
 * 🔴 AUTH-1 1a — the CSP widening, pinned by EXACT ORIGIN.
 *
 * This is the policy that protects a public app holding minors' health data, and a vendor origin in
 * `connect-src` is the one security-header change in Beta 0 nobody will ever revisit. So every added
 * source is asserted as a literal, and the absence of a wildcard is asserted directly rather than
 * inferred.
 */
describe('buildCsp', () => {
  const dark = buildCsp('N', false, null);
  const lit = buildCsp('N', false, TEST_FRONTEND_ORIGIN);

  it('is unchanged while Clerk is un-configured — 1a ships dark', () => {
    expect(dark).toBe(
      [
        `default-src 'self'`,
        `script-src 'self' 'nonce-N' 'strict-dynamic'`,
        `style-src 'self' 'nonce-N'`,
        `img-src 'self' blob: data:`,
        `font-src 'self'`,
        `connect-src 'self'`,
        `object-src 'none'`,
        `base-uri 'self'`,
        `form-action 'self'`,
        `frame-ancestors 'none'`,
        `upgrade-insecure-requests`,
      ].join('; '),
    );
  });

  it.each([TEST_FRONTEND_ORIGIN, CLERK_IMG_ORIGIN])('names %s nowhere while dark', (origin) => {
    expect(dark).not.toContain(origin);
  });

  it.each(['frame-src', 'worker-src'])(
    'declares no %s while dark, so it falls through to the tighter default-src',
    (directive) => {
      expect(dark).not.toContain(directive);
    },
  );

  it('puts the Frontend API origin in connect-src, derived from the publishable key', () => {
    expect(lit).toContain(`connect-src 'self' ${TEST_FRONTEND_ORIGIN}`);
  });

  it("puts Clerk's image host in img-src", () => {
    expect(lit).toContain(`img-src 'self' blob: data: ${CLERK_IMG_ORIGIN}`);
  });

  // 🔴 **INVERTED at AUTH-1 1d: there must be NO `frame-src`.** It allowed Cloudflare Turnstile for
  // Clerk's bot protection, which the production instance has OFF — a CSP source admitting an origin
  // nothing renders. Absent, an iframe falls through to `default-src 'self'` and is blocked, which is
  // tighter. Asserted in BOTH states, so re-adding it is a deliberate edit with a test to change.
  it('declares no frame-src in either state — the Turnstile source is removed', () => {
    expect(lit).not.toContain('frame-src');
    expect(dark).not.toContain('frame-src');
  });

  it("declares worker-src for clerk-js's blob: worker", () => {
    expect(lit).toContain(`worker-src 'self' blob:`);
  });

  /**
   * The point of the whole section. A wildcard host, or `https:`/`http:` as a source, is what Clerk's
   * OWN recommended policy ships (`@clerk/nextjs/dist/esm/server/content-security-policy.js`) and what
   * this app refuses to adopt.
   */
  it.each([dark, lit])('contains no wildcard and no scheme-wide source', (csp) => {
    expect(csp).not.toContain('*');
    expect(csp).not.toMatch(/(^|[ ;])https:(\s|;|$)/);
    expect(csp).not.toMatch(/(^|[ ;])http:(\s|;|$)/);
  });

  // `strict-dynamic` makes a browser ignore every host source in `script-src`, so adding the Clerk
  // origin there would be dead weight that reads like a protection. The scripts load on the nonce.
  it('adds no host to script-src, which strict-dynamic would ignore', () => {
    expect(lit).toContain(`script-src 'self' 'nonce-N' 'strict-dynamic'`);
    expect(lit).not.toContain(`script-src 'self' 'nonce-N' 'strict-dynamic' https`);
  });

  /**
   * ⚠️ `style-src` keeps its nonce and gains NOTHING. Under CSP3 a nonce makes `'unsafe-inline'`
   * inert, so "relax style-src for Clerk" means DELETING the nonce for the whole app on every route.
   * Whether Clerk's CDN-shipped UI needs that is not answerable from the lockfile; 1a ships dark, so
   * this assertion is what makes a later widening a deliberate, visible test edit.
   */
  it('never relaxes style-src, in either state', () => {
    expect(lit).toContain(`style-src 'self' 'nonce-N'`);
    expect(lit).not.toContain(`style-src 'self' 'unsafe-inline'`);
    expect(buildCsp('N', true, TEST_FRONTEND_ORIGIN)).toContain(`style-src 'self' 'unsafe-inline'`);
  });

  // Telemetry is off in `next.config.ts`, so there is nothing to allow.
  it('never allows Clerk telemetry', () => {
    expect(lit).not.toContain('clerk-telemetry.com');
  });
});

/**
 * AUTH-1 1a — `clerkMiddleware()` composed INSIDE the proxy. Two properties, both ours:
 * our response is merged rather than replaced, and nothing arms itself while Clerk is un-configured.
 */
describe('Clerk composition', () => {
  it('composes nothing while un-configured — the public landing still renders', async () => {
    const { res, location } = await run('/');
    expect(location).toBeNull();
    expect(clerkCalls).toEqual([]);
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(forwarded(res, 'x-nonce')).not.toBeNull();
  });

  it.each(['/', PRIVACY_PATH, SIGN_IN_PATH])('renders %s with no Clerk keys set', async (path) => {
    const { res, location } = await run(path);
    expect(location).toBeNull();
    expect(res.headers.get('content-security-policy')).toContain("connect-src 'self';");
  });

  it('runs Clerk on the pass-through path once configured', async () => {
    clerkConfigured = true;
    const { res, location } = await run(APP_HOME_PATH);
    expect(location).toBeNull();
    expect(clerkCalls).toHaveLength(1);
    // The merge: a rotated session cookie Clerk appended survives `withSecurityHeaders`. Dropping it
    // presents as a user silently signed out, blamed on Clerk.
    expect(res.headers.getSetCookie()).toContain(ROTATED_COOKIE);
    // … and so do OUR request-header overrides, which the theme script and the footer depend on.
    expect(forwarded(res, 'x-nonce')).not.toBeNull();
    expect(res.headers.get('content-security-policy')).toContain(TEST_FRONTEND_ORIGIN);
  });

  /**
   * 🔴 **INVERTED at `1d`, and the inversion is the whole point of the chunk.** This case asserted
   * that an un-gated caller was bounced WITHOUT invoking Clerk — the gate ran first, a bounced
   * request rendered nothing, so there was no reason to run vendor middleware for a stranger.
   *
   * After `1d` there is no bounce and no pass-through path: Clerk must run on EVERY matched request,
   * because `auth()` throws when `clerkMiddleware()` did not run and `/sign-in` is the only way in.
   * A case asserting Clerk is skipped would now be asserting the bug.
   */
  it('invokes Clerk on a cookie-less request too — there is no pass-through path left', async () => {
    clerkConfigured = true;
    const { location } = await run('/p/x');
    expect(location).toBeNull();
    expect(clerkCalls).toEqual([{ handled: true }]);
  });
});

/**
 * PRIV-2 — the per-request values the proxy hands the renderer. The footer's `aria-current` needs
 * the current pathname in a SERVER component, and `x-nonce` already proves this mechanism works.
 */
describe('forwarded request headers', () => {
  // ⚠️ **The `x-pathname` cases are GONE at AUTH-1 1d, with the header.** They pinned that the proxy
  // forwarded the pathname and overwrote an inbound one. `SiteFooter` reads `usePathname()` now, so
  // the header had no consumer at all; keeping its pins would have been a test guarding plumbing.
  it('overwrites an INBOUND x-nonce', async () => {
    const name = 'x-nonce';
    // `forward()` builds its headers with `new Headers(request.headers)` and then `.set()`s, so a
    // caller cannot inject either value. The worst case of a spoofed pathname is a wrong
    // `aria-current`, not a security property — but the overwrite is the property, so it is pinned.
    const { res } = await run('/p/abc', { inbound: { [name]: 'spoofed' } });
    expect(forwarded(res, name)).not.toBe('spoofed');
  });

  it('mints a fresh nonce per request (the reason /privacy declares no `dynamic` of its own)', async () => {
    const a = await run(PRIVACY_PATH);
    const b = await run(PRIVACY_PATH);
    expect(forwarded(a.res, 'x-nonce')).not.toBe(forwarded(b.res, 'x-nonce'));
  });
});

// Next's own matcher compiler, so the test sees the regex Next actually runs rather than a re-derivation.
// Internal and untyped in the package's .d.ts, hence the require + the one-line shape below.
type MatcherCompiler = (matcher: readonly string[], nextConfig: object) => { regexp: string }[];
const MATCHER_COMPILER = 'next/dist/build/analysis/get-page-static-info';
function loadMatcherCompiler(): MatcherCompiler {
  const mod = createRequire(import.meta.url)(MATCHER_COMPILER) as {
    getMiddlewareMatchers?: MatcherCompiler;
  };
  if (typeof mod.getMiddlewareMatchers !== 'function') {
    // A Next bump moved the internal. This is NOT a gate regression: find the new home of
    // `getMiddlewareMatchers` in node_modules/next/dist and update MATCHER_COMPILER.
    throw new Error(
      `${MATCHER_COMPILER} no longer exports getMiddlewareMatchers (Next internal moved)`,
    );
  }
  return mod.getMiddlewareMatchers;
}
const getMiddlewareMatchers = loadMatcherCompiler();

describe('proxy matcher', () => {
  const [matcher] = getMiddlewareMatchers(config.matcher, {});
  const runsOn = (path: string) => new RegExp(matcher!.regexp).test(path);

  /**
   * 🔴 **SEC-1's regression, pinned by SHAPE (AUTH-1 1d, § Design 2).** SEC-1's hole was a `missing:`
   * header condition on the matcher: any client could send a prefetch header and the proxy would not
   * run on that request AT ALL. Before `1d` the gate bounce made that observable; after `1d` the
   * failure mode is quieter — `auth()` throws when `clerkMiddleware()` did not run, so a route would
   * 500 or refuse every caller, which an e2e spec reads as "redirected to sign-in" and passes.
   *
   * ⚠️ **Asserted on the COMPILED entry, not on `config.matcher`.** The obvious form,
   * `config.matcher.every((m) => typeof m === 'string')`, is a TYPE-LEVEL TAUTOLOGY: `config.matcher`
   * infers as `string[]`, so the predicate is unconditionally true in any tree that typechecks, and
   * it only appears to probe red because Vitest does not typecheck. A header condition requires an
   * OBJECT entry, and `getMiddlewareMatchers` is what turns one into `has`/`missing` fields.
   *
   * This also does not cover re-introducing the exclusion at another layer — an early `return` in
   * `proxy()` keyed on the header. `e2e/landing.spec.ts` → "a prefetch-flagged request still goes
   * through the proxy (SEC-1)" is the runtime witness for that, and it replaces the deleted
   * `e2e/gate-prefetch.spec.ts`. ⚠️ This comment asserted that witness existed before it did.
   */
  it('carries no header condition — a matcher condition decides whether the proxy runs at all', () => {
    expect(matcher).not.toHaveProperty('has');
    expect(matcher).not.toHaveProperty('missing');
  });

  it.each([
    '/',
    '/p',
    '/p/x/routine',
    PRIVACY_PATH,
    `${PRIVACY_PATH}/x`,
    SIGN_IN_PATH,
    `${SIGN_IN_PATH}/sso-callback`,
  ])('runs on %s', (path) => {
    expect(runsOn(path)).toBe(true);
  });

  /**
   * 🔴 AUTH-1 1a removed the `api` exclusion — the "/api matcher hole" `.github/SECURITY.md` named
   * and `docs/tech-debt.md` carried. It was latent rather than live (the export handler sits at
   * `/p/[profileId]/export` for exactly this reason), and 1a had to close it anyway: `auth()` THROWS
   * when `clerkMiddleware()` did not run on the request, so an excluded `/api` handler could not have
   * authenticated at all.
   *
   * ⚠️ This is NOT "the matcher is the boundary". `app/pages-are-gated.test.ts` is, per handler.
   */
  it.each(['/api', '/api/sync', '/api/x/y'])('runs on %s (the /api hole is closed)', (path) => {
    expect(runsOn(path)).toBe(true);
  });

  it.each(['/_next/static/chunk.js', '/_next/image', '/favicon.ico'])(
    'skips %s (Next internals and static assets)',
    (path) => {
      expect(runsOn(path)).toBe(false);
    },
  );

  // Pre-OSS-2 the lookahead was unanchored, so it skipped anything merely STARTING with an exclusion.
  it.each(['/favicon.icon', '/_next/imagex'])(
    'still runs on %s (the exclusion is segment-anchored)',
    (path) => {
      expect(runsOn(path)).toBe(true);
    },
  );
});
