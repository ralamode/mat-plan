import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

import { MIN_TAP_TARGET_PX } from '../lib/constants';
import { SEED_PROFILE_ROUTE } from './steps';

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

/** ~iPhone 14 — the primary device. Matches the mobile viewport the screenshot script captures at. */
const MOBILE = { width: 390, height: 844 };

/** The routes the household actually uses. `/gate` is deliberately excluded — the project's
 *  `storageState` lands every test past it, and scanning it needs a storage-state-free context
 *  (see the plan's Out of scope). */
const ROUTES = [
  { name: 'profile picker', path: '/' },
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

test.use({ viewport: MOBILE });

for (const route of ROUTES) {
  test(`${route.name} has no WCAG A/AA violations and meets the tap-target bar`, async ({
    page,
  }) => {
    await page.goto(route.path, { waitUntil: 'networkidle' });
    await expectNoAxeViolations(page, route.name);
    await expectTapTargets(page, route.name, { expectControls: route.path !== '/' });
  });
}

test('the strength form meets the tap-target bar in its EXPANDED state', async ({ page }) => {
  // THE most important case in this file. "Remove movement" renders only with ≥2 movements and
  // "Remove set" only with ≥2 sets, so both are absent from the default DOM — a scan of the initial
  // page would find only "Add set", go green after that one fix, and ship the other two. Drive the
  // form into the state where every control exists, then measure.
  await page.goto(SEED_PROFILE_ROUTE, { waitUntil: 'networkidle' });

  const strength = page.getByRole('region', { name: 'Log strength' });
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

test('the strength form meets the bar in its SCAFFOLDED state (V1-19)', async ({ page }) => {
  // The scaffold renders controls the two scans above never see: a collapsed-card disclosure per
  // movement, an Undo, and — once a card is opened — a full card nested among six siblings. Seven
  // cards' worth of chips and toggles is also precisely where horizontal overflow would first appear
  // at 390px, which the single-card expanded scan cannot surface.
  await page.goto(SEED_PROFILE_ROUTE, { waitUntil: 'networkidle' });

  const strength = page.getByRole('region', { name: 'Log strength' });
  const fill = strength.getByRole('button', { name: /Fill in today.s movements/i });

  // The seed only programs strength on certain weekdays, so the button is legitimately absent on
  // others. Skip rather than fail — a red check here would mean "it is Tuesday", not "a11y broke".
  if ((await fill.count()) === 0) {
    test.skip(true, 'no programmed movements today — nothing to scaffold');
    return;
  }

  await fill.click();
  // Prove the scaffolded DOM really is present, so this cannot pass by measuring the default form.
  await expect(strength.getByRole('button', { name: 'Undo' })).toBeVisible();
  await expect(strength.getByRole('status')).toContainText(/Loaded \d+ movements/);

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

test('profile tiles are large touch targets (the link-card exception to the inline-link rule)', async ({
  page,
}) => {
  // Links are excluded from INTERACTIVE because of the SC 2.5.8 inline exception — but a profile tile
  // is a CARD acting as a button, so it is opted back in explicitly.
  await page.goto('/', { waitUntil: 'networkidle' });
  for (const tile of await page.getByRole('main').getByRole('link').all()) {
    const box = await tile.boundingBox();
    expect(box?.height ?? 0, `profile tile "${await describe(tile)}"`).toBeGreaterThanOrEqual(
      MIN_TAP_TARGET_PX,
    );
  }
});
