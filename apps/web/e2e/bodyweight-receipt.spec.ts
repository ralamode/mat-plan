import { expect, test } from '@playwright/test';

import { BODYWEIGHT_COPY, changeLabel } from '../lib/constants';
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
test('a logged day shows its weight and the one-per-day reason — and no create form', async ({
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

  // ⚠️ And no CREATE form. This is the half that actually stops the second submit; a receipt
  // rendered ABOVE a still-present input would look finished and still take one.
  await expect(section.getByLabel('Weight', { exact: true })).toHaveCount(0);
  await expect(section.getByRole('button', { name: /Log weight/ })).toHaveCount(0);
  // The ONE button here is the amend (V1-24 PR 1b), named with its value.
  await expect(
    section.getByRole('button', {
      name: changeLabel('weight', shownWeight(WARMUP_BODYWEIGHT)),
    }),
  ).toBeVisible();

  // Opening a day that already has a weight is not a save: the status region stays silent.
  await expect(section.getByRole('status')).toBeEmpty();

  // ── V1-24 PR 1b: and now correct it ──────────────────────────────────────────────────────────
  // Folded into THIS test rather than given its own, because all four e2e-reachable profile-days
  // are already claimed (Liam's today by the smoke, his yesterday by the export round-trip,
  // Scarlett's yesterday by the a11y empty-form fixture) and `logBodyweight` asserts the value it
  // was ASKED to log — so a fifth claimant on any of them fails by design. This test already owns
  // Scarlett's today, and "the receipt shows the value, and it can be corrected" is one narrative.
  const change = section.getByRole('button', {
    name: changeLabel('weight', shownWeight(WARMUP_BODYWEIGHT)),
  });
  await change.click();

  const field = section.getByLabel('Weight', { exact: true });
  await expect(field).toBeVisible();
  // Prefilled with what is saved — the athlete corrects a digit, they do not retype the number.
  expect(await field.inputValue()).toBe(WARMUP_BODYWEIGHT);

  // ⚠️ Cancel must not leave the abandoned value behind. Type, back out, reopen: the field has to
  // show what is SAVED, not the number that was explicitly discarded — which would otherwise sit
  // one tap from Save.
  await field.fill('999');
  await section.getByRole('button', { name: 'Cancel' }).click();
  await change.click();
  expect(await field.inputValue()).toBe(WARMUP_BODYWEIGHT);

  const corrected = '66.4';
  await field.fill(corrected);
  await section.getByRole('button', { name: 'Save' }).click();

  // The receipt shows the correction, and the editor is gone.
  await expect(
    section.getByText(BODYWEIGHT_COPY.saved(shownWeight(corrected)), { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(section.getByLabel('Weight', { exact: true })).toHaveCount(0);

  // ⚠️ Acceptance 6, for an AMEND. The announcer fired only on none→value before 1b, so a
  // correction announced NOTHING and focus fell to <body> — indistinguishable from failure for a
  // screen-reader user, which is the exact defect this announcer exists to fix.
  await expect(section.getByRole('status')).toHaveText(
    BODYWEIGHT_COPY.announced(shownWeight(corrected)),
  );
  expect(await page.evaluate(() => document.activeElement?.tagName.toLowerCase())).not.toBe('body');

  // And the day's entries list agrees — the amend reached the ROW, not just the receipt.
  await expect(page.getByText(bodyweightEntryLine(corrected))).toBeVisible();
});
