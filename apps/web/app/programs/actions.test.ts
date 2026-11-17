import { E2E_SESSION_BYPASS_USER, PROGRAM_REFUSAL, type ProgramActions } from '@mat-plan/shared';
import { heavyADraft } from '@mat-plan/shared/program/fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The program builder's actions (FAM-1 step 7a-i): the shared boundary matrices, then what they
 * cannot express — what zod refuses before the DAL, what a success returns and revalidates, and that
 * a refusal passes through with nothing revalidated.
 *
 * ⚠️ **What this layer can prove, and what it cannot.** The DAL is mocked, so "one effect on replay"
 * and "no write for another household's id" are proven where the writes are: lane P's `db:verify`
 * (`packages/db/scripts/verify/program.ts`: create's replay, save's replay, rename and save against
 * two households). Here: the action hands the DAL exactly the client's ids and answers with the
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
}));

import { revalidatePath } from 'next/cache';

import { PROGRAMS_PATH } from '@/components/program-builder/routes';
import {
  createHouseholdProgram,
  renameHouseholdProgram,
  saveHouseholdWorkout,
} from '@/lib/dal/program/writes';
import { describeActionMatrices } from '@/test/action-matrix';

import { createProgramAction, renameProgramAction, saveWorkoutAction } from './actions';
import { ACTION_REGISTRY } from './actions.registry';

const PRINCIPAL = E2E_SESSION_BYPASS_USER;
const PROFILE_ID = '019826b4-0000-7000-8000-000000000001';
const PROGRAM_ID = '019826b4-0000-7000-8000-0000000000a1';
const WORKOUT_ID = '019826b4-0000-7000-8000-0000000000b1';
const CLIENT_ID = '019826b4-0000-7000-8000-0000000000c1';

const createInput = () => ({ clientId: CLIENT_ID, name: 'Strength' });
const renameInput = () => ({ programPublicId: PROGRAM_ID, name: 'Strength II' });
const saveInput = () => structuredClone(heavyADraft);

const NOT_FOUND = { ok: false, reason: PROGRAM_REFUSAL.not_found } as const;

beforeEach(() => vi.clearAllMocks());

/**
 * The three actions are the contract's members: a parameter of `unknown` accepts the member's input,
 * and the answers match. (No `ProgramActions` object is assembled until all six exist, 7a-ii.)
 */
({
  createProgram: createProgramAction,
  renameProgram: renameProgramAction,
  saveWorkout: saveWorkoutAction,
}) satisfies Pick<ProgramActions, 'createProgram' | 'renameProgram' | 'saveWorkout'>;

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
  },
  validBody: {
    createProgramAction: createInput,
    renameProgramAction: renameInput,
    saveWorkoutAction: saveInput,
  },
});

describe('the program actions (FAM-1 7a-i)', () => {
  it.each([
    ['create, with no name', () => createProgramAction({ clientId: CLIENT_ID, name: '' })],
    ['create, with no client id', () => createProgramAction({ name: 'Strength' })],
    [
      'rename, with an id that is not a uuid',
      () => renameProgramAction({ programPublicId: 'x', name: 'A' }),
    ],
    ['save, a workout with no name', () => saveWorkoutAction({ ...saveInput(), name: ' ' })],
    ['save, not a draft at all', () => saveWorkoutAction('a string')],
  ])('%s is invalid, and the DAL is never called', async (_label, call) => {
    expect(await call()).toEqual({ ok: false, reason: PROGRAM_REFUSAL.invalid });
    expect(createHouseholdProgram).not.toHaveBeenCalled();
    expect(renameHouseholdProgram).not.toHaveBeenCalled();
    expect(saveHouseholdWorkout).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
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
});
