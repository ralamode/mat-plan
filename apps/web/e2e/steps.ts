import { expect, type Page } from '@playwright/test';

/**
 * From the profile picker (`/`), tap a profile tile and land on its scoped Today
 * (`/p/[profileId]`). Asserts the scoped Today shows the profile's name as the
 * page heading. Shared by the smoke test and the one-time warmup (DRY).
 */
export async function selectProfile(page: Page, name: string): Promise<void> {
  await page.getByRole('link', { name: new RegExp(name) }).click();
  await page.waitForURL(/\/p\//);
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

/**
 * Log a bodyweight through the Today form and wait for it to render. Assumes the
 * page is already authenticated and on a profile-scoped Today (`/p/[profileId]`).
 * Shared by the smoke test and the one-time warmup in global.setup.ts (DRY — same
 * flow, one definition).
 *
 * `timeout` is only overridden for the cold warmup; the real coverage test uses
 * the default (fast, warm server) — we keep the cold-start cost out of the test.
 */
export async function logBodyweight(
  page: Page,
  value: string,
  opts?: { timeout?: number },
): Promise<void> {
  // exact: disambiguate from the "Log bodyweight" section + "Set 1 weight" input.
  await page.getByLabel('Weight', { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Log weight' }).click();
  await expect(page.getByText(`Bodyweight — ${value} lb`)).toBeVisible(opts);
}
