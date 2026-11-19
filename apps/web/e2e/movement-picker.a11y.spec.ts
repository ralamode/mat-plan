import { MODALITY_LABELS, MOVEMENT_FAMILY_LABELS } from '@mat-plan/shared';
import { expect, test, type Page } from '@playwright/test';

import { previewHref } from '../app/design/program/preview-registry';
import { ITEM_PICKER_COPY, newItemLabel } from '../components/program-builder/builder-text';
import { MOVEMENT_PICKER_COPY as COPY } from '../lib/movements/movement-picker-copy';
import { expectNoAxeViolations, expectNoOverflowWithin, expectTapTargets } from './a11y-checks';
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

async function check(page: Page, state: string) {
  await expectNoAxeViolations(page, state);
  await expectTapTargets(page, state);
  await expectNoHorizontalOverflow(page, state);
  await expectNoOverflowWithin(page.getByRole('dialog'), state);
}

const filtersButton = (page: Page) => page.getByRole('button', { name: /^Filters, / });
const search = (page: Page) => page.getByRole('searchbox');
const muscle = (page: Page, label: string) =>
  page.getByRole('checkbox', { name: new RegExp(`^${label}${COPY.choiceJoin}`) });
/**
 * A browse group's disclosure (CAT-3 B3), by its label: its name is "Strength, 17 movements". Chrome
 * may put a space between the label's span and the hidden count's, hence `\s*`.
 */
const group = (page: Page, label: string) =>
  page.getByRole('button', { name: new RegExp(`^${label}\\s*${COPY.choiceJoin.trim()}`) });

/** The smallest name column a row may keep at 200 % text at 360px: about 174px stacked, 30 not. */
const NAME_AT_LARGE_TEXT_MIN = 120;
/**
 * And on a page zoomed to 195 CSS px at 100 % text: about 101px stacked. Assumes headless
 * Chromium's hidden scrollbars; a classic 15px scrollbar would take it from the list.
 */
const NAME_AT_ZOOM_MIN = 90;

/**
 * An open family has room at large text or zoom (CAT-3 B3-ii; WCAG 1.4.4), checked on the Squats
 * family and its Goblet squat row (which has "How to"):
 *
 * - no laid-out text-bearing span is wider than its box (an `sr-only` span is skipped);
 * - the row's name keeps at least `minName` px: "How to" has dropped under it, not squeezed it;
 * - the family's label ends before its count starts.
 */
async function expectRoomInFamily(page: Page, minName: number, context: string) {
  const squats = page.getByRole('heading', { level: 5, name: MOVEMENT_FAMILY_LABELS.squat });
  // The family's group: its heading and its rows.
  const family = squats.locator('xpath=..');
  await squats.scrollIntoViewIfNeeded();
  const goblet = family.getByRole('checkbox', { name: /^Goblet squat\b/ });
  await expect(goblet).toBeVisible();

  const spilled = await family.evaluate((root) => {
    const spans = [...root.querySelectorAll('span')].filter(
      (el) =>
        !el.classList.contains('sr-only') &&
        (el.textContent ?? '').trim() !== '' &&
        getComputedStyle(el).display !== 'inline',
    );
    return {
      checked: spans.length,
      wide: spans
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map(
          (el) =>
            `"${(el.textContent ?? '').trim().slice(0, 30)}" (${el.scrollWidth} > ${el.clientWidth})`,
        ),
    };
  });
  expect(spilled.wide, `${context}: text wider than its box`).toEqual([]);
  // Non-vacuity: the family's label and count, and the rows' names and second lines.
  expect(spilled.checked, `${context}: spans checked`).toBeGreaterThanOrEqual(4);

  const name = await goblet.getByText('Goblet squat', { exact: true }).boundingBox();
  expect(name?.width ?? 0, `${context}: the name column`).toBeGreaterThanOrEqual(minName);

  // The family's button holds its chevron, its label, its count and an `sr-only` count: the
  // visible count (the last visible span) must stay inside the button, not be pushed past its edge.
  const edges = await squats.evaluate((heading) => {
    const button = heading.querySelector('button');
    const count = [...(button?.querySelectorAll(':scope > span:not(.sr-only)') ?? [])].at(-1);
    return button && count
      ? { button: button.getBoundingClientRect().right, count: count.getBoundingClientRect().right }
      : null;
  });
  expect(edges, `${context}: the family's button and count`).not.toBeNull();
  expect(edges!.count, `${context}: the family's count leaves its button`).toBeLessThanOrEqual(
    edges!.button + 1,
  );
  await expectNoOverflowWithin(page.getByRole('dialog'), context);
}

