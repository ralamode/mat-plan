#!/usr/bin/env node
/**
 * Changelog-entry guard: a branch that changes the product must record what changed.
 *
 * AGENTS.md → "Status rides with the work": the entry is written IN THE SAME PR as the change, from
 * the diff, not from memory (#156 is what happened when it wasn't). This makes the cheap half
 * mechanical — "is there an entry at all" — and leaves "is it right" to review.
 *
 * What counts as the entry depends on the branch (DX-2, docs/plans/dx-2-changelog-fragments.md):
 * - POST-DX-2 — `docs/changelog/README.md` exists IN THE WORKING TREE. Read from the working tree, not
 *   the merge base, so a legacy branch mid-merge of `main` (keep-mergeable, possibly conflicted and
 *   uncommitted) is already judged by the new rule. The branch must ADD a fragment
 *   `docs/changelog/<YYYY-MM-DD>-<branch with / → ->.md` (committed, staged or untracked). Editing
 *   status.md alone fails. The format lives in docs/changelog/README.md, not here.
 * - LEGACY — no README yet: docs/status.md touched, as before DX-2.
 * - FROZEN HISTORY (post-DX-2, EVERY branch type, before the owes check, STATUS_SKIP can't bypass it):
 *   adding a line to status.md's "## Changelog (merged PRs)" or the skills README's "## Changelog"
 *   fails. A docs/chore branch cut before DX-2 owes nothing, yet can merge its entry cleanly into the
 *   closed history; this is what catches it.
 *
 * What this no longer proves: that status.md's "Where we are" pointer and backlog rows moved with a
 * merged backlog item. That is back to review (ship-pr's red flag, review-pr dimension 7).
 *
 * Which branches owe it: a `feat|fix|db|perf|refactor|revert` type, read from the branch name
 * (`<type>/<id>-<slug>`) OR from any Conventional Commit subject since the merge base. `docs`, `chore`,
 * `test`, `ci` and the rest pass without it. This is a FLOOR, not the rule: a pass means "not forced",
 * never "no entry needed" — docs and chore PRs routinely write one too.
 * - `db` only ever comes from the branch name (commitlint has no `db` type; history uses `feat(db):`).
 * - `refactor` is owed on purpose: a refactor that moves nothing says so with STATUS_SKIP, visibly.
 * - `revert` is owed because undoing a feature moves what the changelog tracks as much as shipping it.
 *
 * The branch name comes from STATUS_BRANCH when set, else `git rev-parse --abbrev-ref HEAD`.
 * keep-mergeable works in a DETACHED worktree and passes STATUS_BRANCH=<headRefName>. With no name at
 * all, only commit subjects decide "owes", and a fragment only has to match the generic name shape.
 *
 * Escape hatch: STATUS_SKIP="<reason>" (mirrors the `docs-skip-feature-map` / `ci-skip-e2e` labels).
 * The reason is printed so it can be pasted into the PR description, where the skip stays visible.
 *
 * Local-only for now (run by the ship-pr skill, like guides:check before it was wired into CI);
 * promoting it to a CI gate is a CI change and gets its own plan.
 *
 * Usage:
 *   node .github/scripts/check-status-touched.mjs [baseRef]   # default: origin/main
 * Fetch first (`git fetch origin`): a stale base counts main's own commits and edits as this
 * branch's, which gives both false failures and false passes. ship-pr step 1 already does.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const STATUS_FILE = 'docs/status.md';
const CHANGELOG_DIR = 'docs/changelog';
const CHANGELOG_README = `${CHANGELOG_DIR}/README.md`;
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/;
/** The shape when no branch name is known (detached HEAD without STATUS_BRANCH). */
const GENERIC_NAME = /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9._-]*\.md$/;
/** `feat/v1-2-x` → `feat-v1-2-x`: the branch part of a fragment's filename. */
const fragmentSlug = (branch) => branch.replaceAll('/', '-');
/**
 * Changelog sections frozen by DX-2: history stays, nothing is added. Checked on EVERY branch, since a
 * docs/chore branch cut before DX-2 owes no entry but can still merge one into the closed history.
 */
const FROZEN = [
  { file: STATUS_FILE, heading: '## Changelog (merged PRs)' },
  { file: '.claude/skills/README.md', heading: '## Changelog' },
];
const OWES_STATUS = ['feat', 'fix', 'db', 'perf', 'refactor', 'revert'];
const SKIP_ENV = 'STATUS_SKIP';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const lines = (s) => s.split('\n').filter(Boolean);

