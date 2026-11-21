#!/usr/bin/env node
/**
 * PreToolUse(Bash) guard: git's hooks always run.
 *
 * The hooks are the local half of every gate: the conflict-marker guard, lint-staged, commitlint, and
 * pre-push's typecheck and changed tests (AGENTS.md → "Local hooks vs CI merge-gates"). The
 * maintainer's docs-only rule (2026-11-20) lets a green PR skip WAITING for another CI run; it never
 * skips the hooks. Skipping them had become a pattern across lanes (one used `--no-verify` on eight
 * PRs), and one probe commit pushed that way then failed CI's format check before reaching the step
 * it was meant to test. So it is refused here, in EVERY directory (maintainer, 2026-11-21).
 *
 * BEST-EFFORT, NOT A SECURITY BOUNDARY. It reads the forms that get typed, through the shared wrapper
 * walk in `shell-commands.mjs` (and the main-checkout guard's `lex()`).
 *
 *   denied   any git subcommand given `--no-verify` (or an abbreviation git accepts, `--no-ver`);
 *            `git commit -n`, alone or in a short-flag cluster (`-nm`, `-anm`);
 *            `HUSKY=0` or `HUSKY=false` as a prefix, through `env`, or `export`ed;
 *            `git -c core.hooksPath=…` and `--config-env=core.hooksPath=…`, any case;
 *            `git config … core.hooksPath …` that sets or unsets it (reading it is allowed);
 *            `GIT_CONFIG_KEY_<n>=core.hooksPath`, and `core.hooksPath` in `GIT_CONFIG_PARAMETERS`.
 *   allowed  `git push -n` (a dry run), `git commit -m "… no-verify …"` (a message), any text that only
 *            MENTIONS these forms (an `echo`, a heredoc fed to anything but a bare shell).
 *
 * KNOWN GAPS: a script file run by name; git launched from another program; a hooksPath already set
 * in ~/.gitconfig or .git/config; `chmod -x` on a hook; deleting `.husky/`; `git commit` through an
 * alias. The first and last are the common ones, and a review catches the rest.
 *
 * Escape hatch, visible in the command itself: a LEADING `MAT_PLAN_ALLOW_HOOK_SKIP=1` on the segment,
 * only when a person explicitly asked. Under CI (`CI`/`GITHUB_ACTIONS` set) the hook does nothing and
 * imports nothing. Malformed input or an internal error ALLOWS (fails open), as its siblings do.
 */
const ESCAPE = 'MAT_PLAN_ALLOW_HOOK_SKIP=1';
/** `--no-verify` and every unambiguous prefix git accepts for it (`--no-v` … `--no-verify`). */
const NO_VERIFY = /^--no-v(e(r(i(fy?)?)?)?)?$/;
const HOOKS_PATH = /^core\.hookspath(=|$)/i;
/** `git commit` short options whose value follows (attached, or as the next word). */
const COMMIT_VALUE = new Set(['m', 'F', 'C', 'c', 't', 'S', 'u']);
/** git's global options that take the next word as their value. */
const GIT_GLOBAL_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);
const CONFIG_READ = new Set(['--get', '--get-all', '--get-regexp', '-l', '--list', 'get', 'list']);

const REASON =
  "git's hooks always run: they are the local half of the gate. The docs-only rule skips waiting " +
  'for another CI run, never the hooks. If a hook is slow, retry it, or tell the board.';

/** Why one unwrapped command (`shell-commands.mjs`) is refused, or null. */
function hookSkipRefusal({ base, restText, assignments }) {
  for (const a of assignments) {
    const why = assignmentRefusal(a);
    if (why) return why;
  }
  if (base === 'export' || base === 'declare' || base === 'typeset') {
    for (const a of restText) {
      const why = assignmentRefusal(a);
      if (why) return `${why} (exported)`;
    }
    return null;
  }
  if (base !== 'git') return null;

  let i = 0;
  for (; i < restText.length && restText[i].startsWith('-'); i++) {
    const a = restText[i];
    const value = a.includes('=') ? a.slice(a.indexOf('=') + 1) : restText[i + 1];
    if (a === '-c' && HOOKS_PATH.test(value ?? '')) return '`git -c core.hooksPath=…`';
    if (a.startsWith('--config-env') && HOOKS_PATH.test(value ?? ''))
      return '`git --config-env=core.hooksPath=…`';
    if (GIT_GLOBAL_VALUE.has(a)) i++;
  }
  const sub = restText[i];
  const args = restText.slice(i + 1);
  if (sub === undefined) return null;

  for (const a of args) {
    if (a === '--') break;
    if (NO_VERIFY.test(a)) return `\`git ${sub} --no-verify\``;
  }
  if (sub === 'commit' && commitHasShortN(args)) return '`git commit -n`';
  if (
    sub === 'config' &&
    args.some((a) => HOOKS_PATH.test(a)) &&
    !args.some((a) => CONFIG_READ.has(a))
  )
    return '`git config core.hooksPath`';
  return null;
}

/** `-n` in `git commit`'s short options, stopping where a value starts (`-m 'not -n'`). */
function commitHasShortN(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') return false;
    if (!/^-[^-]/.test(a)) continue;
    for (let k = 1; k < a.length; k++) {
      if (a[k] === 'n') return true;
      if (COMMIT_VALUE.has(a[k])) {
        if (k === a.length - 1 && !'Su'.includes(a[k])) i++; // the value is the next word
        break;
      }
    }
  }
  return false;
}

function assignmentRefusal(a) {
  const eq = a.indexOf('=');
  if (eq < 0) return null;
  const name = a.slice(0, eq);
  const value = a.slice(eq + 1);
  if (name === 'HUSKY' && /^(0|false)$/i.test(value)) return '`HUSKY=0`';
  if (name === 'HUSKY_SKIP_HOOKS' && value !== '' && value !== '0') return '`HUSKY_SKIP_HOOKS`';
  if (/^GIT_CONFIG_KEY_\d+$/.test(name) && HOOKS_PATH.test(value))
    return '`GIT_CONFIG_KEY_n=core.hooksPath`';
  if (name === 'GIT_CONFIG_PARAMETERS' && /core\.hookspath/i.test(value))
    return '`GIT_CONFIG_PARAMETERS` setting core.hooksPath';
  return null;
}

const readStdin = () =>
  new Promise((ok) => {
    let s = '';
    process.stdin.on('data', (d) => (s += d));
    process.stdin.on('end', () => ok(s));
  });

async function main() {
  const input = JSON.parse((await readStdin()) || '{}');
  const command = input?.tool_input?.command;
  // Cheap pre-filter, on the text with quotes and backslashes dropped.
  if (
    typeof command !== 'string' ||
    !/no-v|husky|hookspath|commit|git_config/i.test(command.replace(/['"\\]/g, ''))
  )
    return;
  // Loaded only here, after the CI exit below. Safe: the sibling runs its own main only when it is
  // the entry point, and shell-commands.mjs has no main.
  const { lex } = await import('./guard-main-checkout.mjs');
  const { commands } = await import('./shell-commands.mjs');
  let what = null;
  for (const c of commands(command, lex, ESCAPE)) {
    what = hookSkipRefusal(c);
    if (what) break;
  }
  if (!what) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `${what} is blocked. ${REASON} ` +
          `If a person explicitly asked for it, prefix the command with ${ESCAPE}.`,
      },
    }),
  );
}

// Under CI the hook is a no-op with no output, and imports nothing (as guard-process-kill.mjs).
if (!process.env.CI && !process.env.GITHUB_ACTIONS)
  main().catch(() => {
    /* fail open: a guard that errors must not block every command */
  });
