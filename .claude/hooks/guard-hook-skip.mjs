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
 *   denied   on the subcommands that run hooks (commit, push, merge, pull, rebase, am, revert,
 *            cherry-pick): `--no-verify` (or a prefix of it; git itself needs `--no-veri`);
 *            `git commit -n`, alone or in a short-flag cluster (`-nm`, `-anm`);
 *            `HUSKY=0` or `HUSKY=false` as a prefix or through `env`/`sudo` (and `export`ed, anywhere);
 *            `git -c core.hooksPath=…` and `--config-env=core.hooksPath=…`, any case;
 *            and anywhere: `git config … core.hooksPath …` that WRITES it (a write flag, or a value);
 *            reading it, and restoring husky's own `.husky/_`, are allowed;
 *            `GIT_CONFIG_KEY_<n>=core.hooksPath`, and `core.hooksPath` in `GIT_CONFIG_PARAMETERS`.
 *   allowed  `git push -n` (a dry run), `git commit -m "… no-verify …"` (a message), `git log -S
 *            --no-verify` (a search), `git -c core.hooksPath=/dev/null worktree add` (the hardened
 *            checkout of untrusted code), and any text that only MENTIONS these forms.
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
/** `--no-verify` and the prefixes that match it (git itself needs at least `--no-veri`). */
const NO_VERIFY = /^--no-v(e(r(i(fy?)?)?)?)?$/;
const HOOKS_PATH = /^core\.hookspath(=|$)/i;
/** The subcommands that run this repo's hooks (pre-commit, commit-msg, pre-push) or a commit's. */
const HOOK_SUBS = new Set([
  'commit',
  'push',
  'merge',
  'pull',
  'rebase',
  'am',
  'revert',
  'cherry-pick',
]);
/** `git commit` short options whose value follows (attached, or as the next word). */
const COMMIT_SHORT_VALUE = new Set(['m', 'F', 'C', 'c', 't', 'S', 'u']);
/** `git commit` long options that take the next word as their value when not `--opt=value`. */
const COMMIT_LONG_VALUE = new Set([
  '--message',
  '--file',
  '--author',
  '--date',
  '--trailer',
  '--template',
  '--reuse-message',
  '--reedit-message',
  '--fixup',
  '--squash',
  '--cleanup',
  '--pathspec-from-file',
]);
/** git's global options that take the next word as their value. */
const GIT_GLOBAL_VALUE = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--config-env',
]);
/** `git config` forms that WRITE; anything else naming the key is a read. */
const CONFIG_WRITE = new Set([
  '--unset',
  '--unset-all',
  '--replace-all',
  '--add',
  '--rename-section',
  '--remove-section',
  'set',
  'unset',
]);
/** Restoring husky's own path writes the key but puts the hooks back. */
const HUSKY_PATH = '.husky/_';

const REASON =
  "git's hooks always run: they are the local half of the gate. The docs-only rule skips waiting " +
  'for another CI run, never the hooks. If a hook is slow, retry it, or tell the board.';

/** Why one unwrapped command (`shell-commands.mjs`) is refused, or null. */
function hookSkipRefusal({ base, restText, assignments }) {
  if (base === 'export' || base === 'declare' || base === 'typeset') {
    for (const a of restText) {
      const why = assignmentRefusal(a);
      if (why) return `${why} (exported)`;
    }
    return null;
  }
  if (base !== 'git') return null;

  let i = 0;
  const globalConfig = []; // `-c` and `--config-env` values
  for (; i < restText.length && restText[i].startsWith('-'); i++) {
    const a = restText[i];
    if (a === '-c' || a === '--config-env') globalConfig.push(restText[i + 1] ?? '');
    else if (a.startsWith('--config-env=')) globalConfig.push(a.slice('--config-env='.length));
    if (GIT_GLOBAL_VALUE.has(a)) i++;
  }
  const sub = restText[i];
  const args = restText.slice(i + 1);
  if (sub === undefined) return null;
  if (sub === 'config') return configRefusal(args);
  if (!HOOK_SUBS.has(sub)) return null; // `git log -S --no-verify`, a hardened `-c … worktree add`

  for (const a of assignments) {
    const why = assignmentRefusal(a);
    if (why) return why;
  }
  if (globalConfig.some((v) => HOOKS_PATH.test(v))) return `\`git -c core.hooksPath=… ${sub}\``;
  for (const a of optionWords(sub, args)) {
    if (NO_VERIFY.test(a)) return `\`git ${sub} --no-verify\``;
    if (sub === 'commit' && /^-[^-]/.test(a) && shortHasN(a)) return '`git commit -n`';
  }
  return null;
}

/** The option words of `git <sub> <args>`, skipping option values (`-m '--'`) and stopping at `--`. */
function* optionWords(sub, args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') return;
    if (!a.startsWith('-')) continue;
    yield a;
    if (sub !== 'commit') continue;
    if (COMMIT_LONG_VALUE.has(a)) i++;
    else if (/^-[^-]/.test(a)) {
      for (let k = 1; k < a.length; k++) {
        if (a[k] === 'n') break;
        if (COMMIT_SHORT_VALUE.has(a[k])) {
          if (k === a.length - 1 && !'Su'.includes(a[k])) i++; // the value is the next word
          break;
        }
      }
    }
  }
}

/** `-n` in one `git commit` short-flag cluster, before a value starts (`-mn` is `-m n`). */
function shortHasN(a) {
  for (let k = 1; k < a.length; k++) {
    if (a[k] === 'n') return true;
    if (COMMIT_SHORT_VALUE.has(a[k])) return false;
  }
  return false;
}

/** `git config` writing `core.hooksPath`, or null for a read (`git config core.hooksPath`). */
function configRefusal(args) {
  const key = args.findIndex((a) => HOOKS_PATH.test(a));
  if (key < 0) return null;
  const value = args.slice(key + 1).find((a) => !a.startsWith('-'));
  const writes = args.some((a) => CONFIG_WRITE.has(a)) || value !== undefined;
  if (!writes || value === HUSKY_PATH) return null;
  return '`git config core.hooksPath` (a write)';
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