test("the movement picker's states meet the a11y bar at 360px (P15)", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(EDITOR);
  await page.getByRole('button', { name: ITEM_PICKER_COPY.open, exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  // The test library holds more than BROWSE_OPEN_AT_MOST rows, so its kinds start closed.
  await test.step('browsing with no filter: a kind opens from the keyboard and keeps focus', async () => {
    await group(page, COPY.allMovements).focus();
    await page.keyboard.press('Tab');
    const strength = group(page, MODALITY_LABELS.strength);
    await expect(strength).toBeFocused();
    await expect(strength).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(strength).toHaveAttribute('aria-expanded', 'true');
    await expect(strength).toBeFocused();
  });

  await test.step('browsing with no filter: a kind and a family open', async () => {
    const family = group(page, MOVEMENT_FAMILY_LABELS.vertical_pull);
    await family.click();
    await expect(family).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('checkbox', { name: /^Chin-up\b/ })).toBeVisible();
    await check(page, 'browse with a kind and a family open');
    // At 360px and 100 % text a row is one line: "How to" beside the name, not under it. Chin-up
    // has no steps in the test library, so this is Goblet squat's, in Squats.
    await group(page, MOVEMENT_FAMILY_LABELS.squat).click();
    const pick = page.getByRole('checkbox', { name: /^Goblet squat\b/ });
    const howTo = page.getByRole('button', { name: COPY.howToFor('Goblet squat'), exact: true });
    await howTo.scrollIntoViewIfNeeded();
    const [pickBox, howToBox] = [await pick.boundingBox(), await howTo.boundingBox()];
    expect(howToBox!.y, '"How to" beside the name at 360px').toBeLessThan(
      pickBox!.y + pickBox!.height / 2,
    );
  });

  await test.step('the filter panel, with a greyed choice', async () => {
    await filtersButton(page).click();
    await expect(
      page.getByRole('heading', { name: COPY.filtersHeading, exact: true }),
    ).toBeFocused();
    await expect(muscle(page, 'Neck')).toHaveAttribute('aria-disabled', 'true');
    await check(page, 'filter panel');
  });

  await test.step('Escape closes the panel only, and focus returns to Filters', async () => {
    await muscle(page, 'Quads').check();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: COPY.filtersHeading, exact: true })).toHaveCount(
      0,
    );
    await expect(filtersButton(page)).toBeFocused();
    await expect(filtersButton(page)).toHaveAccessibleName(COPY.filtersName(1));
  });

  await test.step('browsing with a filter: custom items folded, then the tree of what fits', async () => {
    // Not exact: a group's name adds its count ("…, 24 movements").
    const custom = page.getByRole('heading', { level: 3, name: COPY.householdNotFiltered });
    await expect(custom.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    await expect(group(page, COPY.fitHeading)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('heading', { level: 3, name: COPY.allMovements })).toHaveCount(0);
    // "Quads" leaves three library rows (Strength: Jumps, Lunges, Squats), so the whole tree opens
    // itself (K26): its kind is an h4, its families h5s, each with its count.
    const strength = page.getByRole('heading', { level: 4, name: MODALITY_LABELS.strength });
    await expect(strength.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    for (const family of [MOVEMENT_FAMILY_LABELS.jump, MOVEMENT_FAMILY_LABELS.squat]) {
      const heading = page.getByRole('heading', { level: 5, name: family });
      await expect(heading.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    }
    await expect(page.getByRole('checkbox', { name: /^Goblet squat\b/ })).toBeVisible();
    await check(page, 'browse with a filter');
  });

  await test.step('an open family under a filter at 200 % text, and at 195 CSS px', async () => {
    // ⚠️ No `expectNoHorizontalOverflow` here: it measures the page under the fixed sheet, which
    // cannot scroll sideways whatever the sheet holds (`sheet.tsx`, the 195 CSS px note).
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await expectRoomInFamily(page, NAME_AT_LARGE_TEXT_MIN, 'open family at 200 % text');
    // "How to" sits under the name, not beside it.
    const pick = page.getByRole('checkbox', { name: /^Goblet squat\b/ });
    const howTo = page.getByRole('button', { name: COPY.howToFor('Goblet squat'), exact: true });
    const [pickBox, howToBox] = [await pick.boundingBox(), await howTo.boundingBox()];
    expect(howToBox!.y, '"How to" under the name at 200 % text').toBeGreaterThanOrEqual(
      pickBox!.y + pickBox!.height - 1,
    );
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
    // A page zoomed to 200 % on a 390px phone is 195 CSS px wide, at 100 % text.
    await page.setViewportSize({ width: 195, height: NARROW_VIEWPORT.height });
    await expectRoomInFamily(page, NAME_AT_ZOOM_MIN, 'open family at 195 CSS px');
    await page.setViewportSize(NARROW_VIEWPORT);
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
    // The hit's own row carries the tag (the "1 more…" line says the words too).
    await expect(page.getByRole('checkbox', { name: /^Chin-up\b/ })).toContainText(
      COPY.tagNotInFilters,
    );
    await check(page, 'exact hit outside the filters');
  });

  await test.step('the panel and the search row at 200 % text', async () => {
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await filtersButton(page).click();
    await expectNoOverflowWithin(page.getByRole('dialog'), 'filter panel at 200 % text');
    await page.getByRole('button', { name: COPY.filtersBack, exact: true }).click();
    // The row wraps: the box keeps room to type rather than shrinking to a few letters.
    const width = await search(page).evaluate((el) => el.clientWidth);
    expect(width, 'the search box at 200 % text').toBeGreaterThanOrEqual(160);
    await expectNoOverflowWithin(page.getByRole('dialog'), 'search row at 200 % text');
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
