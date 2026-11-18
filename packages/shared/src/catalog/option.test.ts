import { describe, expect, it } from 'vitest';

import { MOVEMENT_PATTERNS } from '../movements';
import { CATALOG_MOVEMENTS } from './data';
import type { CatalogMovement } from './entry';
import {
  BODY_AREAS,
  BROWSE_KINDS,
  BROWSE_OPEN_AT_MOST,
  BROWSE_FLAT_KINDS,
  browseTree,
  byFoldedName,
  MOVEMENT_FAMILIES,
  MOVEMENT_FAMILY_LABELS,
  MUSCLE_BODY_AREA,
  movementFamilyOf,
} from './families';
import { CATALOG_FIXTURE, CATALOG_FIXTURE_IDS, CATALOG_FIXTURE_OPTIONS } from './fixture';
import { catalogHowToOf, catalogHowToSchema, catalogOptionOf, type CatalogOption } from './option';
import { MODALITIES, MUSCLES } from './vocabulary';

const entryWith = (slug: string): CatalogMovement => {
  const entry = CATALOG_FIXTURE.find((candidate) => candidate.slug === slug);
  if (!entry) throw new Error(`no fixture entry ${slug}`);
  return entry;
};
const some = (test: (entry: CatalogMovement) => boolean): CatalogMovement => {
  const entry = CATALOG_FIXTURE.find(test);
  if (!entry) throw new Error('the test library has no such entry');
  return entry;
};
const optionsOf = (entries: readonly CatalogMovement[]): CatalogOption[] =>
  entries.map((entry, index) => catalogOptionOf(entry, `id-${index}`));

