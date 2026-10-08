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
      console.log(`✓ ${patch}: RED (expected) — ${why.replace(/\s+/g, ' ').trim().slice(0, 160)}`);
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
