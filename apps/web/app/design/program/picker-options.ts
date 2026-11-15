import { FIXTURE_ITEMS } from '@mat-plan/shared/program/fixtures';

import type { MovementOptionDTO } from '@/lib/movements/movement-option';

/**
 * The contract's `picker-options` fixture (FAM-1 plan §4, §8: "Add items", "No item matches"): the
 * accepted prototype's item catalog as the item picker's options.
 *
 * It lives here and not with the other named fixtures because its shape is the web's
 * `MovementOptionDTO`. The items, their ids and their tracking types are `FIXTURE_ITEMS`, the same
 * ones every other fixture names, in the prototype's catalog order.
 *
 * **Each is a household item with no declared unit.** The prototype's catalog holds a name and a
 * tracking type and nothing else: no browse group, no aliases, no default unit. So nothing here
 * invents one, and the picker lists them as it lists a household's own items.
 */
export const pickerOptions: readonly MovementOptionDTO[] = FIXTURE_ITEMS.map((item) => ({
  publicId: item.itemPublicId,
  name: item.name,
  trackingType: item.trackingType,
  owner: 'household',
  unitDefault: null,
  isBodyweight: false,
}));
