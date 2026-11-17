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
 * `invocations()`, which reports only git and gh; it has its own, smaller wrapper walk (the shared
 * walk is tracked in docs/tech-debt.md → "Two shell-wrapper walks").
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
import { basename } from 'node:path';

const ESCAPE = 'MAT_PLAN_ALLOW_PATTERN_KILL=1';
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const KEYWORDS = new Set(['!', '{', '}', 'then', 'do', 'else', 'if', 'elif', 'while', 'until']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);
const XARGS_WITH_VALUE = new Set(['-I', '-n', '-P', '-L', '-d', '-E', '-s', '-a', '--arg-file']);
const SUDO_WITH_VALUE = new Set(['-u', '-g', '-C', '-D', '-h', '-p', '-U', '-r', '-t', '-T']);
/** `$!`, `$name`, `${name}`, `$1`, `$$`: one variable, so one pid the script captured. */
const ONE_VARIABLE = /^\$(!|\$|\d|\{?[A-Za-z_][A-Za-z0-9_]*\}?)$/;

const REASON =
  'Stop only a process you started, by the pid you captured ($!), or let it finish: ' +
  'other lanes run the same scripts on this machine.';

/** The first refused form in `command` (a short description), or null to allow. */
function refusal(command, lex) {
  const found = [];
  walk(lex(command), found, false, lex);
  return found[0] ?? null;
}

function walk(tokens, found, escape, lex) {
  let segment = [];
  const flush = () => {
    if (segment.length) analyze(segment, found, escape, lex);
    segment = [];
  };
  for (const t of tokens) {
    if (t.op) flush();
    else segment.push(t);
  }
  flush();
}