const base = process.argv[2] ?? 'origin/main';
let mergeBase;
try {
  mergeBase = git('merge-base', base, 'HEAD');
} catch {
  console.error(
    `Could not resolve a merge base with '${base}'. Is this a git repo, and is '${base}' fetched? ` +
      'Pass a base explicitly if not.',
  );
  process.exit(2);
}

const envBranch = process.env.STATUS_BRANCH?.trim();
const headName = git('rev-parse', '--abbrev-ref', 'HEAD');
const branch = envBranch || (headName === 'HEAD' ? null : headName);
const branchType = branch ? (/^([a-z]+)\//.exec(branch)?.[1] ?? null) : null;
if (!branch) {
  // A detached checkout (a review worktree, a CI merge ref) has no branch name, so only commit
  // subjects are seen. Say so rather than silently judging on half the evidence.
  console.warn(
    'Status guard: detached HEAD — no branch type to read; judging by commit subjects only ' +
      '(set STATUS_BRANCH=<branch> to fix that).',
  );
}
const commitTypes = lines(git('log', '--format=%s', `${mergeBase}..HEAD`))
  // `git revert` writes `Revert "feat(x): …"`, which commitlint ignores by default, so match it too.
  .map((s) => (/^Revert "/.test(s) ? 'revert' : /^([a-z]+)(\([^)]*\))?!?:/.exec(s)?.[1]))
  .filter(Boolean);

const root = git('rev-parse', '--show-toplevel');
const postDx2 = existsSync(join(root, CHANGELOG_README));

// A frozen section's top-level ENTRIES (`- ` bullet lines) from `rev:path`, or from the working tree
// when rev is null, up to the next `## ` heading. null when the file or the heading is missing, so a
// renamed heading is told apart from an empty section.
const sectionEntries = (rev, { file, heading }) => {
  let text;
  try {
    text = rev === null ? readFileSync(join(root, file), 'utf8') : git('show', `${rev}:${file}`);
  } catch {
    return null;
  }
  const all = text.split('\n');
  const start = all.findIndex((l) => l.trim() === heading);
  if (start === -1) return null;
  const end = all.findIndex((l, i) => i > start && /^## /.test(l));
  return all.slice(start + 1, end === -1 ? undefined : end).filter((l) => /^- /.test(l));
};

// Post-DX-2, adding an ENTRY to a frozen changelog fails on every branch type, and STATUS_SKIP does
// NOT bypass it: the skip means "no entry needed", and an entry that exists can always move to a
// fragment. Read from the WORKING TREE (committed + staged + unstaged).
// - Entries, not lines: re-wrapping an old entry adds continuation lines, never a `- ` line.
// - Net of removals: fixing a typo or a stale path in an old entry (skills:check demands the latter)
//   changes a `- ` line; one new line against one removed one is an edit, not an addition. "Removed"
//   counts only entries that the merge base AND main's tip both have, so a line main itself edited
//   after the branch was cut can't cancel out a genuinely new entry.
// - Main's own entries arriving mid-merge are on main's tip, so they are never counted as new.
// - A heading that existed at the merge base but is gone now fails: renaming it would switch this off.
if (postDx2) {
  const misfiled = FROZEN.flatMap((section) => {
    const where = `${section.file} → "${section.heading}"`;
    const atBase = sectionEntries(mergeBase, section);
    const now = sectionEntries(null, section);
    if (now === null)
      return atBase === null ? [] : [`${where}: the heading was renamed or removed`];
    const atTip = sectionEntries(base, section) ?? [];
    const known = new Set([...(atBase ?? []), ...atTip]);
    const tip = new Set(atTip);
    const nowSet = new Set(now);
    const added = now.filter((l) => !known.has(l));
    const removed = (atBase ?? []).filter((l) => tip.has(l) && !nowSet.has(l));
    return added.length > removed.length ? [`${where}: ${added[0].trim()}`] : [];
  });
  if (misfiled.length) {
    console.error(`
Status guard failed: this branch adds to a changelog that DX-2 froze.
  ${misfiled.join('\n  ')}

Move the entry into ${CHANGELOG_DIR}/<YYYY-MM-DD>-<branch with / → ->.md (format in ${CHANGELOG_README})
and take it out of the frozen section, or restore the heading. Editing an existing entry is fine.
STATUS_SKIP does not bypass this check.
`);
    process.exit(1);
  }
}

const owing = [...new Set([branchType, ...commitTypes])].filter((t) => OWES_STATUS.includes(t));
if (owing.length === 0) {
  console.log(
    `Status guard OK — branch type(s) ${[...new Set([branchType, ...commitTypes])].filter(Boolean).join(', ') || 'none'} don't owe a changelog entry.`,
  );
  process.exit(0);
}

// Committed changes PLUS the index and untracked files, for the same reason as
// check-feature-guides.mjs: the useful moment to run this is before the last commit.
let ok;
let problem = '';
if (postDx2) {
  // ADDED only (`--diff-filter=A`): editing an old fragment is not writing a new one. `--no-renames`
  // so an add that happens to resemble a deleted file is still seen as an add, not a rename.
  const added = new Set([
    ...lines(
      git(
        'diff',
        '--name-only',
        '--diff-filter=A',
        '--no-renames',
        `${mergeBase}...HEAD`,
        '--',
        CHANGELOG_DIR,
      ),
    ),
    ...lines(
      git(
        'diff',
        '--cached',
        '--name-only',
        '--diff-filter=A',
        '--no-renames',
        '--',
        CHANGELOG_DIR,
      ),
    ),
    ...lines(git('ls-files', '--others', '--exclude-standard', '--', CHANGELOG_DIR)),
  ]);
  // Mid-merge of `main`, main's own new fragments are staged adds too. They are on the base already,
  // so they are never this branch's entry — which matters most when no branch name is known.
  for (const f of lines(git('ls-tree', '-r', '--name-only', base, '--', CHANGELOG_DIR)))
    added.delete(f);
  // The name check alone rejects a nested path (`sub/…` has no date prefix, and GENERIC_NAME admits
  // no `/`) and README.md (no date prefix), so no separate filters for those.
  // A literal comparison, never a regex built from the branch name (it may hold `.`, `+`, `(`).
  const wanted = branch ? `${fragmentSlug(branch)}.md` : null;
  const named = (f) => {
    const name = f.slice(CHANGELOG_DIR.length + 1);
    if (!wanted) return GENERIC_NAME.test(name);
    return DATE_PREFIX.test(name) && name.replace(DATE_PREFIX, '') === wanted;
  };
  ok = [...added].some(named);
  const rejected = [...added].filter((f) => f !== CHANGELOG_README && !named(f));
  if (!ok && rejected.length > 0) {
    problem = `\nFound, but not a valid entry for this branch: ${rejected.join(', ')}`;
  }
} else {
  // `--diff-filter=d` so deleting status.md never counts as updating it.
  const changed = new Set([
    ...lines(git('diff', '--name-only', '--diff-filter=d', `${mergeBase}...HEAD`)),
    ...lines(git('diff', '--name-only', '--diff-filter=d', 'HEAD')),
    ...lines(git('ls-files', '--others', '--exclude-standard')),
  ]);
  ok = changed.has(STATUS_FILE);
}

if (ok) {
  console.log(
    postDx2
      ? `Status guard OK — a changelog fragment is added on this ${owing.join('/')} branch.`
      : `Status guard OK — ${STATUS_FILE} is updated on this ${owing.join('/')} branch.`,
  );
  process.exit(0);
}

const skip = process.env[SKIP_ENV]?.trim();
if (skip) {
  console.log(`Status guard SKIPPED (${SKIP_ENV}): ${skip}
  Paste this into the PR description: "${postDx2 ? 'no changelog fragment' : 'status.md not updated'} — ${skip}"`);
  process.exit(0);
}

// The LOCAL date ("the day you wrote it"): toISOString is UTC, a day ahead every US evening.
const now = new Date();
const today = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
  .map((n) => String(n).padStart(2, '0'))
  .join('-');
const expected = `${CHANGELOG_DIR}/${today}-${branch ? fragmentSlug(branch) : '<branch with / → ->'}.md`;
console.error(
  postDx2
    ? `
Status guard failed: this is a ${owing.join('/')} branch and it adds no changelog fragment.${problem}

Add ${expected} — the format and link forms are in ${CHANGELOG_README}. If a changelog entry
went into ${STATUS_FILE} (a branch cut before DX-2), MOVE it into that file; keep any backlog-row or
"Where we are" pointer edits in ${STATUS_FILE}.

If this change genuinely doesn't warrant an entry, say why and re-run:
  ${SKIP_ENV}="<one-line reason>" pnpm status:check
`
    : `
Status guard failed: this is a ${owing.join('/')} branch and ${STATUS_FILE} is untouched.

AGENTS.md → "Status rides with the work": update the "Where we are" pointer if this moves it, the
backlog row, and a Changelog entry — in THIS PR, written from the diff, not from memory (#156).

If this change genuinely doesn't move anything status.md tracks, say why and re-run:
  ${SKIP_ENV}="<one-line reason>" pnpm status:check
`,
);
process.exit(1);
