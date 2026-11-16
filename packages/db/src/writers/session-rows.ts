import {
  newId,
  type RowValues,
  type StrengthSetInput,
  UNIT_DIMENSION_BY_CODE,
} from '@mat-plan/shared';

import { schema } from '../client';
import type { Executor } from './executor';

/**
 * Row helpers for the entry graph: the strength writer and the FAM-1 row writer
 * (`writers/day/log-row.ts`) both write an entry's set rows through them (FAM-1 steps 11a, 11b).
 *
 * ⚠️ Not re-exported from `src/index.ts`. Each helper writes part of an entry inside its caller's
 * transaction; called on its own it would leave a half-written graph.
 */

/**
 * A set as `insertEntrySetRows` takes it, **derived, never re-typed** (FAM-1 11b): the reps and the
 * quantities of a logged row (`RowValues`), plus the strength set's two modes and its status.
 *
 * - `reps` omitted → the column is omitted (NULL). A Check, Count, Duration, Time-per-set or
 *   Distance row has no reps. 🔴 Never pass a placeholder: the column has no CHECK, and an invented
 *   number reads as reps done.
 * - Each quantity carries its own slot and unit, so a Distance row reaches the `distance` slot.
 */
export type EntrySetRowInput = Pick<RowValues, 'reps' | 'quantities'> &
  Partial<Pick<StrengthSetInput, 'isBodyweight' | 'isBand' | 'status'>>;

/**
 * Write an entry's `entry_sets` rows (1-based `idx`) and each set's `entry_set_quantities` rows. A
 * quantity's `dimension` is derived from its unit, which is what the `units(code, dimension)`
 * composite FK checks. Columns a set does not set are OMITTED, so Postgres applies its own defaults
 * and a `done` set writes a byte-identical row.
 *
 * Callers: `writeSessionStrengthEntry` (one PRIMARY quantity per set that carries a weight) and the
 * FAM-1 row writer (one set per ✓, D3). Each calls it only when it created the entry, never on a
 * replay, so a retry never doubles the sets.
 */
export async function insertEntrySetRows(
  exec: Executor,
  args: { entryId: number; sets: readonly EntrySetRowInput[] },
): Promise<void> {
  if (args.sets.length === 0) return;
  // GAP-3: the SET row carries only reps, status and the two qualitative booleans; every measured
  // quantity is a child row written below.
  const setRows = await exec
    .insert(schema.entrySets)
    .values(
      args.sets.map((s, i) => ({
        publicId: newId(),
        clientId: newId(),
        entryId: args.entryId,
        idx: i + 1, // 1-based
        // FAM-1 11b: omitted when the row has no reps, so the column is NULL rather than invented.
        ...(s.reps !== undefined ? { reps: s.reps } : {}),
        // `bodyweight`/`band` are MODES, not quantities (GAP-3 §7.2b) — booleans, and omitted when
        // false so Postgres applies its own default and the row stays byte-minimal.
        ...(s.isBodyweight ? { isBodyweight: true } : {}),
        ...(s.isBand ? { isBand: true } : {}),
        // GAP-1 P1-1b — same omitted-takes-the-DB-default idiom as the entry's status. A `done` set
        // omits the column entirely, so every pre-existing caller writes a byte-identical row.
        ...(s.status !== undefined ? { status: s.status } : {}),
      })),
    )
    .returning({ id: schema.entrySets.id });

  // The dimension is derived from each quantity's unit rather than assumed: a movement may be logged
  // in `in` (a box jump) or `sec` (a hold), and a Duration row is in `min`. Deriving keeps the pair
  // consistent with `units(code, dimension)`, which the composite FK checks — a hard-coded `'mass'`
  // here would be an FK violation surfacing as a 500 on a gym floor (mutation 120).
  //
  // A set with no quantity (pure bodyweight, a band, a Check, Reps) writes NO quantity row — a mode
  // is not a measurement, and a row with a NULL value would be the EAV smell the child table avoids.
  const quantityRows: (typeof schema.entrySetQuantities.$inferInsert)[] = args.sets.flatMap(
    (s, i) =>
      s.quantities.map((q) => ({
        clientId: newId(),
        entrySetId: setRows[i].id,
        slot: q.slot,
        dimension: UNIT_DIMENSION_BY_CODE[q.unit],
        unit: q.unit,
        valueNum: String(q.value), // numeric column takes a string (precision-safe)
      })),
  );

  if (quantityRows.length > 0) {
    await exec.insert(schema.entrySetQuantities).values(quantityRows);
  }
}
