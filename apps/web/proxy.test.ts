import { createRequire } from 'node:module';

import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { GATE_COOKIE_NAME, GATE_PATH, gateTokenFor } from '@/lib/access-gate';
import { APP_HOME_PATH } from '@/lib/constants';

import { config, proxy } from './proxy';

/**
 * The proxy's routing (OSS-2) and its matcher. The proxy is NOT the authorization boundary — pages and
 * actions re-check the gate (lib/dal/gate.ts) — but it is what sends a stranger to the landing instead of
 * a password prompt, and the family past both.
 */

const ORIGIN = 'http://localhost:3000';

async function run(pathname: string, { gated }: { gated: boolean }) {
  const headers = new Headers();
  if (gated) {
    const token = await gateTokenFor(process.env.ACCESS_GATE_PASSWORD ?? '');
    headers.set('cookie', `${GATE_COOKIE_NAME}=${token}`);
  }
  const res = await proxy(new NextRequest(new URL(pathname, ORIGIN), { headers }));
  const location = res.headers.get('location');
  return { res, location: location ? new URL(location) : null };
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

  it.each(['/', '/p', '/gate', '/p/x/routine'])('runs on %s', (path) => {
    expect(runsOn(path)).toBe(true);
  });

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
