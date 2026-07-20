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

  await page.getByLabel('Weight').fill('72.5');
  // Unit defaults to 'lb' (DEFAULT_BODYWEIGHT_UNIT); leave it.
  await page.getByRole('button', { name: 'Log weight' }).click();

  // `revalidatePath('/')` in the action re-renders the RSC, so the entry shows
  // without a manual reload. The string is exactly entryLabel()'s output.
  await expect(page.getByText('Bodyweight — 72.5 lb')).toBeVisible();
});
