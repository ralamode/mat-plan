import { expect, test } from '@playwright/test';

import { DEFAULT_TIME_ZONE } from '../lib/constants';
import { formatDayLong, localDayIso } from '../lib/date';
import {
  logBodyweight,
  logCalisthenics,
  logCheckins,
  selectProfile,
  submitCheckins,
} from './steps';

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

  // V1-6a: the accumulating calisthenics path — log a count, assert the totals card.
  await logCalisthenics(page, { label: 'Push-ups', value: '20' });
});

// V1-6a: multi-submit correctness — the bugs the "duplicated data" screenshot surfaced.
// Uses SCARLETT (the smoke uses Liam) so this test has its own clean surface. Assertions are
// row COUNTS, not exact bout values, so a CI retry (which reuses the ephemeral DB and adds
// more bouts) stays green.
test('re-submitting check-ins never duplicates a logged habit; calisthenics bouts group into one row', async ({
  page,
}) => {
  await page.goto('/');
  await selectProfile(page, 'Scarlett');
  await expect(page.getByRole('heading', { name: 'Check-ins' })).toBeVisible();

  // Submit 1: a log-once habit + a first push-up bout.
  await submitCheckins(page, {
    checks: ['Rice bucket'],
    numbers: [{ label: 'Push-ups', value: '20' }],
  });
  // Submit 2: a second push-up bout. Rice bucket is now logged/inert and must NOT re-submit
  // (the V1-5 bug: an aria-disabled checkbox still submitted → a duplicate row every time).
  await submitCheckins(page, { numbers: [{ label: 'Push-ups', value: '30' }] });

  const logged = page.getByRole('region', { name: 'Logged entries' });
  // FIX #1: the habit logged once stays exactly ONE row across re-submits.
  await expect(logged.getByRole('listitem').filter({ hasText: 'Rice bucket' })).toHaveCount(1);
  // FIX #2: the two push-up bouts render as ONE grouped row, not two look-alike rows.
  const pushRow = logged.getByRole('listitem').filter({ hasText: 'Push-ups' });
  await expect(pushRow).toHaveCount(1);
  await expect(pushRow).toContainText(/sets/); // "2 sets · 50" (more on a retry — regex-tolerant)
});

// V1-6c: the Today header shows the ACTIVE LOCAL calendar date (not UTC), and it's stable
// across a reload. The browser tz is pinned to DEFAULT_TIME_ZONE (playwright.config), and the
// server's first-paint default matches it, so the header weekday is the local day — derived
// here from the same helpers (never a hardcoded weekday, which would rot at the next DST edge).
test('the Today header shows the active local calendar date, stable across reload', async ({
  page,
}) => {
  await page.goto('/');
  await selectProfile(page, 'Liam');

  const localDate = formatDayLong(localDayIso(DEFAULT_TIME_ZONE));
  await expect(page.getByText(localDate)).toBeVisible();

  // Reload: the tz cookie is stable → the same local day, no flip.
  await page.reload();
  await expect(page.getByText(localDate)).toBeVisible();
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
