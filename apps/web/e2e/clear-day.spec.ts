import { CLEAR_DAY_CONFIRM_WORD, PROFILE_NAME_MAX } from '@mat-plan/shared';
import { expect, test, type Page } from '@playwright/test';

import { AMEND_COPY, CLEAR_DAY_COPY, CLEAR_DAY_OUTCOME_ID } from '../lib/constants';
import {
  expectActuallyDark,
  expectNoAxeViolations,
  expectNoOverflowWithin,
  seedStoredTheme,
} from './a11y-checks';
import {
  addAthlete,
  archiveAdded,
  logBodyweight,
  loggedWeight,
  logPractice,
  practiceChange,
} from './steps';

/**
 * **V1-9b B2 — Clear this day, end to end:** log, clear behind the typed word, Restore all.
 *
 * 🔴 **On an athlete this test CREATES, never a seeded one.** A clear hides every entry of the day,
 * so a seeded athlete's today would vanish under every other spec running in parallel
 * (`fullyParallel`). The name carries the retry, so a retry starts on an empty day. Each run spends one
 * of `MAX_HOUSEHOLD_ATHLETES`' slots, which archiving does not free; the e2e database is fresh per run.
 *
 * Program rows are proved hidden and restored by `db:verify` (B2-0's proof 3); the dialog's counts, the
 * four restore outcomes, the reset on open and the two-clear banner by `clear-day.test.tsx`.
 */
const added: string[] = [];
test.afterEach(async ({ page }) => {
  await archiveAdded(page, added.splice(0));
});

const WEIGHT = '71.5';

async function newAthleteWithADay(page: Page, name: string): Promise<void> {
  await addAthlete(page, name, undefined, added);
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  await logBodyweight(page, WEIGHT);
  await logPractice(page);
}
const nameFor = (label: string, retry: number) =>
  `CLEAR ${label} ${retry} ${Date.now().toString(36)}`;

const dialog = (page: Page) => page.getByRole('dialog');
const confirmField = (page: Page) => dialog(page).getByRole('textbox');
const clearButton = (page: Page) =>
  dialog(page).getByRole('button', { name: CLEAR_DAY_COPY.action, exact: true });
const triggerButton = (page: Page) =>
  page.getByRole('button', { name: CLEAR_DAY_COPY.trigger, exact: true });
const restoreAll = (page: Page) =>
  page.getByRole('button', { name: CLEAR_DAY_COPY.restoreAll, exact: true });

test('clear the day behind the typed word, then Restore all, with focus at each step', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await newAthleteWithADay(page, nameFor('flow', testInfo.retry));

  await triggerButton(page).click();
  await expect(dialog(page)).toBeVisible();
  // Not armed until the word is typed: a tap says why and clears nothing.
  await clearButton(page).click();
  await expect(dialog(page)).toContainText(CLEAR_DAY_COPY.confirmFirst(CLEAR_DAY_CONFIRM_WORD));

  // Case and spaces ignored. 🔴 Enter moves focus to Clear day and NEVER clears.
  await confirmField(page).fill(' Delete ');
  await confirmField(page).press('Enter');
  await expect(clearButton(page)).toBeFocused();
  await expect(dialog(page)).toBeVisible();
  // The page behind is aria-hidden while the dialog is open, so prove nothing was cleared after it
  // closes: Cancel, and the weigh-in is still there.
  await dialog(page).getByRole('button', { name: AMEND_COPY.cancel, exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(loggedWeight(page, WEIGHT)).toHaveCount(1);

  await triggerButton(page).click();
  await confirmField(page).fill(CLEAR_DAY_CONFIRM_WORD);
  await clearButton(page).click();
  await expect(dialog(page)).toHaveCount(0);
  // The day is empty, and focus waits on the banner's Restore all.
  await expect(loggedWeight(page, WEIGHT)).toHaveCount(0);
  await expect(practiceChange(page)).toHaveCount(0);
  await expect(restoreAll(page)).toBeFocused();
  await expect(
    page.getByText(CLEAR_DAY_COPY.banner(2, CLEAR_DAY_COPY.deadline.tomorrow)),
  ).toBeVisible();
  // Nothing live, so no trigger: there is nothing left to clear.
  await expect(triggerButton(page)).toHaveCount(0);
  // The banner state, scanned.
  await expectNoAxeViolations(page, 'cleared day, banner');

  await restoreAll(page).click();
  await expect(page.locator(`#${CLEAR_DAY_OUTCOME_ID}`)).toContainText(CLEAR_DAY_COPY.restored);
  await expect(page.locator(`#${CLEAR_DAY_OUTCOME_ID}`)).toBeFocused();
  await expect(loggedWeight(page, WEIGHT)).toHaveCount(1);
  await expect(practiceChange(page)).toHaveCount(1);
});

test('on a small phone with the keyboard up, the field and then Clear day stay in view', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 360, height: 640 });
  // An unbroken name at the cap: the dialog's body must wrap it at 360px, not scroll sideways.
  const unbroken = `CLEAR${testInfo.retry}${Date.now().toString(36)}`
    .padEnd(PROFILE_NAME_MAX, 'X')
    .slice(0, PROFILE_NAME_MAX);
  await newAthleteWithADay(page, unbroken);
  await triggerButton(page).click();
  await confirmField(page).focus();
  // The keyboard takes most of the height: the Sheet goes compact.
  await page.setViewportSize({ width: 360, height: 300 });
  await expect(confirmField(page)).toBeInViewport();
  await confirmField(page).fill(CLEAR_DAY_CONFIRM_WORD);
  await confirmField(page).press('Enter');
  await expect(clearButton(page)).toBeFocused();
  await expect(clearButton(page)).toBeInViewport();
  await expectNoOverflowWithin(dialog(page), 'clear-day dialog at 360px');
});

for (const theme of ['light', 'dark'] as const) {
  test(`the armed dialog passes axe in the ${theme} theme`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await seedStoredTheme(page, theme);
    await newAthleteWithADay(page, nameFor(`axe-${theme}`, testInfo.retry));
    if (theme === 'dark') await expectActuallyDark(page, 'clear-day dialog');
    await triggerButton(page).click();
    // Typed first: axe skips an inactive control, and the armed danger button is the one to check.
    await confirmField(page).fill(CLEAR_DAY_CONFIRM_WORD);
    await expectNoAxeViolations(page, `clear-day dialog, armed (${theme})`);
  });
}
