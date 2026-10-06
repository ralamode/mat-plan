import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  BODYWEIGHT_BOUNDS,
  BODYWEIGHT_UNITS,
  DEFAULT_BODYWEIGHT_UNIT,
  IMPLAUSIBLE_BODYWEIGHT_MESSAGE,
} from '@mat-plan/shared';

import { GATE_PATH } from '../lib/access-gate';
import {
  AMEND_COPY,
  APP_HOME_PATH,
  BODYWEIGHT_COPY,
  changeLabel,
  STRENGTH_COPY,
  STRENGTH_RECEIPT_ID_PREFIX,
  DEFAULT_TIME_ZONE,
  MIN_TAP_TARGET_PX,
  PARTIAL_SETS_COPY,
  quantityInputLabel,
} from '../lib/constants';
import { localDayIso } from '../lib/date';
import { resolveDayRole } from '../lib/programming/day-role-schedule';
import {
  bodyweightSection,
  isoDaysAgo,
  logBodyweight,
  openStrengthForm,
  SEED_PROFILE_2_ROUTE,
  SEED_PROFILE_ROUTE,
  shownWeight,
  strengthSection,
} from './steps';
import { MOBILE_VIEWPORT, NO_GATE_STATE } from './contexts';

/**
 * V1-12 — the a11y bar, made executable.
 *
 * AGENTS.md states it as a RULE ("keyboard-usable, focus-visible, labeled controls, ≥44px tap targets,
 * numeric `inputmode`"), on an app "used primarily on phones and tablets — the kids log on the gym
 * floor". Until this spec it was enforced nowhere. Two independent checks, because neither covers the
 * other:
 *
 *  1. **axe** — the WCAG 2.0/2.1 A+AA rule set (labels, roles, contrast, landmarks, names).
 *  2. **A bespoke tap-target measurement** — axe genuinely CANNOT do this: its `target-size` rule is
 *     tagged `wcag22aa` (not in the sets scanned below) and its threshold is 24×24px, while this
 *     project's bar is 44. A green axe run alone would be false comfort.
 *
 * MOBILE ONLY (390px) by design: the axe rules that fire here are DOM/label/contrast rules that don't
 * vary with viewport width, and control HEIGHT doesn't either — so a tri-viewport matrix would triple
 * the runtime for near-zero marginal signal. Desktop is the secondary case (AGENTS.md).
 */

/**
 * The NARROWEST width AGENTS.md commits to ("every screen must work from ~360px up"). 390 is the
 * device; 360 is the contract, and the two are not the same test — the strength set row's own
 * comments budget against ~294px of usable width, which only exists at 360.
 *
 * Added at GAP-3 PR 4a, because the panel found this spec asserted neither 360 nor overflow: the
 * acceptance criterion "works at 360px with no horizontal scroll" was being claimed by a file that
 * never measured either.
 */
const NARROW = { width: 360, height: 780 };

/** The routes the household actually uses. The PUBLIC routes (`/`, `/gate`) are scanned separately
 *  below, in a storage-state-free context: the project's cookie would redirect past both. */
const ROUTES = [
  { name: 'profile picker', path: APP_HOME_PATH },
  { name: 'Today', path: SEED_PROFILE_ROUTE },
  { name: 'routine editor', path: `${SEED_PROFILE_ROUTE}/routine` },
] as const;

/**
 * Interactive controls that must meet the tap-target bar.
 *
 * `input:not([type="hidden"])` — a hidden input has NO bounding box (`boundingBox()` → null), so an
 * unfiltered selector would throw rather than assert; the app has several (the routine editor's JSON
 * field, the check-in client-ids, the gate's `from`).
 *
 * `<a>` is EXCLUDED: WCAG 2.2 SC 2.5.8 has an explicit exception for links inline in a block of text,
 * and the app's links ("← All profiles", "Edit routine") are exactly that — growing them to 44px would
 * be a visual regression, not a fix. Link CARDS that behave like buttons are opted in separately below.
 */
const INTERACTIVE = 'button, [role="button"], select, textarea, input:not([type="hidden"])';

/**
 * A checkbox/radio's own box is intentionally small (20px here) — its ACTIVATABLE AREA is the bound
 * `<label>`, which is what a thumb aims at and what the browser actually toggles. WCAG target size
 * measures the activatable region, so measuring the 20px box would be measuring the wrong thing and
 * would push us toward a 44px checkbox glyph, which is not the fix. For these, we measure the label.
 */
