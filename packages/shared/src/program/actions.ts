import { z } from 'zod';

import { keyBySelf } from '../enums';
import type { TrackingType } from '../movements';
import type { RowAmend, RowResult, RowRetick, RowUntick, RowWrite } from './day-shapes';
import type {
  AssignDraft,
  CopyDraft,
  CreateProgram,
  NewItem,
  ProgramOrder,
  RenameProgram,
  TakeOff,
  WeekDraft,
  WorkoutDraft,
} from './program-shapes';

/**
 * The actions objects (FAM-1 plan §4): **the only way a screen writes.** A route mounts one screen
 * with the contract's data and one of these. The preview route passes in-memory fakes of both; a
 * production route passes the real actions it has, never a mix.
 *
 * **An optional member the wiring has not supplied is `undefined`, and the screen hides its
 * control.** The members marked `?` are the ones wired after the screen first ships.
 *
 * Every member resolves a typed result. None throws for a refusal.
 */

/** Why a program write did not happen. */
export const PROGRAM_REFUSALS = [
  'name_taken',
  'invalid',
  'not_found',
  'once_per_day',
  'retry',
] as const;
export type ProgramRefusal = (typeof PROGRAM_REFUSALS)[number];
export const programRefusalSchema = z.enum(PROGRAM_REFUSALS);
export const PROGRAM_REFUSAL = keyBySelf(PROGRAM_REFUSALS);

/** What a program write resolves to: `{ ok: true }` plus what it made, or a typed refusal. */
export type ProgramResult<T extends object = object> =
  ({ ok: true } & T) | { ok: false; reason: ProgramRefusal };

/**
 * Each member's input has a schema in `./program-shapes` (`createProgramSchema`,
 * `renameProgramSchema`, `saveWorkoutSchema`, `weekDraftSchema`, `copyDraftSchema`, `newItemSchema`,
 * `assignDraftSchema`, `takeOffSchema`). A fake and a real action both parse with it and answer
 * `invalid` when it fails, so a screen sees the same refusal on the preview route and in production.
 */
export interface ProgramActions {
  /** A program is created by naming it. `clientId` is one create attempt; a retry reuses it. */
  createProgram(input: CreateProgram): Promise<ProgramResult<{ programPublicId: string }>>;
  renameProgram(input: RenameProgram): Promise<ProgramResult>;
  /** Parsed by `saveWorkoutSchema`: the draft, with a name. */
  saveWorkout(draft: WorkoutDraft): Promise<ProgramResult<{ workoutPublicId: string }>>;
  saveWeek(draft: WeekDraft): Promise<ProgramResult>;
  copyWorkout(draft: CopyDraft): Promise<ProgramResult<{ workoutPublicId: string }>>;
  /** A name that already exists selects that item: `existed` is true and `trackingType` is its own. */
  newItem(
    input: NewItem,
  ): Promise<ProgramResult<{ itemPublicId: string; trackingType: TrackingType; existed: boolean }>>;
  putOn?(draft: AssignDraft): Promise<ProgramResult>;
  takeOff?(input: TakeOff): Promise<ProgramResult>;
}

export interface DayActions {
  logRow(input: RowWrite): Promise<RowResult>;
  /** Resolves with the `hiddenAt` token a re-tick needs. */
  untickRow(input: RowUntick): Promise<RowResult>;
  retickRow(input: RowRetick): Promise<RowResult>;
  amendRow?(input: RowAmend): Promise<RowResult>;
  /**
   * Resolves a `ProgramResult`, not a `RowResult`: a reorder touches no entry, so it has no
   * `entryPublicId` to answer with, and its refusals are the program writers'. A list that is not a
   * permutation of the athlete's `currentPrograms` answers `invalid`.
   */
  reorderPrograms?(input: ProgramOrder): Promise<ProgramResult>;
}