function analyze(tokens, found, inheritedEscape, lex) {
  for (const t of tokens) for (const sub of t.subs ?? []) walk(sub, found, inheritedEscape, lex);

  const words = []; // { text, subs }
  const stdin = []; // heredoc / here-string bodies: commands only if they feed a bare shell
  for (let k = 0; k < tokens.length; k++) {
    if (tokens[k].stdin) stdin.push(tokens[k].stdin.body);
    else if (tokens[k].redir) {
      if (tokens[k].herestring && tokens[k + 1]?.text !== undefined) stdin.push(tokens[k + 1].text);
      k++; // the redirection's target
    } else words.push(tokens[k]);
  }
  const text = (j) => words[j]?.text;
  const reLex = (src, esc) => walk(lex(src), found, esc, lex);

  let i = 0;
  let escape = inheritedEscape;
  for (; i < words.length && ASSIGNMENT.test(text(i)); i++) if (text(i) === ESCAPE) escape = true;
  if (escape) return;

  let viaXargs = false; // the command's arguments arrive on stdin
  for (;;) {
    const w = text(i);
    if (w === undefined) return;
    const base = basename(w);
    const opts = (withValue) => {
      for (i++; text(i)?.startsWith('-'); i++) if (withValue?.(text(i))) i++;
    };
    if (KEYWORDS.has(w) || base === 'builtin' || base === 'coproc') i++;
    else if (w === 'function') i += 2;
    else if (base === 'time' || base === 'nohup') opts();
    else if (base === 'stdbuf') opts((a) => /^-[ioe]$/.test(a));
    else if (base === 'caffeinate') opts((a) => /^-[tw]$/.test(a));
    else if (base === 'doas') opts((a) => /^-[uC]$/.test(a));
    else if (base === 'arch') opts((a) => /^-(arch|e|d)$/.test(a));
    else if (base === 'exec' || base === 'nice') opts((a) => ['-a', '-n'].includes(a));
    else if (base === 'xargs') {
      viaXargs = true;
      opts((a) => XARGS_WITH_VALUE.has(a));
    } else if (base === 'timeout') {
      opts((a) => ['-s', '-k'].includes(a));
      i++; // the duration
    } else if (base === 'command') {
      for (i++; text(i)?.startsWith('-'); i++) if (/^-[a-zA-Z]*[vV]/.test(text(i))) return; // lookup only
    } else if (base === 'pnpm' || base === 'npx') {
      let j = i + 1;
      for (; text(j)?.startsWith('-'); j++) if (/^(-C|--dir|--filter|-F)$/.test(text(j))) j++;
      if (base === 'npx') i = j;
      else if (text(j) === 'exec') i = j + 1;
      else return; // any other pnpm command runs a script by name: a known gap
    } else if (base === 'sudo') {
      for (i++; i < words.length; i++) {
        const a = text(i);
        if (SUDO_WITH_VALUE.has(a)) i++;
        else if (!a.startsWith('-') && !ASSIGNMENT.test(a)) break;
      }
    } else if (base === 'env') {
      for (i++; i < words.length; i++) {
        const a = text(i);
        if (a === '-S' || a === '--split-string' || a.startsWith('--split-string=')) {
          const str = a.includes('=') ? a.slice(a.indexOf('=') + 1) : text(++i);
          const rest = words.slice(i + 1).map((t) => t.text);
          return reLex([str, ...rest].join(' '), escape);
        }
        if (['-u', '--unset', '-C', '--chdir'].includes(a)) i++;
        else if (!a.startsWith('-') && !ASSIGNMENT.test(a)) break;
      }
    } else if (base === 'script') {
      // BSD `script [-q…] [file [command …]]`; util-linux `script -c 'command' [file]`.
      for (i++; text(i)?.startsWith('-'); i++) {
        if (text(i) === '-c' || text(i) === '--command') return reLex(text(i + 1) ?? '', escape);
        if (/^-[tTFI]$/.test(text(i))) i++;
      }
      i++; // the typescript file
    } else break;
  }

  const cmd = text(i);
  const base = basename(cmd);
  const rest = words.slice(i + 1);
  const restText = rest.map((t) => t.text);

  if (base === 'eval') return reLex(restText.join(' '), escape);
  if (base === 'watch') {
    let j = 0;
    for (; restText[j]?.startsWith('-'); j++) if (/^(-n|--interval)$/.test(restText[j])) j++;
    return reLex(restText.slice(j).join(' '), escape);
  }
  if (base === 'find') {
    for (let j = 0; j < rest.length; j++) {
      if (!/^-(exec|execdir|ok|okdir)$/.test(restText[j])) continue;
      const inner = [];
      for (j++; j < rest.length && restText[j] !== ';' && restText[j] !== '+'; j++)
        inner.push(rest[j]);
      analyze(inner, found, escape, lex);
    }
    return;
  }
  if (SHELLS.has(base)) {
    let sawC = false;
    let script;
    for (const a of restText) {
      if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(a)) sawC = true;
      else if (!/^[-+]/.test(a)) {
        script = a;
        break;
      }
    }
    if (sawC && script !== undefined) reLex(script, escape);
    else if (script === undefined) for (const body of stdin) reLex(body, escape);
    return;
  }

  if (base === 'pkill' || base === 'killall') return void found.push(`\`${base}\``);
  if (base === 'fuser') {
    if (restText.some((a) => /^-[a-zA-Z]*k[a-zA-Z]*$/.test(a) || a === '--kill'))
      found.push('`fuser -k`');
    return;
  }
  if (base !== 'kill') return;

  if (viaXargs) return void found.push('`kill` fed its pids by `xargs`');
  // One signal option may lead: `-9`, `-TERM`, `-s TERM`, `-n 9`. A lone `-1` is a pid, not a signal.
  const first = restText[0];
  if (first !== undefined && /^-[lL]$/.test(first)) return; // `kill -l`: list the signal names
  let j = 0;
  if (['-s', '-n', '--signal'].includes(first)) j = 2;
  else if (first?.startsWith('-') && first !== '--' && rest.length > 1) j = 1;
  for (const t of rest.slice(j)) {
    const a = t.text;
    if (a === '--') return void found.push('`kill -- …`');
    if (t.subs?.length) return void found.push('`kill` of a command substitution');
    if (/^-\d+$/.test(a))
      return void found.push(`\`kill ${a}\` (a process group, or every process)`);
    if (/^\d+$/.test(a) && Number(a) < 2) return void found.push(`\`kill ${a}\``);
    if (a.includes('$') && !ONE_VARIABLE.test(a))
      return void found.push('`kill` of an expansion that is not one variable');
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
  const what = refusal(command, lex);
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
