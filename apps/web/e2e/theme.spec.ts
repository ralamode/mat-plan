import { expect, test, type Page } from '@playwright/test';

import { APP_HOME_PATH, THEME_COPY, THEME_STORAGE_KEY } from '../lib/constants';

/**
 * UI-4 — the theme switch, proven at the only level that can prove it.
 *
 * ## Why this spec is about the MECHANISM, not the end state
 *
 * The obvious test — "navigate, then assert `<html>` has `.dark`" — is **vacuous**, and the panel's
 * correctness lens caught it in the plan. `toHaveClass` is a retrying web-first assertion, so it
 * polls until React hydrates and `next-themes`' effect adds the class anyway. A CSP-blocked pre-paint
 * script produces an identical pass: the flash would be back and the test would still be green, while
 * being the only guard the design offered for the nonce.
 *
 * So each test below names a mechanism that cannot be satisfied after the fact:
 *
 *  1. the nonce on the rendered `<script>` equals the one in the response's own CSP header — provable
 *     only from the raw HTML (Chrome blanks the `nonce` attribute in the DOM), and impossible to fake
 *     by hydrating;
 *  2. the document raises zero `securitypolicyviolation` events;
 *  3. the FIRST class mutation on `<html>` already carries `dark`, while `document.readyState` is
 *     still `'loading'` — i.e. before `DOMContentLoaded`, let alone before paint.
 *
 * These run in the `chromium` project, which keeps CSP LIVE (only the `a11y` project sets
 * `bypassCSP`), so the nonce wiring is exercised exactly as production serves it.
 */

/**
 * The radio for a choice, and the label a thumb actually hits.
 *
 * `.check()` on the input TIMES OUT: the input is `sr-only`, so Playwright's actionability check
 * finds the label text over its centre point and waits forever for it to stop intercepting pointer
 * events. The same trap `e2e/a11y.spec.ts` already records for the BW/band chips — click the label,
 * which is what a user does and what the browser treats as activating the control.
 */
const themeRadio = (page: Page, choice: 'system' | 'light' | 'dark') =>
  page.getByRole('radio', { name: THEME_COPY.option(choice), exact: true });

const tapTheme = (page: Page, choice: 'system' | 'light' | 'dark') =>
  page
    .locator('label')
    .filter({ has: themeRadio(page, choice) })
    .click();

/** Pre-seed the stored choice the way a returning viewer's browser would have it. */
async function seedStoredTheme(page: Page, value: 'light' | 'dark'): Promise<void> {
  await page.addInitScript(
    ([key, v]) => {
      try {
        window.localStorage.setItem(key!, v!);
      } catch {
        /* a private window would throw; the app must still render */
      }
    },
    [THEME_STORAGE_KEY, value],
  );
}

/** Record the earliest observable state of `<html>`'s class, from before any page script runs. */
async function recordFirstClassMutation(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __firstClass?: { className: string; readyState: string } | null;
      __cspViolations?: string[];
    };
    w.__firstClass = null;
    w.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__cspViolations!.push(
        `${e.violatedDirective} ${e.blockedURI || 'inline'} @${e.sourceFile || '?'}:${e.lineNumber} ${(e.sample || '').slice(0, 40)}`,
      );
    });
    // Observe `document`, with `subtree`, NOT `document.documentElement`. An init script runs at
    // document-start, where `documentElement` can still be null — `.observe(null)` throws, the rest of
    // the init script never runs, and the recorder silently stays `null` forever while looking like
    // "the theme never applied". That cost one debugging round; `document` always exists.
    new MutationObserver((records) => {
      if (w.__firstClass) return;
      for (const r of records) {
        if (r.attributeName === 'class' && r.target === document.documentElement) {
          w.__firstClass = {
            className: document.documentElement.className,
            readyState: document.readyState,
          };
          return;
        }
      }
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['class'] });
  });
}

