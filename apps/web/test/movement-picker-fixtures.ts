import {
  EQUIPMENT_CODE,
  MODALITY,
  MOVEMENT_PICKER_ENTRIES,
  MOVEMENT_SEED_ROWS,
  TRACKING_TYPE,
  type CatalogOptionTaxonomy,
} from '@mat-plan/shared';
import { vi } from 'vitest';

import type { MovementOptionDTO } from '@/lib/movements/movement-option';

/**
 * The movement picker's test fixtures, built from the REAL seeded catalog (picker guide, Traps: a
 * suite over invented options passes while the catalog does something else). Shared by
 * `movement-picker.test.tsx` and `movement-picker-filters.test.tsx`.
 *
 * ⚠️ **Outside `components/movements/`** on purpose: the picker's P6 scan reads every non-test module
 * in that folder against an import allowlist, and this one imports `vitest`.
 */

/**
 * The library fields a catalog option must carry (CAT-3 C0b-2), as a test default: a barbell lift
 * with no supervision and no instructions. ⚠️ Not `equipment: []`, which MEANS "No equipment". A
 * test that needs another shape passes `taxonomy`, typed as the contract's, so a misspelt or
 * missing field does not compile.
 */
export const TEST_TAXONOMY: CatalogOptionTaxonomy = {
  modality: MODALITY.strength,
  pattern: null,
  equipment: [EQUIPMENT_CODE.barbell],
  primaryMuscle: null,
  secondaryMuscles: [],
  supervision: null,
  hasInstructions: false,
};

/** A seeded movement as the picker's option read gives it, with its legacy group and aliases. */
export const catalogOption = (
  name: string,
  taxonomy: Partial<CatalogOptionTaxonomy> = {},
): MovementOptionDTO => {
  const row = MOVEMENT_SEED_ROWS.find((r) => r.name === name);
  if (!row) throw new Error(`fixture: no seeded movement named ${name}`);
  const entry = MOVEMENT_PICKER_ENTRIES[row.slug];
  if (!entry) throw new Error(`fixture: ${row.slug} has no picker entry`);
  return {
    publicId: row.publicId,
    name: row.name,
    owner: 'catalog',
    group: entry.group,
    aliases: entry.aliases ?? [],
    unitDefault: row.unitDefault,
    isBodyweight: row.isBodyweight,
    trackingType: TRACKING_TYPE.weight_reps,
    ...TEST_TAXONOMY,
    ...taxonomy,
  };
};

export const householdOption = (name: string, publicId: string): MovementOptionDTO => ({
  publicId,
  name,
  owner: 'household',
  unitDefault: null,
  isBodyweight: false,
  trackingType: TRACKING_TYPE.weight_reps,
});

/**
 * ⚠️ **Queried from the DOM, not through `screen`.** Radix's modal dialog puts `aria-hidden` on the
 * rest of the document while it is open, and Testing Library's role queries skip hidden nodes — so
 * `getByRole('button', { name: 'Open' })` stops finding the trigger the moment the sheet opens, with
 * an error that reads as "the harness did not render". The last `main > button` is this render's
 * trigger regardless.
 */
export const pickerTrigger = () =>
  [...document.querySelectorAll('main > button')].at(-1) as HTMLButtonElement;

/**
 * The sheet pops its history entry on close, and in jsdom that popstate lands in a LATER test and
 * closes its sheet. Call in a `beforeEach`.
 */
export function stubSheetHistory() {
  window.history.replaceState(null, '');
  vi.spyOn(window.history, 'back').mockImplementation(() => {});
}
