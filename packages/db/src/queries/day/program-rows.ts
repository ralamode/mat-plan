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

/**
 * **Which program item a logged row belongs to** (R4, FAM-1 12a): its prescription, or, once an ADR
 * 0008 purge has cleared `prescription_id` (`schema.ts`, "Logged in a program"), its movement. The day
 * resolver groups a removed item's rows by it, and the export folds a program row by it (step 14),
 * so the two cannot disagree about what one item is.
 *
 * ⚠️ Two purged prescriptions of the SAME movement share a key: nothing is left to tell them apart.
 */
export function programItemKey(row: {
  prescriptionId: number | null;
  movementId: number | null;
}): string {
  return row.prescriptionId !== null ? `p:${row.prescriptionId}` : `m:${row.movementId}`;
}

/** The fields {@link byFirstLogged} orders by: the row's set, when it was logged, and its id. */
export type FirstLoggedFields = { set: number | null; createdAt: Date; id: number };

/**
 * The order "first logged" means for program rows: the lowest set first when `bySet`, then the
 * earliest `created_at`, then the lowest id. The day resolver's heading and removed items, and the
 * export's fold, all sort with it.
 */
export function byFirstLogged(bySet = false) {
  return (x: FirstLoggedFields, y: FirstLoggedFields): number =>
    (bySet ? (x.set ?? 0) - (y.set ?? 0) : 0) ||
    x.createdAt.getTime() - y.createdAt.getTime() ||
    x.id - y.id;
}

/**
 * **The entry's session is its own athlete's** (runbook pre-flight (i); `day-writers.md` invariant 13):
 * `sessions.profile_id = entries.profile_id`, for a read that joins `entries` to `sessions`. Change's
 * locked read (`writers/day/amend-row.ts`) puts it in the WHERE, refusing a row in another athlete's
 * session; the export (`queries/export-month.ts`) puts it in the sessions join's ON, keeping the
 * athlete's entry and lending it nothing. Mutations 351 and 365 drop it at each site.
 */
export function entrySessionIsItsAthletes() {
  return eq(schema.sessions.profileId, schema.entries.profileId);
}
