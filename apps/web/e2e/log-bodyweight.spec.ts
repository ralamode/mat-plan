import { PRACTICE_MINUTES_MAX, SEED_PROFILE_NAME } from '@mat-plan/shared';
import { expect, test } from '@playwright/test';

import {
  ALL_ATHLETES_LINK,
  AMEND_COPY,
  APP_HOME_PATH,
  BODYWEIGHT_COPY,
  DEFAULT_TIME_ZONE,
  MIN_TAP_TARGET_PX,
  NOT_FOUND_COPY,
  PRACTICE_COPY,
} from '../lib/constants';
import { formatDayLong, localDayIso } from '../lib/date';
import { formatValueUnit } from '../lib/entries/format-value-unit';

import { pickerHeading } from './contexts';
import { expectNoAxeViolations, expectTapTargets } from './a11y-checks';
import {
  changePractice,
  clearPractice,
  lifeSection,
  logBodyweight,
  logPractice,
  PRACTICE_SHOWN,
  practiceChange,
  selectProfile,
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
  await logPractice(page);

  // V1-24 3b-life-a: Change it to the WIDEST legal value, so the 360px checks measure the row at its
  // longest; clear it (Save reads Clear); then the one-tap ✓ logs it again, so the day ends as it began.
  // Athlete One's today is this spec's alone (the e2e rule, `global.setup.ts`).
  await page.setViewportSize({ width: 360, height: 800 });
  const widest = String(PRACTICE_MINUTES_MAX);
  await changePractice(page, PRACTICE_SHOWN, widest);
  const life = lifeSection(page);
  const shownWidest = formatValueUnit(PRACTICE_MINUTES_MAX, 'min');
  const change = practiceChange(page, shownWidest);
  const row = life
    .getByText(shownWidest, { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');
  // Change sits on the RIGHT of the two-line row, beside the value, never wrapped under the tick (A1).
  const [rowBox, changeBox, valueBox] = await Promise.all([
    row.boundingBox(),
    change.boundingBox(),
    life.getByText(shownWidest, { exact: true }).boundingBox(),
  ]);
  expect(rowBox!.x + rowBox!.width - (changeBox!.x + changeBox!.width)).toBeLessThan(24);
  expect(changeBox!.x).toBeGreaterThan(valueBox!.x + valueBox!.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await expectNoAxeViolations(page, 'the logged practice row at 360px');
  await expectTapTargets(page, 'the logged practice row at 360px');

  // The armed Clear, on the editor's plain surface.
  await change.click();
  await life.getByLabel(PRACTICE_COPY.fieldLabel, { exact: true }).fill('');
  await expect(life.getByRole('button', { name: PRACTICE_COPY.clearLabel })).toBeVisible();
  // Save → Clear is a colour transition (`transition-all`): scan it settled, not mid-fade, as the
  // bodyweight scan does (`a11y.spec.ts`). Mid-fade the text briefly fails contrast.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  await expectNoAxeViolations(page, 'the practice editor with Clear armed');
  await life.getByRole('button', { name: AMEND_COPY.cancel, exact: true }).click();

  await clearPractice(page, shownWidest);
  await logPractice(page);
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
