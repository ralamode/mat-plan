import { expect, test } from '@playwright/test';

// The one V0-11 smoke: the full happy path UI → Server Action → Drizzle →
// Postgres → RSC re-render, against an ephemeral migrated+seeded DB. Uses the
// gate-authenticated storageState from global.setup.ts, so it lands on Today
// already past the access gate.
//
// Deterministic because the seed inserts exactly one profile and zero entries,
// and Today is scoped to the current UTC day — so the logged row is the only
// bodyweight entry on the page.
test('logs a bodyweight and renders it in Today', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Log bodyweight' })).toBeVisible();

  // `exact` disambiguates from the "Log bodyweight" section label and the
  // strength form's "Set 1 weight" input (getByLabel is substring by default).
  await page.getByLabel('Weight', { exact: true }).fill('72.5');
  // Unit defaults to 'lb' (DEFAULT_BODYWEIGHT_UNIT); leave it.
  await page.getByRole('button', { name: 'Log weight' }).click();

  // `revalidatePath('/')` in the action re-renders the RSC, so the entry shows
  // without a manual reload. The string is exactly entryLabel()'s output.
  // Extra-generous timeout: this is the one assertion that awaits the whole
  // server round-trip, which is slowest on the cold first request in CI.
  await expect(page.getByText('Bodyweight — 72.5 lb')).toBeVisible({ timeout: 15_000 });
});
