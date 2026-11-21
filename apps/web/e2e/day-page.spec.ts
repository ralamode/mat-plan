import { expect, test, type Locator, type Page } from '@playwright/test';
import { addDays, DEFAULT_BODYWEIGHT_UNIT, localWeekday, PROFILE_KIND } from '@mat-plan/shared';
import { familyProgram, todayTwoPrograms } from '@mat-plan/shared/program/fixtures';

import { DAY_COPY, PROGRAM_COPY } from '../components/day/day-copy';
import {
  AMEND_COPY,
  athleteRoutinePath,
  BODYWEIGHT_COPY,
  CLOSED_DAY_NOTICE,
  LIFE_COPY,
  LOOK_AHEAD_DAYS,
  MIN_TAP_TARGET_PX,
  ROUTINE_COPY,
} from '../lib/constants';
import { LIFE_ACTIVITIES } from '../lib/life/life-activities';

import { expectNoAxeViolations, expectNoOverflowWithin, expectTapTargets } from './a11y-checks';
import { expectNoHorizontalOverflow, NARROW_VIEWPORT } from './contexts';

import {
  addAthlete,
  archiveAdded,
  bodyweightSection,
  changeWeight,
  copyOntoEveryWeekday,
  createProgram,
  escapeRegExp,
  isoDaysAgo,
  lifeSection,
  logBodyweight,
  loggedWeight,
  logPractice,
  openCollapsed,
  openPrograms,
  PRACTICE_SHOWN,
  programRowTick,
  putOnFromToday,
  SEED_PROFILE_2_ROUTE,
  SEED_PROFILE_ROUTE,
  settled,
  shownWeight,
} from './steps';

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

