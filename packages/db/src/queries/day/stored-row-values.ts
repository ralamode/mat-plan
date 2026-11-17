import { type QuantitySlot, type RowValues, type Unit } from '@mat-plan/shared';
import { and, asc, inArray, isNull } from 'drizzle-orm';

import { schema } from '../../client';
import type { Executor } from '../../writers/executor';

/**
 * **What logged program rows store, as `RowValues`**, keyed by internal entry id: the row writer's
 * answer to a replay and a re-tick (`writers/day/log-row.ts`), and 12a's `logged.values`.
 *
 * Two reads, as the app DAL's day read makes them (`apps/web/lib/dal/entries.ts`, the live sets and
 * then their quantities): the entries' LIVE `entry_sets`, then the live quantities **of those set
 * ids**. ⚠️ **The parent filter is load-bearing**: `ON DELETE CASCADE` on `entry_set_quantities` is
 * hard-delete only, and this app only soft-deletes, so a soft-deleted set's quantities are still
 * `deleted_at IS NULL`. Selecting by the live set ids is what keeps them out (mutation 172 drops the
 * set filter). The two reads are one shape written twice; folding the DAL's onto this one is filed in
 * `docs/tech-debt.md`.
 *
 * 🔴 **A program row has exactly one live set** (FAM-1 D3: one entry per ✓). An entry with two is a
 * broken row, and this throws rather than pick one. An entry with none is absent from the map.
 *
 * Takes internal ids the caller has already proved owned; it adds no ownership of its own.
 */
export async function readRowValues(
  exec: Executor,
  entryIds: readonly number[],
): Promise<Map<number, RowValues>> {
  const values = new Map<number, RowValues>();
  if (entryIds.length === 0) return values;

  const sets = await exec
    .select({
      id: schema.entrySets.id,
      entryId: schema.entrySets.entryId,
      reps: schema.entrySets.reps,
    })
    .from(schema.entrySets)
    .where(
      and(inArray(schema.entrySets.entryId, [...entryIds]), isNull(schema.entrySets.deletedAt)),
    )
    .orderBy(asc(schema.entrySets.id));

  const setIdToEntry = new Map<number, number>();
  for (const set of sets) {
    if (values.has(set.entryId)) {
      throw new Error(`program row entry ${set.entryId} has more than one live set`);
    }
    values.set(set.entryId, {
      ...(set.reps !== null ? { reps: set.reps } : {}),
      quantities: [],
    });
    setIdToEntry.set(set.id, set.entryId);
  }
  if (setIdToEntry.size === 0) return values;

  const quantities = await exec
    .select({
      entrySetId: schema.entrySetQuantities.entrySetId,
      slot: schema.entrySetQuantities.slot,
      unit: schema.entrySetQuantities.unit,
      valueNum: schema.entrySetQuantities.valueNum,
    })
    .from(schema.entrySetQuantities)
    .where(
      and(
        inArray(schema.entrySetQuantities.entrySetId, [...setIdToEntry.keys()]),
        isNull(schema.entrySetQuantities.deletedAt),
      ),
    )
    .orderBy(asc(schema.entrySetQuantities.id));

  for (const q of quantities) {
    values.get(setIdToEntry.get(q.entrySetId)!)!.quantities.push({
      // CHECK- and FK-pinned to QUANTITY_SLOT_CODES and UNIT_CODES (the composite FKs).
      slot: q.slot as QuantitySlot,
      unit: q.unit as Unit,
      value: Number(q.valueNum),
    });
  }
  return values;
}