const LABEL_MEASURED = ['checkbox', 'radio'];

/**
 * The element whose height represents this control's real tap target: normally itself, but for a
 * checkbox/radio the `<label for=…>` that activates it. Returns `null` when a checkbox has no bound
 * label — which is itself a defect, reported by the caller rather than silently skipped.
 */
async function targetOf(page: Page, control: Locator): Promise<Locator | null> {
  const type = await control.getAttribute('type');
  if (!type || !LABEL_MEASURED.includes(type)) return control;

  // EXPLICIT association: <label for="id">. NOT `CSS.escape` — that is a BROWSER global and this runs
  // in Node. The id sits inside a quoted attribute selector, so only a quote or backslash needs
  // escaping (the app's ids contain ':' from `activityKey:metricKey`, which is fine inside quotes).
  const id = await control.getAttribute('id');
  if (id) {
    const explicit = page.locator(`label[for="${id.replace(/["\\]/g, '\\$&')}"]`);
    if ((await explicit.count()) === 1) return explicit;
  }

  // IMPLICIT association: the control is WRAPPED in its <label> (equally valid HTML, and what the
  // superset toggle uses). Checking only `label[for]` would report a false defect here.
  const implicit = control.locator('xpath=ancestor::label[1]');
  return (await implicit.count()) === 1 ? implicit : null;
}

/** Assert every VISIBLE interactive control on the page clears the tap-target bar. */
async function expectTapTargets(
  page: Page,
  context: string,
  opts: { expectControls?: boolean } = {},
): Promise<void> {
  const controls = await page.locator(INTERACTIVE).all();
  // A guard against the selector silently matching nothing (which would make this whole assertion
  // vacuous). Opt-out for the picker, which legitimately has only link-cards — those are measured by
  // their own test, since links are excluded here under the SC 2.5.8 inline exception.
  if (opts.expectControls !== false) {
    expect(
      controls.length,
      `${context}: found no interactive controls — selector is wrong`,
    ).toBeGreaterThan(0);
  }

  const undersized: string[] = [];
  for (const control of controls) {
    if (!(await control.isVisible())) continue; // collapsed/conditional UI has no target to hit
    const target = await targetOf(page, control);
    if (!target) {
      undersized.push(`${await describe(control)} → no bound <label> to act as its tap target`);
      continue;
    }
    const box = await target.boundingBox();
    if (!box) continue; // visible but unrendered (0-area) — nothing to measure
    if (box.height < MIN_TAP_TARGET_PX) {
      undersized.push(`${await describe(control)} → ${Math.round(box.height)}px`);
    }
  }
  expect(undersized, `${context}: controls under ${MIN_TAP_TARGET_PX}px tall`).toEqual([]);
}

/** A human-readable identifier for a failing control, so the assertion names the culprit. */
async function describe(control: Locator): Promise<string> {
  const [tag, label, text] = await Promise.all([
    control.evaluate((el) => el.tagName.toLowerCase()),
    control.getAttribute('aria-label'),
    control.innerText().catch(() => ''),
  ]);
  return `<${tag}> "${(label ?? text ?? '').trim().slice(0, 40) || '(unnamed)'}"`;
}

/** Scan with the WCAG 2.0/2.1 A + AA rule sets. Zero tolerance — no allowlist (nothing to grandfather
 *  on a first scan), and the dependency is EXACTLY pinned so a rule-set bump can't redden an unrelated PR. */
async function expectNoAxeViolations(page: Page, context: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(
    violations.map((v) => `${v.id} (${v.nodes.length}): ${v.help}`),
    `${context}: axe violations`,
  ).toEqual([]);
}

test.use({ viewport: MOBILE_VIEWPORT });

for (const route of ROUTES) {
  test(`${route.name} has no WCAG A/AA violations and meets the tap-target bar`, async ({
    page,
  }) => {
    await page.goto(route.path, { waitUntil: 'networkidle' });
    await expectNoAxeViolations(page, route.name);
    await expectTapTargets(page, route.name, { expectControls: route.path !== APP_HOME_PATH });
  });
}

