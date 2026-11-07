import { SEED_PROFILE_2_PUBLIC_ID } from '@mat-plan/db';
import { PROFILE_KIND_LABELS, PROFILE_NAME_MAX, SEED_PROFILE_2_NAME } from '@mat-plan/shared';
import { expect, test, type Page } from '@playwright/test';

import {
  APP_HOME_PATH,
  ATHLETE_FORM_COPY,
  athleteEditPath,
  MIN_TAP_TARGET_PX,
} from '../lib/constants';
import { SEED_PROFILE_2_ROUTE } from './steps';
import { MOBILE_VIEWPORT } from './contexts';

/**
 * PROF-1 a-r — rename an athlete, end to end against a real database.
 *
 * ## Which athlete, and why it is the SECOND one
 *
 * It renames **Athlete Two**. Two properties make that safe under `fullyParallel: true`:
 *
 *  1. 🔴 **The new name APPENDS to the seeded one.** `selectProfile` matches with an UNANCHORED
 *     `new RegExp(name)` and asserts the heading by substring, so `Athlete TwoWWW…` still satisfies
 *     every sibling spec that selects by name while this one holds the rename. An unrelated name
 *     ("Zzz") would turn a parallel `log-bodyweight.spec.ts` red for a reason that has nothing to do
 *     with it. _(correctness S7, UX panel U13.)_
 *  2. Athlete Two has exactly one other consumer (`log-bodyweight.spec.ts`), and `global.setup.ts`
 *     runs to completion before any spec starts, so the warm-up cannot race this.
 *
 * `afterEach` restores the stored name whatever the test did, so a failure part-way through does not
 * leave the fixture renamed for the rest of the run.
 *
 * ## What is NOT here
 *
 * ⚠️ **The ADULT day page's program note is not measured.** It is the one name renderer whose state
 * needs an adult in a household that programs, and a-r cannot create one — `kind` is not editable
 * here (D7) and there is no add flow until a-1. a-1 adds a throwaway adult and scans it there; the
 * seed's two kids can never produce that line. Said plainly rather than left as an apparent gap.
 */

/**
 * 🔴 **SERIAL, and this is the one setting without which the file cannot be correct.**
 * `playwright.config.ts` sets `fullyParallel: true`, which parallelises tests WITHIN a file as well
 * as across them — so the tests below, three of which mutate the SAME athlete's name, ran
 * concurrently and the overflow test's rename landed inside the first test's
 * `toHaveValue(SEED_PROFILE_2_NAME)`. Observed, not theorised: `Received: "Athlete TwoWWWW…"`.
 *
 * A name is **household-wide state**, unlike the day-scoped fixtures the rest of the suite divides up
 * ("this spec owns Athlete One's today"), so there is no partition to hand each test — serial is the
 * answer rather than a workaround. ⚠️ The consequence to accept: in serial mode a failure SKIPS the
 * tests after it, so one red test here reports as one failure plus two skips, not three failures.
 */
test.describe.configure({ mode: 'serial' });

/** Athlete Two's public id — the same const `steps.ts` builds `SEED_PROFILE_2_ROUTE` from. */
const SEED_TWO = SEED_PROFILE_2_PUBLIC_ID;

/** Exactly at the cap, and `W` is the widest glyph — the worst case the field will accept. */
const LONG_NAME = SEED_PROFILE_2_NAME.padEnd(PROFILE_NAME_MAX, 'W');

/** The narrowest width AGENTS.md commits to. Mirrors `a11y.spec.ts`'s own constant. */
const NARROW = { width: 360, height: 780 };

const nameField = (page: Page) =>
  page.getByRole('textbox', { name: ATHLETE_FORM_COPY.nameLabel, exact: true });
const saveButton = (page: Page) =>
  page.getByRole('button', { name: ATHLETE_FORM_COPY.save, exact: true });

/** Store `name` through the real form, from the edit page. The one write path this spec uses. */
async function renameTo(page: Page, name: string): Promise<void> {
  await page.goto(athleteEditPath(SEED_TWO), { waitUntil: 'networkidle' });
  await nameField(page).fill(name);
  await saveButton(page).click();
  // The island navigates on success, so the edit form going away IS the save completing.
  await page.waitForURL((url) => !url.pathname.endsWith('/edit'));
}

test.afterEach(async ({ page }) => {
  // Retry-safe: unconditional, and it reads the stored name back rather than trusting the write.
  await page.goto(athleteEditPath(SEED_TWO), { waitUntil: 'networkidle' });
  const current = await nameField(page).inputValue();
  if (current !== SEED_PROFILE_2_NAME) await renameTo(page, SEED_PROFILE_2_NAME);
  await page.goto(athleteEditPath(SEED_TWO), { waitUntil: 'networkidle' });
  await expect(nameField(page)).toHaveValue(SEED_PROFILE_2_NAME);
});

