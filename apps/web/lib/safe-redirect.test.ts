import { describe, expect, it } from 'vitest';

import { safeInternalPath } from './safe-redirect';

// Split out of `access-gate.test.ts` by AUTH-1 1a, with the code it covers (lib/safe-redirect.ts).
// The rule outlives the gate: `access-gate.ts` is deleted at 1d, these cases are not.

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
    const out = safeInternalPath('/∕x');
    expect(out).toBe('/%E2%88%95x');
    expect(/^[\x20-\x7e]*$/.test(out)).toBe(true);
  });

  // AUTH-1 1a: the gate bounce now puts `pathname + search` in `?from=`, so the clamp is what makes
  // the query half safe. These are the shapes the proxy can actually produce.
  it.each([
    '/p/019826b4-0000-7000-8000-000000000001/routine?d=2026-09-30',
    '/p/x?a=1&b=2',
    '/sign-in?redirect_url=%2Fp',
  ])('keeps a bounced path+query intact: %s', (value) => {
    expect(safeInternalPath(value)).toBe(value);
  });
});
