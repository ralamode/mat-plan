import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import {
  addedText,
  addItemsText,
  BUILDER_COPY,
  COPY_COPY,
  copiedText,
  copyTitle,
  copyToLabel,
  EDITOR_COPY,
  ITEM_PICKER_COPY,
  renameLabel,
} from '../components/program-builder/builder-text';
import {
  newWorkoutPath,
  programPath,
  PROGRAMS_PATH,
  workoutPath,
} from '../components/program-builder/routes';
import { APP_HOME_PATH, NOT_FOUND_COPY } from '../lib/constants';
import { expectNoHorizontalOverflow, NARROW_VIEWPORT } from './contexts';

/**
 * FAM-1 7b-i and 7b-ii — the program builder's pages, end to end against the fixture world
 * (`SEED_FIXTURES=1`: "Family program" with "Heavy A", "Stretching", "Adult One’s program").
 *
 * - **It starts at `/p` and taps Programs**, as a parent does, so the Home row is proved too.
 * - 🔴 **Names are unique per run** (`Date.now()` in base 36, plus the worker): nothing can be
 *   deleted and CI retries once, so a fixed name would answer `name_taken` on the retry. What it
 *   creates stays in the e2e database, and no other spec reads these programs.
 * - **It never edits a fixture program**: it copies OUT of "Family program" into its own, so the
 *   preview walk and the day page specs see the fixture world unchanged.
 * - At 360px, the width the app commits to, because the builder is used on a phone.
 */
test.use({ viewport: NARROW_VIEWPORT });

const FIXTURE_PROGRAM = 'Family program';
const FIXTURE_WORKOUT = 'Heavy A';

/** Home → Programs, by the Household nav's row. */
async function openPrograms(page: Page) {
  await page.goto(APP_HOME_PATH);
  await page
    .getByRole('navigation', { name: 'Household' })
    .getByRole('link', { name: BUILDER_COPY.programsNavLink })
    .click();
  await expect(page).toHaveURL(PROGRAMS_PATH);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(BUILDER_COPY.programs);
}

