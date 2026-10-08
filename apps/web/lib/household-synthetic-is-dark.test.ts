import { globSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * TEN-1 chunk 1a's central safety claim, as a test rather than a sentence.
 *
 * `households.synthetic` (migration 0014) ships **dark**: it lands ahead of its only consumer
 * (OBS-2) and the entire argument for that being safe is that **nothing reads or writes it** — so
 * there is no deploy-order window between the migration and any app deploy, and no chance of a
 * `42703 undefined column` on a page or Server Action if `migrate.yml` has not run yet.
 *
 * Migrations 0006 and 0013 made the same "ships dark" claim in prose and got away with it because
 * their columns were nullable and unread by construction. This one is different: the plan originally
 * had TEN-1's own chunk 1b read the column (it carried `synthetic` on `HouseholdScope`), which is
 * exactly when an unchecked claim starts to matter. The field was cut from the scope precisely so
 * the column could stay dark — and a claim that load-bearing should fail a build, not a review.
 *
 * Source is matched with comments STRIPPED (the `pages-are-gated.test.ts` idiom), so the schema's
 * own explanatory docblock and the migration header cannot satisfy or trip it.
 *
 * ⚠️ **OBS-2 deletes this file** in the PR that first reads the column. That is deliberate: the
 * deletion is a visible, reviewable edit that says "the column is live now", instead of a guard
 * quietly loosened. Do not add an allowlist to keep it passing.
 *
 * Lives in `lib/`, not `lib/dal/`: it is a cross-cutting structural guard about a schema column, not
 * part of the write path — and `docs/features/write-path.md` owns `lib/dal/`, which this is not.
 */

const REPO = resolve(dirnameOf(import.meta.url), '../../..');

function dirnameOf(url: string): string {
  return fileURLToPath(new URL('.', url));
}

/** Comments out, strings kept — matching identifiers in this repo's source. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/**
 * The two files that are ALLOWED to name the column — the schema that declares it and the proof that
 * reads its catalog shape. Everything else naming `synthetic` means the column stopped being dark.
 */
const ALLOWED = ['packages/db/src/schema.ts', 'packages/db/scripts/verify.ts'];

const sources = [
  ...globSync('apps/web/**/*.{ts,tsx}', { cwd: REPO }),
  ...globSync('packages/*/src/**/*.ts', { cwd: REPO }),
  ...globSync('packages/*/scripts/**/*.ts', { cwd: REPO }),
]
  .filter((f) => !f.includes('node_modules'))
  .filter((f) => !f.endsWith('household-synthetic-is-dark.test.ts'));

describe('households.synthetic ships dark (TEN-1 1a)', () => {
  it('finds the sources (an empty glob would pass everything below)', () => {
    expect(sources.length).toBeGreaterThan(50);
  });

  it('is named only by the schema that declares it and the proof that checks its shape', () => {
    const namers = sources
      .filter((f) => /\bsynthetic\b/.test(code(join(REPO, f))))
      .map((f) => relative('', f))
      .sort();

    expect(
      namers,
      'households.synthetic is meant to ship dark until OBS-2. If OBS-2 is lighting it up, DELETE ' +
        'this test file in that PR rather than extending the allowlist.',
    ).toEqual(ALLOWED.slice().sort());
  });
});
