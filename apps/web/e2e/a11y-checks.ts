import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';

// Relative imports only, as `contexts.ts` keeps them.
import { MIN_TAP_TARGET_PX } from '../lib/constants';

/**
 * The two checks of the a11y bar (V1-12), exported so more than one spec can run them: the axe scan,
 * and the tap-target measurement axe cannot do (its `target-size` rule is 24px and tagged
 * `wcag22aa`; this project's bar is 44).
 *
 * ⚠️ **`a11y.spec.ts` still holds its own private copies of both** (`expectNoAxeViolations`,
 * `expectTapTargets`), where the reasoning for each rule is written out in full. They were lifted
 * here for `program-preview-a11y.spec.ts` (FAM-1 step 0b) while another open PR was rewriting that
 * file, so it was left alone. The next PR that edits `a11y.spec.ts` deletes its copies and imports
 * these ([tech-debt](../../../docs/tech-debt.md) → "The a11y checks have two copies").
 */

/** WCAG 2.0/2.1 A + AA, zero tolerance. */
export async function expectNoAxeViolations(page: Page, context: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(
    violations.map((v) => `${v.id} (${v.nodes.length}): ${v.help}`),
    `${context}: axe violations`,
  ).toEqual([]);
}

/**
 * Controls that must meet the tap-target bar. A hidden input has no box. A link is left out (WCAG
 * 2.2 SC 2.5.8's inline exception); a link that acts as a button is measured by its own test.
 */
const INTERACTIVE = 'button, [role="button"], select, textarea, input:not([type="hidden"])';

/** A checkbox's or radio's target is the `<label>` that activates it, not its own small box. */
const LABEL_MEASURED = ['checkbox', 'radio'];

async function targetOf(page: Page, control: Locator): Promise<Locator | null> {
  const type = await control.getAttribute('type');
  if (!type || !LABEL_MEASURED.includes(type)) return control;
  const id = await control.getAttribute('id');
  if (id) {
    const explicit = page.locator(`label[for="${id.replace(/["\\]/g, '\\$&')}"]`);
    if ((await explicit.count()) === 1) return explicit;
  }
  const implicit = control.locator('xpath=ancestor::label[1]');
  return (await implicit.count()) === 1 ? implicit : null;
}

async function describeControl(control: Locator): Promise<string> {
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
 * at, so here they are all measured. ⚠️ `program-preview-a11y.spec.ts` still holds its own copy: that
 * spec is the program contract's, so the swap goes through its owner.
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
