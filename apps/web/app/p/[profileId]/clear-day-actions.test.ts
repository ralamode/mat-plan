import {
  addDays,
  CLEAR_DAY_CONFIRM_WORD,
  clearDayResultSchema,
  E2E_SESSION_BYPASS_USER,
  DAY_CLEAR_REFUSAL,
  restoreClearResultSchema,
  type ClearDayInput,
  type RestoreClearInput,
} from '@mat-plan/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Clear this day (V1-9b B2) and Restore all (V1-9b B1-2): the shared boundary matrices, then what
 * they cannot express. The DAL is
 * mocked, so what Restore all does to rows is proven where the rows are (`db:verify`,
 * `verify/single-values.ts`, B2-0 proofs 5–9 and B1-2 proofs 10–13); and the counting, where it is
 * done (`lib/dal/entries-restore-clear.test.ts`). Here: the order of the checks, the bound, what reaches the DAL,
 * and the answers.
 */
// One profile DTO for every test, and one fixed "today": the clear is today-only, so a run that
// crossed midnight between building the input and the action reading its day would go red.
const { PROFILE, TODAY } = vi.hoisted(() => ({
  // `kind` is set from `PROFILE_KIND` in the mock below: a hoisted block runs before imports.
  PROFILE: {
    id: '019826b4-0000-7000-8000-000000000001',
    name: 'Athlete One',
    kind: undefined as unknown as 'kid',
    avatar: null,
    archived: false,
  },
  TODAY: '2026-11-19',
}));
vi.mock('@/lib/active-timezone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/active-timezone')>()),
  getActiveLocalDay: vi.fn(async () => TODAY),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// Throws like Next's, so a redirect misplaced inside a try cannot pass silently.
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
  RedirectType: { replace: 'replace', push: 'push' },
}));
// No `tz` cookie → DEFAULT_TIME_ZONE, so `today` below is the action's today.
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock('@/lib/dal/session', () => ({
  sessionUserOrNull: vi.fn(async () => ({ userId: PRINCIPAL })),
}));
// A PARTIAL mock: `enterMutation` reads the real policies; only the check is replaced.
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  checkMutationLimit: vi.fn(async () => ({ allowed: true, reason: 'ok' })),
}));
vi.mock('@/lib/dal/profiles', async () => {
  PROFILE.kind = (await import('@mat-plan/shared')).PROFILE_KIND.kid;
  return { getProfileByPublicId: vi.fn(async () => PROFILE) };
});
vi.mock('@/lib/dal/entries', () => ({
  restoreClearedDay: vi.fn(async () => ({ restored: 2, keptHidden: 0 })),
  clearDayEntries: vi.fn(async () => ({ count: 3 })),
}));
// Any member may clear and restore, so the action module reads no household role. This pins the
// module; `lib/dal/entries-restore-clear.test.ts` pins the two DAL wrappers, where an owner gate
// (`ownerScope`) would actually go.
vi.mock('@/lib/dal/household', () => ({
  householdState: vi.fn(async () => {
    throw new Error('a day-level action read the household role');
  }),
}));

import { revalidatePath } from 'next/cache';

import { athletePath } from '@/lib/constants';
import { clearDayEntries, restoreClearedDay } from '@/lib/dal/entries';
import { householdState } from '@/lib/dal/household';
import { getProfileByPublicId } from '@/lib/dal/profiles';
import { describeActionMatrices } from '@/test/action-matrix';

import { clearDayAction, restoreClearAction } from './clear-day-actions';
import { ACTION_REGISTRY } from './clear-day-actions.registry';

const PRINCIPAL = E2E_SESSION_BYPASS_USER;
const PROFILE_ID = PROFILE.id;
// A clear's token as `hiddenAtText` prints it: microseconds, six digits.
const TOKEN = '2026-11-17T18:04:05.123456Z';

const today = () => TODAY;
// An archived athlete, once, for either action.
const archivedOnce = () =>
  vi
    .mocked(getProfileByPublicId)
    .mockResolvedValueOnce({ ...PROFILE, archived: true } as Awaited<
      ReturnType<typeof getProfileByPublicId>
    >);
