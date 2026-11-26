import {
  E2E_SESSION_BYPASS_USER,
  MAX_ORDER_PROGRAMS,
  PROGRAM_REFUSAL,
  ROW_REFUSAL,
  type DayActions,
} from '@mat-plan/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The day page's writes (FAM-1 steps 12b, 12d's Change and 15c's Program order): the shared boundary matrices, then what they cannot
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
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));
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
  amendDayRow: vi.fn(async () => LOGGED),
}));
// Program order (15c): the program DAL, and the one rule that revalidates after an assignment change.
vi.mock('@/lib/dal/program/writes', () => ({
  reorderHouseholdPrograms: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/dal/program/revalidate', () => ({ refreshAssignment: vi.fn() }));

import { refresh, revalidatePath } from 'next/cache';

import { getActiveLocalDay } from '@/lib/active-timezone';
import { amendDayRow, logDayRow, retickDayRow, untickDayRow } from '@/lib/dal/day/day';
import { getProfileByPublicId } from '@/lib/dal/profiles';
import { refreshAssignment } from '@/lib/dal/program/revalidate';
import { reorderHouseholdPrograms } from '@/lib/dal/program/writes';
import { sessionUserOrNull } from '@/lib/dal/session';
import { checkMutationLimit, ROW_WRITE_RATE_LIMIT } from '@/lib/rate-limit';
import { describeActionMatrices } from '@/test/action-matrix';

import {
  amendRowAction,
  logRowAction,
  reorderProgramsAction,
  retickRowAction,
  untickRowAction,
} from './row-actions';
import { ACTION_REGISTRY } from './row-actions.registry';

const PRINCIPAL = E2E_SESSION_BYPASS_USER;
const PROFILE_ID = '019826b4-0000-7000-8000-000000000001';
const ENTRY_ID = '019826b4-0000-7000-8000-0000000000e1';
const HIDDEN_AT = '2026-11-17T18:30:00.000000Z';
// Far from the real clock: an action that computed its own today would hand the DAL another day.
const TODAY = '2031-03-04';
// The row's day differs from today, so an action that passed `day` as `today` is caught.
const YESTERDAY = '2031-03-03';
const LOGGED = { ok: true, entryPublicId: ENTRY_ID, values: { reps: 5, quantities: [] } } as const;

const writeInput = () => ({
  clientId: '019826b4-0000-7000-8000-0000000000c1',
  profilePublicId: PROFILE_ID,
  day: YESTERDAY,
  workoutPublicId: '019826b4-0000-7000-8000-0000000000b1',
  prescriptionPublicId: '019826b4-0000-7000-8000-0000000000d1',
  set: 1,
  values: { reps: 5, quantities: [] },
});
const untickInput = () => ({
  profilePublicId: PROFILE_ID,
  day: YESTERDAY,
  entryPublicId: ENTRY_ID,
});
const retickInput = () => ({ ...untickInput(), hiddenAt: HIDDEN_AT });
// A Change names the entry, not the day: the writer reads the day from the entry (11c-i).
const amendInput = () => ({
  profilePublicId: PROFILE_ID,
  entryPublicId: ENTRY_ID,
  values: { reps: 6, quantities: [] },
});

const PROGRAM_A = '019826b4-0000-7000-8000-0000000000a1';
const PROGRAM_B = '019826b4-0000-7000-8000-0000000000a2';
const orderInput = () => ({
  profilePublicId: PROFILE_ID,
  programPublicIds: [PROGRAM_B, PROGRAM_A],
});
const ORDER_NOT_FOUND = { ok: false, reason: PROGRAM_REFUSAL.not_found } as const;

beforeEach(() => vi.clearAllMocks());

/** The five actions are the contract's members: each accepts the member's input and answers it. */
({
  logRow: logRowAction,
  untickRow: untickRowAction,
  retickRow: retickRowAction,
  amendRow: amendRowAction,
  reorderPrograms: reorderProgramsAction,
}) satisfies Pick<
  DayActions,
  'logRow' | 'untickRow' | 'retickRow' | 'amendRow' | 'reorderPrograms'
>;

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
    amendRowAction: { fn: amendRowAction, writers: [amendDayRow], limit: ROW_WRITE_RATE_LIMIT },
    // Household-addressed, under the DEFAULT limiter (no `limit`): a reorder is not a row write.
    reorderProgramsAction: {
      fn: reorderProgramsAction,
      writers: [reorderHouseholdPrograms],
      scopeMiss: () => vi.mocked(reorderHouseholdPrograms).mockResolvedValueOnce(ORDER_NOT_FOUND),
    },
  },
  validBody: {
    logRowAction: writeInput,
    untickRowAction: untickInput,
    retickRowAction: retickInput,
    amendRowAction: amendInput,
    reorderProgramsAction: orderInput,
  },
});