test('the theme script is nonced with the response’s own nonce, and nothing is CSP-blocked', async ({
  page,
}) => {
  await recordFirstClassMutation(page);
  const response = await page.goto(APP_HOME_PATH, { waitUntil: 'domcontentloaded' });
  expect(response, 'no response for the picker').not.toBeNull();

  const csp = response!.headers()['content-security-policy'] ?? '';
  const headerNonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  expect(headerNonce, `no nonce in the CSP header: ${csp}`).toBeTruthy();

  // The RAW HTML, not the DOM: Chrome blanks the `nonce` attribute after parsing, so `page.content()`
  // would report an empty nonce for a perfectly nonced tag. The theme script is identified by OUR
  // storage key, which only it mentions — so this also proves the provider got `storageKey`.
  const html = await response!.text();
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  const themeScript = scripts.find(([, , body]) => body!.includes(THEME_STORAGE_KEY));
  expect(themeScript, 'no inline script mentions the theme storage key').toBeTruthy();
  expect(
    themeScript![1],
    'the theme script is not carrying the request nonce — it will be CSP-blocked in production, ' +
      'and the theme will only apply after hydration (a flash on every load)',
  ).toContain(`nonce="${headerNonce}"`);

  const violations = await page.evaluate(
    () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
  );
  // INLINE only, and the narrowing is a finding rather than a convenience: this app ALREADY raises one
  // `script-src eval` violation on every page load, in production, with nothing to do with the theme.
  // It is zod v4's JIT feature probe — `try { Function(""); return true } catch { return false }` in
  // `_next/static/chunks/*` — which is caught by zod and falls back to its non-JIT parsers, so it is
  // harmless, pre-existing, and not this PR's to fix (`zod.config({ jitless: true })` would silence the
  // report; it needs its own row). An un-nonced inline script reports `blockedURI: 'inline'`, which is
  // the failure this assertion exists to catch, and the full list is printed either way.
  expect(
    violations.filter((v) => v.startsWith('script-src inline')),
    `inline script blocked by CSP — the theme script is not nonced. All violations: ${violations.join(' | ')}`,
  ).toEqual([]);
});

test('a stored dark choice is on <html> before DOMContentLoaded — no flash', async ({ page }) => {
  await seedStoredTheme(page, 'dark');
  await recordFirstClassMutation(page);
  // `commit`, not `load`: we want the earliest observation, and the recorder already captured the
  // moment it happened, so there is nothing to race.
  await page.goto(APP_HOME_PATH, { waitUntil: 'domcontentloaded' });

  const first = await page.evaluate(
    () =>
      (window as unknown as { __firstClass: { className: string; readyState: string } | null })
        .__firstClass,
  );
  expect(
    first,
    'nothing ever changed <html>’s class — the theme never applied at all',
  ).not.toBeNull();
  expect(
    first!.className,
    'the first class mutation did not include `dark`: the theme is being applied after hydration, ' +
      'which is the flash this test exists to catch',
  ).toContain('dark');
  expect(
    first!.readyState,
    'the class arrived after parsing finished, so the document had already painted light',
  ).toBe('loading');
});

test('the choice survives a reload, and the control shows it', async ({ page }) => {
  await page.goto(APP_HOME_PATH, { waitUntil: 'networkidle' });
  await tapTheme(page, 'dark');
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await expect(themeRadio(page, 'dark')).toBeChecked();

  // Back to Auto, so the stored choice cannot leak into another spec through storage state.
  await tapTheme(page, 'system');
  await expect(themeRadio(page, 'system')).toBeChecked();
});

test('with no stored choice, Auto follows the device', async ({ page }) => {
  // The default, and the reason `system` is the default: a viewer whose phone is dark gets dark
  // without touching anything.
  await page.addInitScript((key) => {
    try {
      window.localStorage.removeItem(key as string);
    } catch {
      /* ignore */
    }
  }, THEME_STORAGE_KEY);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(APP_HOME_PATH, { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await expect(themeRadio(page, 'system')).toBeChecked();

  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
});
