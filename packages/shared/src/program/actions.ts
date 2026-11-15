import { z } from 'zod';

import { keyBySelf } from '../enums';
import type { TrackingType } from '../movements';
import type { RowAmend, RowResult, RowRetick, RowUntick, RowWrite } from './day-shapes';
import type {
  AssignDraft,
  CopyDraft,
  ProgramOrder,
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

export interface ProgramActions {
  /** `clientId` is one create attempt; a retry reuses it. `name` is `programNameSchema`'s. */
  createProgram(input: {
    clientId: string;
    name: string;
  }): Promise<ProgramResult<{ programPublicId: string }>>;
  renameProgram(input: { programPublicId: string; name: string }): Promise<ProgramResult>;
  saveWorkout(draft: WorkoutDraft): Promise<ProgramResult<{ workoutPublicId: string }>>;
  saveWeek(draft: WeekDraft): Promise<ProgramResult>;
  copyWorkout(draft: CopyDraft): Promise<ProgramResult<{ workoutPublicId: string }>>;
  /** A name that already exists selects that item: `existed` is true and `trackingType` is its own. */
  newItem(input: {
    name: string;
    trackingType: TrackingType;
  }): Promise<
    ProgramResult<{ itemPublicId: string; trackingType: TrackingType; existed: boolean }>
  >;
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
   * `entryPublicId` to answer with, and its refusals are the program writers'.
   */
  reorderPrograms?(input: ProgramOrder): Promise<ProgramResult>;
}
