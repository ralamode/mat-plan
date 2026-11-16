import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable, PgUpdateSetSource } from 'drizzle-orm/pg-core';

import type { Executor } from '../executor';

/**
 * How far {@link shiftIntoBand} moves an `idx`: far past any real place (a workout has at most
 * `MAX_WORKOUT_ITEMS`, a day a handful of slots), so a shifted row never meets an unshifted one.
 */
export const SHIFT_BAND = 1_000_000;

/**
 * Reordering rows whose places are a NON-deferrable partial unique index (FAM-1 plan D19: a
 * workout's `uq_prescriptions_workout_idx`; later a week's `uq_block_day_workouts_slot` and an
 * athlete's program order). Setting the final places one row at a time collides as soon as two rows
 * swap: Postgres checks such an index row by row.
 *
 * So a reorder is two passes: **move every row it will place into the band** (`idx + SHIFT_BAND`, one
 * statement, which never collides because nothing lives there), then **set each row's final place**,
 * which is free because every competitor has left it. Rows that are removed are hidden first, which
 * frees their places (the index is partial on live rows).
 *
 * Call it inside a transaction: between the passes the rows sit in the band, and a reader outside
 * the transaction must never see that. `where` selects exactly the live rows being placed.
 */
export async function shiftIntoBand<T extends PgTable & { idx: PgColumn }>(
  exec: Executor,
  table: T,
  where: SQL | undefined,
): Promise<void> {
  await exec
    .update(table)
    .set({ idx: sql`${table.idx} + ${SHIFT_BAND}` } as PgUpdateSetSource<T>)
    .where(where);
}
