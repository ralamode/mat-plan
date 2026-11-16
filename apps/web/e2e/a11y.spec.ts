import { SEED_PROFILE_PUBLIC_ID } from '@mat-plan/db';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  BODYWEIGHT_BOUNDS,
  BODYWEIGHT_UNITS,
  DEFAULT_BODYWEIGHT_UNIT,
  IMPLAUSIBLE_BODYWEIGHT_MESSAGE,
} from '@mat-plan/shared';

import {
  ADD_ATHLETE_PATH,
  APP_HOME_PATH,
  BODYWEIGHT_COPY,
  MAIN_CONTENT_ID,
  MIN_TAP_TARGET_PX,
  NAV_RAIL_COPY,
  PRIVACY_PATH,
  SETTINGS_PATH,
  SIGN_IN_COPY,
  SIGN_IN_PATH,
  THEME_STORAGE_KEY,
  TOKEN_SETS_PATH,
  athleteEditPath,
  athleteRoutinePath,
} from '../lib/constants';
import {
  bodyweightSection,
  isoDaysAgo,
  logBodyweight,
  SEED_PROFILE_2_ROUTE,
  SEED_PROFILE_ROUTE,
  loggedWeight,
} from './steps';
import {
  DESKTOP_VIEWPORT,
  expectNoHorizontalOverflow,
  MOBILE_VIEWPORT,
  NARROW_VIEWPORT,
  navRail,
} from './contexts';

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

/** The routes the household actually uses. The PUBLIC routes (`/`, `/privacy`, `/sign-in`) are
 *  scanned separately below. ⚠️ Said "(`/`, `/gate`) … in a storage-state-free context: the project's
 *  cookie would redirect past both" — both the route and the mechanism are gone at `AUTH-1` 1d. */
const ROUTES = [
  { name: 'profile picker', path: APP_HOME_PATH },
  { name: 'Today', path: SEED_PROFILE_ROUTE },
  // ⚠️ KEPT after PROF-1 a-r unlinked it (criterion 11 / M30): the route still exists and still
  // renders, so dropping it from the scan would silently stop auditing a reachable page. It is
  // unlinked, not deleted — ACT-1 replaces it.
  { name: 'routine editor', path: athleteRoutinePath(SEED_PROFILE_PUBLIC_ID) },
  // PROF-1 a-r. The rename form is the first screen in the app whose only control WRITES a value a
  // person typed, so a label or focus defect here costs more than on a logging surface.
  { name: 'rename athlete', path: athleteEditPath(SEED_PROFILE_PUBLIC_ID) },
  // PROF-1 b. Household settings is the app's only administrative screen and the only one that
  // renders two lists of the same row shape, so an axe or heading-order defect here is the kind that
  // would be fixed in one section and missed in the other.
  { name: 'household settings', path: SETTINGS_PATH },
  // PROF-1 a-1u. The add screen is the app's only RADIO GROUP and its only multi-field form, so it
  // is the one place a fieldset/legend or grouping defect can exist at all. It also carries the one
  // irreversible choice in the app, which is the worst place for a label a screen reader cannot
  // associate with its control.
  { name: 'add athlete', path: ADD_ATHLETE_PATH },
  // UI-6. The app's own 404 replaced Next's built-in one, which the CSP left unstyled. It is the page
  // a stale link or a mistyped id lands on, and it carries the footer, so its landmark count is
  // checked with the rest.
  // Its one control is a LINK, which the tap-target scan excludes (SC 2.5.8's inline exception), so
  // it opts out of the no-controls guard; `log-bodyweight.spec.ts` measures that CTA directly.
  { name: 'not found', path: `${APP_HOME_PATH}/does-not-exist`, expectControls: false },
  // UI-4: the token-set preview. It is in the scan because it is where the four CANDIDATE palettes
  // get their contrast audit — a bad candidate reddens CI before a human spends a review on it. It
  // leaves with the harness when UI-3 picks a set.
  { name: 'token sets', path: TOKEN_SETS_PATH },
] as const;

