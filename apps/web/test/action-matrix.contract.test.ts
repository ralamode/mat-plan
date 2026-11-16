import {
  PROGRAM_REFUSAL,
  ROW_REFUSAL,
  TRANSPORT_REFUSALS,
  type ProgramResult,
  type RowResult,
} from '@mat-plan/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
  RedirectType: { replace: 'replace', push: 'push' },
}));
vi.mock('@/lib/dal/session', () => ({
  sessionUserOrNull: vi.fn(async () => ({ userId: PRINCIPAL })),
}));
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  checkMutationLimit: vi.fn(async () => ({ allowed: true, reason: 'ok' })),
}));
vi.mock('@/lib/dal/profiles', () => ({
  getProfileByPublicId: vi.fn(async () => ({ id: PROFILE_ID })),
}));

import { revalidatePath } from 'next/cache';

import type { ActionState } from '@/app/p/[profileId]/action-state';
import { ACTION_SCOPE, type ActionRegistry } from '@/app/p/[profileId]/mutating-actions';
import { enterMutation } from '@/app/p/mutation-entry';
import { NO_PROFILE_LOG } from '@/lib/constants';
import { getProfileByPublicId } from '@/lib/dal/profiles';
import { sessionUserOrNull } from '@/lib/dal/session';
import { checkMutationLimit, ROW_WRITE_RATE_LIMIT } from '@/lib/rate-limit';

import { describeMatrixRows } from './action-matrix';

/**
 * 🔴 **The matrices drive an action that speaks the FAM-1 contract** (contract change C7).
 *
 * Until C7 the matrix called every action as `(state, formData)` and compared `{ ok, error }`. The
 * first real contract actions (the program builder's, the day page's row writes) take one typed
 * input and resolve a `ProgramResult` or a `RowResult`, so they could not have run the mandatory
 * unauth, rate-limit and wrong-owner rows at all.
 *
 * No such action exists yet, and a `'use server'` fixture would be a real public endpoint. So the
 * three actions below are plain functions in this file that enter through the **real**
 * `enterMutation` (its dependencies are mocked, as in every module's own test) and are driven by
 * `describeMatrixRows`, the same rows `describeActionMatrices` registers for a module. One is
 * profile-addressed and resolves a `RowResult` under the row-write limit, one is
 * household-addressed and resolves a `ProgramResult`, and one is a form action, so a module that
 * holds both envelopes is covered too.
 *
 * ⚠️ What this cannot show is the three checks that tie the rows to a module on disk; those run in
 * every real module's test and are unchanged.
 */
const PRINCIPAL = 'user_wellShapedButNotTheFixture00';
const PROFILE_ID = '019826b4-0000-7000-8000-000000000001';
const PROGRAM_ID = '019826b4-0000-7000-8000-0000000000a1';
const ENTRY_ID = '019826b4-0000-7000-8000-0000000000e1';

/** The writers, standing in for a module's mocked DAL. `false` is "no household, or not yours". */
const writeRow = vi.fn(async (_profileId: string, _value: number) => ENTRY_ID);
const renameProgram = vi.fn(async (_programId: string, _name: string): Promise<boolean> => true);
const saveNote = vi.fn(async (_profileId: string, _note: string) => undefined);

/** Profile-addressed, a `RowResult`, counted against the row-write limit. */
async function logRowAction(input: { profilePublicId: string; value: number }): Promise<RowResult> {
  const entry = await enterMutation(TRANSPORT_REFUSALS, ROW_WRITE_RATE_LIMIT);
  if (!entry.ok) return entry;
  if (!Number.isFinite(input.value)) return { ok: false, reason: ROW_REFUSAL.bad_value };
  const profile = await getProfileByPublicId(input.profilePublicId);
  if (!profile) return { ok: false, reason: ROW_REFUSAL.not_found };
  const entryPublicId = await writeRow(input.profilePublicId, input.value);
  revalidatePath(`/p/${input.profilePublicId}`);
  return { ok: true, entryPublicId, values: { quantities: [] } };
}