test('the strength form meets the tap-target bar in its EXPANDED state', async ({ page }) => {
  // THE most important case in this file. "Remove movement" renders only with ≥2 movements and
  // "Remove set" only with ≥2 sets, so both are absent from the default DOM — a scan of the initial
  // page would find only "Add set", go green after that one fix, and ship the other two. Drive the
  // form into the state where every control exists, then measure.
  await page.goto(SEED_PROFILE_ROUTE, { waitUntil: 'networkidle' });

  const strength = strengthSection(page);
  await openStrengthForm(page);
  await strength.getByRole('button', { name: 'Add movement' }).click();
  await strength.getByRole('button', { name: 'Add set' }).first().click();

  // Prove the conditional controls really are present now — otherwise this test could pass by
  // measuring the same DOM as the one above.
  await expect(strength.getByRole('button', { name: /^Remove movement/ }).first()).toBeVisible();
  await expect(
    strength.getByRole('button', { name: /^Remove movement \d+ set/ }).first(),
  ).toBeVisible();

  await expectTapTargets(page, 'strength form (expanded)');
  await expectNoAxeViolations(page, 'strength form (expanded)');
});

/**
 * Horizontal overflow, at the narrowest committed width.
 *
 * `expectTapTargets` measures control HEIGHT only, so a row that runs off the side of the phone
 * passes every other scan in this file. That is the exact failure mode a new control in the set row
 * introduces, and PR 4a adds two (the Measuring select, and the unit echo after the weight field).
 */
async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const d = document.documentElement;
    return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth };
  });
  expect(
    overflow.scrollWidth,
    `${label}: the page scrolls horizontally at ${NARROW.width}px ` +
      `(scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth})`,
  ).toBeLessThanOrEqual(overflow.clientWidth);
}

test('the strength form does not overflow horizontally at 360px', async ({ page }) => {
  await page.setViewportSize(NARROW);
  await page.goto(SEED_PROFILE_ROUTE, { waitUntil: 'networkidle' });

  const strength = strengthSection(page);
  await openStrengthForm(page);
  await strength.getByRole('button', { name: 'Add movement' }).click();
  await strength.getByRole('button', { name: 'Add set' }).first().click();

  // Drive the set row into its WIDEST state — both mode toggles on — so the measurement covers the
  // row as it actually renders when a bodyweight movement is logged, not the emptiest case.
  //
  // Clicked by LABEL, not `.check()` on the input: the checkbox is `sr-only` (visually hidden but
  // focusable and operable), so its own box is 1px and Playwright's actionability check fails on it.
  // The label IS the chip a thumb aims at, so this drives it exactly as a person does.
  await strength.getByText('BW', { exact: true }).first().click();
  await strength.getByText('band', { exact: true }).first().click();
  await expect(strength.getByRole('checkbox', { name: /^BW — Bodyweight/ }).first()).toBeChecked();

  await expectNoHorizontalOverflow(page, 'strength form (360px, modes on)');
  await expectTapTargets(page, 'strength form (360px)');

  // V1-27 — set 1 is touched and set 2 is an empty trailing row, so this card is MIXED: the
  // "empty sets at the end" hint and the summary line are on screen. Scan that state too.
  await expect(strength.getByText(PARTIAL_SETS_COPY.trailingHint)).toBeVisible();
  await expectNoAxeViolations(page, 'strength form (360px, mixed card with the V1-27 hint)');

  // V1-27 — the BLOCKED state, by keyboard. The hand-added card's name is blank and set 1 (BW + band,
  // no reps) is touched, so the browser would refuse the tap; the summary must name the first blocker,
  // fit at 360px, pass axe, and a keyboard Enter on Log strength must land focus on that field.
  const submit = strength.getByRole('button', { name: STRENGTH_COPY.submit, exact: true });
  await expect(strength.getByText('Movement 1 needs a name.')).toBeVisible();
  await expectNoHorizontalOverflow(page, 'strength form (360px, blocked summary)');
  await expectNoAxeViolations(page, 'strength form (360px, blocked)');
  // Card 1 (the form opens with a card; the test added a second, which is blank and dropped).
  const name1 = strength
    .getByRole('group', { name: 'Movement 1' })
    .getByLabel('Movement', { exact: true });
  await submit.focus();
  await page.keyboard.press('Enter');
  await expect(name1).toBeFocused();

  // Name it: the next blocker is set 1's reps, and the summary follows.
  await name1.fill('Push-ups');
  await expect(strength.getByText('Push-ups set 1 needs finishing.')).toBeVisible();
  await submit.focus();
  await page.keyboard.press('Enter');
  await expect(strength.getByLabel('Movement 1 set 1 reps')).toBeFocused();
});

