import { and, asc, eq, inArray, isNull, notExists, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  foldMovementQuery,
  MOVEMENT_PICKER_ENTRIES,
  trackingTypeSchema,
  unitSchema,
  type CatalogMovement,
  type TrackingType,
  type Unit,
} from '@mat-plan/shared';
import { CATALOG_MOVEMENTS } from '@mat-plan/shared/catalog/data';

import { schema } from '../../client';
import type { HouseholdScope } from '../../scope';
import type { Executor } from '../../writers/executor';
import { movementInHousehold, movementIsCatalog, movementIsGlobal } from '../../writers/ownership';
import { catalogArmOption, type CatalogArmOption } from './catalog-arm-option';

/**
 * One item the program builder's picker can offer. Structurally the web's `MovementOptionDTO`
 * (`apps/web/lib/movements/movement-option.ts`) with `trackingType` filled in: `packages/db` cannot
 * import the app, so the DAL that hands these to the picker pins the two as assignable.
 */
export type MovementOption =
  | CatalogArmOption
  | {
      readonly publicId: string;
      readonly name: string;
      readonly unitDefault: Unit | null;
      readonly isBodyweight: boolean;
      readonly trackingType: TrackingType;
      readonly owner: 'household';
    };

const PICKER_SLUGS = Object.keys(MOVEMENT_PICKER_ENTRIES) as Array<
  keyof typeof MOVEMENT_PICKER_ENTRIES
>;

/**
 * **Every item this household can pick** (FAM-1 step 6a-iii-a; PICK-1 PR 4's read, homed here; CAT-3
 * P11-ii-a): the catalog arm, then this household's own items. All live; each part by name, folded
 * (`foldMovementQuery`, then the name's code points), so the order is the same on every database
 * whatever its collation.
 *
 * - **The catalog arm is the old built-ins and every library row** (`MOVEMENT_PICKER_ENTRIES`' slugs, or
 *   `movementIsCatalog()`, inside the global and live conjuncts). Until the fresh start (CAT-3's R2)
 *   the 35 old built-ins stay listed (K22); a row with no library entry is listed bare, never dropped.
 *   Each row becomes its option through `catalogArmOption` (one mapping, its four cases tested there):
 *   the row's identity, the const's and the library's aliases joined, and the library's taxonomy,
 *   supervision label and `hasInstructions` by slug.
 * - **A household item a catalog row shadows is left out**: the resolver is global-first
 *   (`findOrCreateTypedMovement`), so a household row with a catalog slug is never the one a name
 *   reaches, and listing it would offer a second "Push-ups".
 * - **Every household item is listed, used or not.** `newItem` decides "this item exists" over this
 *   list (`existingItem`), with the same aliases the picker shows (K23), so an item left out could be
 *   added again under a re-spelled name. **The DAL only builds the DTO** (`apps/web/lib/dal/program/
 *   picker.ts`). The slug stops at the DAL.
 */
export async function movementOptions(
  exec: Executor,
  scope: HouseholdScope,
  /**
   * The library a catalog row's aliases, supervision label and "How to" come from (CAT-3 P11-ii-a).
   * ⏳ Defaults to the real library until the K29 PR, which derives it from the database (a fixtures
   * database is read with `CATALOG_FIXTURE`) and makes every caller pass it.
   */
  library: readonly CatalogMovement[] = CATALOG_MOVEMENTS,
): Promise<MovementOption[]> {
  const columns = {
    publicId: schema.movements.publicId,
    slug: schema.movements.slug,
    name: schema.movements.name,
    unitDefault: schema.movements.unitDefault,
    isBodyweight: schema.movements.isBodyweight,
    trackingType: schema.movements.trackingType,
  };
  const catalog = await exec
    .select(columns)
    .from(schema.movements)
    .where(
      // The old built-ins and every library row (spec rule 2), INSIDE the global and live conjuncts:
      // a household row on a picker slug never enters this arm (P11-ii's plan, panel P1-1).
      and(
        movementIsGlobal(),
        isNull(schema.movements.deletedAt),
        or(inArray(schema.movements.slug, PICKER_SLUGS), movementIsCatalog()),
      ),
    )
    .orderBy(asc(schema.movements.id));

  const shadow = alias(schema.movements, 'shadow');
  const own = await exec
    .select(columns)
    .from(schema.movements)
    .where(
      and(
        movementInHousehold(scope),
        isNull(schema.movements.deletedAt),
        notExists(
          exec
            .select({ one: sql`1` })
            .from(shadow)
            .where(
              and(
                isNull(shadow.householdId),
                isNull(shadow.deletedAt),
                eq(shadow.slug, schema.movements.slug),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(schema.movements.id));

  const declared = (row: (typeof catalog)[number]) => ({
    publicId: row.publicId,
    name: row.name,
    unitDefault: row.unitDefault === null ? null : unitSchema.parse(row.unitDefault),
    isBodyweight: row.isBodyweight,
    trackingType: trackingTypeSchema.parse(row.trackingType),
  });
  const byName = <R extends { name: string }>(a: R, b: R) => {
    const fa = foldMovementQuery(a.name);
    const fb = foldMovementQuery(b.name);
    if (fa !== fb) return fa < fb ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  };
  const bySlug = new Map(library.map((entry) => [entry.slug, entry]));
  const pickerEntries: Readonly<
    Record<string, (typeof MOVEMENT_PICKER_ENTRIES)[keyof typeof MOVEMENT_PICKER_ENTRIES]>
  > = MOVEMENT_PICKER_ENTRIES;
  return [
    ...[...catalog]
      .sort(byName)
      .map((row) =>
        catalogArmOption(
          { ...declared(row), slug: row.slug },
          pickerEntries[row.slug],
          bySlug.get(row.slug),
        ),
      ),
    ...[...own].sort(byName).map((row) => ({ ...declared(row), owner: 'household' as const })),
  ];
}
