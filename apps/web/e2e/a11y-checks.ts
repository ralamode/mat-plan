import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';

// Relative imports only, as `contexts.ts` keeps them.
import { MIN_TAP_TARGET_PX, THEME_STORAGE_KEY } from '../lib/constants';

/**
 * Seed the stored theme choice before any page script runs, the way a returning viewer's browser
 * holds it; `null` clears it, so the device's `colorScheme` decides (Auto). Lifted once from
 * `theme.spec.ts` and `a11y.spec.ts` (V1-9b B2-prep). A private window throws on storage; the app
 * must still render, so the seed swallows that.
 */
export async function seedStoredTheme(page: Page, value: 'light' | 'dark' | null): Promise<void> {
  await page.addInitScript(
    ([key, v]) => {
      try {
        if (v) window.localStorage.setItem(key!, v);
        else window.localStorage.removeItem(key!);
      } catch {
        /* a private window would throw; the app must still render */
      }
    },
    [THEME_STORAGE_KEY, value] as const,
  );
}

/**
 * The guard a dark scan needs first: a stored `mp_theme` beats `colorScheme` emulation, so a scan can
 * audit the LIGHT palette while reporting green on "dark" (a11y.spec.ts has shipped that failure).
 */
export async function expectActuallyDark(page: Page, context: string): Promise<void> {
  await expect(
    page.locator('html'),
    `${context}: not actually rendering dark — this scan would have audited the LIGHT palette`,
  ).toHaveClass(/\bdark\b/);
}

/**
 * The two checks of the a11y bar (V1-12), exported so every spec runs the same rules: the axe scan,
 * and the tap-target measurement axe cannot do (its `target-size` rule is 24px and tagged
 * `wcag22aa`; this project's bar is 44). `a11y.spec.ts` imports these, so there is one copy of each
 * rule and its reasoning (2026-11-19).
 */

/** Scan with the WCAG 2.0/2.1 A + AA rule sets. Zero tolerance — no allowlist (nothing to grandfather
 *  on a first scan), and the dependency is EXACTLY pinned so a rule-set bump can't redden an unrelated PR. */
export async function expectNoAxeViolations(page: Page, context: string): Promise<void> {
  // Scan the settled document. A Server Action's revalidated tree drops the streamed metadata from
  // `<head>` and adds it back a moment later, so straight after a write `document.title` can be empty
  // (#830's retry). A page with no title still fails here, by name.
  await expect(page, `${context}: the document has no <title>`).not.toHaveTitle('');
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
  // vacuous). Opt out only where having no controls is expected: a link-only 404, a stub preview.
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
      undersized.push(
        `${await describeControl(control)} → no bound <label> to act as its tap target`,
      );
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
 * **Every link inside `root` is a 44px target**, the one link check in the suite. `expectTapTargets`
 * leaves links out (WCAG's exception for a link inline in a sentence); where a link is a row, a tile
 * or a way back, a thumb aims at it, so these are measured. Pass `page.getByRole('main')` for a
 * page's content, or another root (the nav rail sits outside `<main>`).
 *
 * - **`expected` unset:** at least one link, or it fails with "found no links, so the selector is
 *   wrong": the guard against a root that renders nothing, which would pass vacuously.
 * - **`expected` set:** exactly that many, so a page that lost a link (or gained one) cannot pass.
 * - Every undersized link is collected and named (`describeControl`), with `context` in each
 *   message, so one run lists them all and says which page or fixture state broke.
 *
 * It replaced two copies (this one, `page`-scoped, and `a11y.spec.ts`'s `expectLinkTapTargets`,
 * fail-fast) and `athletes.spec.ts`'s own loop (2026-11-19).
 */
export async function expectLinkTargets(
  root: Locator,
  context: string,
  expected?: number,
  opts: { exceptions?: readonly LinkTargetException[] } = {},
): Promise<void> {
  const links = await root.getByRole('link').all();
  if (expected === undefined) {
    expect(links.length, `${context}: found no links, so the selector is wrong`).toBeGreaterThan(0);
  } else {
    expect(links.length, `${context}: link count`).toBe(expected);
  }
  const excepted = new Set((opts.exceptions ?? []).map((e) => e.name));
  const names: string[] = [];
  const undersized: string[] = [];
  for (const link of links) {
    const name = await linkName(link);
    names.push(name);
    if (excepted.has(name)) continue;
    const height = (await link.boundingBox())?.height ?? 0;
    if (height < MIN_TAP_TARGET_PX) {
      undersized.push(`${await describeControl(link)} → ${Math.round(height)}px`);
    }
  }
  // An exception names exactly one link: one that matches none is stale, and one that matches two
  // would excuse a link nobody looked at.
  for (const name of excepted) {
    expect(
      names.filter((n) => n === name).length,
      `${context}: the exception for link "${name}" matches exactly one link`,
    ).toBe(1);
  }
  expect(undersized, `${context}: links under ${MIN_TAP_TARGET_PX}px tall`).toEqual([]);
}

/**
 * A link excused from the 44px bar, by its accessible name (`aria-label`, else its text), with the
 * reason. Only for vendor DOM this app cannot size (the sign-in drift check's Clerk links); every
 * entry needs the evidence that it cannot be met, and the maintainer's say for a new one.
 */
export type LinkTargetException = { name: string; reason: string };

/** A link's accessible name as `LinkTargetException` matches it: `aria-label`, else its text. */
async function linkName(link: Locator): Promise<string> {
  const [label, text] = await Promise.all([
    link.getAttribute('aria-label'),
    link.innerText().catch(() => ''),
  ]);
  return (label ?? text ?? '').trim();
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
