import { ENTRY_STATUS, SEED_METRIC_KEYS } from '@mat-plan/shared';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

import { schema } from '../client';
import type { Executor } from './executor';
import { ownedEntryIds } from './ownership';

/**
 * Amend ONE already-logged bodyweight's value (V1-24 PR 1b), single-sourced HERE in `packages/db` so
 * the app DAL and `db:verify` prove the IDENTICAL guard — the `updateStrengthSetById` doctrine, and
 * the reason it cannot live in `apps/web/lib/dal` (`verify.ts` imports only `../src/*`, so a writer
 * there would fork a second, unproved copy of a security boundary).
 *
 * A single atomic UPDATE — **no transaction**, unlike the strength writer. The value lives on
 * `entries` itself; that writer became a transaction only when GAP-3 moved its magnitude to a child
 * row, and its docblock records exactly that.
 *
 * Returns the amended entry's `public_id`, or `null` when the guarded WHERE matched no row. `null` is
 * an EXPECTED outcome with **four** causes, and the caller must tell them apart — see the note on
 * `seenValue` and `editBodyweightAction`'s three-way branch.
 *
 * ## The WHERE is the security boundary, not a convenience
 *
 * Every pin below refuses a crafted POST, which is the real threat on a public endpoint:
 *
 * - **`metric_key = 'bodyweight'`, as a PINNED CONSTANT and never an argument.** Without it this
 *   endpoint rewrites *any* entry the profile owns — a push-up bout, a sleep-hours reading, a
 *   `scale_10` pressure score — into a bodyweight, silently corrupting the adherence fold and the
 *   CSV. A parameter can be passed wrong by a future caller; a constant cannot. The draft plan made
 *   this generic "so PR 2 reuses it"; PR 2's habit rows carry `metric_key: null` and cannot use it
 *   anyway, so the generality bought nothing and cost the guarantee.
 * - **`unit = args.unit`.** The amend cannot CHANGE the unit (plan Decision 13), but the plausibility
 *   bound is per-unit, so the unit is submitted for that check. Pinning it here is what stops a
 *   crafted POST claiming `kg` to slip a value past the `lb` bound: the stored row is `lb`, so the
 *   claim matches zero rows. Submitted for the check, verified against reality, never written.
 * - **`value_num IS NOT NULL` + `value_text IS NULL`.** Mirrors `loggedBodyweight`'s read-side guard
 *   (`e.value !== null`). A text-valued metric row would otherwise get `value_num` set while
 *   `value_text` stayed behind — two value sources, and the label renders from the stale one.
 *   `entries_value_source_check` does not catch that; it constrains movement vs metric.
 * - **`status = 'done'`.** Same reasoning as the strength writer: correcting a non-`done` row means
 *   changing its status, which this endpoint cannot do, so it refuses rather than half-editing.
 * - **`deleted_at IS NULL` at entry AND profile**, via `ownedEntryIds`.
 *
 * The shape pins live in `amendableBodyweight`, shared with `findAmendableBodyweight` below.
 *
 * ## `seenValue` — optimistic concurrency, not LWW
 *
 * The amend applies only if the row **still** holds the value the form was rendered with. Without it:
 * Dad's phone shows `84.5`, the kid corrects it to `85.2`, Dad taps Change on his stale render and
 * saves — and the correct value is **silently reverted, with no trace**. On a shared-household app
 * that is the realistic failure.
 *
 * ⚠️ Deliberately the VALUE and not an `updated_at` token. Postgres stores microseconds, drizzle
 * hands back a millisecond `Date`, and a form field renders to seconds — so a timestamp token matches
 * **zero rows essentially always**, while PGlite's millisecond `now()` would let the `db:verify`
 * proof pass green on the broken mechanism anyway. Both were probed (plan Decision 11).
 * `numeric(8,3)` compares exactly and needs no new column, DTO field or precision rules.
 *
 * ⚠️ This is NOT AGENTS.md's LWW rule, which compares a CLIENT-supplied `updated_at` to decide who
 * wins and arrives with `/api/sync` at v1.5. This asks a different question: *has this changed under
 * me?*
 */
export async function updateBodyweightEntryById(
  exec: Executor,
  args: {
    profilePublicId: string;
    entryId: string;
    /** The corrected weight. Bounded by `editBodyweightSchema` before it reaches here. */
    value: number;
    /** GUARD ONLY — never written. See the note above. */
    unit: string;
    /** GUARD ONLY — the value the form was rendered with. */
    seenValue: number;
  },
): Promise<{ publicId: string } | null> {
  const owned = ownedEntryIds(exec, args.profilePublicId);

  const rows = await exec
    .update(schema.entries)
    .set({
      // `numeric` takes a string — precision-safe, the `logBodyweight` idiom.
      valueNum: String(args.value),
      updatedAt: sql`now()`,
    })
    .where(
      and(
        amendableBodyweight(args.entryId),
        inArray(schema.entries.id, owned),
        eq(schema.entries.unit, args.unit),
        // Optimistic concurrency. `numeric` compares exactly against the stringified value.
        eq(schema.entries.valueNum, String(args.seenValue)),
      ),
    )
    .returning({ publicId: schema.entries.publicId });

  return rows[0] ?? null;
}

/**
 * Re-read ONE amendable bodyweight the profile owns: the action's three-way branch after
 * `updateBodyweightEntryById` returns `null`. Same shape predicate and same ownership scope as the
 * UPDATE, minus the two per-request guards (`unit`, `seenValue`), so the read can only ever see a row
 * the UPDATE could have written. A cross-profile, soft-deleted, non-`done` or text-valued row is
 * `null`, which the action reports as not-found, exactly like a wrong owner. It lives here, not in the
 * app DAL, so `db:verify` proves it too.
 */
export async function findAmendableBodyweight(
  exec: Executor,
  args: { profilePublicId: string; entryId: string },
): Promise<{ value: number; unit: string } | null> {
  const [row] = await exec
    .select({ value: schema.entries.valueNum, unit: schema.entries.unit })
    .from(schema.entries)
    .where(
      and(
        amendableBodyweight(args.entryId),
        inArray(schema.entries.id, ownedEntryIds(exec, args.profilePublicId)),
      ),
    )
    .limit(1);
  return row?.value == null ? null : { value: Number(row.value), unit: row.unit };
}

/**
 * The SHAPE an amendable bodyweight has — shared by the UPDATE and the re-read so the two can never
 * scope by different rules. Ownership (`ownedEntryIds`) and the per-request guards stay with callers.
 */
function amendableBodyweight(entryId: string) {
  return and(
    eq(schema.entries.publicId, entryId),
    isNull(schema.entries.deletedAt),
    eq(schema.entries.metricKey, SEED_METRIC_KEYS.bodyweight),
    eq(schema.entries.status, ENTRY_STATUS.done),
    isNotNull(schema.entries.valueNum),
    isNull(schema.entries.valueText),
  );
}
