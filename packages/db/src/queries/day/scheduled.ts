import { addDays, localWeekday } from '@mat-plan/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { schema } from '../../client';
import type { HouseholdScope } from '../../scope';
import type { Executor } from '../../writers/executor';
import { liveAthleteTemplateBlockIn } from '../../writers/ownership';
import { assignmentCurrentAsOf, assignmentOnDay } from '../program-assignments';

/**
 * **A live week slot on the day's weekday**, any block, any workout: the half of `scheduledOn` that
 * does not name a workout. The day resolver lists a block's slots through it (`weekSlotsOn`).
 */
export function weekSlotOn(day: string) {
  return and(
    eq(schema.blockDayWorkouts.weekday, localWeekday(day)),
    isNull(schema.blockDayWorkouts.deletedAt),
  );
}

/**
 * **Is this workout on its block's week on this day?** One rule for the row writer
 * (`writers/day/log-row.ts`: a ✓ and an un-tick), the day resolver's `scheduled` flag (12a) and the
 * amend (11c), as a conjunct over `block_day_workouts`: a live slot of `blockId` on the day's
 * weekday that holds `workoutId`.
 *
 * The weekday is the row's day through `localWeekday` (plan M3), never the server's clock: `day` is
 * already the athlete's local calendar date.
 *
 * ⚠️ `blockId` must be the workout's own block. The composite FK
 * (`block_day_workouts_workout_block_fkey`) already makes a slot's workout belong to its block, so
 * the two equalities cannot disagree with each other; they can only both be wrong.
 *
 * Use it in a `WHERE` over `block_day_workouts` (the writer reads `limit 1`), or as the `ON` of a
 * join (12a).
 */
export function scheduledOn(blockId: number, workoutId: number, day: string) {
  return and(
    eq(schema.blockDayWorkouts.blockId, blockId),
    eq(schema.blockDayWorkouts.workoutId, workoutId),
    weekSlotOn(day),
  );
}

/**
 * `scheduledOn` as an answer: does a live week slot hold this workout on this day? The writer's ✓
 * and un-tick both ask it this way.
 */
export async function isScheduledOn(
  exec: Executor,
  blockId: number,
  workoutId: number,
  day: string,
): Promise<boolean> {
  const [slot] = await exec
    .select({ id: schema.blockDayWorkouts.id })
    .from(schema.blockDayWorkouts)
    .where(scheduledOn(blockId, workoutId, day))
    .limit(1);
  return slot !== undefined;
}

/**
 * **Is this athlete on this program on this day?** FAM-1 11b plan step 8 (§5: "a template block
 * the athlete is on that day"), through step 5's one spelling of the range, `assignmentOnDay`
 * (`queries/program-assignments.ts`), never a re-typed `active_to` comparison.
 *
 * It judges the assignment row only. The caller has already proved the athlete live and in scope
 * (`isLiveProfile`) and the block a live template block of the same household (`rowWorkout`), which
 * is the parent rule `assignmentOnDay`'s docblock asks for.
 *
 * ⚠️ **On the program, not due on the weekday.** It uses `assignmentOnDay`, not `assignmentDueOn`:
 * the plan's rule is "on that day", and every put-on writes all seven weekday rows (§5 step 6c), so
 * the two agree for every assignment FAM-1 makes. If ASSIGN-1 lets an athlete drop weekdays, this
 * and 12a's resolver move to `assignmentDueOn` together, or the page and the ✓ disagree.
 */
export async function isOnProgramThatDay(
  exec: Executor,
  profileId: number,
  blockId: number,
  day: string,
): Promise<boolean> {
  const a = schema.programAssignments;
  const [row] = await exec
    .select({ id: a.id })
    .from(a)
    .where(and(onProgramOn(profileId, day), eq(a.blockId, blockId)))
    .limit(1);
  return row !== undefined;
}

/**
 * **This athlete's assignment rows that are on `day`** (`assignmentOnDay`, step 5's one spelling of
 * the range), any program. One conjunct for the row writer's step 8 (`isOnProgramThatDay`, which adds
 * the block) and the day resolver (`dayAssignments`: `onProgram`, `programs` and `canGoForward`), so
 * the page and the ✓ agree on who is on what. When ASSIGN-1 moves to `assignmentDueOn`, it moves
 * here, once.
 *
 * It judges the assignment row only; a reader adds the live parents and the scope (E1).
 */
