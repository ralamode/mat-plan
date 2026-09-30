import { describe, expect, it } from 'vitest';

import { GATE_COOKIE_NAME, gateTokenFor, isValidGateCookie, safeInternalPath } from './access-gate';

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
  ])('clamps %s to the root', (_label, value) => {
    expect(safeInternalPath(value)).toBe('/');
  });
});
