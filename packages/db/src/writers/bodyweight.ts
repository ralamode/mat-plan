import { DEFAULT_BODYWEIGHT_CONTEXT, ENTRY_STATUS, SEED_METRIC_KEYS } from '@mat-plan/shared';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

import { schema } from '../client';
import type { Executor } from './executor';
import type { HouseholdScope } from '../scope';
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
    /** TEN-1: the household this request is authorized for. Rides into `ownedEntryIds`. */
    scope: HouseholdScope;
    /** The corrected weight. Bounded by `editBodyweightSchema` before it reaches here. */
    value: number;
    /** GUARD ONLY — never written. See the note above. */
    unit: string;
    /** GUARD ONLY — the value the form was rendered with. */
    seenValue: number;
  },
): Promise<{ publicId: string } | null> {
  const owned = ownedEntryIds(exec, args.profilePublicId, args.scope);

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
  args: { profilePublicId: string; entryId: string; scope: HouseholdScope },
): Promise<{ value: number; unit: string } | null> {
  const [row] = await exec
    .select({ value: schema.entries.valueNum, unit: schema.entries.unit })
    .from(schema.entries)
    .where(
      and(
        amendableBodyweight(args.entryId),
        inArray(schema.entries.id, ownedEntryIds(exec, args.profilePublicId, args.scope)),
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

/**
 * Insert ONE weigh-in (V1-24 PR 1e) — the create half of the bodyweight write path, single-sourced HERE
 * so `db:verify` drives the IDENTICAL statement the app runs (drizzle's parameterised path), as the
 * amend above does.
 *
 * ## The arbiter is target-less `ON CONFLICT DO NOTHING` — every unique index on `entries`
 *
 * The natural key, `BODYWEIGHT_DAY_UNIQUE_INDEX` (1d), is an EXPRESSION index —
 * `(profile_id, activity_date, coalesce(context, 'morning'))` — and drizzle's `onConflict` target takes
 * columns only, so it cannot name it. The two options were a hand-written `ON CONFLICT (…)` clause or no
 * target. No target, because:
 * - **It cannot fail inference.** A hand-written clause must match the index's expression AND predicate
 *   exactly; `'morning'`/`'bodyweight'` must be SQL literals, and if a parameter slips in, inference can
 *   depend on custom vs generic plans — a miss raises "no unique or exclusion constraint matching the ON
 *   CONFLICT specification" on EVERY insert (docs/lessons.md). No target has no spec to miss.
 * - **Concurrency is handled by Postgres.** With no target, every unique index is an arbiter, so a
 *   network re-POST racing its own first request waits and then does nothing — never a bare `23505`.
 *   That subsumes 1d's interim `23505` catch, which is removed.
 *
 * Its three costs (write-path invariant 6) are paid below, explicitly:
 * - **(a) `RETURNING` is empty on any conflict** — so on zero rows this re-selects instead of assuming.
 * - **(b) a second device's DIFFERENT weight would be dropped as "success"** — so the re-select branches:
 *   the row is THIS submit's (`client_id` matches, same profile) → a replay → `{ id }`; the day's slot
 *   holds someone else's row → `{ dayTaken: true }`, a typed answer, never a silent success.
 * - **(c) it swallows a violation of ANY unique index**, including a future one — so a no-op that is
 *   neither a replay nor the day slot THROWS rather than returning something plausible.
 *
 * The replay lookup is scoped to the PROFILE as well as the `client_id` (the pre-1e fallback filtered on
 * `client_id` alone, so a crafted `client_id` equal to another profile's entry returned THAT entry's
 * public id). `client_id` is client-supplied; ownership is not.
 *
 * `context` is NOT written yet: the index treats NULL as `'morning'`, so stamping it buys nothing until
 * V1-32 adds real slots — and stamping only NEW rows would export `morning` beside `''` for every older
 * row in the same month's CSV. The slot write, its values CHECK and the CSV `context` column land
 * together with V1-32.
 */
export async function insertBodyweightEntry(
  exec: Executor,
  args: {
    /** INTERNAL id of a profile the caller has already resolved as LIVE and owned. */
    profileId: number;
    publicId: string;
    clientId: string;
    day: string;
    unit: string;
    value: number;
    notes: string | null;
    activityTypeId: number;
    kind: string;
  },
): Promise<{ id: string } | { dayTaken: true }> {
  const [inserted] = await exec
    .insert(schema.entries)
    .values({
      publicId: args.publicId,
      clientId: args.clientId,
      profileId: args.profileId,
      activityDate: args.day,
      kind: args.kind,
      unit: args.unit,
      valueNum: String(args.value), // numeric column takes a string (precision-safe)
      activityTypeId: args.activityTypeId,
      metricKey: SEED_METRIC_KEYS.bodyweight,
      status: ENTRY_STATUS.done,
      notes: args.notes,
    })
    .onConflictDoNothing()
    .returning({ publicId: schema.entries.publicId });
  if (inserted) return { id: inserted.publicId };

  // (a)+(b): a replay of THIS submit — same client_id, same profile, still live, and a WEIGH-IN. The
  // metric pin matters: a POST reusing the client_id of the same profile's check-in or strength row
  // conflicts on `uq_entries_client_id` too, and must not be answered with THAT row's id (a weigh-in
  // silently not saved, reported as success). It falls through to (b) or the throw in (c).
  const [own] = await exec
    .select({ publicId: schema.entries.publicId })
    .from(schema.entries)
    .where(
      and(
        eq(schema.entries.clientId, args.clientId),
        eq(schema.entries.profileId, args.profileId),
        eq(schema.entries.metricKey, SEED_METRIC_KEYS.bodyweight),
        isNull(schema.entries.deletedAt),
      ),
    )
    .limit(1);
  if (own) return { id: own.publicId };

  // (b): the day's slot already holds ANOTHER submit's weigh-in. Same key as the index.
  const [taken] = await exec
    .select({ id: schema.entries.id })
    .from(schema.entries)
    .where(
      and(
        eq(schema.entries.profileId, args.profileId),
        eq(schema.entries.activityDate, args.day),
        eq(schema.entries.metricKey, SEED_METRIC_KEYS.bodyweight),
        isNull(schema.entries.deletedAt),
        sql`coalesce(${schema.entries.context}, ${DEFAULT_BODYWEIGHT_CONTEXT}) = ${DEFAULT_BODYWEIGHT_CONTEXT}`,
      ),
    )
    .limit(1);
  if (taken) return { dayTaken: true };

  // (c): DO NOTHING suppressed a conflict that is neither — never answer with something plausible.
  throw new Error(
    'insertBodyweightEntry: the insert was a no-op, but it is neither a replay of this submit nor ' +
      "the day's weigh-in — an unexpected unique conflict.",
  );
}
