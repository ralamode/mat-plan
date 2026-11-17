import { and, eq, isNotNull } from 'drizzle-orm';

import { schema } from '../../client';

/**
 * The named conjuncts over a day's program rows (FAM-1 11b, moved here at 12a so a read does not
 * import a writer module). The row writer (`writers/day/log-row.ts`), the day resolver
 * (`./day-plan.ts`) and PREVIOUS (`./previous.ts`) all build on these.
 */

/**
 * **A row logged in a program**: `prescription_set IS NOT NULL`. "Logged in a program" is the SET,
 * which a purge never clears (see `schema.ts`); a weigh-in, a practice, a check-in and an old
 * strength entry all have none.
 */
export function programRow() {
  return isNotNull(schema.entries.prescriptionSet);
}

/**
 * **A program row of this athlete on this day**: `entries.profile_id`, `activity_date` and
 * {@link programRow}. One conjunct for the replay pin, `untickRow`, `retickRow` and the day
 * resolver's logged branch, so a weigh-in or a strength entry is never reached through the row
 * actions.
 */
export function programRowOf(profileId: number, day: string) {
  return and(
    eq(schema.entries.profileId, profileId),
    eq(schema.entries.activityDate, day),
    programRow(),
  );
}

/** The natural key of `SESSION_WORKOUT_DAY_UNIQUE_INDEX`. Callers add `deleted_at IS NULL`. */
export function workoutSessionSlot(profileId: number, day: string, workoutId: number) {
  return and(
    eq(schema.sessions.profileId, profileId),
    eq(schema.sessions.activityDate, day),
    eq(schema.sessions.workoutId, workoutId),
  );
}

/** The natural key of `SUPERSET_PRESCRIPTION_GROUP_UNIQUE_INDEX`. Callers add `deleted_at IS NULL`. */
export function workoutSupersetSlot(sessionId: number, group: string) {
  return and(
    eq(schema.supersets.sessionId, sessionId),
    eq(schema.supersets.prescriptionGroup, group),
  );
}

/** The natural key of `ENTRY_PRESCRIPTION_SET_UNIQUE_INDEX`. Callers add `deleted_at IS NULL`. */
export function programRowSlot(sessionId: number, prescriptionId: number, set: number) {
  return and(
    eq(schema.entries.sessionId, sessionId),
    eq(schema.entries.prescriptionId, prescriptionId),
    eq(schema.entries.prescriptionSet, set),
  );
}
