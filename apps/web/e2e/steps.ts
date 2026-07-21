import { expect, type Page } from '@playwright/test';

/**
 * Log a bodyweight through the Today form and wait for it to render. Assumes the
 * page is already authenticated and on `/`. Shared by the smoke test and the
 * one-time warmup in global.setup.ts (DRY — same flow, one definition).
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
