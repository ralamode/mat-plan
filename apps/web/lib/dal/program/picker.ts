import 'server-only';

import { cache } from 'react';

import { movementOptions, type MovementOption } from '@mat-plan/db';
import {
  catalogHowToOf,
  catalogOptionOf,
  movementNameKey,
  uuidSchema,
  type CatalogHowTo,
  type CatalogMovement,
} from '@mat-plan/shared';
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
 * - ⏳ **Every old built-in, until the catalog's fresh start** _(maintainer, 2026-11-17: "Show all
 *   35 until reset", which suspends "only ones with library data")_: hiding the 31 the library has
 *   no entry for made search say a movement did not exist that `newItem` then selected. A built-in
 *   without an entry is `BuiltInWithoutLibrary`: no taxonomy, no "How to", passes no filter.
 *   TODO(CAT-3 chunk R, the fresh start): the library replaces the old catalog; list only rows the
 *   library has, and drop that arm.
 * - **A listed built-in is the library's taxonomy on the DATABASE ROW's identity**
 *   (`pickerOptionOf`): its name, tracking type, unit and bodyweight flag are the row's, because the
 *   row is what a save, a log and `newItem` use; the screen must never promise a type the save then
 *   reads differently (board, 2026-11-17: Sled push and Pallof press disagree today). The library
 *   gives what P11-i names: the taxonomy, the supervision label, whether it has instructions, and
 *   its aliases, joined with the row's own.
 * - 🔴 **The slug stops here**: it is how the entry is found, and no option carries it
 *   (`picker.test.ts` pins the keys).
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
 * One row as the picker's option. Built
 * field by field, so a field `catalogOptionOf` or the read gains later does not reach the client
 * by accident.
 */
export function pickerOptionOf(row: MovementOption): MovementOptionDTO {
  const identity = {
    publicId: row.publicId,
    name: row.name,
    trackingType: row.trackingType,
    unitDefault: row.unitDefault,
    isBodyweight: row.isBodyweight,
  };
  if (row.owner === 'household') return { ...identity, owner: 'household' };
  const entry = LIBRARY.get(row.slug);
  // ⏳ Until the fresh start: the row as it is, with no taxonomy (never a placeholder one).
  if (!entry) return { ...identity, owner: 'catalog', group: row.group, aliases: [...row.aliases] };
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

/**
 * The household's option rows, slugs included (they never leave this module), or `null` with no
 * household. One query per request for a page that reads the picker and How to both (`cache()`
 * does nothing inside a Route Handler, which runs one query per request).
 */
const householdMovementRows = cache(async function householdMovementRows() {
  const scope = await getHouseholdScope();
  if (!scope) return null;
  // Through `quietDbErrors`, as the writes are: a failed query's parameters stay out of the logs.
  return quietDbErrors('movementOptions', () => movementOptions(db, scope));
});

/** The picker's data for the caller's household, or `null` with no household. */
export const getItemPickerData = cache(
  async function getItemPickerData(): Promise<MovementPickerData | null> {
    const rows = await householdMovementRows();
    return rows && { options: rows.map((row) => pickerOptionOf(row)) };
  },
);

/**
 * One picker option's "How to" (FAM-1 7b; CAT-3 P16; the spec owner, 2026-11-18), or `null`.
 *
 * Resolved AMONG THE CALLER'S OWN OPTIONS, so another household's id and an unknown id are the same
 * `null`; a household's own item and a built-in with no library entry (K22) are `null` too, and
 * the picker shows no button for either. A non-uuid id is `null` before any query. The slug is
 * how the entry is found and never leaves this module; the answer is the strict `CatalogHowTo`.
 * Nothing is reported for a miss: no answer here can hold household data (the 7b plan, security N2).
 */
export async function getHowTo(optionId: string): Promise<CatalogHowTo | null> {
  if (!uuidSchema.safeParse(optionId).success) return null;
  const id = optionId.toLowerCase();
  const row = (await householdMovementRows())?.find((option) => option.publicId === id);
  return row?.owner === 'catalog' ? catalogHowToOf(CATALOG_MOVEMENTS, row.slug) : null;
}
