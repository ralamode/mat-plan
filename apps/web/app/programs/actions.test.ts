import {
  E2E_SESSION_BYPASS_USER,
  emptyWeek,
  MAX_DAY_SLOTS,
  PROGRAM_REFUSAL,
  TRACKING_TYPE,
} from '@mat-plan/shared';
import { heavyADraft } from '@mat-plan/shared/program/fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The program builder's actions (FAM-1 steps 7a-i and 7a-ii): the shared boundary matrices, then what they
 * cannot express — what zod refuses before the DAL, what a success returns and revalidates, and that
 * a refusal passes through with nothing revalidated.
 *
 * ⚠️ **What this layer can prove, and what it cannot.** The DAL is mocked, so "one effect on replay"
 * and "no write for another household's id" are proven where the writes are: lane P's `db:verify`
 * (`packages/db/scripts/verify/program.ts`: create's replay, save's replay, rename and save against
 * two households; 7a-ii's writers: a week naming another household's workout is `not_found`, a copy
 * of another household's workout is `not_found`, and a copy's replay by `clientId` answers the first
 * copy). Here: the action hands the DAL exactly the client's ids and answers with the
 * DAL's result, so a replay reaches the writer as one and is answered as one.
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
// One of the five boundaries the matrices drive. These actions never resolve a profile: a call
// would be a finding, and the household matrix rows read it to prove they did not.
vi.mock('@/lib/dal/profiles', () => ({ getProfileByPublicId: vi.fn(async () => null) }));
vi.mock('@/lib/dal/program/writes', () => ({
  createHouseholdProgram: vi.fn(async () => ({ ok: true, programPublicId: PROGRAM_ID })),
  renameHouseholdProgram: vi.fn(async () => ({ ok: true })),
  saveHouseholdWorkout: vi.fn(async () => ({ ok: true, workoutPublicId: WORKOUT_ID })),
  saveHouseholdWeek: vi.fn(async () => ({ ok: true })),
  copyHouseholdWorkout: vi.fn(async () => ({ ok: true, workoutPublicId: COPY_ID })),
  newHouseholdItem: vi.fn(async () => ({ ok: true, ...ITEM })),
  putOnHouseholdProgram: vi.fn(async () => ({ ok: true })),
  takeOffHouseholdProgram: vi.fn(async () => ({ ok: true, lastDay: TODAY })),
}));
// The active-zone day (FAM-1 15): Put on and Take off read it here and hand it to the DAL.
vi.mock('@/lib/active-timezone', () => ({ getActiveLocalDay: vi.fn(async () => TODAY) }));

import { revalidatePath } from 'next/cache';

import { PROGRAMS_PATH } from '@/components/program-builder/routes';
import { APP_HOME_PATH, athletePath } from '@/lib/constants';
import {
  copyHouseholdWorkout,
  createHouseholdProgram,
  newHouseholdItem,
  putOnHouseholdProgram,
  renameHouseholdProgram,
  saveHouseholdWeek,
  saveHouseholdWorkout,
  takeOffHouseholdProgram,
} from '@/lib/dal/program/writes';
import { describeActionMatrices } from '@/test/action-matrix';

import {
  copyWorkoutAction,
  createProgramAction,
  newItemAction,
  putOnAction,
  renameProgramAction,
  saveWeekAction,
  saveWorkoutAction,
  takeOffAction,
} from './actions';
import { PROGRAM_ACTIONS } from './actions.contract';
import { ACTION_REGISTRY } from './actions.registry';

const PRINCIPAL = E2E_SESSION_BYPASS_USER;
const PROFILE_ID = '019826b4-0000-7000-8000-000000000001';
const PROGRAM_ID = '019826b4-0000-7000-8000-0000000000a1';
const WORKOUT_ID = '019826b4-0000-7000-8000-0000000000b1';
const CLIENT_ID = '019826b4-0000-7000-8000-0000000000c1';
const COPY_ID = '019826b4-0000-7000-8000-0000000000b9';
const ITEM = {
  itemPublicId: '019826b4-0000-7000-8000-0000000000d1',
  name: 'Bear crawl',
  trackingType: TRACKING_TYPE.time_sets,
  existed: false,
};

