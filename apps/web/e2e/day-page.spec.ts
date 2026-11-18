import { expect, test, type Locator, type Page } from '@playwright/test';
import { addDays, localWeekday } from '@mat-plan/shared';
import { todayTwoPrograms } from '@mat-plan/shared/program/fixtures';

import { DAY_COPY, PROGRAM_COPY } from '../components/day/day-copy';
import { CLOSED_DAY_NOTICE, LOOK_AHEAD_DAYS } from '../lib/constants';

import { bodyweightSection, isoDaysAgo, SEED_PROFILE_2_ROUTE, SEED_PROFILE_ROUTE } from './steps';

/**
 * The day page's workouts, end to end (FAM-1 12c, the contract's first end-to-end path).
 *
 * Athlete One is on the fixture world's Family program and its Stretching program (6c-i's seed).
 * Morning habits runs Monday to Saturday and holds a Check, a Duration and a Count; Sunday is its
 * rest day, so on a Sunday the ✓ test logs yesterday (Saturday), which is writable too. Stretching
 * runs every day, so every day has a row.
 *
 * Not reachable here: a day before yesterday. The page floors at the profile's first day, and the
 * e2e seeds profiles today (`day-navigation.spec.ts` records the same gap). `dayPageFlags` (unit)
 * and the row writer's window (`db:verify`) cover it.
 */

// The names come from the contract's fixtures, never re-typed (lane P, 2026-11-17).
const morning = todayTwoPrograms.workouts.find((w) =>
  w.items.some((i) => i.trackingType === 'count'),
)!;
const ROWS = {
  check: morning.items.find((i) => i.trackingType === 'check')!.name,
  duration: morning.items.find((i) => i.trackingType === 'duration')!.name,
  count: morning.items.find((i) => i.trackingType === 'count')!.name,
};

const LOG_PREFIX = DAY_COPY.logLabel('');
const today = () => isoDaysAgo(0);
/** The look-ahead notice's first sentence ("Coming up."), from the copy rather than re-typed. */
const COMING_UP = new RegExp(`^${PROGRAM_COPY.comingUp('', today()).split('.')[0]}\\.`);
/** A writable day with Morning habits: today, or yesterday when today is Sunday. */
const logDay = () => (localWeekday(today()) === 0 ? isoDaysAgo(1) : today());
const routeFor = (day: string) =>
  day === today() ? SEED_PROFILE_ROUTE : `${SEED_PROFILE_ROUTE}?d=${day}`;

const card = (page: Page, item: string) =>
  page
    .getByRole('region', { name: morning.name })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { level: 4, name: item, exact: true }) });
const tick = (page: Page, item: string) =>
  card(page, item).getByRole('button', { name: DAY_COPY.logLabel(item) });
const ticks = (page: Page) => page.getByRole('button', { name: new RegExp(`^${LOG_PREFIX}`) });
/** Stretching (the fixture's second program) runs every day, so its workout has a row on any day. */
const daily = todayTwoPrograms.workouts.find(
  (w) => w.programPublicId === todayTwoPrograms.currentPrograms[1]!.programPublicId,
)!;
/**
 * A program row's ✓ on any day. Scoped to the workout: Bodyweight's and Life's ✓ are named
 * "Log …" too, and come first on the page until something is logged there.
 */
const anyTick = (page: Page) =>
  page
    .getByRole('region', { name: daily.name })
    .getByRole('button', { name: new RegExp(`^${LOG_PREFIX}`) })
    .first();

/** A ✓ has settled: pressed or not, and no longer saving. */
async function settled(button: Locator, pressed: boolean) {
  await expect(button).toHaveAttribute('aria-pressed', String(pressed));
  await expect(button).not.toHaveAttribute('aria-busy', 'true');
}

