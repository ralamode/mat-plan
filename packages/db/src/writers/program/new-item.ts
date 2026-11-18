import { and, desc, eq, sql } from 'drizzle-orm';

import {
  existingItem,
  MAX_HOUSEHOLD_ITEMS,
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
import { householdRowIs, movementIsAvailableTo, movementIsGlobal } from '../ownership';
import { refuse } from './refuse';

type NewItemResult = ProgramResult<{
  itemPublicId: string;
  name: string;
  trackingType: TrackingType;
  existed: boolean;
}>;

/**
 * The advisory-lock namespace for a household's own items (the first key; the household's id is
 * `hashint8` of the household's id the second, so any bigint id fits). Any other per-household
 * advisory lock takes its own namespace.
 */
export const ITEM_LOCK = 600_001;

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
 * **The household's own items are capped** (`MAX_HOUSEHOLD_ITEMS`, contract change C35, invariant 30):
 * step 3 answers `limit_reached` when the household already made that many. Steps 1 and 2 never do:
 * selecting an item adds nothing. The library's items do not count. Race-safe: the whole call holds a
 * transaction-scoped advisory lock on the household (`ITEM_LOCK`), so two adds at once count one
 * after the other, and the second sees the first's row (and selects it, if it is the same name).
 *
 * Refusals: a name or type the schema refuses is `invalid`; it is never `name_taken`; past the cap,
 * `limit_reached`. D25's races are closed by the lock: a second add at the same moment waits, then
 * finds the first add's item by the picker's rule (`pushups` after `push ups` included) and selects
 * it with `existed: true`. Only the strength logger's own find-or-create (`findOrCreateMovement`)
 * still makes items outside the lock.
 */
export async function newItem(
  exec: Executor,
  scope: HouseholdScope,
  input: unknown,
): Promise<NewItemResult> {
  const parsed = newItemSchema.safeParse(input);
  if (!parsed.success) return refuse(PROGRAM_REFUSAL.invalid);
  const { name, trackingType } = parsed.data;
  return exec.transaction(async (tx) => addOrSelect(tx, scope, name, trackingType));
}

async function addOrSelect(
  exec: Executor,
  scope: HouseholdScope,
  name: string,
  trackingType: TrackingType,
): Promise<NewItemResult> {
  // Held until the transaction ends. Reached through the household row, so the tenant id is never
  // unwrapped here; no row (a household that is gone) takes no lock, and the add then fails as before.
  await exec
    .select({ locked: sql`pg_advisory_xact_lock(${ITEM_LOCK}, hashint8(${schema.households.id}))` })
    .from(schema.households)
    .where(householdRowIs(scope));

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

  // The household's own items, as the picker lists them (live, not shadowed by a catalog item):
  // the fake's count, from the list already read under the lock.
  const own = options.filter((option) => option.owner !== 'catalog').length;
  if (own >= MAX_HOUSEHOLD_ITEMS) return refuse(PROGRAM_REFUSAL.limit_reached);

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
