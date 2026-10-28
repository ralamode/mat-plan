import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SIGN_IN_PATH } from '@/lib/constants';

/**
 * AUTH-1 1c-1 — the principal's FAIL-CLOSED contract, which is the whole reason this module lands
 * alone and dark. Once `1c-3` switches eleven call sites onto it, every one of them inherits
 * whatever this file does or does not prove.
 *
 * The three states that must not be confused: no keys, no session, and `auth()` THREW. All three
 * answer `null` — "a caller that cannot distinguish them cannot get the distinction wrong" — and the
 * third is the one a reviewer should look hardest at, because a module that lets a throw escape
 * turns a missed middleware matcher into an open door rather than a closed one.
 */

const auth = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);
const clerkIsConfigured = vi.hoisted(() => vi.fn());

vi.mock('@clerk/nextjs/server', () => ({ auth }));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/lib/clerk', () => ({ clerkIsConfigured }));
// `cache()` is React's per-request memo; in a unit test it must be the identity wrapper, or every
// case after the first would read the first one's answer and the suite would pass vacuously.
vi.mock('react', async (orig) => ({
  ...(await orig<typeof import('react')>()),
  cache: <T>(fn: T) => fn,
}));

const { getCurrentUser, sessionUserOrNull, requireSession } = await import('./session');

describe('getCurrentUser — fails closed, three ways (AUTH-1 1c-1)', () => {
  beforeEach(() => {
    auth.mockReset();
    redirect.mockClear();
    clerkIsConfigured.mockReset();
  });

  it('no Clerk keys → null, and `auth()` is never called', async () => {
    clerkIsConfigured.mockReturnValue(false);
    expect(await getCurrentUser()).toBeNull();
    // The point of checking `clerkIsConfigured()` FIRST: with no keys `clerkMiddleware()` never ran,
    // so `auth()` would throw on every request. Not calling it is the cheaper identical answer.
    expect(auth).not.toHaveBeenCalled();
  });

  it('configured but no session → null', async () => {
    clerkIsConfigured.mockReturnValue(true);
    auth.mockResolvedValue({ userId: null });
    expect(await getCurrentUser()).toBeNull();
  });

  it('🔴 `auth()` THREW → null, not a thrown error', async () => {
    clerkIsConfigured.mockReturnValue(true);
    auth.mockRejectedValue(new Error('clerkMiddleware() did not run on this request'));
    // If this rethrew, a route the middleware matcher misses would 500 instead of refusing — and a
    // 500 on a Server Action surfaces as the error boundary, not as a refusal. SEC-1's lesson is
    // that the matcher is not the boundary; this is that lesson as a test.
    expect(await getCurrentUser()).toBeNull();
  });

  it('a real session → the principal', async () => {
    clerkIsConfigured.mockReturnValue(true);
    auth.mockResolvedValue({ userId: 'user_abc' });
    expect(await getCurrentUser()).toEqual({ userId: 'user_abc' });
  });
});

describe('the two refusals (AUTH-1 1c-1)', () => {
  beforeEach(() => {
    auth.mockReset();
    redirect.mockClear();
    clerkIsConfigured.mockReset();
  });

  it('sessionUserOrNull returns the PRINCIPAL, not a boolean — the limiter needs the id', async () => {
    clerkIsConfigured.mockReturnValue(true);
    auth.mockResolvedValue({ userId: 'user_abc' });
    const user = await sessionUserOrNull();
    // A boolean here would force all seven actions to call getCurrentUser() a second time for the
    // key they had just proved exists, and the source guard would match the weaker of the two calls.
    expect(user).toEqual({ userId: 'user_abc' });
  });

  it('sessionUserOrNull does NOT redirect — an action returns its typed envelope', async () => {
    clerkIsConfigured.mockReturnValue(true);
    auth.mockResolvedValue({ userId: null });
    expect(await sessionUserOrNull()).toBeNull();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('requireSession redirects to the sign-in path, by the shared const', async () => {
    clerkIsConfigured.mockReturnValue(true);
    auth.mockResolvedValue({ userId: null });
    await expect(requireSession()).rejects.toThrow(`REDIRECT:${SIGN_IN_PATH}`);
    expect(redirect).toHaveBeenCalledWith(SIGN_IN_PATH);
  });

  it('requireSession returns the principal when there is one', async () => {
    clerkIsConfigured.mockReturnValue(true);
    auth.mockResolvedValue({ userId: 'user_abc' });
    expect(await requireSession()).toEqual({ userId: 'user_abc' });
    expect(redirect).not.toHaveBeenCalled();
  });
});
