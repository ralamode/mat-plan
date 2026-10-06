#!/usr/bin/env node
/**
 * PreToolUse(Bash) guard: the MAIN checkout stays on `main`.
 *
 * AGENTS.md → "Git & branch workflow" makes every task run in its own worktree under
 * `.claude/worktrees/`, with the main checkout used only to sync and read. The rule was written down
 * in #174, and within hours another session had switched the main checkout to a feature branch —
 * twice. Consequences seen the same day: a `git pull origin main` that would have merged `main` into
 * someone else's branch, and project skills that did not exist ("Unknown skill"), because skills load
 * from whatever branch the main checkout has checked out.
 *
 * BEST-EFFORT, NOT A SECURITY BOUNDARY. It stops a well-meaning agent from mutating the shared main
 * checkout by accident, in the forms that actually get typed. It is a heuristic shell reader, not a
 * shell. Within that scope it is an ALLOWLIST: in THIS project's main checkout, only this is allowed.
 *
 *   read-only   status log diff show rev-parse merge-base ls-files ls-tree grep blame describe
 *               shortlog cat-file for-each-ref rev-list show-ref check-ignore name-rev diff-tree help
 *               ls-remote cherry range-diff · reflog (no expire/delete)
 *               fetch: no --update-head-ok, no glob refspec, no destination that could be main
 *               remote (list/show/get-url) · config get/list/--get/--list/<key> · symbolic-ref (read)
 *               branch (list flags only) · tag (listing flags only, -n included) · stash list/show
 *   worktrees   worktree list / add (not -B) / remove / prune / repair; never with --force
 *               branch -d|-D [--force] <names> (never `main`): the post-merge cleanup
 *   syncing     pull --ff-only [--prune] [origin [main]] and merge --ff-only origin/main, only on main
 *               checkout main / switch main (no flags), only when `git status --porcelain` is empty
 *               reset [-q] [HEAD] [-- <paths>] (unstage only)
 * On every subcommand, refused: any argument naming `main` in another case (`MAIN`, `+x:Main`: the
 * same ref on a case-insensitive filesystem), `--output`, `--upload-pack`, `grep -O`; a `-c` key off
 * the display-only allowlist (color.*, log.*, diff.* but not diff.external / *.command / *.textconv,
 * core.quotepath, advice.*, column.*, pager.*=false); and GIT_CONFIG_* / GIT_PAGER / GIT_SSH* /
 * GIT_EDITOR / GIT_EXTERNAL_DIFF / GIT_ASKPASS / GIT_EXEC_PATH / GIT_PROXY_COMMAND / GIT_TRACE*
 * in the env. A ref DESTINATION (fetch `src:dst`, `worktree add -b`, `branch -d`) is lowercased
 * whole and refused if it could be main (`refs/HEADS/main`), or if it is a mixed-case `refs/…`.
 * Everything else is denied there, including unknown subcommands and aliases, `gh pr checkout`, and
 * commands it can't read: piped into a bare shell or `xargs sh`, fed by `<(…)`, or named by a variable
 * (`git${IFS}checkout`). An abbreviated long option (`--forc`, which git accepts) is matched as the
 * option it abbreviates where that option is refused, and is otherwise off the allowlist. A linked
 * worktree, an unrelated repository and a non-repo directory are never restricted.
 *
 * How the command is read: segmented on newlines, `;`, `&&`, `||`, `|`, `&` and `(`/`)`; quotes and
 * backslashes dropped from words (`g''it`, `$'git'`); recursing into `$(…)`, `<(…)`, backticks,
 * `eval`, `watch`, `find -exec`, `env -S`, `script -c`, `sh|bash|zsh|fish -c '…'` and a heredoc /
 * here-string fed to a bare shell; stripping `env`/`command`/`builtin`/`time`/`nohup`/`xargs`/
 * `sudo`/`doas`/`stdbuf`/`caffeinate`/`arch`/`script`/`pnpm exec`/`coproc`/`function NAME` prefixes;
 * following `cd`/`pushd` and `git -C`. A directory it can't resolve (`~`, `$VAR`, `popd`,
 * `--git-dir`, `GIT_DIR=`, `find -execdir`) counts as possibly the main checkout. A heredoc fed to
 * any other command is data.
 *
 * KNOWN GAPS. This is best-effort against well-meaning agents, not a sandbox. Uncovered, by design:
 *   - a script file run by name (`bash x.sh`, `./x.sh`, `make`, a package.json script);
 *   - config already set in ~/.gitconfig or .git/config (an alias, core.pager, hooks, …);
 *   - git launched from another program (`node -e`, `python -c`, an editor, a test runner);
 *   - wrappers and shells not listed above;
 *   - any git option not yet known to run a command or write a file.
 * Lookalike names (a Cyrillic U+0430 for the `a` in main) are a different branch to git: no action.
 *
 * "Main checkout" = the primary (not linked) worktree whose git common dir is the same as that of
 * `$CLAUDE_PROJECT_DIR`. Without that variable, any primary worktree counts.
 *
 * Escape hatch, visible in the command itself: a LEADING `MAT_PLAN_ALLOW_MAIN_CHECKOUT=1` on the
 * segment (not in a comment, not elsewhere in the string). Under CI (`CI`/`GITHUB_ACTIONS` set) the hook
 * does nothing at all (.github/SECURITY.md → "Supply chain").
 *
 * Input: the hook JSON on stdin ({ cwd, tool_input: { command } }). Output: a PreToolUse
 * `permissionDecision: "deny"` with the reason, or nothing (allow). Malformed input or an internal
 * error ALLOWS (fails open): a guard that breaks every git command in the repo would get disabled,
 * not fixed.
 */
