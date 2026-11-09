import { SEED_PROFILE_2_PUBLIC_ID, SEED_PROFILE_3_PUBLIC_ID } from '@mat-plan/db';
import {
  PROFILE_KIND_LABELS,
  PROFILE_NAME_MAX,
  SEED_PROFILE_2_NAME,
  SEED_PROFILE_3_NAME,
  NAME_REQUIRED_MESSAGE,
} from '@mat-plan/shared';
import { expect, test, type Page } from '@playwright/test';

import {
  APP_HOME_PATH,
  ATHLETE_FORM_COPY,
  athleteEditPath,
  athletePath,
  MIN_TAP_TARGET_PX,
  NAME_ERROR_ID,
  SETTINGS_COPY,
  SETTINGS_PATH,
} from '../lib/constants';
import { SEED_PROFILE_2_ROUTE } from './steps';
import { expectNoHorizontalOverflow, MOBILE_VIEWPORT, NARROW_VIEWPORT } from './contexts';

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
/**
 * 🔴 **The ARCHIVE specs get their OWN athlete, and the reason is a red test.** Archiving removes an
 * athlete from the picker and makes their day page read-only — which no other fixture mutation does.
 * The rename specs can share Athlete Two because a rename APPENDS and every sibling matches by
 * substring; for the ~2s an archive holds, Athlete Two has no form, and under `fullyParallel`
 * `a11y.spec.ts`'s weigh-in test went red with "Athlete Two's yesterday should be empty". Archiving
 * a third, otherwise-unused athlete is what makes these specs independent rather than lucky.
 */
const SEED_THREE = SEED_PROFILE_3_PUBLIC_ID;
/** The long name lives on the ARCHIVE athlete, so measuring an archived row needs no second rename. */
const LONG_ARCHIVE_NAME = SEED_PROFILE_3_NAME.padEnd(PROFILE_NAME_MAX, 'W');

/** Exactly at the cap, and `W` is the widest glyph — the worst case the field will accept. */
const LONG_NAME = SEED_PROFILE_2_NAME.padEnd(PROFILE_NAME_MAX, 'W');

const nameField = (page: Page) =>
  page.getByRole('textbox', { name: ATHLETE_FORM_COPY.nameLabel, exact: true });
const saveButton = (page: Page) =>
  page.getByRole('button', { name: ATHLETE_FORM_COPY.save, exact: true });

/**
 * Store `name` through the real form, from the edit page. The one write path this spec uses.
 *
 * ⚠️ Deliberately WITHOUT `?from=`, so it drives the `router.replace(fallbackPath)` branch — the
 * one a parent who typed the URL or opened a bookmark gets. The in-app `back()` branch is driven by
 * the first test, which navigates from the day page's link. Between them both branches run.
 */
