import { SEED_PROFILE_2_PUBLIC_ID, SEED_PROFILE_PUBLIC_ID } from '@mat-plan/db';
import {
  CATALOG_METRIC_DEFINITION_SEED_ROWS,
  DEFAULT_BODYWEIGHT_UNIT,
  SEED_METRIC_KEYS,
} from '@mat-plan/shared';
import { expect, type Page } from '@playwright/test';

import {
  BODYWEIGHT_COPY,
  BODYWEIGHT_RECEIPT_ID,
  DEFAULT_TIME_ZONE,
  SAVED_STATE_COPY,
  STRENGTH_COPY,
} from '../lib/constants';
import { addDays, localDayIso } from '../lib/date';
import { formatValueUnit } from '../lib/entries/format-value-unit';

/**
 * The seeded profile's Today route. Single-sourced here (V1-12) because three callers need it — the
 * smoke, the a11y spec, and the screenshot script — and it is derived from the seed's stable public id
 * rather than a re-typed UUID (AGENTS.md constants rule).
 */
export const SEED_PROFILE_ROUTE = `/p/${SEED_PROFILE_PUBLIC_ID}`;

/**
 * The SECOND seeded profile's Today (Scarlett). `global.setup.ts` warms the bodyweight write path on
 * her TODAY, so that day always holds `WARMUP_BODYWEIGHT` by the time any spec runs — the one
 * deterministic fixture for the "already logged" read state (V1-24 PR 1a). Her YESTERDAY belongs to
 * `a11y.spec.ts`.
 */
export const SEED_PROFILE_2_ROUTE = `/p/${SEED_PROFILE_2_PUBLIC_ID}`;

/**
 * The warm-up's weigh-in on Scarlett's today. Inside the plausibility bound (it was `0.5`, which the
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

/** The strength section, by its heading (`exact`: the program card's own region name has "Strength"). */
export const strengthSection = (page: Page) =>
  page.getByRole('region', { name: STRENGTH_COPY.heading, exact: true });

/**
 * **Make the strength form usable, retry-safely (V1-24 3a-ii).** Once a day has a strength session, the
 * form starts COLLAPSED behind "Log more strength"; a spec that needs the form calls this first. It
 * clicks the toggle only while it reads collapsed (`aria-expanded="false"`, never the open state's
 * "Close"), and retries until the submit is visible, so a click that lands before hydration (no
 * handler yet) can't pass silently. Call it again after a client-side day change.
 */
