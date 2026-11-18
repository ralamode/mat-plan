import { expect, test, type Page } from '@playwright/test';

import { previewHref } from '../app/design/program/preview-registry';
import { MOVEMENT_PICKER_COPY as COPY } from '../lib/movements/movement-picker-copy';
import { expectNoAxeViolations, expectTapTargets } from './a11y-checks';
import { expectNoHorizontalOverflow, NARROW_VIEWPORT } from './contexts';

/**
 * The movement picker's states (CAT-3 P15), on the preview's workout editor, whose picker lists the
 * test library and the fixture household's items. Each state is reached by tapping and typing,
 * which the preview's fixture walk (`program-preview-a11y.spec.ts`) cannot do, so they are here:
 * axe, 44 px targets and no sideways scroll at the narrowest width the app commits to.
 *
 * ⚠️ **A sibling of `a11y.spec.ts`, not a block inside it**: the name puts it in the same `a11y`
 * Playwright project, and the shared file stays out of a lane's diff. The queries are chosen
 * against the test library (`app/design/program/picker-options.ts`); with "Quads" on:
 * "squat" leaves matches and custom items, "gobet squat" a near miss and a some-words row, "chin"
 * nothing in the filters, and "chin-up" an exact hit outside them.
 */
test.use({ viewport: NARROW_VIEWPORT });

const EDITOR = previewHref({ screen: 'workout-editor', fixture: 'heavy-a-draft', failNext: false });

async function openPicker(page: Page) {
  await page.goto(EDITOR);
  await page.getByRole('button', { name: '+ Add items' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

async function check(page: Page, state: string) {
  await expectNoAxeViolations(page, state);
  await expectTapTargets(page, state);
  await expectNoHorizontalOverflow(page, state);
}

const filtersButton = (page: Page) => page.getByRole('button', { name: /^Filters, / });
const search = (page: Page) => page.getByRole('searchbox');

test("the movement picker's states meet the a11y bar at 360px (P15)", async ({ page }) => {
  test.setTimeout(60_000);
  await openPicker(page);

  await test.step('the filter panel, with a greyed choice', async () => {
    await filtersButton(page).click();
    await expect(page.getByRole('heading', { name: COPY.filtersHeading })).toBeFocused();
    await expect(page.getByRole('checkbox', { name: /^Neck, / })).toBeDisabled();
    await check(page, 'filter panel');
  });

  await test.step('Escape closes the panel only, and focus returns to Filters', async () => {
    await page.getByRole('checkbox', { name: /^Quads, / }).check();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: COPY.filtersHeading })).toHaveCount(0);
    await expect(filtersButton(page)).toBeFocused();
    await expect(filtersButton(page)).toHaveAccessibleName(COPY.filtersName(1));
  });

  await test.step('browsing with a filter: custom items folded, then what fits', async () => {
    await expect(page.getByRole('heading', { name: COPY.householdNotFiltered })).toBeVisible();
    await expect(page.getByRole('heading', { name: COPY.fitHeading })).toBeVisible();
    await check(page, 'browse with a filter');
  });

  await test.step('searching with a filter: custom items after the filtered matches', async () => {
    await search(page).fill('squat');
    await expect(page.getByRole('heading', { name: COPY.householdNotFiltered })).toBeVisible();
    await check(page, 'search with a filter');
  });

  await test.step('a near miss and some-words together', async () => {
    await search(page).fill('gobet squat');
    await expect(page.getByRole('heading', { name: COPY.near })).toBeVisible();
    await expect(page.getByRole('heading', { name: COPY.someWords })).toBeVisible();
    await check(page, 'near and some-words');
  });

  await test.step('nothing in the filters, with the count outside them', async () => {
    await search(page).fill('chin');
    await expect(page.getByText(/are not in your filters\.$/)).toBeVisible();
    await check(page, 'nothing in the filters');
  });

  await test.step('an exact hit outside the filters', async () => {
    await search(page).fill('chin-up');
    await expect(page.getByText(COPY.tagNotInFilters)).toBeVisible();
    await check(page, 'exact hit outside the filters');
  });

  await test.step('a supervision row, with "How to" open', async () => {
    await page.getByRole('button', { name: COPY.clearFilters }).first().click();
    await search(page).fill('hang power');
    await page.getByRole('button', { name: COPY.howToFor('Hang power clean') }).click();
    const box = page.getByRole('region', { name: COPY.howToFor('Hang power clean') });
    await expect(box.getByRole('listitem').first()).toBeVisible();
    await check(page, 'supervision row, How to open');
  });

  await test.step('the new-item form', async () => {
    await search(page).fill('');
    await page.getByRole('button', { name: /New item/ }).click();
    await expect(page.getByRole('searchbox')).toHaveCount(0);
    await check(page, 'new-item form');
  });
});