const tick = (page: Page, item: string) => programRowTick(page, morning.name, item);
const ticks = (page: Page) => page.getByRole('button', { name: new RegExp(`^${LOG_PREFIX}`) });
/** Stretching (the fixture's second program) runs every day, so its workout has a row on any day. */
const stretching = todayTwoPrograms.currentPrograms[1]!;
const daily = todayTwoPrograms.workouts.find(
  (w) => w.programPublicId === stretching.programPublicId,
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
  // The tab's title is the day, which Next's route announcer reads; never the athlete's name (D8).
  await expect(page).toHaveTitle(/^Tomorrow · \w{3}, \w{3} \d{1,2}$/);
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

// ── Change (FAM-1 12d) ─────────────────────────────────────────────────────────────────────────
//
// On Athlete Two, whose program rows no other spec writes. The workout is found by its superset
// list ("Superset A"), not by name: the page shows the movement names ("Inverted Rows", the old
// built-in), not the fixture's, and the superset workout (Heavy A or Heavy B) runs Monday, Wednesday, Friday and
// Saturday, so today or yesterday always has one.

/** The superset itself: its own list, named "Superset A" (`workout-card.tsx`), holding its two items. */
const supersetWorkout = (page: Page) =>
  page.getByRole('list', { name: DAY_COPY.superset('A'), exact: true }).first();

/** Today, or yesterday when today has no superset workout. */
async function openSupersetDay(page: Page): Promise<void> {
  await page.goto(SEED_PROFILE_2_ROUTE);
  await expect(page.getByText(/^Today ·/)).toBeVisible();
  if ((await supersetWorkout(page).count()) === 0) {
    await page.goto(`${SEED_PROFILE_2_ROUTE}?d=${isoDaysAgo(1)}`);
    await expect(page.getByText(/^Yesterday ·/)).toBeVisible();
  }
  await expect(supersetWorkout(page)).toBeVisible();
}

/** The superset's two items, by their headings ("A1 Push press" → "Push press"). */
async function supersetItems(page: Page): Promise<[string, string]> {
  const headings = await supersetWorkout(page).getByRole('heading', { level: 4 }).allTextContents();
  const names = headings.map((h) => h.replace(/^[A-Z]+\d+\s*/, '').trim());
  return [names[0]!, names[1]!];
}

/** Set 1 of an item: its ✓, and its number field (the load, or reps). */
const setOne = (item: string) => DAY_COPY.setLabel(item, 1);
const setTick = (page: Page, item: string) =>
  page.getByRole('button', { name: DAY_COPY.logLabel(setOne(item)), exact: true });
const loadField = (page: Page, item: string) =>
  page.getByRole('textbox', { name: new RegExp(`^${escapeRegExp(setOne(item))}, in (?!reps$)`) });
const repsField = (page: Page, item: string) =>
  page.getByRole('textbox', { name: `${setOne(item)}, in reps`, exact: true });

/** Focus leaves the row: a Change is sent when focus leaves the row from one of its fields. */
const leaveRow = (page: Page) => page.getByRole('heading', { level: 1 }).click();

/** Set 1 logged, whatever a retry left. */
async function ensureLogged(page: Page, item: string): Promise<void> {
  const button = setTick(page, item);
  if ((await button.getAttribute('aria-pressed')) !== 'true') {
    await button.click();
    await settled(button, true);
  }
}

test.describe('Change on real data', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ viewport: NARROW_VIEWPORT });

  test('a weight × reps set and its superset partner change, Undo puts it back, and a reload keeps it', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await openSupersetDay(page);
    const [loaded, partner] = await supersetItems(page);

    // The load: change it, Undo, change it again, then reload.
    await ensureLogged(page, loaded);
    const was = await loadField(page, loaded).inputValue();
    const next = String(Number(was) + 5);
    await loadField(page, loaded).fill(next);
    // Typed over: "Not saved. Was …" until focus leaves the row.
    await expect(supersetWorkout(page).getByText(/^Not saved\. Was /)).toBeVisible();
    await expectNoAxeViolations(page, 'Change, typed over, 360px');
    await expectTapTargets(page, 'Change, typed over, 360px');
    await expectNoHorizontalOverflow(page, 'Change, typed over');

    await leaveRow(page);
    await expect(supersetWorkout(page).getByText(/^Changed .* → /)).toBeVisible();
    await expectNoAxeViolations(page, 'Change, changed with Undo, 360px');
    await expectTapTargets(page, 'Change, changed with Undo, 360px');
    await expectNoHorizontalOverflow(page, 'Change, changed with Undo');

    // Undo's baseline lasts one page visit, so it is checked before any reload.
    await supersetWorkout(page).getByRole('button', { name: DAY_COPY.change.undo }).first().click();
    await expect(loadField(page, loaded)).toHaveValue(was);
    await expect(supersetWorkout(page).getByText(/^Changed back to /)).toBeVisible();

    await loadField(page, loaded).fill(next);
    await leaveRow(page);
    await expect(supersetWorkout(page).getByText(/^Changed .* → /)).toBeVisible();
    await page.reload();
    await expect(loadField(page, loaded), `${loaded}: the Change was saved`).toHaveValue(next);

    // The superset partner's reps, the same way.
    await ensureLogged(page, partner);
    const reps = await repsField(page, partner).inputValue();
    const moreReps = String(Number(reps) + 1);
    await repsField(page, partner).fill(moreReps);
    await leaveRow(page);
    await expect(supersetWorkout(page).getByText(/^Changed .* → /)).toBeVisible();
    await page.reload();
    await expect(repsField(page, partner), `${partner}: the Change was saved`).toHaveValue(
      moreReps,
    );
  });

  test('a blank keeps the old number and says so (plan §8)', async ({ page }) => {
    await openSupersetDay(page);
    const [, partner] = await supersetItems(page);
    await ensureLogged(page, partner);
    const reps = await repsField(page, partner).inputValue();
    await repsField(page, partner).fill('');
    await leaveRow(page);
    await expect(
      supersetWorkout(page).getByText(/^Kept .*: enter a number to change it\.$/),
    ).toBeVisible();
    await expect(repsField(page, partner)).toHaveValue(reps);
    await expectNoAxeViolations(page, 'Change, kept, 360px');
    await expectTapTargets(page, 'Change, kept, 360px');
    await expectNoHorizontalOverflow(page, 'Change, kept');
    // What was stored, not only what the field shows: nothing was sent.
    await page.reload();
    await expect(repsField(page, partner), `${partner}: a blank changed nothing`).toHaveValue(reps);
  });
});

