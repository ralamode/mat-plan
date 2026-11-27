import {
  PRACTICE_MINUTES_MAX,
  PRACTICE_MINUTES_MIN,
  PRACTICE_UNIT,
  SEED_PROFILE_NAME,
} from '@mat-plan/shared';
import { expect, test } from '@playwright/test';

import {
  ALL_ATHLETES_LINK,
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
  bodyweightSection,
  clearAnyPractice,
  clearPractice,
  lifeSection,
  logBodyweight,
  logPractice,
  practiceLogField,
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
  // The region, by its bare name: folded (a retry that finds the weight logged), the heading holds the
  // line and is named "Bodyweight, 72.5 lb" (FAM-1 12c-iii).
  await expect(bodyweightSection(page)).toBeVisible();
  // V1-24 3b-life-b B3: the bodyweight ✓ fills while a typed weight waits to be sent.
  const weightField = bodyweightSection(page).getByLabel('Weight', { exact: true });
  if ((await weightField.count()) > 0) {
    const weightTick = bodyweightSection(page).getByRole('button', {
      name: BODYWEIGHT_COPY.logLabel,
      exact: true,
    });
    await expect(weightTick).not.toHaveAttribute('data-ready');
    await weightField.fill('72.5');
    await expect(weightTick).toHaveAttribute('data-ready', 'true');
  }
  await logBodyweight(page, '72.5');

  // V1-24 3b-life-b: practice is typed minutes. At 360px the unlogged row is ONE line, with the label
  // on one line and a ≥44px ✓; a number that reads as hours is refused in the browser (no request);
  // the ✓ fills once a value waits; then the logged row shows the minutes. A retry on the reused DB
  // finds the practice logged: clear it first, so these checks always run.
  await page.setViewportSize({ width: 360, height: 800 });
  const minutesField = practiceLogField(page);
  await clearAnyPractice(page);
  const logTick = lifeSection(page).getByRole('button', {
    name: PRACTICE_COPY.logLabel,
    exact: true,
  });
  const [fieldBox, tickBox] = await Promise.all([
    minutesField.boundingBox(),
    logTick.boundingBox(),
  ]);
  // The label's VISIBLE words (its first text node; the box itself is stretched to 44px as a tap
  // target) lay out on ONE line, and end before the field starts.
  const words = await lifeSection(page)
    .locator('label', { hasText: PRACTICE_COPY.label })
    .evaluate((label) => {
      const range = document.createRange();
      range.selectNodeContents(label.firstChild!);
      const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
      return { lines: lines.size, right: range.getBoundingClientRect().right };
    });
  expect(words.lines).toBe(1);
  expect(words.right).toBeLessThanOrEqual(fieldBox!.x);
  expect(tickBox!.width).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
  expect(tickBox!.height).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await expect(logTick).not.toHaveAttribute('data-ready');
  await minutesField.fill('5');
  await expect(logTick).toHaveAttribute('data-ready', 'true');
  await logTick.click();
  await expect(lifeSection(page).getByRole('alert')).toHaveText(PRACTICE_COPY.hoursNotMinutes('5'));
  await expect(minutesField).toBeFocused();
  await expectNoAxeViolations(page, 'the practice row with an hours-shaped value refused');
  await logPractice(page);

  // V1-24 3b-life-a: Change it to the largest legal value (the longest minutes line; the label is the
  // row's widest line either way), check the row at 360px, refuse an out-of-range value, clear it (the ✓
  // named Clear), then the minutes are typed and logged again, so the day ends as it began. Athlete One's today is
  // this spec's alone (the e2e rule, `global.setup.ts`).
  await changePractice(page, PRACTICE_SHOWN, String(PRACTICE_MINUTES_MAX));
  const life = lifeSection(page);
  const shownWidest = formatValueUnit(PRACTICE_MINUTES_MAX, PRACTICE_UNIT);
  const change = practiceChange(page, shownWidest);
  // Change sits on the RIGHT of the two-line row, clear of the label (the box it could collide with),
  // and vertically between the label's top and the minutes line's bottom (A1). Never wrapped under the
  // tick: a wrapped flex item starts the next line on the LEFT.
  const [lifeBox, changeBox, labelBox, valueBox] = await Promise.all([
    life.boundingBox(),
    change.boundingBox(),
    life.getByText(PRACTICE_COPY.label, { exact: true }).boundingBox(),
    life.getByText(shownWidest, { exact: true }).boundingBox(),
  ]);
  expect(lifeBox!.x + lifeBox!.width - (changeBox!.x + changeBox!.width)).toBeLessThan(24);
  expect(changeBox!.x).toBeGreaterThan(labelBox!.x + labelBox!.width);
  const changeMid = changeBox!.y + changeBox!.height / 2;
  expect(changeMid).toBeGreaterThan(labelBox!.y);
  expect(changeMid).toBeLessThan(valueBox!.y + valueBox!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  // The Change's re-render briefly drops the streamed <title> (~370 ms in #830's trace; tech-debt.md).
  await expect(page, 'the page has its title back after the Change').not.toHaveTitle('');
  await expectNoAxeViolations(page, 'the logged practice row at 360px');
  await expectTapTargets(page, 'the logged practice row at 360px');

  // A refused value: its line under the field, focus back on the field (A4), and axe on that state.
  await change.click();
  const editorField = life.getByLabel(PRACTICE_COPY.fieldLabel, { exact: true });
  await editorField.fill(String(PRACTICE_MINUTES_MIN - 1));
  await life.getByRole('button', { name: PRACTICE_COPY.saveLabel, exact: true }).click();
  await expect(life.getByRole('alert')).toHaveText(PRACTICE_COPY.outOfRange);
  await expect(editorField).toBeFocused();
  await expectNoAxeViolations(page, 'the practice editor with a refused value');
  // The ✓ and ✕ share the field's line at 360px beside `min` (wider than `lb`), each 44px wide.
  const editorBox = (await editorField.boundingBox())!;
  for (const name of [PRACTICE_COPY.saveLabel, PRACTICE_COPY.cancelLabel]) {
    const box = (await life.getByRole('button', { name, exact: true }).boundingBox())!;
    expect(box.width, `${name} is at least 44px wide`).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
    expect(
      Math.abs(editorBox.y + editorBox.height / 2 - (box.y + box.height / 2)),
      `${name} sits on the field's line at 360px`,
    ).toBeLessThanOrEqual(2);
  }

  // The armed Clear, on the editor's plain surface.
  await editorField.fill('');
  await expect(
    life.getByRole('button', { name: PRACTICE_COPY.clearLabel, exact: true }),
  ).toBeVisible();
  // Scan it settled, not mid-transition (`transition-all`), as the bodyweight scan does.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  await expectNoAxeViolations(page, 'the practice editor with Clear armed');
  await life.getByRole('button', { name: PRACTICE_COPY.cancelLabel, exact: true }).click();

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
  await expect(bodyweightSection(page)).toHaveCount(0);
  expect(cspErrors, 'the not-found page renders without a CSP violation').toEqual([]);
  // The page's one way out, measured here because the a11y scan excludes links.
  const cta = await page.getByRole('link', { name: ALL_ATHLETES_LINK, exact: true }).boundingBox();
  expect(cta?.height ?? 0, 'the way back clears the tap bar').toBeGreaterThanOrEqual(
    MIN_TAP_TARGET_PX,
  );
});
