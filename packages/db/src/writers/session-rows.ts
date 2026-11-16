import {
  newId,
  QUANTITY_SLOT,
  type StrengthSetInput,
  type Unit,
  UNIT_DIMENSION_BY_CODE,
} from '@mat-plan/shared';

import { schema } from '../client';
import type { Executor } from './executor';

/**
 * Row helpers for the entry graph that more than one writer needs (FAM-1 step 11a).
 *
 * ⚠️ Not re-exported from `src/index.ts`. Each helper writes part of an entry inside its caller's
 * transaction; called on its own it would leave a half-written graph.
 */

/** A set as `insertEntrySetRows` takes it. `weight` may be omitted or `null`: no magnitude. */
export type EntrySetRowInput = Omit<StrengthSetInput, 'weight'> & { weight?: number | null };

/**
 * Write an entry's `entry_sets` rows (1-based `idx`) and one PRIMARY `entry_set_quantities` row for
 * each set that carries a magnitude. The unit is the caller's, and the quantity's `dimension` is
 * derived from it, which is what the `units(code, dimension)` composite FK checks. Columns a set
 * does not set are OMITTED, so Postgres applies its own defaults and a `done` set writes a
 * byte-identical row.
 *
 * Called by `writeSessionStrengthEntry` only when it created the entry, never on a replay, so a
 * retry never doubles the sets. It is its only caller today.
 *
 * ⚠️ **What 11b must change before calling it** (the FAM-1 row writer, which writes one
 * `entry_sets` row and its quantities per ✓, D3): `reps` is required here, so it cannot take a
 * Check, Count, Duration, Time-per-set or Distance row, and only the `primary` slot is reachable,
 * so Distance cannot be written. 11b widens `reps` to optional and takes its quantities with their
 * slots, in this function, rather than writing a second copy. Never satisfy the type with a
 * placeholder `reps`: the column has no CHECK, and an invented number reads as reps done.
 */
export async function insertEntrySetRows(
  exec: Executor,
  args: { entryId: number; unit: Unit; sets: readonly EntrySetRowInput[] },
): Promise<void> {
  if (args.sets.length === 0) return;
  // GAP-3: the SET row now carries only reps, status and the two qualitative booleans; every
  // measured quantity is a child row written below. `weight_num`/`weight_label` are gone.
  const setRows = await exec
    .insert(schema.entrySets)
    .values(
      args.sets.map((s, i) => ({
        publicId: newId(),
        clientId: newId(),
        entryId: args.entryId,
        idx: i + 1, // 1-based
        reps: s.reps,
        // `bodyweight`/`band` are MODES, not quantities (GAP-3 §7.2b) — booleans, and omitted when
        // false so Postgres applies its own default and the row stays byte-minimal.
        ...(s.isBodyweight ? { isBodyweight: true } : {}),
        ...(s.isBand ? { isBand: true } : {}),
        // GAP-1 P1-1b — same omitted-takes-the-DB-default idiom as the entry's status. A `done` set
        // omits the column entirely, so every pre-existing caller writes a byte-identical row.
        ...('status' in s && s.status !== undefined ? { status: s.status } : {}),
      })),
    )
    .returning({ id: schema.entrySets.id });

  // One PRIMARY quantity per set that carries a magnitude.
  //
  // The unit comes from the MOVEMENT, and the dimension is derived from that unit rather than
  // assumed: since PR 4a the movement may be logged in `in` (a box jump) or `sec` (a hold), not only
  // `lb`/`kg`. Deriving keeps the pair consistent with `units(code, dimension)`, which the composite
  // FK checks — a hard-coded `'mass'` here would be an FK violation surfacing as a 500 on a gym
  // floor. Census §4.6 is why the unit is not on the value: "weight units are never written", so a
  // bare `185` means 185 of whatever this movement is logged in.
  //
  // A set with no magnitude (pure bodyweight, or a band) writes NO quantity row — a mode is not a
  // measurement, and a row with a NULL value would be the EAV smell the child table avoids.
  const quantityRows: (typeof schema.entrySetQuantities.$inferInsert)[] = [];
  args.sets.forEach((s, i) => {
    // `=== null` is not enough: the SCHEMA always emits `weight: null`, but the relaxed signature of
    // `writeSessionStrengthEntry` lets a direct caller (a future importer) omit the key entirely, so handle
    // both. Until DX-7 this was the ONLY thing standing between an omission and
    // `numeric: "undefined"` from Postgres, because `packages/db` was typechecked by nothing; the
    // package now has its own `tsconfig.json` in `pnpm typecheck`, so an omission through the
    // public `writeStrengthSession` is a compile error. This stays as the inner guard.
    if (s.weight === null || s.weight === undefined) return;
    quantityRows.push({
      clientId: newId(),
      entrySetId: setRows[i].id,
      slot: QUANTITY_SLOT.primary,
      dimension: UNIT_DIMENSION_BY_CODE[args.unit],
      unit: args.unit,
      valueNum: String(s.weight), // numeric column takes a string (precision-safe)
    });
  });

  if (quantityRows.length > 0) {
    await exec.insert(schema.entrySetQuantities).values(quantityRows);
  }
}
