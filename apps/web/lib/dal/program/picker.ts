import 'server-only';

import { cache } from 'react';

import { movementOptions, type MovementOption } from '@mat-plan/db';
import { catalogHowToOf, uuidSchema, type CatalogHowTo } from '@mat-plan/shared';

import type { MovementOptionDTO, MovementPickerData } from '@/lib/movements/movement-option';

import { CATALOG_LIBRARY } from '../catalog-library';
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
 * - **A listed row is the DATABASE ROW's identity with the library's metadata**, built by the read
 *   (`catalogArmOption`, `packages/db`, CAT-3 P11-ii-a/b): its name, tracking type, unit and bodyweight
 *   flag are the row's, because the row is what a save, a log and `newItem` use (board, 2026-11-17:
 *   Sled push and Pallof press disagree today). A library row's taxonomy comes from its own columns
 *   and join rows (P11-ii-b); an old built-in's from the library entry on its slug, or none. Aliases,
 *   the supervision label and "How to" come from the library entry. This module only copies the
 *   option, so `newItem` and the picker match over the same aliases (K23).
 * - 🔴 **The slug stops here**: it is how the entry is found, and no option carries it
 *   (`picker.test.ts` pins the keys).
 *
 * Its own module, so a page that reads only a workout does not load the library. `cache()`d, as
 * `getWorkoutDraft` is.
 */

/**
 * One row as the picker's option: a field-by-field copy of what the read built (`catalogArmOption` in
 * `packages/db`, which owns the mapping since CAT-3 P11-ii-a), so a field the read gains later does not
 * reach the client by accident, and the slug never does.
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
  const group = row.group === undefined ? {} : { group: row.group };
  // ⏳ Until the fresh start: a row with no library entry is listed with no taxonomy (never a
  // placeholder one), so it shows how it is logged and passes no filter (K22).
  if (row.taxonomy === null) {
    return { ...identity, owner: 'catalog', ...group, aliases: [...row.aliases] };
  }
  return {
    ...identity,
    owner: 'catalog',
    ...group,
    aliases: [...row.aliases],
    modality: row.taxonomy.modality,
    pattern: row.taxonomy.pattern,
    equipment: [...row.taxonomy.equipment],
    primaryMuscle: row.taxonomy.primaryMuscle,
    secondaryMuscles: [...row.taxonomy.secondaryMuscles],
    supervision: row.supervision,
    hasInstructions: row.hasInstructions,
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
  // The library is chosen HERE, and only here (with `writes.ts`): ⏳ the K29 PR derives it from the
  // database, so a fixtures database is read with the fixture library.
  return quietDbErrors('movementOptions', () => movementOptions(db, scope, CATALOG_LIBRARY));
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
  return row?.owner === 'catalog' ? catalogHowToOf(CATALOG_LIBRARY, row.slug) : null;
}
