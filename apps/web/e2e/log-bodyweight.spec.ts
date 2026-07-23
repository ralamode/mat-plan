import { expect, test } from '@playwright/test';

import { logBodyweight, logCheckins, selectProfile } from './steps';

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

  // V1-5: the kind-NULL write path (a bare habit + a rated metric), on the same warm
  // session — no second cold flow, so the slow tier stays cheap.
  await logCheckins(page, { habit: 'Rice bucket', rating: { label: 'Pressure', value: '7' } });
});

// V1-3: an unknown profile id renders the not-found UI (the scoped Today
// re-validates the URL id server-side — tiles are a UX switch, not a security
// boundary). The app is force-dynamic (nonce CSP), so Next streams a 200 header
// before notFound() throws — so assert the rendered not-found content, not the
// HTTP status.
test('an unknown profile id renders not-found', async ({ page }) => {
  await page.goto('/p/does-not-exist');
  await expect(page.getByText(/this page could not be found/i)).toBeVisible();
  // never leaks a scoped Today for a bogus id
  await expect(page.getByRole('heading', { name: 'Log bodyweight' })).toHaveCount(0);
});
