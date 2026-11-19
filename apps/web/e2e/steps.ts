import { SEED_PROFILE_2_PUBLIC_ID, SEED_PROFILE_PUBLIC_ID } from '@mat-plan/db';
import {
  addDays,
  DEFAULT_BODYWEIGHT_UNIT,
  PRACTICE_UNIT,
  PROFILE_KIND,
  PROFILE_KIND_LABELS,
  type ProfileKind,
} from '@mat-plan/shared';
import { expect, type Locator, type Page } from '@playwright/test';

import { DAY_COPY } from '../components/day/day-copy';
import {
  ADD_ATHLETE_PATH,
  ATHLETE_FORM_COPY,
  BODYWEIGHT_COPY,
  changeLabel,
  DEFAULT_TIME_ZONE,
  LIFE_COPY,
  PRACTICE_COPY,
  SETTINGS_COPY,
  SETTINGS_PATH,
} from '../lib/constants';
import { localDayIso } from '../lib/date';
import { formatValueUnit } from '../lib/entries/format-value-unit';

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

/**
 * A Change button for `subject`, whatever value it names: `changeLabel`'s own prefix, escaped, never
 * re-typed (`Change weight — `), so a renamed subject moves every locator with it.
 */
export function changePrefix(subject: string): RegExp {
  return new RegExp(`^${changeLabel(subject, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
}

/** The logged row's Change, named with its value. */
export const changeWeight = (page: Page, value: string) =>
  bodyweightSection(page).getByRole('button', {
    name: changeLabel(BODYWEIGHT_COPY.changeSubject, shownWeight(value)),
    exact: true,
  });

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

/** The minutes the specs log (a typical session; the app has no default since 3b-life-b). */
export const PRACTICE_MINUTES = 90;
export const PRACTICE_SHOWN = formatValueUnit(PRACTICE_MINUTES, PRACTICE_UNIT);

/** The logged practice's Change, named by `changeLabel` as the app names it (3b-life A1). */
export function practiceChange(page: Page, value: string = PRACTICE_SHOWN) {
  return lifeSection(page).getByRole('button', {
    name: changeLabel(PRACTICE_COPY.changeSubject, value),
    exact: true,
  });
}

/** The unlogged practice row's minutes field and its ✓ (V1-24 3b-life-b). */
export function practiceLogField(page: Page) {
  return lifeSection(page).getByLabel(PRACTICE_COPY.fieldLabel, { exact: true });
}

/**
 * Type the practice minutes, tap ✓, and assert the Life section's logged row: the label and its
 * minutes, and its Change (V1-24 3b-page; Change since 3b-life-a; typed since 3b-life-b). Retry-safe:
 * a logged practice has no field (the row replaced it), so a Playwright retry on the reused DB skips
 * the log and asserts the end state.
 *
 * On a fresh log it also asserts focus moved to the row's Change: the ✓ that had focus has unmounted,
 * and the section's island hands focus on rather than letting it drop to `<body>`.
 */
export async function logPractice(page: Page): Promise<void> {
  const life = lifeSection(page);
  const button = life.getByRole('button', { name: PRACTICE_COPY.logLabel, exact: true });
  const change = practiceChange(page);
  // A retry after a failed change left another value on the row: clear it, so the log below runs.
  if ((await button.count()) === 0 && (await change.count()) === 0) await clearAnyPractice(page);
  if ((await button.count()) > 0) {
    await practiceLogField(page).fill(String(PRACTICE_MINUTES));
    await button.click();
    await expect(change).toBeVisible({ timeout: 15_000 });
    await expect(change).toBeFocused();
  }
  await expect(life.getByText(PRACTICE_SHOWN, { exact: true })).toHaveCount(1);
  await expect(change).toHaveCount(1);
}

/** Change the logged practice from `from` (as shown, `90 min`) to `minutes`, asserting the announcement
 * and that focus returns to the row's Change (V1-24 3b-life-a A4). */
export async function changePractice(page: Page, from: string, minutes: string): Promise<void> {
  const life = lifeSection(page);
  await practiceChange(page, from).click();
  const field = life.getByLabel(PRACTICE_COPY.fieldLabel, { exact: true });
  await field.fill(minutes);
  await life.getByRole('button', { name: PRACTICE_COPY.saveLabel, exact: true }).click();
  const to = formatValueUnit(Number(minutes), PRACTICE_UNIT);
  await expect(practiceChange(page, to)).toBeFocused({ timeout: 15_000 });
  await expect(life.getByRole('status')).toHaveText(PRACTICE_COPY.announcedChanged(to));
}

/** Clear the logged practice shown as `from`: empty the field, the ✓ is named Clear; the cleared line is
 * shown and focus lands on the empty minutes field that comes back (V1-24 3b-life A3, A4). */
export async function clearPractice(page: Page, from: string): Promise<void> {
  const life = lifeSection(page);
  await practiceChange(page, from).click();
  await life.getByLabel(PRACTICE_COPY.fieldLabel, { exact: true }).fill('');
  await life.getByRole('button', { name: PRACTICE_COPY.clearLabel, exact: true }).click();
  await expect(practiceLogField(page)).toBeFocused({ timeout: 15_000 });
  await expect(life.getByRole('status')).toHaveText(PRACTICE_COPY.announcedCleared(from));
}

/**
 * Clear whatever practice the row shows, at any value, so a Playwright retry (which reuses the DB) can
 * start from the empty field. A no-op when the field is already there.
 */
export async function clearAnyPractice(page: Page): Promise<void> {
  const life = lifeSection(page);
  const prefix = changeLabel(PRACTICE_COPY.changeSubject, '');
  const anyChange = life.getByRole('button', { name: changePrefix(PRACTICE_COPY.changeSubject) });
  if ((await anyChange.count()) === 0) return;
  const shown = (await anyChange.getAttribute('aria-label'))!.slice(prefix.length);
  await clearPractice(page, shown);
}

/**
 * A program row on the day page: the item's card in its workout's region, and its ✓. Lifted from
 * `day-page.spec.ts` at FAM-1 15, when `program-builder.spec.ts` became the second spec to tick one.
 */
export const programRowCard = (page: Page, workout: string, item: string) =>
  page
    .getByRole('region', { name: workout })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { level: 4, name: item, exact: true }) });
export const programRowTick = (page: Page, workout: string, item: string) =>
  programRowCard(page, workout, item).getByRole('button', { name: DAY_COPY.logLabel(item) });

/** A ✓ has settled: pressed or not, and no longer saving. */
export async function settled(button: Locator, pressed: boolean) {
  await expect(button).toHaveAttribute('aria-pressed', String(pressed));
  await expect(button).not.toHaveAttribute('aria-busy', 'true');
}

/**
 * Adds an athlete through `/p/new`, as a parent does (PROF-1 a-1u); they land on their day page.
 * `track` collects the name BEFORE the add, so `archiveAdded` cleans up even if the add's answer
 * is lost. Lifted from `athletes.spec.ts` at FAM-1 15, when the builder's spec became the second.
 */
export async function addAthlete(
  page: Page,
  name: string,
  // `ProfileKind`, not a `'Child' | 'Adult'` union: the radio's label IS `PROFILE_KIND_LABELS`, so a
  // second spelling of it here is a second place to update when the wording changes. The twin helper
  // in `scripts/screenshot-ephemeral.ts` reads the same constant.
  kind: ProfileKind = PROFILE_KIND.kid,
  track?: string[],
): Promise<void> {
  await page.goto(ADD_ATHLETE_PATH, { waitUntil: 'networkidle' });
  await page.getByRole('radio', { name: new RegExp(`^${PROFILE_KIND_LABELS[kind]}`) }).check();
  await page.getByLabel(ATHLETE_FORM_COPY.nameLabel).fill(name);
  track?.push(name);
  await page.getByRole('button', { name: ATHLETE_FORM_COPY.add }).click();
}

/**
 * Archives every athlete named, from Household settings: the specs' `afterEach` cleanup. Best
 * effort: a test that failed before the add leaves nothing to clean, and a missing row must not mask
 * the real failure. ⚠️ Archiving does not free a slot of `MAX_HOUSEHOLD_ATHLETES`.
 */
export async function archiveAdded(page: Page, names: readonly string[]): Promise<void> {
  for (const name of names) {
    try {
      await page.goto(SETTINGS_PATH, { waitUntil: 'networkidle' });
      const archive = () => page.getByRole('button', { name: SETTINGS_COPY.archiveFor(name) });

      // 🔴 **A LOOP, because a-1d made two athletes under ONE name a real fixture.** This was
      // `if (await control.count()) await control.click()`, and on the duplicate tests — the only
      // ones that create two rows with the same name — `count()` was 2, so `click()` threw
      // Playwright's strict-mode violation straight into the `catch` below. Neither athlete was
      // archived, on every run and every retry, and the swallow meant this cleanup reported nothing
      // while doing nothing. A cleanup that cannot fail out loud has to be correct by construction.
      //
      // ⚠️ **Counting the controls DOWN is the wait, and the first fix got this wrong.** It waited on
      // the Undo button, which is already visible from the PREVIOUS archive — so the loop re-queried
      // while the row was still detaching, `click()` retried the stale handle for the whole 30s
      // action timeout, and the passes burned the hook's budget instead. `toHaveCount` polls, so it
      // is both the "the Server Action landed" signal the Undo assertion used to be and the loop's
      // own termination condition.
      for (let remaining = await archive().count(); remaining > 0; remaining -= 1) {
        await archive().first().click();
        await expect(archive()).toHaveCount(remaining - 1, { timeout: 15_000 });
      }
    } catch {
      // Swallowed on purpose — cleanup must never turn a green test red or hide a red one. ⚠️ Which
      // is exactly why the loop above must not depend on it: see the comment there.
    }
  }
}