/**
 * Interactive controls that must meet the tap-target bar.
 *
 * `input:not([type="hidden"])` — a hidden input has NO bounding box (`boundingBox()` → null), so an
 * unfiltered selector would throw rather than assert; the app has several (the routine editor's JSON
 * field, the check-in client-ids, the gate's `from`).
 *
 * `<a>` is EXCLUDED: WCAG 2.2 SC 2.5.8 has an explicit exception for links inline in a block of text,
 * and the app's links ("← All athletes", "→ Edit {name}") are exactly that — growing them to 44px
 * would be a visual regression, not a fix. Link CARDS that behave like buttons are opted in
 * separately below.
 * ⚠️ **The consequence, now that those links carry `min-h-11` anyway:** nothing in THIS file asserts
 * it. `athletes.spec.ts` measures the edit page's back link, because a link that is the recovery
 * path from a writing screen is not "inline in a block of text" in any useful sense.
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
    // Every route now has at least one real control: UI-4 put the theme switch on the picker, which
    // used to be the one page with only link-cards. Keeping the opt-out would have left the
    // "selector matched nothing" guard switched off on a page that can now trip it.
    await expectTapTargets(page, route.name, {
      expectControls: 'expectControls' in route ? route.expectControls : undefined,
    });
  });
}

/**
 * The same scan in DARK MODE (UI-4) — the dark palette's first real audit. It has been defined in
 * `globals.css` since the scaffold and, until this PR, unreachable: nothing set `.dark`, so axe has
 * only ever measured the light theme.
 *
 * AXE ONLY, no tap targets: control HEIGHT does not vary with the theme, which is the same argument
 * this file already makes for not running a tri-viewport matrix. Doubling the cheap half is worth it;
 * doubling the expensive half is not.
 *
 * ⚠️ The guard on the first line is the point. `colorScheme` emulation only matters while nothing is
 * STORED — a `mp_theme` value in the project's `storageState` would win, and the scan would audit
 * light while reporting green on "dark". This file has shipped that exact failure before (the
 * weekday-conditional scaffold check that was silently dead four days in seven), so the theme is
 * asserted before anything is measured.
 */
test.describe('dark theme', () => {
  test.use({ colorScheme: 'dark' });

  for (const route of ROUTES) {
    test(`${route.name} has no WCAG A/AA violations in dark mode`, async ({ page }) => {
      await page.addInitScript((key) => {
        try {
          window.localStorage.removeItem(key as string);
        } catch {
          /* ignore */
        }
      }, THEME_STORAGE_KEY);
      await page.goto(route.path, { waitUntil: 'networkidle' });
      await expect(
        page.locator('html'),
        `${route.name}: not actually rendering dark — this scan would have audited the LIGHT palette`,
      ).toHaveClass(/\bdark\b/);
      await expectNoAxeViolations(page, `${route.name} (dark)`);
    });
  }
});

/**
 * UI-4 — the token preview at 360px, measured PER SET.
 *
 * The `ROUTES` loop above runs axe and tap targets only; `expectNoHorizontalOverflow` is opt-in per
 * test, so adding a route to that list buys no overflow coverage at all — and this is the one new
 * page whose whole purpose is to vary `--spacing` and `--radius`. Tatami is 1.12× density, and the
 * strength set row it renders budgets against ~294px of the 328px a 360px phone has, so overflow is
 * the plausible failure, not a theoretical one.
 *
 * Measured per `[data-tokens]` section rather than page-wide, because `documentElement.scrollWidth`
 * would tell UI-3 that "the page overflows" without naming which candidate is disqualified.
 */
