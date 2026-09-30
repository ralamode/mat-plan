import { expect, test } from '@playwright/test';

import { isoDaysAgo, SEED_PROFILE_2_ROUTE } from './steps';

/**
 * **V1-24 PR 1a — the day's weight is the day's state.**
 *
 * The weigh-in surface renders a RECEIPT once the day has a weight, instead of an empty input over
 * an existing record. Two things make that more than cosmetic:
 *
 * 1. **It closes the duplicate-row defect.** `logBodyweight` dedupes only on `client_id`, and the
 *    form used to reset itself and mint a FRESH key on every success — so "did I already weigh in?"
 *    → tap again → a second row for the day, with no edit or delete anywhere to remove it.
 * 2. **It is READ state.** `BodyweightForm` is mounted only inside the ±1 day write window, so a
 *    receipt rendered from inside it would be invisible on exactly the history days V1-15 shipped.
 *    That is the screen this was reported from (2026-09-30), and it is why `page.tsx` renders the
 *    receipt OUTSIDE the `writable` gate.
 *
 * Scarlett, not Liam: `global.setup.ts` warms the bodyweight write path on her profile, so her today
 * reliably has a weigh-in before any spec runs — and Liam's day is left clean for
 * `log-bodyweight.spec.ts`'s create path.
 */
test('a logged day shows its weight instead of an empty form', async ({ page }) => {
  await page.goto(SEED_PROFILE_2_ROUTE, { waitUntil: 'networkidle' });

  const section = page.getByRole('region', { name: 'Bodyweight' });
  await expect(section).toBeVisible();

  // The value, where the input used to be. THE assertion: a receipt, not a checkmark — "complete"
  // means saved, and the value IS the completeness signal.
  await expect(section.getByText(/^[\d.]+ lb$/)).toBeVisible();

  // ⚠️ And no create form. This is the half that actually stops the duplicate write; a receipt
  // rendered ABOVE a still-present input would look finished and still take a second submit.
  await expect(section.getByLabel('Weight', { exact: true })).toHaveCount(0);
  await expect(section.getByRole('button', { name: 'Log weight' })).toHaveCount(0);

  // It says plainly that it cannot be corrected yet, rather than implying finality. PR 1b ships the
  // amend and deletes this line — if it still renders after 1b, that is the bug.
  await expect(section.getByText(/Changing a logged weight is coming next/)).toBeVisible();
});

test('a day with no weight still offers the form, and the receipt does not leak across days', async ({
  page,
}) => {
  // Yesterday is inside the ±1 write window and has no weigh-in, so the same profile that shows a
  // receipt on today must show the form here. This is what proves the receipt is derived from the
  // VIEWED day's entries rather than from "this profile has ever logged".
  await page.goto(`${SEED_PROFILE_2_ROUTE}?d=${isoDaysAgo(1)}`, { waitUntil: 'networkidle' });

  const section = page.getByRole('region', { name: 'Log bodyweight' });
  await expect(section.getByLabel('Weight', { exact: true })).toBeVisible();
  await expect(section.getByRole('button', { name: 'Log weight' })).toBeVisible();
});

/**
 * ⚠️ **Not covered here, deliberately, and stated rather than left as a silent gap.** The
 * `Logging is closed for this day` branch needs a profile OLDER than the ±1 write window, and the
 * e2e seeds profiles TODAY — so `resolveViewedDay` floors any `?d=` back into the writable range and
 * that state is unreachable. `day-navigation.spec.ts` documents the identical limitation for its own
 * closed-day notice. Closing it needs a backdated fixture profile.
 */
