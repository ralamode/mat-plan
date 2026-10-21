import { createRequire } from 'node:module';

import { NextRequest, type NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GATE_COOKIE_NAME, GATE_PATH, gateTokenFor } from '@/lib/access-gate';
import { CLERK_BOT_PROTECTION_ORIGIN, CLERK_IMG_ORIGIN } from '@/lib/clerk';
import { APP_HOME_PATH, PRIVACY_PATH, SIGN_IN_PATH } from '@/lib/constants';

import { buildCsp, config, proxy } from './proxy';

/**
 * The proxy's routing (OSS-2) and its matcher. The proxy is NOT the authorization boundary — pages and
 * actions re-check the gate (lib/dal/gate.ts) — but it is what sends a stranger to the landing instead of
 * a password prompt, and the family past both.
 *
 * AUTH-1 1a adds three things it is the only place to prove: the CSP widening by exact origin, that
 * `clerkMiddleware()` is composed without replacing our response, and that none of it arms itself
 * while Clerk is un-configured.
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
 * `@clerk/nextjs@7.9.15`'s `clerkMiddleware.js`: it calls the handler, and
 * `handlerResult = userHandlerResult || NextResponse.next()` — so OUR response is the one decorated.
 * It then appends a rotated session cookie the way `requestState.headers.forEach(… append)` does.
 *
 * ⚠️ This pins OUR half of the contract (we pass a handler; we do not discard what comes back). It
 * cannot pin the VENDOR's half — a future `@clerk/nextjs` that ignores the handler's response would
 * pass this test, which is why AGENTS.md wants a Clerk bump treated as its own reviewed PR.
 */
const ROTATED_COOKIE = '__session=rotated; Path=/; HttpOnly';
const clerkCalls: { handled: boolean }[] = [];
vi.mock('@clerk/nextjs/server', () => ({
  clerkMiddleware:
    (handler: () => NextResponse) =>
    async (_request: unknown, _event: unknown): Promise<NextResponse> => {
      clerkCalls.push({ handled: true });
      const res = handler();
      res.headers.append('set-cookie', ROTATED_COOKIE);
      return res;
    },
}));

beforeEach(() => {
  clerkConfigured = false;
  clerkCalls.length = 0;
});

