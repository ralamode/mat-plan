import { and, asc, eq, inArray, isNull, notExists, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  foldMovementQuery,
  MOVEMENT_PICKER_ENTRIES,
  MUSCLE_ROLE,
  pickerEntryOf,
  trackingTypeSchema,
  unitSchema,
  type CatalogMovement,
  type TrackingType,
  type Unit,
} from '@mat-plan/shared';

import { schema } from '../../client';
import type { HouseholdScope } from '../../scope';
import type { Executor } from '../../writers/executor';
import { movementInHousehold, movementIsCatalog, movementIsGlobal } from '../../writers/ownership';
import {
  catalogArmOption,
  catalogTaxonomyOf,
  type CatalogArmOption,
  type CatalogArmRow,
  type CatalogTaxonomyRows,
} from './catalog-arm-option';

/**
 * One item the program builder's picker can offer. Structurally the web's `MovementOptionDTO`
 * (`apps/web/lib/movements/movement-option.ts`) with `trackingType` filled in: `packages/db` cannot
 * import the app, so the DAL that hands these to the picker pins the two as assignable.
 */
export type MovementOption =
  CatalogArmOption | (Omit<CatalogArmRow, 'slug'> & { readonly owner: 'household' });

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
 *   the row's identity, the const's and the library's aliases joined, and the library's supervision
 *   label and `hasInstructions` by slug.
 * - **A catalog row's taxonomy is the tables'** (P11-ii-b): `modality` and `pattern` from its row, its
 *   equipment and muscles from `movement_equipment` and `movement_muscles`, read for the listed catalog
 *   ids only (`catalogTaxonomyRows`) and assembled by `catalogTaxonomyOf`. An old built-in keeps the
 *   library entry's taxonomy by slug, or none.
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
   * Required: only the DAL chooses it (the K29 PR derives it from the database), so `newItem` and the
   * picker always match over the same library (K23).
   */
  library: readonly CatalogMovement[],
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
    .select({
      ...columns,
      // The internal id keys the join reads below and never reaches an option ((a8)).
      id: schema.movements.id,
      // Rule 2's one predicate, selected, never re-derived as `modality !== null` here.
      isCatalog: sql<boolean>`(${movementIsCatalog()})`,
      modality: schema.movements.modality,
      pattern: schema.movements.pattern,
    })
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

  const declared = (row: (typeof own)[number]) => ({
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
  const catalogRows = catalog.filter((row) => row.isCatalog);
  const tables = catalogTaxonomyOf(
    catalogRows,
    await catalogTaxonomyRows(
      exec,
      catalogRows.map((row) => row.id),
    ),
  );
  return [
    ...[...catalog]
      .sort(byName)
      .map((row) =>
        catalogArmOption(
          { ...declared(row), slug: row.slug },
          pickerEntryOf(row.slug),
          bySlug.get(row.slug),
          tables.get(row.id),
        ),
      ),
    ...[...own].sort(byName).map((row) => ({ ...declared(row), owner: 'household' as const })),
  ];
}

/**
 * 🔴 **The join rows for the listed catalog ids, and only those** (CAT-3 P11-ii-b (b2)). Three reads:
 * the equipment, the primary muscle and the secondaries (never one read ordered "by role"), in turn. Unparsed
 * and unordered: `catalogTaxonomyOf` parses, orders, and throws on a row for an id not listed. No ids,
 * no query. Exported so `db:verify` asserts its raw rows.
 */
export async function catalogTaxonomyRows(
  exec: Executor,
  ids: readonly number[],
): Promise<CatalogTaxonomyRows> {
  if (ids.length === 0) return { equipment: [], primaryMuscles: [], secondaryMuscles: [] };
  const muscles = (role: (typeof MUSCLE_ROLE)[keyof typeof MUSCLE_ROLE]) =>
    exec
      .select({
        movementId: schema.movementMuscles.movementId,
        code: schema.movementMuscles.muscleCode,
      })
      .from(schema.movementMuscles)
      .where(
        and(
          inArray(schema.movementMuscles.movementId, [...ids]),
          eq(schema.movementMuscles.role, role),
        ),
      );
  // One after another, never `Promise.all`: `newItem` passes its transaction's client, and pg warns on
  // concurrent queries on one client (removed in pg 9); on the pool it would take three connections.
  const equipment = await exec
    .select({
      movementId: schema.movementEquipment.movementId,
      code: schema.movementEquipment.equipmentCode,
    })
    .from(schema.movementEquipment)
    .where(inArray(schema.movementEquipment.movementId, [...ids]));
  const primaryMuscles = await muscles(MUSCLE_ROLE.primary);
  const secondaryMuscles = await muscles(MUSCLE_ROLE.secondary);
  return { equipment, primaryMuscles, secondaryMuscles };
}
