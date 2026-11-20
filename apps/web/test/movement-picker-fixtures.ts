import {
  catalogOptionOf,
  EQUIPMENT_CODE,
  MODALITY,
  MOVEMENT_PICKER_ENTRIES,
  MOVEMENT_SEED_ROWS,
  TRACKING_TYPE,
  type CatalogMovement,
  type CatalogOptionTaxonomy,
} from '@mat-plan/shared';
import { CATALOG_FIXTURE, CATALOG_FIXTURE_IDS } from '@mat-plan/shared/catalog/fixture';
import { fireEvent } from '@testing-library/react';
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

/**
 * A library movement as the option read gives it (CAT-3 C0b-2): `catalogOptionOf` over a
 * `CATALOG_FIXTURE` entry, with its fixture id, and no legacy `group`. What the browse tree is
 * tested over: the test library covers every kind and lift pattern.
 */
export const libraryOption = (entry: CatalogMovement): MovementOptionDTO => {
  const publicId = CATALOG_FIXTURE_IDS[entry.slug];
  if (!publicId) throw new Error(`fixture: ${entry.slug} has no fixture id`);
  return catalogOptionOf(entry, publicId);
};

/** Every `CATALOG_FIXTURE` entry as an option, in the fixture's order. */
export const LIBRARY_OPTIONS: readonly MovementOptionDTO[] = CATALOG_FIXTURE.map(libraryOption);

/** The test library's option named `name`. */
export const libraryNamed = (name: string): MovementOptionDTO => {
  const entry = CATALOG_FIXTURE.find((e) => e.name === name);
  if (!entry) throw new Error(`fixture: no library movement named ${name}`);
  return libraryOption(entry);
};

/**
 * ⏳ The same row as an old built-in with no library entry (`BuiltInWithoutLibrary`, until CAT-3
 * chunk R): every taxonomy field removed, never a placeholder.
 */
export const withoutLibraryData = (option: MovementOptionDTO): MovementOptionDTO =>
  Object.fromEntries(
    Object.entries(option).filter(([key]) => !(key in TEST_TAXONOMY)),
  ) as MovementOptionDTO;

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

/** More clicks than the test library has groups, with room to spare. */
const EXPAND_BROWSE_MAX_CLICKS = 100;

/**
 * Opens every closed group of the picker's browse tree (CAT-3 B3), outermost first, until none is
 * left. A list longer than `BROWSE_OPEN_AT_MOST` starts with its kinds and families closed; a suite
 * about something else opens them with this. A "How to" button is not a group (it sits in no
 * heading). `root` scopes it, to the sheet when the page behind has its own disclosures.
 */
export function expandBrowse(root: ParentNode = document) {
  // Bounded: a group that does not open on a click would otherwise loop forever.
  for (let clicks = 0; clicks < EXPAND_BROWSE_MAX_CLICKS; clicks += 1) {
    const closed = root.querySelector<HTMLButtonElement>(
      ':is(h3, h4, h5) > button[aria-expanded="false"]',
    );
    if (!closed) return;
    fireEvent.click(closed);
  }
  throw new Error(
    `expandBrowse: still a closed group after ${EXPAND_BROWSE_MAX_CLICKS} clicks; a group's button may not open it`,
  );
}

/**
 * The sheet pops its history entry on close, and in jsdom that popstate lands in a LATER test and
 * closes its sheet. Call in a `beforeEach`.
 */
export function stubSheetHistory() {
  window.history.replaceState(null, '');
  vi.spyOn(window.history, 'back').mockImplementation(() => {});
}