test('the token preview does not overflow at 360px, in any set', async ({ page }) => {
  await page.setViewportSize(NARROW_VIEWPORT);
  await page.goto(TOKEN_SETS_PATH, { waitUntil: 'networkidle' });

  await expectNoHorizontalOverflow(page, 'token sets');

  const cells = await page.locator('[data-tokens]').all();
  // Not vacuous: the scoped sets must actually be on the page for this to measure anything.
  expect(cells.length, 'no [data-tokens] sections found — the selector is wrong').toBeGreaterThan(
    2,
  );
  const overflowing: string[] = [];
  for (const cell of cells) {
    const result = await cell.evaluate((el) => ({
      id: el.getAttribute('data-tokens') ?? '(control)',
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    // 1px of tolerance: sub-pixel layout rounding, not a layout defect.
    if (result.scrollWidth > result.clientWidth + 1) {
      overflowing.push(`${result.id} (${result.scrollWidth} > ${result.clientWidth})`);
    }
  }
  expect(overflowing, `token sets overflowing at ${NARROW_VIEWPORT.width}px`).toEqual([]);
});

/**
 * V1-24 PR 1a — the weigh-in in BOTH its states, deterministically.
 *
 * Athlete Two's YESTERDAY is this test's alone (the e2e rule in `global.setup.ts`): the warm-up owns their
 * today and no other spec writes to their yesterday, so on a first attempt the form is guaranteed and
 * the receipt is the one this test creates. Scanning Athlete One's Today instead would audit form OR receipt
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
  await page.setViewportSize(NARROW_VIEWPORT);
  await page.goto(`${SEED_PROFILE_2_ROUTE}?d=${isoDaysAgo(1)}`, { waitUntil: 'networkidle' });
  const section = bodyweightSection(page);
  const input = section.getByLabel('Weight', { exact: true });

  // A retry reuses the DB, so the first attempt's receipt is already there — only the first attempt
  // can (and therefore must) see the empty form.
  if (testInfo.retry === 0) {
    await expect(
      input,
      'Athlete Two’s yesterday should be empty before this test logs it',
    ).toBeVisible();
  }
  if ((await input.count()) > 0) {
    await expectNoAxeViolations(page, 'weigh-in (empty form)');
    await expectTapTargets(page, 'weigh-in (empty form)');
    await expectNoHorizontalOverflow(page, 'weigh-in (empty form, 360px)');

    // V1-24 3b-bw (plan W1): the field and the ✓ share ONE row at 360px, and the ✓ is a full 44px
    // wide. Neither gate above sees a ✓ wrapped onto its own line, or a width below the target
    // (`expectTapTargets` measures height).
    const tick = section.getByRole('button', { name: BODYWEIGHT_COPY.logLabel });
    const [fieldBox, tickBox] = [await input.boundingBox(), await tick.boundingBox()];
    expect(tickBox!.width, 'the ✓ is at least 44px wide').toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
    expect(
      Math.abs(fieldBox!.y + fieldBox!.height - (tickBox!.y + tickBox!.height)),
      'the field and the ✓ sit on one row at 360px',
    ).toBeLessThanOrEqual(2);

    // An empty ✓ is refused in the browser, with the copy and focus on the field (plan W3).
    await tick.click();
    await expect(section.getByRole('alert')).toContainText('Enter your bodyweight');
    await expect(input).toBeFocused();
    await expectNoAxeViolations(page, 'weigh-in (empty ✓ refused)');

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
    await section.getByRole('button', { name: BODYWEIGHT_COPY.logLabel }).click();
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
  await logBodyweight(page, widest); // asserts the logged value + focus on Change

  // The logged row is present — the widths below are measured WITH it.
  await expect(loggedWeight(page, widest)).toBeVisible();

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
  // V1-24 3b-bw: emptied, Save reads Clear in the destructive style, on the logged row's tint.
  const editorField = section.getByLabel(/^Weight \(/);
  await editorField.fill('');
  const clear = section.getByRole('button', { name: BODYWEIGHT_COPY.clearLabel });
  await expect(clear).toBeVisible();
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  await expectNoAxeViolations(page, 'weigh-in (editing, Save reads Clear)');
  await editorField.fill(widest);
  await expectTapTargets(page, 'weigh-in (editing)');
  await expectNoHorizontalOverflow(page, 'weigh-in (editing, 360px, widest value)');
});

/**
 * Links that act as buttons (link CARDS, the landing's CTAs, the gate's way back) — opted back into the
 * tap-target bar one by one, since `INTERACTIVE` excludes links under SC 2.5.8's inline-link exception.
 * `expected` pins how many there are, so a page that lost one (or rendered none) cannot pass.
 *
 * ⚠️ **`root`, not `page`, since `UI-5`.** It read `page.getByRole('main')` internally, which is
 * exactly the scope the nav rail is outside of — `site-footer.tsx`'s docblock records that staying
 * outside `main` is what keeps these counts stable. A second copy differing only in its root would
 * have been the third version of this loop in the file.
 */
async function expectLinkTapTargets(
  root: Locator,
  context: string,
  expected?: number,
): Promise<void> {
  const links = await root.getByRole('link').all();
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
  await expectLinkTapTargets(page.getByRole('main'), 'profile picker');
});

/**
 * ONB-0 — the picker at 360px.
 *
 * The `ROUTES` loop above runs axe + tap targets only, at 390px, and `expectNoHorizontalOverflow` is
 * opt-in per test (see the comment on the token-preview test) — so until this, the app's front door had
 * NO 360px coverage and no overflow coverage at all, seeded or empty. ONB-0's plan initially claimed it
 * did, which is the kind of gate-that-isn't this file exists to stop.
 *
 * ⚠️ This measures the SEEDED picker. The EMPTY picker — ONB-0's actual subject — cannot be reached from
 * any spec: `playwright.config.ts` is `fullyParallel: true` and the `a11y` and `chromium` projects share
 * one database, so hiding the seeded profiles here would break `selectProfile` in every other spec. Its
 * axe + overflow coverage comes from `/design/tokens`, where `PickerEmptyState` renders as an inventory
 * cell (both themes, per-cell 360px overflow); `--state no-profiles` renders it for screenshots.
 */
test('the profile picker does not overflow at 360px', async ({ page }) => {
  await page.setViewportSize(NARROW_VIEWPORT);
  await page.goto(APP_HOME_PATH, { waitUntil: 'networkidle' });
  await expectNoAxeViolations(page, 'profile picker (360px)');
  await expectNoHorizontalOverflow(page, 'profile picker (360px)');
});

/**
 * OSS-2 — the public routes. ⚠️ This said "scanned with NO gate cookie (with one, `/` and `/gate`
 * both redirect to the picker)"; `1c-3b` deleted that forward and `1d` the cookie, so there is no
 * cookie to withhold and `/` renders the landing for everyone. The landing's CTAs are LINKS, which `expectTapTargets` cannot see (`Button asChild` adds
 * no role), so they are counted and measured by `expectLinkTapTargets`.
 */
test.describe('public routes', () => {
  for (const viewport of [MOBILE_VIEWPORT, NARROW_VIEWPORT]) {
    test(`the landing at ${viewport.width}px: axe, no overflow, both CTA links ≥ the tap-target bar`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto('/', { waitUntil: 'networkidle' });
      await expectNoAxeViolations(page, `landing (${viewport.width}px)`);
      await expectNoHorizontalOverflow(page, `landing (${viewport.width}px)`);
      await expectLinkTapTargets(page.getByRole('main'), `landing (${viewport.width}px)`, 2);
    });

    /**
     * PRIV-2 — the privacy notice: ~200 lines of prose, two `<dl>`s and the app's first long-form
     * page, read on a phone.
     *
     * ⚠️ Neither tap-target helper is called here, deliberately. `expectTapTargets` would match
     * NOTHING (the page has no button, select, textarea or input at all) and fail its own
     * "selector is wrong" guard; `expectLinkTapTargets` measures every link in `<main>`, and the
     * notice's two prose links legitimately sit under WCAG 2.2 SC 2.5.8's inline-link exception —
     * the same exception `INTERACTIVE` above already encodes by excluding `<a>`. The FOOTER's two
     * links are measured directly in `privacy.spec.ts`, where they are also the subject.
     *
     * No separate dark-mode axe pass either: the renderer introduces no colour of its own, only
     * tokens the `dark theme` describe already audits, and contrast is a property of the token
     * pair. The two dark SCREENSHOTS are where a long-form page's palette is judged.
     */
    test(`the privacy notice at ${viewport.width}px: axe, no overflow`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(PRIVACY_PATH, { waitUntil: 'networkidle' });
      await expectNoAxeViolations(page, `privacy (${viewport.width}px)`);
      await expectNoHorizontalOverflow(page, `privacy (${viewport.width}px)`);
    });

    /**
     * AUTH-1 1a — the sign-in screen, the THIRD public route. This describe ENUMERATES routes, so a
     * new one joins no gate until somebody adds it; `app/pages-need-a-session.test.ts` globs, which is
     * why that half is easy to assume covers this one.
     *
     * ⚠️ **This measures the DARK state, and nothing in this repo can measure the other one.** CI has
     * no Clerk keys, so `/sign-in` renders the plain fallback panel here; the keys-present state is
     * Clerk's own CDN-shipped DOM, at a FLOATING MAJOR (`@clerk/clerk-js@6`, `@clerk/ui@1` —
     * `@clerk/shared/dist/versionSelector.mjs`), on a page this project cannot reach without an
     * instance. So no a11y property of Clerk's card is pinned by anything here
     * (`docs/tech-debt.md` carries the row). Naming that is the point: a test called "sign-in" that
     * reported green over a vendor card it never loaded would be the gate-that-isn't this file exists
     * to stop.
     *
     * ⚠️ `expectTapTargets` is NOT called, for the reason the notice above records: the fallback has
     * no button, select, textarea or input — its links are the mark (home) and the privacy notice —
     * so the selector would match nothing and fail its own "selector is wrong" guard.
     * `expectLinkTapTargets` is the right helper, and the count is exact: **TWO** links in `<main>`.
     *
     * 🔴 **It was ONE, and both halves of that comment are now false** _(AUTH-1 1d PR 0)_. The one
     * link used to be the way out to the gate, with `/` and `PRIVACY_PATH` "deliberately absent
     * because the footer already carries them". This screen no longer renders the footer at all
     * (`SiteFooter` returns null on the sign-in subtree), so it carries its own: the mark links home
     * above the card, the privacy notice sits below it. The count is still EXACT on purpose — a third
     * link appearing here should go red and be measured, not pass quietly.
     * ⚠️ CI has no Clerk keys, so this only ever measures the DARK state. Lit, Clerk's own
     * attribution adds a third link inside the card, which is vendor DOM and 48×14px — the known
     * exception on `docs/tech-debt.md`'s floating-major row.
     */
    test(`the sign-in screen at ${viewport.width}px: axe, no overflow, its two links`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto(SIGN_IN_PATH, { waitUntil: 'networkidle' });
      await expectNoAxeViolations(page, `sign-in, dark state (${viewport.width}px)`);
      await expectNoHorizontalOverflow(page, `sign-in, dark state (${viewport.width}px)`);
      await expectLinkTapTargets(
        page.getByRole('main'),
        `sign-in, dark state (${viewport.width}px)`,
        2,
      );

      // 🔴 **Positive content assertions, which the plan asked for and the first pass omitted.**
      // The three checks above would all pass on a page whose heading and copy had vanished — axe
      // does not require text, the overflow check wants less of it, and the link count is satisfied
      // by the two chrome links alone. On the app's only door that is not enough.
      await expect(
        page.getByRole('heading', { level: 1, name: SIGN_IN_COPY.heading, exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('main')).toContainText(SIGN_IN_COPY.notYet);

      // 🔴 **The footer's ABSENCE is why the count above is 2, so assert it rather than leave it
      // implicit.** Until now it was proved only as a side effect — a strict-mode collision in
      // `landing.spec.ts` when two links shared an accessible name. That is the exact bug #333
      // shipped and this PR fixed, so it gets a direct assertion.
      await expect(page.getByRole('contentinfo')).toHaveCount(0);
    });
  }
});

/**
 * U0 — the shared sheet, scanned OPEN.
 *
 * 🔴 **The cold `ROUTES` loop never opens it**, so without this the only modal surface in the app
 * would be audited exclusively in its closed state, which renders nothing.
 *
 * ⚠️ **This coverage is on borrowed time.** `app/design/tokens/page.tsx` says the UI-3 PR that picks
 * a token set deletes that directory — and this is the only mounted sheet until `PICK-1` PR 4 adds
 * the open picker. **UI-3 must not land before PICK-1 PR 4**, or the back gesture and the geometry
 * stop being proven by anything. `docs/roadmap.md` carries the ordering.
 */
test.describe('U0 — the sheet, open', () => {
  const openSheet = async (page: Page) => {
    await page.goto(TOKEN_SETS_PATH, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Open sheet' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    return page.getByRole('dialog');
  };

  test('passes axe and keeps its targets tappable at 360px', async ({ page }) => {
    await page.setViewportSize(NARROW_VIEWPORT);
    const dialog = await openSheet(page);

    await expectNoAxeViolations(page, 'sheet (open)');

    // 🔴 **Measured on the DIALOG, not the document.** `expectNoHorizontalOverflow` compares
    // `documentElement.scrollWidth` to its `clientWidth`, and a `position: fixed` box contributes
    // nothing to that — `RemoveScroll` also sets `body { overflow: hidden }` while the sheet is
    // open. An overflowing sheet would sail through the helper every other screen uses.
    const overflows = await dialog.evaluate((d) => d.scrollWidth > d.clientWidth);
    expect(overflows, 'the open sheet must not scroll sideways at 360px').toBe(false);

    for (const name of ['Close', 'Use as typed', 'Toggle the status message']) {
      const box = await dialog.getByRole('button', { name }).first().boundingBox();
      expect(box, `"${name}" is rendered`).not.toBeNull();
      expect(box!.height, `"${name}" clears the tap bar`).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
    }
  });

  test('announces a change from inside itself — a page-level region would be aria-hidden', async ({
    page,
  }) => {
    const dialog = await openSheet(page);
    const status = dialog.getByRole('status');
    await expect(status).toHaveText('');
    await dialog.getByRole('button', { name: 'Toggle the status message' }).click();
    // Criterion 46: the region has to be a DESCENDANT, because Radix `aria-hidden`s every sibling
    // of the portal while the sheet is open.
    await expect(status).toHaveText('3 matches');
  });

  test('the portaled surface carries the cell’s palette', async ({ page }) => {
    await page.goto(TOKEN_SETS_PATH, { waitUntil: 'networkidle' });
    // `Dialog.Portal` mounts under `document.body`, outside every `[data-tokens]` cell — so without
    // forwarding, all four cells would demonstrate the CONTROL palette and this page would audit the
    // candidates zero times.
    await page.getByRole('button', { name: 'Open sheet' }).nth(1).click();
    await expect(page.locator('[role=dialog][data-tokens]')).toHaveCount(1);
  });

  /**
   * 🔴 The back gesture, and the only tier that can prove it. jsdom has no browser history chrome.
   */
  test('the system back button closes it, and a second press leaves the page', async ({ page }) => {
    await openSheet(page);
    await page.goBack();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Still on the same page — the first press spent the sheet's own entry, not the page's.
    expect(new URL(page.url()).pathname).toBe(TOKEN_SETS_PATH);
  });

  /**
   * 🔴 **The geometry, and the ONLY tier that can see it.** `--sheet-vvh` is written from
   * `window.visualViewport`, which jsdom does not have — so the component shipped with this hook
   * reading a null ref and never running, the sheet silently sized to the LAYOUT viewport (the
   * defect A2 exists to prevent) and every unit test still green. An empty value here means the
   * effect did not run; a value means it did.
   */
  test('anchors itself to the visual viewport, at both widths', async ({ page }) => {
    for (const viewport of [NARROW_VIEWPORT, { width: 820, height: 1180 }]) {
      await page.setViewportSize(viewport);
      const dialog = await openSheet(page);
      const vvh = await dialog.evaluate((d) => d.style.getPropertyValue('--sheet-vvh'));
      expect(vvh, `--sheet-vvh is set at ${viewport.width}px`).not.toBe('');
      // Sanity: it is the visual viewport's height, not an arbitrary string.
      const expected = await page.evaluate(() => `${window.visualViewport?.height}px`);
      expect(vvh).toBe(expected);
    }
  });

  /**
   * 🔴 **Above 1040px the dialog variant drifted right** — `inset-0` leaves `right: 0` set, so a
   * width plus `left: 1/2` plus `margin-inline: auto` is over-constrained with AUTO margins, and
   * CSS solves the margins inside the 50%→100% band instead of ignoring `right`. Centring is a
   * thing only a laid-out browser can measure.
   */
  test('the dialog variant stays centred on a wide viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.goto(TOKEN_SETS_PATH, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Open dialog' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    const centre = box.x + box.width / 2;
    expect(Math.abs(centre - 1360 / 2), 'the dialog is centred').toBeLessThanOrEqual(1);
  });

  /**
   * 🔴 The case an unconditional `history.back()` on close gets wrong: a route link inside the sheet
   * pushes a SECOND entry over ours, so popping on close would bounce the parent back with the sheet
   * shut — the tap appears to do nothing.
   *
   * ⚠️ **Both links are exercised, because the two restore paths are different mechanisms and each
   * is invisible to the other's test.** A same-route link keeps the component mounted, so only the
   * `popstate` listener can reopen the sheet; a cross-route link unmounts it, so only the mount-time
   * read of `history.state` can. The first version of this test used the same-route link alone and
   * claimed to prove "back restores the sheet" — but Next preserved the component's state across
   * that navigation, so the sheet never closed and the assertion held with the entire restore
   * mechanism deleted.
   */
  /**
   * ⚠️ **A same-route link does NOT close the sheet, and the first version of this test claimed it
   * did.** It navigated with a same-route link, pressed back and asserted the sheet was visible —
   * which held with the entire restore mechanism deleted, because Next preserves the component's
   * state across a same-route navigation and the sheet never closed in the first place. What is
   * actually worth pinning here is the opposite: that the `popstate` landing back on the sheet's own
   * entry does NOT spuriously close it.
   */
  test('a same-route link leaves the sheet open, and back onto its own entry keeps it open', async ({
    page,
  }) => {
    const dialog = await openSheet(page);
    await dialog.getByRole('link', { name: 'Go somewhere else (same route)' }).click();
    await expect(page).toHaveURL(/from=sheet/);
    // Nothing unmounted, so nothing had to be restored.
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.goBack();
    await expect(page.getByRole('dialog')).toBeVisible();

    // One more press spends the sheet's own entry and closes it.
    await page.goBack();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  /**
   * 🔴 **The cross-route case, which is the ONLY one that exercises the restore** — and A10's real
   * consumer (ASSIGN-1's "Create a program", criterion 36). Leaving the route unmounts the sheet, so
   * no `popstate` listener survives to hear the back press; the mount-time read of `history.state`
   * is the whole mechanism, and it was specified but not implemented.
   */
  test('a cross-route link unmounts the sheet, and back from there restores it', async ({
    page,
  }) => {
    const dialog = await openSheet(page);
    await dialog.getByRole('link', { name: 'Go somewhere else (another route)' }).click();
    await expect(page).toHaveURL(/\/privacy/);
    // Genuinely gone, or "it came back" proves nothing.
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.goBack();
    // The entry survived the close path AND the remount read it — the Android convention.
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  /**
   * 🔴 **A reload must NOT reopen it.** `history.state` outlives the document, so the restore is
   * gated on a per-document token: without it a refresh resurrects a modal the user never opened in
   * that document, emptied of whatever had been typed into it. This test is how that was found —
   * the second visit to the same URL came back with the sheet open and the trigger unclickable
   * behind it.
   */
  test('a reload does not resurrect it', async ({ page }) => {
    await openSheet(page);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

/**
 * **UI-5 — the shell at 1280px, the only width where the rail exists.**
 *
 * 🔴 **Why this block has to exist at all.** Every other test in this file runs at 390 or 360, and
 * the rail is `hidden lg:flex` — so at those widths it is not in the accessible tree and NOTHING in
 * the suite renders it. A rail with unlabelled links, a broken `aria-current`, 32px rows or a
 * contrast failure would ship green. This is the file's first desktop scan, and the comment at the
 * top ("MOBILE ONLY by design … desktop is the secondary case") still holds for the rest of it: the
 * justification here is not a wider matrix, it is **a component that only exists at this width**.
 *
 * ⚠️ `isMobile`/`hasTouch` off and `deviceScaleFactor` back to 1 — the `a11y` project turns all three
 * on for phone emulation, and phone emulation at a 1280px viewport is neither thing.
 */
test.describe('UI-5 · the app shell at 1280px', () => {
  test.use({ viewport: DESKTOP_VIEWPORT, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

  const rail = navRail;

  test('the rail renders, is labelled, and clears the tap-target bar', async ({ page }) => {
    await page.goto(SEED_PROFILE_ROUTE, { waitUntil: 'networkidle' });

    await expect(rail(page)).toBeVisible();
    // `expected` is deliberately absent: the seed's athlete count is not this test's subject, and
    // pinning it would make a seed change look like a layout regression. The non-vacuity floor
    // inside the helper ("found no links") is what this call needs from it.
    await expectLinkTapTargets(rail(page), 'the nav rail at 1280px');
    await expect(rail(page).getByRole('link', { name: NAV_RAIL_COPY.settings })).toBeVisible();

    await expectNoAxeViolations(page, 'Today with the rail (1280px)');
    // The rail is a second column, so a width regression shows up as the page scrolling sideways.
    await expectNoHorizontalOverflow(page, 'Today with the rail (1280px)');
  });

  test('the open athlete is the one marked current', async ({ page }) => {
    await page.goto(SEED_PROFILE_ROUTE, { waitUntil: 'networkidle' });

    // One `aria-current` in the rail, and it points at the page we are on. `current` arrives as a
    // prop from the page rather than from `usePathname()`, which is what keeps the shell free of a
    // client boundary — and also what makes it possible to get wrong silently.
    const marked = rail(page).locator('[aria-current="page"]');
    await expect(marked).toHaveCount(1);
    await expect(marked).toHaveAttribute('href', new RegExp(SEED_PROFILE_PUBLIC_ID));
  });

  test('household settings marks the settings row, not an athlete', async ({ page }) => {
    await page.goto(SETTINGS_PATH, { waitUntil: 'networkidle' });

    const marked = rail(page).locator('[aria-current="page"]');
    await expect(marked).toHaveCount(1);
    await expect(marked).toHaveText(NAV_RAIL_COPY.settings);
  });

  /**
   * 🔴 **The skip link, which is the whole reason the rail needed one.** With navigation first in the
   * DOM, a keyboard user would otherwise tab every athlete before reaching the logging form on every
   * page. axe will never ask for this — `bypass` is satisfied by landmarks alone — so the only proof
   * it works is pressing Tab and following it.
   */
  test('the first Tab reaches a skip link that moves focus into <main>', async ({ page }) => {
    await page.goto(SEED_PROFILE_ROUTE, { waitUntil: 'networkidle' });

    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    await expect(focused).toHaveText(NAV_RAIL_COPY.skipToContent);

    // 🔴 **MEASURED, not `toBeVisible()` — which here was theatre.** Playwright calls an element
    // visible when it has a non-empty box, and an `sr-only` link is a 1×1 clipped box: the
    // assertion passed with `focus:not-sr-only` deleted entirely. A UX lens caught it. A skip link
    // a sighted keyboard user cannot see themselves land on is the one failure mode this feature
    // has, so the box is what gets asserted.
    const box = await focused.boundingBox();
    expect(box, 'the focused skip link has a box').not.toBeNull();
    expect(box!.width, 'wider than the 1px sr-only clip').toBeGreaterThan(50);
    expect(
      box!.height,
      'the skip link is a real target — `not-sr-only` resets padding to 0, so the focus state has ' +
        'to put it back',
    ).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);

    await page.keyboard.press('Enter');
    // `<main tabIndex={-1}>` is what makes the jump move FOCUS rather than only the scroll position.
    // Without it the hash navigates and the next Tab returns to the rail.
    await expect(page.locator(`#${MAIN_CONTENT_ID}:focus`)).toHaveCount(1);
  });

  /**
   * 🔴 **`/p` at 1280: no rail, and STILL A CENTRED COLUMN.** This test exists because the first
   * implementation failed it. The shell's `lg:` classes — `lg:mx-0 lg:max-w-none lg:px-8` — turn a
   * centred column into the grid's second cell, and they were written unconditionally. On the one
   * page with no rail there is no grid for them to belong to, so they simply pinned the picker to
   * the left edge of a 1280px window with ~600px of nothing beside it. Every test passed; a desktop
   * screenshot is what showed it.
   *
   * The lesson is the general one for this shell: **a width-conditional class and a
   * presence-conditional region have to agree**, and only a measurement says whether they do.
   */
  test('the picker has no rail and keeps its centred column', async ({ page }) => {
    await page.goto(APP_HOME_PATH, { waitUntil: 'networkidle' });

    await expect(
      rail(page),
      '/p IS the athlete switcher — a rail would link every athlete twice',
    ).toHaveCount(0);

    const box = await page.evaluate(() => {
      const r = document.querySelector('main')!.getBoundingClientRect();
      const f = document.querySelector('footer')!.getBoundingClientRect();
      return { x: Math.round(r.x), width: Math.round(r.width), footerX: Math.round(f.x) };
    });
    expect(box.width, 'main keeps max-w-2xl').toBe(672);
    expect(box.x, 'main is centred, not flattened against the left edge').toBe(
      Math.round((DESKTOP_VIEWPORT.width - 672) / 2),
    );
    // The footer follows the content, not the window: the same miss would have left it centred on
    // 1280 while the page sat at the left.
    expect(box.footerX, 'the footer is under the content').toBe(box.x);
  });

  /**
   * The public routes have no rail and no athletes — `AppShell` is not in their tree at all. Worth a
   * line because the shell replaced the ROOT LAYOUT's footer: `/` and `/privacy` render `SiteFooter`
   * themselves now, and the failure mode of that move is a route that renders two `contentinfo`
   * landmarks or none.
   */
  test('the public routes render no rail, and exactly one footer', async ({ page }) => {
    // UI-6: the 404, both as an unmatched URL and as `notFound()` from inside `/p`, renders outside
    // `AppShell` with its own footer.
    for (const path of [
      '/',
      PRIVACY_PATH,
      SIGN_IN_PATH,
      '/does-not-exist',
      `${APP_HOME_PATH}/does-not-exist`,
    ]) {
      await page.goto(path, { waitUntil: 'networkidle' });
      await expect(rail(page), `${path} has no nav rail`).toHaveCount(0);
      await expect(page.getByRole('main'), `${path} has one main`).toHaveCount(1);
      // ⚠️ `/sign-in` renders NO footer by design (it carries its own mark and privacy link), and
      // the sign-in block above already asserts that count directly — so this loop asserts the
      // footer only where there should be one, rather than restating the other case here.
      if (path !== SIGN_IN_PATH) {
        await expect(page.getByRole('contentinfo'), `${path} has one footer`).toHaveCount(1);
      }
    }
  });

  test('one main landmark and one contentinfo, with the footer outside main', async ({ page }) => {
    await page.goto(SEED_PROFILE_ROUTE, { waitUntil: 'networkidle' });

    // ⚠️ **axe cannot assert this** — `landmark-one-main`, `landmark-no-duplicate-main` and
    // `landmark-unique` are all tagged `best-practice`, and `expectNoAxeViolations` scans
    // `wcag2a`/`wcag2aa` only. The source scan in `app/pages-need-a-session.test.ts` proves no page
    // DECLARES a second one; this proves the rendered page has one.
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('contentinfo')).toHaveCount(1);
    await expect(page.locator('main footer')).toHaveCount(0);
  });
});
