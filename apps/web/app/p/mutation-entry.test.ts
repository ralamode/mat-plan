import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NO_PROFILE_LOG, NO_PROFILE_SAVE, RATE_LIMITED } from '@/lib/constants';

import { enterMutation } from './mutation-entry';

const sessionUserOrNull = vi.hoisted(() => vi.fn());
const checkMutationLimit = vi.hoisted(() => vi.fn());
const addBreadcrumb = vi.hoisted(() => vi.fn());

// `household.test.ts`'s idiom, and not a preference: an ESM namespace is not configurable, so
// spying on the export throws outright. This file reaches only `addBreadcrumb`.
vi.mock('@sentry/nextjs', () => ({ addBreadcrumb }));

vi.mock('@/lib/dal/session', () => ({ sessionUserOrNull }));
vi.mock('@/lib/rate-limit', () => ({ checkMutationLimit }));

const USER_ID = 'user_wellShapedButNotTheFixture00';

beforeEach(() => {
  vi.clearAllMocks();
  sessionUserOrNull.mockResolvedValue({ userId: USER_ID });
  checkMutationLimit.mockResolvedValue({ allowed: true, reason: 'ok' });
});

/**
 * `actions.test.ts` covers this function THROUGH the seven actions — the refusal bytes, the writers
 * never reached, `getProfileByPublicId` never called. What it cannot reach is the fail-open branch:
 * `checkMutationLimit` never answers `limiter-error` under vitest, because `mutationLimiter` is
 * always `null` there. That branch is new code on the path that is silent by construction, so it
 * gets a direct test. (AUTH-1 1c-3b; the gap was found by review on #323.)
 *
 * ⚠️ **At `1d` the gate conjunct and its two cases are gone.** `enterMutation` now checks a
 * session, then the limiter. The ORDERING claim survives and is what the first case below pins;
 * what disappeared is a check that never identified a caller.
 */
describe('enterMutation — the branches the action suites cannot reach', () => {
  it('🔴 a DEAD limiter lets the write through, and leaves a breadcrumb saying so', async () => {
    // Fail-open is the deliberate choice — a limiter outage must not stop a kid logging on the gym
    // floor — but a PERMANENTLY dead limiter is otherwise completely silent, which is how an
    // unprotected surface looks exactly like a protected one. Both halves are the claim.
    checkMutationLimit.mockResolvedValue({ allowed: true, reason: 'limiter-error' });

    const entry = await enterMutation(NO_PROFILE_LOG);

    expect(entry).toEqual({ ok: true, userId: USER_ID });
    expect(addBreadcrumb).toHaveBeenCalledTimes(1);
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'rate-limit',
        level: 'warning',
        message: 'mutation limiter unavailable',
      }),
    );
  });

  it('a HEALTHY limiter leaves no breadcrumb — otherwise the signal is every request', async () => {
    // ⚠️ The return value as well: "no breadcrumb" alone is satisfied by ANY early refusal, so a
    // regression that never reached the limiter would pass this test silently.
    expect(await enterMutation(NO_PROFILE_LOG)).toEqual({ ok: true, userId: USER_ID });
    expect(addBreadcrumb).not.toHaveBeenCalled();
  });

  it('the limiter is keyed on the PRINCIPAL, never on anything the caller supplied', async () => {
    await enterMutation(NO_PROFILE_LOG);
    expect(checkMutationLimit).toHaveBeenCalledWith(USER_ID);
  });

  it('refuses before asking the limiter anything when there is no session', async () => {
    // 🔴 The ordering claim, from the behavioural side: an unauthenticated flood must cost zero
    // Redis and zero DB work. ⚠️ At `1d` this is the ONLY remaining ordering case — the gate's
    // "refuses before asking for a session" went with the gate, and the limiter is still last.
    sessionUserOrNull.mockResolvedValue(null);
    expect(await enterMutation(NO_PROFILE_LOG)).toEqual({ ok: false, error: NO_PROFILE_LOG });
    expect(checkMutationLimit).not.toHaveBeenCalled();
  });

  it('returns the CALLER’s refusal copy, so the routine editor can say "save"', async () => {
    // Why `refusal` is a parameter rather than a constant inside the helper: the editor's string is
    // not the logger's, and the helper cannot know which caller it is serving.
    sessionUserOrNull.mockResolvedValue(null);
    expect(await enterMutation(NO_PROFILE_SAVE)).toEqual({ ok: false, error: NO_PROFILE_SAVE });
  });

  it('a rate limit does NOT borrow the not-found copy', async () => {
    // The 404-never-403 argument covers "no session" and "wrong household". A rate limit
    // is not that class of refusal: it is actionable, and saying "No profile found to log against"
    // to a kid mid-session would be false as well as useless.
    checkMutationLimit.mockResolvedValue({ allowed: false, reason: 'limited' });
    expect(await enterMutation(NO_PROFILE_LOG)).toEqual({ ok: false, error: RATE_LIMITED });
    expect(RATE_LIMITED).not.toBe(NO_PROFILE_LOG);
  });
});
