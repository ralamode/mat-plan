import { and, asc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from '../schema';

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
export function strengthMonthRows(
  db: NodePgDatabase<typeof schema>,
  args: { profilePublicId: string; month: string },
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
        dayRole: schema.sessions.dayRole,
        sessionType: schema.sessions.sessionType,
        sessionId: schema.sessions.id,
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
      .leftJoin(schema.sessions, eq(schema.sessions.id, schema.entries.sessionId))
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
          eq(schema.profiles.publicId, args.profilePublicId),
          isNull(schema.profiles.deletedAt),
          isNull(schema.entries.deletedAt),
          gte(schema.entries.activityDate, from),
          lt(schema.entries.activityDate, to),
        ),
      )
      .orderBy(
        asc(schema.entries.activityDate),
        asc(schema.sessions.id),
        asc(schema.entries.createdAt),
        asc(schema.entries.id),
        asc(schema.entrySets.idx),
        asc(schema.entrySetQuantities.slot),
      )
  );
}

/** Every bodyweight reading in one month. */
export function bodyweightMonthRows(
  db: NodePgDatabase<typeof schema>,
  args: { profilePublicId: string; month: string },
) {
  const { from, to } = monthRange(args.month);
  return db
    .select({
      date: schema.entries.activityDate,
      value: schema.entries.valueNum,
      // CSV-1: the unit rides the row so the builder can REFUSE a non-lb weight — `weight_lb` is
      // the legacy header, and a kg number written there reads as pounds (a silent 2.2× error).
      unit: schema.entries.unit,
      context: schema.entries.context,
      notes: schema.entries.notes,
    })
    .from(schema.entries)
    .innerJoin(schema.profiles, eq(schema.profiles.id, schema.entries.profileId))
    .innerJoin(schema.activityTypes, eq(schema.activityTypes.id, schema.entries.activityTypeId))
    .where(
      and(
        eq(schema.profiles.publicId, args.profilePublicId),
        isNull(schema.profiles.deletedAt),
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
export function loggedMonths(db: NodePgDatabase<typeof schema>, args: { profilePublicId: string }) {
  return db
    .selectDistinct({ month: sql<string>`to_char(${schema.entries.activityDate}, 'YYYY-MM')` })
    .from(schema.entries)
    .innerJoin(schema.profiles, eq(schema.profiles.id, schema.entries.profileId))
    .where(
      and(
        eq(schema.profiles.publicId, args.profilePublicId),
        isNull(schema.profiles.deletedAt),
        isNull(schema.entries.deletedAt),
      ),
    )
    .orderBy(sql`to_char(${schema.entries.activityDate}, 'YYYY-MM') desc`);
}