describe('catalogOptionOf (P11)', () => {
  it('carries each field of the entry to its field of the option, and nothing else', () => {
    for (const entry of [...CATALOG_FIXTURE, ...CATALOG_MOVEMENTS]) {
      const option = catalogOptionOf(entry, 'an-id');
      expect(option, entry.slug).toEqual({
        publicId: 'an-id',
        owner: 'catalog',
        name: entry.name,
        aliases: entry.aliases,
        trackingType: entry.trackingType,
        unitDefault: entry.unitDefault,
        isBodyweight: entry.isBodyweight,
        modality: entry.modality,
        pattern: entry.pattern,
        equipment: entry.equipment,
        primaryMuscle: entry.primaryMuscle,
        secondaryMuscles: entry.secondaryMuscles,
        supervision: entry.supervision ?? null,
        hasInstructions: entry.instructions !== undefined,
      });
      expect(Object.keys(option).sort(), entry.slug).toEqual([
        'aliases',
        'equipment',
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
      ]);
    }
  });

  it('🔴 never carries the instructions or the media pointer', () => {
    const withText = some((entry) => entry.instructions !== undefined);
    const option = catalogOptionOf(withText, 'an-id');
    expect(option.hasInstructions).toBe(true);
    expect(JSON.stringify(option)).not.toContain(withText.instructions!.split('\n')[0]);
    expect(option).not.toHaveProperty('instructions');
    expect(option).not.toHaveProperty('media');
    expect(option).not.toHaveProperty('slug');
  });

  it('says null for no supervision and false for no instructions: one shape for every row', () => {
    const plain = some((entry) => !entry.supervision && entry.instructions === undefined);
    expect(catalogOptionOf(plain, 'x')).toMatchObject({
      supervision: null,
      hasInstructions: false,
    });
    const marked = some((entry) => entry.supervision !== undefined);
    expect(catalogOptionOf(marked, 'x').supervision).toBe('coach');
  });

  it('copies the arrays: an option never aliases the library const', () => {
    const entry = some(
      (candidate) => candidate.equipment.length > 0 && candidate.aliases.length > 0,
    );
    const option = catalogOptionOf(entry, 'x');
    for (const key of ['aliases', 'equipment', 'secondaryMuscles'] as const) {
      expect(option[key]).toEqual(entry[key]);
      expect(option[key]).not.toBe(entry[key]);
    }
  });

  it('the test library’s options are its entries under their fixture ids', () => {
    expect(CATALOG_FIXTURE_OPTIONS).toEqual(
      CATALOG_FIXTURE.map((entry) => catalogOptionOf(entry, CATALOG_FIXTURE_IDS[entry.slug]!)),
    );
    const ids = CATALOG_FIXTURE_OPTIONS.map((option) => option.publicId);
    expect(new Set(ids).size).toBe(CATALOG_FIXTURE.length);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('catalogHowToOf (P16, K17)', () => {
  it('gives the steps as authored, with the name and the supervision label', () => {
    const entry = some((candidate) => candidate.instructions !== undefined);
    expect(catalogHowToOf(CATALOG_FIXTURE, entry.slug)).toEqual({
      name: entry.name,
      instructions: entry.instructions,
      supervision: entry.supervision ?? null,
    });
  });

  it('🔴 the label always comes with the text, for an entry that has both', () => {
    const both: CatalogMovement = {
      ...some((candidate) => candidate.supervision !== undefined),
      instructions: 'Have a coach watch the first sets.',
    };
    expect(catalogHowToOf([both], both.slug)).toEqual({
      name: both.name,
      instructions: 'Have a coach watch the first sets.',
      supervision: 'coach',
    });
  });

  it('is null for an entry with no instructions, an unknown slug, and a name in place of a slug', () => {
    const none = some((candidate) => candidate.instructions === undefined);
    expect(catalogHowToOf(CATALOG_FIXTURE, none.slug)).toBeNull();
    expect(catalogHowToOf(CATALOG_FIXTURE, 'no-such-movement')).toBeNull();
    expect(catalogHowToOf(CATALOG_FIXTURE, '')).toBeNull();
    expect(catalogHowToOf(CATALOG_FIXTURE, '__proto__')).toBeNull();
    const withText = some((candidate) => candidate.instructions !== undefined);
    if (withText.name !== withText.slug) {
      expect(catalogHowToOf(CATALOG_FIXTURE, withText.name)).toBeNull();
    }
  });
});

describe('the browse families (P12)', () => {
  it('every kind of training is listed once, in the accepted order', () => {
    expect([...BROWSE_KINDS].sort()).toEqual([...MODALITIES].sort());
    expect(BROWSE_KINDS).toEqual(['strength', 'mobility', 'conditioning', 'skill']);
  });

  it('🔴 the headings and the body areas are the accepted prototype’s, word for word', () => {
    expect(MOVEMENT_FAMILY_LABELS).toEqual({
      vertical_pull: 'Pull-ups and pulldowns',
      horizontal_pull: 'Rows',
      horizontal_push: 'Push-ups and presses',
      vertical_push: 'Overhead presses and dips',
      squat: 'Squats',
      hinge: 'Hinges and deadlifts',
      lunge: 'Lunges',
      jump: 'Jumps',
      carry: 'Carries and sleds',
      isolation: 'Curls, raises and single muscles',
      neck_shoulders: 'Neck and shoulders',
      chest_arms: 'Chest and arms',
      back: 'Back',
      core: 'Core',
      hips_legs: 'Hips and legs',
      whole_body: 'Whole body',
    });
    const byArea = (wanted: string) =>
      Object.entries(MUSCLE_BODY_AREA)
        .filter(([, value]) => value === wanted)
        .map(([muscle]) => muscle)
        .sort();
    expect(byArea('neck_shoulders')).toEqual(['neck', 'shoulders', 'traps']);
    expect(byArea('chest_arms')).toEqual(['biceps', 'chest', 'forearms', 'triceps']);
    expect(byArea('back')).toEqual(['lats', 'lower_back', 'upper_back']);
    expect(byArea('core')).toEqual(['abdominals', 'obliques']);
    expect(byArea('hips_legs')).toEqual([
      'abductors',
      'adductors',
      'calves',
      'glutes',
      'hamstrings',
      'hip_flexors',
      'quadriceps',
      'shins',
    ]);
    expect(byArea('whole_body')).toEqual([]);
  });

  it('every lift pattern, body area and muscle has a family with a label', () => {
    expect([...MOVEMENT_FAMILIES].sort()).toEqual(
      [...new Set([...MOVEMENT_PATTERNS, ...BODY_AREAS])].sort(),
    );
    expect(Object.keys(MOVEMENT_FAMILY_LABELS).sort()).toEqual([...MOVEMENT_FAMILIES].sort());
    expect(Object.keys(MUSCLE_BODY_AREA).sort()).toEqual([...MUSCLES].sort());
    const labels = Object.values(MOVEMENT_FAMILY_LABELS);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label).toMatch(/^[A-Z][a-z, -]+$/);
  });

  it('strength goes by its lift pattern; the other kinds by the body area of the primary muscle', () => {
    const family = (modality: string, pattern: string | null, primaryMuscle: string | null) =>
      movementFamilyOf({ modality, pattern, primaryMuscle } as Parameters<
        typeof movementFamilyOf
      >[0]);
    expect(family('strength', 'vertical_pull', 'lats')).toBe('vertical_pull');
    expect(family('strength', 'core', 'abdominals')).toBe('core');
    expect(family('mobility', null, 'hip_flexors')).toBe('hips_legs');
    expect(family('mobility', null, 'obliques')).toBe('core');
    expect(family('conditioning', null, null)).toBe('whole_body');
    // A pattern on another kind does not make it a strength family.
    expect(family('conditioning', 'carry', 'forearms')).toBe('chest_arms');
    expect(family('skill', 'jump', null)).toBe('whole_body');
    // A strength row the type allows and the library never holds: it still has a family.
    expect(family('strength', null, 'glutes')).toBe('hips_legs');
    expect(family('strength', null, null)).toBe('whole_body');
  });

  it('every entry of the library and of the test library has a family', () => {
    for (const entry of [...CATALOG_FIXTURE, ...CATALOG_MOVEMENTS]) {
      expect(MOVEMENT_FAMILY_LABELS[movementFamilyOf(entry)], entry.slug).toBeTruthy();
    }
  });
});

describe('catalogHowToSchema: what the "How to" read answers, and nothing else (P16)', () => {
  const withSteps = CATALOG_FIXTURE.find((entry) => entry.instructions !== undefined)!;
  const answer = catalogHowToOf(CATALOG_FIXTURE, withSteps.slug)!;

  it('takes what catalogHowToOf answers, unchanged', () => {
    expect(catalogHowToSchema.parse(answer)).toEqual(answer);
    expect(Object.keys(answer).sort()).toEqual(['instructions', 'name', 'supervision']);
  });

  it('🔴 is strict: a slug, an id or any other key is refused, so none can ride along', () => {
    expect(catalogHowToSchema.safeParse({ ...answer, slug: withSteps.slug }).success).toBe(false);
    expect(catalogHowToSchema.safeParse({ ...answer, publicId: 'x' }).success).toBe(false);
  });

  it('needs all three: the label is null when there is none, never absent', () => {
    const { supervision: _s, ...noLabel } = answer;
    expect(catalogHowToSchema.safeParse(noLabel).success).toBe(false);
    expect(catalogHowToSchema.safeParse({ ...answer, supervision: null }).success).toBe(true);
    expect(catalogHowToSchema.safeParse({ ...answer, instructions: '' }).success).toBe(false);
  });
});

describe('a kind with no family level (K27): Conditioning lists its movements by name', () => {
  it('🔴 gives Conditioning one family with no heading, every movement in it by name', () => {
    expect(BROWSE_FLAT_KINDS).toEqual(['conditioning']);
    for (const library of [CATALOG_FIXTURE_OPTIONS, optionsOf(CATALOG_MOVEMENTS)]) {
      const kind = browseTree(library).find((k) => k.kind === 'conditioning')!;
      const conditioning = library.filter((option) => option.modality === 'conditioning');
      expect(conditioning.length).toBeGreaterThan(0);
      expect(kind.families).toHaveLength(1);
      expect(kind.families[0]).toMatchObject({ family: null, label: null });
      expect(kind.families[0]!.options).toEqual([...conditioning].sort(byFoldedName));
      expect(kind.count).toBe(conditioning.length);
    }
  });

  it('leaves every other kind grouped by family', () => {
    for (const kind of browseTree(optionsOf(CATALOG_MOVEMENTS))) {
      if (kind.kind === 'conditioning') continue;
      expect(kind.families.every((family) => family.family !== null && family.label !== null)).toBe(
        true,
      );
    }
  });
});

describe('byFoldedName: the order a list of movements is read in (K24)', () => {
  const named = (...names: string[]) => names.map((name) => ({ name }));
  const sorted = (...names: string[]) =>
    named(...names)
      .sort(byFoldedName)
      .map((row) => row.name);

  it('orders by the folded name, so case and punctuation do not decide', () => {
    expect(sorted('push-up', 'Ab rollout', 'Zercher squat', 'bear crawl')).toEqual([
      'Ab rollout',
      'bear crawl',
      'push-up',
      'Zercher squat',
    ]);
  });

  it('orders two names that fold alike by the name as written, whatever order they came in', () => {
    const pair = ['Push-up', 'push up'];
    expect(sorted(...pair)).toEqual(sorted(...[...pair].reverse()));
    expect(byFoldedName({ name: 'Plank' }, { name: 'Plank' })).toBe(0);
  });

  it('is the order browseTree lists a family in, where a raw comparison would differ', () => {
    // Every other name in lower case: by code unit a lower-case name sorts after every capital,
    // so a tree sorted on the raw name would not be in this order.
    const mixed = CATALOG_FIXTURE_OPTIONS.map((option, i) => ({
      ...option,
      name: i % 2 === 1 ? option.name.toLowerCase() : option.name,
    }));
    const raw = (a: { name: string }, b: { name: string }) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    let differs = 0;
    for (const kind of browseTree(mixed)) {
      for (const family of kind.families) {
        expect([...family.options].sort(byFoldedName)).toEqual(family.options);
        const byRaw = [...family.options].sort(raw);
        if (byRaw.some((option, i) => option !== family.options[i])) differs += 1;
      }
    }
    // The sample must tell the two orders apart, or this test would pass for either.
    expect(differs).toBeGreaterThan(0);
  });
});

describe('browseTree (P12)', () => {
  const options = optionsOf(CATALOG_FIXTURE);
  const tree = browseTree(options);

  it('lists every movement exactly once', () => {
    const listed = tree.flatMap((kind) => kind.families.flatMap((family) => family.options));
    expect(listed).toHaveLength(options.length);
    expect(new Set(listed).size).toBe(options.length);
    for (const kind of tree) {
      expect(kind.count).toBe(kind.families.reduce((n, family) => n + family.options.length, 0));
      for (const family of kind.families) {
        // A kind with no family level has one family, with no name and no label (K27).
        if (family.family === null) {
          expect(BROWSE_FLAT_KINDS).toContain(kind.kind);
          expect(family.label).toBeNull();
          expect(kind.families).toHaveLength(1);
        } else {
          expect(BROWSE_FLAT_KINDS).not.toContain(kind.kind);
          expect(family.label).toBe(MOVEMENT_FAMILY_LABELS[family.family]);
        }
        for (const option of family.options) {
          expect(option.modality).toBe(kind.kind);
          if (family.family !== null) expect(movementFamilyOf(option)).toBe(family.family);
        }
      }
    }
  });

  it('kinds in the picker’s order; families biggest first, then by label; movements by name', () => {
    const kinds = tree.map((kind) => kind.kind);
    expect(kinds).toEqual(BROWSE_KINDS.filter((kind) => kinds.includes(kind)));
    expect(kinds.length).toBeGreaterThan(1);
    for (const kind of tree) {
      // A kind with no family level has one family and no label: '' sorts it like any single one.
      const sizes = kind.families.map(
        (family) => [-family.options.length, family.label ?? ''] as const,
      );
      expect(sizes).toEqual(
        [...sizes].sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)),
      );
      for (const family of kind.families) {
        const names = family.options.map((option) => option.name.toLowerCase());
        expect(names).toEqual([...names].sort());
      }
    }
  });

  it('is the same tree whatever order the options arrive in', () => {
    expect(browseTree([...options].reverse())).toEqual(tree);
    const shuffled = options.map((option, index) => options[(index * 7 + 3) % options.length]!);
    expect(new Set(shuffled).size).toBe(options.length);
    expect(browseTree(shuffled)).toEqual(tree);
  });

  it('🔴 leaves out a kind or a family with nothing in it', () => {
    const onlyMobility = options.filter((option) => option.modality === 'mobility');
    expect(onlyMobility.length).toBeGreaterThan(0);
    const filtered = browseTree(onlyMobility);
    expect(filtered.map((kind) => kind.kind)).toEqual(['mobility']);
    for (const family of filtered[0]!.families) expect(family.options.length).toBeGreaterThan(0);
    expect(browseTree([])).toEqual([]);
  });

  it('lists an option once, however often it is given', () => {
    expect(browseTree([...options, ...options])).toEqual(tree);
  });

  it('a tie between two families goes by label, and a tie between two names is still ordered', () => {
    const base = options[0]!;
    const make = (name: string, pattern: CatalogOption['pattern']): CatalogOption => ({
      ...base,
      name,
      modality: 'strength',
      pattern,
    });
    const tied = browseTree([
      make('B', 'squat'),
      make('a', 'hinge'),
      make('A', 'hinge'),
      make('b', 'squat'),
    ]);
    expect(tied[0]!.families.map((family) => family.label)).toEqual([
      'Hinges and deadlifts',
      'Squats',
    ]);
    expect(tied[0]!.families[0]!.options.map((option) => option.name)).toEqual(['A', 'a']);
    expect(tied[0]!.families[1]!.options.map((option) => option.name)).toEqual(['B', 'b']);
  });

  it('opens every group when a filter leaves twenty or fewer', () => {
    expect(BROWSE_OPEN_AT_MOST).toBe(20);
  });
});
