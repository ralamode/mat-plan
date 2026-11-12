import { globSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');

/**
 * Acceptance 12 (V1-22 chunk 2): `prescribed_snapshot` is an EXPORT-path value and must never become
 * reachable from the log form.
 *
 * 🔴 **Why this is a scan and not a code review.** The column holds the coach's authored plan. If it
 * ever reaches a form field, a PRESCRIBED number can be logged as a PERFORMED one — the same class of
 * defect the `ScaffoldRow` docblock exists to prevent, and the reason `prescription_targets.load` is
 * absent from everything downstream of `programDayRows`.
 *
 * ⚠️ **Two assertions, no hand-maintained allowlist.** An earlier draft listed five files allowed to
 * name the column — and omitted two of the plan's own new modules, so it would have failed on day one
 * or been widened at implementation time by nobody. Worse, chunk 3's backfill correction legitimately
 * adds another writer, so the list would be renegotiated every PR. What actually matters is the
 * direction of travel: the column may move freely inside the data layer, and must not escape into the
 * UI.
 */
const sources = globSync('apps/web/{app,components}/**/*.{ts,tsx}', { cwd: REPO }).filter(
  (f) => !f.includes('node_modules'),
);

describe('prescribed_snapshot stays out of the UI (V1-22 acceptance 12)', () => {
  it('finds the sources — an empty glob would pass everything below', () => {
    expect(sources.length).toBeGreaterThan(50);
  });

  it('is named nowhere under app/ or components/', () => {
    const offenders = sources.filter((f) =>
      /prescribed_?[sS]napshot/.test(readFileSync(join(REPO, f), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  /**
   * The log form's scaffold type is the specific door this keeps shut: it is the one object that
   * crosses from the program into the form, and its docblock says a future widening must be
   * deliberate.
   */
  it('is not a field of the scaffold row that feeds the log form', () => {
    const scaffold = readFileSync(
      join(REPO, 'apps/web/app/p/[profileId]/strength-form-scaffold.ts'),
      'utf8',
    );
    // ⚠️ The IDENTIFIER, not the word. The file's docblocks discuss prescribed-vs-performed at
    // length — that prose is the reason the door is shut, not a breach of it.
    expect(/prescribed_?[sS]napshot/.test(scaffold)).toBe(false);
  });

  /**
   * 🔴 **This was a tautology and is the reason to re-read a guard you just wrote.** The first
   * version built `namers` from globs that were already restricted to `packages/` and
   * `apps/web/lib/`, then asserted every entry started with one of those prefixes — true by
   * construction. It now globs the WHOLE repo, so the direction is actually checked, and it covers
   * `e2e/`, `scripts/`, `middleware.ts` and `instrumentation*.ts`, which the narrow version did not.
   */
  it('is named ONLY inside the data layer, scanning the whole repo', () => {
    const everywhere = [
      ...globSync('apps/web/**/*.{ts,tsx,js,jsx,mjs}', { cwd: REPO }),
      ...globSync('packages/*/src/**/*.ts', { cwd: REPO }),
      ...globSync('packages/*/scripts/**/*.ts', { cwd: REPO }),
    ].filter((f) => !f.includes('node_modules') && !f.includes('.next'));
    expect(everywhere.length).toBeGreaterThan(200);

    const namers = everywhere
      .filter((f) => !f.endsWith('prescribed-snapshot-is-contained.test.ts'))
      .filter((f) => /prescribed_?[sS]napshot/.test(readFileSync(join(REPO, f), 'utf8')));

    expect(namers.length).toBeGreaterThan(0);
    const escaped = namers.filter(
      (f) => !f.startsWith('packages/') && !f.startsWith('apps/web/lib/'),
    );
    expect(escaped).toEqual([]);
  });
});