import { execFileSync } from 'node:child_process';
import { basename, isAbsolute, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAIN = 'main';
const ESCAPE = 'MAT_PLAN_ALLOW_MAIN_CHECKOUT=1';
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const GIT_LOCATION_ENV = /^GIT_(DIR|WORK_TREE)=/;
/** Env that makes git run a command or read config we can't see: the git command is unknown. */
const GIT_EXEC_ENV =
  /^GIT_(CONFIG\w*|EXTERNAL_DIFF|PAGER|SSH|SSH_COMMAND|ASKPASS|EDITOR|SEQUENCE_EDITOR|EXEC_PATH|PROXY_COMMAND|TRACE\w*)=/;
/** Env assignment `a` changes where git acts, or what it runs. */
const noteGitEnv = (a, flags) => {
  if (GIT_LOCATION_ENV.test(a)) flags.gitEnv = true;
  if (GIT_EXEC_ENV.test(a)) flags.execEnv = true;
};
/** The word a process substitution `<(…)` leaves behind: unresolvable (`$`), and recognisable. */
const PROCSUB = '$<(…)';
/**
 * `git -c <key>[=<value>]` is an ALLOWLIST in the main checkout: display settings only. Any other key
 * may run a command (alias.*, core.pager, core.fsmonitor, protocol.ext.allow, credential.helper, …).
 */
export function safeConfigKey(key, value) {
  const k = key.toLowerCase();
  if (/^(color|log|advice|column)\./.test(k) || k === 'core.quotepath') return true;
  if (k.startsWith('diff.'))
    return k !== 'diff.external' && !/^diff\..+\.(command|textconv)$/.test(k);
  return k.startsWith('pager.') && /^(false|no|off|0)$/i.test(value ?? '');
}

/** `arg` is the long option `long`, or a prefix of it git would accept (`--forc` for `--force`). */
export function isLongOpt(arg, long, min = 3) {
  const name = arg.split('=')[0];
  return name.startsWith('--') && name.length >= min && long.startsWith(name);
}

// ─── Lexer ────────────────────────────────────────────────────────────────────────────────────────
// Tokens: { op } for a separator, { redir: true } for a redirection (the next word is its target),
// or a word { text, subs } where `subs` holds the token lists of any `$(…)` / backticks inside it.
// Quotes are removed from `text`; an expansion leaves a `$` in it, so "can't resolve" is visible.

/** Lex a whole command string. Never throws on malformed input: it reads what it can. */
export function lex(src) {
  return lexList({ s: src, i: 0 }, false);
}

function lexList(p, inSub) {
  const tokens = [];
  const heredocs = [];
  let depth = 0;
  const s = p.s;
  while (p.i < s.length) {
    const c = s[p.i];
    if (c === ' ' || c === '\t' || c === '\r') p.i++;
    else if (c === '\\' && s[p.i + 1] === '\n') p.i += 2;
    else if (c === '#') while (p.i < s.length && s[p.i] !== '\n') p.i++;
    else if (c === '\n') {
      p.i++;
      tokens.push({ op: '\n' });
      for (const h of heredocs.splice(0)) skipHeredoc(p, h);
    } else if (c === '(') {
      p.i++;
      depth++;
      tokens.push({ op: '(' });
    } else if (c === ')') {
      p.i++;
      if (inSub && depth === 0) return tokens;
      depth--;
      tokens.push({ op: ')' });
    } else if (c === ';') {
      p.i += s[p.i + 1] === ';' ? 2 : 1;
      tokens.push({ op: ';' });
    } else if (c === '&') {
      if (s[p.i + 1] === '&') {
        p.i += 2;
        tokens.push({ op: '&&' });
      } else if (s[p.i + 1] === '>') {
        p.i += s[p.i + 2] === '>' ? 3 : 2; // &> / &>> file
        tokens.push({ redir: true });
      } else {
        p.i++;
        tokens.push({ op: '&' });
      }
    } else if (c === '|') {
      if (s[p.i + 1] === '|') {
        p.i += 2;
        tokens.push({ op: '||' });
      } else {
        p.i += s[p.i + 1] === '&' ? 2 : 1;
        tokens.push({ op: '|' });
      }
    } else if ((c === '<' || c === '>') && s[p.i + 1] === '(') {
      // Process substitution <(…) / >(…): its commands run; as a word it reads as a file.
      p.i += 2;
      tokens.push({ text: PROCSUB, subs: [lexList(p, true)] });
    } else if (c === '<' || c === '>') {
      const r = lexRedirection(p);
      if (r.heredoc) {
        heredocs.push(r.heredoc);
        tokens.push({ stdin: r.heredoc }); // body filled in at the next newline
      } else tokens.push({ redir: true, herestring: !!r.herestring });
    } else {
      const w = lexWord(p);
      if (w) tokens.push(w);
      else if (p.i < s.length && !' \t\r\n;&|()<>'.includes(s[p.i])) p.i++; // never stall
    }
  }
  return tokens;
}

/**
 * Consume a redirection operator. Returns { heredoc } for `<<`/`<<-` (its body is read at the next
 * newline), { herestring: true } for `<<<` (the next word is the body), else {}.
 */
function lexRedirection(p) {
  const s = p.s;
  if (s.startsWith('<<<', p.i)) {
    p.i += 3;
    return { herestring: true };
  }
  if (s.startsWith('<<', p.i)) {
    p.i += 2;
    const strip = s[p.i] === '-';
    if (strip) p.i++;
    while (s[p.i] === ' ' || s[p.i] === '\t') p.i++;
    const w = lexWord(p);
    return { heredoc: { delim: w ? w.text : '', strip, body: '' } };
  }
  p.i++;
  if ('>&|'.includes(s[p.i] ?? '')) p.i++; // >> >& >| <& <>
  if (s[p.i] === '-') p.i++; // >&-
  return {};
}

/**
 * Read a heredoc body (lines up to the delimiter line) into `h.body`. The lexer never reads it as
 * commands; the analysis does, only when it feeds a bare shell.
 */
function skipHeredoc(p, h) {
  const s = p.s;
  const body = [];
  while (p.i < s.length) {
    const eol = s.indexOf('\n', p.i);
    const end = eol < 0 ? s.length : eol;
    const line = s.slice(p.i, end);
    p.i = end + 1;
    if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) break;
    body.push(line);
  }
  h.body = body.join('\n');
}