// ── Program order (FAM-1 15c) ────────────────────────────────────────────────────────────────────
//
// 🔴 **On this run's own athlete and programs, never a seeded athlete or a fixture program**, so a
// reorder never changes the order another spec reads (`fullyParallel`, one shared database). The
// names carry the run's stamp, so a retry builds its own world rather than finding the last one's
// (nothing can be deleted). Each program holds one fixture workout copied onto every day of the
// week, so the run passes whatever day it is. Spends one of the household's athlete slots a run, as
// the builder's own journey does (`program-builder.spec.ts`).

/** The workout headings in the order the day page lists them. */
const workoutHeadings = (page: Page) =>
  page
    .getByRole('region', { name: DAY_COPY.heading, exact: true })
    .getByRole('heading', { level: 3 });
/**
 * The programs line ("Programs:" then "A ›", "B ›"), whose names are links to their program pages
 * (D49): the label's container, which holds the list of links.
 */
const programsLine = (page: Page) =>
  page.getByText(PROGRAM_COPY.lineLabel(2), { exact: true }).locator('..');

test.describe('Program order on real data', () => {
  test.use({ viewport: NARROW_VIEWPORT });

  /** This run's athlete, archived after the test so the picker does not fill with them. */
  const added: string[] = [];
  test.afterEach(async ({ page }) => {
    test.setTimeout(60_000);
    await archiveAdded(page, added.splice(0));
  });

  test('an athlete on two programs moves one down, and the day page follows, after a reload too', async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    const stamp = `${Date.now().toString(36)}${info.workerIndex}`;
    const athlete = `E2E order athlete ${stamp}`;
    const programs = [
      { name: `E2E order one ${stamp}`, from: familyProgram.name, workout: morning.name, path: '' },
      { name: `E2E order two ${stamp}`, from: stretching.name, workout: daily.name, path: '' },
    ];

    // 1. Two programs, each with a fixture workout on all seven weekdays.
    for (const program of programs) {
      await openPrograms(page);
      await createProgram(page, program.name);
      program.path = new URL(page.url()).pathname;
      await copyOntoEveryWeekday(page, {
        from: program.from,
        workout: program.workout,
        to: program.name,
      });
    }

    // 2. A new athlete, put on both from today.
    await addAthlete(page, athlete, PROFILE_KIND.kid, added);
    await expect(page.getByRole('heading', { name: athlete, level: 1 })).toBeVisible();
    const dayPage = page.url();
    for (const program of programs) {
      await page.goto(program.path);
      await putOnFromToday(page, program.name, athlete);
    }

    // 3. Program order, from their day page, holds the a11y bar at 360px.
    await page.goto(dayPage);
    await page.getByRole('button', { name: PROGRAM_COPY.order, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: PROGRAM_COPY.orderTitle(athlete) });
    await expect(dialog).toBeVisible();
    await expectNoAxeViolations(page, 'Program order, 360px');
    await expectTapTargets(page, 'Program order, 360px');
    await expectNoOverflowWithin(dialog, 'Program order dialog');

    // The starting order is the dialog's, never assumed: Put on places a program where it sits in
    // the Programs list, which this spec does not control.
    const listed = await dialog.getByRole('listitem').allTextContents();
    const [first, second] = listed.map((text) => programs.find((p) => text.includes(p.name)));
    expect(first && second && first !== second, `two programs listed, got ${listed}`).toBe(true);
    const moved = [second!, first!];

    // 4. ↓ on the first. Focus stays on the arrow, and the move is announced once it has saved.
    const down = dialog.getByRole('button', {
      name: PROGRAM_COPY.moveDown(first!.name),
      exact: true,
    });
    await down.click();
    await expect(
      dialog.getByRole('status').filter({ hasText: PROGRAM_COPY.moved(first!.name, 2, 2) }),
    ).toHaveCount(1);
    await expect(down).toBeFocused();
    await expect(dialog.getByRole('listitem')).toHaveText(
      moved.map((p) => new RegExp(escapeRegExp(p.name))),
    );
    await dialog.getByRole('button', { name: PROGRAM_COPY.done, exact: true }).click();
    await expect(dialog).toBeHidden();

    // 5. The programs line and the workouts follow, before a reload and after one. Each name on the
    //    line links to its program's page; the journey reads the links and does not follow them.
    const expectOrder = async (when: string) => {
      const links = programsLine(page).getByRole('link');
      // By accessible name: each link's text ends in an aria-hidden " ›" (15c PR 1), which the
      // name leaves out and `toHaveText` would not.
      await expect(links, `${when}: the programs line`).toHaveCount(moved.length);
      for (const [index, program] of moved.entries()) {
        await expect(links.nth(index), `${when}: link ${index + 1}`).toHaveAccessibleName(
          program.name,
        );
        await expect(links.nth(index)).toHaveAttribute('href', program.path);
      }
      await expect(workoutHeadings(page), `${when}: the workouts`).toHaveText(
        moved.map((p) => p.workout),
      );
    };
    await expectOrder('after the move');
    // At 360px nothing on the line runs past the screen. Only the ordinary wrap: this run's names
    // are short, so the long-unbroken-name case is the unit tests' (`wrap-anywhere`, `min-w-11`).
    await expectNoOverflowWithin(programsLine(page), 'the programs line');
    await expectTapTargets(page, 'the day page with its programs line, 360px');
    // The links themselves: `expectTapTargets` leaves links out, so each name is measured here.
    for (const link of await programsLine(page).getByRole('link').all()) {
      const box = await link.boundingBox();
      expect(box?.height ?? 0, 'a program link is 44px tall').toBeGreaterThanOrEqual(
        MIN_TAP_TARGET_PX,
      );
      expect(box?.width ?? 0, 'a program link is 44px wide').toBeGreaterThanOrEqual(
        MIN_TAP_TARGET_PX,
      );
    }
    await page.reload();
    await expectOrder('after a reload');
  });
});

