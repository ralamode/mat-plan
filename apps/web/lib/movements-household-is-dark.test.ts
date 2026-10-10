import { globSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * TEN-2a's read-side dark claim, as a test rather than a sentence.
 *
 * `movements.household_id` (migration 0015) ships **dark**: it lands ahead of TEN-2b, its only
 * consumer, and the argument for that being safe is that **nothing reads or writes it** — so there
 * is no window in which a Vercel deploy that selects the column runs ahead of `migrate.yml` and
 * answers a page or a Server Action with `42703 undefined column`.
 *
 * ⚠️ **This is the READ half, and it needs its own test.** `db:verify`'s
 * `household_id IS NOT NULL → 0` assertion falsifies a **writer**, not a reader, and
 * `apps/web/lib/dal/scoped.test.ts` is no backstop either: its rule is _"reaches `db` ⇒ resolves or
 * is handed a `HouseholdScope`"_ — a scope-PRESENCE rule, so a properly scoped reader that selects
 * this column satisfies it. The DB-level all-NULL assertion is the load-bearing half; this is the
 * only thing covering the `42703` window. Known gap, stated: a destructured alias evades a grep.
 *
 * Shape and reasoning: `household-synthetic-is-dark.test.ts` (TEN-1 1a), whose precedent is what
 * makes "no reader" a gate here rather than a claim.
 *
 * ⚠️ **TEN-2b DELETES this file** in the PR that first reads or writes the column. That is
 * deliberate: the deletion is a visible, reviewable edit saying "the column is live now", instead of
 * a guard quietly loosened. Do not add an allowlist to keep it passing.
 */

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');

/** Comments out, strings kept — the `household-synthetic-is-dark.test.ts` idiom. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/**
 * The two trees that could produce a runtime read: the DB package's own source (queries + writers)
 * and the app's library/DAL. `packages/db/scripts/` is deliberately out of scope — `verify.ts` is
 * where the column's shape is PROVED, and it never runs in a request.
 */
const sources = [
  ...globSync('apps/web/lib/**/*.{ts,tsx}', { cwd: REPO }),
  ...globSync('packages/db/src/**/*.ts', { cwd: REPO }),
]
  .filter((f) => !f.includes('node_modules'))
  .filter((f) => !f.endsWith('movements-household-is-dark.test.ts'));

describe('movements.household_id ships dark (TEN-2a)', () => {
  it('finds the sources (an empty glob would pass the assertion below for free)', () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it('is named by no query, writer or DAL module', () => {
    const namers = sources
      .filter((f) => /movements\s*\.\s*(householdId|household_id)/.test(code(join(REPO, f))))
      .map((f) => relative('', f))
      .sort();

    expect(
      namers,
      'movements.household_id is meant to ship dark until TEN-2b. If TEN-2b is lighting it up, ' +
        'DELETE this test file in that PR rather than extending an allowlist.',
    ).toEqual([]);
  });
});