// Tests that write the same rows run in order, each group on its own, so one failure does not hide
// the others' results.
test.describe('Morning habits rows', () => {
  test.describe.configure({ mode: 'serial' });

  test('✓, un-tick and re-tick save on a Check, a Duration and a Count', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(routeFor(logDay()));
    for (const item of Object.values(ROWS)) {
      // Start from un-ticked, whatever a retry left.
      if ((await tick(page, item).getAttribute('aria-pressed')) === 'true') {
        await tick(page, item).click();
        await settled(tick(page, item), false);
      }
      // An empty ✓ logs the prescription (D13).
      await tick(page, item).click();
      await settled(tick(page, item), true);
      await page.reload();
      await expect(tick(page, item), `${item}: the ✓ was saved`).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      await tick(page, item).click();
      await settled(tick(page, item), false);
      await page.reload();
      await expect(tick(page, item), `${item}: the un-tick was saved`).toHaveAttribute(
        'aria-pressed',
        'false',
      );

      await tick(page, item).click();
      await settled(tick(page, item), true);
      await page.reload();
      await expect(tick(page, item), `${item}: the re-tick was saved`).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    }
  });

  test('a ✓ in flight when the parent switches athlete is logged when they come back', async ({
    page,
  }) => {
    // The switcher is the phone's (from `lg` the nav rail lists the athletes).
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(routeFor(logDay()));
    const row = tick(page, ROWS.check);
    if ((await row.getAttribute('aria-pressed')) === 'true') {
      await row.click();
      await settled(row, false);
    }
    const switcher = page.getByRole('navigation', { name: PROGRAM_COPY.switcher });
    await row.click();
    // No wait for the save: the switch is the next tap.
    await switcher.locator(`a[href="${SEED_PROFILE_2_ROUTE}"]`).click();
    await page.waitForURL((u) => u.pathname === SEED_PROFILE_2_ROUTE);
    await page.goto(routeFor(logDay()));
    await expect(tick(page, ROWS.check)).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('the daily stretch row', () => {
  test.describe.configure({ mode: 'serial' });

  test('past midnight on the device, a ✓ on the bare path pins the day it logged', async ({
    page,
  }) => {
    // The server's day is still today; the device's has moved on (`pinDayBeforeWrite`).
    await page.clock.setFixedTime(new Date(Date.now() + 24 * 60 * 60 * 1000));
    await page.goto(SEED_PROFILE_ROUTE);
    await expect(page.getByText(/^Today ·/)).toBeVisible();
    const row = anyTick(page);
    const pressed = (await row.getAttribute('aria-pressed')) === 'true';
    await row.click();
    await expect(page).toHaveURL((u) => u.searchParams.get('d') === today());
    await expect(page.getByText(/^Today ·/)).toBeVisible();
    await settled(anyTick(page), !pressed);
  });

  test('PROBE: an action’s revalidated render reads a replaceState’d ?d= (the pin depends on it)', async ({
    page,
  }) => {
    // Not a midnight run. Replace the URL by hand with another day, as the pin would, then write:
    // the render the action brings back must be the replaced URL's day, not the one loaded.
    await page.goto(SEED_PROFILE_ROUTE);
    await expect(page.getByText(/^Today ·/)).toBeVisible();
    const yesterday = isoDaysAgo(1);
    // `null`, exactly as `pinDayBeforeWrite` passes: Next's patched `replaceState` syncs its router
    // only for a call that does not carry its own `__NA` state (next/dist/client/components/app-router.js).
    await page.evaluate((d) => window.history.replaceState(null, '', `?d=${d}`), yesterday);
    await anyTick(page).click();
    await expect(page).toHaveURL((u) => u.searchParams.get('d') === yesterday);
    await expect(
      page.getByText(/^Yesterday ·/),
      'the revalidated render is the replaced ?d=; if it shows Today, the midnight pin cannot work',
    ).toBeVisible();
  });
});

test('tomorrow is look-ahead: Coming up, no ✓, no Bodyweight', async ({ page }) => {
  const tomorrow = addDays(today(), 1);
  await page.goto(SEED_PROFILE_ROUTE);
  const nav = page.getByRole('navigation', { name: 'Change day' });
  await nav.getByRole('link', { name: /^Next day/ }).click();
  await page.waitForURL((u) => u.searchParams.get('d') === tomorrow);
  await expect(page.getByText(/^Tomorrow ·/)).toBeVisible();
  await expect(page.getByText(COMING_UP)).toBeVisible();
  await expect(page.getByText(CLOSED_DAY_NOTICE)).toHaveCount(0);
  await expect(ticks(page)).toHaveCount(0);
  await expect(bodyweightSection(page)).toHaveCount(0);
});

test('more than the look-ahead ahead renders today', async ({ page }) => {
  await page.goto(`${SEED_PROFILE_ROUTE}?d=${addDays(today(), LOOK_AHEAD_DAYS + 1)}`);
  await expect(page.getByText(/^Today ·/)).toBeVisible();
  // The last day it does show is still Coming up.
  await page.goto(`${SEED_PROFILE_ROUTE}?d=${addDays(today(), LOOK_AHEAD_DAYS)}`);
  await expect(page.getByText(COMING_UP)).toBeVisible();
});
