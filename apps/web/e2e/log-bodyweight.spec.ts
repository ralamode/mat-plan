import { SEED_PROFILE_NAME } from '@mat-plan/shared';
import { expect, test } from '@playwright/test';

import {
  ALL_ATHLETES_LINK,
  APP_HOME_PATH,
  BODYWEIGHT_COPY,
  DEFAULT_TIME_ZONE,
  MIN_TAP_TARGET_PX,
  NOT_FOUND_COPY,
} from '../lib/constants';
import { formatDayLong, localDayIso } from '../lib/date';

import { pickerHeading } from './contexts';
import { logBodyweight, logPractice, selectProfile } from './steps';

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
  await page.goto(APP_HOME_PATH);

  // V1-3: the app home is the profile picker. Tap a tile → land on the scoped Today.
  await expect(pickerHeading(page)).toBeVisible();
  await selectProfile(page, SEED_PROFILE_NAME);

  // V1-24 PR 1a: one heading in every state. Athlete One's TODAY is this spec's alone (the e2e rule — see
  // `global.setup.ts`), so this takes the CREATE path, including the focus-on-receipt assertion.
  await expect(
    page.getByRole('heading', { name: BODYWEIGHT_COPY.heading, exact: true }),
  ).toBeVisible();
  await logBodyweight(page, '72.5');

  // V1-7 / V1-24 3b-page: the one-tap wrestling practice, a duration metric with the default minutes.
  // The logged row shows those minutes on the page, where the removed "Logged entries" list did.
  await logPractice(page, { label: 'Wrestling practice', shownValue: '90 min' });
});

// V1-6c: the Today header shows the ACTIVE LOCAL calendar date (not UTC), and it's stable
// across a reload. The browser tz is pinned to DEFAULT_TIME_ZONE (playwright.config), and the
// server's first-paint default matches it, so the header weekday is the local day — derived
// here from the same helpers (never a hardcoded weekday, which would rot at the next DST edge).
test('the Today header shows the active local calendar date, stable across reload', async ({
  page,
}) => {
  await page.goto(APP_HOME_PATH);
  await selectProfile(page, SEED_PROFILE_NAME);

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
  // UI-6: the 404 must render under the production CSP. Next's built-in fallback styled itself with
  // inline `style` attributes and an un-nonced `<style>`, which `style-src 'nonce-…'` refuses, so
  // the page rendered without its layout and logged violations.
  const cspErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.text().includes('Content Security Policy')) cspErrors.push(msg.text());
  });
  await page.goto('/p/does-not-exist');
  await expect(
    page.getByRole('heading', { level: 1, name: NOT_FOUND_COPY.heading, exact: true }),
  ).toBeVisible();
  // never leaks a scoped Today for a bogus id
  await expect(
    page.getByRole('heading', { name: BODYWEIGHT_COPY.heading, exact: true }),
  ).toHaveCount(0);
  expect(cspErrors, 'the not-found page renders without a CSP violation').toEqual([]);
  // The page's one way out, measured here because the a11y scan excludes links.
  const cta = await page.getByRole('link', { name: ALL_ATHLETES_LINK, exact: true }).boundingBox();
  expect(cta?.height ?? 0, 'the way back clears the tap bar').toBeGreaterThanOrEqual(
    MIN_TAP_TARGET_PX,
  );
});
