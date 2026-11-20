import { PROGRAM_NAME_MAX, SEED_PROFILE_2_NAME, SEED_PROFILE_NAME } from '@mat-plan/shared';
import { familyProgram } from '@mat-plan/shared/program/fixtures';
import { expect, test, type Page } from '@playwright/test';

import {
  BUILDER_COPY,
  COPY_COPY,
  copyTitle,
  copyToLabel,
  EDITOR_COPY,
  PUT_ON_COPY,
  putOnTitle,
  sameTargetsText,
  startingNamesText,
} from '../components/program-builder/builder-text';
import { PROGRAMS_PATH } from '../components/program-builder/routes';
import {
  expectLinkTargets,
  expectNoAxeViolations,
  expectNoOverflowWithin,
  expectTapTargets,
} from './a11y-checks';
import { DESKTOP_VIEWPORT, expectNoHorizontalOverflow, NARROW_VIEWPORT } from './contexts';
import { openPrograms } from './steps';

/**
 * FAM-1 7b-i and 7b-ii — the builder's four real pages (the Programs list, a program's page, a
 * workout's editor and a new workout), held to the
 * preview walk's bar (`program-preview-a11y.spec.ts`): axe in the real cascade, 44px controls, 44px
 * links (a row or a way back here, never a link inline in a sentence), and no sideways scroll at
 * 360px; then one desktop axe pass each, where the rail shows. Named `*.a11y.spec.ts` for the `a11y`
 * project (a phone, `bypassCSP` for axe's script).
 *
 * 🔴 **The program's id is found by tapping**, from Home through Programs to the fixture program,
 * never written here: ids are minted by the writer. One test saves: the Put-on dialog's scan
 * creates its own program, with a name as long as a name can be (FAM-1 15), and puts no one on it.
 */
test.use({ viewport: NARROW_VIEWPORT });

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
  await openPrograms(page);
  await page.getByRole('link', { name: familyProgram.name }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(familyProgram.name);
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
  const dialog = page.getByRole('dialog', { name: copyTitle('Heavy A') });
  await expect(dialog).toBeVisible();
  await expectNoAxeViolations(page, 'Copy dialog');
  await expectTapTargets(page, 'Copy dialog');
  // The sheet is fixed: the document-level check cannot see inside it.
  await expectNoOverflowWithin(dialog, 'Copy dialog');

  // The footer: side by side at 360px; stacked, action first, at 200% zoom on a 390px phone (195
  // CSS px), where two columns would clip "Cancel" (`SheetFormFooter`'s container query).
  const action = dialog.getByRole('button', { name: COPY_COPY.copy, exact: true });
  const cancel = dialog.getByRole('button', { name: BUILDER_COPY.cancel, exact: true });
  const [a, c] = [await action.boundingBox(), await cancel.boundingBox()];
  expect(a && c && Math.abs(a.y - c.y) < 2, 'the footer buttons sit side by side at 360px').toBe(
    true,
  );
  await page.setViewportSize({ width: 195, height: 422 });
  const [a2, c2] = [await action.boundingBox(), await cancel.boundingBox()];
  expect(a2 && c2 && c2.y >= a2.y + a2.height, 'Cancel sits under the action at 195px').toBe(true);
  await expectNoOverflowWithin(dialog, 'Copy dialog at 195px');
  await page.setViewportSize(NARROW_VIEWPORT);
});

test('the Put-on dialog meets the a11y bar at 360px, with the longest program name', async ({
  page,
}, info) => {
  // One unbroken token, as long as a name can be, unique per run (nothing can be deleted, and CI
  // retries): it must wrap in the title, the hints and Start, never push the sheet sideways.
  const stamp = `E2E${Date.now().toString(36)}${info.workerIndex}`;
  const name = stamp + 'x'.repeat(PROGRAM_NAME_MAX - stamp.length);
  await page.goto(PROGRAMS_PATH);
  await page.getByRole('button', { name: BUILDER_COPY.createProgram }).click();
  await page.getByLabel(BUILDER_COPY.programName, { exact: true }).fill(name);
  await page.getByRole('button', { name: BUILDER_COPY.create, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);

  await page.getByRole('button', { name: PUT_ON_COPY.open }).click();
  const dialog = page.getByRole('dialog', { name: putOnTitle(name) });
  await expect(dialog).toBeVisible();
  // Someone ticked: "Starting: …", the order hint naming the program, and Start naming it too.
  const box = dialog.locator('input[type="checkbox"]:not([aria-disabled])').first();
  await box.check();
  // Whoever was first: their name is the checkbox's label (`aria-labelledby`).
  const who = await box.evaluate(
    (el) => document.getElementById(el.getAttribute('aria-labelledby') ?? '')?.textContent ?? '',
  );
  await expect(dialog.getByText(startingNamesText([who]))).toBeVisible();
  await expectNoAxeViolations(page, 'Put-on dialog');
  await expectTapTargets(page, 'Put-on dialog');
  await expectNoOverflowWithin(dialog, 'Put-on dialog');
});

test('all four pages pass axe at desktop width, with the rail', async ({ page }) => {
  const { workout, newWorkout } = await reachWorkouts(page);
  const program = await reachProgram(page);
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await page.goto(PROGRAMS_PATH);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(BUILDER_COPY.programs);
  await expectNoAxeViolations(page, 'Programs list, desktop');
  await page.goto(program);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(familyProgram.name);
  await expectNoAxeViolations(page, 'program page, desktop');
  await page.goto(workout);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(EDITOR_COPY.editWorkout);
  await expectNoAxeViolations(page, 'workout editor, desktop');
  await page.goto(newWorkout);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(EDITOR_COPY.newWorkout);
  await expectNoAxeViolations(page, 'new workout, desktop');
});

test('when two start together, the shared-targets line is in view with Start at 360×640', async ({
  page,
}, info) => {
  // A short phone: the line must sit with Start in the pinned footer, not below the fold of the
  // form, so a parent cannot tap Start without seeing it (UX P1-U1). Its own program, so the two
  // seeded athletes who are never archived are both candidates whatever else runs. Nothing is put on.
  await page.setViewportSize({ width: 360, height: 640 });
  const name = `E2E targets ${Date.now().toString(36)}${info.workerIndex}`;
  await page.goto(PROGRAMS_PATH);
  await page.getByRole('button', { name: BUILDER_COPY.createProgram }).click();
  await page.getByLabel(BUILDER_COPY.programName, { exact: true }).fill(name);
  await page.getByRole('button', { name: BUILDER_COPY.create, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
  await page.getByRole('button', { name: PUT_ON_COPY.open }).click();
  const dialog = page.getByRole('dialog', { name: putOnTitle(name) });
  await expect(dialog).toBeVisible();
  for (const athlete of [SEED_PROFILE_NAME, SEED_PROFILE_2_NAME]) {
    await dialog.getByRole('checkbox', { name: athlete, exact: true }).check();
  }
  await expect(dialog.getByText(sameTargetsText(name))).toBeInViewport();
});
