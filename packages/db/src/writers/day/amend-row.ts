import {
  fillRowValues,
  loggedRowUnit,
  ROW_REFUSAL,
  type RowAmend,
  type RowResult,
} from '@mat-plan/shared';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { Schema } from '../../client';
import { schema } from '../../client';
import { rowDayOpen } from '../../queries/day/day-window';
import { programRow } from '../../queries/day/program-rows';
import { isScheduledOn } from '../../queries/day/scheduled';
import type { HouseholdScope } from '../../scope';
import { updateEntrySetRows } from '../session-rows';
import { rowWorkout } from './log-row';
import { openProfile, refuse, rowItem, rowTransaction, storedValues } from './row-steps';

/**
 * FAM-1 step 11c-i — **Change**: correct a logged program row's numbers in place, on today or
 * yesterday (D20). The plan is
 * [fam-1-11c-change-and-revive.md](../../../../../docs/plans/fam-1-11c-change-and-revive.md) (A1–A8);
 * the invariants are in [day-writers.md](../../../../../docs/features/day-writers.md).
 *
 * `input` is parsed by `rowAmendSchema` in the action (12d), as 12b parses a ✓. It names an entry
 * and its new numbers, and no day: the window is the entry's own day.
 *
 * **The order is the fake's** (`fakes.ts` `amendRow`): not this athlete's, or hidden → `not_found`;
 * the day → `closed_day`; the workout off the week → `not_scheduled`; the program changed →
 * `program_changed`; the values → `bad_value`. `retry` is never answered here.
 */
export async function amendRow(
  db: NodePgDatabase<Schema>,
  args: {
    scope: HouseholdScope;
    /** The athlete's today, from the action; never computed here. */
    today: string;
    input: RowAmend;
  },
): Promise<RowResult> {
  const { scope, input } = args;
  return rowTransaction(db, async (tx) => {
    // 1 — the profile, inside the scope.
    const profile = await openProfile(tx, { scope, profilePublicId: input.profilePublicId });

    // 2 — the entry, in ONE scoped and locked read (A2): this athlete's, a program row, in the
    //     athlete's own session (runbook pre-flight (i)). Every check below reads THIS row, so an
    //     un-tick that commits first is seen here as hidden, never slipped in between check and write.
    //     `FOR UPDATE OF entries`, the lock `hideRows` takes, so the two serialise.
    const [entry] = await tx
      .select({
        id: schema.entries.id,
        deletedAt: schema.entries.deletedAt,
        day: schema.entries.activityDate,
        prescriptionId: schema.entries.prescriptionId,
        workoutId: schema.sessions.workoutId,
      })
      .from(schema.entries)
      .innerJoin(schema.sessions, eq(schema.sessions.id, schema.entries.sessionId))
      .where(
        and(
          eq(schema.entries.publicId, input.entryPublicId),
          eq(schema.entries.profileId, profile.id),
          programRow(),
          eq(schema.sessions.profileId, schema.entries.profileId),
        ),
      )
      .limit(1)
      .for('update', { of: schema.entries });
    if (!entry || entry.deletedAt !== null) refuse(ROW_REFUSAL.not_found);

    // 3 — the window, from the entry's own day; an archived athlete's day is read-only.
    if (!rowDayOpen(entry.day, args.today, profile.archivedAt)) refuse(ROW_REFUSAL.closed_day);

    // 4 — the workout. A purged one (`ON DELETE SET NULL`) is off the week, as `untickRow` has it.
    if (entry.workoutId === null) refuse(ROW_REFUSAL.not_scheduled);
    const workout = await rowWorkout(tx, profile.id, scope, { id: entry.workoutId });
    if (!workout) refuse(ROW_REFUSAL.not_found);
    if (!(await isScheduledOn(tx, workout.blockId, workout.id, entry.day))) {
      refuse(ROW_REFUSAL.not_scheduled);
    }
    if (!workout.live) refuse(ROW_REFUSAL.program_changed);

    // 5 · 6 — the prescription, pinned to that workout, and its movement (`rowItem`, as a ✓).
    //     A purged one is `program_changed`, as the fake's removed item.
    if (entry.prescriptionId === null) refuse(ROW_REFUSAL.program_changed);
    const { trackingType } = await rowItem(tx, scope, {
      prescription: { id: entry.prescriptionId },
      workoutId: workout.id,
    });

    // 7 — the values, against the row as it was LOGGED (A5; contract C28): each typed quantity in the
    //     unit the row was logged in, and nothing filled in (no target), so a blank is `bad_value`
    //     and keeps the number that is there.
    const logged = await storedValues(tx, entry.id);
    const values = fillRowValues(
      { trackingType, unit: loggedRowUnit(trackingType, logged) },
      input.values,
      null,
    );
    if (!values) refuse(ROW_REFUSAL.bad_value);

    // 8 — the write, in place; the text the row was logged against is kept (A7).
    await updateEntrySetRows(tx, { entryId: entry.id, set: values });

    // 9 — answered from the stored row, read the one way a ✓'s replay reads it.
    return {
      ok: true,
      entryPublicId: input.entryPublicId,
      values: await storedValues(tx, entry.id),
    };
  });
}
