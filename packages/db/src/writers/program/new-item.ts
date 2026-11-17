import { and, desc, eq } from 'drizzle-orm';

import {
  existingItem,
  movementSlug,
  newItemSchema,
  PROGRAM_REFUSAL,
  trackingTypeSchema,
  type ProgramResult,
  type TrackingType,
} from '@mat-plan/shared';

import { schema } from '../../client';
import { movementOptions } from '../../queries/program/movement-options';
import type { HouseholdScope } from '../../scope';
import type { Executor } from '../executor';
import { findOrCreateTypedMovement } from '../movement-catalog';
import { movementIsAvailableTo, movementIsGlobal } from '../ownership';
import { refuse } from './refuse';

type NewItemResult = ProgramResult<{
  itemPublicId: string;
  name: string;
  trackingType: TrackingType;
  existed: boolean;
}>;

/**
 * `ProgramActions.newItem`'s writer (FAM-1 step 6a-iii-a; contract change C8): add an item by name
 * and type, **or select the item the name already names**.
 *
 * 1. **The picker's rule first** (`existingItem` over `movementOptions`): the same key as an item's
 *    name (`push ups` is Push-ups), as one of a catalog item's aliases (`RDL` is Romanian
 *    Deadlift), or an abbreviation that spells the item (`db row` is Dumbbell row; C30). That item is the answer, with `existed: true`, **its stored name and its own type**,
 *    whatever type was asked (D25: nothing retypes an item).
 * 2. **Then the resolver's slug**, for an available row the picker does not list (a catalog row
 *    outside `MOVEMENT_PICKER_ENTRIES`): the same answer, with its stored name and own type. The
 *    resolver would reach that row anyway; this step is what makes `existed` truthful for it.
 *    ⚠️ It matches by slug, not by key: once rows outside the picker map exist in bulk (CAT-3's
 *    library), a re-spelled name of one would make a household item, unless those rows join
 *    `movementOptions`. The chunk that seeds them owes that.
 * 3. **Otherwise a new household item** through `findOrCreateTypedMovement`, typed as asked, with
 *    `existed: false`.
 *
 * Refusals: a name or type the schema refuses is `invalid`; it is never `name_taken`. D25's races
 * are accepted: two adds of one new name at once both reach step 3, the household slug index lets
 * one row in, and both answer it (each `existed: false`); two adds at once of names with one key
 * and different slugs (`pushups`, `push ups`) both insert, and leave two items.
 */
export async function newItem(
  exec: Executor,
  scope: HouseholdScope,
  input: unknown,
): Promise<NewItemResult> {
  const parsed = newItemSchema.safeParse(input);
  if (!parsed.success) return refuse(PROGRAM_REFUSAL.invalid);
  const { name, trackingType } = parsed.data;

  const options = await movementOptions(exec, scope);
  const hit = existingItem(
    options.map((option) => ({
      ...option,
      isCatalog: option.owner === 'catalog',
      aliases: option.owner === 'catalog' ? option.aliases : [],
    })),
    name,
  );
  if (hit) {
    return {
      ok: true,
      itemPublicId: hit.publicId,
      name: hit.name,
      trackingType: hit.trackingType,
      existed: true,
    };
  }

  const columns = {
    publicId: schema.movements.publicId,
    name: schema.movements.name,
    trackingType: schema.movements.trackingType,
  };
  const [sameSlug] = await exec
    .select(columns)
    .from(schema.movements)
    .where(and(eq(schema.movements.slug, movementSlug(name)), movementIsAvailableTo(scope)))
    // Global first, as the resolver reads: a catalog row wins over the household's own.
    .orderBy(desc(movementIsGlobal()))
    .limit(1);
  if (sameSlug) {
    return {
      ok: true,
      itemPublicId: sameSlug.publicId,
      name: sameSlug.name,
      trackingType: trackingTypeSchema.parse(sameSlug.trackingType),
      existed: true,
    };
  }

  const made = await findOrCreateTypedMovement(exec, scope, name, trackingType);
  const [row] = await exec
    .select(columns)
    .from(schema.movements)
    .where(eq(schema.movements.id, made.id));
  if (!row) return refuse(PROGRAM_REFUSAL.retry);
  return {
    ok: true,
    itemPublicId: row.publicId,
    name: row.name,
    trackingType: made.trackingType,
    existed: false,
  };
}
