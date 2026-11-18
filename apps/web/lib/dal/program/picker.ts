import 'server-only';

import { cache } from 'react';

import { movementOptions, type MovementOption } from '@mat-plan/db';
import { catalogOptionOf, movementNameKey, type CatalogMovement } from '@mat-plan/shared';
import { CATALOG_MOVEMENTS } from '@mat-plan/shared/catalog/data';

import type { MovementOptionDTO, MovementPickerData } from '@/lib/movements/movement-option';

import { db } from '../db';
import { getHouseholdScope } from '../household';
import { quietDbErrors } from '../quiet-db-errors';

/**
 * The program builder's item picker data (FAM-1 step 7a-ii; CAT-3 spec P11-i), through the
 * caller's household, from lane P's `movementOptions` (6a-iii-a).
 *
 * - **The household's own items, every one** (made, used or not), as they are.
 * - **An old built-in only when the movement library has an entry on its slug** _(maintainer,
 *   2026-11-17: "Only ones with library data")_. Today that is 4 of the 35 picker rows; the rest
 *   come back with the library's seed (A2). `newItem` still answers a name of a hidden row with that
 *   row (`existed: true`), whether or not it is listed here.
 * - **A listed built-in is the library's taxonomy on the DATABASE ROW's identity**
 *   (`pickerOptionOf`): its name, tracking type, unit and bodyweight flag are the row's, because the
 *   row is what a save, a log and `newItem` use; the screen must never promise a type the save then
 *   reads differently (board, 2026-11-17: Sled push and Pallof press disagree today). The library
 *   gives what P11-i names: the taxonomy, the supervision label, whether it has instructions, and
 *   its aliases, joined with the row's own.
 * - 🔴 **The slug stops here**: it is how the entry is found, and no option carries it
 *   (`program-dal.test.ts` pins the keys).
 *
 * Its own module, so a page that reads only a workout does not load the library. `cache()`d, as
 * `getWorkoutDraft` is.
 */

/** The library's entries by slug, built once. */
const LIBRARY: ReadonlyMap<string, CatalogMovement> = new Map(
  CATALOG_MOVEMENTS.map((entry) => [entry.slug, entry]),
);

/** Every alias once, by the picker's "same name" key, the row's first. */
function joinAliases(...lists: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>();
  return lists.flat().filter((alias) => {
    const key = movementNameKey(alias);
    if (key === '' || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * One row as the picker's option, or `null` for a built-in the library has no entry for. Built
 * field by field, so a field `catalogOptionOf` or the read gains later does not reach the client
 * by accident.
 */
export function pickerOptionOf(
  row: MovementOption,
  library: ReadonlyMap<string, CatalogMovement> = LIBRARY,
): MovementOptionDTO | null {
  const identity = {
    publicId: row.publicId,
    name: row.name,
    trackingType: row.trackingType,
    unitDefault: row.unitDefault,
    isBodyweight: row.isBodyweight,
  };
  if (row.owner === 'household') return { ...identity, owner: 'household' };
  const entry = library.get(row.slug);
  if (!entry) return null;
  const fromLibrary = catalogOptionOf(entry, row.publicId);
  return {
    ...identity,
    owner: 'catalog',
    group: row.group,
    // The row's aliases are the server's (`newItem` matches over them); the library's join them, so
    // what the picker withholds is always at least what the server would select.
    aliases: joinAliases(row.aliases, fromLibrary.aliases),
    modality: fromLibrary.modality,
    pattern: fromLibrary.pattern,
    equipment: fromLibrary.equipment,
    primaryMuscle: fromLibrary.primaryMuscle,
    secondaryMuscles: fromLibrary.secondaryMuscles,
    supervision: fromLibrary.supervision,
    hasInstructions: fromLibrary.hasInstructions,
  };
}

/** The picker's data for the caller's household, or `null` with no household. */
export const getItemPickerData = cache(
  async function getItemPickerData(): Promise<MovementPickerData | null> {
    const scope = await getHouseholdScope();
    if (!scope) return null;
    // Through `quietDbErrors`, as the writes are: a failed query's parameters stay out of the logs.
    const rows = await quietDbErrors('movementOptions', () => movementOptions(db, scope));
    return {
      options: rows.flatMap((row) => {
        const option = pickerOptionOf(row);
        return option ? [option] : [];
      }),
    };
  },
);
