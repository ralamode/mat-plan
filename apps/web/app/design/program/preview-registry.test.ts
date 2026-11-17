import { catalogOptionOf, movementNameKey, TRACKING_TYPES } from '@mat-plan/shared';
import { CATALOG_FIXTURE, CATALOG_FIXTURE_IDS } from '@mat-plan/shared/catalog/fixture';
import {
  DAY_PLAN_FIXTURES,
  familyProgram,
  FIXTURE_ITEM_KEYS,
  FIXTURE_ITEMS,
  PROGRAM_LIST_FIXTURES,
  PROGRAM_VIEW_FIXTURES,
  WORKOUT_DRAFT_FIXTURES,
} from '@mat-plan/shared/program/fixtures';
import { describe, expect, it } from 'vitest';

import { appSources, code, WEB_DIR } from '@/test/source-scan';

import {
  catalogPickerOptions,
  householdPickerOptions,
  pickerOptions,
  previewHowTo,
} from './picker-options';
import {
  parsePreview,
  PREVIEW_FAIL_NEXT,
  PREVIEW_SCREENS,
  previewEntries,
  previewHref,
  PROGRAM_PREVIEW_PATH,
} from './preview-registry';

/** A URL's search params in the shape Next hands a page. */
const paramsOf = (href: string) =>
  Object.fromEntries(new URL(href, 'http://preview.test').searchParams);

describe('the preview registry', () => {
  it('lists every named fixture of each screen’s shape, so a new fixture is on the route', () => {
    expect(PREVIEW_SCREENS['programs-list'].fixtures).toEqual(Object.keys(PROGRAM_LIST_FIXTURES));
    expect(PREVIEW_SCREENS.program.fixtures).toEqual(Object.keys(PROGRAM_VIEW_FIXTURES));
    expect(PREVIEW_SCREENS['workout-editor'].fixtures).toEqual(Object.keys(WORKOUT_DRAFT_FIXTURES));
    expect(PREVIEW_SCREENS.day.fixtures).toEqual(Object.keys(DAY_PLAN_FIXTURES));
  });

  it('has an entry per screen × fixture, plus the ✓ that fails', () => {
    const entries = previewEntries();
    const fixtures = Object.values(PREVIEW_SCREENS).flatMap((screen) => screen.fixtures);
    expect(fixtures.length).toBeGreaterThanOrEqual(19);
    expect(entries.filter((entry) => !entry.failNext)).toHaveLength(fixtures.length);
    expect(entries.filter((entry) => entry.failNext)).toEqual([
      { screen: 'day', fixture: 'today-two-programs', failNext: true },
    ]);
    expect(new Set(entries.map(previewHref)).size).toBe(entries.length);
    // A fixture's name is the link's name on the index, so no two screens may share one.
    expect(new Set(fixtures).size).toBe(fixtures.length);
  });

  it('every entry’s link parses back to that entry', () => {
    for (const entry of previewEntries()) {
      const href = previewHref(entry);
      expect(href.startsWith(`${PROGRAM_PREVIEW_PATH}?`)).toBe(true);
      expect(parsePreview(paramsOf(href))).toEqual(entry);
    }
  });

  it('spells the link the way the guides and the report give it', () => {
    expect(previewHref({ screen: 'day', fixture: 'today-two-programs', failNext: false })).toBe(
      '/design/program?screen=day&fixture=today-two-programs',
    );
    expect(previewHref({ screen: 'day', fixture: 'today-two-programs', failNext: true })).toBe(
      '/design/program?screen=day&fixture=today-two-programs&fail=next',
    );
  });

  it('shows the index for no params, an unknown name, or a fixture of another screen', () => {
    expect(parsePreview({})).toBeNull();
    expect(parsePreview({ screen: 'day' })).toBeNull();
    expect(parsePreview({ screen: 'nope', fixture: 'today-two-programs' })).toBeNull();
    expect(parsePreview({ screen: 'day', fixture: 'family-program' })).toBeNull();
    expect(parsePreview({ screen: ['day', 'program'], fixture: 'today-two-programs' })).toBeNull();
    // `toString`, `constructor`: a name looked up on an object would find these.
    expect(parsePreview({ screen: 'toString', fixture: 'toString' })).toBeNull();
    expect(parsePreview({ screen: 'day', fixture: 'constructor' })).toBeNull();
  });

  it('arms the failing fake only for fail=next', () => {
    const base = { screen: 'day', fixture: 'today-two-programs' };
    expect(parsePreview({ ...base, fail: PREVIEW_FAIL_NEXT })?.failNext).toBe(true);
    expect(parsePreview({ ...base, fail: '1' })?.failNext).toBe(false);
    expect(parsePreview(base)?.failNext).toBe(false);
  });
});