async function renameTo(page: Page, name: string, publicId = SEED_TWO): Promise<void> {
  await page.goto(athleteEditPath(publicId), { waitUntil: 'networkidle' });
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

test('the day page links to Rename, which renames the athlete and returns', async ({ page }) => {
  await page.goto(SEED_PROFILE_2_ROUTE, { waitUntil: 'networkidle' });

  // Criterion 8: rename is reachable FROM the athlete's own page.
  // 🔴 **Criterion 11, asserted on the DESTINATION, not the copy.** The first version read
  // `getByRole('link', { name: /Edit routine/ })` — and the link it was meant to prove gone said
  // "→ Edit Athlete Two’s routine", which that pattern never matched. It was 0 before the PR and
  // would stay 0 if the routine link came back: a test that could not fail on the thing it named.
  // An `href` selector cannot drift with the copy.
  await expect(page.locator('a[href*="/routine"]')).toHaveCount(0);
  await page
    .getByRole('link', { name: ATHLETE_FORM_COPY.renameLink(SEED_PROFILE_2_NAME), exact: true })
    .click();
  await page.waitForURL(/\/edit/);

  // Criterion 9: the form SHOWS the kind. Both seeded profiles are kids.
  await expect(
    page.getByRole('heading', { name: `Rename ${SEED_PROFILE_2_NAME}`, level: 1 }),
  ).toBeVisible();
  // Just the label under the heading — no caption, no control.
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
  // 🔴 D6's real requirement: **no duplicate history entry.** `back()` POPS the edit page, so the
  // day page we land on is the one we came from — one more Back leaves the app's history entirely.
  // Had the island pushed or replaced instead, history would read [day, edit, day] and this Back
  // would return to `/edit`. ⚠️ The first version of this asserted it landed on `/p`, which the
  // test never visited (it `goto`s the day page directly) — it failed on `about:blank`. Asserting
  // what must NOT be there is the claim; asserting a specific destination was a guess about history
  // this test does not create.
  await page.goBack();
  await expect(page).not.toHaveURL(/\/edit/);

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

  // ⚠️ **Scoped to the FIELD error by id, not `getByRole('alert')` page-wide.** Next's App Router
  // mounts its own route announcer as `<div role="alert" id="__next-route-announcer__">`, so the
  // broad locator is ambiguous the moment a client-side navigation has happened in the context —
  // "strict mode violation: resolved to 2 elements", with the second one empty. The test means the
  // message under the input, and `rename-form.tsx` already names it.
  await expect(page.locator(`#${NAME_ERROR_ID}`)).toBeVisible();
  await expect(page.locator(`#${NAME_ERROR_ID}`)).toHaveText(NAME_REQUIRED_MESSAGE);
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
  await page.setViewportSize(NARROW_VIEWPORT);

  // The three surfaces that render a name in a-r. `scrollWidth > clientWidth` is the measurement
  // `expectTapTargets` cannot make — a row that runs off the side of the phone passes every other
  // a11y scan in the suite (`a11y.spec.ts`'s own note).
  for (const [label, path] of [
    ['the picker', APP_HOME_PATH],
    ["the athlete's day page", SEED_PROFILE_2_ROUTE],
    ['the edit page', athleteEditPath(SEED_TWO)],
    // PROF-1 b. ⚠️ **Added because the first version of that chunk's own 360px test used the
    // 11-character seed name**, so the two new name renderers it introduced — the settings row and
    // the Undo result line — were measured against a name that could not overflow anything.
    ['Household settings', SETTINGS_PATH],
  ] as const) {
    await page.goto(path, { waitUntil: 'networkidle' });
    // The shared helper (`contexts.ts`) — this check existed inline here, privately in
    // `a11y.spec.ts`, and was about to be written a third time for `/settings`.
    await expectNoHorizontalOverflow(page, `${label}, with a ${PROFILE_NAME_MAX}-character name`);
  }

  // 🔴 **The two surfaces that only exist once an athlete IS archived**, with the long name still in
  // place: the Undo result line (which interpolates the name) and the day page's archived notice.
  // Neither is reachable without archiving, so the loop above cannot cover them.
  await renameTo(page, LONG_ARCHIVE_NAME, SEED_THREE);
  await page.setViewportSize(NARROW_VIEWPORT);
  await page.goto(SETTINGS_PATH, { waitUntil: 'networkidle' });
  await archiveAthleteNamed(page, LONG_ARCHIVE_NAME);
  await expectNoHorizontalOverflow(
    page,
    `the Undo result line and the Archived row, with a ${PROFILE_NAME_MAX}-character name`,
  );

  await page.goto(athletePath(SEED_THREE), { waitUntil: 'networkidle' });
  await expectNoHorizontalOverflow(
    page,
    `the archived-athlete notice, with a ${PROFILE_NAME_MAX}-character name`,
  );

  // Restore, so the long name does not leave an athlete off the picker for a parallel spec…
  await page.goto(SETTINGS_PATH, { waitUntil: 'networkidle' });
  await restoreAthleteNamed(page, LONG_ARCHIVE_NAME);

  // …and put the NAME back, which the first version forgot. The sibling archive specs locate their
  // controls by `SETTINGS_COPY.archiveFor(SEED_PROFILE_3_NAME)`, so leaving the padded name behind
  // broke them — caught by the new `toHaveText` assertions, which is what a `toBeVisible` on an
  // always-mounted line could never have told us.
  await renameTo(page, SEED_PROFILE_3_NAME, SEED_THREE);
});

/**
 * PROF-1 b — Edit reached FROM `/settings` returns there, not to the athlete's day page.
 *
 * 🔴 **The code and its own comments disagreed until a security lens read both.** The island sends
 * `?from=/settings`, and three comments said this chunk adds `SETTINGS_PATH` to `inAppReferrer`'s
 * allowlist — it did not. The allowlist fails CLOSED, so there was no open redirect; what there was
 * is a parent sent silently to the wrong screen, from the one list they were working in.
 */
test('Edit from Household settings returns to Household settings', async ({ page }) => {
  await page.goto(SETTINGS_PATH, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: SETTINGS_COPY.editFor(SEED_PROFILE_2_NAME) }).click();
  await expect(page).toHaveURL(new RegExp(`${SEED_TWO}/edit\\?from=`));

  await nameField(page).fill(`${SEED_PROFILE_2_NAME} C`);
  await saveButton(page).click();
  await expect(page).toHaveURL(SETTINGS_PATH);
});

/**
 * 🔴 The branch two review lenses found independently: a parent who reaches `/edit` from OUTSIDE the
 * app must not be ejected by `router.back()` after a successful save. `history.length > 1` alone
 * said "in-app" and was true here; the `?from=` signal is what makes it false.
 */
