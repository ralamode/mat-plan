import { expect, test } from '@playwright/test';

import { SEED_PROFILE_ROUTE } from './steps';

/**
 * The CSV export, end to end (V1-13b).
 *
 * The formatters have golden vectors and the reads have `db:verify` proofs; this is the only thing
 * that exercises **the whole chain** — session → route → ownership → reads → fold → CSV → zip → a real
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

// 🔴 **DELETED at AUTH-1 1d: "the export is gated — a request without the access cookie gets
// nothing". It was not weakened, it was removed, because its assertion became FALSE.**
//
// It opened a fresh browser context (an empty cookie jar) and asserted the export did not return
// 200. The empty jar was the whole mechanism: with no `mp_gate` cookie the proxy bounced the
// request. After `1d` there is no cookie and no bounce, and the harness arms a principal in the
// PROCESS ENVIRONMENT (`E2E_SESSION_BYPASS_USER_ID`) that no browser context can drop — so the
// request is fully authenticated and the export correctly returns 200 with a real zip. Observed, not
// reasoned: this test went red in `e2e:local` on exactly that.
//
// ⚠️ **Rewriting it to accept 200 would have inverted its own subject**, and leaving a weakened
// version would have been a test named for a property it no longer examines. What it claimed is
// still true and still proved — by the handler's unit-level session check and by
// `app/pages-need-a-session.test.ts`'s per-handler source guard. What is GONE is the runtime proof, and
// that loss is recorded in `docs/tech-debt.md` ("Two runtime auth proofs went with the gate"),
// together with the un-bypassed second server that would restore it.
//
// ⚠️ This route lives under `/p/` and not `/api/` because the matcher excluded `/api` when V1-13b
// sited it. That exclusion is gone (AUTH-1 1a), so the siting is history, not protection.