/**
 * V1-24 PR 1a — the weigh-in in BOTH its states, deterministically.
 *
 * Scarlett's YESTERDAY is this test's alone (the e2e rule in `global.setup.ts`): the warm-up owns her
 * today and no other spec writes to her yesterday, so on a first attempt the form is guaranteed and
 * the receipt is the one this test creates. Scanning Liam's Today instead would audit form OR receipt
 * depending on which spec ran first.
 *
 * Logs the WIDEST legal value, so the 360px check measures the receipt at its longest line. `500 lb`
 * is the plausibility bound's ceiling (`BODYWEIGHT_BOUNDS`), which the form accepts; the recovery
 * line below it is the longest copy and wraps by design.
 *
 * Between the two, on the first attempt, it also drives the form's REJECTED state (an implausible
 * value) and pins that what was typed — value and unit — survives it.
 */
test('the weigh-in is accessible as an empty form AND as a receipt, at 360px (V1-24)', async ({
  page,
}, testInfo) => {
  await page.setViewportSize(NARROW);
  await page.goto(`${SEED_PROFILE_2_ROUTE}?d=${isoDaysAgo(1)}`, { waitUntil: 'networkidle' });
  const section = bodyweightSection(page);
  const input = section.getByLabel('Weight', { exact: true });

  // A retry reuses the DB, so the first attempt's receipt is already there — only the first attempt
  // can (and therefore must) see the empty form.
  if (testInfo.retry === 0) {
    await expect(
      input,
      'Scarlett’s yesterday should be empty before this test logs it',
    ).toBeVisible();
  }
  if ((await input.count()) > 0) {
    await expectNoAxeViolations(page, 'weigh-in (empty form)');
    await expectTapTargets(page, 'weigh-in (empty form)');
    await expectNoHorizontalOverflow(page, 'weigh-in (empty form, 360px)');

    // THE REJECTED SAVE (round 2 on #180). Here, before the valid log, because a rejected save writes
    // nothing — so it cannot break the disjoint (profile, day) rule. A slipped decimal in the NON-default
    // unit: React 19 resets uncontrolled fields when a form action settles, even on `{ ok: false }`,
    // which emptied the input and snapped the unit back — so a kg user retyping `84.5` saved 84.5 lb.
    const unit = section.getByLabel('Unit', { exact: true });
    const otherUnit = BODYWEIGHT_UNITS.find((u) => u !== DEFAULT_BODYWEIGHT_UNIT)!;
    const slipped = '845'; // 84.5 with the decimal point dropped
    expect(Number(slipped)).toBeGreaterThan(BODYWEIGHT_BOUNDS[otherUnit].max);
    await unit.selectOption(otherUnit);
    await input.fill(slipped);
    await section.getByRole('button', { name: 'Log weight' }).click();
    await expect(section.getByRole('alert')).toHaveText(IMPLAUSIBLE_BODYWEIGHT_MESSAGE);
    await expect(input, 'the rejected value must survive, so the kid can fix it').toHaveValue(
      slipped,
    );
    await expect(unit, 'the unit must not snap back to the default').toHaveValue(otherUnit);
    await expectNoAxeViolations(page, 'weigh-in (rejected value)');

    // Back to the default unit for the valid log below (`logBodyweight` logs in it).
    await unit.selectOption(DEFAULT_BODYWEIGHT_UNIT);
  }

  const widest = String(BODYWEIGHT_BOUNDS[DEFAULT_BODYWEIGHT_UNIT].max);
  await logBodyweight(page, widest); // asserts the receipt value + focus on it

  // The full receipt copy is present — the widths below are measured WITH it.
  await expect(
    section.getByText(BODYWEIGHT_COPY.saved(shownWeight(widest)), { exact: true }),
  ).toBeVisible();
  await expect(section.getByText(BODYWEIGHT_COPY.onePerDay, { exact: true })).toBeVisible();

  await expectNoAxeViolations(page, 'weigh-in (receipt)');
  await expectTapTargets(page, 'weigh-in (receipt)');
  await expectNoHorizontalOverflow(page, 'weigh-in (receipt, 360px, widest value)');

  // ── V1-24 PR 1b: the OPEN editor, at 360px with the widest value ─────────────────────────────
  // No test had ever opened an edit form before this. Measured here with `widest` already on screen,
  // because that is the worst case: the longest value the bound allows, plus the editor's controls.
  //
  // ⚠️ These gates are the FLOOR, not what makes the editor safe — an inline editor passes all three
  // (flex wraps; the tap-target check measures height only). See `bodyweight-amend.tsx`.
  await section.getByRole('button', { name: /^Change weight/ }).click();
  await expect(section.getByLabel(/^Weight \(/)).toBeVisible();
  await expectNoAxeViolations(page, 'weigh-in (editing)');
  await expectTapTargets(page, 'weigh-in (editing)');
  await expectNoHorizontalOverflow(page, 'weigh-in (editing, 360px, widest value)');
});

/**
 * V1-24 3a-i — a logged strength set's Change, OPENED, at 360px. No test had ever opened this editor.
 *
 * Writes strength on **Scarlett's yesterday** (the a11y day: its other write is bodyweight, an
 * independent surface). Logs only if the probe isn't there yet, so a retry measures the same state.
 * The 280px superset-member case is the unit test's structural assertion (Save/Cancel on their own
 * row) plus the plan's width math; logging a superset through the UI here would cost far more.
 */
test('a logged strength set opens its Change editor accessibly at 360px (V1-24 3a-i)', async ({
  page,
}) => {
  const PROBE = 'A11y Probe Press';
  await page.setViewportSize(NARROW);
  await page.goto(`${SEED_PROFILE_2_ROUTE}?d=${isoDaysAgo(1)}`, { waitUntil: 'networkidle' });
  const entries = page.getByRole('region', { name: 'Logged entries', exact: true });

  if ((await entries.getByText(PROBE, { exact: true }).count()) === 0) {
    await openStrengthForm(page);
    const strength = strengthSection(page);
    await strength.getByLabel('Movement', { exact: true }).fill(PROBE);
    await strength.getByLabel('Movement 1 set 1 reps', { exact: true }).fill('12');
    await strength.getByLabel(/^Movement 1 set 1 weight/).fill('137.5'); // a wide value
    await strength.getByRole('button', { name: STRENGTH_COPY.submit, exact: true }).click();
    await expect(entries.getByText(PROBE, { exact: true })).toBeVisible({ timeout: 15_000 });
  }

  const subject = `${PROBE} set 1`;
  // Since V1-24 3a-ii the SECTION's receipt owns Change; the list copy is read-only beside it.
  const owner = strengthSection(page);
  const change = owner.getByRole('button', {
    name: changeLabel(subject, '12 × 137.5 lb'),
    exact: true,
  });
  await expect(change).toHaveText(AMEND_COPY.change);
  // Exactly ONE Change for this set on the whole PAGE: the list's copy is read-only (3a-ii, D1).
  await expect(
    page.getByRole('button', { name: changeLabel(subject, '12 × 137.5 lb'), exact: true }),
  ).toHaveCount(1);
  await change.click();
  await expect(owner.getByLabel(`${subject} reps`, { exact: true })).toBeFocused(); // focus on open
  await expect(owner.getByLabel(quantityInputLabel(subject, 'lb'), { exact: true })).toBeVisible();
  await expectNoAxeViolations(page, 'strength set (editing)');
  await expectTapTargets(page, 'strength set (editing)');
  await expectNoHorizontalOverflow(page, 'strength set (editing, 360px)');

  // Cancel returns focus to Change (the button that had it unmounts).
  await owner.getByRole('button', { name: AMEND_COPY.cancel, exact: true }).click();
  await expect(change).toBeFocused();
});

/**
 * V1-24 3a-ii — the strength SECTION as the day's record: receipts, the collapsed "Log more strength",
 * and the form opened from it. Writes strength on **Scarlett's today** (its other write is the warm-up
 * weigh-in, a different surface; Scarlett's yesterday holds 3a-i's probe). Logs only when no receipt
 * exists yet (gated on STATE, so a failed first attempt is healed by the retry); the focus assertions
 * run where that write happens, and the scans run every time.
 *
 * The superset bracket is covered by the receipt's unit tests and the screenshots; building one
 * through the UI here would cost more than it checks.
 */
test('the strength section renders saved sessions as receipts, at 360px (V1-24 3a-ii)', async ({
  page,
}, testInfo) => {
  await page.setViewportSize(NARROW);
  await page.goto(SEED_PROFILE_2_ROUTE, { waitUntil: 'networkidle' });
  const strength = strengthSection(page);
  const receipts = strength.locator(`[id^="${STRENGTH_RECEIPT_ID_PREFIX}"]`);
  const submit = strength.getByRole('button', { name: STRENGTH_COPY.submit, exact: true });
  const card = (n: number) => strength.getByRole('group', { name: `Movement ${n}`, exact: true });

  // Gated on the STATE, not the attempt number (docs/lessons.md: retry-safe writes): a first attempt
  // that died before its save leaves nothing behind, so the retry must write. The focus assertions
  // run only where this attempt did the writing.
  if ((await receipts.count()) === 0) {
    await openStrengthForm(page); // open by default here: nothing is logged, so there's no toggle
    await card(1).getByLabel('Movement', { exact: true }).fill('A11y Receipt Press');
    await strength.getByLabel('Movement 1 set 1 reps', { exact: true }).fill('5');
    await strength.getByLabel(/^Movement 1 set 1 weight/).fill('95');
    await strength.getByRole('button', { name: 'Add movement', exact: true }).click();
    await card(2).getByLabel('Movement', { exact: true }).fill('A11y Receipt Plank');
    await strength.getByLabel('Movement 2 set 1 reps', { exact: true }).fill('10');
    // `sr-only` chip: the input is 1px, so check it with `force` (the screenshot script's idiom).
    await strength
      .getByRole('checkbox', { name: 'BW — Bodyweight — movement 2 set 1', exact: true })
      .check({ force: true });
    await strength.getByRole('button', { name: 'Add movement', exact: true }).click();
    await card(3).getByLabel('Movement', { exact: true }).fill('A11y Receipt Skip');
    await strength.getByLabel('Movement 3 skipped', { exact: true }).check({ force: true });
    await submit.click();

    // The first save: the receipt renders, the form FOLDS (its submit is hidden), focus lands on it.
    await expect(receipts).toHaveCount(1, { timeout: 15_000 });
    await expect(submit).toBeHidden();
    const first = await receipts.first().getAttribute('id');
    await expect(page.locator(`[id="${first}"]`)).toBeFocused();

    // The second session of the day: focus lands on the NEW receipt.
    await openStrengthForm(page);
    await expect(strength.getByText(STRENGTH_COPY.alreadySaved('').split(':')[0]!)).toBeVisible();
    await card(1).getByLabel('Movement', { exact: true }).fill('A11y Receipt Rows');
    await strength.getByLabel('Movement 1 set 1 reps', { exact: true }).fill('8');
    await strength.getByLabel(/^Movement 1 set 1 weight/).fill('95');
    await submit.click();
    await expect(receipts).toHaveCount(2, { timeout: 15_000 });
    await expect(submit).toBeHidden();
    const second = await receipts.nth(1).getAttribute('id');
    await expect(page.locator(`[id="${second}"]`)).toBeFocused();
  } else {
    expect(testInfo.retry, 'receipts before any write: another spec logs Scarlett today').toBe(1);
  }

  await expect(receipts.first()).toBeVisible();
  await expectNoAxeViolations(page, 'strength section (receipts, collapsed)');
  await expectTapTargets(page, 'strength section (receipts, collapsed)');
  await expectNoHorizontalOverflow(page, 'strength section (receipts, collapsed, 360px)');

  await openStrengthForm(page);
  await expectNoAxeViolations(page, 'strength section (receipts, Log more open)');
  await expectTapTargets(page, 'strength section (receipts, Log more open)');
  await expectNoHorizontalOverflow(page, 'strength section (receipts, Log more open, 360px)');
});

/**
 * V1-23 PR 3 — "Today's program" collapses, and the COLLAPSED state is the one nothing else scans.
 *
 * The card is `<section aria-labelledby="program-…-heading">` with the `<h3 id=…>` in the `<summary>`.
 * Put that heading in the collapsible body instead and a closed card points `aria-labelledby` at an id
 * that is no longer in the accessibility tree — axe `aria-valid-attr-value`, which would fail the build,
 * but ONLY in a state a test has to click into. Every other scan in this file sees the card `open`.
 *
 * Runs at 360px (the narrowest committed width) so the summary's own row — heading + day label + the
 * chevron — is measured where it is tightest, in both states. The tap target is measured explicitly
 * because `INTERACTIVE` cannot see it: `<summary>`'s button role is IMPLICIT, and that selector matches
 * the `[role="button"]` ATTRIBUTE.
 */
test("Today's program card is accessible in BOTH its expanded and collapsed states", async ({
  page,
}) => {
  await page.setViewportSize(NARROW);
  await page.goto(SEED_PROFILE_ROUTE, { waitUntil: 'networkidle' });

  const strength = strengthSection(page);
  await openStrengthForm(page);
  // Resolving the card BY ITS ACCESSIBLE NAME is the assertion, not just a locator: the name comes from
  // `aria-labelledby`, so a `getByRole('region', { name })` that still matches proves the id resolves.
  const card = strength.getByRole('region', { name: /Today.s program/ });
  await expect(card, 'the program card should render on a programmed day').toBeVisible();

  const body = card.getByText('Reference only', { exact: false });
  await expect(
    body,
    'the card ships OPEN — reading the day is the point of the screen',
  ).toBeVisible();
  await expectNoHorizontalOverflow(page, "Today's program (expanded, 360px)");
  await expectNoAxeViolations(page, "Today's program (expanded)");

  const summary = card.locator('summary');
  await expect(summary).toHaveCount(1);
  const box = await summary.boundingBox();
  expect(
    Math.round(box?.height ?? 0),
    'the summary is the collapse control — it must clear the tap-target bar',
  ).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);

  await summary.click();
  await expect(body, 'clicking the summary should close the card').toBeHidden();

  // THE case this test exists for.
  await expect(
    card,
    'the heading id must still resolve with the body collapsed (aria-valid-attr-value)',
  ).toBeVisible();
  await expectNoAxeViolations(page, "Today's program (collapsed)");
  await expectNoHorizontalOverflow(page, "Today's program (collapsed, 360px)");

  // The collapse must not submit. A `<summary>` is not a form submitter at all, unlike the `<button>` a
  // naive trigger would be (no `type` → `type="submit"`): nothing was logged and nothing was rejected,
  // which is what the form's own status/alert regions would say.
  // The form's live region is always in the DOM but EMPTY until something happens, so "empty" is the
  // assertion, not "absent" — a submit would fill it, or raise an `alert` on rejection.
  await expect(strength.locator('form').getByRole('status')).toBeEmpty();
  await expect(strength.getByRole('alert')).toHaveCount(0);
  // And the card sits OUTSIDE the `<form>`, so the trap has no reach here. Pinned, because a future
  // change that moves it inside would silently re-arm it for any non-`<summary>` trigger.
  expect(
    await card.evaluate((el) => el.closest('form') !== null),
    'the program card sits outside the strength <form>',
  ).toBe(false);
});

