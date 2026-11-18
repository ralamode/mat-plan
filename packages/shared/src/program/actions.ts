import { z } from 'zod';

import { keyBySelf } from '../enums';
import type { TrackingType } from '../movements';
import type { RowAmend, RowRefusal, RowResult, RowRetick, RowUntick, RowWrite } from './day-shapes';
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

/**
 * Why a program write did not happen.
 *
 * `limit_reached` (contract change C35): the write would take the household's own items, a
 * program's workouts or a weekday's workouts past its cap (`MAX_HOUSEHOLD_ITEMS`,
 * `MAX_PROGRAM_WORKOUTS`, `MAX_DAY_SLOTS` in `./program-shapes`). Its own word, because `invalid` reads as "something you typed is wrong" and
 * a screen marks a field for it.
 */
export const PROGRAM_REFUSALS = [
  'name_taken',
  'invalid',
  'not_found',
  'once_per_day',
  'limit_reached',
  'retry',
] as const;
export type ProgramRefusal = (typeof PROGRAM_REFUSALS)[number];
export const programRefusalSchema = z.enum(PROGRAM_REFUSALS);
export const PROGRAM_REFUSAL = keyBySelf(PROGRAM_REFUSALS);

/** What a program write resolves to: `{ ok: true }` plus what it made, or a typed refusal. */
export type ProgramResult<T extends object = object> =
  ({ ok: true } & T) | { ok: false; reason: ProgramRefusal };

/**
 * **What a transport answers before the action's own work starts**, in the contract's words. A
 * transport is whatever carries a call to an action: the web app's Server Actions today
 * (`enterMutation`, `apps/web/app/p/mutation-entry.ts`), an API route later. Each one checks the
 * caller, then the rate limit, then hands the input to the schema; these are the two refusals that
 * can come out of the first two checks.
 *
 * - **No session answers `not_found`**, the same answer as an id from another household and an id
 *   that does not exist. A caller must not be able to tell the three apart (ADR 0006: 404, never
 *   403), so there is no "signed out" or "forbidden" member in either refusal list, and none may be
 *   added for this.
 * - **Over the rate limit answers `retry`.** The limit is checked before the input is parsed and
 *   before anything is read or written, so nothing happened and the same `clientId` may be sent
 *   again.
 *
 * Both words are members of `PROGRAM_REFUSALS` and of `ROW_REFUSALS` (the `satisfies` below is that
 * check), so one refusal value is a valid `ProgramResult` and a valid `RowResult`.
 *
 * An input the schema refuses is the action's own answer, after these: `invalid` for a program
 * write, `bad_value` for a row write.
 */
export const TRANSPORT_REFUSALS = {
  noSession: 'not_found',
  rateLimited: 'retry',
} as const satisfies Record<string, ProgramRefusal & RowRefusal>;

/** A transport's refusal: assignable to every `ProgramResult` and to `RowResult`. */
export type TransportRefusal = {
  ok: false;
  reason: (typeof TRANSPORT_REFUSALS)[keyof typeof TRANSPORT_REFUSALS];
};

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
  /**
   * A name that already names an item selects that item: `existed` is true, and `name` and
   * `trackingType` are the item's own, not what was typed.
   *
   * **"Already names an item" is the picker's rule, the same on the server as in the picker**
   * (`existingItem` in `./pieces`): the typed name has the same key as an item's name (`push ups`
   * is Push-ups), or the same key as one of its aliases (`RDL` is Romanian Deadlift). Either selects
   * that item. It is never a refusal and never a second item: a household must not end up with an
   * item called "RDL" beside Romanian Deadlift because a stale page or a direct call got past the
   * picker, which withholds "add as new" for both cases.
   *
   * `name` is on every success, so the caller shows the stored name without looking it up: the item
   * may not be in the list the page loaded, and the typed text is not the stored name (`' rdl '`).
   */
  newItem(input: NewItem): Promise<
    ProgramResult<{
      itemPublicId: string;
      name: string;
      trackingType: TrackingType;
      existed: boolean;
    }>
  >;
  putOn?(draft: AssignDraft): Promise<ProgramResult>;
  /**
   * Resolves what it did, so the screen can say it truthfully (`takeOffSchema` has the rule):
   * `lastDay` is the day the athlete stays on through (today), or `null` when the start was removed
   * and they were never on it. A start dated today can be either, so the screen cannot tell from
   * `since` alone.
   */
  takeOff?(input: TakeOff): Promise<ProgramResult<{ lastDay: string | null }>>;
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
