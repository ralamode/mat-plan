#!/usr/bin/env node
/**
 * PreToolUse(Bash) guard: stop a process by the pid you captured, never by pattern.
 *
 * Several sessions (lanes) run the same scripts on one machine, each in its own worktree. A
 * `pkill -f mutations.mjs` run to stop one lane's gate stops every lane's run of that gate, and a
 * killed `db:mutations` can leave a patch applied in another lane's source (2026-11-17; DX-18 D2,
 * docs/plans/dx-18-heavy-runs-to-ci.md). This hook applies in EVERY directory, not only the main
 * checkout: the harm is to processes other sessions started, wherever this one runs.
 *
 * BEST-EFFORT, NOT A SECURITY BOUNDARY. A heuristic shell reader, like its sibling
 * `guard-main-checkout.mjs`, whose lexer it borrows (`lex()`). It does NOT use the sibling's
 * `invocations()`, which reports only git and gh; it walks the wrappers with `shell-commands.mjs`,
 * shared with `guard-hook-skip.mjs` since 2026-11-21 (docs/tech-debt.md → "Two shell-wrapper walks").
 *
 *   denied   `pkill`, `killall`, `fuser -k` (any spelling of the flag), in any form;
 *            `kill` whose target is a command substitution (`$(pgrep …)`, backticks) or whose
 *            arguments arrive on a pipe (`… | xargs kill`);
 *            `kill 0`, `kill 1`, `kill -1`, any negative pid (a process group), and `kill -- …`:
 *            each is broader than `pkill -f`.
 *   allowed  `kill [-SIG | -s SIG | -n N] <literal pid of 2 or more>`, `kill $!`, `kill "$name"`,
 *            `kill %job`, `kill -l`; and any text that merely MENTIONS pkill (a commit message, an
 *            `echo`, a heredoc fed to anything but a bare shell).
 *
 * How the command is read: the sibling's `lex()` (segments on newlines, `;`, `&&`, `||`, `|`, `&`,
 * `(`/`)`; quotes dropped; `$(…)` and backticks kept as sub-token lists). Each segment's first word is
 * walked through the wrappers the sibling unwraps (`guard-main-checkout.mjs`, the wrapper loop in
 * `analyzeSegment`): sudo, doas, env (and `env -S`), command, builtin, exec, eval, nice, nohup, time,
 * stdbuf, timeout, caffeinate, arch, xargs, `script -c`, watch, `find -exec`, `pnpm exec` / npx, and
 * a re-lex of `sh|bash|zsh|… -c '…'` and of a heredoc / here-string fed to a bare shell.
 *
 * KNOWN GAPS. Uncovered, by design (the aim is the forms that actually get typed):
 *   - a kill from another program: `node -e 'process.kill(…)'`, `python -c 'os.kill(…)'`;
 *   - a package that kills by port or name: `npx kill-port 3000`, `fkill`;
 *   - a loop that feeds kill from a pipe: `pgrep -f x | while read p; do kill $p; done`;
 *   - a command named by a variable (`$K -f x`), a pipe into a bare shell (`echo pkill x | sh`), a
 *     script file run by name, and wrappers not listed above.
 *
 * Escape hatch, visible in the command itself: a LEADING `MAT_PLAN_ALLOW_PATTERN_KILL=1` on the
 * segment (not in a comment, not elsewhere in the string). Under CI (`CI`/`GITHUB_ACTIONS` set) the
 * hook does nothing at all, and it loads the lexer only AFTER that exit (a dynamic `import()`), so no
 * imported code runs in a job that holds a token (.github/SECURITY.md → "CI / Actions secrets").
 *
 * Input: the hook JSON on stdin ({ cwd, tool_input: { command } }). Output: a PreToolUse
 * `permissionDecision: "deny"` with the reason, or nothing (allow). Malformed input or an internal
 * error ALLOWS (fails open), the same contract as the sibling.
 */
const ESCAPE = 'MAT_PLAN_ALLOW_PATTERN_KILL=1';
/** `$!`, `$name`, `${name}`, `$1`, `$$`: one variable, so one pid the script captured. */
const ONE_VARIABLE = /^\$(!|\$|\d|\{?[A-Za-z_][A-Za-z0-9_]*\}?)$/;

const REASON =
  'Stop only a process you started, by the pid you captured ($!), or let it finish: ' +
  'other lanes run the same scripts on this machine.';

/** The first refused form in `command` (a short description), or null to allow. */
function refusal(command, lex, commands) {
  for (const c of commands(command, lex, ESCAPE)) {
    const what = killRefusal(c);
    if (what) return what;
  }
  return null;
}

/** One command, already unwrapped (`shell-commands.mjs`): why it is refused, or null. */
function killRefusal({ base, rest, restText, viaXargs }) {
  if (base === 'pkill' || base === 'killall') return `\`${base}\``;
  if (base === 'fuser') {
    if (restText.some((a) => /^-[a-zA-Z]*k[a-zA-Z]*$/.test(a) || a === '--kill'))
      return '`fuser -k`';
    return null;
  }
  if (base !== 'kill') return null;

  if (viaXargs) return '`kill` fed its pids by `xargs`';
  // One signal option may lead: `-9`, `-TERM`, `-s TERM`, `-n 9`. A lone `-1` is a pid, not a signal.
  const first = restText[0];
  if (first !== undefined && /^-[lL]$/.test(first)) return null; // `kill -l`: list the signal names
  let j = 0;
  if (['-s', '-n', '--signal'].includes(first)) j = 2;
  else if (first?.startsWith('-') && first !== '--' && rest.length > 1) j = 1;
  for (const t of rest.slice(j)) {
    const a = t.text;
    if (a === '--') return '`kill -- …`';
    if (t.subs?.length) return '`kill` of a command substitution';
    if (/^-\d+$/.test(a)) return `\`kill ${a}\` (a process group, or every process)`;
    if (/^\d+$/.test(a) && Number(a) < 2) return `\`kill ${a}\``;
    if (a.includes('$') && !ONE_VARIABLE.test(a))
      return '`kill` of an expansion that is not one variable';
  }
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
  // Cheap pre-filter, on the text with quotes and backslashes dropped (`p''kill` is pkill).
  if (typeof command !== 'string' || !/kill|fuser/.test(command.replace(/['"\\]/g, ''))) return;
  // Loaded only here, after the CI exit below. Safe to import: the sibling runs its own main only
  // when it is the entry point (`isEntryPoint()`), and here it is not.
  const { lex } = await import('./guard-main-checkout.mjs');
  const { commands } = await import('./shell-commands.mjs');
  const what = refusal(command, lex, commands);
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

// Under CI the hook is a no-op with no output, and imports nothing: a CI model job may load project
// settings (.github/scripts/review-prefetch.sh greps for this exact condition).
if (!process.env.CI && !process.env.GITHUB_ACTIONS)
  main().catch(() => {
    /* fail open: a guard that errors must not block every command */
  });