/**
 * A timezone in which the seeded program actually has movements today.
 *
 * WHY THIS EXISTS: this test used to `test.skip()` when the scaffold button was absent, on the
 * reasoning that "a red check would mean it is Tuesday, not that a11y broke". True — but it made the
 * check **silently dead 4 days in 7** (the seed programs Mon/Wed/Fri only), and it conflated two very
 * different states: "not a programmed day" and "the button regressed and is gone". A real scaffold
 * regression on a Monday would have SKIPPED, green. GAP-3 PR 4a shipped without this test ever
 * running once.
 *
 * The fix rests on an arithmetic accident that is worth stating, because it is what makes this
 * deterministic rather than lucky: every UNprogrammed day is adjacent to a programmed one
 * (Sun→Mon, Tue→Mon/Wed, Thu→Wed/Fri, Sat→Fri). A timezone can move the local calendar date by at
 * most ±1 day — and ±1 is exactly enough, on every day of the week.
 *
 * Computed at module load (so `test.use` can take it) against the SAME `resolveDayRole` the app uses,
 * so the test and the page can never disagree about which day is programmed.
 */
const PROGRAMMED_TZ = ((): string => {
  // UTC+14 and UTC-11 are the real extremes of the tz database — the widest shift available.
  const candidates = [DEFAULT_TIME_ZONE, 'Pacific/Kiritimati', 'Pacific/Niue'];
  const found = candidates.find((tz) => resolveDayRole(localDayIso(tz)) !== null);
  if (!found) {
    // Unreachable given the adjacency above; throwing beats skipping, because a schedule change that
    // broke the assumption should be loud rather than quietly disabling the test again.
    throw new Error(
      `No timezone puts a programmed day in reach (tried ${candidates.join(', ')}). ` +
        'DAY_ROLE_BY_WEEKDAY probably changed — pick a tz that lands on a programmed weekday.',
    );
  }
  return found;
})();

