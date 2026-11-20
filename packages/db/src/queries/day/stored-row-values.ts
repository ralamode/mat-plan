import type { RowValues } from '@mat-plan/shared';

import type { Executor } from '../../writers/executor';
import { readLiveSets } from '../live-sets';

/**
 * **What logged program rows store, as `RowValues`**, keyed by internal entry id: the row writer's
 * answer to a replay and a re-tick (`writers/day/log-row.ts`), and 12a's `logged.values`.
 *
 * It reads through `readLiveSets` (`queries/live-sets.ts`), the one read of the live sets and their
 * live quantities that the day page's DAL read shares, so the load-bearing parent filter lives in
 * one place (mutation 172 drops it there).
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
  for (const set of await readLiveSets(exec, entryIds)) {
    if (values.has(set.entryId)) {
      throw new Error(`program row entry ${set.entryId} has more than one live set`);
    }
    values.set(set.entryId, {
      ...(set.reps !== null ? { reps: set.reps } : {}),
      quantities: set.quantities.map(({ slot, unit, value }) => ({ slot, unit, value })),
    });
  }
  return values;
}
