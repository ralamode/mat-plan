import { expect, test, type Page } from '@playwright/test';

import { previewHref } from '../app/design/program/preview-registry';
import { ITEM_PICKER_COPY, newItemLabel } from '../components/program-builder/builder-text';
import { MOVEMENT_PICKER_COPY as COPY } from '../lib/movements/movement-picker-copy';
import { expectNoAxeViolations, expectTapTargets } from './a11y-checks';
import { expectNoHorizontalOverflow, NARROW_VIEWPORT } from './contexts';

/**
 * The movement picker's states (CAT-3 P15), on the preview's workout editor, whose picker lists the
 * test library and the fixture household's items. Each state is reached by tapping and typing,
 * which the preview's fixture walk (`program-preview-a11y.spec.ts`) cannot do, so they are here:
 * axe, 44 px targets and no sideways scroll at the narrowest width the app commits to, and the
 * filter panel again at 200 % text.
 *
 * ⚠️ **A sibling of `a11y.spec.ts`, not a block inside it**: the name puts it in the same `a11y`
 * Playwright project, and the shared file stays out of a lane's diff. The queries are chosen
 * against the test library (`app/design/program/picker-options.ts`); with "Quads" on:
 * "squat" leaves matches and custom items, "gobet squat" a near miss and a some-words row, "chin"
 * four library movements and none in the filters, and "chin-up" an exact hit outside them.
 */
test.use({ viewport: NARROW_VIEWPORT });

const EDITOR = previewHref({ screen: 'workout-editor', fixture: 'heavy-a-draft', failNext: false });

/**
 * 🔴 **Inside the sheet, not the document.** The sheet is fixed and its scroll lock hides the body's
 * overflow, so `expectNoHorizontalOverflow` (the document's) cannot see a panel that spills past the
 * sheet's edge (`sheet.tsx` says so). This measures the dialog and its scrolling body.
 */
async function expectNoSheetOverflow(page: Page, state: string) {
  const spill = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return ['no dialog'];
    return [dialog, ...dialog.querySelectorAll('.overflow-y-auto')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => `${el.className.slice(0, 40)}: ${el.scrollWidth} > ${el.clientWidth}`);
  });
  expect(spill, `${state}: sideways scroll inside the sheet`).toEqual([]);
}

async function check(page: Page, state: string) {
  await expectNoAxeViolations(page, state);
  await expectTapTargets(page, state);
  await expectNoHorizontalOverflow(page, state);
  await expectNoSheetOverflow(page, state);
}

const filtersButton = (page: Page) => page.getByRole('button', { name: /^Filters, / });
const search = (page: Page) => page.getByRole('searchbox');
const muscle = (page: Page, label: string) =>
  page.getByRole('checkbox', { name: new RegExp(`^${label}${COPY.choiceJoin}`) });

test("the movement picker's states meet the a11y bar at 360px (P15)", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(EDITOR);
  await page.getByRole('button', { name: ITEM_PICKER_COPY.open, exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  await test.step('the filter panel, with a greyed choice', async () => {
    await filtersButton(page).click();
    await expect(page.getByRole('heading', { name: COPY.filtersHeading })).toBeFocused();
    await expect(muscle(page, 'Neck')).toHaveAttribute('aria-disabled', 'true');
    await check(page, 'filter panel');
  });

  await test.step('Escape closes the panel only, and focus returns to Filters', async () => {
    await muscle(page, 'Quads').check();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: COPY.filtersHeading })).toHaveCount(0);
    await expect(filtersButton(page)).toBeFocused();
    await expect(filtersButton(page)).toHaveAccessibleName(COPY.filtersName(1));
  });

  await test.step('browsing with a filter: custom items folded, then what fits', async () => {
    // Not exact: the folded summary adds its count ("… · 24").
    await expect(page.getByRole('heading', { name: COPY.householdNotFiltered })).toBeVisible();
    await expect(page.getByRole('heading', { name: COPY.fitHeading, exact: true })).toBeVisible();
    await check(page, 'browse with a filter');
  });

  await test.step('searching with a filter: custom items after the filtered matches', async () => {
    await search(page).fill('squat');
    await expect(
      page.getByRole('heading', { name: COPY.householdNotFiltered, exact: true }),
    ).toBeVisible();
    await check(page, 'search with a filter');
  });

  await test.step('a near miss and some-words together', async () => {
    await search(page).fill('gobet squat');
    await expect(page.getByRole('heading', { name: COPY.near, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: COPY.someWords, exact: true })).toBeVisible();
    await check(page, 'near and some-words');
  });

  await test.step('nothing in the filters, with the count outside them', async () => {
    await search(page).fill('chin');
    await expect(page.getByText(COPY.outsideAll(4, 'chin'), { exact: true })).toBeVisible();
    await check(page, 'nothing in the filters');
  });

  await test.step('an exact hit outside the filters', async () => {
    await search(page).fill('chin-up');
    await expect(page.getByText(COPY.tagNotInFilters)).toBeVisible();
    await check(page, 'exact hit outside the filters');
  });

  await test.step('the panel and the search row at 200 % text', async () => {
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await filtersButton(page).click();
    await expectNoSheetOverflow(page, 'filter panel at 200 % text');
    await page.getByRole('button', { name: COPY.filtersBack, exact: true }).click();
    // The row wraps: the box keeps room to type rather than shrinking to a few letters.
    const width = await search(page).evaluate((el) => el.clientWidth);
    expect(width, 'the search box at 200 % text').toBeGreaterThanOrEqual(160);
    await expectNoSheetOverflow(page, 'search row at 200 % text');
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
  });

  await test.step('a supervision row, with "How to" open', async () => {
    // The line at the top of the list holds its own Clear filters.
    const line = page.getByText(COPY.filtersOnLine(1), { exact: true }).locator('..');
    await line.getByRole('button', { name: COPY.clearFilters, exact: true }).click();
    await search(page).fill('hang power');
    await page
      .getByRole('button', { name: COPY.howToFor('Hang power clean'), exact: true })
      .click();
    const box = page.getByRole('region', { name: COPY.howToFor('Hang power clean') });
    await expect(box.getByRole('listitem').first()).toBeVisible();
    await check(page, 'supervision row, How to open');
  });

  await test.step('the new-item form', async () => {
    await search(page).fill('');
    await page.getByRole('button', { name: newItemLabel(''), exact: true }).click();
    await expect(page.getByRole('searchbox')).toHaveCount(0);
    await check(page, 'new-item form');
  });
});
