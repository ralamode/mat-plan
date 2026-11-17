/**
 * `pnpm test:changed` — the vitest tests a branch's change can reach, for the pre-push hook (DX-18 D4,
 * docs/plans/dx-18-heavy-runs-to-ci.md).
 *
 * This is a local courtesy, NOT a gate: CI's `quality` job runs the whole suite on every code PR.
 * It narrows pre-push because several lanes share one machine (the maintainer's directive,
 * 2026-11-17: "move everything heavy off of the local machine").
 *
 * What it runs, in order:
 *   1. **A full run,** when a changed file matches a force-rerun trigger (the lockfile, a manifest, a
 *      tsconfig, a vitest/vite config). Vitest would widen to everything anyway; this says so first.
 *   2. **`vitest run --changed <base>`,** when anything under `apps/web/` or `packages/` changed. Vitest
 *      resolves the changed files through git itself and traces importers. ⚠️ Never hand it
 *      repo-relative paths: they resolve against `apps/web` and silently match nothing.
 *   3. **The filesystem scanners, always** (unless the change is Markdown only). These tests find their
 *      targets with `globSync` / `readFileSync` (a page that lacks a session check, a workflow that
 *      names a bypass), so import tracing would never select them. The list is DERIVED by grepping
 *      test files, and the script fails if one of the scanners named in REQUIRED_SCANNERS stops
 *      matching: that would mean the derivation went blind, not that the scanner is gone.
 *
 * When nothing is reached it prints "no tests reached by this change" and exits 0.
 *
 *   node .github/scripts/test-changed.mjs [--base <ref>] [--dry-run] [--list-scanners]
 *
 * `--dry-run` prints the selection and runs nothing. `--list-scanners` prints the derived scanners
 * and checks them. Self-test: test-changed.test.sh (never runs vitest).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { defaultBase } from './default-base.mjs';

/**
 * Basenames that force a full run. 🔴 **Must match `forceRerunTriggers` in apps/web/vitest.config.ts**
 * (vitest's defaults plus DX-18's three); test-changed.test.sh fails if the config drops one.
 */
export const FORCE_RERUN = [
  /^package\.json$/,
  /^(vitest|vite)\.config\./,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^tsconfig.*\.json$/,
];

/**
 * What a scanner looks like: a test that reads files rather than importing them. Whole words, via
 * `git grep -w` (git's ERE has no portable word boundary).
 */
const SCANNER_PATTERN = 'globSync|readFileSync';

/**
 * Scanners the derivation must keep finding. If one goes missing, the grep went blind (a scanner
 * switched to another fs call), and the hook would silently stop running it.
 */
export const REQUIRED_SCANNERS = [
  'apps/web/app/pages-need-a-session.test.ts',
  'apps/web/app/tenancy-is-not-cached.test.ts',
  'apps/web/test/bypass-is-contained.test.ts',
  'packages/db/src/writers/no-bare-unhide.test.ts',
  'apps/web/lib/privacy/notice-content.test.ts',
];

/** Where vitest's tests and their imports live; a change outside these reaches no import graph. */
const TRACED = /^(apps\/web|packages)\//;

/**
 * A change made only of these reaches no scanner. Markdown, except the privacy notice and inventory,
 * which `notice-content` and `generate-privacy-notice` read.
 */
const inert = (f) => /\.md$/.test(f) && !TRACED.test(f) && !f.startsWith('docs/privacy/');