test('a save from outside the app lands on the athlete, never off-site', async ({ page }) => {
  // A tab that already has history, then the edit URL typed into it — no `?from=`.
  await page.goto('about:blank');
  await page.goto(athleteEditPath(SEED_TWO), { waitUntil: 'networkidle' });
  await nameField(page).fill(`${SEED_PROFILE_2_NAME} B`);
  await saveButton(page).click();

  await page.waitForURL((url) => !url.pathname.endsWith('/edit'));
  expect(page.url(), 'a save with no in-app referrer must land on the athlete').toContain(
    SEED_PROFILE_2_ROUTE,
  );
});

test('the rename form is reachable and usable at the primary device width', async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.goto(athleteEditPath(SEED_TWO), { waitUntil: 'networkidle' });

  // The two controls a thumb aims at. ⚠️ `a11y.spec.ts` EXCLUDES <a> from its tap-target scan (the
  // SC 2.5.8 inline-text exception), so the back link's `min-h-11` is asserted HERE or nowhere.
  const back = page.getByRole('link', {
    name: ATHLETE_FORM_COPY.backTo(SEED_PROFILE_2_NAME),
    exact: true,
  });
  await expect(back).toBeVisible();
  expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
  expect((await saveButton(page).boundingBox())!.height).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);

  // The back link really returns to the athlete, without saving anything.
  await back.click();
  await expect(page).toHaveURL(SEED_PROFILE_2_ROUTE);
});

/**
 * The result line, scoped to the UndoLine's own `<p id>`.
 *
 * 🔴 **`getByText(…)` is AMBIGUOUS here, and only intermittently.** The island renders the result in
 * the visible `<p id="athlete-result">` and then, ~60ms later, the same string lands in the sr-only
 * `<Announcer>` (`<p role="status">`) — so a substring, visibility-agnostic locator resolves to TWO
 * elements. Playwright treats a strict-mode violation as **non-retriable**, so the assertion passes
 * only if a poll lands inside that 60ms window: fast locally, likely red on CI. A review lens found
 * it, and it is the same shape as the route-announcer ambiguity this PR fixed one hunk earlier.
 */
const resultLine = (page: Page) => page.locator('#athlete-result');

/**
 * Archive / restore the archive athlete, as one step each.
 *
 * The click-then-assert pair appeared **six times** across the specs below — the shape the
 * maintainer's N4 rule names ("the same block of code 7 or more times verbatim"). `name` is a
 * parameter because the long-name test drives the same athlete under a 40-character name.
 */
async function archiveAthleteNamed(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: SETTINGS_COPY.archiveFor(name) }).click();
  await expect(resultLine(page)).toHaveText(SETTINGS_COPY.archivedResult(name));
}

async function restoreAthleteNamed(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: SETTINGS_COPY.restoreFor(name) }).click();
  await expect(resultLine(page)).toHaveText(SETTINGS_COPY.restoredResult(name));
}

/**
 * PROF-1 b — archive, Undo, and the DURABLE path once the Undo line is gone.
 *
 * 🔴 **The reload is the point of the second half.** Undo is a convenience with a short life: it is
 * gone on navigation, and iOS evicts a backgrounded tab. What makes that acceptable is that
 * `/settings` keeps a per-row **Restore** for everyone, so the recovery survives losing the Undo
 * line. A test that only drove archive → Undo would prove the convenience and leave the thing it
 * depends on unproved.
 */
test('archive leaves the picker, Undo brings them back, and Restore still works after a reload', async ({
  page,
}) => {
  await page.goto(SETTINGS_PATH, { waitUntil: 'networkidle' });

  const archive = page.getByRole('button', { name: SETTINGS_COPY.archiveFor(SEED_PROFILE_3_NAME) });
  await expect(archive).toBeVisible();
  await archive.click();

  // The result line names the athlete, and Undo is described by it.
  await expect(resultLine(page)).toHaveText(SETTINGS_COPY.archivedResult(SEED_PROFILE_3_NAME));
  const undo = page.getByRole('button', { name: SETTINGS_COPY.undoLabel(SEED_PROFILE_3_NAME) });
  await expect(undo).toBeVisible();

  // They have left the picker (criterion 5) and joined the Archived section.
  await page.goto(APP_HOME_PATH, { waitUntil: 'networkidle' });
  await expect(page.getByRole('link', { name: SEED_PROFILE_3_NAME })).toHaveCount(0);

  // 🔴 The durable path, with the Undo line definitively gone (we navigated away and back).
  await page.goto(SETTINGS_PATH, { waitUntil: 'networkidle' });
  await expect(
    page.getByRole('button', { name: SETTINGS_COPY.undoLabel(SEED_PROFILE_3_NAME) }),
  ).toHaveCount(0);
  const restore = page.getByRole('button', { name: SETTINGS_COPY.restoreFor(SEED_PROFILE_3_NAME) });
  await expect(restore).toBeVisible();
  await restore.click();

  await expect(resultLine(page)).toHaveText(SETTINGS_COPY.restoredResult(SEED_PROFILE_3_NAME));
  await page.goto(APP_HOME_PATH, { waitUntil: 'networkidle' });
  await expect(page.getByRole('link', { name: SEED_PROFILE_3_NAME })).toBeVisible();
});