describe('the picker-options fixture', () => {
  /** In both lists and logged the same way: one row each, the library's, under the item's id. */
  const SHARED = ['Goblet squat', 'Side plank'];
  /** In both lists and logged differently: the household's item stays, the library's is left out. */
  const KEPT_AS_ITEM = ['Jump rope', 'Easy run'];
  const library = CATALOG_FIXTURE.filter((entry) => !KEPT_AS_ITEM.includes(entry.name));
  const itemNamed = (name: string) => {
    const item = FIXTURE_ITEMS.find((candidate) => candidate.name === name);
    if (!item) throw new Error(`no fixture item named ${name}`);
    return item;
  };

  it('lists the test library and the prototype’s items, each movement once', () => {
    expect(pickerOptions).toEqual([...catalogPickerOptions, ...householdPickerOptions]);
    expect(catalogPickerOptions).toHaveLength(CATALOG_FIXTURE.length - KEPT_AS_ITEM.length);
    expect(householdPickerOptions).toHaveLength(FIXTURE_ITEM_KEYS.length - SHARED.length);
    expect(new Set(pickerOptions.map((option) => option.publicId)).size).toBe(pickerOptions.length);
    // No two rows answer to one name: the real read never lists an item a library row shadows.
    const keys = pickerOptions.map((option) => movementNameKey(option.name));
    expect(new Set(keys).size).toBe(keys.length);
    // Every tracking type is listed, so the picker shows each type's label.
    expect(new Set(pickerOptions.map((option) => option.trackingType))).toEqual(
      new Set(TRACKING_TYPES),
    );
  });

  it('🔴 a library row is exactly what `catalogOptionOf` makes of its entry', () => {
    for (const entry of library) {
      const row = catalogPickerOptions.find((option) => option.name === entry.name);
      expect(row, entry.slug).toMatchObject(catalogOptionOf(entry, row?.publicId ?? ''));
      expect(row?.owner, entry.slug).toBe('catalog');
    }
    // Rows a screenshot needs: one with a supervision label, several with instructions.
    const rows = catalogPickerOptions as readonly Record<string, unknown>[];
    expect(rows.filter((row) => row.supervision === 'coach').length).toBeGreaterThan(0);
    expect(rows.filter((row) => row.hasInstructions === true).length).toBeGreaterThan(1);
    expect(rows.filter((row) => row.hasInstructions === false).length).toBeGreaterThan(1);
  });

  it('a household item is a name and a tracking type, and nothing a filter could read', () => {
    for (const option of householdPickerOptions) {
      expect(option).toEqual({
        publicId: itemNamed(option.name).itemPublicId,
        name: option.name,
        trackingType: itemNamed(option.name).trackingType,
        owner: 'household',
        unitDefault: null,
        isBodyweight: false,
      });
    }
  });

  it('🔴 a name in both lists is one row: the library’s under the item’s id, when they log alike', () => {
    const inBoth = FIXTURE_ITEMS.filter((item) =>
      CATALOG_FIXTURE.some((entry) => movementNameKey(entry.name) === movementNameKey(item.name)),
    );
    expect(inBoth.map((item) => item.name).sort()).toEqual([...SHARED, ...KEPT_AS_ITEM].sort());
    for (const name of SHARED) {
      const item = itemNamed(name);
      const rows = pickerOptions.filter((option) => option.name === name);
      expect(rows, name).toHaveLength(1);
      expect(rows[0], name).toMatchObject({ owner: 'catalog', publicId: item.itemPublicId });
      // The pair logs the same way, or every fixture that names the item would show the wrong card.
      expect(rows[0]?.trackingType, name).toBe(item.trackingType);
    }
    // A pair that logs differently: the fixtures' item is the row, as they log it.
    for (const name of KEPT_AS_ITEM) {
      const item = itemNamed(name);
      const entry = CATALOG_FIXTURE.find((candidate) => candidate.name === name);
      expect(entry?.trackingType, name).not.toBe(item.trackingType);
      expect(
        pickerOptions.filter((option) => option.name === name),
        name,
      ).toEqual([
        expect.objectContaining({
          owner: 'household',
          publicId: item.itemPublicId,
          trackingType: item.trackingType,
        }),
      ]);
    }
    // Every other library row keeps the test library's own id.
    for (const entry of library.filter((candidate) => !SHARED.includes(candidate.name))) {
      expect(pickerOptions.find((option) => option.name === entry.name)?.publicId).toBe(
        CATALOG_FIXTURE_IDS[entry.slug],
      );
    }
  });

  it('every fixture item is still listed under its own id', () => {
    for (const item of FIXTURE_ITEMS) {
      expect(pickerOptions.map((option) => option.publicId)).toContain(item.itemPublicId);
    }
  });

  it('the preview’s "How to" read gives the steps with the label, by public id (P16, K17)', async () => {
    const withSteps = library.filter((entry) => entry.instructions !== undefined);
    expect(withSteps.length).toBeGreaterThan(1);
    for (const entry of withSteps) {
      const row = catalogPickerOptions.find((option) => option.name === entry.name);
      expect(await previewHowTo(row?.publicId ?? ''), entry.slug).toEqual({
        name: entry.name,
        instructions: entry.instructions,
        supervision: entry.supervision ?? null,
      });
    }
    // Reached by the fixture item's id for a shared name.
    expect((await previewHowTo(itemNamed('Goblet squat').itemPublicId))?.name).toBe('Goblet squat');
    // Nothing for a row with no instructions, a household's item, or an id that is not listed.
    const noSteps = library.find((entry) => entry.instructions === undefined);
    const noStepsRow = catalogPickerOptions.find((option) => option.name === noSteps?.name);
    expect(await previewHowTo(noStepsRow?.publicId ?? 'missing')).toBeNull();
    expect(await previewHowTo(householdPickerOptions[0]?.publicId ?? 'missing')).toBeNull();
    expect(await previewHowTo('019826b4-0000-7000-8000-00000000ffff')).toBeNull();
    expect(await previewHowTo('')).toBeNull();
  });

  it('names the same items the other fixtures do', () => {
    const drafted = WORKOUT_DRAFT_FIXTURES['heavy-a-draft'].items;
    for (const item of drafted) {
      expect(pickerOptions).toContainEqual(
        expect.objectContaining({
          publicId: item.itemPublicId,
          name: item.itemName,
          trackingType: item.trackingType,
        }),
      );
    }
  });
});