function lexBacktick(p) {
  const s = p.s;
  let i = p.i + 1;
  let inner = '';
  while (i < s.length && s[i] !== '`') {
    if (s[i] === '\\' && i + 1 < s.length) {
      inner += s[i + 1];
      i += 2;
    } else inner += s[i++];
  }
  p.i = i + 1;
  return lex(inner);
}

function lexWord(p) {
  const s = p.s;
  let text = '';
  let quoted = false;
  const subs = [];
  const substitution = () => {
    if (s[p.i] === '`') subs.push(lexBacktick(p));
    else {
      p.i += 2; // $(
      subs.push(lexList(p, true));
    }
    text += '$';
  };
  while (p.i < s.length) {
    const c = s[p.i];
    if (' \t\r\n;&|()<>'.includes(c)) break;
    if (c === '\\') {
      if (s[p.i + 1] !== '\n') text += s[p.i + 1] ?? '';
      p.i += 2;
      quoted = true;
    } else if (c === '$' && s[p.i + 1] === "'") {
      // ANSI-C quoting, $'…': keep the text, drop the quoting (an escape keeps its next character).
      p.i += 2;
      while (p.i < s.length && s[p.i] !== "'") {
        if (s[p.i] === '\\') p.i++;
        text += s[p.i++] ?? '';
      }
      p.i++;
      quoted = true;
    } else if (c === "'") {
      const end = s.indexOf("'", p.i + 1);
      const e = end < 0 ? s.length : end;
      text += s.slice(p.i + 1, e);
      p.i = e + 1;
      quoted = true;
    } else if (c === '"') {
      p.i++;
      quoted = true;
      while (p.i < s.length && s[p.i] !== '"') {
        const d = s[p.i];
        if (d === '\\' && '$`"\\\n'.includes(s[p.i + 1] ?? 'x')) {
          if (s[p.i + 1] !== '\n') text += s[p.i + 1];
          p.i += 2;
        } else if ((d === '$' && s[p.i + 1] === '(') || d === '`') substitution();
        else {
          text += d;
          p.i++;
        }
      }
      p.i++;
    } else if ((c === '$' && s[p.i + 1] === '(') || c === '`') substitution();
    else {
      text += c;
      p.i++;
    }
  }
  // `2>&1`: an unquoted number glued to a redirection is a file descriptor, not a word.
  if (!quoted && /^\d+$/.test(text) && (s[p.i] === '<' || s[p.i] === '>')) return null;
  if (!text && !quoted && !subs.length) return null;
  return { text, subs };
}

// ─── Analysis ─────────────────────────────────────────────────────────────────────────────────────
// Walks the tokens with a directory state ({ dir, unsure, gitEnv }) and records every git / gh
// invocation as { kind, dir, unsure, sub, args, escape }.

const KEYWORDS = new Set([
  '!',
  '{',
  '}',
  'then',
  'do',
  'else',
  'if',
  'elif',
  'while',
  'until',
  'coproc',
]);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);
const XARGS_WITH_VALUE = new Set(['-I', '-n', '-P', '-L', '-d', '-E', '-s', '-a', '--arg-file']);
const SUDO_WITH_VALUE = new Set(['-u', '-g', '-C', '-D', '-h', '-p', '-U', '-r', '-t', '-T']);

/** Every git / gh invocation in `command`, with the directory it acts on. */
export function invocations(command, cwd) {
  const out = [];
  walk(lex(command), { dir: cwd, unsure: false, gitEnv: false, execEnv: false }, out, false);
  return out;
}

