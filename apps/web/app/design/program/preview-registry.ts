import {
  DAY_PLAN_FIXTURES,
  PROGRAM_LIST_FIXTURES,
  PROGRAM_VIEW_FIXTURES,
  WORKOUT_DRAFT_FIXTURES,
} from '@mat-plan/shared/program/fixtures';

/**
 * What the program preview route can show: every screen, with every named fixture of the shape that
 * screen takes (FAM-1 plan §4, §8).
 *
 * **One list, three readers.** The route's index links to each entry, the route's parser accepts
 * exactly these, and `e2e/program-preview-a11y.spec.ts` scans each one. So a lane that adds a state
 * adds a fixture to the contract and edits nothing here, and a screen can never be on the route
 * without being in the scan.
 *
 * Data only, with relative and workspace imports only: the Playwright spec imports this module, and
 * it must not pull a component in with it.
 */

export const PROGRAM_PREVIEW_PATH = '/design/program';

/** The route's search params. `fail=next` arms the fake's switch: the next write answers `retry`. */
export const PREVIEW_PARAM = { screen: 'screen', fixture: 'fixture', fail: 'fail' } as const;
export const PREVIEW_FAIL_NEXT = 'next';

/** Each screen: its name on the index, the lane that fills it in, and its fixtures by name. */
export const PREVIEW_SCREENS = {
  'programs-list': {
    title: 'Programs list',
    lane: 'B',
    fixtures: Object.keys(PROGRAM_LIST_FIXTURES),
  },
  program: {
    title: 'Program page',
    lane: 'B',
    fixtures: Object.keys(PROGRAM_VIEW_FIXTURES),
  },
  'workout-editor': {
    title: 'Workout editor',
    lane: 'B',
    fixtures: Object.keys(WORKOUT_DRAFT_FIXTURES),
  },
  day: {
    title: 'Day page',
    lane: 'C',
    fixtures: Object.keys(DAY_PLAN_FIXTURES),
  },
} as const satisfies Record<string, { title: string; lane: string; fixtures: readonly string[] }>;

export type PreviewScreen = keyof typeof PREVIEW_SCREENS;
export const PREVIEW_SCREEN_NAMES = Object.keys(PREVIEW_SCREENS) as PreviewScreen[];

/** One thing the route mounts. */
export type PreviewSelection = { screen: PreviewScreen; fixture: string; failNext: boolean };

/**
 * The states that need the failing fake, beyond each screen × fixture: plan §8's "A ✓ that fails"
 * is `today-two-programs` with the next write failing.
 */
const FAILING: readonly PreviewSelection[] = [
  { screen: 'day', fixture: 'today-two-programs', failNext: true },
];

export function previewHref({ screen, fixture, failNext }: PreviewSelection): string {
  const params = new URLSearchParams({
    [PREVIEW_PARAM.screen]: screen,
    [PREVIEW_PARAM.fixture]: fixture,
  });
  if (failNext) params.set(PREVIEW_PARAM.fail, PREVIEW_FAIL_NEXT);
  return `${PROGRAM_PREVIEW_PATH}?${params}`;
}

/** Every state on the route, in the index's order: each screen's fixtures, then its failing ones. */
export function previewEntries(): PreviewSelection[] {
  return PREVIEW_SCREEN_NAMES.flatMap((screen) => [
    ...PREVIEW_SCREENS[screen].fixtures.map((fixture) => ({ screen, fixture, failNext: false })),
    ...FAILING.filter((entry) => entry.screen === screen),
  ]);
}

/** A short name for one state: `day · today-two-programs · the next write fails`. */
export function previewLabel({ screen, fixture, failNext }: PreviewSelection): string {
  return `${screen} · ${fixture}${failNext ? ' · the next write fails' : ''}`;
}

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The selection the search params name, or `null` for the index. An unknown screen or fixture is
 * `null` too: the route then lists what exists instead of rendering a screen with no data.
 */
export function parsePreview(searchParams: SearchParams): PreviewSelection | null {
  const one = (key: string) => {
    const value = searchParams[key];
    return typeof value === 'string' ? value : undefined;
  };
  const screen = PREVIEW_SCREEN_NAMES.find((name) => name === one(PREVIEW_PARAM.screen));
  const fixture = one(PREVIEW_PARAM.fixture);
  if (!screen || !fixture) return null;
  if (!(PREVIEW_SCREENS[screen].fixtures as readonly string[]).includes(fixture)) return null;
  return { screen, fixture, failNext: one(PREVIEW_PARAM.fail) === PREVIEW_FAIL_NEXT };
}
