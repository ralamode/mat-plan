#!/usr/bin/env node
/**
 * SessionStart: a five-second briefing so a session starts from the repo's real state, not a guess.
 *
 * Prints (as context for the model, plus a one-line warning to the person when something is off):
 *   - the docs/status.md "Where we are" headline
 *   - open PRs
 *   - `git worktree list`, flagging worktrees whose branch already merged (stale) and any outside
 *     `.claude/worktrees/` (e.g. `/tmp`, wiped on reboot and invisible to other sessions)
 *   - a warning if the MAIN checkout is not on `main` (AGENTS.md → "Git & branch workflow")
 *
 * Every probe is best-effort: offline, no `gh`, or not a repo just drops that line. A briefing that
 * can fail a session start would be turned off.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MAIN = 'main';
const WORKTREE_HOME = '.claude/worktrees/';
const STATUS_ANCHOR = '## Where we are right now';

const run = (cmd, args, cwd) => {
  try {
    return execFileSync(cmd, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 8000,
    }).trim();
  } catch {
    return null;
  }
};

export function statusHeadline(text) {
  const at = text.indexOf(STATUS_ANCHOR);
  if (at < 0) return null;
  const para = text
    .slice(at + STATUS_ANCHOR.length)
    .split('\n\n')
    .map((p) => p.trim())
    .find(Boolean);
  return para ? para.replace(/\s+/g, ' ').slice(0, 280) : null;
}

/** Parse `git worktree list --porcelain` into { path, branch } records. */
export function parseWorktrees(porcelain) {
  return porcelain
    .split('\n\n')
    .map((block) => {
      const path = /^worktree (.+)$/m.exec(block)?.[1];
      const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? null;
      return path ? { path, branch } : null;
    })
    .filter(Boolean);
}

function main() {
  const cwd = process.cwd();
  const common = run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd);
  if (!common) return;
  const root = resolve(realpathSync(common), '..'); // the main checkout
  const lines = [];
  const warnings = [];

  const branch = run('git', ['branch', '--show-current'], root);
  if (branch && branch !== MAIN) {
    warnings.push(
      `The MAIN checkout (${root}) is on "${branch}", not ${MAIN}. Project skills load from it, so they may be missing or stale. Don't switch it back over someone's work; ask whose it is.`,
    );
  }

  try {
    const headline = statusHeadline(readFileSync(join(root, 'docs/status.md'), 'utf8'));
    if (headline) lines.push(`Where we are (docs/status.md): ${headline}`);
  } catch {}

  const prs = run(
    'gh',
    ['pr', 'list', '--state', 'open', '--json', 'number,title,headRefName'],
    root,
  );
  const merged = new Set(
    JSON.parse(
      run(
        'gh',
        ['pr', 'list', '--state', 'merged', '--limit', '100', '--json', 'headRefName'],
        root,
      ) ?? '[]',
    ).map((p) => p.headRefName),
  );
  if (prs) {
    const open = JSON.parse(prs);
    lines.push(
      open.length
        ? `Open PRs:\n${open.map((p) => `  #${p.number} ${p.title} [${p.headRefName}]`).join('\n')}`
        : 'Open PRs: none',
    );
  }

  const wts = parseWorktrees(run('git', ['worktree', 'list', '--porcelain'], root) ?? '');
  const notes = wts
    .filter((w) => resolve(w.path) !== root)
    .map((w) => {
      const flags = [];
      if (w.branch && merged.has(w.branch)) flags.push('STALE: branch merged');
      if (!w.path.includes(WORKTREE_HOME)) flags.push(`outside ${WORKTREE_HOME}`);
      return `  ${w.path} [${w.branch ?? 'detached'}]${flags.length ? `  ← ${flags.join('; ')}` : ''}`;
    });
  if (notes.length) lines.push(`Worktrees (only remove ones you created):\n${notes.join('\n')}`);
  const stale = notes.filter((n) => n.includes('STALE')).length;
  if (stale) warnings.push(`${stale} worktree(s) belong to merged PRs.`);

  const out = {
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') },
  };
  if (warnings.length) out.systemMessage = `mat-plan: ${warnings.join(' ')}`;
  process.stdout.write(JSON.stringify(out));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch {} // never fail a session start
}