test.describe('scaffolded state', () => {
  // Playwright's context timezone, NOT a cookie: `TimeZoneSync` rewrites the `tz` cookie from
  // `Intl.DateTimeFormat().resolvedOptions().timeZone` on every mount, so a cookie set from the test
  // is clobbered on first paint. Setting the context's zone makes the browser detect what we want,
  // which makes the cookie it writes — and the day the server renders — agree.
  test.use({ timezoneId: PROGRAMMED_TZ });

  test('the strength form meets the bar in its SCAFFOLDED state (V1-19)', async ({ page }) => {
    // The scaffold renders controls the two scans above never see: a collapsed-card disclosure per
    // movement, an Undo, and — once a card is opened — a full card nested among six siblings. Seven
    // cards' worth of chips and toggles is also precisely where horizontal overflow would first appear
    // at 390px, which the single-card expanded scan cannot surface.
    await page.goto(SEED_PROFILE_ROUTE, { waitUntil: 'networkidle' });

    const strength = strengthSection(page);
    await openStrengthForm(page);
    const fill = strength.getByRole('button', { name: /Fill in today.s movements/i });

    // NO skip. `PROGRAMMED_TZ` guarantees today programs strength, so an absent button is a real
    // regression and must be red.
    await expect(
      fill,
      `expected the scaffold button on a programmed day (tz ${PROGRAMMED_TZ}, ` +
        `day ${localDayIso(PROGRAMMED_TZ)}, role ${resolveDayRole(localDayIso(PROGRAMMED_TZ))})`,
    ).toBeVisible();

    await fill.click();
    // Prove the scaffolded DOM really is present, so this cannot pass by measuring the default form.
    await expect(strength.getByRole('button', { name: 'Undo' })).toBeVisible();
    await expect(strength.locator('form').getByRole('status')).toContainText(
      /Loaded \d+ movements/,
    );

    await expectTapTargets(page, 'strength form (scaffolded, collapsed)');
    await expectNoAxeViolations(page, 'strength form (scaffolded, collapsed)');

    // Then with a card open — the collapsed summary and a full card coexist only in this state.
    const summary = strength.getByRole('button', { name: /^\d+\. / }).first();
    if ((await summary.count()) > 0) {
      await summary.click();
      await expectTapTargets(page, 'strength form (scaffolded, one card open)');
      await expectNoAxeViolations(page, 'strength form (scaffolded, one card open)');
    }
  });
});

