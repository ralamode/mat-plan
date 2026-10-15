import { createRequire } from 'node:module';

import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { GATE_COOKIE_NAME, GATE_PATH, gateTokenFor } from '@/lib/access-gate';
import { APP_HOME_PATH, PRIVACY_PATH } from '@/lib/constants';

import { config, proxy } from './proxy';

/**
 * The proxy's routing (OSS-2) and its matcher. The proxy is NOT the authorization boundary — pages and
 * actions re-check the gate (lib/dal/gate.ts) — but it is what sends a stranger to the landing instead of
 * a password prompt, and the family past both.
 */

const ORIGIN = 'http://localhost:3000';

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

  it.each(['/', '/p', '/gate', '/p/x/routine', PRIVACY_PATH, `${PRIVACY_PATH}/x`])(
    'runs on %s',
    (path) => {
      expect(runsOn(path)).toBe(true);
    },
  );

  it.each(['/api', '/api/x', '/_next/static/chunk.js', '/_next/image', '/favicon.ico'])(
    'skips %s (internals and static assets the gate page itself needs)',
    (path) => {
      expect(runsOn(path)).toBe(false);
    },
  );

  // Pre-OSS-2 the lookahead was unanchored, so it skipped anything merely STARTING with an exclusion.
  it.each(['/apiary', '/apifoo', '/favicon.icon', '/_next/imagex'])(
    'still runs on %s (the exclusion is segment-anchored)',
    (path) => {
      expect(runsOn(path)).toBe(true);
    },
  );
});