export function onProgramOn(profileId: number, day: string) {
  return and(eq(schema.programAssignments.profileId, profileId), assignmentOnDay(day));
}

/** One of the athlete's live assignment rows, on a live template block of the scope. */
export type DayAssignment = {
  id: number;
  blockId: number;
  programPublicId: string;
  programName: string;
  idx: number;
  activeFrom: string;
  activeTo: string | null;
  /** On the viewed day (`onProgramOn`). */
  onDay: boolean;
  /** Current as of today: on it now or starting later (`assignmentCurrentAsOf`). */
  current: boolean;
  /** On the day after the viewed one: look-ahead (`canGoForward`). */
  onNextDay: boolean;
};

/**
 * **The day resolver's assignment read** (FAM-1 12a, decision E1's live anchor): every live
 * assignment row of the athlete whose block is a live template block of the scope AND of the
 * athlete's own household (`liveAthleteTemplateBlockIn`), with three flags. One query, in `(idx, id)` order.
 *
 * So a hidden program, a program of another household (runbook pre-flight (h)) and a hidden
 * assignment are on nothing: not on the day, not current, not ahead. Kept in this file, beside
 * `isOnProgramThatDay`, so the step-5 tables are named in one lane E module
 * (`program-tables-stay-dark.test.ts`).
 *
 * Takes the internal profile id the caller has already proved live in `scope`.
 */
export async function dayAssignments(
  exec: Executor,
  scope: HouseholdScope,
  profileId: number,
  dates: { day: string; today: string },
): Promise<DayAssignment[]> {
  const a = schema.programAssignments;
  const b = schema.programBlocks;
  const flag = (condition: ReturnType<typeof and>) => sql<boolean>`coalesce(${condition}, false)`;
  return exec
    .select({
      id: a.id,
      blockId: a.blockId,
      programPublicId: b.publicId,
      programName: b.name,
      idx: a.idx,
      activeFrom: a.activeFrom,
      activeTo: a.activeTo,
      onDay: flag(onProgramOn(profileId, dates.day)),
      current: flag(assignmentCurrentAsOf(dates.today)),
      onNextDay: flag(onProgramOn(profileId, addDays(dates.day, 1))),
    })
    .from(a)
    .innerJoin(b, eq(b.id, a.blockId))
    .where(
      and(
        eq(a.profileId, profileId),
        isNull(a.deletedAt),
        liveAthleteTemplateBlockIn(scope, profileId),
      ),
    )
    .orderBy(asc(a.idx), asc(a.id));
}

/** A live week slot of one of the day's blocks, with its live workout. */
export type WeekSlot = {
  blockId: number;
  idx: number;
  label: string | null;
  workoutId: number;
  workoutPublicId: string;
  name: string;
  description: string | null;
};

/**
 * **The week slots of `blockIds` on the day's weekday** (`weekSlotOn`, the half of `scheduledOn` that
 * does not name a workout), each with its LIVE workout, in `(block, idx)` order. The blocks are the
 * caller's, already proved live and in scope by `dayAssignments`; the composite FK
 * (`block_day_workouts_workout_block_fkey`) makes each slot's workout its block's own.
 */
export async function weekSlotsOn(
  exec: Executor,
  blockIds: readonly number[],
  day: string,
): Promise<WeekSlot[]> {
  if (blockIds.length === 0) return [];
  const s = schema.blockDayWorkouts;
  const w = schema.workouts;
  return exec
    .select({
      blockId: s.blockId,
      idx: s.idx,
      label: s.label,
      workoutId: w.id,
      workoutPublicId: w.publicId,
      name: w.name,
      description: w.description,
    })
    .from(s)
    .innerJoin(w, and(eq(w.id, s.workoutId), isNull(w.deletedAt)))
    .where(and(inArray(s.blockId, [...blockIds]), weekSlotOn(day)))
    .orderBy(asc(s.blockId), asc(s.idx));
}
