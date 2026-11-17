import type { RowValues } from '@mat-plan/shared';
import { and, asc, desc, eq, inArray, isNull, lt } from 'drizzle-orm';

import { schema } from '../../client';
import type { Executor } from '../../writers/executor';
import { programRow } from './program-rows';
import { readRowValues } from './stored-row-values';

/** What PREVIOUS is looked up by: the item's movement and the row's set number (R5). */
export type PreviousKey = { movementId: number; set: number };

/** The map key of a {@link PreviousKey}. */
export function previousKey(key: PreviousKey): string {
  return `${key.movementId}:${key.set}`;
}

/**
 * **PREVIOUS** (FAM-1 12a; `DayRow.previous`): what this athlete last logged for the same movement
 * and set number, on the most recent day before `day` that has such a row. One query for the whole
 * day, plus `readRowValues`' two.
 *
 * - **The same athlete** (`entries.profile_id`): a sibling's or another household's row never
 *   answers.
 * - **A program row** (`programRow`, `prescription_set IS NOT NULL`) before `day`, live. An old
 *   strength entry has no set; a weigh-in has no movement.
 * - **Keyed on the movement, not the prescription** (R5): two prescriptions of one movement share a
 *   PREVIOUS. A recorded limit.
 * - **The latest day, then the row logged first**: `created_at`, then the lower id, so the answer
 *   does not depend on insert order (one item in two workouts on one day).
 *
 * Takes the internal profile id and movement ids the caller has already proved owned; it adds no
 * ownership of its own. The caller applies "null on a day that is not writable, and on a removed
 * item"; this answers what it is asked.
 */
export async function previousRows(
  exec: Executor,
  profileId: number,
  day: string,
  keys: readonly PreviousKey[],
): Promise<Map<string, RowValues>> {
  const answers = new Map<string, RowValues>();
  if (keys.length === 0) return answers;
  const e = schema.entries;
  const movementIds = [...new Set(keys.map((k) => k.movementId))];
  const sets = [...new Set(keys.map((k) => k.set))];
  const rows = await exec
    .selectDistinctOn([e.movementId, e.prescriptionSet], {
      id: e.id,
      movementId: e.movementId,
      set: e.prescriptionSet,
    })
    .from(e)
    .where(
      and(
        eq(e.profileId, profileId),
        lt(e.activityDate, day),
        programRow(),
        isNull(e.deletedAt),
        inArray(e.movementId, movementIds),
        inArray(e.prescriptionSet, sets),
      ),
    )
    .orderBy(
      asc(e.movementId),
      asc(e.prescriptionSet),
      desc(e.activityDate),
      asc(e.createdAt),
      asc(e.id),
    );

  const values = await readRowValues(
    exec,
    rows.map((r) => r.id),
  );
  for (const row of rows) {
    if (row.movementId === null || row.set === null) continue;
    const stored = values.get(row.id);
    if (!stored) throw new Error(`program row entry ${row.id} has no live set`);
    answers.set(previousKey({ movementId: row.movementId, set: row.set }), stored);
  }
  return answers;
}
