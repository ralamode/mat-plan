import { DEFAULT_BODYWEIGHT_UNIT, PROFILE_KIND, PROFILE_KIND_LABELS } from '@mat-plan/shared';
import { expect, test, type Page } from '@playwright/test';

import {
  ADD_ATHLETE_PATH,
  AMEND_COPY,
  ATHLETE_FORM_COPY,
  BODYWEIGHT_COPY,
  LAST_TIME_PREFIX,
} from '../lib/constants';
import {
  bodyweightSection,
  changeWeight,
  isoDaysAgo,
  logBodyweight,
  loggedWeight,
  shownWeight,
} from './steps';

/**
 * **V1-24 3b-bw — the bodyweight row, end to end: ✓, Change, a blank ✓ that clears, re-entry.**
 *
 * 🔴 **On an athlete this test CREATES, never a seeded one.** A clear hides a weigh-in, and nothing in
 * the app restores it; Athlete Two's history is what `export-csv.spec.ts` reads. A new athlete also
 * makes a retry start clean: the name carries the attempt, so a retry gets a fresh, empty athlete
 * instead of reading what the first attempt left. (`MAX_HOUSEHOLD_ATHLETES` bounds the household; the
 * e2e database is fresh per run, so one athlete per run is the whole cost.)
 *
 * Covered elsewhere: every copy state, the archived refusal and the island's focus rules
 * (`bodyweight-section.test.tsx`, `single-value-live.test.tsx`); 360px and axe (`a11y.spec.ts`).
 */

test('log with ✓, change, clear with a blank ✓, then re-enter, with focus at each step', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const name = `3B-BW ${testInfo.workerIndex}-${testInfo.retry} ${Date.now().toString(36)}`;
  await page.goto(ADD_ATHLETE_PATH, { waitUntil: 'networkidle' });
  await page
    .getByRole('radio', { name: new RegExp(`^${PROFILE_KIND_LABELS[PROFILE_KIND.kid]}`) })
    .check();
  await page.getByLabel(ATHLETE_FORM_COPY.nameLabel).fill(name);
  await page.getByRole('button', { name: ATHLETE_FORM_COPY.add }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  const route = new URL(page.url()).pathname;

  const section = bodyweightSection(page);
  const field = section.getByLabel('Weight', { exact: true });
  const status = section.getByRole('status');

  // ── Yesterday first, so today has a "Last time" (a new athlete can view yesterday) ──────────
  const YESTERDAY = '70.5';
  await page.goto(`${route}?d=${isoDaysAgo(1)}`, { waitUntil: 'networkidle' });
  await expect(section.getByText(new RegExp(`^${LAST_TIME_PREFIX}`))).toHaveCount(0); // nothing before it
  await logBodyweight(page, YESTERDAY);
  await expect(status).toHaveText(BODYWEIGHT_COPY.announcedLogged);

  // ── Today: "Last time" with no day suffix, then ✓ ──────────────────────────────────────────
  await page.goto(route, { waitUntil: 'networkidle' });
  await expect(
    section.getByText(BODYWEIGHT_COPY.lastTime(shownWeight(YESTERDAY), null), { exact: true }),
  ).toBeVisible();
  const FIRST = '71.2';
  await logBodyweight(page, FIRST); // asserts the logged row and focus on Change
  await expect(status).toHaveText(BODYWEIGHT_COPY.announcedLogged);

  // ── Change: opens selected, so one digit replaces the value; ✕ and Escape hand focus back ────
  await changeWeight(page, FIRST).click();
  const editor = section.getByLabel(AMEND_COPY.valueLabel(DEFAULT_BODYWEIGHT_UNIT), {
    exact: true,
  });
  await expect(editor).toBeFocused();
  await editor.press('9'); // replaces the selection
  await expect(editor).toHaveValue('9');
  await section.getByRole('button', { name: BODYWEIGHT_COPY.cancelLabel, exact: true }).click();
  await expect(changeWeight(page, FIRST)).toBeFocused();
  // Escape cancels too, from the field and from the ✓ (a keyboard user's Cancel).
  await changeWeight(page, FIRST).click();
  await editor.press('Escape');
  await expect(changeWeight(page, FIRST)).toBeFocused();
  await changeWeight(page, FIRST).click();
  await section.getByRole('button', { name: BODYWEIGHT_COPY.saveLabel, exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(changeWeight(page, FIRST)).toBeFocused();

  // ── Save a correction ───────────────────────────────────────────────────────────────────────
  const CORRECTED = '71.8';
  await changeWeight(page, FIRST).click();
  await editor.fill(CORRECTED);
  await section.getByRole('button', { name: BODYWEIGHT_COPY.saveLabel, exact: true }).click();
  await expect(loggedWeight(page, CORRECTED)).toBeVisible({ timeout: 15_000 });
  await expect(status).toHaveText(BODYWEIGHT_COPY.announcedChanged(shownWeight(CORRECTED)));
  await expect(changeWeight(page, CORRECTED)).toBeFocused();

  // ── Clear: the ✓ is named Clear while the field is empty, and the line says what happened ───────
  await changeWeight(page, CORRECTED).click();
  await expect(section.getByText(BODYWEIGHT_COPY.clearHint, { exact: true })).toBeVisible();
  await editor.fill('');
  await section.getByRole('button', { name: BODYWEIGHT_COPY.clearLabel, exact: true }).click();
  await expect(status).toHaveText(BODYWEIGHT_COPY.announcedCleared(shownWeight(CORRECTED)), {
    timeout: 15_000,
  });
  await expect(status).toBeVisible();
  await expect(field).toBeFocused();
  // The field returns, empty, with "Last time" still yesterday's: a cleared row is no hint.
  await expect(field).toHaveValue('');
  await expect(loggedWeight(page, CORRECTED)).toHaveCount(0);

  // ── Re-enter: a fresh client id, so the cleared row's is never replayed ─────────────────────
  const AGAIN = '72';
  await logBodyweight(page, AGAIN);
  await expect(status).toHaveText(BODYWEIGHT_COPY.announcedLogged);
  // A fresh server render agrees: the writes reached the rows, not only the client.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(loggedWeight(page, AGAIN)).toBeVisible();

  // ── Yesterday: clear it, and its re-entry shows no hint (nothing before it) ────────────────
  await page.goto(`${route}?d=${isoDaysAgo(1)}`, { waitUntil: 'networkidle' });
  await clearFrom(page, YESTERDAY);
  await expect(field).toBeFocused();
  await expect(section.getByText(new RegExp(`^${LAST_TIME_PREFIX}`))).toHaveCount(0);
});

async function clearFrom(page: Page, value: string): Promise<void> {
  const section = bodyweightSection(page);
  await changeWeight(page, value).click();
  await section
    .getByLabel(AMEND_COPY.valueLabel(DEFAULT_BODYWEIGHT_UNIT), { exact: true })
    .fill('');
  await section.getByRole('button', { name: BODYWEIGHT_COPY.clearLabel, exact: true }).click();
  await expect(section.getByLabel('Weight', { exact: true })).toBeVisible({ timeout: 15_000 });
}
