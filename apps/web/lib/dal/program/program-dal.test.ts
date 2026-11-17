import { PROGRAM_REFUSAL } from '@mat-plan/shared';
import { heavyADraft } from '@mat-plan/shared/program/fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../db', () => ({ db: { the: 'db' } }));
vi.mock('../household', () => ({ getHouseholdScope: vi.fn() }));
vi.mock('@mat-plan/db', () => ({
  createProgram: vi.fn(async () => ({ ok: true, programPublicId: PROGRAM_ID })),
  renameProgram: vi.fn(async () => ({ ok: true })),
  saveWorkout: vi.fn(async () => ({ ok: true, workoutPublicId: WORKOUT_ID })),
  readWorkoutDraft: vi.fn(async () => null),
}));

import { createProgram, readWorkoutDraft, renameProgram, saveWorkout } from '@mat-plan/db';

import { db } from '../db';
import { getHouseholdScope } from '../household';
import { ProgramWriteError } from './quiet-db-errors';
import { getWorkoutDraft } from './reads';
import { createHouseholdProgram, renameHouseholdProgram, saveHouseholdWorkout } from './writes';

const PROGRAM_ID = '019826b4-0000-7000-8000-0000000000a1';
const WORKOUT_ID = '019826b4-0000-7000-8000-0000000000b1';
const SCOPE = { householdId: 7 } as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getHouseholdScope).mockResolvedValue(SCOPE);
});

describe('the program DAL (FAM-1 7a-i)', () => {
  it('each write goes through the caller’s own household scope, with the parsed input', async () => {
    const input = { clientId: '019826b4-0000-7000-8000-0000000000c1', name: 'Strength' };
    await createHouseholdProgram(input);
    expect(vi.mocked(createProgram).mock.calls[0]![0]).toBe(db);
    expect(vi.mocked(createProgram).mock.calls[0]![1]).toBe(SCOPE);
    expect(vi.mocked(createProgram).mock.calls[0]![2]).toBe(input);
    await renameHouseholdProgram({ programPublicId: PROGRAM_ID, name: 'A' });
    expect(vi.mocked(renameProgram).mock.calls[0]![1]).toBe(SCOPE);
    await saveHouseholdWorkout(heavyADraft);
    expect(vi.mocked(saveWorkout).mock.calls[0]![1]).toBe(SCOPE);
  });

  it('no household is not_found, and no writer runs', async () => {
    vi.mocked(getHouseholdScope).mockResolvedValue(null);
    expect(await saveHouseholdWorkout(heavyADraft)).toEqual({
      ok: false,
      reason: PROGRAM_REFUSAL.not_found,
    });
    expect(await createHouseholdProgram({ clientId: WORKOUT_ID, name: 'A' })).toEqual({
      ok: false,
      reason: PROGRAM_REFUSAL.not_found,
    });
    expect(saveWorkout).not.toHaveBeenCalled();
    expect(createProgram).not.toHaveBeenCalled();
  });

  it('a writer’s refusal comes back unchanged', async () => {
    vi.mocked(renameProgram).mockResolvedValueOnce({
      ok: false,
      reason: PROGRAM_REFUSAL.name_taken,
    });
    expect(await renameHouseholdProgram({ programPublicId: PROGRAM_ID, name: 'A' })).toEqual({
      ok: false,
      reason: PROGRAM_REFUSAL.name_taken,
    });
  });

  it('a writer that throws is rethrown without its data (the runtime log)', async () => {
    vi.mocked(saveWorkout).mockRejectedValueOnce(
      Object.assign(new Error('Failed query: insert …\nparams: knee sore'), { code: '57014' }),
    );
    const thrown = await saveHouseholdWorkout(heavyADraft).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(ProgramWriteError);
    expect(String(thrown)).not.toContain('knee sore');
  });

  it('the editor’s read: a non-uuid id is null with no query; else through the scope', async () => {
    expect(await getWorkoutDraft('not-a-uuid', WORKOUT_ID)).toBeNull();
    expect(await getWorkoutDraft(PROGRAM_ID, '7')).toBeNull();
    expect(readWorkoutDraft).not.toHaveBeenCalled();
    expect(getHouseholdScope).not.toHaveBeenCalled();
    await getWorkoutDraft(PROGRAM_ID, WORKOUT_ID);
    expect(vi.mocked(readWorkoutDraft).mock.calls[0]).toEqual([
      db,
      SCOPE,
      { programPublicId: PROGRAM_ID, workoutPublicId: WORKOUT_ID },
    ]);
  });

  it('the editor’s read with no household is null, with no query', async () => {
    vi.mocked(getHouseholdScope).mockResolvedValue(null);
    expect(await getWorkoutDraft(PROGRAM_ID, WORKOUT_ID)).toBeNull();
    expect(readWorkoutDraft).not.toHaveBeenCalled();
  });
});
