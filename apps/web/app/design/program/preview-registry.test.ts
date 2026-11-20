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
  PREVIEW_PROGRAMS_HREF,
  PREVIEW_SCREENS,
  previewEntries,
  previewHref,
  PROGRAM_PREVIEW_PATH,
  programPreviewHref,
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

describe('where a program’s name goes on the day preview (FAM-1 15c, D49)', () => {
  const listed = new Set(previewEntries().map(previewHref));
  /** The program whose page a preview link opens, read back through the route's own parser. */
  const pageProgramOf = (href: string): string | undefined => {
    const selection = parsePreview(
      Object.fromEntries(new URL(href, 'http://preview').searchParams),
    );
    if (selection?.screen !== 'program') return undefined;
    const views: Record<string, { programPublicId: string }> = PROGRAM_VIEW_FIXTURES;
    return views[selection.fixture]?.programPublicId;
  };

  it('a program the preview has a page for opens its first Program page state', () => {
    expect(programPreviewHref(familyProgram.programPublicId)).toBe(
      previewHref({ screen: 'program', fixture: 'family-program', failNext: false }),
    );
  });

  it('🔴 every Program page fixture’s program opens a page of that program', () => {
    for (const [fixture, view] of Object.entries(PROGRAM_VIEW_FIXTURES)) {
      expect(pageProgramOf(programPreviewHref(view.programPublicId)), fixture).toBe(
        view.programPublicId,
      );
    }
  });

  it('a program with no page state opens the preview’s Programs list', () => {
    expect(PREVIEW_PROGRAMS_HREF).toBe(
      previewHref({ screen: 'programs-list', fixture: 'programs-list', failNext: false }),
    );
    expect(programPreviewHref('00000000-0000-4000-8000-000000000000')).toBe(PREVIEW_PROGRAMS_HREF);
  });

  it('🔴 every program a day fixture names links to a state this route lists', () => {
    const paged = new Set(Object.values(PROGRAM_VIEW_FIXTURES).map((v) => v.programPublicId));
    let withPage = 0;
    let withoutPage = 0;
    for (const [fixture, plan] of Object.entries(DAY_PLAN_FIXTURES)) {
      for (const program of plan.programs) {
        const href = programPreviewHref(program.programPublicId);
        expect(listed.has(href), `${fixture} · ${program.name}`).toBe(true);
        // A page of its own when the fixtures hold one, the list otherwise: never a guess.
        const hasPage = paged.has(program.programPublicId);
        expect(href === PREVIEW_PROGRAMS_HREF, `${fixture} · ${program.name}`).toBe(!hasPage);
        // And the page it opens is THAT program's, not just any Program page state.
        if (hasPage)
          expect(pageProgramOf(href), `${fixture} · ${program.name}`).toBe(program.programPublicId);
        if (hasPage) withPage += 1;
        else withoutPage += 1;
      }
    }
    // Both arms are real: the day fixtures name the Family program and at least one other.
    expect(withPage).toBeGreaterThan(0);
    expect(withoutPage).toBeGreaterThan(0);
  });
});

describe('the picker-options fixture', () => {
  /** In both lists, and logged the same way in both: one row each, the library's, under the item's id. */
  const SHARED = ['Goblet squat', 'Side plank', 'Jump rope', 'Easy run'];
  const library = CATALOG_FIXTURE;
  const itemNamed = (name: string) => {
    const item = FIXTURE_ITEMS.find((candidate) => candidate.name === name);
    if (!item) throw new Error(`no fixture item named ${name}`);
    return item;
  };

  it('lists the test library and the prototype’s items, each movement once', () => {
    expect(pickerOptions).toEqual([...catalogPickerOptions, ...householdPickerOptions]);
    expect(catalogPickerOptions).toHaveLength(CATALOG_FIXTURE.length);
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

  it('🔴 a library row is exactly what `catalogOptionOf` makes of its entry, plus the old group', () => {
    for (const entry of library) {
      const row = catalogPickerOptions.find((option) => option.name === entry.name);
      if (!row || row.owner !== 'catalog') throw new Error(`no library row for ${entry.slug}`);
      // `group` is the one field added here, while the picker's type still has it.
      const { group, ...rest } = row;
      expect(['push', 'pull', 'legs', 'core', 'wrestling'], entry.slug).toContain(group);
      // Exactly: a row that also carried the steps, or the slug, would fail here (spec rule 11).
      expect(rest, entry.slug).toEqual(catalogOptionOf(entry, row.publicId));
      expect(JSON.stringify(row), entry.slug).not.toContain('instructions"');
    }
    // Rows a screenshot needs: a supervised one with steps, and rows with and without steps.
    const rows = catalogPickerOptions as readonly Record<string, unknown>[];
    expect(
      rows.filter((row) => row.supervision === 'coach' && row.hasInstructions === true).length,
    ).toBeGreaterThan(0);
    expect(rows.filter((row) => row.hasInstructions === true).length).toBeGreaterThan(2);
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
    expect(inBoth.map((item) => item.name).sort()).toEqual([...SHARED].sort());
    for (const name of SHARED) {
      const item = itemNamed(name);
      const rows = pickerOptions.filter((option) => option.name === name);
      expect(rows, name).toHaveLength(1);
      expect(rows[0], name).toMatchObject({ owner: 'catalog', publicId: item.itemPublicId });
      // The pair logs the same way, or every fixture that names the item would show the wrong card.
      expect(rows[0]?.trackingType, name).toBe(item.trackingType);
    }
    // No pair logs differently: the module would have thrown on import (see `picker-options.ts`).
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
    // Reached by the fixture item's id for every shared name whose entry has steps.
    const sharedWithSteps = SHARED.filter(
      (name) => CATALOG_FIXTURE.find((entry) => entry.name === name)?.instructions !== undefined,
    );
    expect(sharedWithSteps.length).toBeGreaterThan(1);
    for (const name of sharedWithSteps) {
      expect((await previewHowTo(itemNamed(name).itemPublicId))?.name, name).toBe(name);
    }
    // Nothing for a row with no instructions, a household's item, or an id that is not listed.
    const noSteps = library.find((entry) => entry.instructions === undefined);
    const noStepsRow = catalogPickerOptions.find((option) => option.name === noSteps?.name);
    expect(await previewHowTo(noStepsRow?.publicId ?? 'missing')).toBeNull();
    expect(await previewHowTo(householdPickerOptions[0]?.publicId ?? 'missing')).toBeNull();
    expect(await previewHowTo('019826b4-0000-7000-8000-00000000ffff')).toBeNull();
    // 🔴 A library row listed under the household item's id gives nothing by the test library's own
    // id for it, though its entry has steps: the read answers for the ids it lists, and no other.
    for (const name of sharedWithSteps) {
      const entry = CATALOG_FIXTURE.find((candidate) => candidate.name === name);
      expect(
        await previewHowTo(CATALOG_FIXTURE_IDS[entry?.slug ?? ''] ?? 'missing'),
        name,
      ).toBeNull();
    }
    expect(CATALOG_FIXTURE.find((entry) => entry.name === 'Easy run')?.instructions).toBeTruthy();
    // The label comes with the steps: the supervised movement, reached by its own library id.
    const supervised = library.find((entry) => entry.supervision !== undefined);
    expect(await previewHowTo(CATALOG_FIXTURE_IDS[supervised?.slug ?? ''] ?? 'missing')).toEqual({
      name: supervised?.name,
      instructions: supervised?.instructions,
      supervision: 'coach',
    });
    expect(supervised?.instructions).toMatch(/\bcoach\b/i);
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