const createInput = () => ({ clientId: CLIENT_ID, name: 'Strength' });
const renameInput = () => ({ programPublicId: PROGRAM_ID, name: 'Strength II' });
const saveInput = () => structuredClone(heavyADraft);
const weekInput = () => ({
  programPublicId: PROGRAM_ID,
  days: { ...emptyWeek(), 1: [{ workoutPublicId: WORKOUT_ID, label: null }] },
});
const copyInput = () => ({
  clientId: CLIENT_ID,
  workoutPublicId: WORKOUT_ID,
  toProgramPublicId: PROGRAM_ID,
  weekdays: [1, 3],
  label: null,
});
const newItemInput = () => ({ name: 'Bear crawl', trackingType: TRACKING_TYPE.time_sets });
const TODAY = '2026-11-21';
const OTHER_PROFILE_ID = '019826b4-0000-7000-8000-000000000002';
const putOnInput = () => ({
  programPublicId: PROGRAM_ID,
  profilePublicIds: [PROFILE_ID, OTHER_PROFILE_ID],
  from: TODAY,
});
const takeOffInput = () => ({ programPublicId: PROGRAM_ID, profilePublicId: PROFILE_ID });

const NOT_FOUND = { ok: false, reason: PROGRAM_REFUSAL.not_found } as const;

beforeEach(() => vi.clearAllMocks());

/**
 * The actions are the contract's members: a parameter of `unknown` accepts the member's input, and
 * the answers match. `actions.contract.ts` assembles them (its own `satisfies` is the compile
 * check); this pins that it holds exactly these: the six, and Put on and Take off since step 15.
 */
it('the real ProgramActions holds the six actions, and putOn and takeOff (step 15)', () => {
  expect(PROGRAM_ACTIONS).toEqual({
    createProgram: createProgramAction,
    renameProgram: renameProgramAction,
    saveWorkout: saveWorkoutAction,
    saveWeek: saveWeekAction,
    copyWorkout: copyWorkoutAction,
    newItem: newItemAction,
    putOn: putOnAction,
    takeOff: takeOffAction,
  });
});

/**
 * 🔴 **The boundary matrices** (AGENTS.md → Backend / API PR rules): unauthenticated, rate-limited,
 * and, each action being household-scoped, the household's own refusal of an id it does not hold
 * (the DAL's `not_found`), answered byte for byte as the unauthenticated refusal, with nothing
 * revalidated.
 */
describeActionMatrices({
  testFile: import.meta.url,
  registry: ACTION_REGISTRY,
  profileId: PROFILE_ID,
  principal: PRINCIPAL,
  bindings: {
    createProgramAction: {
      fn: createProgramAction,
      writers: [createHouseholdProgram],
      scopeMiss: () => vi.mocked(createHouseholdProgram).mockResolvedValueOnce(NOT_FOUND),
    },
    renameProgramAction: {
      fn: renameProgramAction,
      writers: [renameHouseholdProgram],
      scopeMiss: () => vi.mocked(renameHouseholdProgram).mockResolvedValueOnce(NOT_FOUND),
    },
    saveWorkoutAction: {
      fn: saveWorkoutAction,
      writers: [saveHouseholdWorkout],
      scopeMiss: () => vi.mocked(saveHouseholdWorkout).mockResolvedValueOnce(NOT_FOUND),
    },
    saveWeekAction: {
      fn: saveWeekAction,
      writers: [saveHouseholdWeek],
      scopeMiss: () => vi.mocked(saveHouseholdWeek).mockResolvedValueOnce(NOT_FOUND),
    },
    copyWorkoutAction: {
      fn: copyWorkoutAction,
      writers: [copyHouseholdWorkout],
      scopeMiss: () => vi.mocked(copyHouseholdWorkout).mockResolvedValueOnce(NOT_FOUND),
    },
    newItemAction: {
      fn: newItemAction,
      writers: [newHouseholdItem],
      scopeMiss: () => vi.mocked(newHouseholdItem).mockResolvedValueOnce(NOT_FOUND),
    },
    putOnAction: {
      fn: putOnAction,
      writers: [putOnHouseholdProgram],
      scopeMiss: () => vi.mocked(putOnHouseholdProgram).mockResolvedValueOnce(NOT_FOUND),
    },
    takeOffAction: {
      fn: takeOffAction,
      writers: [takeOffHouseholdProgram],
      scopeMiss: () => vi.mocked(takeOffHouseholdProgram).mockResolvedValueOnce(NOT_FOUND),
    },
  },
  validBody: {
    createProgramAction: createInput,
    renameProgramAction: renameInput,
    saveWorkoutAction: saveInput,
    saveWeekAction: weekInput,
    copyWorkoutAction: copyInput,
    newItemAction: newItemInput,
    putOnAction: putOnInput,
    takeOffAction: takeOffInput,
  },
});

