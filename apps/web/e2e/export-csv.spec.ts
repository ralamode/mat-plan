import { expect, test } from '@playwright/test';

import { SEED_PROFILE_ROUTE } from './steps';

/**
 * The CSV export, end to end (V1-13b).
 *
 * The formatters have golden vectors and the reads have `db:verify` proofs; this is the only thing
 * that exercises **the whole chain** — gate → route → ownership → reads → fold → CSV → zip → a real
 * file arriving in a browser. It is the MVP's defining feature, so it gets a real download rather
 * than a status-code check.
 */
test('an athlete’s CSV tree downloads as a zip', async ({ page }) => {
  await page.goto(SEED_PROFILE_ROUTE, { waitUntil: 'networkidle' });

  const link = page.getByRole('link', { name: /Export CSV/i });
  await expect(link).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);

  // Named by public_id, matching the directory inside — two athletes' exports never collide in a
  // downloads folder.
  expect(download.suggestedFilename()).toMatch(/^mat-plan-[0-9a-f-]{36}\.zip$/);

  const path = await download.path();
  expect(path).toBeTruthy();
});

test('the export refuses an unknown profile, and says nothing about it', async ({ page }) => {
  // 404 rather than 401/403: an unknown id must not reveal whether that profile exists.
  const res = await page.request.get('/p/019826b4-0000-7000-8000-0000000fffff/export');
  expect(res.status()).toBe(404);
});

test('the export is gated — a request without the access cookie gets nothing', async ({
  browser,
}) => {
  // ⚠️ This route lives under /p/ and not /api/ because the matcher EXCLUDED `/api` when V1-13b
  // sited it. That exclusion is gone (AUTH-1 1a), so the siting is history, not protection — what
  // protects the handler is its own in-process **session** check (the gate conjunct went at 1d).
  // 🔴 **The fresh context is now theatre, and saying so is the point.** It exists to stop the
  // project's `storageState` leaking in — and after `1d` there IS no authenticated storage state:
  // the harness arms a principal in the process env, which no browser context can drop. So this
  // request is NOT unauthenticated, and the assertion below is correspondingly weak. Kept because
  // it still catches a 200-with-a-zip from an unexpected shape; the real unauth proof is the unit
  // test. An honest runtime proof needs a second, un-bypassed server — `docs/tech-debt.md`.
  const context = await browser.newContext();
  const res = await context.request.get(`${SEED_PROFILE_ROUTE}/export`, {
    maxRedirects: 0,
  });
  // ⚠️ Before `1d` either arm was correct: the proxy redirected to the gate, or the handler 404'd.
  // There is no redirect any more, so a pass here means the handler itself refused — or, under the
  // bypass, that something else went wrong. What must never happen is a 200 with a zip body.
  expect(res.status()).not.toBe(200);
  await context.close();
});