export async function openStrengthForm(page: Page): Promise<void> {
  const section = strengthSection(page);
  const submit = section.getByRole('button', { name: STRENGTH_COPY.submit, exact: true });
  await expect(async () => {
    const toggle = section.getByRole('button', { name: STRENGTH_COPY.logMore, exact: true });
    if ((await toggle.count()) > 0 && (await toggle.getAttribute('aria-expanded')) === 'false') {
      await toggle.click();
    }
    await expect(submit).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

/** How the app displays a weight the specs log in the default unit (`84.5` → `84.5 lb`). */
export const shownWeight = (value: string) =>
  formatValueUnit(Number(value), DEFAULT_BODYWEIGHT_UNIT);

/** The "Logged entries" line for a weigh-in (`Bodyweight — 84.5 lb`), built as `entryLabel` does. */
const BODYWEIGHT_METRIC_LABEL = CATALOG_METRIC_DEFINITION_SEED_ROWS.find(
  (m) => m.key === SEED_METRIC_KEYS.bodyweight,
)!.label;
export const bodyweightEntryLine = (value: string) =>
  `${BODYWEIGHT_METRIC_LABEL} — ${shownWeight(value)}`;

/**
 * **Log `value` as the day's bodyweight, retry-safely**, and assert the day holds exactly that value.
 *
 * On an empty day: fill + submit, then assert the receipt, the entries line, and that focus landed
 * on the receipt rather than dropping to `<body>` when the form unmounted (V1-24 PR 1a, acceptance 6).
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
  const saved = section.getByText(BODYWEIGHT_COPY.saved(shownWeight(value)), { exact: true });
  // exact: disambiguate from the strength form's "Movement 1 set 1 weight in …" inputs.
  const input = section.getByLabel('Weight', { exact: true });

  if ((await input.count()) > 0) {
    await input.fill(value);
    await section.getByRole('button', { name: 'Log weight' }).click();
    await expect(saved).toBeVisible(opts);
    // The submit button that held focus has unmounted; `SavedAnnouncer` moves focus to the receipt.
    await expect(section.locator(`#${BODYWEIGHT_RECEIPT_ID}`)).toBeFocused();
  }

  await expect(saved).toBeVisible(opts);
  await expect(page.getByText(bodyweightEntryLine(value))).toBeVisible(opts);
}

/**
 * Log a check-in through the Today form and wait for it to render (V1-5). Covers the
 * kind-NULL write path end-to-end: a bare habit checkbox (neither source column) and a
 * rated brush-teeth metric, in one submit.
 *
 * `exact` matters here — `Shot` vs `Shots` and `Stance` vs the section copy are live
 * substring collisions (docs/lessons.md: substring matching bit us in V0-11).
 */
export async function logCheckins(
  page: Page,
  opts: { habit: string; rating: { label: string; value: string } },
): Promise<void> {
  const form = page.getByRole('region', { name: 'Check-ins' });
  const submit = page.getByRole('button', { name: 'Log check-ins' });
  const rating = form.getByRole('spinbutton', { name: new RegExp(`^${opts.rating.label}`) });

  // RETRY-SAFE. Playwright retries reuse the same ephemeral DB, and an already-logged
  // field renders readonly/aria-disabled by design — so a second attempt must assert the
  // end state rather than re-submit into an inert control (which just times out).
  if (await rating.isEditable()) {
    await form.getByRole('checkbox', { name: opts.habit, exact: true }).check();
    await rating.fill(opts.rating.value);
    await submit.click();

    // Synchronize on the submit completing. The button returning from "Logging…" is the
    // real signal: this action does several catalog reads plus a multi-row insert and a
    // full RSC revalidation, so it is slower than the single-row bodyweight write and
    // outruns the default 5s expect timeout on a cold CI worker.
    await expect(submit).toBeEnabled({ timeout: 15_000 });
  }

  // Scope assertions to the ENTRIES list, not the page. The habit's own <label> renders
  // its name inside the form, so an unscoped getByText('Rice bucket') passes even when
  // nothing was written — a false positive that masks a genuinely failed write.
  const logged = page.getByRole('region', { name: 'Logged entries' });
  await expect(logged.getByText(opts.habit, { exact: true })).toBeVisible();
  await expect(logged.getByText(`${opts.rating.label} — ${opts.rating.value}/10`)).toBeVisible();
}

/**
 * Submit the check-ins form with a set of habit checkboxes and/or numeric fields (V1-6a).
 * Retry-safe: a habit already logged (checked + inert) is skipped rather than re-checked, so
 * a Playwright retry on the reused DB doesn't get stuck. Waits for the submit to complete.
 */
export async function submitCheckins(
  page: Page,
  opts: {
    checks?: string[];
    numbers?: { label: string; value: string }[];
    /** Only overridden for the COLD warm-up in global.setup.ts — see `logBodyweight`'s note. */
    timeout?: number;
  },
): Promise<void> {
  const form = page.getByRole('region', { name: 'Check-ins' });
  const submit = page.getByRole('button', { name: 'Log check-ins' });
  for (const name of opts.checks ?? []) {
    const box = form.getByRole('checkbox', { name, exact: true });
    if (!(await box.isChecked())) await box.check(); // already logged → checked + inert; skip
  }
  for (const n of opts.numbers ?? []) {
    await form.getByRole('spinbutton', { name: new RegExp(`^${n.label}`) }).fill(n.value);
  }
  await submit.click();
  await expect(submit).toBeEnabled({ timeout: opts.timeout ?? 15_000 }); // slow action — see logCheckins
}

/**
 * Log a calisthenics count and assert the "Calisthenics today" total (V1-6a). Covers the
 * ACCUMULATING path: the field stays editable after logging, so — unlike `logCheckins`'s
 * inert fields — retry-safety CANNOT lean on `isEditable()`. Instead we assert the END
 * STATE and only submit when the total isn't already present, so a Playwright retry (which
 * reuses the ephemeral DB) neither re-submits (double-count) nor trips the exact locator.
 */
/**
 * Tap a one-tap "Life" activity (V1-7: Wake / Wrestling practice) and assert it logged. Covers the
 * timing/duration write path end-to-end. Retry-safe: an already-logged button renders inert (a
 * "· logged today" line, not a button), so a Playwright retry on the reused DB skips the click and
 * asserts the end state. `expectInList` is scoped to the Logged-entries region (the button's own
 * label collides with the entries text — the docs/lessons.md substring trap).
 */
export async function logLifeActivity(
  page: Page,
  opts: { button: string; expectInList: RegExp },
): Promise<void> {
  const life = page.getByRole('region', { name: 'Life' });
  const button = life.getByRole('button', { name: opts.button, exact: true });
  if ((await button.count()) > 0) {
    await button.click();
    // The write + full RSC revalidation flips the button to an inert "· logged today" line.
    await expect(life.getByText(SAVED_STATE_COPY.lifeLogged(opts.button))).toBeVisible({
      timeout: 15_000,
    });
  }
  const logged = page.getByRole('region', { name: 'Logged entries' });
  await expect(logged.getByText(opts.expectInList)).toBeVisible();
}

export async function logCalisthenics(
  page: Page,
  opts: { label: string; value: string },
): Promise<void> {
  const totals = page.getByRole('region', { name: 'Calisthenics today' });
  const totalRow = totals.getByRole('listitem').filter({ hasText: opts.label });

  if ((await totalRow.count()) === 0) {
    const form = page.getByRole('region', { name: 'Check-ins' });
    const submit = page.getByRole('button', { name: 'Log check-ins' });
    await form.getByRole('spinbutton', { name: new RegExp(`^${opts.label}`) }).fill(opts.value);
    await submit.click();
    await expect(submit).toBeEnabled({ timeout: 15_000 }); // slow action — see logCheckins
  }

  await expect(totalRow).toContainText(opts.value);
}
