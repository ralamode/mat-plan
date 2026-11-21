import { SEED_PROFILE_2_PUBLIC_ID } from '@mat-plan/shared';
import { expect, test } from '@playwright/test';

import { athleteExportPath } from '../lib/constants';

import { APP_ORIGIN, SIGNED_OUT_ORIGIN } from '../playwright.config';
import { SEED_PROFILE_2_ROUTE } from './steps';

/**
 * The CSV export, end to end (V1-13b).
 *
 * The formatters have golden vectors and the reads have `db:verify` proofs; this is the only thing
 * that exercises **the whole chain** — session → route → ownership → reads → fold → CSV → zip → a real
 * file arriving in a browser. It is the MVP's defining feature, so it gets a real download rather
 * than a status-code check.
 */
test('an athlete’s CSV tree downloads as a zip', async ({ page }) => {
  // ⚠️ Athlete Two, deterministically: the link renders only for an athlete with history, and the
  // warm-up's weigh-in (`global.setup.ts`) is the one row guaranteed to exist before any spec runs.
  // Athlete One had history here only because the check-ins warm-up wrote to them, and that warm-up
  // left with the Check-ins form (V1-24 3b-page).
  await page.goto(SEED_PROFILE_2_ROUTE, { waitUntil: 'networkidle' });

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

/**
 * 🔴 **Proof 3: the export answers a member and refuses a stranger** (`docs/plans/td-signed-out-e2e.md`).
 * The successor to "the export is gated", deleted at AUTH-1 1d because the bypassed harness could not
 * be a stranger.
 *
 * - **The same URL, both servers.** Athlete Two's export gets 200 with a zip on the bypassed origin,
 *   then 404 on the signed-out one.
 * - **A real id, not a fresh one:** a fresh id answers 404 to a member too, so it could not fail.
 * - **What it claims, and no more:** a stranger gets 404 where a member gets 200. Deleting the
 *   handler's own session line would still answer 404, because the DAL's household scope refuses as
 *   well; that line is unit-proved (`app/p/[profileId]/export/route.test.ts`).
 *
 * Athlete Two, as above: the warm-up's weigh-in is the history that makes the export non-empty.
 *
 * ✅ **Probed RED** (`e2e:local`, 2026-11-21): with the second server armed (its `''` dropped), the
 * stranger got the export.
 */
test('the export answers a member, and refuses a stranger the same URL', async ({
  request,
  playwright,
}) => {
  const path = athleteExportPath(SEED_PROFILE_2_PUBLIC_ID);
  const member = await request.get(`${APP_ORIGIN}${path}`, { maxRedirects: 0 });
  expect(member.status(), 'the control: a member gets the export').toBe(200);
  expect(member.headers()['content-type']).toContain('zip');

  // Its own context: cookies on `localhost` ignore the port, so the member's jar must not ride along.
  const strangerCtx = await playwright.request.newContext();
  const stranger = await strangerCtx.get(`${SIGNED_OUT_ORIGIN}${path}`, { maxRedirects: 0 });
  expect(stranger.status(), 'a stranger gets the export').toBe(404);
  expect(stranger.headers()['content-type'] ?? '', 'a stranger gets a zip').not.toContain('zip');
  await strangerCtx.dispose();
});

// ⚠️ This route lives under `/p/` and not `/api/` because the matcher excluded `/api` when V1-13b
// sited it. That exclusion is gone (AUTH-1 1a), so the siting is history, not protection.
