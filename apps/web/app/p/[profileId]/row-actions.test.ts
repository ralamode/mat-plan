import { E2E_SESSION_BYPASS_USER, ROW_REFUSAL, type DayActions } from '@mat-plan/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The day page's row writes (FAM-1 step 12b): the shared boundary matrices, then what they cannot
 * express: what the contract's schema refuses before anything is read, where `today` comes from,
 * what a success answers and revalidates, and that a refusal passes through with nothing
 * revalidated.
 *
 * ⚠️ **What this layer can prove, and what it cannot.** The DAL is mocked, so "one entry on replay",
 * "an older or a future day answers closed_day" and "an entry that is not this athlete's on that
 * day answers not_found" are proven where the writes are: lane E's `db:verify`
 * (`packages/db/scripts/verify/day.ts`). Here: the action hands the DAL exactly the parsed input
 * and the zone's today, and answers with the DAL's result, so each of those reaches the screen as
 * the writer gave it.
 */
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// Throws like Next's, so a redirect misplaced inside a try cannot pass silently.
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
  RedirectType: { replace: 'replace', push: 'push' },
}));
vi.mock('@/lib/dal/session', () => ({
  sessionUserOrNull: vi.fn(async () => ({ userId: PRINCIPAL })),
}));
// A PARTIAL mock: `enterMutation` reads the real policies; only the check is replaced.
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  checkMutationLimit: vi.fn(async () => ({ allowed: true, reason: 'ok' })),
}));
vi.mock('@/lib/dal/profiles', () => ({
  getProfileByPublicId: vi.fn(async () => ({ id: PROFILE_ID })),
}));
vi.mock('@/lib/active-timezone', () => ({ getActiveLocalDay: vi.fn(async () => TODAY) }));
vi.mock('@/lib/dal/day/day', () => ({
  logDayRow: vi.fn(async () => LOGGED),
  untickDayRow: vi.fn(async () => ({ ...LOGGED, hiddenAt: HIDDEN_AT })),
  retickDayRow: vi.fn(async () => LOGGED),
}));

import { revalidatePath } from 'next/cache';

import { getActiveLocalDay } from '@/lib/active-timezone';
import { athletePath } from '@/lib/constants';
import { logDayRow, retickDayRow, untickDayRow } from '@/lib/dal/day/day';
import { getProfileByPublicId } from '@/lib/dal/profiles';
import { ROW_WRITE_RATE_LIMIT } from '@/lib/rate-limit';
import { describeActionMatrices } from '@/test/action-matrix';

import { logRowAction, retickRowAction, untickRowAction } from './row-actions';
import { ACTION_REGISTRY } from './row-actions.registry';

const PRINCIPAL = E2E_SESSION_BYPASS_USER;
const PROFILE_ID = '019826b4-0000-7000-8000-000000000001';
const ENTRY_ID = '019826b4-0000-7000-8000-0000000000e1';
const HIDDEN_AT = '2026-11-17T18:30:00.000000Z';
// Far from the real clock: an action that computed its own today would hand the DAL another day.
const TODAY = '2031-03-04';
const LOGGED = { ok: true, entryPublicId: ENTRY_ID, values: { reps: 5, quantities: [] } } as const;

const writeInput = () => ({
  clientId: '019826b4-0000-7000-8000-0000000000c1',
  profilePublicId: PROFILE_ID,
  day: TODAY,
  workoutPublicId: '019826b4-0000-7000-8000-0000000000b1',
  prescriptionPublicId: '019826b4-0000-7000-8000-0000000000d1',
  set: 1,
  values: { reps: 5, quantities: [] },
});
const untickInput = () => ({ profilePublicId: PROFILE_ID, day: TODAY, entryPublicId: ENTRY_ID });
const retickInput = () => ({ ...untickInput(), hiddenAt: HIDDEN_AT });

beforeEach(() => vi.clearAllMocks());

/** The three actions are the contract's members: each accepts the member's input and answers it. */
({
  logRow: logRowAction,
  untickRow: untickRowAction,
  retickRow: retickRowAction,
}) satisfies Pick<DayActions, 'logRow' | 'untickRow' | 'retickRow'>;

