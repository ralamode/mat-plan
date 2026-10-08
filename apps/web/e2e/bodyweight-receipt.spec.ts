import { expect, test } from '@playwright/test';

import { AMEND_COPY, BODYWEIGHT_COPY, changeLabel } from '../lib/constants';
import {
  bodyweightEntryLine,
  bodyweightSection,
  SEED_PROFILE_2_ROUTE,
  shownWeight,
  WARMUP_BODYWEIGHT,
} from './steps';

/**
 * **V1-24 PR 1a — the day's weight is the day's state.**
 *
 * The weigh-in surface renders a RECEIPT once the day has a weight, instead of an empty input over
 * an existing record. That removes the second-submit path (`logBodyweight` dedupes only on
 * `client_id`, and the form used to mint a fresh key on every success); concurrent mounts can still
 * duplicate until PR 1d's index, which is why the receipt lists every row.
 *
 * Athlete Two's TODAY: `global.setup.ts` logs `WARMUP_BODYWEIGHT` there before any spec runs, and THIS
 * test is the only one that writes to it, by amending it (PR 1b). A retry reuses the DB, so it reads
 * which of the two values is showing and corrects to the other one.
 *
 * Covered elsewhere, deliberately: the empty → receipt transition and its focus assertion
 * (`steps.ts:logBodyweight`, driven by the smoke, the export spec and the a11y spec), the receipt on
 * a non-today day (`a11y.spec.ts`, Athlete Two's yesterday), and every copy state including duplicates
 * and a closed day (`bodyweight-section.test.tsx`). A CLOSED day is unreachable here: the e2e seeds
 * profiles today, so `resolveViewedDay` floors any `?d=` into the writable range
 * (`day-navigation.spec.ts` documents the same limit).
 */
test('a logged day shows its weight and the one-per-day reason — and no create form', async ({
  page,
}) => {
  await page.goto(SEED_PROFILE_2_ROUTE, { waitUntil: 'networkidle' });

  const section = bodyweightSection(page);
  await expect(section).toBeVisible();

  // Retry-safe: a first attempt may already have amended WARMUP → CORRECTED on this shared DB, so
  // read which one is saved and correct to the other.
  const CORRECTED = '66.4';
  const amendedAlready =
    (await section
      .getByText(BODYWEIGHT_COPY.saved(shownWeight(CORRECTED)), { exact: true })
      .count()) > 0;
  const before = amendedAlready ? CORRECTED : WARMUP_BODYWEIGHT;
  const after = amendedAlready ? WARMUP_BODYWEIGHT : CORRECTED;

  // The value, where the input used to be — the value IS the completeness signal, not a checkmark.
  await expect(
    section.getByText(BODYWEIGHT_COPY.saved(shownWeight(before)), { exact: true }),
  ).toBeVisible();
  await expect(section.getByText(BODYWEIGHT_COPY.onePerDay, { exact: true })).toBeVisible();

  // ⚠️ And no CREATE form. This is the half that actually stops the second submit; a receipt
  // rendered ABOVE a still-present input would look finished and still take one.
  await expect(section.getByLabel('Weight', { exact: true })).toHaveCount(0);
  await expect(section.getByRole('button', { name: /Log weight/ })).toHaveCount(0);
  // The ONE button here is the amend (V1-24 PR 1b), named with its value.
  const change = section.getByRole('button', {
    name: changeLabel('weight', shownWeight(before)),
  });
  await expect(change).toBeVisible();

  // Opening a day that already has a weight is not a save: every status region stays silent (the
  // create announcer and the amend's own).
  for (const region of await section.getByRole('status').all()) await expect(region).toBeEmpty();

  // ── V1-24 PR 1b: and now correct it ──────────────────────────────────────────────────────────
  // Folded into THIS test rather than given its own, because all four e2e-reachable profile-days
  // are already claimed (Athlete One's today by the smoke, their yesterday by the export round-trip,
  // Athlete Two's yesterday by the a11y empty-form fixture).
  await change.click();

  const field = section.getByLabel(AMEND_COPY.valueLabel('lb'), { exact: true });
  await expect(field).toBeVisible();
  // Prefilled with what is saved — the athlete corrects a digit, they do not retype the number.
  expect(await field.inputValue()).toBe(before);

  // ⚠️ Cancel must not leave the abandoned value behind, and must not drop focus to <body>: the
  // Cancel button unmounts, so focus goes back to the control that opened the editor.
  await field.fill('999');
  await section.getByRole('button', { name: AMEND_COPY.cancel }).click();
  await expect(change).toBeFocused();
  await change.click();
  expect(await field.inputValue()).toBe(before);

  await field.fill(after);
  await section.getByRole('button', { name: AMEND_COPY.save }).click();

  // The receipt shows the correction, and the editor is gone.
  await expect(
    section.getByText(BODYWEIGHT_COPY.saved(shownWeight(after)), { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(field).toHaveCount(0);

  // ⚠️ Acceptance 6, for an AMEND: announced from the action's own success, and focus lands on the
  // receipt rather than <body>.
  await expect(
    section.getByRole('status').filter({ hasText: BODYWEIGHT_COPY.announced(shownWeight(after)) }),
  ).toHaveCount(1);
  expect(await page.evaluate(() => document.activeElement?.tagName.toLowerCase())).not.toBe('body');

  // And the day's entries list agrees — the amend reached the ROW, not just the receipt.
  await expect(page.getByText(bodyweightEntryLine(after))).toBeVisible();
});