describe('the program actions (FAM-1 7a-i, 7a-ii)', () => {
  it.each([
    ['create, with no name', () => createProgramAction({ clientId: CLIENT_ID, name: '' })],
    ['create, with no client id', () => createProgramAction({ name: 'Strength' })],
    [
      'rename, with an id that is not a uuid',
      () => renameProgramAction({ programPublicId: 'x', name: 'A' }),
    ],
    ['save, a workout with no name', () => saveWorkoutAction({ ...saveInput(), name: ' ' })],
    ['save, not a draft at all', () => saveWorkoutAction('a string')],
    [
      'week, a program id that is not a uuid',
      () => saveWeekAction({ ...weekInput(), programPublicId: 'x' }),
    ],
    [
      'week, a weekday missing',
      () => {
        const days: Record<string, unknown> = emptyWeek();
        delete days['3'];
        return saveWeekAction({ programPublicId: PROGRAM_ID, days });
      },
    ],
    [
      'copy, a blank name (never the default)',
      () => copyWorkoutAction({ ...copyInput(), name: ' ' }),
    ],
    [
      'copy, a target that is not a uuid',
      () => copyWorkoutAction({ ...copyInput(), toProgramPublicId: 'x' }),
    ],
    ['copy, a weekday twice', () => copyWorkoutAction({ ...copyInput(), weekdays: [1, 1] })],
    ['new item, a blank name', () => newItemAction({ ...newItemInput(), name: ' ' })],
    [
      'new item, an unknown tracking type',
      () => newItemAction({ ...newItemInput(), trackingType: 'vibes' }),
    ],
    ['put on, nobody named', () => putOnAction({ ...putOnInput(), profilePublicIds: [] })],
    [
      'put on, one athlete twice',
      () => putOnAction({ ...putOnInput(), profilePublicIds: [PROFILE_ID, PROFILE_ID] }),
    ],
    ['put on, a start that is not a day', () => putOnAction({ ...putOnInput(), from: 'today' })],
    [
      'take off, an athlete id that is not a uuid',
      () => takeOffAction({ ...takeOffInput(), profilePublicId: 'x' }),
    ],
  ])('%s is invalid, and the DAL is never called', async (_label, call) => {
    expect(await call()).toEqual({ ok: false, reason: PROGRAM_REFUSAL.invalid });
    for (const dal of [
      createHouseholdProgram,
      renameHouseholdProgram,
      saveHouseholdWorkout,
      saveHouseholdWeek,
      copyHouseholdWorkout,
      newHouseholdItem,
      putOnHouseholdProgram,
      takeOffHouseholdProgram,
    ]) {
      expect(dal).not.toHaveBeenCalled();
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('🔴 a week naming a workout twice on a day is once_per_day, as the fake and the writer say (C25)', async () => {
    const twice = weekInput();
    twice.days[1] = [...twice.days[1]!, { workoutPublicId: WORKOUT_ID, label: null }];
    expect(await saveWeekAction(twice)).toEqual({
      ok: false,
      reason: PROGRAM_REFUSAL.once_per_day,
    });
    expect(saveHouseholdWeek).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('a week hands the DAL the PARSED draft: the ids its scope-miss report walks are lowercased', async () => {
    const upper = weekInput();
    upper.programPublicId = PROGRAM_ID.toUpperCase();
    upper.days[1] = [{ workoutPublicId: WORKOUT_ID.toUpperCase(), label: null }];
    await saveWeekAction(upper);
    expect(vi.mocked(saveHouseholdWeek).mock.calls[0]![0]).toEqual(weekInput());
  });

  it('a day past MAX_DAY_SLOTS is limit_reached, as the fake says (C35); a repeat on it is still once_per_day', async () => {
    const long = weekInput();
    long.days[1] = Array.from({ length: MAX_DAY_SLOTS + 1 }, (_, i) => ({
      workoutPublicId: `019826b4-0000-7000-8000-${String(i).padStart(12, '0')}`,
      label: null,
    }));
    expect(await saveWeekAction(long)).toEqual({
      ok: false,
      reason: PROGRAM_REFUSAL.limit_reached,
    });
    long.days[1] = [...long.days[1]!, long.days[1]![0]!];
    expect(await saveWeekAction(long)).toEqual({ ok: false, reason: PROGRAM_REFUSAL.once_per_day });
    expect(saveHouseholdWeek).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('copy and new item hand the DAL the client’s ids and text verbatim', async () => {
    await copyWorkoutAction(copyInput());
    expect(vi.mocked(copyHouseholdWorkout).mock.calls[0]![0]).toMatchObject({
      clientId: CLIENT_ID,
      workoutPublicId: WORKOUT_ID,
      toProgramPublicId: PROGRAM_ID,
    });
    await newItemAction(newItemInput());
    expect(vi.mocked(newHouseholdItem).mock.calls[0]![0]).toEqual(newItemInput());
  });

  it('a success hands the DAL the parsed input, ids verbatim, and answers field by field', async () => {
    expect(await createProgramAction(createInput())).toEqual({
      ok: true,
      programPublicId: PROGRAM_ID,
    });
    expect(createHouseholdProgram).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createHouseholdProgram).mock.calls[0]![0]).toEqual(createInput());

    expect(await renameProgramAction(renameInput())).toEqual({ ok: true });
    expect(vi.mocked(renameHouseholdProgram).mock.calls[0]![0]).toMatchObject(renameInput());

    expect(await saveWorkoutAction(saveInput())).toEqual({ ok: true, workoutPublicId: WORKOUT_ID });
    expect(vi.mocked(saveHouseholdWorkout).mock.calls[0]![0]).toMatchObject({
      programPublicId: heavyADraft.programPublicId,
      workoutClientId: heavyADraft.workoutClientId,
    });
  });

  /** Each action, its valid input, its DAL function, and the success the DAL answers. */
  const SUCCESSES = [
    {
      name: 'create',
      call: () => createProgramAction(createInput()),
      dal: createHouseholdProgram,
      answer: { ok: true, programPublicId: PROGRAM_ID },
    },
    {
      name: 'rename',
      call: () => renameProgramAction(renameInput()),
      dal: renameHouseholdProgram,
      answer: { ok: true },
    },
    {
      name: 'save',
      call: () => saveWorkoutAction(saveInput()),
      dal: saveHouseholdWorkout,
      answer: { ok: true, workoutPublicId: WORKOUT_ID },
    },
    {
      name: 'week',
      call: () => saveWeekAction(weekInput()),
      dal: saveHouseholdWeek,
      answer: { ok: true },
    },
    {
      name: 'copy',
      call: () => copyWorkoutAction(copyInput()),
      dal: copyHouseholdWorkout,
      answer: { ok: true, workoutPublicId: COPY_ID },
    },
    {
      name: 'new item',
      call: () => newItemAction(newItemInput()),
      dal: newHouseholdItem,
      answer: { ok: true, ...ITEM },
    },
    {
      // `existed: true` too, so an action that wrote `existed: false` itself would fail here.
      name: 'new item that existed',
      call: () => newItemAction(newItemInput()),
      dal: newHouseholdItem,
      answer: { ok: true, ...ITEM, existed: true },
    },
  ] as const;

  it.each(SUCCESSES)(
    '$name: a success revalidates the builder’s pages, once, as a layout',
    async ({ call }) => {
      await call();
      expect(vi.mocked(revalidatePath).mock.calls).toEqual([[PROGRAMS_PATH, 'layout']]);
    },
  );

  it.each(SUCCESSES)(
    '$name: the answer is built, not passed through: a field the DAL adds does not reach the client',
    async ({ call, dal, answer }) => {
      vi.mocked(dal).mockResolvedValueOnce({ ...answer, internalId: 42 } as never);
      expect(await call()).toEqual(answer);
    },
  );

  it.each([PROGRAM_REFUSAL.name_taken, PROGRAM_REFUSAL.invalid, PROGRAM_REFUSAL.retry])(
    'the writer’s %s passes through, with nothing revalidated',
    async (reason) => {
      vi.mocked(renameHouseholdProgram).mockResolvedValueOnce({ ok: false, reason });
      expect(await renameProgramAction(renameInput())).toEqual({ ok: false, reason });
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['week', PROGRAM_REFUSAL.once_per_day, saveHouseholdWeek, () => saveWeekAction(weekInput())],
    [
      'copy',
      PROGRAM_REFUSAL.name_taken,
      copyHouseholdWorkout,
      () => copyWorkoutAction(copyInput()),
    ],
    ['new item', PROGRAM_REFUSAL.retry, newHouseholdItem, () => newItemAction(newItemInput())],
  ] as const)(
    '%s: the writer’s %s passes through, with nothing revalidated (7a-ii)',
    async (_name, reason, dal, call) => {
      vi.mocked(dal).mockResolvedValueOnce({ ok: false, reason } as never);
      expect(await call()).toEqual({ ok: false, reason });
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );
});

describe('Put on and Take off (FAM-1 15)', () => {
  /**
   * What the mock cannot prove is proved where the writes are: a replay of a Put on is one effect
   * (an athlete already on it is skipped), a repeat Take off answers as the first, and a `from`
   * that is neither today nor tomorrow is `invalid` (lane P's `db:verify`,
   * `packages/db/scripts/verify/program.ts`). Here: the action hands the writer today, from the
   * active zone, and answers with what it said.
   */
  it('🔴 each hands the DAL the parsed input AND today, read from the active zone', async () => {
    await putOnAction({ ...putOnInput(), programPublicId: PROGRAM_ID.toUpperCase() });
    expect(vi.mocked(putOnHouseholdProgram).mock.calls).toEqual([[putOnInput(), TODAY]]);
    await takeOffAction(takeOffInput());
    expect(vi.mocked(takeOffHouseholdProgram).mock.calls).toEqual([[takeOffInput(), TODAY]]);
  });

  it.each([TODAY, null])(
    'Take off answers the writer’s lastDay (%s), never its own',
    async (day) => {
      vi.mocked(takeOffHouseholdProgram).mockResolvedValueOnce({
        ok: true,
        lastDay: day,
        since: '2026-11-01',
      } as never);
      expect(await takeOffAction(takeOffInput())).toEqual({ ok: true, lastDay: day });
    },
  );

  it('Put on answers ok and nothing else, whatever the DAL adds', async () => {
    vi.mocked(putOnHouseholdProgram).mockResolvedValueOnce({ ok: true, internalId: 4 } as never);
    expect(await putOnAction(putOnInput())).toEqual({ ok: true });
  });

  it('a success revalidates the builder, Home and the day page of every athlete it names', async () => {
    await putOnAction(putOnInput());
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([
      [PROGRAMS_PATH, 'layout'],
      [APP_HOME_PATH],
      [athletePath(PROFILE_ID)],
      [athletePath(OTHER_PROFILE_ID)],
    ]);
    vi.mocked(revalidatePath).mockClear();
    await takeOffAction(takeOffInput());
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([
      [PROGRAMS_PATH, 'layout'],
      [APP_HOME_PATH],
      [athletePath(PROFILE_ID)],
    ]);
  });

  it.each([
    ['put on', PROGRAM_REFUSAL.invalid, putOnHouseholdProgram, () => putOnAction(putOnInput())],
    [
      'take off',
      PROGRAM_REFUSAL.retry,
      takeOffHouseholdProgram,
      () => takeOffAction(takeOffInput()),
    ],
  ] as const)(
    '%s: the writer’s %s passes through, with nothing revalidated',
    async (_name, reason, dal, call) => {
      vi.mocked(dal).mockResolvedValueOnce({ ok: false, reason } as never);
      expect(await call()).toEqual({ ok: false, reason });
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );
});
