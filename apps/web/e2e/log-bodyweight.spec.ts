import { expect, test } from '@playwright/test';

import { logBodyweight, selectProfile } from './steps';

// The one V0-11 smoke: the full happy path UI → Server Action → Drizzle →
// Postgres → RSC re-render, against an ephemeral migrated+seeded DB. Uses the
// gate-authenticated storageState from global.setup.ts, so it lands on the picker
// already past the access gate. The server is also warmed by setup, so this runs
// fast under the default timeout — no padded timeout masking a cold start.
//
// This is deliberately the ONLY e2e for the flow: the write's correctness
// (idempotency, zod, ownership) is covered by fast Vitest integration tests.
// E2E is the slow tier — keep it to critical wiring smokes only.
test('picks a profile then logs a bodyweight in its scoped Today', async ({ page }) => {
  await page.goto('/');

  // V1-3: `/` is the profile picker. Tap a tile → land on the scoped Today.
  await expect(page.getByRole('heading', { name: /Who.s logging today/, level: 1 })).toBeVisible();
  await selectProfile(page, 'Liam');

  await expect(page.getByRole('heading', { name: 'Log bodyweight' })).toBeVisible();
  await logBodyweight(page, '72.5');
});

// V1-3: an unknown profile id is a 404 (the scoped Today re-validates the URL id
// server-side — tiles are a UX switch, not a security boundary).
test('an unknown profile id renders not-found', async ({ page }) => {
  const res = await page.goto('/p/does-not-exist');
  expect(res?.status()).toBe(404);
});
