import {
  addDays,
  E2E_SESSION_BYPASS_USER,
  RESTORE_CLEAR_REFUSAL,
  restoreClearResultSchema,
  type RestoreClearInput,
} from '@mat-plan/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Restore all (V1-9b B1-2): the shared boundary matrices, then what they cannot express. The DAL is
 * mocked, so what Restore all does to rows is proven where the rows are (`db:verify`,
 * `verify/single-values.ts`, B2-0 proofs 5–9 and B1-2 proofs 10–13); and the counting, where it is
 * done (`lib/dal/entries-restore-clear.test.ts`). Here: the order of the checks, the bound, what reaches the DAL,
 * and the answers.
 */
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
vi.mock('@/lib/dal/profiles', () => ({
  getProfileByPublicId: vi.fn(async () => ({
    id: PROFILE_ID,
    name: 'Athlete One',
    kind: 'kid',
    avatar: null,
    archived: false,
  })),
}));
vi.mock('@/lib/dal/entries', () => ({
  restoreClearedDay: vi.fn(async () => ({ restored: 2, keptHidden: 0 })),
}));

import { revalidatePath } from 'next/cache';

import { athletePath, DEFAULT_TIME_ZONE } from '@/lib/constants';
import { restoreClearedDay } from '@/lib/dal/entries';
import { getProfileByPublicId } from '@/lib/dal/profiles';
import { localDayIso } from '@/lib/date';
import { describeActionMatrices } from '@/test/action-matrix';

import { restoreClearAction } from './clear-day-actions';
import { ACTION_REGISTRY } from './clear-day-actions.registry';

const PRINCIPAL = E2E_SESSION_BYPASS_USER;
const PROFILE_ID = '019826b4-0000-7000-8000-000000000001';
// A clear's token as `hiddenAtText` prints it: microseconds, six digits.
const TOKEN = '2026-11-17T18:04:05.123456Z';

const today = () => localDayIso(DEFAULT_TIME_ZONE);
const input = (over: Partial<RestoreClearInput> = {}): RestoreClearInput => ({
  profilePublicId: PROFILE_ID,
  day: today(),
  hiddenAt: TOKEN,
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
    restoreClearAction: { fn: restoreClearAction, writers: [restoreClearedDay] },
  },
  validBody: { restoreClearAction: () => input() },
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
      reason: RESTORE_CLEAR_REFUSAL.bad_value,
    });
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(restoreClearedDay).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('an athlete this household does not hold is not_found, and nothing is revalidated', async () => {
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce(null);
    expect(await restoreClearAction(input())).toEqual({
      ok: false,
      reason: RESTORE_CLEAR_REFUSAL.not_found,
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
      reason: RESTORE_CLEAR_REFUSAL.closed_day,
    });
    expect(restoreClearedDay).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith(athletePath(PROFILE_ID));
  });

  it('an archived athlete’s day is closed_day too, even today (rowDayOpen’s rule)', async () => {
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce({
      id: PROFILE_ID,
      name: 'Athlete One',
      kind: 'kid',
      avatar: null,
      archived: true,
    } as Awaited<ReturnType<typeof getProfileByPublicId>>);
    expect(await restoreClearAction(input())).toEqual({
      ok: false,
      reason: RESTORE_CLEAR_REFUSAL.closed_day,
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
