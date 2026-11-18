import { TRACKING_TYPE, type CatalogOptionTaxonomy, type Unit } from '@mat-plan/shared';
import { CATALOG_MOVEMENTS } from '@mat-plan/shared/catalog/data';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../db', () => ({ db: { the: 'db' } }));
vi.mock('../household', () => ({ getHouseholdScope: vi.fn() }));
vi.mock('@mat-plan/db', () => ({ movementOptions: vi.fn(async () => []) }));

import { movementOptions, type MovementOption } from '@mat-plan/db';

import { newCard } from '@/components/program-builder/editor-draft';
import type { MovementOptionDTO } from '@/lib/movements/movement-option';

import { db } from '../db';
import { getHouseholdScope } from '../household';
import { getItemPickerData, pickerOptionOf } from './picker';

/**
 * The item picker's data (FAM-1 7a-ii; CAT-3 P11-i): which rows are listed, and what a listed
 * built-in is made of. The library entries are the real const's, so a test on "Sled push" is a test
 * on the entry that disagrees with its row today.
 */

const SCOPE = { householdId: 7 } as never;
/** The row's declared unit. `packages/shared` has no named map of units, so the code is typed here. */
const LB: Unit = 'lb';
const entry = (slug: string) => {
  const found = CATALOG_MOVEMENTS.find((e) => e.slug === slug);
  if (!found) throw new Error(`fixture: no library entry ${slug}`);
  return found;
};

/** An old built-in as lane P's read gives it: the database row, the picker map's group and aliases. */
const builtIn = (over: Partial<Extract<MovementOption, { owner: 'catalog' }>>) =>
  ({
    publicId: '019826b4-0000-7000-8000-00000000e001',
    owner: 'catalog',
    slug: 'sled_push',
    name: 'Sled Push',
    trackingType: TRACKING_TYPE.weight_reps,
    unitDefault: LB,
    isBodyweight: false,
    group: 'legs',
    aliases: [],
    ...over,
  }) satisfies MovementOption;
const own = {
  publicId: '019826b4-0000-7000-8000-00000000e009',
  owner: 'household',
  name: 'Garage Circuit',
  trackingType: TRACKING_TYPE.reps,
  unitDefault: null,
  isBodyweight: false,
} satisfies MovementOption;

const CATALOG_KEYS = [
  'aliases',
  'equipment',
  'group',
  'hasInstructions',
  'isBodyweight',
  'modality',
  'name',
  'owner',
  'pattern',
  'primaryMuscle',
  'publicId',
  'secondaryMuscles',
  'supervision',
  'trackingType',
  'unitDefault',
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getHouseholdScope).mockResolvedValue(SCOPE);
});

describe('which rows the picker lists (maintainer, 2026-11-17: "Show all 35 until reset")', () => {
  it('⏳ every built-in and the household’s own items, until the fresh start (CAT-3 chunk R)', async () => {
    const listed = builtIn({ slug: 'pull-up', name: 'Pull-Up', trackingType: TRACKING_TYPE.reps });
    const hidden = builtIn({ slug: 'back_squat', name: 'Back Squat' });
    vi.mocked(movementOptions).mockResolvedValueOnce([listed, hidden, own]);
    const data = await getItemPickerData();
    expect(data?.options.map((o) => o.name)).toEqual(['Pull-Up', 'Back Squat', 'Garage Circuit']);
    expect(vi.mocked(movementOptions).mock.calls).toEqual([[db, SCOPE]]);
  });

  it('no household: null, and nothing is read', async () => {
    vi.mocked(getHouseholdScope).mockResolvedValueOnce(null);
    expect(await getItemPickerData()).toBeNull();
    expect(movementOptions).not.toHaveBeenCalled();
  });
});

