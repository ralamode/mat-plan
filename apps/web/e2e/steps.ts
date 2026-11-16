import { SEED_PROFILE_2_PUBLIC_ID, SEED_PROFILE_PUBLIC_ID } from '@mat-plan/db';
import { ACTIVITY_TYPE_KEYS, addDays, DEFAULT_BODYWEIGHT_UNIT } from '@mat-plan/shared';
import { expect, type Page } from '@playwright/test';

import {
  BODYWEIGHT_COPY,
  changeLabel,
  DEFAULT_TIME_ZONE,
  LIFE_COPY,
  PRACTICE_COPY,
} from '../lib/constants';
import { localDayIso } from '../lib/date';
import { formatValueUnit } from '../lib/entries/format-value-unit';
import { DEFAULT_PRACTICE_MINUTES, LIFE_ACTIVITIES } from '../lib/life/life-activities';

/**
 * The seeded profile's Today route. Single-sourced here (V1-12) because three callers need it — the
 * smoke, the a11y spec, and the screenshot script — and it is derived from the seed's stable public id
 * rather than a re-typed UUID (AGENTS.md constants rule).
 */
export const SEED_PROFILE_ROUTE = `/p/${SEED_PROFILE_PUBLIC_ID}`;

/**
 * The SECOND seeded profile's Today (Athlete Two). `global.setup.ts` warms the bodyweight write path on
 * their TODAY, so that day always holds `WARMUP_BODYWEIGHT` by the time any spec runs — the one
 * deterministic fixture for the "already logged" read state (V1-24 PR 1a). Her YESTERDAY belongs to
 * `a11y.spec.ts`.
 */
export const SEED_PROFILE_2_ROUTE = `/p/${SEED_PROFILE_2_PUBLIC_ID}`;

/**
 * The warm-up's weigh-in on Athlete Two's today. Inside the plausibility bound (it was `0.5`, which the
 * bound now rejects) and a decimal, so the receipt spec can assert the exact value it renders.
 */
export const WARMUP_BODYWEIGHT = '61.5';

/**
 * An ISO day `n` days before today **in the app's zone** (`DEFAULT_TIME_ZONE`). Shared by the
 * day-navigation specs (V1-15, V1-28) and the V1-24 bodyweight specs.
 *
 * ⚠️ It used to be UTC (`toISOString().slice(0, 10)`) with a comment claiming that was safe because
 * LA is behind UTC. It is the other way round: from 5 PM PT (00:00 UTC) UTC-yesterday IS LA-today, so
 * every `?d=${isoDaysAgo(1)}` spec resolved to today every evening (P1 on #180). The app computes its
 * day with `localDayIso` in the browser's zone, which `playwright.config.ts` pins to
 * `America/Los_Angeles` = `DEFAULT_TIME_ZONE` — so this uses the SAME function and constant, then
 * steps whole calendar days with `addDays` (no 24h-in-ms arithmetic, which is off by a day across a
 * 23-hour DST day).
 *
 * Probe (not a unit test — `e2e/` is outside Vitest): at `2026-10-01T01:00:00Z`,
 * `localDayIso('America/Los_Angeles', that)` is `2026-09-30`, so `isoDaysAgo(1)` is `2026-09-29`;
 * the old helper returned `2026-09-30`, LA-today.
 */
export const isoDaysAgo = (n: number) => addDays(localDayIso(DEFAULT_TIME_ZONE), -n);

/**
 * From the profile picker (`APP_HOME_PATH`), tap a profile tile and land on its scoped Today
 * (`/p/[profileId]`). Asserts the scoped Today shows the profile's name as the
 * page heading. Shared by the smoke test and the one-time warmup (DRY).
 */