function walk(tokens, state, out, inheritedEscape) {
  const saved = [];
  let segment = [];
  let piped = false; // the segment being collected reads a pipe on stdin
  const flush = () => {
    if (segment.length) analyzeSegment(segment, state, out, inheritedEscape, piped);
    segment = [];
  };
  for (const t of tokens) {
    if (!t.op) {
      segment.push(t);
      continue;
    }
    flush();
    piped = t.op === '|';
    if (t.op === '(') saved.push({ ...state });
    else if (t.op === ')' && saved.length) Object.assign(state, saved.pop());
  }
  flush();
}

function analyzeSegment(tokens, state, out, inheritedEscape, piped = false) {
  // Substitutions run first, in the current shell's directory and without this segment's prefix.
  for (const t of tokens)
    for (const sub of t.subs ?? []) walk(sub, { ...state }, out, inheritedEscape);

  const words = [];
  const stdin = []; // heredoc / here-string bodies: commands only if they feed a bare shell
  for (let k = 0; k < tokens.length; k++) {
    if (tokens[k].stdin) stdin.push(tokens[k].stdin);
    else if (tokens[k].redir) {
      if (tokens[k].herestring && tokens[k + 1]?.text !== undefined)
        stdin.push({ body: tokens[k + 1].text });
      k++; // drop the redirection and its target
    } else words.push(tokens[k].text);
  }

  let i = 0;
  let escape = inheritedEscape;
  const env = { gitEnv: state.gitEnv, execEnv: state.execEnv };
  let dirUnsure = state.unsure;
  let viaXargs = false; // the command's arguments arrive on stdin
  // Leading assignments: the only place the escape hatch counts.
  for (; i < words.length && ASSIGNMENT.test(words[i]); i++) {
    if (words[i] === ESCAPE) escape = true;
    noteGitEnv(words[i], env);
  }
  // Wrappers that run the rest of the words as a command.
  for (;;) {
    const w = words[i];
    if (w === undefined) return;
    const base = w.includes('/') ? basename(w) : w;
    if (KEYWORDS.has(w)) i++;
    else if (w === 'function')
      i += 2; // `function NAME { …; }`: the body follows
    else if (base === 'builtin') i++;
    else if (base === 'stdbuf') {
      for (i++; words[i]?.startsWith('-'); i++) if (/^-[ioe]$/.test(words[i])) i++;
    } else if (base === 'caffeinate') {
      for (i++; words[i]?.startsWith('-'); i++) if (/^-[tw]$/.test(words[i])) i++;
    } else if (base === 'doas') {
      for (i++; words[i]?.startsWith('-'); i++) if (/^-[uC]$/.test(words[i])) i++;
    } else if (base === 'pnpm' || base === 'npx') {
      // `pnpm exec git …` / `npx git …` run git; any other pnpm command is not a wrapper.
      let j = i + 1;
      for (; words[j]?.startsWith('-'); j++) {
        if (/^(-C|--dir)$/.test(words[j])) {
          dirUnsure = true; // another directory: can't tell which checkout
          j++;
        } else if (/^(--filter|-F)$/.test(words[j])) j++;
        else if (words[j].startsWith('--dir=')) dirUnsure = true;
      }
      if (base === 'npx') i = j;
      else if (words[j] === 'exec') i = j + 1;
      else break;
    } else if (base === 'env') {
      for (i++; i < words.length; i++) {
        const a = words[i];
        if (a === '-S' || a === '--split-string' || a.startsWith('--split-string=')) {
          // env -S 'git checkout …': the string is split into the command.
          const str = a.includes('=') ? a.slice(a.indexOf('=') + 1) : words[++i];
          walk(lex([str, ...words.slice(i + 1)].join(' ')), { ...state }, out, escape);
          return;
        }
        if (a === '-u' || a === '--unset') i++;
        else if (a === '-C' || a === '--chdir') {
          dirUnsure = true;
          i++;
        } else if (ASSIGNMENT.test(a)) noteGitEnv(a, env);
        else if (!a.startsWith('-')) break;
      }
    } else if (base === 'command') {
      for (i++; words[i]?.startsWith('-'); i++) if (/^-[a-zA-Z]*[vV]/.test(words[i])) return; // lookup only
    } else if (base === 'time' || base === 'nohup') {
      for (i++; words[i]?.startsWith('-'); i++);
    } else if (base === 'exec' || base === 'nice') {
      for (i++; words[i]?.startsWith('-'); i++) if (['-a', '-n'].includes(words[i])) i++;
    } else if (base === 'timeout') {
      for (i++; words[i]?.startsWith('-'); i++) if (['-s', '-k'].includes(words[i])) i++;
      i++; // the duration
    } else if (base === 'xargs') {
      viaXargs = true;
      for (i++; words[i]?.startsWith('-'); i++) if (XARGS_WITH_VALUE.has(words[i])) i++;
    } else if (base === 'arch') {
      for (i++; words[i]?.startsWith('-'); i++) if (/^-(arch|e|d)$/.test(words[i])) i++;
    } else if (base === 'script') {
      // BSD `script [-q…] [file [command …]]`; util-linux `script -c 'command' [file]`.
      let command = null;
      for (i++; words[i]?.startsWith('-'); i++) {
        if (words[i] === '-c' || words[i] === '--command') command = words[++i] ?? '';
        else if (/^-[tTFI]$/.test(words[i])) i++;
      }
      if (command !== null) {
        walk(lex(command), { ...state }, out, escape);
        return;
      }
      i++; // the typescript file
    } else if (base === 'sudo') {
      for (i++; i < words.length; i++) {
        const a = words[i];
        if (SUDO_WITH_VALUE.has(a)) i++;
        else if (ASSIGNMENT.test(a)) noteGitEnv(a, env);
        else if (!a.startsWith('-')) break;
      }
    } else break;
  }

  const cmd = words[i];
  const base = cmd.includes('/') ? basename(cmd) : cmd;
  const rest = words.slice(i + 1);

  // `git${IFS}checkout`, `$(which git) …`, `"$GIT" …`: the command itself can't be read.
  if (cmd.includes('$')) {
    out.push({ kind: 'dynamic', dir: state.dir, unsure: dirUnsure || env.gitEnv, escape });
    return;
  }
  // `source <(…)` / `. <(…)` run commands we can't read, like a pipe into a shell.
  if ((base === 'source' || base === '.') && rest[0] === PROCSUB) {
    out.push({ kind: 'shell', dir: state.dir, unsure: dirUnsure || env.gitEnv, escape });
    return;
  }

  if (base === 'cd' || base === 'pushd') {
    const target = rest.find((a) => !/^-[LPe@n]*$/.test(a) || a === '-');
    if (target === undefined || target === '-' || /[~$]/.test(target) || /^[+-]\d+$/.test(target))
      state.unsure = true; // home, previous dir, a variable, a stack index: can't tell
    else {
      state.dir = resolve(state.dir, target);
      state.unsure = isAbsolute(target) ? false : state.unsure;
    }
    return;
  }
  if (base === 'popd') {
    state.unsure = true;
    return;
  }
  if (['export', 'declare', 'typeset'].includes(base)) {
    const exported = { gitEnv: state.gitEnv, execEnv: state.execEnv };
    for (const a of rest) noteGitEnv(a, exported);
    Object.assign(state, exported);
    return;
  }
  if (base === 'eval') {
    walk(lex(rest.join(' ')), state, out, escape);
    return;
  }
  if (SHELLS.has(base)) {
    let sawC = false;
    let script;
    for (const a of rest) {
      if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(a)) sawC = true;
      else if (!/^[-+]/.test(a)) {
        script = a;
        break;
      }
    }
    if (viaXargs || script === PROCSUB)
      // `xargs sh -c '{}'` / `bash <(…)`: the commands arrive from somewhere we can't read.
      out.push({ kind: 'shell', dir: state.dir, unsure: dirUnsure || env.gitEnv, escape });
    else if (sawC && script !== undefined) walk(lex(script), { ...state }, out, escape);
    else if (script === undefined) {
      // A bare shell reads its commands from stdin: a heredoc / here-string body is readable; a
      // pipe is not, so it counts as an unknown command.
      for (const h of stdin) walk(lex(h.body), { ...state }, out, escape);
      if (!stdin.length && piped)
        out.push({ kind: 'shell', dir: state.dir, unsure: dirUnsure || env.gitEnv, escape });
    }
    return;
  }
  if (base === 'watch') {
    // watch runs its arguments as one `sh -c` string.
    let j = 0;
    for (; rest[j]?.startsWith('-'); j++) if (/^(-n|--interval)$/.test(rest[j])) j++;
    walk(lex(rest.slice(j).join(' ')), { ...state }, out, escape);
    return;
  }
  if (base === 'find') {
    for (let j = 0; j < rest.length; j++) {
      const action = /^-(exec|execdir|ok|okdir)$/.exec(rest[j])?.[1];
      if (!action) continue;
      const inner = [];
      for (j++; j < rest.length && rest[j] !== ';' && rest[j] !== '+'; j++) inner.push(rest[j]);
      // -execdir runs in each match's directory: can't tell which checkout.
      const where = { ...state, unsure: state.unsure || action.endsWith('dir') };
      analyzeSegment(
        inner.map((text) => ({ text })),
        where,
        out,
        escape,
      );
    }
    return;
  }
  if (base === 'gh') {
    const pos = [];
    for (let k = 0; k < rest.length; k++) {
      if (rest[k] === '-R' || rest[k] === '--repo') k++;
      else if (!rest[k].startsWith('-')) pos.push(rest[k]);
    }
    if ((pos[0] === 'pr' && pos[1] === 'checkout') || pos[0] === 'co')
      out.push({ kind: 'gh', dir: state.dir, unsure: dirUnsure || false, escape });
    return;
  }
  if (base !== 'git') return;

  let dir = state.dir;
  let execConfig = env.execEnv; // a -c key off the allowlist, or GIT_CONFIG_*/GIT_PAGER/… in env
  let k = 0;
  for (; k < rest.length && rest[k].startsWith('-'); k++) {
    const a = rest[k];
    if (a === '-C' && rest[k + 1] !== undefined) {
      const t = rest[++k];
      if (/[~$]/.test(t)) dirUnsure = true;
      else {
        dir = resolve(dir, t);
        if (isAbsolute(t)) dirUnsure = false;
      }
    } else if (a === '-c') {
      const kv = rest[++k] ?? '';
      const eq = kv.indexOf('=');
      if (!safeConfigKey(eq < 0 ? kv : kv.slice(0, eq), eq < 0 ? 'true' : kv.slice(eq + 1)))
        execConfig = true;
    } else if (a === '--config-env' || a.startsWith('--config-env=')) {
      // The value comes from an env var we can't see: judged as if unknown.
      const kv = a.includes('=') ? a.slice(a.indexOf('=') + 1) : (rest[++k] ?? '');
      if (!safeConfigKey(kv.split('=')[0], undefined)) execConfig = true;
    } else if (a === '--namespace' || a === '--super-prefix') k++;
    else if (a === '--git-dir' || a === '--work-tree') {
      env.gitEnv = true;
      k++;
    } else if (a.startsWith('--git-dir=') || a.startsWith('--work-tree=')) env.gitEnv = true;
  }
  out.push({
    kind: 'git',
    dir,
    unsure: dirUnsure || env.gitEnv,
    sub: rest[k],
    args: rest.slice(k + 1),
    execConfig,
    escape,
  });
}

