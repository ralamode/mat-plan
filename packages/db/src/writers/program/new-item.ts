import { and, desc, eq, sql } from 'drizzle-orm';

import {
  existingItem,
  MAX_HOUSEHOLD_ITEMS,
  movementSlug,
  newItemSchema,
  PROGRAM_REFUSAL,
  trackingTypeSchema,
  type ProgramResult,
  type CatalogMovement,
  type TrackingType,
} from '@mat-plan/shared';

import { schema } from '../../client';
import { matchableOption } from '../../queries/program/catalog-arm-option';
import { movementOptions } from '../../queries/program/movement-options';
import type { HouseholdScope } from '../../scope';
import { setLocalLockTimeout, type Executor } from '../executor';
import { findOrCreateTypedMovement } from '../movement-catalog';
import { householdRowIs, movementIsAvailableTo, movementIsGlobal } from '../ownership';
import { ADVISORY_LOCK } from '../locks';
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
 * 2. **Then the resolver's slug**, for an available row the picker does not list: the same answer,
 *    with its stored name and own type. The resolver would reach that row anyway; this step is what
 *    makes `existed` truthful for it. Since CAT-3 P11-ii-a every library row is in `movementOptions`
 *    with its library aliases, so a re-spelled name of one is selected at step 1, not made again.
 * 3. **Otherwise a new household item** through `findOrCreateTypedMovement`, typed as asked, with
 *    `existed: false`.
 *
 * **The household's own items are capped** (`MAX_HOUSEHOLD_ITEMS`, contract change C35, invariant 30):
 * step 3 answers `limit_reached` when the household already made that many. Steps 1 and 2 never do:
 * selecting an item adds nothing. The library's items do not count. Race-safe: the whole call holds a
 * transaction-scoped advisory lock on the household (`ADVISORY_LOCK.householdItems`, `writers/locks.ts`; the second key
 * is `hashint8` of the household's id, so any bigint id fits), so two adds at once count one
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
  /** The library step 1 matches catalog aliases from, as the picker's read gets it (K23). */
  library: readonly CatalogMovement[],
): Promise<NewItemResult> {
  const parsed = newItemSchema.safeParse(input);
  if (!parsed.success) return refuse(PROGRAM_REFUSAL.invalid);
  const { name, trackingType } = parsed.data;
  return exec.transaction(async (tx) => addOrSelect(tx, scope, name, trackingType, library));
}

async function addOrSelect(
  exec: Executor,
  scope: HouseholdScope,
  name: string,
  trackingType: TrackingType,
  library: readonly CatalogMovement[],
): Promise<NewItemResult> {
  // The wait below is bounded: a stuck holder cannot keep this request queued (`setLocalLockTimeout`).
  await setLocalLockTimeout(exec);
  // Held until the transaction ends. Reached through the household row, so the tenant id is never
  // unwrapped here. No row means the household is gone (an erasure mid-call): `not_found`, so the
  // count below never runs without the lock.
  const locked = await exec
    .select({
      locked: sql`pg_advisory_xact_lock(${ADVISORY_LOCK.householdItems}, hashint8(${schema.households.id}))`,
    })
    .from(schema.households)
    .where(householdRowIs(scope));
  if (locked.length !== 1) return refuse(PROGRAM_REFUSAL.not_found);

  const options = await movementOptions(exec, scope, library);
  const hit = existingItem(options.map(matchableOption), name);
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
