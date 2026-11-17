import { and, asc, eq, inArray, isNull, notExists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  foldMovementQuery,
  MOVEMENT_PICKER_ENTRIES,
  trackingTypeSchema,
  unitSchema,
  type MovementPickerGroup,
  type TrackingType,
  type Unit,
} from '@mat-plan/shared';

import { schema } from '../../client';
import type { HouseholdScope } from '../../scope';
import type { Executor } from '../../writers/executor';
import { movementInHousehold, movementIsGlobal } from '../../writers/ownership';

/**
 * One item the program builder's picker can offer. Structurally the web's `MovementOptionDTO`
 * (`apps/web/lib/movements/movement-option.ts`) with `trackingType` filled in: `packages/db` cannot
 * import the app, so the DAL that hands these to the picker pins the two as assignable.
 */
export type MovementOption = {
  readonly publicId: string;
  readonly name: string;
  readonly unitDefault: Unit | null;
  readonly isBodyweight: boolean;
  readonly trackingType: TrackingType;
} & (
  | {
      readonly owner: 'catalog';
      readonly group: MovementPickerGroup;
      readonly aliases: readonly string[];
    }
  | { readonly owner: 'household' }
);

const PICKER_SLUGS = Object.keys(MOVEMENT_PICKER_ENTRIES) as Array<
  keyof typeof MOVEMENT_PICKER_ENTRIES
>;

/**
 * **Every item this household can pick** (FAM-1 step 6a-iii-a; PICK-1 PR 4's read, homed here): the
 * catalog's curated rows whose slug `MOVEMENT_PICKER_ENTRIES` lists, each with its browse group and
 * aliases, then this household's own items. All live; catalog first, then each part by name, folded
 * (`foldMovementQuery`, then the name's code points), so the order is the same on every database
 * whatever its collation.
 *
 * - **A household item a catalog row shadows is left out**: the resolver is global-first
 *   (`findOrCreateTypedMovement`), so a household row with a catalog slug is never the one a name
 *   reaches, and listing it would offer a second "Push-ups".
 * - **Every household item is listed, used or not.** `newItem` decides "this item exists" over this
 *   list (`existingItem`), so an item left out could be added again under a re-spelled name. Which of
 *   them the picker shows first (recent, prescribed) is the DAL's and the picker's business: this is
 *   one read with no filters (CAT-3 later adds each catalog row's taxonomy here).
 */
export async function movementOptions(
  exec: Executor,
  scope: HouseholdScope,
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
      and(
        movementIsGlobal(),
        isNull(schema.movements.deletedAt),
        inArray(schema.movements.slug, PICKER_SLUGS),
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
  return [
    ...[...catalog].sort(byName).map((row) => {
      const entry = MOVEMENT_PICKER_ENTRIES[row.slug as keyof typeof MOVEMENT_PICKER_ENTRIES];
      return {
        ...declared(row),
        owner: 'catalog' as const,
        group: entry.group,
        aliases: entry.aliases ?? [],
      };
    }),
    ...[...own].sort(byName).map((row) => ({ ...declared(row), owner: 'household' as const })),
  ];
}
