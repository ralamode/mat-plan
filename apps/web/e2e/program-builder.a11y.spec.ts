import { expect, test, type Page } from '@playwright/test';

import {
  BUILDER_COPY,
  copyTitle,
  copyToLabel,
  EDITOR_COPY,
} from '../components/program-builder/builder-text';
import { PROGRAMS_PATH } from '../components/program-builder/routes';
import { APP_HOME_PATH } from '../lib/constants';
import { expectLinkTargets, expectNoAxeViolations, expectTapTargets } from './a11y-checks';
import { DESKTOP_VIEWPORT, expectNoHorizontalOverflow, NARROW_VIEWPORT } from './contexts';

/**
 * FAM-1 7b-i and 7b-ii — the builder's four real pages (the Programs list, a program's page, a
 * workout's editor and a new workout), held to the
 * preview walk's bar (`program-preview-a11y.spec.ts`): axe in the real cascade, 44px controls, 44px
 * links (a row or a way back here, never a link inline in a sentence), and no sideways scroll at
 * 360px; then one desktop axe pass each, where the rail shows. Named `*.a11y.spec.ts` for the `a11y`
 * project (a phone, `bypassCSP` for axe's script).
 *
 * 🔴 **The program's id is found by tapping**, from Home through Programs to the fixture program,
 * never written here: ids are minted by the writer. Nothing here saves: the walk only opens pages.
 */
test.use({ viewport: NARROW_VIEWPORT });

const FIXTURE_PROGRAM = 'Family program';

async function expectTheBar(page: Page, context: string): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('main')).toHaveCount(1);
  await expectNoAxeViolations(page, context);
  await expectTapTargets(page, context);
  await expectLinkTargets(page, context);
  await expectNoHorizontalOverflow(page, context);
}

/** Home → Programs → the fixture program, by taps; answers the program page's URL. */
async function reachProgram(page: Page): Promise<string> {
  await page.goto(APP_HOME_PATH);
  await page
    .getByRole('navigation', { name: 'Household' })
    .getByRole('link', { name: BUILDER_COPY.programsNavLink })
    .click();
  await expect(page).toHaveURL(PROGRAMS_PATH);
  await page.getByRole('link', { name: FIXTURE_PROGRAM }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(FIXTURE_PROGRAM);
  return page.url();
}

test('the Programs list and a program’s page meet the a11y bar at 360px', async ({ page }) => {
  await page.goto(PROGRAMS_PATH);
  await expectTheBar(page, 'Programs list');
  await reachProgram(page);
  await expectTheBar(page, 'program page');
});

/** From the fixture program's page: its "Heavy A" editor, then back, then "+ New workout". */
async function reachWorkouts(page: Page): Promise<{ workout: string; newWorkout: string }> {
  const program = await reachProgram(page);
  const workouts = page.getByRole('region', { name: BUILDER_COPY.workouts });
  await workouts.getByRole('link', { name: /^Heavy A/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(EDITOR_COPY.editWorkout);
  const workout = page.url();
  await page.goto(program);
  await workouts.getByRole('link', { name: BUILDER_COPY.newWorkout }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(EDITOR_COPY.newWorkout);
  return { workout, newWorkout: page.url() };
}

test('a workout’s editor and a new workout meet the a11y bar at 360px', async ({ page }) => {
  const { workout } = await reachWorkouts(page);
  await expectTheBar(page, 'new workout');
  await page.goto(workout);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(EDITOR_COPY.editWorkout);
  await expectTheBar(page, 'workout editor');
});

test('the Copy dialog meets the a11y bar at 360px', async ({ page }) => {
  await reachProgram(page);
  await page.getByRole('button', { name: copyToLabel('Heavy A') }).click();
  await expect(page.getByRole('dialog', { name: copyTitle('Heavy A') })).toBeVisible();
  await expectNoAxeViolations(page, 'Copy dialog');
  await expectTapTargets(page, 'Copy dialog');
  await expectNoHorizontalOverflow(page, 'Copy dialog');
});

test('all four pages pass axe at desktop width, with the rail', async ({ page }) => {
  const { workout, newWorkout } = await reachWorkouts(page);
  const program = await reachProgram(page);
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await page.goto(PROGRAMS_PATH);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(BUILDER_COPY.programs);
  await expectNoAxeViolations(page, 'Programs list, desktop');
  await page.goto(program);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(FIXTURE_PROGRAM);
  await expectNoAxeViolations(page, 'program page, desktop');
  await page.goto(workout);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(EDITOR_COPY.editWorkout);
  await expectNoAxeViolations(page, 'workout editor, desktop');
  await page.goto(newWorkout);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(EDITOR_COPY.newWorkout);
  await expectNoAxeViolations(page, 'new workout, desktop');
});
