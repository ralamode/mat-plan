import type { EntryStatus, QuantitySlot, Unit, UnitDimension } from '@mat-plan/shared';
import { and, asc, inArray, isNull } from 'drizzle-orm';

import { schema } from '../client';
import type { Executor } from '../writers/executor';

/** One live quantity of a live set, as stored (the value coerced from `numeric`). */
export type LiveSetQuantity = {
  slot: QuantitySlot;
  dimension: UnitDimension;
  unit: Unit;
  value: number;
};

/** One live set of an entry, with its live quantities. `id` is internal; it never leaves the server. */
export type LiveSet = {
  id: number;
  entryId: number;
  publicId: string;
  idx: number;
  reps: number | null;
  isBodyweight: boolean;
  isBand: boolean;
  status: EntryStatus;
  quantities: LiveSetQuantity[];
};

/**
 * **The one two-query read of the entries' live `entry_sets` and their live quantities**, in `(idx, id)`
 * order, quantities in `id` order (the month export joins the same tables in its own single query,
 * `export-month.ts`). Both two-query readers go through it: the day page's DAL read
 * (`listEntriesForDay`) and the program row's `readRowValues` (the writer's replay and re-tick, 12a's
 * day plan, the previous-values read).
 *
 * Two queries: the LIVE sets, then the live quantities **of those set ids**. ⚠️ **The parent filter is
 * load-bearing**: `ON DELETE CASCADE` on `entry_set_quantities` is hard-delete only, and this app only
 * soft-deletes, so a soft-deleted set's quantities are still `deleted_at IS NULL`. Selecting by the
 * live set ids is what keeps them out. Mutation 172 drops the set filter here; `db:verify` reaches it
 * through `readRowValues`, and the DAL's emitted-SQL test pins that `listEntriesForDay` calls this
 * read (`lib/dal/entries.test.ts`, which also pins its one app importer).
 *
 * Takes internal ids the caller has already proved owned; it adds no ownership of its own.
 */
export async function readLiveSets(
  exec: Executor,
  entryIds: readonly number[],
): Promise<LiveSet[]> {
  if (entryIds.length === 0) return [];

  const sets = await exec
    .select({
      id: schema.entrySets.id,
      entryId: schema.entrySets.entryId,
      publicId: schema.entrySets.publicId,
      idx: schema.entrySets.idx,
      reps: schema.entrySets.reps,
      isBodyweight: schema.entrySets.isBodyweight,
      isBand: schema.entrySets.isBand,
      status: schema.entrySets.status,
    })
    .from(schema.entrySets)
    .where(
      and(inArray(schema.entrySets.entryId, [...entryIds]), isNull(schema.entrySets.deletedAt)),
    )
    .orderBy(asc(schema.entrySets.idx), asc(schema.entrySets.id));
  if (sets.length === 0) return [];

  const quantities = await exec
    .select({
      entrySetId: schema.entrySetQuantities.entrySetId,
      slot: schema.entrySetQuantities.slot,
      dimension: schema.entrySetQuantities.dimension,
      unit: schema.entrySetQuantities.unit,
      valueNum: schema.entrySetQuantities.valueNum,
    })
    .from(schema.entrySetQuantities)
    .where(
      and(
        inArray(
          schema.entrySetQuantities.entrySetId,
          sets.map((s) => s.id),
        ),
        isNull(schema.entrySetQuantities.deletedAt),
      ),
    )
    .orderBy(asc(schema.entrySetQuantities.id));

  const bySet = new Map<number, LiveSetQuantity[]>();
  for (const q of quantities) {
    const list = bySet.get(q.entrySetId) ?? [];
    list.push({
      // CHECK- and FK-pinned to QUANTITY_SLOT_CODES, the dimensions and UNIT_CODES (the composite FKs).
      slot: q.slot as QuantitySlot,
      dimension: q.dimension as UnitDimension,
      unit: q.unit as Unit,
      value: Number(q.valueNum),
    });
    bySet.set(q.entrySetId, list);
  }
  return sets.map((s) => ({
    ...s,
    status: s.status as EntryStatus,
    quantities: bySet.get(s.id) ?? [],
  }));
}