// ─── Verdict ──────────────────────────────────────────────────────────────────────────────────────

const READ_ONLY = new Set([
  'status',
  'log',
  'diff',
  'show',
  'rev-parse',
  'merge-base',
  'ls-files',
  'ls-tree',
  'grep',
  'blame',
  'describe',
  'shortlog',
  'cat-file',
  'for-each-ref',
  'rev-list',
  'show-ref',
  'check-ignore',
  'name-rev',
  'diff-tree',
  'help',
  'version',
  'ls-remote',
  'cherry',
  'range-diff',
]);
const BRANCH_LIST_FLAGS =
  /^(-[arvl]+|--all|--remotes|--verbose|--list|--show-current|--no-color|--color(=.*)?|--column(=.*)?|--no-column|--ignore-case|--omit-empty|(--sort|--format|--merged|--no-merged|--contains|--no-contains|--points-at)(=.*)?)$/;
const BRANCH_FLAGS_WITH_VALUE = new Set([
  '--sort',
  '--format',
  '--merged',
  '--no-merged',
  '--contains',
  '--no-contains',
  '--points-at',
]);
const TAG_LIST_FLAGS =
  /^(-l|--list|-n\d*|-i|--ignore-case|--no-color|--color(=.*)?|--column(=.*)?|--no-column|(--sort|--format|--merged|--no-merged|--contains|--no-contains|--points-at)(=.*)?)$/;