/**
 * 🔴 **The boundary matrices** (AGENTS.md → Backend / API PR rules): unauthenticated, rate-limited
 * under the ROW limit (each binding declares it, compared by identity), and another household's
 * athlete, answered byte for byte as the unauthenticated refusal, with nothing written.
 */
describeActionMatrices({
  testFile: import.meta.url,
  registry: ACTION_REGISTRY,
  profileId: PROFILE_ID,
  principal: PRINCIPAL,
  bindings: {
    logRowAction: { fn: logRowAction, writers: [logDayRow], limit: ROW_WRITE_RATE_LIMIT },
    untickRowAction: { fn: untickRowAction, writers: [untickDayRow], limit: ROW_WRITE_RATE_LIMIT },
    retickRowAction: { fn: retickRowAction, writers: [retickDayRow], limit: ROW_WRITE_RATE_LIMIT },
  },
  validBody: {
    logRowAction: writeInput,
    untickRowAction: untickInput,
    retickRowAction: retickInput,
  },
});

const DAL = [logDayRow, untickDayRow, retickDayRow];

describe('the row actions (FAM-1 12b)', () => {
  it.each([
    ['a ✓ with no client id', () => logRowAction({ ...writeInput(), clientId: undefined })],
    ['a ✓ on set 0', () => logRowAction({ ...writeInput(), set: 0 })],
    [
      'a ✓ with a day that is not a day',
      () => logRowAction({ ...writeInput(), day: '2031-13-40' }),
    ],
    [
      'a ✓ with a negative number',
      () => logRowAction({ ...writeInput(), values: { reps: -1, quantities: [] } }),
    ],
    [
      'an un-tick of an entry id that is not a uuid',
      () => untickRowAction({ ...untickInput(), entryPublicId: 'x' }),
    ],
    ['a re-tick with no token', () => retickRowAction(untickInput())],
    ['not an object at all', () => logRowAction('a string')],
  ])('%s is bad_value, and nothing is read or written', async (_label, call) => {
    expect(await call()).toEqual({ ok: false, reason: ROW_REFUSAL.bad_value });
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    for (const dal of DAL) expect(dal).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('hands the DAL the parsed input and the zone’s today, read in the action', async () => {
    await logRowAction(writeInput());
    await untickRowAction(untickInput());
    await retickRowAction(retickInput());
    expect(getActiveLocalDay).toHaveBeenCalledTimes(3);
    expect(vi.mocked(logDayRow).mock.calls[0]).toEqual([writeInput(), TODAY]);
    expect(vi.mocked(untickDayRow).mock.calls[0]).toEqual([untickInput(), TODAY]);
    expect(vi.mocked(retickDayRow).mock.calls[0]).toEqual([retickInput(), TODAY]);
  });

  it('a success answers field by field and revalidates the athlete’s day page', async () => {
    vi.mocked(logDayRow).mockResolvedValueOnce({ ...LOGGED, extra: 'never sent' } as never);
    expect(await logRowAction(writeInput())).toEqual(LOGGED);
    expect(await untickRowAction(untickInput())).toEqual({ ...LOGGED, hiddenAt: HIDDEN_AT });
    expect(await retickRowAction(retickInput())).toEqual(LOGGED);
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([
      [athletePath(PROFILE_ID)],
      [athletePath(PROFILE_ID)],
      [athletePath(PROFILE_ID)],
    ]);
  });

  it.each([
    ROW_REFUSAL.closed_day,
    ROW_REFUSAL.not_found,
    ROW_REFUSAL.not_scheduled,
    ROW_REFUSAL.own_hidden,
    ROW_REFUSAL.slot_taken,
    ROW_REFUSAL.program_changed,
  ])('the writer’s %s reaches the screen as it is, with nothing revalidated', async (reason) => {
    const refused = { ok: false, reason } as const;
    vi.mocked(logDayRow).mockResolvedValueOnce(refused);
    vi.mocked(untickDayRow).mockResolvedValueOnce(refused);
    vi.mocked(retickDayRow).mockResolvedValueOnce(refused);
    expect(await logRowAction(writeInput())).toEqual(refused);
    expect(await untickRowAction(untickInput())).toEqual(refused);
    expect(await retickRowAction(retickInput())).toEqual(refused);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
