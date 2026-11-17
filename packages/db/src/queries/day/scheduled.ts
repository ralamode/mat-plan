import { localWeekday } from '@mat-plan/shared';
import { and, eq, isNull } from 'drizzle-orm';

import { schema } from '../../client';
import type { Executor } from '../../writers/executor';
import { assignmentOnDay } from '../program-assignments';

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
    eq(schema.blockDayWorkouts.weekday, localWeekday(day)),
    isNull(schema.blockDayWorkouts.deletedAt),
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
    .where(and(eq(a.profileId, profileId), eq(a.blockId, blockId), assignmentOnDay(day)))
    .limit(1);
  return row !== undefined;
}
