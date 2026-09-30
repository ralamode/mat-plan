import { expect, test } from '@playwright/test';

import { BODYWEIGHT_COPY } from '../lib/constants';
import { bodyweightSection, SEED_PROFILE_2_ROUTE, shownWeight, WARMUP_BODYWEIGHT } from './steps';

/**
 * **V1-24 PR 1a — the day's weight is the day's state.**
 *
 * The weigh-in surface renders a RECEIPT once the day has a weight, instead of an empty input over
 * an existing record. That removes the second-submit path (`logBodyweight` dedupes only on
 * `client_id`, and the form used to mint a fresh key on every success); concurrent mounts can still
 * duplicate until PR 1d's index, which is why the receipt lists every row.
 *
 * Scarlett's TODAY, read-only: `global.setup.ts` logs `WARMUP_BODYWEIGHT` there before any spec runs,
 * and no spec writes to it (the e2e rule — see `global.setup.ts`), so the exact value is deterministic.
 *
 * Covered elsewhere, deliberately: the empty → receipt transition and its focus assertion
 * (`steps.ts:logBodyweight`, driven by the smoke, the export spec and the a11y spec), the receipt on
 * a non-today day (`a11y.spec.ts`, Scarlett's yesterday), and every copy state including duplicates
 * and a closed day (`bodyweight-section.test.tsx`). A CLOSED day is unreachable here: the e2e seeds
 * profiles today, so `resolveViewedDay` floors any `?d=` into the writable range
 * (`day-navigation.spec.ts` documents the same limit).
 */
test('a logged day shows its weight, the one-per-day reason and the recovery path — and no form', async ({
  page,
}) => {
  await page.goto(SEED_PROFILE_2_ROUTE, { waitUntil: 'networkidle' });

  const section = bodyweightSection(page);
  await expect(section).toBeVisible();

  // The value, where the input used to be — the value IS the completeness signal, not a checkmark.
  await expect(
    section.getByText(BODYWEIGHT_COPY.saved(shownWeight(WARMUP_BODYWEIGHT)), { exact: true }),
  ).toBeVisible();
  await expect(section.getByText(BODYWEIGHT_COPY.onePerDay, { exact: true })).toBeVisible();
  await expect(section.getByText(BODYWEIGHT_COPY.recovery, { exact: true })).toBeVisible();

  // ⚠️ And no create form. This is the half that actually stops the second submit; a receipt rendered
  // ABOVE a still-present input would look finished and still take one.
  await expect(section.getByLabel('Weight', { exact: true })).toHaveCount(0);
  await expect(section.getByRole('button')).toHaveCount(0);

  // Opening a day that already has a weight is not a save: the status region stays silent.
  await expect(section.getByRole('status')).toBeEmpty();
});
