import {
  catalogHowToOf,
  catalogOptionOf,
  MOVEMENT_SEED_ROWS,
  pickerEntryOf,
  TRACKING_TYPE,
  type CatalogOptionTaxonomy,
  type Unit,
} from '@mat-plan/shared';
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
import { getHowTo, getItemPickerData, pickerOptionOf } from './picker';

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

/** The library's taxonomy of one entry, as the read attaches it (`catalogArmOption`, P11-ii-a). */
const taxonomyOf = (slug: string) => {
  const e = entry(slug);
  return {
    modality: e.modality,
    pattern: e.pattern,
    equipment: [...e.equipment],
    primaryMuscle: e.primaryMuscle,
    secondaryMuscles: [...e.secondaryMuscles],
  };
};

/**
 * An old built-in as lane P's read gives it since P11-ii-a: the database row's identity, the picker
 * map's group and the joined aliases, and the library's taxonomy by slug (`catalogArmOption` builds
 * it; its own test covers the mapping). This file tests only that the DAL copies it.
 */
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
    taxonomy: taxonomyOf('sled_push'),
    supervision: entry('sled_push').supervision ?? null,
    hasInstructions: entry('sled_push').instructions !== undefined,
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
    expect(vi.mocked(movementOptions).mock.calls).toEqual([[db, SCOPE, CATALOG_MOVEMENTS]]);
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

  it('the taxonomy, supervision and instructions are copied from the read, field by field', () => {
    // A supervised row, so a DAL that dropped the label fails here.
    const row = builtIn({ supervision: 'coach', hasInstructions: true });
    const option = pickerOptionOf(row)!;
    expect(option.owner).toBe('catalog');
    if (row.taxonomy === null) throw new Error('fixture: the row has no taxonomy');
    expect(option).toMatchObject({
      ...row.taxonomy,
      supervision: row.supervision,
      hasInstructions: row.hasInstructions,
      group: 'legs',
    });
  });

  it('the aliases are the read’s (the join is `catalogArmOption`’s, so `newItem` sees the same ones)', () => {
    const option = pickerOptionOf(
      builtIn({ aliases: ['Anti-rotation press', 'Cable Pallof press'] }),
    )!;
    expect(option.owner === 'catalog' && option.aliases).toEqual([
      'Anti-rotation press',
      'Cable Pallof press',
    ]);
  });

  it('⏳ a row with no library entry (taxonomy null): NO taxonomy, never a placeholder one', () => {
    const option = pickerOptionOf(
      builtIn({
        slug: 'calf_raises',
        name: 'Calf Raises',
        aliases: ['Heel raise'],
        taxonomy: null,
        supervision: null,
        hasInstructions: false,
      }),
    );
    expect(option).toEqual({
      publicId: '019826b4-0000-7000-8000-00000000e001',
      owner: 'catalog',
      name: 'Calf Raises',
      trackingType: TRACKING_TYPE.weight_reps,
      unitDefault: LB,
      isBodyweight: false,
      group: 'legs',
      aliases: ['Heel raise'],
    });
  });

  it('a library row with no legacy group carries no `group` key', () => {
    const { group: _drop, ...row } = builtIn({ slug: 'hang_power_clean' });
    void _drop;
    expect('group' in pickerOptionOf(row)!).toBe(false);
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
type CatalogDTOBase = Omit<
  Extract<MovementOption, { owner: 'catalog' }>,
  'slug' | 'taxonomy' | 'supervision' | 'hasInstructions'
>;
type HalfFilled = CatalogDTOBase & {
  equipment: CatalogOptionTaxonomy['equipment'];
};
it('the option types: a whole taxonomy or none, never half (compile-time pins)', () => {
  const own = (x: Extract<MovementOption, { owner: 'household' }>): MovementOptionDTO => x;
  const withTaxonomy = (x: CatalogDTOBase & CatalogOptionTaxonomy): MovementOptionDTO => x;
  // ⏳ Until the fresh start, a built-in with no library entry is an option with NO taxonomy.
  const withoutTaxonomy = (x: CatalogDTOBase): MovementOptionDTO => x;
  const halfFilled = (x: HalfFilled): MovementOptionDTO =>
    // Justified: a NEGATIVE type pin. The test IS that this does not compile; if it ever does, tsc fails here.
    // @ts-expect-error never a HALF-filled taxonomy
    x;
  expect(
    [own, withTaxonomy, withoutTaxonomy, halfFilled].every((f) => typeof f === 'function'),
  ).toBe(true);
});

describe('getHowTo: one option’s steps, resolved among the caller’s own options (FAM-1 7b)', () => {
  const WITH_STEPS = CATALOG_MOVEMENTS.find((e) => e.instructions !== undefined)!;
  const ID = '019826b4-0000-7000-8000-00000000e001';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getHouseholdScope).mockResolvedValue(SCOPE);
  });

  it('a library row with steps: its name, steps and label, nothing else (the strict schema)', async () => {
    vi.mocked(movementOptions).mockResolvedValueOnce([builtIn({ slug: WITH_STEPS.slug })]);
    const howTo = await getHowTo(ID);
    expect(howTo).toEqual(catalogHowToOf(CATALOG_MOVEMENTS, WITH_STEPS.slug));
    expect(Object.keys(howTo!).sort()).toEqual(['instructions', 'name', 'supervision']);
  });

  it('an id in capitals is the same option (ids compare lower-case)', async () => {
    vi.mocked(movementOptions).mockResolvedValueOnce([builtIn({ slug: WITH_STEPS.slug })]);
    expect(await getHowTo(ID.toUpperCase())).not.toBeNull();
  });

  it('🔴 a household item is null, even one whose stored slug is a library slug', async () => {
    vi.mocked(movementOptions).mockResolvedValueOnce([
      { ...own, publicId: ID, slug: WITH_STEPS.slug } as never,
    ]);
    expect(await getHowTo(ID)).toBeNull();
  });

  it('a built-in with no library entry (K22) is null', async () => {
    vi.mocked(movementOptions).mockResolvedValueOnce([
      builtIn({ slug: 'no_such_entry', taxonomy: null, supervision: null, hasInstructions: false }),
    ]);
    expect(await getHowTo(ID)).toBeNull();
  });

  it('🔴 an id that is not among the caller’s options is null: another household’s id looks unknown', async () => {
    vi.mocked(movementOptions).mockResolvedValueOnce([builtIn({ slug: WITH_STEPS.slug })]);
    expect(await getHowTo('019826b4-0000-7000-8000-0000000000ff')).toBeNull();
  });

  it('a non-uuid id is null before any query; no household is null', async () => {
    expect(await getHowTo('not-a-uuid')).toBeNull();
    expect(movementOptions).not.toHaveBeenCalled();
    vi.mocked(getHouseholdScope).mockResolvedValueOnce(null);
    expect(await getHowTo(ID)).toBeNull();
  });

  it('the option list still carries no instructions (rule 11, P16)', async () => {
    vi.mocked(movementOptions).mockResolvedValueOnce([builtIn({ slug: WITH_STEPS.slug })]);
    const data = await getItemPickerData();
    expect(data!.options.every((o) => !('instructions' in o))).toBe(true);
  });
});

