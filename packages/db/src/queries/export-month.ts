import type { StrengthLogRow } from '@mat-plan/shared/csv';
import { and, asc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from '../schema';
import type { HouseholdScope } from '../scope';
import { isLiveProfile } from '../writers/ownership';
import { byFirstLogged, programItemKey, programRow } from './day/program-rows';

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
 * ## TEN-1 1c — all three reads are household-scoped
 *
 * Each takes a required `HouseholdScope` and resolves ownership through the single-sourced
 * `isLiveProfile` (`writers/ownership.ts`) instead of a hand-written
 * `and(eq(publicId, …), isNull(deletedAt))`. `lib/dal/export.ts` already fails closed at
 * `getProfileByPublicId` before any of these runs, so this is depth behind the gate — which is exactly
 * what `docs/features/write-path.md` demands: *"a guard that exists only in the DAL is a guard no proof
 * covers."* `db:verify`'s TEN-1 read matrix drives all three in both directions.
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
 * simpler and cheaper. `deleted_at IS NULL` at every level: a soft-deleted parent must not drag live
 * children into the export (`ON DELETE CASCADE` is hard-delete only).
 */
/**
 * One flat (entry × set × quantity) row. Derived, not hand-typed — the `ProgramDayRow` precedent —
 * so a nullability change in the select cannot leave a consumer claiming a shape this no longer has.
 */
export type StrengthMonthRow = Awaited<ReturnType<typeof strengthMonthRows>>[number];

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
        // athlete's (the ON below), and a key built on it would merge rows across dates.
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
          eq(schema.sessions.profileId, schema.entries.profileId),
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
export type FoldedStrengthRow = StrengthLogRow & {
  /** `null` = never snapshotted; `''` = a real frozen rendering. The distinction is load-bearing. */
  prescribedSnapshot: string | null;
  /** Nullable because `entries.movement_id` is; this query inner-joins `movements`, so it is set. */
  movementId: number | null;
};

type ExportSetRow = StrengthLogRow['sets'][number];
type ExportQuantity = ExportSetRow['quantities'][number];

/** One entry of a folded row: the fields the sort reads, its first flat row, and its sets by set id. */
type FoldedEntry = {
  set: number | null;
  createdAt: Date;
  id: number;
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

/** Every bodyweight reading in one month. */
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
        eq(schema.activityTypes.key, 'weigh_in'),
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
 */
export function loggedMonths(
  db: NodePgDatabase<typeof schema>,
  args: {
    profilePublicId: string;
    /** TEN-1: the household this request is authorized for. */
    scope: HouseholdScope;
  },
) {
  return db
    .selectDistinct({ month: sql<string>`to_char(${schema.entries.activityDate}, 'YYYY-MM')` })
    .from(schema.entries)
    .innerJoin(schema.profiles, eq(schema.profiles.id, schema.entries.profileId))
    .where(and(isLiveProfile(args.profilePublicId, args.scope), isNull(schema.entries.deletedAt)))
    .orderBy(sql`to_char(${schema.entries.activityDate}, 'YYYY-MM') desc`);
}