/** Household-addressed (it names a program, not a profile), a `ProgramResult`, the default limit. */
async function renameProgramAction(input: {
  programPublicId: string;
  name: string;
}): Promise<ProgramResult> {
  const entry = await enterMutation(TRANSPORT_REFUSALS);
  if (!entry.ok) return entry;
  if (!input.name.trim()) return { ok: false, reason: PROGRAM_REFUSAL.invalid };
  const renamed = await renameProgram(input.programPublicId, input.name);
  if (!renamed) return { ok: false, reason: PROGRAM_REFUSAL.not_found };
  revalidatePath('/programs');
  return { ok: true };
}

/** A form action beside them: one registry may hold both envelopes. */
async function saveNoteAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const entry = await enterMutation(NO_PROFILE_LOG);
  if (!entry.ok) return entry;
  const profileId = String(formData.get('profileId') ?? '');
  const note = String(formData.get('note') ?? '');
  if (!note) return { ok: false, error: 'Write a note.' };
  const profile = await getProfileByPublicId(profileId);
  if (!profile) return { ok: false, error: NO_PROFILE_LOG };
  await saveNote(profileId, note);
  revalidatePath(`/p/${profileId}`);
  return { ok: true, error: null };
}

const REGISTRY = {
  logRowAction: { refusal: TRANSPORT_REFUSALS, scope: ACTION_SCOPE.profile },
  renameProgramAction: { refusal: TRANSPORT_REFUSALS, scope: ACTION_SCOPE.household },
  saveNoteAction: { refusal: NO_PROFILE_LOG, scope: ACTION_SCOPE.profile },
} as const satisfies ActionRegistry;

const rowInput = () => ({ profilePublicId: PROFILE_ID, value: 30 });
const renameInput = () => ({ programPublicId: PROGRAM_ID, name: 'Strength' });
const noteBody = () => {
  const fd = new FormData();
  fd.append('profileId', PROFILE_ID);
  fd.append('note', 'felt strong');
  return fd;
};

beforeEach(() => vi.clearAllMocks());

describeMatrixRows(
  {
    registry: REGISTRY,
    profileId: PROFILE_ID,
    principal: PRINCIPAL,
    bindings: {
      logRowAction: { fn: logRowAction, writers: [writeRow], limit: ROW_WRITE_RATE_LIMIT },
      renameProgramAction: {
        fn: renameProgramAction,
        writers: [renameProgram],
        scopeMiss: () => renameProgram.mockResolvedValueOnce(false),
      },
      saveNoteAction: { fn: saveNoteAction, writers: [saveNote] },
    },
    validBody: {
      logRowAction: rowInput,
      renameProgramAction: renameInput,
      saveNoteAction: noteBody,
    },
  },
  'actions that speak the FAM-1 contract (defined in this test)',
  () => {},
);

/**
 * The rows above assert through the registry. These say the same three answers in literals, once,
 * so the words themselves are pinned where an action author reads them.
 */
describe('what a contract action answers before its own work', () => {
  it('no session: `not_found`, in the contract envelope, and nothing was read or written', async () => {
    vi.mocked(sessionUserOrNull).mockResolvedValueOnce(null);
    expect(await logRowAction(rowInput())).toEqual({ ok: false, reason: 'not_found' });
    expect(checkMutationLimit).not.toHaveBeenCalled();
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(writeRow).not.toHaveBeenCalled();
  });

  it('over the limit: `retry`, and nothing was read or written', async () => {
    vi.mocked(checkMutationLimit).mockResolvedValueOnce({ allowed: false, reason: 'limited' });
    expect(await renameProgramAction(renameInput())).toEqual({ ok: false, reason: 'retry' });
    expect(renameProgram).not.toHaveBeenCalled();
  });

  it('a profile from another household: the same bytes as no session', async () => {
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce(null);
    const foreign = await logRowAction(rowInput());
    vi.mocked(sessionUserOrNull).mockResolvedValueOnce(null);
    expect(foreign).toEqual(await logRowAction(rowInput()));
    expect(writeRow).not.toHaveBeenCalled();
  });

  it('a bad input is the action’s own answer, after the entry: it still costs a limiter call', async () => {
    expect(await logRowAction({ profilePublicId: PROFILE_ID, value: Number.NaN })).toEqual({
      ok: false,
      reason: 'bad_value',
    });
    expect(checkMutationLimit).toHaveBeenCalledTimes(1);
    expect(writeRow).not.toHaveBeenCalled();
  });
});
