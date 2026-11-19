import { SEED_ACTIVITY_TYPE_KEYS, SEED_METRIC_KEYS } from '@mat-plan/shared';
import type { StrengthLogRow } from '@mat-plan/shared/csv';
import { and, asc, eq, gte, isNull, lt, not, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from '../schema';
import type { HouseholdScope, OwnerScope } from '../scope';
import { isLiveProfile, isOwnerOf } from '../writers/ownership';
import {
  byFirstLogged,
  entrySessionIsItsAthletes,
  type FirstLoggedFields,
  programItemKey,
  programRow,
} from './day/program-rows';

/**
 * The month-scoped reads behind the CSV export (V1-13b), single-sourced here so the DAL **and**
 * `db:verify` run the identical query — a guard that lives only in the DAL is a guard no proof covers.
 *
 * ⚠️ **ROW ORDER IS PART OF THE CONTRACT.** Chronological, append-only, and within a date **session
 * order — never alphabetical**. The clause is `(activity_date, session id, created_at, id)`, the same
 * V1-17 ordering that makes superset members read in performed order.
 *
 * Stated limitation, because it is invisible otherwise: there is deliberately **no `position`
 * column** (`schema.ts` — "position is insertion order… there is deliberately NO position column"),
 * so intra-session order is *insertion* order. A set flushed late from a second device lands at the
 * bottom of a session it happened at the top of. What this DOES guarantee is that re-exporting the
 * same month twice is byte-identical, which is the property the workflow actually depends on.
 *
 * ## TEN-1 1c — all four reads are household-scoped
 *
 * Each takes a required `HouseholdScope` and resolves ownership through the single-sourced
 * `isLiveProfile` (`writers/ownership.ts`) instead of a hand-written
 * `and(eq(publicId, …), isNull(deletedAt))`. `lib/dal/export.ts` already fails closed at
 * `getProfileByPublicId` before any of these runs, so this is depth behind the gate — which is exactly
 * what `docs/features/write-path.md` demands: *"a guard that exists only in the DAL is a guard no proof
 * covers."* `db:verify`'s TEN-1 read matrix drives all four in both directions.
 */

/** `YYYY-MM` → the half-open date range `[first, next month)`. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`;
  const to = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { from, to };
}

/**
 * Every logged strength movement in one month, with its sets and their typed quantities.
 *
 * Returns one row per (entry, set, quantity) and lets the caller fold — the alternative is three
 * round-trips or a JSON aggregate, and at a month's scale (tens of rows) the flat join is both
 * simpler and cheaper. `deleted_at IS NULL` on the entry, its sets and their quantities: a soft-deleted
 * parent must not drag live children into the export (`ON DELETE CASCADE` is hard-delete only). The
 * SESSION is different by choice: it only lends its columns, so a hidden or foreign session blanks
 * them and the athlete's entry is still exported. A writer that hides a session must hide its
 * entries too.
 */
/**
 * One flat (entry × set × quantity) row. Derived, not hand-typed — the `ProgramDayRow` precedent —
 * so a nullability change in the select cannot leave a consumer claiming a shape this no longer has.
 */
export type StrengthMonthRow = Awaited<ReturnType<typeof strengthMonthRows>>[number];

/** Every strength-log row in one month. Not owner-gated; the export's gate is `loggedMonths`. */
export function strengthMonthRows(
  db: NodePgDatabase<typeof schema>,
  args: {
    profilePublicId: string;
    month: string;
    /** TEN-1: the household this request is authorized for. The third conjunct of `isLiveProfile`. */
    scope: HouseholdScope;
  },
) {
  const { from, to } = monthRange(args.month);
  return (
    db
      .select({
        entryId: schema.entries.id,
        date: schema.entries.activityDate,
        entryStatus: schema.entries.status,
        notes: schema.entries.notes,
        movementSlug: schema.movements.slug,
        // V1-22 chunk 2 (D1): the key the live `prescribed` fallback matches on. The slug it used
        // to key on is a proxy for this id, and a proxy `MOV-1`'s rename breaks.
        movementId: schema.entries.movementId,
        // V1-22 chunk 2: the FROZEN prescription. `IS NULL` means "never snapshotted"; `''` is a
        // real rendered value (an `open()` prescription). Selected raw — no `coalesce`, which would
        // destroy the distinction the column exists for.
        prescribedSnapshot: schema.entries.prescribedSnapshot,
        dayRole: schema.sessions.dayRole,
        sessionType: schema.sessions.sessionType,
        sessionId: schema.sessions.id,
        // FAM-1 14a: what the fold needs to make one row per program item. `entrySessionId` is the
        // ENTRY's own column: the joined `sessions.id` is NULL for a session that is not this
        // athlete's (the ON below), and a key built on it would merge two such sessions' rows.
        entrySessionId: schema.entries.sessionId,
        createdAt: schema.entries.createdAt,
        prescriptionId: schema.entries.prescriptionId,
        prescriptionSet: schema.entries.prescriptionSet,
        isProgramRow: sql<boolean>`${programRow()}`,
        // The FROZEN name (11b), never the live `workouts.name`: a renamed workout exports the name
        // the row was logged under. NULL outside a program, and for another athlete's session.
        workoutName: schema.sessions.workoutName,
        setId: schema.entrySets.id,
        setIdx: schema.entrySets.idx,
        reps: schema.entrySets.reps,
        setStatus: schema.entrySets.status,
        isBodyweight: schema.entrySets.isBodyweight,
        isBand: schema.entrySets.isBand,
        slot: schema.entrySetQuantities.slot,
        unit: schema.entrySetQuantities.unit,
        valueNum: schema.entrySetQuantities.valueNum,
      })
      .from(schema.entries)
      .innerJoin(schema.profiles, eq(schema.profiles.id, schema.entries.profileId))
      // The MOVEMENT is required: `movements.slug` is the export's grouping key, and an entry with no
      // movement is a metric/check-in, which belongs to a different file.
      .innerJoin(schema.movements, eq(schema.movements.id, schema.entries.movementId))
      // FAM-1 14a: the session must be the ATHLETE's (runbook pre-flight (i); `day-writers.md`
      // invariant 13), so another profile's session never lends its name or `session_type`. In the ON,
      // not the WHERE (the day resolver's choice): the resolver drops a row it cannot place, and the
      // export must keep the athlete's own entry, with that session's columns NULL.
      .leftJoin(
        schema.sessions,
        and(
          eq(schema.sessions.id, schema.entries.sessionId),
          entrySessionIsItsAthletes(),
          // A hidden session lends nothing either: its columns are NULL, and its entries are kept
          // unless they are hidden themselves. No writer hides a session today.
          isNull(schema.sessions.deletedAt),
        ),
      )
      // LEFT, not inner: a SKIPPED movement carries ZERO set rows and still needs its `0,0,SKIPPED` row.
      .leftJoin(
        schema.entrySets,
        and(eq(schema.entrySets.entryId, schema.entries.id), isNull(schema.entrySets.deletedAt)),
      )
      .leftJoin(
        schema.entrySetQuantities,
        and(
          eq(schema.entrySetQuantities.entrySetId, schema.entrySets.id),
          isNull(schema.entrySetQuantities.deletedAt),
        ),
      )
      .where(
        and(
          isLiveProfile(args.profilePublicId, args.scope),
          isNull(schema.entries.deletedAt),
          gte(schema.entries.activityDate, from),
          lt(schema.entries.activityDate, to),
        ),
      )
      .orderBy(
        asc(schema.entries.activityDate),
        // The entry's own column, equal to `sessions.id` for every owned row (so no byte moves); a
        // foreign session's row keeps its place instead of sorting last under a NULL.
        asc(schema.entries.sessionId),
        asc(schema.entries.createdAt),
        asc(schema.entries.id),
        asc(schema.entrySets.idx),
        asc(schema.entrySetQuantities.slot),
      )
  );
}

/**
 * A folded strength-log row, plus the two values the `prescribed` resolution needs and the CSV does NOT
 * emit (`apps/web/lib/dal/export.ts`).
 *
 * ⚠️ They are kept OFF `StrengthLogRow`, the file's own row: a resolution input is not a column, and
 * widening that type to carry one is how a column appears by accident. The same holds for the ids the
 * fold keys on (`ID-1`: no household-owned id becomes a column).
 */
export type FoldedStrengthRow = StrengthLogRow &
  // `prescribedSnapshot`: `null` = never snapshotted; `''` = a real frozen rendering.
  Pick<StrengthMonthRow, 'prescribedSnapshot' | 'movementId'>;

type ExportSetRow = StrengthLogRow['sets'][number];
type ExportQuantity = ExportSetRow['quantities'][number];

/** One entry of a folded row: the fields the sort reads, its first flat row, and its sets by set id. */
type FoldedEntry = FirstLoggedFields & {
  head: StrengthMonthRow;
  sets: Map<number, ExportSetRow>;
};

/**
 * The fold key (FAM-1 14a). A **program row** is one entry per ✓'d set (11b), so its entries fold into
 * ONE row per program item: same date, same session, same item ({@link programItemKey}, which falls
 * back to the movement once a prescription is purged). Anything else is one row per entry, as before.
 *
 * The date is in the key because nothing in the schema ties an entry's date to its session's, and the
 * session is the ENTRY's own `session_id`, never the joined one, which is NULL for a session that is
 * not the athlete's.
 */
function foldKey(row: StrengthMonthRow): string {
  return row.isProgramRow
    ? `s:${row.date}:${row.entrySessionId}:${programItemKey(row)}`
    : `e:${row.entryId}`;
}

/**
 * Fold the flat (entry × set × quantity) join into the strength log's rows (V1-13b; FAM-1 14a).
 *
 * - **Row order** is the query's ORDER BY: a row sits where its first flat row came, so the contract's
 *   chronological, session-ordered file survives without a second sort.
 * - **A program row's sets** go in `prescription_set` order, and its `prescribed`, `notes` and `status`
 *   come from its lowest set ({@link byFirstLogged}, R4's rule): one file row stands for the whole item.
 *   The query's `created_at` order is NOT the set order (a later set can be ticked first).
 * - **Set identity is the SET ROW**, not its index: a partial skip leaves gaps in `idx`.
 *
 * Pure, and in `packages/db` rather than the DAL, so `db:verify` can prove the whole chain from `logRow`
 * to the file's bytes (FAM-1 14a; the DAL is `server-only`).
 */
export function foldStrengthMonth(rows: readonly StrengthMonthRow[]): FoldedStrengthRow[] {
  const items = new Map<string, Map<number, FoldedEntry>>();

  for (const r of rows) {
    const key = foldKey(r);
    let entries = items.get(key);
    if (!entries) items.set(key, (entries = new Map()));
    let entry = entries.get(r.entryId);
    if (!entry) {
      entry = {
        set: r.prescriptionSet,
        createdAt: r.createdAt,
        id: r.entryId,
        head: r,
        sets: new Map(),
      };
      entries.set(r.entryId, entry);
    }
    if (r.setId === null) continue; // a skipped movement: zero set rows, by design

    let set = entry.sets.get(r.setId);
    if (!set) {
      set = {
        reps: r.reps,
        // `?? false` because these arrive through a LEFT JOIN — null means "no set row", which the
        // `r.setId === null` guard above already skipped, so this is a type narrowing, not a default.
        isBodyweight: r.isBodyweight ?? false,
        isBand: r.isBand ?? false,
        quantities: [],
        status: r.setStatus ?? '',
      };
      entry.sets.set(r.setId, set);
    }
    if (r.slot !== null && r.unit !== null && r.valueNum !== null) {
      (set.quantities as ExportQuantity[]).push({
        slot: r.slot as never,
        unit: r.unit as never,
        value: r.valueNum,
      });
    }
  }

  return [...items.values()].map((entries) => {
    const ordered = [...entries.values()].sort(byFirstLogged(true));
    const { head } = ordered[0];
    return {
      date: head.date,
      dayRole: head.dayRole,
      sessionType: head.sessionType,
      workoutName: head.workoutName,
      movementSlug: head.movementSlug,
      movementId: head.movementId,
      prescribedSnapshot: head.prescribedSnapshot,
      status: head.entryStatus,
      sets: ordered.flatMap((e) => [...e.sets.values()]),
      prescribed: '',
      notes: head.notes ?? '',
    };
  });
}

/**
 * **This entry is a bodyweight reading** (FAM-1 14b): the weigh-in activity OR the bodyweight metric,
 * so a bodyweight metric under any other activity still lands in the bodyweight file, never in
 * check-ins (the schema's own test is the metric, `BODYWEIGHT_DAY_UNIQUE_INDEX`). One conjunct for both
 * reads; never NULL (`activity_types.key` is NOT NULL through the inner join, and the metric arm is
 * `IS NOT DISTINCT FROM`), so the check-ins side is plain `not(bodyweightEntry())`.
 *
 * ⚠️ Wider than the app's other bodyweight reads (`last-bodyweight.ts`, the day page's totals), which
 * key on the metric alone: the two agree on every row today, since every weigh-in carries the metric
 * (migration 0002's backfill). The export takes the wider test on purpose, so a weigh-in that ever
 * lost its metric still leaves in the bodyweight file and never in check-ins (plan, review B10).
 */
export function bodyweightEntry() {
  return or(
    eq(schema.activityTypes.key, SEED_ACTIVITY_TYPE_KEYS.weighIn),
    sql`${schema.entries.metricKey} is not distinct from ${SEED_METRIC_KEYS.bodyweight}`,
  )!;
}

/**
 * **Every logged check-in in one month** (FAM-1 14b): every live entry with no movement that is not a
 * bodyweight reading, so with the strength log and the bodyweight file each live entry lands in exactly
 * one file. `entryId` is for `db:verify`'s partition proof only and never becomes a column.
 *
 * Not owner-gated; the export's gate is `loggedMonths`.
 */
export function checkinMonthRows(
  db: NodePgDatabase<typeof schema>,
  args: {
    profilePublicId: string;
    month: string;
    /** TEN-1: the household this request is authorized for. */
    scope: HouseholdScope;
  },
) {
  const { from, to } = monthRange(args.month);
  return db
    .select({
      entryId: schema.entries.id,
      date: schema.entries.activityDate,
      activity: schema.activityTypes.key,
      metric: schema.entries.metricKey,
      valueNum: schema.entries.valueNum,
      valueText: schema.entries.valueText,
      unit: schema.entries.unit,
      notes: schema.entries.notes,
    })
    .from(schema.entries)
    .innerJoin(schema.profiles, eq(schema.profiles.id, schema.entries.profileId))
    .innerJoin(schema.activityTypes, eq(schema.activityTypes.id, schema.entries.activityTypeId))
    .where(
      and(
        isLiveProfile(args.profilePublicId, args.scope),
        isNull(schema.entries.deletedAt),
        isNull(schema.entries.movementId),
        not(bodyweightEntry()),
        gte(schema.entries.activityDate, from),
        lt(schema.entries.activityDate, to),
      ),
    )
    .orderBy(asc(schema.entries.activityDate), asc(schema.entries.id));
}

/** One row of `checkinMonthRows`, for tests that mock it (typed, so the shape cannot drift). */
export type CheckinMonthRow = Awaited<ReturnType<typeof checkinMonthRows>>[number];

/**
 * Every bodyweight reading in one month.
 *
 * Not owner-gated; the export's gate is `loggedMonths`.
 */
export function bodyweightMonthRows(
  db: NodePgDatabase<typeof schema>,
  args: {
    profilePublicId: string;
    month: string;
    /** TEN-1: the household this request is authorized for. */
    scope: HouseholdScope;
  },
) {
  const { from, to } = monthRange(args.month);
  return db
    .select({
      // For `db:verify`'s partition proof only; `BodyweightRow` never carries it.
      entryId: schema.entries.id,
      date: schema.entries.activityDate,
      value: schema.entries.valueNum,
      // CSV-1: the unit rides the row so the builder can CONVERT a kg weight (Ray, 2026-10-02) —
      // `weight_lb` is the legacy header, and a kg number written bare reads as pounds (2.2× wrong).
      unit: schema.entries.unit,
      context: schema.entries.context,
      notes: schema.entries.notes,
    })
    .from(schema.entries)
    .innerJoin(schema.profiles, eq(schema.profiles.id, schema.entries.profileId))
    .innerJoin(schema.activityTypes, eq(schema.activityTypes.id, schema.entries.activityTypeId))
    .where(
      and(
        isLiveProfile(args.profilePublicId, args.scope),
        isNull(schema.entries.deletedAt),
        bodyweightEntry(),
        gte(schema.entries.activityDate, from),
        lt(schema.entries.activityDate, to),
      ),
    )
    .orderBy(asc(schema.entries.activityDate), asc(schema.entries.id));
}

/**
 * The months this profile has any logged data in, newest first.
 *
 * One indexed scan over `idx_entries_profile_date`. Drives which files the export writes, so a
 * profile with no data produces no directory rather than an empty one.
 *
 * 🔴 **The export's owner gate** (FAM-1 export follow-up, [plan](../../../../docs/plans/fam-1-export-owner-only.md)
 * PR B; the maintainer's Q1, 2026-11-19: only the household's owner downloads an export). It takes
 * an `OwnerScope`, so a caller must narrow with `ownerScope()` first, and its WHERE carries
 * `isOwnerOf`, so a member scope cast past the type reads **no months**, and the DAL builds no file.
 * `db:verify` proves the zero rows; mutation 610 drops the conjunct.
 *
 * ⚠️ **It gates the export's control flow, not the three file reads.** `strengthMonthRows`,
 * `bodyweightMonthRows` and `checkinMonthRows` stay on `HouseholdScope` on purpose: every member may
 * see those rows in the app (Q2), so the rule is about the export artifact, and the DAL only ever
 * reads the files for months this returned.
 */
export function loggedMonths(
  db: NodePgDatabase<typeof schema>,
  args: {
    profilePublicId: string;
    /** TEN-1: the household this request is authorized for; the export's owner gate (above). */
    scope: OwnerScope;
  },
) {
  return db
    .selectDistinct({ month: sql<string>`to_char(${schema.entries.activityDate}, 'YYYY-MM')` })
    .from(schema.entries)
    .innerJoin(schema.profiles, eq(schema.profiles.id, schema.entries.profileId))
    .where(
      and(
        isLiveProfile(args.profilePublicId, args.scope),
        isNull(schema.entries.deletedAt),
        isOwnerOf(args.scope),
      ),
    )
    .orderBy(sql`to_char(${schema.entries.activityDate}, 'YYYY-MM') desc`);
}
