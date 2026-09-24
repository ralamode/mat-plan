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
  // ⚠️ THE reason this route lives under /p/ and not /api/: the gate matcher excludes `/api`, so a
  // handler there would be completely ungated. This asserts the gate actually covers it — with a
  // fresh context, so none of the project's storageState leaks in.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const res = await context.request.get(`${SEED_PROFILE_ROUTE}/export`, {
    maxRedirects: 0,
  });
  // Either the middleware redirects to the gate, or the handler's own check 404s. Both are correct;
  // what must never happen is a 200 with a zip body.
  expect(res.status()).not.toBe(200);
  await context.close();
});
