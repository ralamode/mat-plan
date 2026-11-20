import { catalogOptionOf, pickerEntryOf, TRACKING_TYPE } from '@mat-plan/shared';
import { CATALOG_MOVEMENTS } from '@mat-plan/shared/catalog/data';
import { describe, expect, it } from 'vitest';

import { catalogArmOption, joinAliases, type CatalogArmRow } from './catalog-arm-option';

/**
 * `catalogArmOption`'s four cases (CAT-3 P11-ii plan, Amendment 1, A1.2), over the real library, so a
 * test on "Sled push" is a test on the entry that disagrees with its row today. Moved here from
 * `apps/web/lib/dal/program/picker.test.ts` when the mapping moved into the read.
 */
const entry = (slug: string) => {
  const found = CATALOG_MOVEMENTS.find((e) => e.slug === slug);
  if (!found) throw new Error(`fixture: no library entry ${slug}`);
  return found;
};
const picker = pickerEntryOf;
const row = (over: Partial<CatalogArmRow>): CatalogArmRow => ({
  publicId: '019826b4-0000-7000-8000-00000000e001',
  slug: 'sled_push',
  name: 'Sled Push',
  unitDefault: 'lb',
  isBodyweight: false,
  trackingType: TRACKING_TYPE.weight_reps,
  ...over,
});

describe('an old built-in with a library entry', () => {
  it('🔴 keeps the ROW’s identity where the library disagrees (the row is what a save and a log use)', () => {
    const library = entry('sled_push');
    expect(library.trackingType).not.toBe(TRACKING_TYPE.weight_reps); // the disagreement is real
    const option = catalogArmOption(row({}), picker('sled_push'), library);
    expect(option).toMatchObject({
      name: 'Sled Push',
      trackingType: TRACKING_TYPE.weight_reps,
      unitDefault: 'lb',
      isBodyweight: false,
      owner: 'catalog',
      group: picker('sled_push')!.group,
    });
  });

  it('takes the library’s taxonomy, supervision and instructions, as catalogOptionOf gives them', () => {
    const library = entry('sled_push');
    const fromLibrary = catalogOptionOf(library, 'x');
    expect(catalogArmOption(row({}), picker('sled_push'), library)).toMatchObject({
      taxonomy: {
        modality: fromLibrary.modality,
        pattern: fromLibrary.pattern,
        equipment: fromLibrary.equipment,
        primaryMuscle: fromLibrary.primaryMuscle,
        secondaryMuscles: fromLibrary.secondaryMuscles,
      },
      supervision: fromLibrary.supervision,
      hasInstructions: fromLibrary.hasInstructions,
    });
  });

  it('🔴 its aliases: the const’s first, in order, then the library’s it does not already have', () => {
    const library = entry('pallof_press');
    const option = catalogArmOption(
      row({ slug: 'pallof_press', name: 'Pallof Press' }),
      { group: 'core', aliases: ['Anti-rotation press', 'Pallof'] },
      library,
    );
    expect(library.aliases).toEqual(['Cable Pallof press', 'Anti-rotation press']);
    expect(option.aliases).toEqual(['Anti-rotation press', 'Pallof', 'Cable Pallof press']);
  });

  it('🔴 two spellings of one alias are one (the "same name" key), the const’s spelling kept', () => {
    expect(
      joinAliases(['anti rotation press'], ['Anti-rotation press', 'Cable Pallof press']),
    ).toEqual(['anti rotation press', 'Cable Pallof press']);
  });
});

describe('the coach-supervision label', () => {
  it('🔴 a supervised entry’s label is on its option (a test that names supervision can fail on it)', () => {
    const library = entry('back_bridge');
    expect(library.supervision).toBe('coach');
    const option = catalogArmOption(
      row({ slug: library.slug, name: library.name, trackingType: library.trackingType }),
      undefined,
      library,
    );
    expect(option.supervision).toBe('coach');
  });
});

describe('⏳ an old built-in with no library entry (K22)', () => {
  it('the row and the const’s aliases and group, with NO taxonomy, never a placeholder one', () => {
    const option = catalogArmOption(
      row({ slug: 'calf_raises', name: 'Calf Raises' }),
      { group: 'legs', aliases: ['Heel raise'] },
      undefined,
    );
    expect(option).toEqual({
      ...row({ slug: 'calf_raises', name: 'Calf Raises' }),
      owner: 'catalog',
      group: 'legs',
      aliases: ['Heel raise'],
      taxonomy: null,
      supervision: null,
      hasInstructions: false,
    });
  });
});

describe('a library row', () => {
  it('with an entry: catalogOptionOf with the row’s identity written over it, and no group', () => {
    const library = entry('hang_power_clean');
    const option = catalogArmOption(
      row({ slug: library.slug, name: library.name, trackingType: library.trackingType }),
      undefined,
      library,
    );
    expect('group' in option).toBe(false);
    expect(option.aliases).toEqual(catalogOptionOf(library, 'x').aliases);
    expect(option.taxonomy).not.toBeNull();
  });

  it('(a9) with no entry in the library given: listed bare, never dropped (K22)', () => {
    const option = catalogArmOption(
      row({ slug: 'cat3_not_in_this_library' }),
      undefined,
      undefined,
    );
    expect(option).toMatchObject({
      aliases: [],
      taxonomy: null,
      supervision: null,
      hasInstructions: false,
    });
    expect('group' in option).toBe(false);
  });
});
