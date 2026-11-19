import { TRANSPORT_REFUSALS, type ProgramResult, type RowResult } from '@mat-plan/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NO_PROFILE_LOG, NO_PROFILE_SAVE, RATE_LIMITED } from '@/lib/constants';
import { MUTATION_RATE_LIMIT, ROW_WRITE_RATE_LIMIT } from '@/lib/rate-limit';

import { enterMutation } from './mutation-entry';

const sessionUserOrNull = vi.hoisted(() => vi.fn());
const checkMutationLimit = vi.hoisted(() => vi.fn());
const reportLimiterUnavailable = vi.hoisted(() => vi.fn());

vi.mock('@/lib/dal/session', () => ({ sessionUserOrNull }));
// 🔴 A PARTIAL mock since FAM-1 step 0b: only the check is replaced. `enterMutation` now reads
// `MUTATION_RATE_LIMIT` for its default policy, and the cases below compare against the real consts,
// so re-typing them into a factory here would be a second copy of the numbers under test.
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  checkMutationLimit,
  // The report itself (event once per process) is `rate-limit.test.ts`'s; here, that it is called.
  reportLimiterUnavailable,
}));

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
  it('🔴 a DEAD limiter lets the write through, and reports it', async () => {
    // Fail-open is the deliberate choice — a limiter outage must not stop a kid logging on the gym
    // floor — but a PERMANENTLY dead limiter is otherwise completely silent, which is how an
    // unprotected surface looks exactly like a protected one. Both halves are the claim.
    checkMutationLimit.mockResolvedValue({ allowed: true, reason: 'limiter-error' });

    const entry = await enterMutation(NO_PROFILE_LOG);

    expect(entry).toEqual({ ok: true, userId: USER_ID });
    expect(reportLimiterUnavailable).toHaveBeenCalledTimes(1);
    expect(reportLimiterUnavailable).toHaveBeenCalledWith('mutation');
  });

  it('a HEALTHY limiter reports nothing — otherwise the signal is every request', async () => {
    // ⚠️ The return value as well: "no breadcrumb" alone is satisfied by ANY early refusal, so a
    // regression that never reached the limiter would pass this test silently.
    expect(await enterMutation(NO_PROFILE_LOG)).toEqual({ ok: true, userId: USER_ID });
    expect(reportLimiterUnavailable).not.toHaveBeenCalled();
  });

  it('the limiter is keyed on the PRINCIPAL, never on anything the caller supplied', async () => {
    await enterMutation(NO_PROFILE_LOG);
    // ⚠️ The second argument is new at FAM-1 step 0b, and asserting it makes this case stricter than
    // it was: a caller that names no policy is counted against the DEFAULT one, by identity.
    expect(checkMutationLimit).toHaveBeenCalledTimes(1);
    expect(checkMutationLimit).toHaveBeenCalledWith(USER_ID, MUTATION_RATE_LIMIT);
    expect(checkMutationLimit.mock.calls[0]![1]).toBe(MUTATION_RATE_LIMIT);
  });

  it('a caller that names the row-write policy is counted against it, not the default', async () => {
    // The forwarding half of FAM-1 D23. That the two policies are separate budgets, each enforced
    // at its own number, is proved against the real limiter in `lib/rate-limit.test.ts`; what only
    // this file can show is that `enterMutation` hands on the policy it was given, still keyed on
    // the principal, and does not ask the default limiter as well.
    expect(await enterMutation(NO_PROFILE_LOG, ROW_WRITE_RATE_LIMIT)).toEqual({
      ok: true,
      userId: USER_ID,
    });
    expect(checkMutationLimit).toHaveBeenCalledTimes(1);
    expect(checkMutationLimit).toHaveBeenCalledWith(USER_ID, ROW_WRITE_RATE_LIMIT);
    expect(checkMutationLimit.mock.calls[0]![1]).toBe(ROW_WRITE_RATE_LIMIT);
    expect(ROW_WRITE_RATE_LIMIT).not.toBe(MUTATION_RATE_LIMIT);
  });

  it('a policy does not move the session check: no session, no limiter call, whichever policy', async () => {
    // The order claim again, for the new parameter: naming a looser budget must not buy an
    // unauthenticated caller a Redis round trip.
    sessionUserOrNull.mockResolvedValue(null);
    expect(await enterMutation(NO_PROFILE_LOG, ROW_WRITE_RATE_LIMIT)).toEqual({
      ok: false,
      error: NO_PROFILE_LOG,
    });
    expect(checkMutationLimit).not.toHaveBeenCalled();
  });

  it('a row write over ITS limit is refused with the rate-limit copy, like any other', async () => {
    checkMutationLimit.mockResolvedValue({ allowed: false, reason: 'limited' });
    expect(await enterMutation(NO_PROFILE_LOG, ROW_WRITE_RATE_LIMIT)).toEqual({
      ok: false,
      error: RATE_LIMITED,
    });
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

/**
 * FAM-1 contract change C7: an action that speaks the contract enters through the SAME function and
 * is refused in the contract's words. The words are literals here on purpose: this is where they
 * are pinned from the transport's side (the contract pins them from its own, `shapes.test.ts`).
 */
describe('enterMutation — for an action that speaks the FAM-1 contract', () => {
  it('no session answers `not_found`, in the contract envelope, before the limiter is asked', async () => {
    sessionUserOrNull.mockResolvedValue(null);
    expect(await enterMutation(TRANSPORT_REFUSALS)).toEqual({ ok: false, reason: 'not_found' });
    expect(checkMutationLimit).not.toHaveBeenCalled();
  });

  it('over the limit answers `retry`, never `not_found`', async () => {
    checkMutationLimit.mockResolvedValue({ allowed: false, reason: 'limited' });
    expect(await enterMutation(TRANSPORT_REFUSALS)).toEqual({ ok: false, reason: 'retry' });
  });

  it('a caller that passes is told who it is, exactly as a form action is', async () => {
    expect(await enterMutation(TRANSPORT_REFUSALS)).toEqual({ ok: true, userId: USER_ID });
    expect(checkMutationLimit).toHaveBeenCalledWith(USER_ID, MUTATION_RATE_LIMIT);
    expect(checkMutationLimit.mock.calls[0]![1]).toBe(MUTATION_RATE_LIMIT);
  });

  it('a row write is counted against the row-write policy, and refused with `retry` over it', async () => {
    checkMutationLimit.mockResolvedValue({ allowed: false, reason: 'limited' });
    expect(await enterMutation(TRANSPORT_REFUSALS, ROW_WRITE_RATE_LIMIT)).toEqual({
      ok: false,
      reason: 'retry',
    });
    expect(checkMutationLimit.mock.calls[0]![1]).toBe(ROW_WRITE_RATE_LIMIT);
  });

  it('a dead limiter still lets the write through and reports it', async () => {
    checkMutationLimit.mockResolvedValue({ allowed: true, reason: 'limiter-error' });
    expect(await enterMutation(TRANSPORT_REFUSALS)).toEqual({ ok: true, userId: USER_ID });
    expect(reportLimiterUnavailable).toHaveBeenCalledTimes(1);
    expect(reportLimiterUnavailable).toHaveBeenCalledWith('mutation');
  });

  it('the refusal is a `ProgramResult` and a `RowResult` as it stands, and carries no copy', async () => {
    sessionUserOrNull.mockResolvedValue(null);
    const entry = await enterMutation(TRANSPORT_REFUSALS);
    if (entry.ok) throw new Error('expected a refusal');
    // The proof is that these two lines compile: an action returns `entry` untouched.
    const asProgram: ProgramResult<{ programPublicId: string }> = entry;
    const asRow: RowResult = entry;
    expect(asProgram).toBe(asRow);
    // No `error` string: a contract action's words are the screen's, chosen from `reason`.
    expect(Object.keys(entry).sort()).toEqual(['ok', 'reason']);
  });

  it('a form action is unchanged: a string still answers with copy, never a `reason`', async () => {
    sessionUserOrNull.mockResolvedValue(null);
    expect(await enterMutation(NO_PROFILE_LOG)).toEqual({ ok: false, error: NO_PROFILE_LOG });
  });
});
