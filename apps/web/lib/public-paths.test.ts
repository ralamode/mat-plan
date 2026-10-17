import { describe, expect, it } from 'vitest';

import { PRIVACY_PATH, SIGN_IN_PATH } from './constants';
import { isPublicPath, matchesPathTree, PUBLIC_PATH_TREES, PUBLIC_PATHS } from './public-paths';

// Split out of `access-gate.test.ts` by AUTH-1 1a, with the code it covers (lib/public-paths.ts).
// "Which routes need no session" outlives the gate; `access-gate.ts` is deleted at 1d.

describe('PUBLIC_PATHS / isPublicPath (OSS-2, PRIV-2)', () => {
  it('is exactly the landing and the privacy notice — a third entry is a deliberate edit', () => {
    expect(PUBLIC_PATHS).toEqual(['/', PRIVACY_PATH]);
  });

  // The one place the literal belongs: a consent screen and a footer link both depend on this value.
  it('PRIVACY_PATH is a stable, published URL', () => {
    expect(PRIVACY_PATH).toBe('/privacy');
  });

  // Same: `SIGN_IN_PATH` is the `app/sign-in/` segment, a `<ClerkProvider>` prop and a tree root.
  it('SIGN_IN_PATH is a stable, published URL', () => {
    expect(SIGN_IN_PATH).toBe('/sign-in');
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
   *
   * These rows are also what the SEPARATE tree list protects: AUTH-1 1a's `/sign-in` needed a prefix
   * match, and had the arm been added to `PUBLIC_PATHS` itself, every one of these would have flipped
   * on a PR that has nothing to do with the notice.
   */
  it.each(['/privacyx', '/privacy/', '/privacy/x', '/PRIVACY'])('keeps %j gated', (path) => {
    expect(isPublicPath(path)).toBe(false);
  });
});

describe('PUBLIC_PATH_TREES (AUTH-1 1a)', () => {
  it('is exactly the sign-in tree — a second entry is a deliberate edit', () => {
    expect(PUBLIC_PATH_TREES).toEqual([SIGN_IN_PATH]);
  });

  it.each([SIGN_IN_PATH, `${SIGN_IN_PATH}/sso-callback`, `${SIGN_IN_PATH}/factor-one`])(
    'serves %s without a session (Clerk arrives on children of the catch-all)',
    (path) => {
      expect(isPublicPath(path)).toBe(true);
    },
  );

  /**
   * 🔴 DUALS-1's scar, through `isPublicPath` rather than only through `matchesPathTree`: the arm had
   * to match at a SEGMENT boundary, because `startsWith('/sign-in')` also opens `/sign-inevil`. This
   * row ships in the same commit as the arm, which is the point of it.
   */
  it.each(['/sign-inevil', '/sign-in-evil', '/sign', '/SIGN-IN', '/x/sign-in'])(
    'keeps %j gated',
    (path) => {
      expect(isPublicPath(path)).toBe(false);
    },
  );
});

describe('matchesPathTree', () => {
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
