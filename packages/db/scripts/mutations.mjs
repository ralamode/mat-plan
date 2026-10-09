#!/usr/bin/env node
/**
 * The `db:verify` mutation gate (TEN-1 1b, the plan's R5 mitigation 2).
 *
 * For each committed patch in `scripts/mutations/`: `git apply` it, run `db:verify`, assert a
 * **non-zero** exit, and revert. A patch that leaves `db:verify` green is a patch whose assertions
 * were proving nothing — which, for a BOLA predicate, is strictly worse than having no test, because
 * it is counted as coverage.
 *
 * Patch files, never a runtime flag: a switch that can disable the household conjunct must not exist
 * in shipped `packages/db` source. See `scripts/mutations/README.md` for what each one must redden.
 *
 * ⚠️ It refuses to run when any patched path has uncommitted *staged* changes it cannot restore, and
 * it always reverts in a `finally` — but it does edit the working tree while it runs, so do not run
 * it concurrently with anything else that touches `packages/db`.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');
const REPO = resolve(PKG, '../..');
const DIR = join(HERE, 'mutations');

const patches = readdirSync(DIR)
  .filter((f) => f.endsWith('.patch'))
  .sort();

if (patches.length === 0) {
  console.error('mutation gate: no patches found — the gate would pass vacuously');
  process.exit(1);
}

const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });

let failed = 0;
for (const patch of patches) {
  const path = join(DIR, patch);
  // Reverse-check first: a patch that already applies in reverse means the tree is mutated.
  try {
    git('apply', '--check', path);
  } catch {
    console.error(`✗ ${patch}: does not apply — regenerate it (see mutations/README.md)`);
    failed += 1;
    continue;
  }
  git('apply', path);
  try {
    const run = spawnSync('pnpm', ['db:verify'], { cwd: PKG, encoding: 'utf8' });
    if (run.status === 0) {
      console.error(
        `✗ ${patch}: db:verify STAYED GREEN under this mutation — the proofs it should break are vacuous`,
      );
      failed += 1;
    } else {
      const why =
        (run.stderr || run.stdout || '').match(/AssertionError[^\n]*\n?[^\n]*/)?.[0] ??
        `exit ${run.status}`;
      const summary = why.replace(/\s+/g, ' ').trim();
      // The patch's `.expect` file names the assertion that must be the FIRST to fail. Without this
      // the runner only proved "something went red", so two patches breaking the same assertion were
      // indistinguishable — and a patch's reason for existing (03: the first failure is a 1c one) was
      // asserted in four documents and checked by nothing. A gate that cannot tell which proof it
      // broke is the vacuity this directory exists to catch, pointed at itself.
      const expectPath = join(DIR, patch.replace(/\.patch$/, '.expect'));
      const expected = existsSync(expectPath) ? readFileSync(expectPath, 'utf8').trim() : '';
      if (expected && !summary.includes(expected)) {
        console.error(
          `✗ ${patch}: RED, but on the WRONG assertion.\n    expected first failure: ${expected}\n    got:                    ${summary.slice(0, 200)}`,
        );
        failed += 1;
      } else {
        console.log(`✓ ${patch}: RED (expected) — ${summary.slice(0, 160)}`);
      }
    }
  } finally {
    git('apply', '-R', path);
  }
}

if (failed > 0) {
  console.error(`\nmutation gate: ${failed} of ${patches.length} patches did not do their job`);
  process.exit(1);
}
console.log(`\n✓ mutation gate: ${patches.length} mutations, all RED`);