const CONFIG_READ_FLAGS = new Set([
  '--get',
  '--get-all',
  '--get-regexp',
  '--get-urlmatch',
  '--list',
  '-l',
]);
const CONFIG_WRITE = new Set([
  'set',
  'unset',
  'edit',
  'rename-section',
  'remove-section',
  '--unset',
  '--unset-all',
  '--add',
  '--replace-all',
  '--rename-section',
  '--remove-section',
  '--edit',
  '-e',
]);
const CONFIG_WRITE_LONG = [
  '--unset',
  '--unset-all',
  '--add',
  '--replace-all',
  '--rename-section',
  '--remove-section',
  '--edit',
];
const isConfigWrite = (a) => CONFIG_WRITE.has(a) || CONFIG_WRITE_LONG.some((l) => isLongOpt(a, l));
const QUIET_OR_VERBOSE = new Set(['-q', '--quiet', '-v', '--verbose']);

function branchListOnly(args) {
  const listing = args.some((a) => a === '--list' || /^-[arv]*l[arv]*$/.test(a));
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a.startsWith('-')) {
      if (!BRANCH_LIST_FLAGS.test(a)) return false;
      if (BRANCH_FLAGS_WITH_VALUE.has(a)) k++;
    } else if (!listing) return false; // `git branch foo` creates a branch
  }
  return true;
}

/** `git tag` with listing flags only; a bare name (a new tag) needs `-l`/`--list` to be a pattern. */
function tagListOnly(args) {
  const listing = args.some((a) => a === '-l' || a === '--list' || /^-n\d*$/.test(a)); // -n lists
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a.startsWith('-')) {
      if (!TAG_LIST_FLAGS.test(a)) return false;
      if (BRANCH_FLAGS_WITH_VALUE.has(a)) k++; // --sort / --contains / --points-at … <value>
    } else if (!listing) return false;
  }
  return true;
}

/**
 * `git branch -d|-D|--delete [--force] <name>…`: the post-merge cleanup AGENTS.md and ship-pr run
 * from the main checkout. Every name must be a plain branch name and none may be `main`; git itself
 * refuses to delete a branch that any worktree has checked out.
 */
function branchDeleteOnly(args) {
  const flags = args.filter((a) => a.startsWith('-'));
  const names = args.filter((a) => !a.startsWith('-'));
  return (
    flags.some((a) => a === '-d' || a === '-D' || a === '--delete') &&
    flags.every((a) => ['-d', '-D', '--delete', '--force', '-q', '--quiet'].includes(a)) &&
    names.length > 0 &&
    // Case-insensitive: on a case-insensitive filesystem `-D Main` deletes refs/heads/main.
    names.every((n) => /^\w[\w./-]*$/.test(n) && !n.includes('..') && !unsafeRefDestination(n))
  );
}

/**
 * Whether `git <sub> <args>` is on the main-checkout allowlist. `ctx` gives lazy probes
 * ({ branch(), clean() }); null means the directory is only POSSIBLY the main checkout, so the
 * conditional entries can't be verified and are refused.
 */
