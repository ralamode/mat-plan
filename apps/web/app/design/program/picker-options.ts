import {
  catalogHowToOf,
  catalogOptionOf,
  MODALITY,
  movementFamilyOf,
  movementNameKey,
  type CatalogHowTo,
  type MovementFamily,
  type MovementPickerGroup,
} from '@mat-plan/shared';
import { CATALOG_FIXTURE, CATALOG_FIXTURE_IDS } from '@mat-plan/shared/catalog/fixture';
import { FIXTURE_ITEMS } from '@mat-plan/shared/program/fixtures';

import type { MovementOptionDTO } from '@/lib/movements/movement-option';

/**
 * The contract's `picker-options` fixture (FAM-1 plan §4, §8: "Add items", "No item matches"; CAT-3
 * spec, chunk C0b-2): what the preview's item picker lists.
 *
 * **Two kinds of row, as the real read returns** (CAT-3 spec P11):
 *
 * 1. **The test library** (`CATALOG_FIXTURE`), each entry through `catalogOptionOf`, so a library
 *    row here has exactly the fields a real one has: its taxonomy, its aliases, a supervision label
 *    where the entry has one, and whether it has instructions.
 * 2. **The household's own items**: the accepted prototype's item catalog (`FIXTURE_ITEMS`), each
 *    with a name and a tracking type and nothing else. No taxonomy, no aliases, no default unit.
 *
 * 🔴 **Four names are in both lists** (Goblet squat, Side plank, Easy run, Jump rope), and the real
 * read never lists a household item a library row shadows. So the preview lists ONE row for each:
 *
 * - **Two log the same way in both** (Goblet squat, Side plank): the row is the library's, under
 *   the fixture item's public id, because every other fixture (a workout's draft, a day's plan)
 *   names the item by that id. That is what the fixtures chunk (F1) does for all of them; until
 *   then it is done here, by name.
 * - **Two do not** (Jump rope: a count in the test library, a duration in the prototype; Easy run:
 *   a duration in the test library, a distance in the prototype): the row stays the household's item, since the fixtures log
 *   it that way, and the library's is left out. One entry has one tracking type (spec rule 10),
 *   so a real library would give the two different names; F1 settles it.
 *
 * It lives here and not with the other named fixtures because its shape is the web's
 * `MovementOptionDTO`.
 */
const itemByNameKey = new Map(FIXTURE_ITEMS.map((item) => [movementNameKey(item.name), item]));

/**
 * The picker's old browse group for a library row. ⚠️ **Interim.** Today's picker still reads
 * `group` (its browse sections and the group tag in search results), so on the preview this
 * mapping decides which old section a library row sits under: a rowing machine under Legs, a
 * biceps curl under Pull. That is a stand-in, not a claim about the movement. The picker lane's
 * chunks make the field optional and then delete it with the old sections (CAT-3 spec P12); the
 * `satisfies` below stops this file compiling the day it is gone, and this function goes then.
 */
function interimGroupOf(option: Parameters<typeof movementFamilyOf>[0]): MovementPickerGroup {
  if (option.modality === MODALITY.skill) return 'wrestling';
  const byFamily: Record<MovementFamily, MovementPickerGroup> = {
    horizontal_push: 'push',
    vertical_push: 'push',
    horizontal_pull: 'pull',
    vertical_pull: 'pull',
    squat: 'legs',
    hinge: 'legs',
    lunge: 'legs',
    jump: 'legs',
    carry: 'core',
    core: 'core',
    isolation: 'pull',
    neck_shoulders: 'push',
    chest_arms: 'push',
    back: 'pull',
    hips_legs: 'legs',
    whole_body: 'legs',
  };
  return byFamily[movementFamilyOf(option)];
}

const libraryRows = CATALOG_FIXTURE.flatMap((entry) => {
  const twin = itemByNameKey.get(movementNameKey(entry.name));
  // A pair that logs differently stays the household's item: see above.
  if (twin && twin.trackingType !== entry.trackingType) return [];
  const publicId = twin?.itemPublicId ?? CATALOG_FIXTURE_IDS[entry.slug];
  if (publicId === undefined) throw new Error(`picker-options: no fixture id for ${entry.slug}`);
  const option = catalogOptionOf(entry, publicId);
  const row = { ...option, group: interimGroupOf(option) } satisfies MovementOptionDTO;
  return [{ slug: entry.slug, option: row }];
});

/** The test library's movements, as the picker's library rows. */
export const catalogPickerOptions: readonly MovementOptionDTO[] = libraryRows.map(
  ({ option }) => option,
);

const libraryIds = new Set(catalogPickerOptions.map((option) => option.publicId));

/** The prototype's items that no library row shadows, as the household's own items. */
export const householdPickerOptions: readonly MovementOptionDTO[] = FIXTURE_ITEMS.filter(
  (item) => !libraryIds.has(item.itemPublicId),
).map((item) => ({
  publicId: item.itemPublicId,
  name: item.name,
  trackingType: item.trackingType,
  owner: 'household',
  unitDefault: null,
  isBodyweight: false,
}));

export const pickerOptions: readonly MovementOptionDTO[] = [
  ...catalogPickerOptions,
  ...householdPickerOptions,
];

const slugByPublicId = new Map(libraryRows.map(({ slug, option }) => [option.publicId, slug]));

/**
 * The preview's "How to" read (CAT-3 spec P16): the steps for one library row, by its public id,
 * with the supervision label that goes above them (K17). `null` for a household's item, an id
 * that is not listed, and a movement with no instructions.
 *
 * It is the fake of the read a real page has (a Route Handler, FAM-1 7b): that one maps the
 * row's public id to its catalog slug under the caller's scope and calls `catalogHowToOf` over
 * the library; this one
 * does the same over the test library. Async for the same reason the other fakes are: the real
 * one is.
 */
export async function previewHowTo(publicId: string): Promise<CatalogHowTo | null> {
  const slug = slugByPublicId.get(publicId);
  return slug === undefined ? null : catalogHowToOf(CATALOG_FIXTURE, slug);
}
