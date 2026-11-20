import {
  newId,
  type RowValues,
  type StrengthSetInput,
  UNIT_DIMENSION_BY_CODE,
} from '@mat-plan/shared';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { schema } from '../client';
import type { Executor } from './executor';

/**
 * Row helpers for the entry graph: the strength writer and the FAM-1 row writer
 * (`writers/day/log-row.ts`) both write an entry's set rows through them (FAM-1 steps 11a, 11b), and Change rewrites a logged
 * row's numbers through `updateEntrySetRows` (11c-i).
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
 * FAM-1 row writer (one set per ✓, D3). Each calls it when it created the entry or, for the row
 * writer's revive (11c-ii), after soft-deleting the revived entry's live set; never on a replay, so a
 * retry never doubles the sets.
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
  // here would be an FK violation surfacing as a 500 on a gym floor. `verify.ts`'s GAP-3 hold (`sec`)
  // and `verify/day.ts` 4 (every tracking type) both write a non-mass quantity through here.
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

/**
 * **Change a logged row's numbers in place** (FAM-1 11c-i, plan A6): the entry's ONE live
 * `entry_sets` row, and each of its live `entry_set_quantities` by slot AND unit. No row is inserted
 * or deleted: a tracking type's shape is fixed, so a row that was logged already has every quantity
 * row its type needs.
 *
 * The same conventions as {@link insertEntrySetRows}: `reps` is set only where the type has reps,
 * never invented; a value goes in as `String(value)` for the numeric column. It takes only the
 * numbers (`Pick<RowValues, 'reps' | 'quantities'>`): the strength modes and status are not Change's.
 *
 * - **Each UPDATE must touch exactly one row**, or it throws: a broken entry graph (no live set, two,
 *   a missing quantity row) is a defect, never a partial write. The caller's transaction rolls it
 *   all back.
 * - **A quantity is matched on its stored unit too**, so a number in another unit throws rather than
 *   being stored under the old unit's label. The caller already refuses that case (`amendRow` judges
 *   against `loggedRowUnit`, C28); this keeps the helper safe for any other caller.
 * - **Keyed on the LIVE set's id**, returned by the first UPDATE, so a hidden set's quantities (whose
 *   own `deleted_at` stays NULL) are never written.
 * - **`updated_at` advances to the server's `now()`** on the set, each quantity and the entry. That is
 *   not client last-writer-wins: see `docs/tech-debt.md` → "Set-edit LWW uses server-`now()`".
 * - Child order is `entry_sets` then `entry_set_quantities`, as `updateStrengthSetById`, so the two
 *   paths take row locks in one order. That function is not reused: it is addressed by a set's
 *   public id, guarded to mass, done and non-bodyweight sets, and asserts no row count.
 */
export async function updateEntrySetRows(
  exec: Executor,
  args: { entryId: number; set: Pick<RowValues, 'reps' | 'quantities'> },
): Promise<void> {
  const now = sql`now()`;
  const sets = await exec
    .update(schema.entrySets)
    .set({ updatedAt: now, ...(args.set.reps !== undefined ? { reps: args.set.reps } : {}) })
    .where(and(eq(schema.entrySets.entryId, args.entryId), isNull(schema.entrySets.deletedAt)))
    .returning({ id: schema.entrySets.id });
  if (sets.length !== 1) {
    throw new Error(`entry ${args.entryId}: expected one live set, found ${sets.length}`);
  }
  const setId = sets[0].id;

  for (const q of args.set.quantities) {
    const updated = await exec
      .update(schema.entrySetQuantities)
      .set({ valueNum: String(q.value), updatedAt: now })
      .where(
        and(
          eq(schema.entrySetQuantities.entrySetId, setId),
          eq(schema.entrySetQuantities.slot, q.slot),
          eq(schema.entrySetQuantities.unit, q.unit),
          isNull(schema.entrySetQuantities.deletedAt),
        ),
      )
      .returning({ id: schema.entrySetQuantities.id });
    if (updated.length !== 1) {
      throw new Error(
        `entry ${args.entryId}: expected one live ${q.slot} quantity in ${q.unit}, found ${updated.length}`,
      );
    }
  }

  const entries = await exec
    .update(schema.entries)
    .set({ updatedAt: now })
    .where(eq(schema.entries.id, args.entryId))
    .returning({ id: schema.entries.id });
  if (entries.length !== 1) throw new Error(`entry ${args.entryId}: not found to stamp`);
}
