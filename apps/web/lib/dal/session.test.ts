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
// AUTH-1 1c-3a. Mocked rather than exercised here for the same reason `@/lib/clerk` is: importing
// the real `lib/env.ts` runs its two module-scope guards (OPS-1's database assertion and the bypass
// refusal), which is a different contract with its own file — `lib/env-session-bypass.test.ts`.
const sessionBypassUserId = vi.hoisted(() => vi.fn(() => null as string | null));

vi.mock('@clerk/nextjs/server', () => ({ auth }));
// ⚠️ `unstable_rethrow` must be mocked with REAL behaviour, not stubbed away: the module calls it on
// every caught error, and a stub that did nothing would make the "rethrown" cases silently pass. This
// mirrors Next's own rule — rethrow its control-flow errors, return for anything else.
const unstable_rethrow = vi.hoisted(() => (error: unknown): void => {
  const digest = (error as { digest?: unknown })?.digest;
  if (typeof digest === 'string' && digest.startsWith('DYNAMIC_SERVER_USAGE')) throw error;
  if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')) throw error;
});
vi.mock('next/navigation', () => ({ redirect, unstable_rethrow }));
vi.mock('@/lib/clerk', () => ({ clerkIsConfigured }));
vi.mock('@/lib/env', () => ({ sessionBypassUserId }));
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
    sessionBypassUserId.mockReset();
    sessionBypassUserId.mockReturnValue(null);
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

  it("🔴 Next's prerender-bailout is RETHROWN — it is not 'no session'", async () => {
    clerkIsConfigured.mockReturnValue(true);
    // Swallowed, "this route must render dynamically" would silently become "nobody is signed in",
    // baked into a cached output. `unstable_rethrow` is Next's own list, so this does not
    // hand-maintain a set the framework owns.
    const bailout = Object.assign(new Error('Dynamic server usage'), {
      digest: 'DYNAMIC_SERVER_USAGE',
    });
    auth.mockRejectedValue(bailout);
    await expect(getCurrentUser()).rejects.toThrow();
  });

  it("🔴 Clerk's use-cache error is RETHROWN — it exists to be loud", async () => {
    clerkIsConfigured.mockReturnValue(true);
    // Not exported from any public entry at 7.9.15, so the global-registry symbol is the only honest
    // detector — the same one Clerk's own `isClerkUseCacheError` checks.
    auth.mockRejectedValue(
      Object.assign(new Error('auth() inside "use cache"'), {
        [Symbol.for('clerk_use_cache_error')]: true,
      }),
    );
    await expect(getCurrentUser()).rejects.toThrow();
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

  it('🔴 NO KEYS → requireSession redirects too — the likeliest state right after a deploy', async () => {
    // Production ships with both keys unset until 1c, so this is not a corner: every gated page
    // redirects to a `/sign-in` that itself renders nothing. Fail-closed, which is correct — but it
    // must be proved, not assumed, because it is the state a misconfigured deploy lands in.
    clerkIsConfigured.mockReturnValue(false);
    await expect(requireSession()).rejects.toThrow(`REDIRECT:${SIGN_IN_PATH}`);
    expect(auth).not.toHaveBeenCalled();
  });

  it('requireSession returns the principal when there is one', async () => {
    clerkIsConfigured.mockReturnValue(true);
    auth.mockResolvedValue({ userId: 'user_abc' });
    expect(await requireSession()).toEqual({ userId: 'user_abc' });
    expect(redirect).not.toHaveBeenCalled();
  });
});

/**
 * AUTH-1 1c-3a — the test session seam, from the principal's side.
 *
 * Whether the bypass may ARM at all is `lib/env.ts`'s contract and is proved in
 * `lib/env-session-bypass.test.ts`. What matters here is narrower and still worth pinning: when the
 * armer hands back an id, this module returns it **and never reaches Clerk** — because the harness
 * runs with no keys and `e2e/theme.spec.ts` asserts, one-way, that no Clerk host is contacted.
 */
describe('getCurrentUser — the test session bypass (AUTH-1 1c-3a)', () => {
  beforeEach(() => {
    auth.mockReset();
    clerkIsConfigured.mockReset();
    sessionBypassUserId.mockReset();
  });

  it('an armed bypass is the principal, and `auth()` is never called', async () => {
    sessionBypassUserId.mockReturnValue('user_000000000000000000000000e2e');
    // Configured deliberately: the bypass must win even where Clerk COULD have answered, or the
    // harness would silently depend on keys being absent rather than on the seam.
    clerkIsConfigured.mockReturnValue(true);

    expect(await getCurrentUser()).toEqual({ userId: 'user_000000000000000000000000e2e' });
    expect(auth).not.toHaveBeenCalled();
  });

  it('a disarmed bypass changes nothing — the real path still runs', async () => {
    // The case that matters in production, where `sessionBypassUserId()` always answers null.
    sessionBypassUserId.mockReturnValue(null);
    clerkIsConfigured.mockReturnValue(true);
    auth.mockResolvedValue({ userId: 'user_real' });

    expect(await getCurrentUser()).toEqual({ userId: 'user_real' });
    expect(auth).toHaveBeenCalled();
  });

  it('a disarmed bypass does not rescue a missing session', async () => {
    sessionBypassUserId.mockReturnValue(null);
    clerkIsConfigured.mockReturnValue(true);
    auth.mockResolvedValue({ userId: null });

    expect(await getCurrentUser()).toBeNull();
  });
});