// ── A finished workout folds to one line (FAM-1 12c-iii) ─────────────────────────────────────────
//
// On this run's own athlete and program, as Program order's journey is: finishing a workout changes
// what every later visit to that day shows, so it never touches a seeded athlete.

test.describe('A finished workout on real data', () => {
  test.use({ viewport: NARROW_VIEWPORT });

  const added: string[] = [];
  test.afterEach(async ({ page }) => {
    test.setTimeout(60_000);
    await archiveAdded(page, added.splice(0));
  });

  test('finished during a visit it stays open; coming back it is one line; it opens and folds, at 360px', async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    const stamp = `${Date.now().toString(36)}${info.workerIndex}`;
    const athlete = `E2E fold athlete ${stamp}`;
    const program = `E2E fold ${stamp}`;

    // 1. A program with the daily stretch on every weekday; a new athlete on it from today.
    await openPrograms(page);
    await createProgram(page, program);
    const programPage = new URL(page.url()).pathname;
    await copyOntoEveryWeekday(page, { from: stretching.name, workout: daily.name, to: program });
    await addAthlete(page, athlete, PROFILE_KIND.kid, added);
    // The add has landed on their day page before its URL is read, or Put on finds no such athlete.
    await expect(page.getByRole('heading', { name: athlete, level: 1 })).toBeVisible();
    const dayPage = page.url();
    await page.goto(programPage);
    await putOnFromToday(page, program, athlete);
    await page.goto(dayPage);

    // 2. Every row ticked during this visit: the workout stays open, now offering Collapse.
    const region = page.getByRole('region', { name: daily.name, exact: true });
    const collapse = region.getByRole('button', { name: DAY_COPY.collapseLabel(daily.name) });
    // The first ✓ not yet pressed, each time: the query's matches shrink as rows are ticked.
    // `count()` does not wait: the day page may still be streaming in behind its skeleton.
    await expect(region).toBeVisible();
    const open = region.getByRole('button', { pressed: false });
    await expect(open.first()).toBeVisible();
    const rows = await open.count();
    expect(rows, 'the daily stretch has rows to tick').toBeGreaterThan(0);
    for (let left = rows; left > 0; left--) {
      await open.first().click();
      await expect(open).toHaveCount(left - 1);
    }
    await expect(collapse).toBeVisible();
    await expect(region.getByRole('heading').getByRole('button', { expanded: false })).toHaveCount(
      0,
    );

    // 3. Coming back (a reload): one line, the region still named for the workout, at 360px.
    await page.reload();
    const line = region.getByRole('heading').getByRole('button', { expanded: false });
    // Named "name, label, count" in a real browser too; and the folded body's ✓s are not reachable.
    // The slot's label (if the copy has one) sits between; the parts are joined by ", " exactly.
    await expect(line).toHaveAccessibleName(
      new RegExp(
        `^${escapeRegExp(daily.name)}(, [^,]+)?, ${escapeRegExp(DAY_COPY.progress(rows, rows))}$`,
      ),
    );
    await expect(region.getByRole('button', { pressed: true })).toHaveCount(0);
    await openCollapsed(region, daily.name);
    await expectNoAxeViolations(page, 'a finished workout, opened, 360px');
    await expectTapTargets(page, 'a finished workout, opened, 360px');
    await expectNoHorizontalOverflow(page, 'a finished workout, opened, 360px');
    await collapse.click();
    await expect(line).toBeFocused();
    await expectNoAxeViolations(page, 'a finished workout, folded, 360px');
    await expectTapTargets(page, 'a finished workout, folded, 360px');
    await expectNoHorizontalOverflow(page, 'a finished workout, folded, 360px');
  });
});