async function run(
  pathname: string,
  { gated, inbound = {} }: { gated: boolean; inbound?: Record<string, string> },
) {
  const headers = new Headers();
  if (gated) {
    const token = await gateTokenFor(process.env.ACCESS_GATE_PASSWORD ?? '');
    headers.set('cookie', `${GATE_COOKIE_NAME}=${token}`);
  }
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

describe('proxy routing', () => {
  it('serves the public landing to an un-gated caller', async () => {
    const { location } = await run('/', { gated: false });
    expect(location).toBeNull();
  });

  it('sends a gated caller on / straight to the app home', async () => {
    const { location } = await run('/', { gated: true });
    expect(location?.pathname).toBe(APP_HOME_PATH);
  });

  it('sends a gated caller on the gate to the app home', async () => {
    const { location } = await run(GATE_PATH, { gated: true });
    expect(location?.pathname).toBe(APP_HOME_PATH);
  });

  // The pass-through branches: a regression here is a redirect LOOP (`/gate` → `/gate`, `/p` → `/p`).
  it('serves the gate itself to an un-gated caller', async () => {
    const { location } = await run(GATE_PATH, { gated: false });
    expect(location).toBeNull();
  });

  it.each([APP_HOME_PATH, '/p/x', '/p/x/routine'])('serves %s to a gated caller', async (path) => {
    const { location } = await run(path, { gated: true });
    expect(location).toBeNull();
  });

  // `//` is not here: Next redirects repeated slashes BEFORE the proxy runs (resolve-routes), so the
  // proxy never sees one.
  it.each([APP_HOME_PATH, '/p/some-profile', '/profile', '/%2F', '/%20'])(
    'bounces un-gated %s to the gate with ?from=',
    async (path) => {
      const { location } = await run(path, { gated: false });
      expect(location?.pathname).toBe(GATE_PATH);
      expect(location?.searchParams.get('from')).toBe(new URL(path, ORIGIN).pathname);
    },
  );

  it('sets the security headers on the public landing too', async () => {
    const { res } = await run('/', { gated: false });
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  // PRIV-2. The notice is the SECOND public path, and the only one that must be served to BOTH a
  // stranger and the family: the authed-redirect arm is `pathname === '/'` precisely so a future
  // public path does not bounce into the app.
  it('serves the privacy notice to an un-gated caller', async () => {
    const { location } = await run(PRIVACY_PATH, { gated: false });
    expect(location).toBeNull();
  });

  it('serves the privacy notice to a GATED caller too — it does not bounce to the app', async () => {
    const { location } = await run(PRIVACY_PATH, { gated: true });
    expect(location).toBeNull();
  });

  it.each([`${PRIVACY_PATH}x`, `${PRIVACY_PATH}/x`, '/PRIVACY'])(
    'still bounces un-gated %s to the gate',
    async (path) => {
      const { location } = await run(path, { gated: false });
      expect(location?.pathname).toBe(GATE_PATH);
    },
  );

  // AUTH-1 1a. The sign-in tree is the first entry in `PUBLIC_PATH_TREES`: the gate bounce does
  // `url.search = ''`, so a gated `/sign-in/...` would lose every Clerk handshake parameter — a loop,
  // not a flow — and Clerk's prebuilt page cannot await `requireGatedPage()`.
  it.each([SIGN_IN_PATH, `${SIGN_IN_PATH}/sso-callback`, `${SIGN_IN_PATH}/factor-one`])(
    'serves %s to an un-gated caller',
    async (path) => {
      const { location } = await run(path, { gated: false });
      expect(location).toBeNull();
    },
  );

  it('serves the sign-in screen to a GATED caller too — it does not bounce to the app', async () => {
    const { location } = await run(SIGN_IN_PATH, { gated: true });
    expect(location).toBeNull();
  });

  // The segment boundary, end to end: the tree arm must not open a neighbouring path.
  it.each([`${SIGN_IN_PATH}evil`, `${SIGN_IN_PATH}-evil`, '/SIGN-IN'])(
    'still bounces un-gated %s to the gate',
    async (path) => {
      const { location } = await run(path, { gated: false });
      expect(location?.pathname).toBe(GATE_PATH);
    },
  );

  /**
   * AUTH-1 1a — `?from=` carries the QUERY STRING, not the pathname alone. It used to be the
   * pathname, with `url.search = ''` discarding the rest, so a gated `/p/x/routine?d=2026-09-30` came
   * back from the gate as a bare `/p/x/routine` — silently the wrong day. `safeInternalPath` (which
   * both the gate page and the gate action clamp through) already preserves a query string.
   */
  it("preserves an un-gated caller's query string in ?from=", async () => {
    const { location } = await run('/p/x/routine?d=2026-09-30&tab=strength', { gated: false });
    expect(location?.pathname).toBe(GATE_PATH);
    expect(location?.searchParams.get('from')).toBe('/p/x/routine?d=2026-09-30&tab=strength');
    // And nothing else rides along on the gate URL.
    expect([...location!.searchParams.keys()]).toEqual(['from']);
  });

  // 1a removed the `api` matcher exclusion, so `/api/...` now reaches this function — and an un-gated
  // caller must be bounced there like anywhere else rather than served.
  it.each(['/api', '/api/sync'])('bounces un-gated %s to the gate', async (path) => {
    const { location } = await run(path, { gated: false });
    expect(location?.pathname).toBe(GATE_PATH);
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

  it.each([TEST_FRONTEND_ORIGIN, CLERK_IMG_ORIGIN, CLERK_BOT_PROTECTION_ORIGIN])(
    'names %s nowhere while dark',
    (origin) => {
      expect(dark).not.toContain(origin);
    },
  );

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

  it('declares frame-src for the bot-protection widget', () => {
    expect(lit).toContain(`frame-src 'self' ${CLERK_BOT_PROTECTION_ORIGIN}`);
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
    const { res, location } = await run('/', { gated: false });
    expect(location).toBeNull();
    expect(clerkCalls).toEqual([]);
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(forwarded(res, 'x-nonce')).not.toBeNull();
  });

  it.each(['/', PRIVACY_PATH, SIGN_IN_PATH])('renders %s with no Clerk keys set', async (path) => {
    const { res, location } = await run(path, { gated: false });
    expect(location).toBeNull();
    expect(res.headers.get('content-security-policy')).toContain("connect-src 'self';");
  });

  it('runs Clerk on the pass-through path once configured', async () => {
    clerkConfigured = true;
    const { res, location } = await run(APP_HOME_PATH, { gated: true });
    expect(location).toBeNull();
    expect(clerkCalls).toHaveLength(1);
    // The merge: a rotated session cookie Clerk appended survives `withSecurityHeaders`. Dropping it
    // presents as a user silently signed out, blamed on Clerk.
    expect(res.headers.getSetCookie()).toContain(ROTATED_COOKIE);
    // … and so do OUR request-header overrides, which the theme script and the footer depend on.
    expect(forwarded(res, 'x-nonce')).not.toBeNull();
    expect(forwarded(res, 'x-pathname')).toBe(APP_HOME_PATH);
    expect(res.headers.get('content-security-policy')).toContain(TEST_FRONTEND_ORIGIN);
  });

  // Order: the gate runs FIRST. A bounced request renders nothing, so nothing can call `auth()` and
  // there is no reason to run vendor middleware for an un-gated stranger while the gate is still the
  // only boundary. The regression this guards is the other half: Clerk composition must not swallow
  // the bounce, which would be the "app is open" failure mode of this whole plan.
  it('still bounces an un-gated caller, without invoking Clerk', async () => {
    clerkConfigured = true;
    const { location } = await run('/p/x', { gated: false });
    expect(location?.pathname).toBe(GATE_PATH);
    expect(clerkCalls).toEqual([]);
  });
});

/**
 * PRIV-2 — the per-request values the proxy hands the renderer. The footer's `aria-current` needs
 * the current pathname in a SERVER component, and `x-nonce` already proves this mechanism works.
 */
describe('forwarded request headers', () => {
  it.each([PRIVACY_PATH, '/p/abc'])('forwards the pathname for %s', async (path) => {
    const { res } = await run(path, { gated: true });
    expect(forwarded(res, 'x-pathname')).toBe(path);
  });

  it.each(['x-pathname', 'x-nonce'])('overwrites an INBOUND %s', async (name) => {
    // `forward()` builds its headers with `new Headers(request.headers)` and then `.set()`s, so a
    // caller cannot inject either value. The worst case of a spoofed pathname is a wrong
    // `aria-current`, not a security property — but the overwrite is the property, so it is pinned.
    const { res } = await run('/p/abc', { gated: true, inbound: { [name]: 'spoofed' } });
    expect(forwarded(res, name)).not.toBe('spoofed');
  });

  it('mints a fresh nonce per request (the reason /privacy declares no `dynamic` of its own)', async () => {
    const a = await run(PRIVACY_PATH, { gated: false });
    const b = await run(PRIVACY_PATH, { gated: false });
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

  it.each([
    '/',
    '/p',
    '/gate',
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
    'skips %s (internals and static assets the gate page itself needs)',
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
