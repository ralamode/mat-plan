import { SEED_PROFILE_2_PUBLIC_ID, SEED_PROFILE_PUBLIC_ID } from '@mat-plan/db';
import { expect, type Page } from '@playwright/test';

/**
 * The seeded profile's Today route. Single-sourced here (V1-12) because three callers need it — the
 * smoke, the a11y spec, and the screenshot script — and it is derived from the seed's stable public id
 * rather than a re-typed UUID (AGENTS.md constants rule).
 */
export const SEED_PROFILE_ROUTE = `/p/${SEED_PROFILE_PUBLIC_ID}`;

/**
 * The SECOND seeded profile's Today (Scarlett). `global.setup.ts` warms the bodyweight write path
 * here, so this profile's today ALWAYS has a weigh-in by the time any spec runs — which makes it the
 * one reliable fixture for the "already logged" read state (V1-24 PR 1a).
 */
export const SEED_PROFILE_2_ROUTE = `/p/${SEED_PROFILE_2_PUBLIC_ID}`;

/**
 * An ISO day `n` days before now, in UTC. Shared by the day-navigation specs (V1-15, V1-28) — the
 * second caller is the trigger to extract it, per AGENTS.md's constants rule.
 *
 * UTC is deliberate and safe HERE: `playwright.config.ts` pins the browser to `America/Los_Angeles`,
 * which is behind UTC, so a UTC date is never AHEAD of the app's local date. The specs use this to
 * reach a day the app will accept, not to assert the app's own date arithmetic — that is
 * `declared-day.test.ts`'s job, and V1-14b reads the day off the form rather than recomputing it.
 */
export const isoDaysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/**
 * From the profile picker (`/`), tap a profile tile and land on its scoped Today
 * (`/p/[profileId]`). Asserts the scoped Today shows the profile's name as the
 * page heading. Shared by the smoke test and the one-time warmup (DRY).
 */
export async function selectProfile(page: Page, name: string): Promise<void> {
  await page.getByRole('link', { name: new RegExp(name) }).click();
  await page.waitForURL(/\/p\//);
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

/**
 * **Ensure the day has a bodyweight, and return the value it actually has.**
 *
 * Logs `value` through the Today form when the day is empty; when a weight is ALREADY logged the
 * surface renders a receipt with no input, so this asserts that end state instead and returns the
 * existing value. Callers assert on the RETURN, never on the value they passed — that is what makes
 * them independent of which spec (or which retry) reached this profile's day first.
 *
 * Assumes the page is already authenticated and on a profile-scoped Today (`/p/[profileId]`).
 *
 * `timeout` is only overridden for the cold warmup; the real coverage test uses the default
 * (fast, warm server) — we keep the cold-start cost out of the test.
 */
export async function logBodyweight(
  page: Page,
  value: string,
  opts?: { timeout?: number },
): Promise<string> {
  const section = page.getByRole('region', { name: /^(Log b|B)odyweight$/ });
  const input = page.getByLabel('Weight', { exact: true });

  // RETRY-SAFE, and cross-spec safe (V1-24 PR 1a). Since the weigh-in surface renders a RECEIPT once
  // the day has a weight, the create form is simply absent on a day that already has one — so an
  // unconditional `fill` times out. Two real callers hit that: a Playwright retry (which reuses the
  // ephemeral DB) and a sibling spec that logged this profile's day first under `fullyParallel`.
  //
  // The same shape `logCheckins` and `logLifeActivity` already use: when the end state is present,
  // assert it instead of driving an absent control.
  if ((await input.count()) === 0) {
    const shown = (await section.getByText(/^[\d.]+ \w+$/).textContent())!.trim();
    await expect(page.getByText(`Bodyweight — ${shown}`)).toBeVisible(opts);
    return shown.split(' ')[0];
  }

  await input.fill(value);
  await page.getByRole('button', { name: 'Log weight' }).click();
  await expect(page.getByText(`Bodyweight — ${value} lb`)).toBeVisible(opts);
  return value;
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
    await expect(life.getByText(`${opts.button} · logged today`)).toBeVisible({ timeout: 15_000 });
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
