import { expect, test, type Page } from '@playwright/test';

import { previewHref } from '../app/design/program/preview-registry';
import { ITEM_PICKER_COPY } from '../components/program-builder/builder-text';
import { MOBILE_VIEWPORT } from './contexts';
import { cspViolations, headerNonce, recordCspViolations } from './csp';

/**
 * An open sheet's scroll lock survives the production CSP (plan: docs/plans/td-sheet-style-nonce.md).
 *
 * Radix's scroll lock injects a `<style>` (`body { overflow: hidden; overscroll-behavior: contain }`)
 * when a sheet opens. Under `style-src 'self' 'nonce-…'` it is dropped unless it carries the page's
 * nonce, which `components/layout/style-nonce.tsx` hands it.
 *
 * 🔴 **This spec runs in the CSP-LIVE `chromium` project.** The `a11y` project sets `bypassCSP`, under
 * which the lock always worked, which is why nothing caught the defect. The viewport is a phone's, with
 * touch, so the scrollbar-gap code path a phone never reaches is not the one measured.
 */
test.use({ viewport: MOBILE_VIEWPORT, isMobile: true, hasTouch: true });

const EDITOR = previewHref({ screen: 'workout-editor', fixture: 'heavy-a-draft', failNext: false });

/** `style-src*` violations only (`e2e/csp.ts` says why never "none at all"); prints the full list. */
async function styleViolations(page: Page): Promise<string[]> {
  const all = await cspViolations(page);
  console.log(`[sheet-csp] all CSP violations: ${JSON.stringify(all)}`);
  return all.filter((v) => v.startsWith('style-src'));
}

/** The scroll lock's own tag, found by its content: `react-remove-scroll-bar` locks on this attribute. */
const lockStyleNonce = (page: Page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll('style')].find((s) =>
        s.textContent?.includes('data-scroll-locked'),
      )?.nonce ?? null,
  );

const bodyLock = (page: Page) =>
  page.evaluate(() => {
    const cs = getComputedStyle(document.body);
    return { overflow: cs.overflow, overscroll: cs.overscrollBehaviorY };
  });

async function openPicker(page: Page) {
  await page.getByRole('button', { name: ITEM_PICKER_COPY.open, exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test('an open sheet locks the page behind it under the production CSP', async ({ page }) => {
  await recordCspViolations(page);
  const response = await page.goto(EDITOR);
  const csp = response?.headers()['content-security-policy'] ?? '';
  const nonce = headerNonce(response);
  expect(nonce, `a nonce in the document's CSP: ${csp}`).toBeTruthy();
  expect(csp, 'the policy itself is unchanged: no unsafe-inline styles').not.toMatch(
    /style-src[^;]*'unsafe-inline'/,
  );

  await openPicker(page);
  expect(await styleViolations(page), 'no style-src violation on opening a sheet').toEqual([]);
  expect(await lockStyleNonce(page), "the lock's <style> carries the page's nonce").toBe(nonce);
  expect(await bodyLock(page), 'the lock applies to the page behind the sheet').toEqual({
    overflow: 'hidden',
    overscroll: 'contain',
  });

  // ⚠️ No after-refresh case. One was written, as the plan's security P0 asked: refresh, wait for
  // a fresh nonce in the DOM, open again. Run with the fix AND against a prop-fed `StyleNonce`, the
  // poll failed both times: no refreshed nonce ever reached the DOM, so the case could not tell the
  // two apart and was removed. "Set once from the loaded document" is pinned by the unit test
  // (`style-nonce.test.tsx`, the second-mount case) instead.
});

// ⚠️ No keyboard-scroll case. One was written and run RED first: with the lock's style blocked,
// `PageDown` (focus on the sheet's title) still did not move the page in Chromium, so the case passed
// on the broken code and proved nothing. It was removed rather than kept as false coverage.
