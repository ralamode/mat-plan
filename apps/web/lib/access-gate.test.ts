import { describe, expect, it } from 'vitest';

import {
  GATE_COOKIE_NAME,
  gateTokenFor,
  isPublicPath,
  isUngatedPath,
  isValidGateCookie,
  matchesPathTree,
  PUBLIC_PATH_TREES,
  PUBLIC_PATHS,
  safeInternalPath,
} from './access-gate';
import { PRIVACY_PATH } from './constants';

// First tests on the harness (pulled forward ahead of V0-8). The access-gate
// helpers are pure and security-relevant, so they make a good first target:
// a wrong or absent cookie must never validate.

describe('gateTokenFor', () => {
  it('is deterministic for the same code', async () => {
    expect(await gateTokenFor('correct horse')).toBe(await gateTokenFor('correct horse'));
  });

  it('produces a 64-char SHA-256 hex digest', async () => {
    expect(await gateTokenFor('anything')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('derives different tokens for different codes', async () => {
    expect(await gateTokenFor('code-a')).not.toBe(await gateTokenFor('code-b'));
  });

  it('never echoes the raw code in the token', async () => {
    const code = 'super-secret-code';
    expect(await gateTokenFor(code)).not.toContain(code);
  });
});

describe('isValidGateCookie', () => {
  const code = 'household-code-2026';

  it('accepts the cookie derived from the current code', async () => {
    expect(await isValidGateCookie(await gateTokenFor(code), code)).toBe(true);
  });

  it('rejects a cookie derived from a different code', async () => {
    expect(await isValidGateCookie(await gateTokenFor('stale-code'), code)).toBe(false);
  });

  it.each([undefined, '', 'deadbeef', 'not-a-token'])(
    'rejects a missing/garbage cookie: %j',
    async (value) => {
      expect(await isValidGateCookie(value, code)).toBe(false);
    },
  );
});

describe('GATE_COOKIE_NAME', () => {
  it('is a stable contract shared by the proxy and the Server Action', () => {
    expect(GATE_COOKIE_NAME).toBe('mp_gate');
  });
});

describe('PUBLIC_PATHS / isPublicPath (OSS-2, PRIV-2)', () => {
  it('is exactly the landing and the privacy notice — a third entry is a deliberate edit', () => {
    expect(PUBLIC_PATHS).toEqual(['/', PRIVACY_PATH]);
  });

  // The one place the literal belongs: a consent screen and a footer link both depend on this value.
  it('PRIVACY_PATH is a stable, published URL', () => {
    expect(PRIVACY_PATH).toBe('/privacy');
  });

  it.each(['/', PRIVACY_PATH])('treats %s as public', (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  // Exact membership: each of these would slip through a careless prefix or normalising match.
  it.each(['/p', '/gate', '/profile', '//', '/%2F', '/ ', ''])('keeps %j gated', (path) => {
    expect(isPublicPath(path)).toBe(false);
  });

  /**
   * PRIV-2's four neighbours of `/privacy`. ⚠️ `/privacy/` never reaches here over HTTP — Next's
   * trailing-slash redirect 308s it to `/privacy` BEFORE the proxy runs — so the end-to-end claim
   * is "canonicalises", proven in `e2e/privacy.spec.ts`. This is the unit-level half.
   */
  it.each(['/privacyx', '/privacy/', '/privacy/x', '/PRIVACY'])('keeps %j gated', (path) => {
    expect(isPublicPath(path)).toBe(false);
  });

  it('has no public subtrees yet — AUTH-1 1a adds /sign-in HERE, not to PUBLIC_PATHS', () => {
    // Both PUBLIC_PATHS entries are leaves. 1a's arm is committed as generic, which would make
    // `/privacy/x` public and flip the row above; the opt-in list is what keeps that from happening
    // by accident, and pinning its emptiness makes adding an entry a visible test edit.
    expect(PUBLIC_PATH_TREES).toEqual([]);
  });
});

describe('matchesPathTree (tested BEFORE any entry needs it)', () => {
  it.each([
    ['/sign-in', '/sign-in'],
    ['/sign-in', '/sign-in/callback'],
    ['/sign-in', '/sign-in/sso/x'],
  ])('%s owns %s', (root, path) => {
    expect(matchesPathTree(root, path)).toBe(true);
  });

  // DUALS-1's scar: `startsWith('/x')` also opens `/xsecret`. The match is at a SEGMENT boundary.
  it.each([
    ['/sign-in', '/sign-inevil'],
    ['/sign-in', '/sign-in-evil'],
    ['/sign-in', '/'],
    ['/sign-in', '/sign'],
    ['/privacy', '/privacyx'],
  ])('%s does not own %s', (root, path) => {
    expect(matchesPathTree(root, path)).toBe(false);
  });
});

describe('isUngatedPath', () => {
  it.each(['/', '/gate', PRIVACY_PATH])('serves %s without the cookie', (path) => {
    expect(isUngatedPath(path)).toBe(true);
  });

  it.each(['/p', '/gatex', '/gate/x', '/p/x', '/privacyx'])('gates %s', (path) => {
    expect(isUngatedPath(path)).toBe(false);
  });
});

describe('safeInternalPath (open-redirect / XSS guard)', () => {
  it('passes through a same-origin absolute path unchanged', () => {
    expect(safeInternalPath('/today')).toBe('/today');
  });

  it('preserves a query string on an internal path', () => {
    expect(safeInternalPath('/log?tab=strength')).toBe('/log?tab=strength');
  });

  // Anything that could escape the origin (or isn't an absolute internal path)
  // must fall back to the site root — never become an open redirect / XSS sink.
  it.each([
    ['a protocol-relative host', '//evil.com'],
    ['an absolute https URL', 'https://evil.com'],
    ['an absolute http URL', 'http://evil.com/steal'],
    ['a relative path (no leading slash)', 'evil.com'],
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
    // SEC-4: a leading single slash is not enough. The URL parser treats `\\` as `/` and drops
    // tab/CR/LF, so those resolve to another origin; dot segments normalize to a `//` pathname
    // that Next's client router would push as scheme-relative. The `%2F` cases stay on-origin
    // in a browser — rejected conservatively, not because they escape.
    ['a backslash after the slash', '/\\evil.com'],
    ['a percent-encoded backslash', '/%5Cevil.com'],
    ['a tab between the slashes', '/\t/evil.com'],
    ['a newline between the slashes', '/\n/evil.com'],
    ['a percent-encoded second slash', '/%2F%2Fevil.com'],
    ['a percent-encoded slash pair', '/%2f/evil.com'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a malformed escape', '/%E0%A4%A'],
    ['a dot segment before a double slash', '/.//evil.com'],
    ['a parent segment before a double slash', '/..//evil.com'],
  ])('clamps %s to the root', (_label, value) => {
    expect(safeInternalPath(value)).toBe('/');
  });

  it.each([
    ['the root', '/'],
    ['a profile page', '/p/019826b4-0000-7000-8000-000000000001'],
    ['a dated routine page', '/p/019826b4-0000-7000-8000-000000000001/routine?d=2026-09-30'],
    ['an encoded space', '/p/a%20b'],
    [
      'a dated routine page with a fragment',
      '/p/019826b4-0000-7000-8000-000000000001/routine?d=2026-09-30#x',
    ],
  ])('keeps %s', (_label, value) => {
    expect(safeInternalPath(value)).toBe(value);
  });

  // Whatever survives, it never starts with `//` — a mid-path `..//` normalizes to an on-origin
  // `/p//…`, which is harmless; only a LEADING `//` is scheme-relative.
  it.each(['/a/..//evil.com', '/p/a/..//evil.com', '/./p//x', '/p/..//p/x'])(
    'never returns a leading // for %s',
    (value) => {
      expect(safeInternalPath(value).startsWith('//')).toBe(false);
    },
  );

  // The target is written into a response header (`x-action-redirect`), which rejects raw
  // non-ASCII — so it must come back percent-encoded, still on the same path.
  it('returns non-ASCII characters percent-encoded', () => {
    const out = safeInternalPath('/\u2215x');
    expect(out).toBe('/%E2%88%95x');
    expect(/^[\x20-\x7e]*$/.test(out)).toBe(true);
  });
});