const input = (over: Partial<RestoreClearInput> = {}): RestoreClearInput => ({
  profilePublicId: PROFILE_ID,
  day: today(),
  hiddenAt: TOKEN,
  ...over,
});
const clearInput = (over: Partial<ClearDayInput> = {}): ClearDayInput => ({
  profilePublicId: PROFILE_ID,
  day: today(),
  confirm: CLEAR_DAY_CONFIRM_WORD,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

/**
 * 🔴 **The boundary matrices** (AGENTS.md → Backend / API PR rules): unauthenticated, rate-limited,
 * wrong household (`getProfileByPublicId` answers null for a foreign athlete), and the byte-identical
 * refusals.
 */
describeActionMatrices({
  testFile: import.meta.url,
  registry: ACTION_REGISTRY,
  profileId: PROFILE_ID,
  principal: PRINCIPAL,
  bindings: {
    clearDayAction: { fn: clearDayAction, writers: [clearDayEntries] },
    restoreClearAction: { fn: restoreClearAction, writers: [restoreClearedDay] },
  },
  validBody: { clearDayAction: () => clearInput(), restoreClearAction: () => input() },
});

describe('restoreClearAction (V1-9b B1-2)', () => {
  it.each([
    ['a token through a Date (milliseconds)', input({ hiddenAt: '2026-11-17T18:04:05.123Z' })],
    ['a malformed day', input({ day: '17/11/2026' })],
    [
      'a token naming no real instant (30 February)',
      input({ hiddenAt: '2026-02-30T00:00:00.000000Z' }),
    ],
    ['a token in year 0000', input({ hiddenAt: '0000-01-01T00:00:00.000000Z' })],
    ['an athlete id that is not a uuid', input({ profilePublicId: 'x' })],
    ['not an object at all', 'a string' as unknown as RestoreClearInput],
  ])('%s is bad_value, before the profile and the DAL', async (_label, body) => {
    expect(await restoreClearAction(body)).toEqual({
      ok: false,
      reason: DAY_CLEAR_REFUSAL.bad_value,
    });
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(restoreClearedDay).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('an athlete this household does not hold is not_found, and nothing is revalidated', async () => {
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce(null);
    expect(await restoreClearAction(input())).toEqual({
      ok: false,
      reason: DAY_CLEAR_REFUSAL.not_found,
    });
    expect(restoreClearedDay).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ['a day before yesterday', () => addDays(today(), -2)],
    ['tomorrow', () => addDays(today(), 1)],
  ])('%s is closed_day: the day page’s ✓ has the same bound', async (_label, day) => {
    expect(await restoreClearAction(input({ day: day() }))).toEqual({
      ok: false,
      reason: DAY_CLEAR_REFUSAL.closed_day,
    });
    expect(restoreClearedDay).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith(athletePath(PROFILE_ID));
  });

  it('an archived athlete’s day is closed_day too, even today (dayOpenFor’s rule)', async () => {
    archivedOnce();
    expect(await restoreClearAction(input())).toEqual({
      ok: false,
      reason: DAY_CLEAR_REFUSAL.closed_day,
    });
    expect(restoreClearedDay).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith(athletePath(PROFILE_ID));
  });

  it('yesterday is open', async () => {
    const day = addDays(today(), -1);
    expect(await restoreClearAction(input({ day }))).toMatchObject({ ok: true });
    expect(vi.mocked(restoreClearedDay).mock.calls[0]![0]).toMatchObject({ day });
  });

  it('hands the DAL the resolved athlete, the day and the token, and answers its counts', async () => {
    expect(await restoreClearAction(input())).toEqual({ ok: true, restored: 2, keptHidden: 0 });
    expect(restoreClearedDay).toHaveBeenCalledTimes(1);
    expect(vi.mocked(restoreClearedDay).mock.calls[0]![0]).toEqual({
      profilePublicId: PROFILE_ID,
      day: today(),
      hiddenAt: TOKEN,
    });
    expect(revalidatePath).toHaveBeenCalledWith(athletePath(PROFILE_ID));
  });

  it.each([
    ['a partial restore', { restored: 1, keptHidden: 1 }],
    ['none came back: every place was retaken', { restored: 0, keptHidden: 2 }],
    [
      'nothing left to restore (a replay, or another phone got there first)',
      { restored: 0, keptHidden: 0 },
    ],
  ])('%s is a success with its counts, and the page re-reads', async (_label, counts) => {
    vi.mocked(restoreClearedDay).mockResolvedValueOnce(counts);
    const result = await restoreClearAction(input());
    expect(result).toEqual({ ok: true, ...counts });
    expect(restoreClearResultSchema.safeParse(result).success).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith(athletePath(PROFILE_ID));
  });
});

describe('clearDayAction (V1-9b B2)', () => {
  it.each([
    ['no confirm word', { profilePublicId: PROFILE_ID, day: today() } as unknown as ClearDayInput],
    ['the wrong word', clearInput({ confirm: 'del' })],
    ['an empty word', clearInput({ confirm: '' })],
    ['a malformed day', clearInput({ day: '17/11/2026' })],
    ['an athlete id that is not a uuid', clearInput({ profilePublicId: 'x' })],
    ['not an object at all', 'a string' as unknown as ClearDayInput],
  ])('%s is bad_value, before the profile and the DAL', async (_label, body) => {
    expect(await clearDayAction(body)).toEqual({ ok: false, reason: DAY_CLEAR_REFUSAL.bad_value });
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(clearDayEntries).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('takes the word in any case with spaces around it', async () => {
    expect(await clearDayAction(clearInput({ confirm: ' Delete ' }))).toMatchObject({ ok: true });
  });

  it('an athlete this household does not hold is not_found, and nothing is revalidated', async () => {
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce(null);
    expect(await clearDayAction(clearInput())).toEqual({
      ok: false,
      reason: DAY_CLEAR_REFUSAL.not_found,
    });
    expect(clearDayEntries).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ['yesterday (Restore all still runs there; a clear does not)', () => addDays(today(), -1)],
    ['a day before yesterday', () => addDays(today(), -2)],
    ['tomorrow', () => addDays(today(), 1)],
  ])('%s is closed_day, and the page re-reads', async (_label, day) => {
    expect(await clearDayAction(clearInput({ day: day() }))).toEqual({
      ok: false,
      reason: DAY_CLEAR_REFUSAL.closed_day,
    });
    expect(clearDayEntries).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith(athletePath(PROFILE_ID));
  });

  it('an archived athlete’s today is closed_day', async () => {
    archivedOnce();
    expect(await clearDayAction(clearInput())).toEqual({
      ok: false,
      reason: DAY_CLEAR_REFUSAL.closed_day,
    });
    expect(clearDayEntries).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith(athletePath(PROFILE_ID));
  });

  it('hands the DAL the RESOLVED athlete and the day, never the confirm word', async () => {
    // The DAL's id differs from the one sent, so forwarding the input's id would fail here.
    const RESOLVED = '019826b4-0000-7000-8000-000000000002';
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce({ ...PROFILE, id: RESOLVED } as Awaited<
      ReturnType<typeof getProfileByPublicId>
    >);
    expect(await clearDayAction(clearInput())).toEqual({ ok: true, count: 3 });
    expect(clearDayEntries).toHaveBeenCalledTimes(1);
    expect(vi.mocked(clearDayEntries).mock.calls[0]![0]).toEqual({
      profilePublicId: RESOLVED,
      day: today(),
    });
    expect(revalidatePath).toHaveBeenCalledWith(athletePath(RESOLVED));
  });

  it('answers the DAL’s count', async () => {
    expect(await clearDayAction(clearInput())).toEqual({ ok: true, count: 3 });
    expect(revalidatePath).toHaveBeenCalledWith(athletePath(PROFILE_ID));
  });

  it('nothing left to clear is a success with count 0, and the page re-reads', async () => {
    vi.mocked(clearDayEntries).mockResolvedValueOnce({ count: 0 });
    const result = await clearDayAction(clearInput());
    expect(result).toEqual({ ok: true, count: 0 });
    expect(clearDayResultSchema.safeParse(result).success).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith(athletePath(PROFILE_ID));
  });

  it('the action module reads no household role: any member may clear (and restore)', async () => {
    await clearDayAction(clearInput());
    await restoreClearAction(input());
    expect(householdState).not.toHaveBeenCalled();
  });
});