const DAL = [logDayRow, untickDayRow, retickDayRow, amendDayRow];

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
    [
      'a Change of an entry id that is not a uuid',
      () => amendRowAction({ ...amendInput(), entryPublicId: 'x' }),
    ],
    [
      'a Change with a negative number',
      () => amendRowAction({ ...amendInput(), values: { reps: -1, quantities: [] } }),
    ],
    ['a Change with no values', () => amendRowAction({ ...amendInput(), values: undefined })],
    ['not an object at all', () => logRowAction('a string')],
  ])('%s is bad_value, and nothing is read or written', async (_label, call) => {
    expect(await call()).toEqual({ ok: false, reason: ROW_REFUSAL.bad_value });
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    for (const dal of DAL) expect(dal).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ['✓', () => logRowAction(writeInput())],
    ['un-✓', () => untickRowAction(untickInput())],
    ['re-✓', () => retickRowAction(retickInput())],
    ['Change', () => amendRowAction(amendInput())],
  ])(
    '%s for an athlete outside the household is not_found, nothing is written or refreshed',
    async (_label, call) => {
      vi.mocked(getProfileByPublicId).mockResolvedValueOnce(null);
      expect(await call()).toEqual({ ok: false, reason: ROW_REFUSAL.not_found });
      for (const dal of DAL) expect(dal).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  // The shared matrices above assert `revalidatePath` only, so for these four they would pass
  // whatever `refresh()` did: the no-session and rate-limited refusals are pinned here (PERF-3).
  it.each([
    ['✓', () => logRowAction(writeInput())],
    ['un-✓', () => untickRowAction(untickInput())],
    ['re-✓', () => retickRowAction(retickInput())],
    ['Change', () => amendRowAction(amendInput())],
  ])('%s refused for no session or the limiter refreshes nothing', async (_label, call) => {
    vi.mocked(sessionUserOrNull).mockResolvedValueOnce(null);
    expect(await call()).toEqual({ ok: false, reason: ROW_REFUSAL.not_found });
    vi.mocked(checkMutationLimit).mockResolvedValueOnce({ allowed: false, reason: 'limited' });
    expect(await call()).toEqual({ ok: false, reason: ROW_REFUSAL.retry });
    for (const dal of DAL) expect(dal).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('hands the DAL the parsed input and the zone’s today, read in the action', async () => {
    await logRowAction(writeInput());
    await untickRowAction(untickInput());
    await retickRowAction(retickInput());
    await amendRowAction(amendInput());
    expect(getActiveLocalDay).toHaveBeenCalledTimes(4);
    expect(vi.mocked(logDayRow).mock.calls[0]).toEqual([writeInput(), TODAY]);
    expect(vi.mocked(untickDayRow).mock.calls[0]).toEqual([untickInput(), TODAY]);
    expect(vi.mocked(retickDayRow).mock.calls[0]).toEqual([retickInput(), TODAY]);
    expect(vi.mocked(amendDayRow).mock.calls[0]).toEqual([amendInput(), TODAY]);
  });

  it('a success answers field by field and refreshes the page, never revalidatePath (PERF-3)', async () => {
    vi.mocked(logDayRow).mockResolvedValueOnce({ ...LOGGED, extra: 'never sent' } as never);
    expect(await logRowAction(writeInput())).toEqual(LOGGED);
    expect(await untickRowAction(untickInput())).toEqual({ ...LOGGED, hiddenAt: HIDDEN_AT });
    expect(await retickRowAction(retickInput())).toEqual(LOGGED);
    expect(await amendRowAction(amendInput())).toEqual(LOGGED);
    // `refresh()` keeps the router's prefetch cache; `revalidatePath` emptied it, and every link on
    // the day page was fetched again after each ✓ (measured on production, 2026-11-26).
    expect(refresh).toHaveBeenCalledTimes(4);
    expect(revalidatePath).not.toHaveBeenCalled();
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
    vi.mocked(amendDayRow).mockResolvedValueOnce(refused);
    expect(await logRowAction(writeInput())).toEqual(refused);
    expect(await untickRowAction(untickInput())).toEqual(refused);
    expect(await retickRowAction(retickInput())).toEqual(refused);
    expect(await amendRowAction(amendInput())).toEqual(refused);
    expect(refresh).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('a Change the writer refuses as bad_value (a number its type has no field for) is passed through, unrevalidated', async () => {
    // The schema cannot judge which fields a type has (`rowAmendSchema`'s docblock): the writer does,
    // and its answer reaches the screen unchanged.
    vi.mocked(amendDayRow).mockResolvedValueOnce({ ok: false, reason: ROW_REFUSAL.bad_value });
    expect(await amendRowAction(amendInput())).toEqual({
      ok: false,
      reason: ROW_REFUSAL.bad_value,
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('Program order (FAM-1 15c)', () => {
  /** Distinct lower-case uuids, as many as asked. */
  const distinctIds = (n: number) =>
    Array.from({ length: n }, (_, i) => `019826b4-0000-7000-8000-${String(i).padStart(12, '0')}`);

  it.each([
    ['no programs', () => reorderProgramsAction({ ...orderInput(), programPublicIds: [] })],
    [
      'a program twice',
      () => reorderProgramsAction({ ...orderInput(), programPublicIds: [PROGRAM_A, PROGRAM_A] }),
    ],
    [
      'an athlete id that is not a uuid',
      () => reorderProgramsAction({ ...orderInput(), profilePublicId: 'x' }),
    ],
    [
      `${MAX_ORDER_PROGRAMS + 1} distinct ids, one past the cap`,
      () =>
        reorderProgramsAction({
          ...orderInput(),
          programPublicIds: distinctIds(MAX_ORDER_PROGRAMS + 1),
        }),
    ],
    ['not an object at all', () => reorderProgramsAction('a string')],
  ])('%s is invalid, and the DAL is not called', async (_label, call) => {
    expect(await call()).toEqual({ ok: false, reason: PROGRAM_REFUSAL.invalid });
    expect(reorderHouseholdPrograms).not.toHaveBeenCalled();
    expect(getActiveLocalDay).not.toHaveBeenCalled();
    expect(refreshAssignment).not.toHaveBeenCalled();
  });

  it(`${MAX_ORDER_PROGRAMS} distinct ids reach the DAL: the cap is the schema's, not lower`, async () => {
    const order = { ...orderInput(), programPublicIds: distinctIds(MAX_ORDER_PROGRAMS) };
    expect(await reorderProgramsAction(order)).toEqual({ ok: true });
    expect(vi.mocked(reorderHouseholdPrograms).mock.calls).toEqual([[order, TODAY]]);
  });

  it('hands the DAL the parsed input and the zone’s today, read in the action, and resolves no athlete', async () => {
    await reorderProgramsAction(orderInput());
    expect(getActiveLocalDay).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reorderHouseholdPrograms).mock.calls).toEqual([[orderInput(), TODAY]]);
    // Household-addressed: the writer is the one check of the athlete (`lockAthletes`).
    expect(getProfileByPublicId).not.toHaveBeenCalled();
  });

  it('a success answers { ok: true } alone and refreshes the assignment for the parsed, lower-cased athlete id', async () => {
    vi.mocked(reorderHouseholdPrograms).mockResolvedValueOnce({ ok: true, extra: 1 } as never);
    const shouted = {
      profilePublicId: PROFILE_ID.toUpperCase(),
      programPublicIds: [PROGRAM_B.toUpperCase(), PROGRAM_A],
    };
    expect(await reorderProgramsAction(shouted)).toEqual({ ok: true });
    expect(vi.mocked(reorderHouseholdPrograms).mock.calls).toEqual([[orderInput(), TODAY]]);
    expect(vi.mocked(refreshAssignment).mock.calls).toEqual([[[PROFILE_ID]]]);
  });

  it.each([PROGRAM_REFUSAL.invalid, PROGRAM_REFUSAL.not_found, PROGRAM_REFUSAL.retry])(
    'the writer’s %s reaches the screen as it is, with nothing revalidated',
    async (reason) => {
      vi.mocked(reorderHouseholdPrograms).mockResolvedValueOnce({ ok: false, reason });
      expect(await reorderProgramsAction(orderInput())).toEqual({ ok: false, reason });
      expect(refreshAssignment).not.toHaveBeenCalled();
    },
  );

  /**
   * 🔴 **Another household's athlete id** (`write-path.md` invariant 13; `mutating-actions.ts`). What
   * this layer proves is the pass-through: the id reaches the DAL unchanged, and the writer's
   * `not_found` leaves with the no-session refusal's bytes, nothing revalidated. The DAL is mocked,
   * so the refusal itself is not proved here: that is `verifyReorderPrograms`'s "another household’s
   * athlete" row (`packages/db/scripts/verify/program.ts`), where lane P's `lockAthletes` finds no
   * such athlete in A's scope.
   */
  it('🔴 the writer’s not_found for a foreign athlete id passes through with no-session bytes; the id reaches the DAL unchanged', async () => {
    const FOREIGN_ATHLETE = '019826b4-0000-7000-8000-0000000000f1';
    vi.mocked(reorderHouseholdPrograms).mockResolvedValueOnce(ORDER_NOT_FOUND);
    const foreign = await reorderProgramsAction({
      ...orderInput(),
      profilePublicId: FOREIGN_ATHLETE,
    });
    expect(vi.mocked(reorderHouseholdPrograms).mock.calls[0]![0]).toEqual({
      ...orderInput(),
      profilePublicId: FOREIGN_ATHLETE,
    });
    vi.mocked(sessionUserOrNull).mockResolvedValueOnce(null);
    const noSession = await reorderProgramsAction(orderInput());
    expect(foreign).toEqual(noSession);
    expect(JSON.stringify(foreign)).toBe(JSON.stringify(noSession));
    expect(refreshAssignment).not.toHaveBeenCalled();
  });
});