describe('what the harness assumes', () => {
  it('every workout draft fixture is a workout of the Family program', () => {
    // `preview-harness.tsx` puts the Family program on screen behind the workout editor. A draft
    // fixture for another program needs its own program there.
    for (const draft of Object.values(WORKOUT_DRAFT_FIXTURES)) {
      expect(draft.programPublicId).toBe(familyProgram.programPublicId);
    }
  });
});

const NAMES_THE_ROUTE = /design\/program|PROGRAM_PREVIEW_PATH/;

describe('the preview route stays out of the app’s navigation', () => {
  /**
   * The route is reached by typing its path. Source outside its own directory must not name the
   * path, by its literal or by the constant, which is what a link, a redirect or a nav row would
   * do. Comments are stripped, so a docblock may still say where a screen is previewed. The
   * Playwright specs are outside the scan: a spec that visits the route is not navigation.
   */
  const outside = appSources().filter(
    (file) =>
      !file.startsWith(`${WEB_DIR}/app/design/program/`) && !file.startsWith(`${WEB_DIR}/e2e/`),
  );

  it('finds the sources (an empty glob would pass the scan below)', () => {
    expect(outside.length).toBeGreaterThan(100);
  });

  it('the matcher sees a link and a constant', () => {
    expect(NAMES_THE_ROUTE.test(`<Link href="/design/program">`)).toBe(true);
    expect(NAMES_THE_ROUTE.test('redirect(PROGRAM_PREVIEW_PATH)')).toBe(true);
    expect(NAMES_THE_ROUTE.test(`import x from '@/app/design/program/preview-registry'`)).toBe(
      true,
    );
    expect(NAMES_THE_ROUTE.test(`<Link href="/design/tokens">`)).toBe(false);
  });

  it('nothing outside app/design/program names the route', () => {
    const namers = outside.filter((file) => NAMES_THE_ROUTE.test(code(file)));
    expect(namers.map((file) => file.slice(WEB_DIR.length + 1))).toEqual([]);
  });
});
