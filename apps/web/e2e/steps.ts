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

/**
 * Log a check-in through the Today form and wait for it to render (V1-5). Covers the
 * kind-NULL write path end-to-end: a bare habit checkbox (neither source column) and a
 * rated brush-teeth metric, in one submit.
 *
 * `exact` matters here — `Shot` vs `Shots` and `Stance` vs the section copy are live
 * substring collisions (docs/lessons.md: substring matching bit us in V0-11).
 */
export async function logCheckins(
  page: Page,
  opts: { habit: string; rating: { label: string; value: string } },
): Promise<void> {
  const form = page.getByRole('region', { name: 'Check-ins' });
  const submit = page.getByRole('button', { name: 'Log check-ins' });
  const rating = form.getByRole('spinbutton', { name: new RegExp(`^${opts.rating.label}`) });

  // RETRY-SAFE. Playwright retries reuse the same ephemeral DB, and an already-logged
  // field renders readonly/aria-disabled by design — so a second attempt must assert the
  // end state rather than re-submit into an inert control (which just times out).
  if (await rating.isEditable()) {
    await form.getByRole('checkbox', { name: opts.habit, exact: true }).check();
    await rating.fill(opts.rating.value);
    await submit.click();

    // Synchronize on the submit completing. The button returning from "Logging…" is the
    // real signal: this action does several catalog reads plus a multi-row insert and a
    // full RSC revalidation, so it is slower than the single-row bodyweight write and
    // outruns the default 5s expect timeout on a cold CI worker.
    await expect(submit).toBeEnabled({ timeout: 15_000 });
  }

  // Scope assertions to the ENTRIES list, not the page. The habit's own <label> renders
  // its name inside the form, so an unscoped getByText('Rice bucket') passes even when
  // nothing was written — a false positive that masks a genuinely failed write.
  const logged = page.getByRole('region', { name: 'Logged entries' });
  await expect(logged.getByText(opts.habit, { exact: true })).toBeVisible();
  await expect(logged.getByText(`${opts.rating.label} — ${opts.rating.value}/10`)).toBeVisible();
}
