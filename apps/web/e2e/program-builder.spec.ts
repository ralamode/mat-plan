import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import {
  BUILDER_COPY,
  COPY_COPY,
  copiedText,
  copyTitle,
  copyToLabel,
  renameLabel,
} from '../components/program-builder/builder-text';
import { programPath, PROGRAMS_PATH } from '../components/program-builder/routes';
import { APP_HOME_PATH, NOT_FOUND_COPY } from '../lib/constants';
import { expectNoHorizontalOverflow, NARROW_VIEWPORT } from './contexts';

/**
 * FAM-1 7b-i — the program builder's list and program pages, end to end against the fixture world
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
  await page.getByLabel(BUILDER_COPY.programName).fill(name);
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
  await page.getByLabel(BUILDER_COPY.programName).fill(renamed);
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
  await dialog.getByLabel(COPY_COPY.to).selectOption({ label: renamed });
  await dialog.getByRole('button', { name: COPY_COPY.copy, exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText(copiedText(FIXTURE_WORKOUT, renamed, [], false)).first(),
  ).toBeAttached();

  await page.goto(mine);
  await expect(
    page
      .getByRole('region', { name: BUILDER_COPY.workouts })
      .getByRole('link', { name: new RegExp(FIXTURE_WORKOUT) }),
  ).toBeVisible();
});

test('a program id the household does not have is the builder’s 404, with the way back', async ({
  page,
}) => {
  const response = await page.goto(programPath(randomUUID()));
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(NOT_FOUND_COPY.heading);
  await expect(page.getByRole('main')).toHaveCount(1);
  await page.getByRole('link', { name: BUILDER_COPY.backToPrograms }).click();
  await expect(page).toHaveURL(PROGRAMS_PATH);
});