export async function selectProfile(page: Page, name: string): Promise<void> {
  await page.getByRole('link', { name: new RegExp(name) }).click();
  await page.waitForURL(/\/p\//);
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

/** The weigh-in section, by its heading — `Bodyweight` in every state (V1-24 PR 1a). */
export const bodyweightSection = (page: Page) =>
  page.getByRole('region', { name: BODYWEIGHT_COPY.heading, exact: true });

/** The Life section, by its heading (V1-24 3b-page). */
export const lifeSection = (page: Page) =>
  page.getByRole('region', { name: LIFE_COPY.heading, exact: true });

/** The logged row's value (`✓ 84.5 lb`), by the value's own element (V1-24 3b-bw). */
export const loggedWeight = (page: Page, value: string) =>
  bodyweightSection(page).getByText(shownWeight(value), { exact: true });

/** The logged row's Change, named with its value. */
export const changeWeight = (page: Page, value: string) =>
  bodyweightSection(page).getByRole('button', { name: changeLabel('weight', shownWeight(value)) });

/** How the app displays a weight the specs log in the default unit (`84.5` → `84.5 lb`). */
export const shownWeight = (value: string) =>
  formatValueUnit(Number(value), DEFAULT_BODYWEIGHT_UNIT);

/**
 * **Log `value` as the day's bodyweight, retry-safely**, and assert the day holds exactly that value.
 *
 * On an empty day: fill + submit, then assert the receipt and that focus landed on it rather than
 * dropping to `<body>` when the form unmounted (V1-24 PR 1a, acceptance 6).
 *
 * On a day that already has a weight the form is gone (the receipt replaced it), so this asserts the
 * receipt shows **the value this caller logs**. That is what a Playwright retry sees — it reuses the
 * DB, so the first attempt's write is already there — and it is NOT a tolerance for another spec
 * having logged the same day: that is prevented by construction (the e2e rule under the plan's 1a
 * table — no two specs log bodyweight for the same `(profile, day)`), and if it ever happened this
 * fails, because the receipt would show the other spec's value.
 * ⚠️ The split holds only within one LA calendar day: a run that crosses LA midnight shifts "today"
 * mid-run, so a later spec's yesterday can be an earlier spec's today. Rerun; nothing guards this.
 *
 * Assumes the page is already authenticated and on a profile-scoped Today (`/p/[profileId]`).
 * `timeout` is only overridden for the cold warmup; the real coverage uses the default.
 */
export async function logBodyweight(
  page: Page,
  value: string,
  opts?: { timeout?: number },
): Promise<void> {
  const section = bodyweightSection(page);
  const saved = loggedWeight(page, value);
  const input = section.getByLabel('Weight', { exact: true });

  if ((await input.count()) > 0) {
    await input.fill(value);
    await section.getByRole('button', { name: BODYWEIGHT_COPY.logLabel }).click();
    await expect(saved).toBeVisible(opts);
    // The ✓ that held focus has unmounted; the section's live island hands focus to Change
    // (V1-24 3b-bw, plan W6) rather than letting it drop to `<body>`.
    await expect(changeWeight(page, value)).toBeFocused();
  }

  await expect(saved).toBeVisible(opts);
}

/** The practice button's label and its logged row's value, from the app's own sources. */
export const PRACTICE_LABEL = LIFE_ACTIVITIES.find(
  (a) => a.key === ACTIVITY_TYPE_KEYS.wrestling_practice,
)!.label;
const PRACTICE_SHOWN = formatValueUnit(DEFAULT_PRACTICE_MINUTES, 'min');

/** The logged practice's Change, named by `changeLabel` as the app names it (3b-life A1). */
export function practiceChange(page: Page, value: string = PRACTICE_SHOWN) {
  return lifeSection(page).getByRole('button', {
    name: changeLabel(PRACTICE_COPY.changeSubject, value),
  });
}

/**
 * Tap the one-tap **Wrestling practice** button and assert the Life section's logged row: the label
 * and its minutes, and its Change (V1-24 3b-page; Change since 3b-life-a). Retry-safe: a logged
 * activity has no button (the row replaced it), so a Playwright retry on the reused DB skips the tap
 * and asserts the end state.
 *
 * On a fresh log it also asserts focus moved to the row's Change: the button that had focus has
 * unmounted, and the section's island hands focus on rather than letting it drop to `<body>`.
 */
export async function logPractice(page: Page): Promise<void> {
  const life = lifeSection(page);
  const button = life.getByRole('button', { name: PRACTICE_LABEL, exact: true });
  const change = practiceChange(page);
  if ((await button.count()) > 0) {
    await button.click();
    await expect(change).toBeVisible({ timeout: 15_000 });
    await expect(change).toBeFocused();
  }
  await expect(life.getByText(PRACTICE_SHOWN, { exact: true })).toHaveCount(1);
  await expect(change).toHaveCount(1);
}