const git = (root, args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const nul = (s) => s.split('\0').filter(Boolean);

/**
 * The files this push carries: the COMMITTED diff `base...HEAD`, with `--no-renames` so a move's
 * source path counts too.
 *
 * 🔴 **Commits only, never the working tree** (2026-11-17). An earlier version used vitest's
 * `--changed <base>`, which also counts staged, unstaged and untracked files. A worktree with a
 * mutation patch left applied, or with other local edits, then selected tests the push never carried:
 * lane E's db-and-docs push ran the editor suites for about 22 minutes under load. A push sends
 * commits, so the hook tests commits.
 */
export function changedFiles(root, base) {
  return [
    ...new Set(nul(git(root, ['diff', '--name-only', '--no-renames', '-z', `${base}...HEAD`]))),
  ].sort();
}

/** Local changes the push does not carry: reported, never tested here. */
export function uncommitted(root) {
  return [
    ...new Set([
      ...nul(git(root, ['diff', '--cached', '--name-only', '-z'])),
      ...nul(git(root, ['ls-files', '-z', '--other', '--modified', '--exclude-standard'])),
    ]),
  ].sort();
}

/** Every tracked test file that reads the filesystem. Exits 2 if a required scanner is missing. */
export function scanners(root) {
  let out = '';
  try {
    out = git(root, ['grep', '-lwE', SCANNER_PATTERN, '--', '*.test.ts', '*.test.tsx']);
  } catch (e) {
    if (e.status !== 1) throw e; // 1 = no match
  }
  const found = out.split('\n').filter(Boolean).sort();
  const missing = REQUIRED_SCANNERS.filter((f) => !found.includes(f));
  if (missing.length) {
    console.error(
      `test-changed: the scanner grep (${SCANNER_PATTERN}) no longer finds:\n` +
        missing.map((f) => `  ${f}`).join('\n') +
        '\nIf a scanner moved or changed how it reads files, update REQUIRED_SCANNERS or the pattern in' +
        ' .github/scripts/test-changed.mjs. Refusing to guess.',
    );
    process.exit(2);
  }
  return found;
}

/** The plan for a change: what runs, and why. Pure, so the self-test can assert on it. */
export function select(changed, scannerFiles) {
  const trigger = changed.find((f) => FORCE_RERUN.some((re) => re.test(basename(f))));
  if (trigger) return { mode: 'full', reason: `${trigger} forces a full run` };
  const traced = changed.filter((f) => TRACED.test(f));
  const scan = changed.every(inert) ? [] : scannerFiles;
  if (!traced.length && !scan.length) {
    return { mode: 'none', reason: 'no tests reached by this change' };
  }
  return { mode: 'changed', traced, scanners: scan };
}

function print(plan, base) {
  console.log(`mode: ${plan.mode}`);
  if (plan.reason) console.log(`reason: ${plan.reason}`);
  if (plan.mode !== 'changed') return;
  console.log(`base: ${base}`);
  for (const f of plan.traced) console.log(`traced: ${f}`);
  for (const f of plan.scanners) console.log(`scanner: ${f}`);
}

const vitest = (root, args) =>
  spawnSync('pnpm', ['--filter', 'web', 'exec', 'vitest', 'run', ...args], {
    cwd: root,
    stdio: 'inherit',
  }).status ?? 1;

/** `vitest related --run --passWithNoTests <files>`: the tests whose import graph reaches `files`. */
const vitestRelated = (root, files) =>
  spawnSync(
    'pnpm',
    ['--filter', 'web', 'exec', 'vitest', 'related', '--run', '--passWithNoTests', ...files],
    { cwd: root, stdio: 'inherit' },
  ).status ?? 1;

function main(argv) {
  const flag = (name) => argv.includes(name);
  const at = argv.indexOf('--base');
  const root = git(process.cwd(), ['rev-parse', '--show-toplevel']).trim();
  const scannerFiles = scanners(root);
  if (flag('--list-scanners')) {
    console.log(scannerFiles.join('\n'));
    return 0;
  }
  const base = defaultBase(at >= 0 ? argv[at + 1] : undefined);
  const plan = select(changedFiles(root, base), scannerFiles);
  const local = uncommitted(root);
  if (flag('--dry-run')) {
    print(plan, base);
    for (const f of local) console.log(`untested-local: ${f}`);
    return 0;
  }
  if (local.length) {
    console.log(
      `test-changed: ${local.length} uncommitted file(s) are not part of this push and are not tested here.`,
    );
  }
  if (plan.mode === 'none') {
    console.log(`test-changed: ${plan.reason}.`);
    return 0;
  }
  if (plan.mode === 'full') {
    console.log(`test-changed: ${plan.reason}; a full run is due, running the whole suite.`);
    return vitest(root, []);
  }
  console.log(
    `test-changed: ${plan.traced.length} changed file(s) traced against ${base}, plus ` +
      `${plan.scanners.length} filesystem scanner(s). CI runs the whole suite.`,
  );
  // Both run even if the first fails, so one push reports everything it would have caught.
  // `--passWithNoTests`: a changed file no test imports is "nothing reached", not a failure.
  // `vitest related` takes the committed files as ABSOLUTE paths: it resolves a path against its own
  // root (apps/web), so a repo-relative path would silently match nothing.
  const traced = plan.traced.length
    ? vitestRelated(
        root,
        plan.traced.map((f) => join(root, f)),
      )
    : 0;
  const scanned = plan.scanners.length
    ? vitest(
        root,
        plan.scanners.map((f) => join(root, f)),
      )
    : 0;
  return traced || scanned;
}

const runAsScript = () => {
  try {
    return (
      !!process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
    );
  } catch {
    return false;
  }
};
if (runAsScript()) process.exit(main(process.argv.slice(2)));
