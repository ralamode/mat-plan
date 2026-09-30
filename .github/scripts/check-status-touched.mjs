#!/usr/bin/env node
/**
 * Status-drift guard: a branch that changes the product must update docs/status.md.
 *
 * AGENTS.md → "Status rides with the work" says the "where we are" pointer, backlog row and changelog
 * are updated IN THE SAME PR as the change. That rule was prose, and prose drifted: #156 exists
 * because the status page was hand-written from memory while PRs merged underneath it. This makes
 * the cheap half mechanical — "did you touch it at all" — and leaves "is it right" to review.
 *
 * Which branches owe it: a `feat|fix|db|perf|refactor` type, read from the branch name
 * (`<type>/<id>-<slug>`) OR from any Conventional Commit subject since the merge base. `docs`, `chore`,
 * `test`, `ci` and the rest pass without it — they rarely move what status.md tracks.
 *
 * Escape hatch: STATUS_SKIP="<reason>" (mirrors the `docs-skip-feature-map` / `ci-skip-e2e` labels).
 * The reason is printed so it can be pasted into the PR description, where the skip stays visible.
 *
 * Local-only for now (run by the ship-pr skill, like guides:check before it was wired into CI);
 * promoting it to a CI gate is a CI change and gets its own plan.
 *
 * Usage:
 *   node .github/scripts/check-status-touched.mjs [baseRef]   # default: origin/main
 */
import { execFileSync } from 'node:child_process';

const STATUS_FILE = 'docs/status.md';
const OWES_STATUS = ['feat', 'fix', 'db', 'perf', 'refactor'];
const SKIP_ENV = 'STATUS_SKIP';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const lines = (s) => s.split('\n').filter(Boolean);

const base = process.argv[2] ?? 'origin/main';
let mergeBase;
try {
  mergeBase = git('merge-base', base, 'HEAD');
} catch {
  console.error(`Could not resolve a merge base with '${base}'. Pass one explicitly.`);
  process.exit(2);
}

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
const branchType = /^([a-z]+)\//.exec(branch)?.[1] ?? null;
const commitTypes = lines(git('log', '--format=%s', `${mergeBase}..HEAD`))
  .map((s) => /^([a-z]+)(\([^)]*\))?!?:/.exec(s)?.[1])
  .filter(Boolean);

const owing = [...new Set([branchType, ...commitTypes])].filter((t) => OWES_STATUS.includes(t));
if (owing.length === 0) {
  console.log(
    `Status guard OK — branch type(s) ${[branchType, ...new Set(commitTypes)].filter(Boolean).join(', ') || 'none'} don't owe ${STATUS_FILE}.`,
  );
  process.exit(0);
}

// Committed changes PLUS the working tree, for the same reason as check-feature-guides.mjs: the
// useful moment to run this is before the last commit.
const changed = new Set([
  ...lines(git('diff', '--name-only', `${mergeBase}...HEAD`)),
  ...lines(git('diff', '--name-only', 'HEAD')),
  ...lines(git('ls-files', '--others', '--exclude-standard')),
]);

if (changed.has(STATUS_FILE)) {
  console.log(`Status guard OK — ${STATUS_FILE} is updated on this ${owing.join('/')} branch.`);
  process.exit(0);
}

const skip = process.env[SKIP_ENV]?.trim();
if (skip) {
  console.log(`Status guard SKIPPED (${SKIP_ENV}): ${skip}
  Paste this into the PR description: "status.md not updated — ${skip}"`);
  process.exit(0);
}

console.error(`
Status guard failed: this is a ${owing.join('/')} branch and ${STATUS_FILE} is untouched.

AGENTS.md → "Status rides with the work": update the "Where we are" pointer if this moves it, the
backlog row, and a Changelog entry — in THIS PR, written from the diff, not from memory (#156).

If this change genuinely doesn't move anything status.md tracks, say why and re-run:
  ${SKIP_ENV}="<one-line reason>" pnpm status:check
`);
process.exit(1);
