import { ENTRY_STATUS, METRIC_KEYS, PRACTICE_UNIT } from '@mat-plan/shared';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

import { schema } from '../client';
import type { HouseholdScope } from '../scope';
import type { Executor } from './executor';
import { ownedEntryIds } from './ownership';

/**
 * The practice amend (V1-24 3b-life A6): `updateBodyweightEntryById`'s twin, for wrestling practice
 * minutes. Plan: `docs/plans/v1-24-3b-logs-in-place.md` § "3b-life: what the slice settles".
 *
 * 🔴 **The metric and the unit are pinned constants, never arguments.** A crafted entry id of any
 * other metric (a weigh-in, a habit) matches nothing, and a practice in any unit but the metric's
 * own `min` matches nothing either; the request carries no unit at all.
 *
 * **One guarded UPDATE, no transaction** (write-path.md's AMEND shape): ownership, the metric and
 * shape, live-ness and the `seenValue` the form showed all sit in the WHERE, so a stale render or a
 * foreign id updates nothing. `null` means "nothing matched"; the action re-reads with
 * `findAmendablePractice` to tell a replay from a stale write from a missing row.
 */
export async function updatePracticeEntryById(
  exec: Executor,
  args: {
    profilePublicId: string;
    entryId: string;
    scope: HouseholdScope;
    /** The corrected minutes. Bounded by `editPracticeSchema` before it reaches here. */
    minutes: number;
    /** GUARD ONLY: the minutes the form was rendered with. */
    seenValue: number;
  },
): Promise<{ publicId: string } | null> {
  const rows = await exec
    .update(schema.entries)
    .set({ valueNum: String(args.minutes), updatedAt: sql`now()` })
    .where(
      and(
        amendablePractice(args.entryId),
        inArray(schema.entries.id, ownedEntryIds(exec, args.profilePublicId, args.scope)),
        eq(schema.entries.valueNum, String(args.seenValue)),
      ),
    )
    .returning({ publicId: schema.entries.publicId });
  return rows[0] ?? null;
}

/**
 * The live, owned practice's minutes, read AFTER a no-op UPDATE (`findAmendableBodyweight`'s twin).
 * Live-only: a hidden practice is not amendable, so it answers `null` (the action's `not_found`).
 */
export async function findAmendablePractice(
  exec: Executor,
  args: { profilePublicId: string; entryId: string; scope: HouseholdScope },
): Promise<{ minutes: number } | null> {
  const [row] = await exec
    .select({ value: schema.entries.valueNum })
    .from(schema.entries)
    .where(
      and(
        amendablePractice(args.entryId),
        inArray(schema.entries.id, ownedEntryIds(exec, args.profilePublicId, args.scope)),
      ),
    )
    .limit(1);
  return row?.value == null ? null : { minutes: Number(row.value) };
}

/** A live, numeric, `done` practice in the metric's own unit: the only shape the amend may touch. */
function amendablePractice(entryId: string) {
  return and(
    eq(schema.entries.publicId, entryId),
    isNull(schema.entries.deletedAt),
    eq(schema.entries.metricKey, METRIC_KEYS.practice_minutes),
    eq(schema.entries.unit, PRACTICE_UNIT),
    eq(schema.entries.status, ENTRY_STATUS.done),
    isNotNull(schema.entries.valueNum),
    isNull(schema.entries.valueText),
  );
}
