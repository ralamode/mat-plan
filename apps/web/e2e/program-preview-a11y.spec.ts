import { expect, test } from '@playwright/test';

import {
  previewEntries,
  previewHref,
  previewLabel,
  PROGRAM_PREVIEW_PATH,
} from '../app/design/program/preview-registry';
import { expectLinkTargets, expectNoAxeViolations, expectTapTargets } from './a11y-checks';
import { expectNoHorizontalOverflow, NARROW_VIEWPORT } from './contexts';

/**
 * FAM-1's screens on the preview route, scanned state by state (plan §4: "the a11y scan iterates
 * the fixture list").
 *
 * 🔴 **The list is the route's own** (`preview-registry.ts`: every screen × every named fixture,
 * plus the ✓ that fails). A lane that adds a state adds a fixture to the contract and never edits
 * this file; **every state a fixture can load is scanned here.** ⚠️ Not every state on the route is
 * one a fixture can load: a state reached only by typing or tapping after the page has loaded (the
 * typed states of Change on a logged number, an open dialog) is not seen by this walk. The step
 * that builds such a state checks it itself and lists it in its lane's `owed.test.ts` until a spec
 * of its own covers it (step 12d for Change's).
 *
 * Per state, the three things only a browser can show (definition-of-done → Speed budget): the axe
 * scan in the real cascade (WCAG 2.0 A and AA, the same bar `a11y.spec.ts` holds), 44px tap targets
 * on controls and on links, and no sideways scroll at 360px, the narrowest width the app commits to. What a screen says and does is the lane's own component test.
 *
 * ## Why a new spec file, and two tests
 *
 * `a11y.spec.ts` lists routes one by one and runs each as its own test; these states are one route
 * with a data-driven list, and the plan keeps each lane's e2e out of shared files. The name ends in
 * `a11y.spec.ts` on purpose: that is what puts it in the `a11y` Playwright project (a phone, with
 * `bypassCSP` for axe's injected script).
 *
 * ONE test walks every state, each a named step, so the suite grows by a page load per fixture and
 * not by a test per fixture. A failure names its state and the walk goes on, so one run reports
 * every state that is wrong.
 */
test.use({ viewport: NARROW_VIEWPORT });

const entries = previewEntries();

/** How long a server-rendered state may take to show its frame and its heading. */
const RENDERED = { timeout: 2_000 };

/** What one state may take in the walk below: a page load, an axe run and two measurements. */
const STATE_BUDGET_MS = 3_000;

test('the program preview lists every screen × fixture, as tappable links', async ({ page }) => {
  await page.goto(PROGRAM_PREVIEW_PATH, { waitUntil: 'networkidle' });

  const links = page.getByRole('main').getByRole('link');
  // Not vacuous: the registry must hold the contract's fixtures for the walk below to mean anything.
  expect(entries.length).toBeGreaterThan(19);
  expect(await links.evaluateAll((all) => all.map((a) => a.getAttribute('href')))).toEqual(
    entries.map(previewHref),
  );
  await expectLinkTargets(page, 'program preview index');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('main')).toHaveCount(1);
  await expectNoAxeViolations(page, 'program preview index');
  await expectNoHorizontalOverflow(page, 'program preview index');
});

test('every program preview state renders and meets the a11y bar at 360px', async ({ page }) => {
  // One page load and one axe run per state, so the budget follows the list's length.
  test.setTimeout(entries.length * STATE_BUDGET_MS);

  const failures: string[] = [];
  for (const entry of entries) {
    const label = previewLabel(entry);
    await test.step(label, async () => {
      try {
        await page.goto(previewHref(entry));
        // An unknown name falls back to the index, which has no such line.
        // Both short: a screen that throws fails here, under its state's name, and the walk goes
        // on, where the default wait would spend the whole walk's budget on one state.
        await expect(page.getByText(`Preview: ${label}`, { exact: true })).toBeVisible(RENDERED);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(/\S/, RENDERED);
        await expect(page.getByRole('main')).toHaveCount(1);
        await expectNoAxeViolations(page, label);
        // A stub has no controls yet; a filled-in screen's are measured from the day it has them.
        await expectTapTargets(page, label, { expectControls: false });
        await expectLinkTargets(page, label);
        await expectNoHorizontalOverflow(page, label);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(message.startsWith(label) ? message : `${label}: ${message}`);
      }
    });
  }
  expect(failures, 'program preview states that failed').toEqual([]);
});
