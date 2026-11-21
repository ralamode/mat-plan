import { globSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { isPublicPath } from '../lib/public-paths';

/**
 * The app's pages and route handlers, read from the file system, and the route each one serves.
 *
 * Shared by `app/pages-need-a-session.test.ts` (Vitest: every page has a session check in its
 * source) and `e2e/landing.spec.ts`'s signed-out sweep (Playwright: every protected page refuses a
 * stranger at runtime). One list, so the two cannot disagree about which pages are protected.
 *
 * ⚠️ **Every function takes the app directory as an argument, and this module reads no
 * `import.meta`.** Playwright 1.65's transform cannot load a module that reads `import.meta` at module
 * scope: probed 2026-11-20 against `test/source-scan.ts`, which fails with
 * `SyntaxError: Cannot use 'import.meta' outside a module` (`docs/plans/td-signed-out-e2e.md`).
 * So the Vitest caller passes its `import.meta`-derived path and the spec passes one built from
 * `__dirname`.
 */

/** `app/p/[profileId]/page.tsx` → `/p/[profileId]`; route groups `(x)` add no segment. */
export function routeOf(appDir: string, file: string): string {
  const segments = relative(appDir, dirname(file))
    .split('/')
    .filter((s) => s !== '' && !/^\(.*\)$/.test(s));
  return `/${segments.join('/')}`;
}

/** Every non-test file under the app directory matching `pattern`, as absolute paths. */
export const appFiles = (appDir: string, pattern: string) =>
  globSync(pattern, { cwd: appDir })
    .filter((f) => !/\.test\.[jt]sx?$/.test(f))
    .map((f) => join(appDir, f));

/** Every page, in every extension Next serves one from, so a `page.js` cannot slip past. */
export const pageFiles = (appDir: string) => appFiles(appDir, '**/page.{tsx,ts,jsx,js}');

/** Every route handler, in every extension. */
export const handlerFiles = (appDir: string) => appFiles(appDir, '**/route.{ts,tsx,js,jsx}');

/** The pages a stranger must be refused: every page whose route is not `isPublicPath()`. */
export const protectedPageFiles = (appDir: string) =>
  pageFiles(appDir).filter((f) => !isPublicPath(routeOf(appDir, f)));

/**
 * A floor on the protected pages, so a mis-rooted or empty glob fails loudly instead of passing every
 * per-page check by finding nothing. Both callers assert it.
 */
export const MIN_PROTECTED_PAGES = 5;
