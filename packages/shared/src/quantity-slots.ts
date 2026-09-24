import { z } from 'zod';

import { keyBySelf } from './enums';
import type { UnitDimension } from './units';

/**
 * GAP-3 — the **role** a measured quantity plays in a logged set
 * ([plan](../../../docs/plans/gap3-pr3-entry-set-quantities.md)).
 *
 * The census (`docs/plans/gap3-typed-measurements.md` §2) found ONE free-text `load` column encoding
 * three different physical quantities — `20s` a duration, `30in` a height, `123 (50ft)` a mass AND a
 * distance. Fixed columns per dimension had already overflowed on the second real program (three worn
 * loads on one YDP movement), so the quantities live in a typed child table keyed by this vocabulary.
 *
 * **One axis: role, never dimension.** An earlier draft mixed the two — `primary` pinned to mass
 * alongside `height`/`distance` pinned to length — and the adversarial panel broke it on two
 * movements ALREADY in the seeded catalog: `broad_jump` measures a length and `hollow-body_hold`
 * measures a duration, so their primary quantity had nowhere to go but the slot that holds a sled
 * push's AUXILIARY distance. One slot, two roles, no discriminator.
 *
 * So `primary` is "whatever this movement is about", at whichever dimension the movement declares,
 * and there is deliberately **no `height` slot**: a box jump's height IS its primary quantity, and a
 * second slot that could hold the same fact is exactly the ambiguity this design exists to remove.
 */
export const QUANTITY_SLOT_CODES = ['primary', 'vest', 'ankle', 'wrist', 'distance'] as const;

export type QuantitySlot = (typeof QUANTITY_SLOT_CODES)[number];

export const quantitySlotSchema = z.enum(QUANTITY_SLOT_CODES);

/** Branch on a NAMED member (`QUANTITY_SLOT.vest`), never a bare string (constants convention). */
export const QUANTITY_SLOT = keyBySelf(QUANTITY_SLOT_CODES);

export const QUANTITY_SLOT_LABELS: Record<QuantitySlot, string> = {
  primary: 'Weight',
  vest: 'Vest',
  ankle: 'Ankle weights',
  wrist: 'Wrist weights',
  distance: 'Distance',
};

/**
 * Which dimensions each slot is legal at. A slot may be legal at MORE THAN ONE — `primary` is a mass
 * for a back squat, a length for a broad jump, a duration for a hollow-body hold.
 *
 * A `Record<QuantitySlot, …>` on purpose: adding a slot without declaring its dimensions is a
 * **compile error**, which is the cheapest possible place to catch it — before the seed, before the
 * FK, before a row exists.
 *
 * ⚠️ These pairs become the `quantity_slots` PRIMARY KEY, and `entry_set_quantities` FKs against it.
 * Once a quantity row exists, REMOVING a pair is an expand→contract (the FK has no `ON UPDATE
 * CASCADE`, and `db:seed` runs on every push to main). ADDING one stays cheap.
 */
export const QUANTITY_SLOT_DIMENSIONS_BY_CODE: Record<QuantitySlot, readonly UnitDimension[]> = {
  primary: ['mass', 'length', 'time'],
  vest: ['mass'],
  ankle: ['mass'],
  wrist: ['mass'],
  distance: ['length'],
};

/**
 * Rows for the `quantity_slots` reference-table seed (idempotent). One row per (code, dimension)
 * pair — the table's composite PK, and the target of `entry_set_quantities`' slot FK.
 */
export const QUANTITY_SLOT_ROWS = QUANTITY_SLOT_CODES.flatMap((code) =>
  QUANTITY_SLOT_DIMENSIONS_BY_CODE[code].map((dimension) => ({ code, dimension })),
);

/** Whether a slot may carry a quantity of this dimension — the app-side mirror of the composite FK. */
export function slotAcceptsDimension(slot: QuantitySlot, dimension: UnitDimension): boolean {
  return QUANTITY_SLOT_DIMENSIONS_BY_CODE[slot].includes(dimension);
}
