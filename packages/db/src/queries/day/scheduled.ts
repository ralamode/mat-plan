import { localWeekday } from '@mat-plan/shared';
import { and, eq, isNull } from 'drizzle-orm';

import { schema } from '../../client';

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
  // OWED(step 5): the assignment conjunct, "the athlete is on this block on this day"
  // (`program_assignments`, FAM-1 plan §5 step 5; 11b plan step 8, patch P20, proof 6d). The table
  // does not exist yet, so a workout on the week answers as scheduled for ANY athlete of the
  // household. 11b merges only after step 5 is applied (plan M7), and this conjunct lands with it.
  return and(
    eq(schema.blockDayWorkouts.blockId, blockId),
    eq(schema.blockDayWorkouts.workoutId, workoutId),
    eq(schema.blockDayWorkouts.weekday, localWeekday(day)),
    isNull(schema.blockDayWorkouts.deletedAt),
  );
}
