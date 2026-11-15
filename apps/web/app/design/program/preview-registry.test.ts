import { TRACKING_TYPES } from '@mat-plan/shared';
import {
  DAY_PLAN_FIXTURES,
  familyProgram,
  FIXTURE_ITEM_KEYS,
  PROGRAM_LIST_FIXTURES,
  PROGRAM_VIEW_FIXTURES,
  WORKOUT_DRAFT_FIXTURES,
} from '@mat-plan/shared/program/fixtures';
import { describe, expect, it } from 'vitest';

import { appSources, code, WEB_DIR } from '@/test/source-scan';

import { pickerOptions } from './picker-options';
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
  it('is the prototype’s catalog: every item once, as a household item, with its type', () => {
    expect(pickerOptions).toHaveLength(FIXTURE_ITEM_KEYS.length);
    expect(new Set(pickerOptions.map((option) => option.publicId)).size).toBe(pickerOptions.length);
    expect(pickerOptions.every((option) => option.owner === 'household')).toBe(true);
    // Every tracking type is in the catalog, so the picker shows each type's label.
    expect(new Set(pickerOptions.map((option) => option.trackingType))).toEqual(
      new Set(TRACKING_TYPES),
    );
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