test('the day page links to Edit, which renames the athlete and returns', async ({ page }) => {
  await page.goto(SEED_PROFILE_2_ROUTE, { waitUntil: 'networkidle' });

  // Criterion 8: rename is reachable FROM the athlete's own page. Criterion 11: the link that used
  // to be here pointed at the routine editor, and nothing in the app may link there any more.
  await expect(page.getByRole('link', { name: /Edit routine/ })).toHaveCount(0);
  await page.getByRole('link', { name: `→ Edit ${SEED_PROFILE_2_NAME}`, exact: true }).click();
  await page.waitForURL(/\/edit$/);

  // Criterion 9: the form SHOWS the kind. Both seeded profiles are kids.
  await expect(
    page.getByRole('heading', { name: `Edit ${SEED_PROFILE_2_NAME}`, level: 1 }),
  ).toBeVisible();
  await expect(page.getByText(PROFILE_KIND_LABELS.kid, { exact: true })).toBeVisible();
  // …and offers no way to CHANGE it (D7). Neither a radio nor a disabled one.
  await expect(page.getByRole('radio')).toHaveCount(0);

  await expect(nameField(page)).toHaveValue(SEED_PROFILE_2_NAME);
  await nameField(page).fill(LONG_NAME);
  await saveButton(page).click();

  // D6: it returns to where the parent came from — the athlete's own day page — and the new name in
  // the `<h1>` is the confirmation. `router.back()` means no extra history entry.
  await page.waitForURL((url) => url.pathname === SEED_PROFILE_2_ROUTE);
  await expect(page.getByRole('heading', { name: LONG_NAME, level: 1 })).toBeVisible();

  // The picker renders the stored name too — the second surface the action revalidates.
  await page.goto(APP_HOME_PATH, { waitUntil: 'networkidle' });
  await expect(page.getByRole('link', { name: new RegExp(LONG_NAME) })).toBeVisible();
});

test('a blank name is a field error that keeps what was typed', async ({ page }) => {
  await page.goto(athleteEditPath(SEED_TWO), { waitUntil: 'networkidle' });

  // `required` would stop a blank submit client-side, so drive the server's own refusal with a
  // whitespace-only value — which the browser accepts and `athleteNameSchema` trims to empty.
  await nameField(page).fill('   ');
  await saveButton(page).click();

  await expect(page.getByRole('alert')).toBeVisible();
  // 🔴 Still on the edit page, and 🔴 the field is NOT empty. React 19 resets an UNCONTROLLED field
  // when a form action settles — including on a refusal — which would leave a parent staring at an
  // empty box that says it is empty. This assertion is the whole reason the island is controlled.
  await expect(page).toHaveURL(/\/edit$/);
  await expect(nameField(page)).toHaveValue('   ');
  await expect(nameField(page)).toHaveAttribute('aria-invalid', 'true');
});

test('a 40-character name does not overflow at 360px, on any surface that renders it', async ({
  page,
}) => {
  await renameTo(page, LONG_NAME);
  await page.setViewportSize(NARROW);

  // The three surfaces that render a name in a-r. `scrollWidth > clientWidth` is the measurement
  // `expectTapTargets` cannot make — a row that runs off the side of the phone passes every other
  // a11y scan in the suite (`a11y.spec.ts`'s own note).
  for (const [label, path] of [
    ['the picker', APP_HOME_PATH],
    ["the athlete's day page", SEED_PROFILE_2_ROUTE],
    ['the edit page', athleteEditPath(SEED_TWO)],
  ] as const) {
    await page.goto(path, { waitUntil: 'networkidle' });
    const overflow = await page.evaluate(() => {
      const d = document.documentElement;
      return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth };
    });
    expect(
      overflow.scrollWidth,
      `${label}: scrolls horizontally at ${NARROW.width}px with a ${PROFILE_NAME_MAX}-character ` +
        `name (scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth})`,
    ).toBeLessThanOrEqual(overflow.clientWidth);
  }
});

test('the rename form is reachable and usable at the primary device width', async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.goto(athleteEditPath(SEED_TWO), { waitUntil: 'networkidle' });

  // The two controls a thumb aims at. ⚠️ `a11y.spec.ts` EXCLUDES <a> from its tap-target scan (the
  // SC 2.5.8 inline-text exception), so the back link's `min-h-11` is asserted HERE or nowhere.
  const back = page.getByRole('link', { name: `← ${SEED_PROFILE_2_NAME}`, exact: true });
  await expect(back).toBeVisible();
  expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
  expect((await saveButton(page).boundingBox())!.height).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);

  // The back link really returns to the athlete, without saving anything.
  await back.click();
  await expect(page).toHaveURL(SEED_PROFILE_2_ROUTE);
});
