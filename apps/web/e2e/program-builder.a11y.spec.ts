import { expect, test, type Page } from '@playwright/test';

import { BUILDER_COPY, copyTitle, copyToLabel } from '../components/program-builder/builder-text';
import { PROGRAMS_PATH } from '../components/program-builder/routes';
import { APP_HOME_PATH, MIN_TAP_TARGET_PX } from '../lib/constants';
import { expectNoAxeViolations, expectTapTargets } from './a11y-checks';
import { DESKTOP_VIEWPORT, expectNoHorizontalOverflow, NARROW_VIEWPORT } from './contexts';

/**
 * FAM-1 7b-i — the builder's two real pages, the Programs list and a program's page, held to the
 * preview walk's bar (`program-preview-a11y.spec.ts`): axe in the real cascade, 44px controls, 44px
 * links (a row or a way back here, never a link inline in a sentence), and no sideways scroll at
 * 360px; then one desktop axe pass each, where the rail shows. Named `*.a11y.spec.ts` for the `a11y`
 * project (a phone, `bypassCSP` for axe's script).
 *
 * 🔴 **The program's id is found by tapping**, from Home through Programs to the fixture program,
 * never written here: ids are minted by the writer. 7b-ii adds the two workout pages.
 */
test.use({ viewport: NARROW_VIEWPORT });

const FIXTURE_PROGRAM = 'Family program';

/** The preview walk's link check: every link in `<main>` is a thumb target. */
async function expectLinkTargets(page: Page, context: string): Promise<void> {
  const links = await page.getByRole('main').getByRole('link').all();
  expect(links.length, `${context}: found no links, so the selector is wrong`).toBeGreaterThan(0);
  const undersized: string[] = [];
  for (const link of links) {
    const height = (await link.boundingBox())?.height ?? 0;
    if (height < MIN_TAP_TARGET_PX) {
      undersized.push(`"${(await link.innerText()).trim()}" → ${Math.round(height)}px`);
    }
  }
  expect(undersized, `${context}: links under ${MIN_TAP_TARGET_PX}px tall`).toEqual([]);
}

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

test('the Copy dialog meets the a11y bar at 360px', async ({ page }) => {
  await reachProgram(page);
  await page.getByRole('button', { name: copyToLabel('Heavy A') }).click();
  await expect(page.getByRole('dialog', { name: copyTitle('Heavy A') })).toBeVisible();
  await expectNoAxeViolations(page, 'Copy dialog');
  await expectTapTargets(page, 'Copy dialog');
  await expectNoHorizontalOverflow(page, 'Copy dialog');
});

test('both pages pass axe at desktop width, with the rail', async ({ page }) => {
  const program = await reachProgram(page);
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await page.goto(PROGRAMS_PATH);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(BUILDER_COPY.programs);
  await expectNoAxeViolations(page, 'Programs list, desktop');
  await page.goto(program);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(FIXTURE_PROGRAM);
  await expectNoAxeViolations(page, 'program page, desktop');
});
