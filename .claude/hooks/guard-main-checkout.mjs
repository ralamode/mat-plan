#!/usr/bin/env node
/**
 * PreToolUse(Bash) guard: the MAIN checkout stays on `main`.
 *
 * AGENTS.md → "Git & branch workflow" makes every task run in its own worktree under
 * `.claude/worktrees/`, with the main checkout used only to sync and read. The rule was written down
 * in #174, and within hours another session had switched the main checkout to a feature branch —
 * twice. Consequences seen the same day: a `git pull origin main` that would have merged `main` into
 * someone else's branch, and project skills that did not exist ("Unknown skill"), because skills load
 * from whatever branch the main checkout has checked out. A convention that fails that fast needs a
 * mechanism, like the feature-guide rule got one.
 *
 * Denies, in the main checkout only (a linked worktree is untouched):
 *   git checkout / switch / rebase / reset / merge / cherry-pick / revert / am / pull / stash
 * Allows: returning to main (`git checkout main`, `git switch main`), `git pull --ff-only` while on
 * main, and every read-only or worktree command (`status`, `log`, `fetch`, `worktree add`, …).
 * Escape hatch, visible in the command itself: prefix it with `MAT_PLAN_ALLOW_MAIN_CHECKOUT=1`.
 *
 * Input: the hook JSON on stdin ({ cwd, tool_input: { command } }). Output: a PreToolUse
 * `permissionDecision: "deny"` with the reason, or nothing (allow). Any failure to decide ALLOWS:
 * a guard that breaks every git command in the repo would get disabled, not fixed.
 */
import { execFileSync } from 'node:child_process';
import { resolve, isAbsolute } from 'node:path';
import { realpathSync } from 'node:fs';

const MUTATING = new Set([
  'checkout',
  'switch',
  'rebase',
  'reset',
  'merge',
  'cherry-pick',
  'revert',
  'am',
  'pull',
  'stash',
]);
const MAIN = 'main';
const ESCAPE = 'MAT_PLAN_ALLOW_MAIN_CHECKOUT=1';

const readStdin = () =>
  new Promise((ok) => {
    let s = '';
    process.stdin.on('data', (d) => (s += d));
    process.stdin.on('end', () => ok(s));
  });

const git = (dir, ...args) =>
  execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

/** True when `dir` is the repository's primary checkout rather than a linked worktree. */
function isMainCheckout(dir) {
  const gitDir = realpathSync(resolve(dir, git(dir, 'rev-parse', '--git-dir')));
  const common = realpathSync(resolve(dir, git(dir, 'rev-parse', '--git-common-dir')));
  return gitDir === common;
}

/**
 * Split a shell command into simple segments and find the git invocations, tracking a leading
 * `cd <dir>` and `git -C <dir>` so the guard checks the directory the command actually acts on.
 * Deliberately a heuristic, not a shell parser: it errs toward ALLOW on anything it can't read.
 */
export function gitInvocations(command, cwd) {
  const out = [];
  let dir = cwd;
  for (const raw of command.split(/&&|\|\||;|\|/)) {
    const words = raw.trim().split(/\s+/).filter(Boolean);
    while (words.length && /^[A-Z_][A-Z0-9_]*=/.test(words[0])) words.shift(); // env prefixes
    if (words[0] === 'cd' && words[1]) {
      const target = words[1].replace(/^["']|["']$/g, '');
      dir = isAbsolute(target) ? target : resolve(dir, target);
      continue;
    }
    if (words[0] !== 'git') continue;
    let i = 1;
    let gitDir = dir;
    while (i < words.length && words[i].startsWith('-')) {
      if (words[i] === '-C' && words[i + 1]) {
        const t = words[i + 1].replace(/^["']|["']$/g, '');
        gitDir = isAbsolute(t) ? t : resolve(dir, t);
        i += 2;
      } else if (words[i] === '-c' && words[i + 1]) i += 2;
      else i += 1;
    }
    out.push({ dir: gitDir, sub: words[i], args: words.slice(i + 1) });
  }
  return out;
}

/** The reason to deny, or null to allow. */
export function verdict(inv, currentBranch) {
  if (!MUTATING.has(inv.sub)) return null;
  const positional = inv.args.filter((a) => !a.startsWith('-'));
  if (
    (inv.sub === 'checkout' || inv.sub === 'switch') &&
    positional.length === 1 &&
    positional[0] === MAIN
  )
    return null; // returning the main checkout to main is the fix, not the problem
  if (inv.sub === 'pull' && inv.args.includes('--ff-only') && currentBranch === MAIN) return null;
  if (inv.sub === 'stash' && ['list', 'show'].includes(positional[0])) return null;
  return (
    `\`git ${inv.sub}\` in the MAIN checkout (${inv.dir}) is blocked: it stays on \`main\` ` +
    `(AGENTS.md → "Git & branch workflow"). Other sessions read it, and project skills load from it. ` +
    `Do this in a worktree: git fetch origin && git worktree add .claude/worktrees/<slug> -b <type>/<id>-<slug> origin/main. ` +
    `If a person explicitly asked for it here, prefix the command with ${ESCAPE}.`
  );
}

async function main() {
  const input = JSON.parse((await readStdin()) || '{}');
  const command = input?.tool_input?.command ?? '';
  const cwd = input?.cwd ?? process.cwd();
  if (!command.includes('git') || command.includes(ESCAPE)) return;
  for (const inv of gitInvocations(command, cwd)) {
    let isMain, branch;
    try {
      isMain = isMainCheckout(inv.dir);
      branch = git(inv.dir, 'branch', '--show-current');
    } catch {
      continue; // not a repo, or unreadable: allow
    }
    if (!isMain) continue;
    const reason = verdict(inv, branch);
    if (reason) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: reason,
          },
        }),
      );
      return;
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(() => {}); // fail open
