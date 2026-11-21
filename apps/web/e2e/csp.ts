import type { Page, Response } from '@playwright/test';

/**
 * The production CSP, observed from inside the page (`theme.spec.ts`, `sheet-csp.spec.ts`).
 *
 * ⚠️ **The app already raises one violation on every page load: `script-src eval`.** It is zod v4's
 * JIT feature probe (`try { Function(""); … }` in `_next/static/chunks/*`), caught by zod, which falls
 * back to its non-JIT parsers. Harmless and pre-existing (`zod.config({ jitless: true })` would
 * silence it; it needs its own row). So a spec asserts on the directive it is about, never on "no
 * violations at all", and prints the full list either way.
 */

/** Record every `securitypolicyviolation`, from before any page script runs. Call before `goto`. */
export async function recordCspViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cspViolations?: string[] };
    w.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__cspViolations!.push(
        `${e.violatedDirective} ${e.blockedURI || 'inline'} @${e.sourceFile || '?'}:${e.lineNumber} ${(e.sample || '').slice(0, 40)}`,
      );
    });
  });
}

/**
 * The recorded violations that are a blocked INLINE script. 🔴 Chromium reports one as
 * `script-src-elem`, not `script-src` (probed 2026-11-20: a nonce stripped from the theme script
 * reported `script-src-elem inline`). A filter on `'script-src inline'` alone matched nothing, so the
 * two `theme.spec.ts` assertions that used it could not fail. All three names are accepted: `-elem`
 * for a `<script>` element, `-attr` for an inline event handler (`onerror="…"`), and the bare name
 * an older browser may report. `theme.spec.ts` proves this catches a stripped nonce.
 */
export function blockedInlineScripts(violations: readonly string[]): string[] {
  return violations.filter((v) => /^script-src(-elem|-attr)? inline /.test(v));
}

/** The violations recorded so far, as `"<directive> <blockedURI|inline> @<file>:<line> <sample>"`. */
export function cspViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);
}

/** The nonce in a document response's CSP header, or `undefined`. */
export function headerNonce(response: Response | null): string | undefined {
  const csp = response?.headers()['content-security-policy'] ?? '';
  return /'nonce-([^']+)'/.exec(csp)?.[1];
}