export function allowedInMain(sub, args, ctx) {
  // `main` in another letter case names refs/heads/main on a case-insensitive filesystem
  // (`fetch . +x:MAIN`, `worktree add p Main`), whatever the subcommand.
  if (args.some(namesMainInAnotherCase)) return false;
  // Options that write a file or run a command, on any subcommand.
  if (args.some((a) => isLongOpt(a, '--output') || isLongOpt(a, '--upload-pack'))) return false;
  if (
    sub === 'grep' &&
    args.some((a) => /^-[a-zA-Z]*O/.test(a) || isLongOpt(a, '--open-files-in-pager'))
  )
    return false;
  if (sub === 'ls-remote' && args.some((a) => /^-[a-zA-Z]*u/.test(a))) return false; // -u = --upload-pack
  return allowedBySubcommand(sub, args, ctx);
}

/** An argument naming `main` in another case: `MAIN`, `+feat:Main`, `refs/heads/mAin`. */
/**
 * A ref DESTINATION that could land on refs/heads/main: git compares ref names as strings, but a
 * case-insensitive filesystem resolves `refs/HEADS/main` to the same loose-ref file. So the whole
 * name is lowercased and compared, and a mixed-case `refs/…` name (no legitimate use) is refused.
 */
export function unsafeRefDestination(ref) {
  const r = ref.replace(/^\+/, '');
  const lower = r.toLowerCase();
  return (
    [MAIN, `heads/${MAIN}`, `refs/heads/${MAIN}`].includes(lower) ||
    lower.endsWith(`/heads/${MAIN}`) ||
    (lower.startsWith('refs/') && r !== lower)
  );
}

export function namesMainInAnotherCase(arg) {
  return arg.split(/[:/]/).some((part) => {
    const p = part.replace(/^\+/, '');
    return p.toLowerCase() === MAIN && p !== MAIN;
  });
}

function allowedBySubcommand(sub, args, ctx) {
  if (sub === undefined || READ_ONLY.has(sub)) return true;
  const flags = args.filter((a) => a.startsWith('-'));
  const pos = args.filter((a) => !a.startsWith('-'));
  switch (sub) {
    case 'fetch': {
      if (args.some((a) => isLongOpt(a, '--update-head-ok') || /^-[a-zA-Z]*u/.test(a)))
        return false;
      // Refspecs (every positional after the remote). A glob can write any branch, main included,
      // from refs we can't see (`+refs/tags/*:refs/heads/*`); no documented workflow passes one.
      const refspecs = pos.slice(1);
      if (refspecs.some((r) => r.includes('*'))) return false;
      return !refspecs.some(
        (r) => r.includes(':') && unsafeRefDestination(r.slice(r.indexOf(':') + 1)),
      );
    }
    case 'reflog':
      return !args.some((a) => a === 'expire' || a === 'delete');
    case 'remote': {
      const first = args.find((a) => a !== '-v' && a !== '--verbose');
      return first === undefined || first === 'show' || first === 'get-url';
    }
    case 'config': {
      if (args.some(isConfigWrite)) return false;
      // Positionals, with `--` counted as one and option values (-f <file>) skipped.
      const positional = [];
      for (let k = 0; k < args.length; k++) {
        if (args[k] === '--' || !args[k].startsWith('-')) positional.push(args[k]);
        else if (/^(-f|--file|--blob|--type|--default)$/.test(args[k])) k++;
      }
      if (positional[0] === 'get' || positional[0] === 'list') return true; // `git config get <key>`
      if (args.some((a) => CONFIG_READ_FLAGS.has(a))) return true; // `--get <key>`, `--list`
      return positional.length === 1 && positional[0] !== '--'; // `git config <key>` is a get
    }
    case 'symbolic-ref':
      // Read form only: `symbolic-ref [-q] [--short] HEAD`. Two names, -d or -m write.
      return (
        pos.length <= 1 && !args.some((a) => /^-[a-zA-Z]*[dm]/.test(a) || isLongOpt(a, '--delete'))
      );
    case 'branch':
      return branchListOnly(args) || branchDeleteOnly(args);
    case 'tag':
      return tagListOnly(args);
    case 'stash':
      return args[0] === 'list' || args[0] === 'show';
    case 'worktree': {
      const force = flags.some((a) => isLongOpt(a, '--force') || /^-[a-zA-Z]*f/.test(a));
      if (['list', 'prune', 'repair'].includes(args[0])) return true;
      // add -B resets an existing branch (the workflow only uses -b / --detach).
      if (args[0] === 'add' && flags.some((a) => /^--?[a-zA-Z]*B/.test(a))) return false;
      // add -b <name>: the new branch must not land on main.
      const b = args.findIndex((a) => a === '-b');
      if (args[0] === 'add' && b > 0 && unsafeRefDestination(args[b + 1] ?? '')) return false;
      return (args[0] === 'add' || args[0] === 'remove') && !force;
    }
    case 'pull':
      return (
        !!ctx &&
        flags.includes('--ff-only') &&
        flags.every((a) => a === '--ff-only' || a === '--prune' || QUIET_OR_VERBOSE.has(a)) &&
        (pos.length === 0 ||
          (pos[0] === 'origin' && (pos.length === 1 || (pos.length === 2 && pos[1] === MAIN)))) &&
        ctx.branch() === MAIN
      );
    case 'merge':
      return (
        !!ctx &&
        flags.includes('--ff-only') &&
        flags.every((a) => a === '--ff-only' || QUIET_OR_VERBOSE.has(a)) &&
        pos.length === 1 &&
        pos[0] === `origin/${MAIN}` &&
        ctx.branch() === MAIN
      );
    case 'checkout':
    case 'switch':
      return !!ctx && args.length === 1 && args[0] === MAIN && ctx.clean();
    case 'reset': {
      // Unstage only: `git reset [-q] [HEAD] [-- <paths>]`. No mode flag, no other commit-ish.
      const dd = args.indexOf('--');
      const before = (dd < 0 ? args : args.slice(0, dd)).filter(
        (a) => a !== '-q' && a !== '--quiet',
      );
      return before.length === 0 || (before.length === 1 && before[0] === 'HEAD');
    }
    default:
      return false; // unknown subcommands and aliases included
  }
}

