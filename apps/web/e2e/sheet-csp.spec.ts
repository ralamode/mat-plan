import { expect, test, type Page } from '@playwright/test';

import { previewHref } from '../app/design/program/preview-registry';
import { ITEM_PICKER_COPY } from '../components/program-builder/builder-text';

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
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const EDITOR = previewHref({ screen: 'workout-editor', fixture: 'heavy-a-draft', failNext: false });

type Recorded = { violations: string[] };

/** Every `securitypolicyviolation`, from before any page script runs (the `theme.spec.ts` recorder). */
async function recordViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Recorded;
    w.violations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.violations.push(
        `${e.violatedDirective} ${e.blockedURI || 'inline'} ${(e.sample || '').slice(0, 60)}`,
      );
    });
  });
}

/** `style-src*` violations only: zod's JIT probe raises a `script-src` one on every page today. */
async function styleViolations(page: Page): Promise<string[]> {
  const all = await page.evaluate(() => (window as unknown as Recorded).violations);
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

async function closePicker(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
}

test('an open sheet locks the page behind it under the production CSP', async ({ page }) => {
  await recordViolations(page);
  const response = await page.goto(EDITOR);
  const csp = response?.headers()['content-security-policy'] ?? '';
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
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

  // The day page refreshes on every log (`router.refresh()`, `revalidatePath`), and each refresh
  // re-renders the root layout with a NEW `x-nonce` while the page keeps its first CSP. A sheet opened
  // after one must still be allowed.
  await closePicker(page);
  // Wait for the refresh's own RSC response, never `networkidle`,
  // which waits on every open connection rather than on the one request this needs.
  const refreshed = page.waitForResponse((r) => r.request().headers()['rsc'] === '1');
  await page.evaluate(() =>
    (window as unknown as { next: { router: { refresh(): void } } }).next.router.refresh(),
  );
  await refreshed;
  await openPicker(page);
  expect(
    await styleViolations(page),
    'no style-src violation on a sheet opened after a refresh',
  ).toEqual([]);
  expect(await bodyLock(page), '…and the lock still applies').toEqual({
    overflow: 'hidden',
    overscroll: 'contain',
  });
});

// ⚠️ No keyboard-scroll case. One was written and run RED first: with the lock's style blocked,
// `PageDown` (focus on the sheet's title) still did not move the page in Chromium, so the case passed
// on the broken code and proved nothing. It was removed rather than kept as false coverage.