/**
 * PROF-1 b — the recovery hop from an archived athlete's own day page, as a LINK.
 *
 * Unlinked it is three taps (← All athletes → Household settings › → Restore); the UX lens's finding
 * was that the plan named no link. Two taps is what this asserts, plus the tap height, because
 * `a11y.spec.ts` excludes `<a>` from its tap-target scan.
 */
test('an archived athlete’s day page links straight to the recovery', async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.goto(SETTINGS_PATH, { waitUntil: 'networkidle' });
  await archiveAthleteNamed(page, SEED_PROFILE_3_NAME);

  await page.goto(athletePath(SEED_THREE), { waitUntil: 'networkidle' });
  const link = page.getByRole('link', { name: SETTINGS_COPY.heading, exact: true });
  await expect(link).toBeVisible();
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
  await link.click();
  await expect(page).toHaveURL(SETTINGS_PATH);

  // Leave the seed as we found it, so test order cannot matter.
  await restoreAthleteNamed(page, SEED_PROFILE_3_NAME);
});

/**
 * PROF-1 b — the 360px row, measured with an archived athlete present in BOTH sections.
 *
 * The UX lens's width math: one flex row of name + kind + Edit + Archive leaves ~101px for a 40-char
 * name, and **nothing in CI sees the result** — `scrollWidth` never grows and the tap-target gate
 * measures height. So the assertion has to be an explicit overflow check at the narrow width, with
 * the long name actually rendered, in both sections at once.
 */
test('Household settings does not overflow at 360px, in both sections', async ({ page }) => {
  await page.setViewportSize(NARROW_VIEWPORT);
  await page.goto(SETTINGS_PATH, { waitUntil: 'networkidle' });

  // Archive one so both sections are populated for the same measurement.
  await archiveAthleteNamed(page, SEED_PROFILE_3_NAME);

  await expectNoHorizontalOverflow(page, 'Household settings, both sections populated');

  // Every control on the page still clears the tap bar at this width.
  // ⚠️ **No `if (count > 0)` guard, deliberately.** The first version skipped the measurement when a
  // control was absent — so a copy change, a role change (`Button asChild` + `Link` renders a LINK,
  // not a button) or a missing Restore row would have made this loop measure nothing and pass.
  // Asserting visibility first turns a stale locator into a red test instead of a silent skip.
  for (const [role, name] of [
    ['link', SETTINGS_COPY.editFor(SEED_PROFILE_2_NAME)],
    ['button', SETTINGS_COPY.restoreFor(SEED_PROFILE_3_NAME)],
  ] as const) {
    const control = page.getByRole(role, { name, exact: true });
    await expect(control).toBeVisible();
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
  }

  await restoreAthleteNamed(page, SEED_PROFILE_3_NAME);
});

/**
 * PROF-1 b — **where focus LANDS**, which nothing in CI checks and which the UX lens flagged as
 * ordering-dependent.
 *
 * Archive moves focus to Undo (rendered from island state in the same commit as the result, so it is
 * sound by construction). Restore moves it to the restored `<li>` — and that element has the same id
 * in BOTH sections, so if the action result commits before the refreshed server list, focus could
 * land on the row about to unmount and drop to `<body>`. Reading the code cannot settle that; driving
 * it can.
 */
test('focus lands on Undo after archive, and on the restored row after restore', async ({
  page,
}) => {
  await page.goto(SETTINGS_PATH, { waitUntil: 'networkidle' });

  await archiveAthleteNamed(page, SEED_PROFILE_3_NAME);
  await expect(
    page.getByRole('button', { name: SETTINGS_COPY.undoLabel(SEED_PROFILE_3_NAME) }),
  ).toBeFocused();

  await restoreAthleteNamed(page, SEED_PROFILE_3_NAME);
  const focusedId = await page.evaluate(() => document.activeElement?.id ?? '');
  expect(
    focusedId,
    'restore must land on the restored row, not on <body> — the row exists in both sections under ' +
      'the same id, so a commit-order change is what would break it',
  ).toBe(`athlete-${SEED_PROFILE_3_PUBLIC_ID}`);
});
