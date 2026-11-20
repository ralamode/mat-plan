import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';

// Relative imports only, as `contexts.ts` keeps them.
import { MIN_TAP_TARGET_PX } from '../lib/constants';

/**
 * The two checks of the a11y bar (V1-12), exported so every spec runs the same rules: the axe scan,
 * and the tap-target measurement axe cannot do (its `target-size` rule is 24px and tagged
 * `wcag22aa`; this project's bar is 44). `a11y.spec.ts` imports these, so there is one copy of each
 * rule and its reasoning (2026-11-19).
 */

/** Scan with the WCAG 2.0/2.1 A + AA rule sets. Zero tolerance — no allowlist (nothing to grandfather
 *  on a first scan), and the dependency is EXACTLY pinned so a rule-set bump can't redden an unrelated PR. */
export async function expectNoAxeViolations(page: Page, context: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(
    violations.map((v) => `${v.id} (${v.nodes.length}): ${v.help}`),
    `${context}: axe violations`,
  ).toEqual([]);
}

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
 * separately (`a11y.spec.ts`'s `expectLinkTapTargets`; `expectLinkTargets` below for the program
 * screens).
 * ⚠️ **The consequence, now that those links carry `min-h-11` anyway:** `expectTapTargets` does not
 * assert it. `athletes.spec.ts` measures the edit page's back link, because a link that is the recovery
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

/** A human-readable identifier for a failing control, so the assertion names the culprit. */
export async function describeControl(control: Locator): Promise<string> {
  const [tag, label, text] = await Promise.all([
    control.evaluate((el) => el.tagName.toLowerCase()),
    control.getAttribute('aria-label'),
    control.innerText().catch(() => ''),
  ]);
  return `<${tag}> "${(label ?? text ?? '').trim().slice(0, 40) || '(unnamed)'}"`;
}

/**
 * Every visible interactive control is at least `MIN_TAP_TARGET_PX` tall. `expectControls: false`
 * for a page that may have none, where "the selector matched nothing" is not a failure.
 */
export async function expectTapTargets(
  page: Page,
  context: string,
  opts: { expectControls?: boolean } = {},
): Promise<void> {
  const controls = await page.locator(INTERACTIVE).all();
  // A guard against the selector silently matching nothing (which would make this whole assertion
  // vacuous). Opt out only for a page whose one control is a link, which is measured by its own test,
  // since links are excluded here under the SC 2.5.8 inline exception.
  if (opts.expectControls !== false) {
    expect(
      controls.length,
      `${context}: found no interactive controls — selector is wrong`,
    ).toBeGreaterThan(0);
  }
  const undersized: string[] = [];
  for (const control of controls) {
    if (!(await control.isVisible())) continue;
    const target = await targetOf(page, control);
    if (!target) {
      undersized.push(`${await describeControl(control)} → no bound <label> to act as its target`);
      continue;
    }
    const box = await target.boundingBox();
    if (box && box.height < MIN_TAP_TARGET_PX) {
      undersized.push(`${await describeControl(control)} → ${Math.round(box.height)}px`);
    }
  }
  expect(undersized, `${context}: controls under ${MIN_TAP_TARGET_PX}px tall`).toEqual([]);
}

/**
 * Every link inside `<main>` is a 44px target too (FAM-1: the program screens, moved here from
 * `program-builder.a11y.spec.ts` at 7b-i). `expectTapTargets` leaves links out (WCAG's exception for
 * a link inline in a sentence); on these screens a link is a row or a way back, which a thumb aims
 * at, so here they are all measured. Every spec that walks the program screens imports this one,
 * `program-preview-a11y.spec.ts` included.
 */
export async function expectLinkTargets(page: Page, context: string): Promise<void> {
  const links = await page.getByRole('main').getByRole('link').all();
  expect(links.length, `${context}: found no links, so the selector is wrong`).toBeGreaterThan(0);
  const undersized: string[] = [];
  for (const link of links) {
    const height = (await link.boundingBox())?.height ?? 0;
    if (height < MIN_TAP_TARGET_PX) {
      undersized.push(`"${(await link.innerText()).trim()}" → ${Math.round(height)}px`);
    }
  }
  expect(undersized, `${context}: links under ${MIN_TAP_TARGET_PX}px tall`).toEqual([]);
}

/**
 * **The in-sheet overflow check, once** (FAM-1 15). Nothing inside `container` is wider than its
 * box: the container itself, every element that scrolls, and every button.
 *
 * Why it exists: `expectNoHorizontalOverflow` measures the document, and a `position: fixed` sheet
 * adds nothing to the document's scrollable width (`RemoveScroll` also hides the body's overflow
 * while it is open), so an overflowing sheet passes it. A long unbroken name that runs out of a
 * footer button or a hint line is caught here. **1px of tolerance**: sub-pixel layout can round
 * `scrollWidth` one past `clientWidth` with nothing visibly clipped. It replaced three copies
 * (`movement-picker.a11y.spec.ts`'s `expectNoSheetOverflow` and two in `a11y.spec.ts`).
 */
export async function expectNoOverflowWithin(container: Locator, context: string): Promise<void> {
  const overflowing = await container.evaluate((root) =>
    [root, ...root.querySelectorAll('*')]
      .filter((el) => {
        if (el === root || el.tagName === 'BUTTON') return true;
        const style = getComputedStyle(el);
        return /auto|scroll/.test(`${style.overflowX} ${style.overflowY}`);
      })
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map(
        (el) =>
          `<${el.tagName.toLowerCase()}> "${(el.textContent ?? '').trim().slice(0, 40)}" ` +
          `(scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth})`,
      ),
  );
  expect(overflowing, `${context}: wider than its box`).toEqual([]);
}