// ── Bodyweight and Life fold to one line (FAM-1 12c-iii PR 2) ───────────────────────────────────
//
// On this run's own athlete: a logged weight and practice change every later visit to that day. A
// new athlete's routine is strength only (`NEUTRAL_DEFAULT_KEYS`), so it adds Wrestling practice
// first, or the page has no Life section.

test.describe('Bodyweight and Life on real data', () => {
  test.use({ viewport: NARROW_VIEWPORT });

  const added: string[] = [];
  test.afterEach(async ({ page }) => {
    test.setTimeout(60_000);
    await archiveAdded(page, added.splice(0));
  });

  test('logged during a visit they stay open; coming back each is one line; Bodyweight opens, holds Collapse while changing, and folds, at 360px', async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    const athlete = `E2E fold sections ${Date.now().toString(36)}${info.workerIndex}-${info.retry}`;
    const practice = LIFE_ACTIVITIES[0].label;

    // 1. A new athlete, with Wrestling practice in the routine.
    await addAthlete(page, athlete, PROFILE_KIND.kid, added);
    await expect(page.getByRole('heading', { name: athlete, level: 1 })).toBeVisible();
    const dayPage = page.url();
    const athleteId = new URL(dayPage).pathname.split('/')[2]!;
    await page.goto(athleteRoutinePath(athleteId), { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: `+ ${practice}`, exact: true }).click();
    await page.getByRole('button', { name: ROUTINE_COPY.save, exact: true }).click();
    await expect(page.locator('form').getByRole('status')).toBeVisible();

    // 2. Both logged during this visit: both stay open, each now offering Collapse.
    await page.goto(dayPage, { waitUntil: 'networkidle' });
    const bodyweight = bodyweightSection(page);
    const life = lifeSection(page);
    const WEIGHT = '64.5';
    await logBodyweight(page, WEIGHT);
    await logPractice(page);
    const collapseOf = (region: Locator, name: string) =>
      region.getByRole('button', { name: DAY_COPY.collapseLabel(name), exact: true });
    const lineOf = (region: Locator) =>
      region.getByRole('heading').getByRole('button', { expanded: false });
    await expect(collapseOf(bodyweight, BODYWEIGHT_COPY.heading)).toBeVisible();
    await expect(collapseOf(life, LIFE_COPY.heading)).toBeVisible();
    await expect(lineOf(bodyweight)).toHaveCount(0);
    await expect(lineOf(life)).toHaveCount(0);

    // 3. Coming back: a day away and back with DayNav (a client-side change of day, where the page
    // itself does not remount), then a reload. Two lines each time, each region still named by its
    // heading alone. A new athlete can view yesterday (`day-navigation.spec.ts`).
    const nav = page.getByRole('navigation', { name: 'Change day' });
    await nav.getByRole('link', { name: /^Previous day/ }).click();
    await page.waitForURL((u) => u.searchParams.has('d'));
    await nav.getByRole('link', { name: /^Next day/ }).click();
    await page.waitForURL((u) => !u.searchParams.has('d'));
    await expect(lineOf(bodyweight)).toBeVisible();
    await expect(lineOf(life)).toBeVisible();
    await page.reload({ waitUntil: 'networkidle' });
    await expect(lineOf(bodyweight)).toHaveAccessibleName(
      `${BODYWEIGHT_COPY.heading}, ${shownWeight(WEIGHT)}`,
    );
    await expect(lineOf(life)).toHaveAccessibleName(
      `${LIFE_COPY.heading}, ${practice} ${PRACTICE_SHOWN}`,
    );
    await expectNoAxeViolations(page, 'Bodyweight and Life folded, 360px');
    await expectTapTargets(page, 'Bodyweight and Life folded, 360px');
    await expectNoHorizontalOverflow(page, 'Bodyweight and Life folded, 360px');

    // 4. Open Bodyweight; while its Change is open, no Collapse; the change saves; it returns.
    await openCollapsed(bodyweight, BODYWEIGHT_COPY.heading);
    await expectNoAxeViolations(page, 'Bodyweight opened, 360px');
    await expectTapTargets(page, 'Bodyweight opened, 360px');
    await expectNoHorizontalOverflow(page, 'Bodyweight opened, 360px');
    await changeWeight(page, WEIGHT).click();
    const editor = bodyweight.getByLabel(AMEND_COPY.valueLabel(DEFAULT_BODYWEIGHT_UNIT), {
      exact: true,
    });
    await expect(editor).toBeFocused();
    await expect(collapseOf(bodyweight, BODYWEIGHT_COPY.heading)).toHaveCount(0);
    const CORRECTED = '65';
    await editor.fill(CORRECTED);
    await bodyweight.getByRole('button', { name: BODYWEIGHT_COPY.saveLabel, exact: true }).click();
    await expect(changeWeight(page, CORRECTED)).toBeFocused({ timeout: 15_000 });
    await expect(loggedWeight(page, CORRECTED)).toBeVisible();

    // 5. Collapse: one line again, showing the new weight, with focus on it.
    await collapseOf(bodyweight, BODYWEIGHT_COPY.heading).click();
    await expect(lineOf(bodyweight)).toBeFocused();
    await expect(lineOf(bodyweight)).toHaveAccessibleName(
      `${BODYWEIGHT_COPY.heading}, ${shownWeight(CORRECTED)}`,
    );
  });
});