/**
 * Links that act as buttons (link CARDS, the landing's CTAs, the gate's way back) — opted back into the
 * tap-target bar one by one, since `INTERACTIVE` excludes links under SC 2.5.8's inline-link exception.
 * `expected` pins how many there are, so a page that lost one (or rendered none) cannot pass.
 */
async function expectLinkTapTargets(page: Page, context: string, expected?: number): Promise<void> {
  const links = await page.getByRole('main').getByRole('link').all();
  if (expected === undefined) {
    expect(links.length, `${context}: found no links — selector is wrong`).toBeGreaterThan(0);
  } else {
    expect(links.length, `${context}: link count`).toBe(expected);
  }
  for (const link of links) {
    const box = await link.boundingBox();
    expect(box?.height ?? 0, `${context} link "${await describe(link)}"`).toBeGreaterThanOrEqual(
      MIN_TAP_TARGET_PX,
    );
  }
}

test('profile tiles are large touch targets (the link-card exception to the inline-link rule)', async ({
  page,
}) => {
  // A profile tile is a CARD acting as a button, so it is opted back in explicitly.
  await page.goto(APP_HOME_PATH, { waitUntil: 'networkidle' });
  await expectLinkTapTargets(page, 'profile picker');
});

/**
 * OSS-2 — the public routes, scanned with NO gate cookie (with one, `/` and `/gate` both redirect to the
 * picker). The landing's CTAs and the gate's way back are LINKS, which `expectTapTargets` cannot see
 * (`Button asChild` adds no role), so they are counted and measured by `expectLinkTapTargets`.
 */
test.describe('public routes', () => {
  test.use({ storageState: NO_GATE_STATE });

  for (const viewport of [MOBILE_VIEWPORT, NARROW]) {
    test(`the landing at ${viewport.width}px: axe, no overflow, both CTA links ≥ the tap-target bar`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto('/', { waitUntil: 'networkidle' });
      await expectNoAxeViolations(page, `landing (${viewport.width}px)`);
      await expectNoHorizontalOverflow(page, `landing (${viewport.width}px)`);
      await expectLinkTapTargets(page, `landing (${viewport.width}px)`, 2);
    });

    test(`the gate at ${viewport.width}px: axe, no overflow, tap targets`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(GATE_PATH, { waitUntil: 'networkidle' });
      await expectNoAxeViolations(page, `gate (${viewport.width}px)`);
      await expectNoHorizontalOverflow(page, `gate (${viewport.width}px)`);
      await expectTapTargets(page, `gate (${viewport.width}px)`);
      await expectLinkTapTargets(page, `gate (${viewport.width}px)`, 1);
    });
  }
});