/** "+ Create a program", named `name`; lands on its page. */
async function createProgram(page: Page, name: string) {
  await page.getByRole('button', { name: BUILDER_COPY.createProgram }).click();
  await page.getByLabel(BUILDER_COPY.programName, { exact: true }).fill(name);
  await page.getByRole('button', { name: BUILDER_COPY.create, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
}

test('a parent creates and renames a program, then copies a workout into it', async ({
  page,
}, info) => {
  const stamp = `${Date.now().toString(36)}${info.workerIndex}`;
  const name = `E2E ${stamp}`;
  const renamed = `E2E renamed ${stamp}`;

  await openPrograms(page);
  await createProgram(page, name);
  await expect(page).toHaveTitle(new RegExp(`^${BUILDER_COPY.programTitle}\\b`));
  // Nobody can be put on a program until step 15, and the page says so.
  await expect(page.getByText(BUILDER_COPY.putOnComing)).toBeVisible();

  await page.getByRole('button', { name: renameLabel(name) }).click();
  await page.getByLabel(BUILDER_COPY.programName, { exact: true }).fill(renamed);
  await page.getByRole('button', { name: BUILDER_COPY.save, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(renamed);
  const mine = page.url();

  // Copy a seeded workout out of the fixture program into this one.
  await page.getByRole('link', { name: BUILDER_COPY.backToPrograms }).click();
  await expect(page).toHaveURL(PROGRAMS_PATH);
  await expect(page.getByRole('link', { name: renamed })).toBeVisible();
  await page.getByRole('link', { name: FIXTURE_PROGRAM }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(FIXTURE_PROGRAM);
  await page.getByRole('button', { name: copyToLabel(FIXTURE_WORKOUT) }).click();
  const dialog = page.getByRole('dialog', { name: copyTitle(FIXTURE_WORKOUT) });
  await expect(dialog).toBeVisible();
  // The open dialog's a11y bar is `program-builder.a11y.spec.ts`'s (axe needs that project's CSP bypass).
  await expectNoHorizontalOverflow(page, 'Copy dialog');
  await dialog.getByLabel(COPY_COPY.to, { exact: true }).selectOption({ label: renamed });
  await dialog.getByRole('button', { name: COPY_COPY.copy, exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText(copiedText(FIXTURE_WORKOUT, renamed, [], false)).first(),
  ).toBeAttached();

  await page.goto(mine);
  await expect(
    page
      .getByRole('region', { name: BUILDER_COPY.workouts })
      .getByRole('link', { name: new RegExp(`^${FIXTURE_WORKOUT}`) }),
  ).toBeVisible();
});

/** The id at the end of a builder URL. */
const lastId = (url: string) => new URL(url).pathname.split('/').at(-1)!;

test('a parent writes a new workout with two items, saves, and Back never reopens the editor', async ({
  page,
}, info) => {
  const stamp = `${Date.now().toString(36)}${info.workerIndex}`;
  const program = `E2E workouts ${stamp}`;
  const workout = `E2E workout ${stamp}`;

  await openPrograms(page);
  await createProgram(page, program);
  const mine = page.url();
  const workouts = page.getByRole('region', { name: BUILDER_COPY.workouts });
  await workouts.getByRole('link', { name: BUILDER_COPY.newWorkout }).click();
  await expect(page).toHaveURL(newWorkoutPath(lastId(mine)));
  await expect(page).toHaveTitle(new RegExp(`^${EDITOR_COPY.newWorkout}\\b`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(EDITOR_COPY.newWorkout);
  // The back link names the program (the page passes `program`).
  await expect(page.getByRole('link', { name: new RegExp(program) })).toBeVisible();

  await page.getByLabel(EDITOR_COPY.workoutName, { exact: true }).fill(workout);
  await page.getByRole('button', { name: ITEM_PICKER_COPY.open }).click();
  const picker = page.getByRole('dialog', { name: ITEM_PICKER_COPY.title });
  await expect(picker).toBeVisible();
  for (const item of ['Box Jump', 'Pull-Up']) {
    await picker.getByRole('searchbox').fill(item);
    await picker.getByRole('checkbox', { name: new RegExp(`^${item}`) }).click();
  }
  // "2 items added." is said only once the picker is gone: jsdom closes the sheet before a frame,
  // so only a browser can show the order (guide invariant 16).
  await page.evaluate((said) => {
    const seen = window as unknown as { heardWithPickerOpen?: boolean };
    new MutationObserver(() => {
      if (seen.heardWithPickerOpen !== undefined) return;
      const live = document.querySelectorAll('[role="status"], [role="alert"], [aria-live]');
      if ([...live].some((node) => node.textContent?.includes(said))) {
        seen.heardWithPickerOpen = !!document.querySelector('[role="dialog"]');
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  }, addedText(2));
  await picker.getByRole('button', { name: addItemsText(2) }).click();
  await expect(picker).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { heardWithPickerOpen?: boolean }).heardWithPickerOpen,
      ),
    )
    .toBe(false);

  for (const item of ['Box Jump', 'Pull-Up']) {
    await page
      .getByRole('group', { name: item, exact: true })
      .getByLabel(EDITOR_COPY.sets, { exact: true })
      .fill('3');
  }
  await page.getByRole('button', { name: EDITOR_COPY.save, exact: true }).click();
  await expect(page).toHaveURL(mine);
  await expect(workouts.getByRole('link', { name: new RegExp(`^${workout}`) })).toBeVisible();

  // 🔴 U1-1: Save REPLACED the editor's entry, so Back lands on the program page it came from,
  // never on `/workouts/new` (whose Save could only make a duplicate, or on an editor holding the
  // draft from before the save).
  await page.goBack();
  await expect(page).toHaveURL(mine);
  await page.reload();
  await expect(workouts.getByRole('link', { name: new RegExp(`^${workout}`) })).toHaveCount(1);

  // The saved workout opens in its editor, with its two items in order.
  await workouts.getByRole('link', { name: new RegExp(`^${workout}`) }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(EDITOR_COPY.editWorkout);
  await expect(page).toHaveTitle(new RegExp(`^${EDITOR_COPY.editWorkout}\\b`));
  await expect(
    page.getByRole('region', { name: EDITOR_COPY.items }).getByRole('heading', { level: 3 }),
  ).toHaveText(['Box Jump', 'Pull-Up']);
});

test('a workout opened under another of the household’s programs is the builder’s 404', async ({
  page,
}) => {
  await openPrograms(page);
  await page.getByRole('link', { name: FIXTURE_PROGRAM }).click();
  await page
    .getByRole('region', { name: BUILDER_COPY.workouts })
    .getByRole('link', { name: new RegExp(`^${FIXTURE_WORKOUT}`) })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(EDITOR_COPY.editWorkout);
  const heavyA = lastId(page.url());
  // Any other program of the household's: Adult One's, found by tapping, never by a typed id.
  await page.goto(PROGRAMS_PATH);
  await page.getByRole('link', { name: /^Adult One’s program/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Adult One’s program');
  const adult = lastId(page.url());
  await page.goto(workoutPath(adult, heavyA));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(NOT_FOUND_COPY.heading);
  // And a random id under a real program is the same 404.
  await page.goto(workoutPath(adult, randomUUID()));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(NOT_FOUND_COPY.heading);
});

test('a program id the household does not have is the builder’s 404, with the way back', async ({
  page,
}) => {
  // The content, not the status: the app is force-dynamic, so Next has sent a 200 header before
  // `notFound()` throws (docs/lessons.md → "`notFound()` route returns HTTP 200").
  await page.goto(programPath(randomUUID()));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(NOT_FOUND_COPY.heading);
  await expect(page.getByRole('main')).toHaveCount(1);
  await page.getByRole('link', { name: BUILDER_COPY.backToPrograms }).click();
  await expect(page).toHaveURL(PROGRAMS_PATH);
});