// ─── Probes ───────────────────────────────────────────────────────────────────────────────────────

const git = (dir, ...args) =>
  execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 3000,
  }).trim();

/** { gitDir, common } realpaths for `dir`, or null when it isn't in a git repository. */
const gitDirsCache = new Map();
function gitDirs(dir) {
  if (!gitDirsCache.has(dir)) gitDirsCache.set(dir, readGitDirs(dir));
  return gitDirsCache.get(dir);
}
function readGitDirs(dir) {
  try {
    const [gitDir, common] = git(
      dir,
      'rev-parse',
      '--path-format=absolute',
      '--git-dir',
      '--git-common-dir',
    ).split('\n');
    return { gitDir: realpathSync(gitDir), common: realpathSync(common) };
  } catch {
    return null; // not a repo (or unreadable): not ours to guard
  }
}

/** True when `dir` is THIS project's primary checkout (not a linked worktree, not another repo). */
export function isProjectMainCheckout(dir, projectDir) {
  const d = gitDirs(dir);
  if (!d || d.gitDir !== d.common) return false;
  const project = projectDir ? gitDirs(projectDir) : null;
  return !project || project.common === d.common;
}

function denyReason(inv) {
  const what = {
    gh: '`gh pr checkout`',
    shell:
      'A command fed to a shell from a pipe, xargs or <(…) (unreadable, so treated as unknown)',
    dynamic: 'A command whose name comes from a variable or substitution (unreadable)',
    git: inv.execConfig
      ? `\`git ${inv.sub}\` with config it can't vet (a \`-c\` key off the display-only allowlist, or GIT_CONFIG_*/GIT_PAGER/GIT_SSH… in the env)`
      : `\`git ${inv.sub}\``,
  }[inv.kind];
  const where = inv.unsure
    ? `possibly in the MAIN checkout (the directory can't be resolved from the command: use an absolute path, no ~ or $VAR, no GIT_DIR/--git-dir)`
    : `in the MAIN checkout (${inv.dir})`;
  return (
    `${what} ${where} is blocked: it stays on \`main\` ` +
    `(AGENTS.md → "Git & branch workflow"). Other sessions read it, and project skills load from it. ` +
    `Allowed there: read-only git; \`git worktree list|add|remove|prune|repair\` (no --force); ` +
    `\`git branch -d|-D <branch>\` (not main); \`git reset [HEAD] [-- <paths>]\` (unstage only); ` +
    `\`git pull --ff-only [--prune] origin main\` and \`git merge --ff-only origin/main\` on main; ` +
    `\`git checkout main\` / \`git switch main\` with a clean tree. ` +
    `Do this in a worktree: git fetch origin && git worktree add .claude/worktrees/<slug> -b <type>/<id>-<slug> origin/main ` +
    `(or ~/workspace/tmp<n>/mat-plan for a parallel lane you will open in an editor). ` +
    `If a person explicitly asked for it here, prefix the command with ${ESCAPE}.`
  );
}

/** The reason to deny `command` run from `cwd`, or null to allow. */
export function check(command, cwd, projectDir) {
  for (const inv of invocations(command, cwd)) {
    if (inv.escape) continue;
    let ctx = null;
    if (!inv.unsure) {
      if (!isProjectMainCheckout(inv.dir, projectDir)) continue;
      let branch, clean;
      ctx = {
        branch: () => (branch ??= git(inv.dir, 'branch', '--show-current')),
        clean: () => (clean ??= git(inv.dir, 'status', '--porcelain') === ''),
      };
    }
    if (inv.kind !== 'git' || inv.execConfig || !allowedInMain(inv.sub, inv.args, ctx))
      return denyReason(inv);
  }
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
  // Cheap pre-filter, on the text with quotes and backslashes dropped (`g''it` is git); `sh\b`
  // keeps a pipe into a bare shell in view.
  if (typeof command !== 'string' || !/git|\bgh\b|sh\b/.test(command.replace(/['"\\]/g, '')))
    return;
  const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
  const reason = check(command, cwd, process.env.CLAUDE_PROJECT_DIR);
  if (!reason) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
}

function isEntryPoint() {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false; // imported (tests), or argv[1] unreadable
  }
}

// Under CI the hook is a no-op with no output: a CI model job may load project settings.
if (isEntryPoint() && !process.env.CI && !process.env.GITHUB_ACTIONS)
  main().catch(() => {
    /* fail open: a guard that errors must not block every git command */
  });