describe('a listed built-in: the library’s taxonomy on the database row’s identity (board, 2026-11-17)', () => {
  it('🔴 a tracking type the library disagrees with shows the ROW’s, and so does the card built from it', () => {
    const library = entry('sled_push');
    expect(library.trackingType).not.toBe(TRACKING_TYPE.weight_reps); // the disagreement is real
    const option = pickerOptionOf(builtIn({}))!;
    expect(option).toMatchObject({
      name: 'Sled Push',
      trackingType: TRACKING_TYPE.weight_reps,
      unitDefault: LB,
    });
    // What a person types into: the editor's card reads the option, so it is the row's too.
    const card = newCard(option, '019826b4-0000-7000-8000-00000000f001');
    expect(card.item.trackingType).toBe(TRACKING_TYPE.weight_reps);
    expect(card.item.itemName).toBe('Sled Push');
  });

  it('the taxonomy, supervision and instructions are the library’s', () => {
    const library = entry('sled_push');
    const option = pickerOptionOf(builtIn({}))!;
    expect(option.owner).toBe('catalog');
    if (option.owner !== 'catalog') return;
    expect(option).toMatchObject({
      modality: library.modality,
      pattern: library.pattern,
      equipment: library.equipment,
      primaryMuscle: library.primaryMuscle,
      supervision: library.supervision ?? null,
      hasInstructions: library.instructions !== undefined,
      group: 'legs',
    });
  });

  it('🔴 its aliases hold every alias the server matches, joined with the library’s, each once', () => {
    const library = entry('pallof_press');
    expect(library.aliases.length).toBeGreaterThan(0);
    const option = pickerOptionOf(
      builtIn({
        slug: 'pallof_press',
        name: 'Pallof Press',
        aliases: ['Anti-rotation press', 'Pallof'],
      }),
    )!;
    if (option.owner !== 'catalog') throw new Error('expected a catalog option');
    // The row's first, in its order; then the library's it does not already have.
    expect(library.aliases).toEqual(['Cable Pallof press', 'Anti-rotation press']);
    expect(option.aliases).toEqual(['Anti-rotation press', 'Pallof', 'Cable Pallof press']);
  });

  it('🔴 two spellings of one alias are one (the "same name" key), and the ROW’s spelling is kept', () => {
    const option = pickerOptionOf(
      builtIn({ slug: 'pallof_press', name: 'Pallof Press', aliases: ['anti rotation press'] }),
    )!;
    expect(option.owner === 'catalog' && option.aliases).toEqual([
      'anti rotation press',
      'Cable Pallof press',
    ]);
  });

  it('⏳ a built-in the library has no entry for: the row with NO taxonomy, never a placeholder one', () => {
    const option = pickerOptionOf(
      builtIn({ slug: 'back_squat', name: 'Back Squat', aliases: ['Squat'] }),
    );
    expect(option).toEqual({
      publicId: '019826b4-0000-7000-8000-00000000e001',
      owner: 'catalog',
      name: 'Back Squat',
      trackingType: TRACKING_TYPE.weight_reps,
      unitDefault: LB,
      isBodyweight: false,
      group: 'legs',
      aliases: ['Squat'],
    });
  });

  it('🔴 the slug stops at the DAL: a listed option carries exactly these keys', () => {
    expect(Object.keys(pickerOptionOf(builtIn({}))!).sort()).toEqual(CATALOG_KEYS);
    expect(Object.keys(pickerOptionOf(own)!).sort()).toEqual([
      'isBodyweight',
      'name',
      'owner',
      'publicId',
      'trackingType',
      'unitDefault',
    ]);
  });
});

/**
 * Type pins (CAT-3 P11-i; lane P's owed line on `MovementOption` and `MovementOptionDTO`): a
 * household row IS an option as it stands; a built-in is one with the library's whole taxonomy,
 * or, until the fresh start, with none of it; never with part of it.
 */
/** Equipment without the rest of the taxonomy: neither a library option nor a bare built-in. */
type HalfFilled = Omit<Extract<MovementOption, { owner: 'catalog' }>, 'slug'> & {
  equipment: CatalogOptionTaxonomy['equipment'];
};
it('the option types: a whole taxonomy or none, never half (compile-time pins)', () => {
  const own = (x: Extract<MovementOption, { owner: 'household' }>): MovementOptionDTO => x;
  const withTaxonomy = (
    x: Omit<Extract<MovementOption, { owner: 'catalog' }>, 'slug'> & CatalogOptionTaxonomy,
  ): MovementOptionDTO => x;
  // ⏳ Until the fresh start, a built-in with no library entry is an option with NO taxonomy.
  const withoutTaxonomy = (
    x: Omit<Extract<MovementOption, { owner: 'catalog' }>, 'slug'>,
  ): MovementOptionDTO => x;
  const halfFilled = (x: HalfFilled): MovementOptionDTO =>
    // Justified: a NEGATIVE type pin. The test IS that this does not compile; if it ever does, tsc fails here.
    // @ts-expect-error never a HALF-filled taxonomy
    x;
  expect(
    [own, withTaxonomy, withoutTaxonomy, halfFilled].every((f) => typeof f === 'function'),
  ).toBe(true);
});