/**
 * CAT-3 P11-ii-b (b5): the size of what the picker is handed, measured over the real library plus the
 * 35 old built-ins (the read's shape, built here from `catalogOptionOf`), and at 500 options. JSON
 * length stands in for the RSC payload; household item names are free text, so this is never measured
 * on production. The figures go in the PR body; the ceilings are what a regression would cross.
 */
describe('(b5) the picker payload, measured', () => {
  const asRead = (index: number, e: (typeof CATALOG_MOVEMENTS)[number]) => {
    const o = catalogOptionOf(e, `019826b4-0000-7000-8000-${String(index).padStart(12, '0')}`);
    return {
      publicId: o.publicId,
      owner: 'catalog' as const,
      slug: e.slug,
      name: o.name,
      trackingType: o.trackingType,
      unitDefault: o.unitDefault,
      isBodyweight: o.isBodyweight,
      aliases: o.aliases,
      taxonomy: {
        modality: o.modality,
        pattern: o.pattern,
        equipment: o.equipment,
        primaryMuscle: o.primaryMuscle,
        secondaryMuscles: o.secondaryMuscles,
      },
      supervision: o.supervision,
      hasInstructions: o.hasInstructions,
    } satisfies MovementOption;
  };
  // An old built-in as the read gives it: the row's identity, and where the library has its slug
  // (12 of them), the library's aliases, taxonomy and flags too. Those 12 are ONE row each, so the
  // library entries on old slugs are not listed again below.
  const oldSlugs = new Set<string>(MOVEMENT_SEED_ROWS.map((r) => r.slug));
  const oldRows = MOVEMENT_SEED_ROWS.map((r) => {
    const e = CATALOG_MOVEMENTS.find((x) => x.slug === r.slug);
    const lib = e && asRead(0, e);
    return {
      publicId: r.publicId,
      owner: 'catalog',
      slug: r.slug,
      name: r.name,
      trackingType: r.trackingType,
      unitDefault: r.unitDefault,
      isBodyweight: r.isBodyweight,
      group: pickerEntryOf(r.slug)!.group,
      aliases: [...(pickerEntryOf(r.slug)?.aliases ?? []), ...(lib?.aliases ?? [])],
      taxonomy: lib?.taxonomy ?? null,
      supervision: lib?.supervision ?? null,
      hasInstructions: lib?.hasInstructions ?? false,
    } satisfies MovementOption;
  });
  const bytesOf = async (options: MovementOption[]) => {
    vi.mocked(movementOptions).mockResolvedValueOnce(options);
    return Buffer.byteLength(JSON.stringify(await getItemPickerData()), 'utf8');
  };

  it('the real library plus the 35 old built-ins, and 500 options', async () => {
    const library = CATALOG_MOVEMENTS.filter((e) => !oldSlugs.has(e.slug));
    const real = [...library.map((e, i) => asRead(i, e)), ...oldRows];
    const five = Array.from({ length: 500 }, (_, i) =>
      asRead(i, CATALOG_MOVEMENTS[i % CATALOG_MOVEMENTS.length]!),
    );
    // Measured 2026-11-20: 610 options, 208,104 bytes; 500 options, 173,463 (about 347 each). The
    // ceilings leave about 15%: carrying each option's steps (rule 11, P16) would cross them many times.
    // The 12 library slugs that are also old built-in slugs (back_squat … walking_lunge) list once.
    expect(CATALOG_MOVEMENTS.length - library.length).toBe(12);
    expect(real.length).toBe(library.length + MOVEMENT_SEED_ROWS.length);
    expect(await bytesOf(real), 'the real library and the old built-ins').toBeLessThan(240_000);
    expect(await bytesOf(five), '500 library options').toBeLessThan(200_000);
  });
});
