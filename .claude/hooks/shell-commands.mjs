/**
 * The commands a shell string runs, after the wrappers that only launch another command are peeled
 * off (`sudo`, `env`, `timeout`, `xargs`, `nohup`, `eval`, `watch`, `find -exec`, `pnpm exec`, `npx`,
 * `script -c`, and `sh|bash|zsh|… -c '…'` or a heredoc fed to a bare shell, re-read). Shared by the
 * guards that apply in EVERY directory (`guard-process-kill.mjs`, `guard-hook-skip.mjs`), so the walk
 * exists once (docs/tech-debt.md → "Two shell-wrapper walks": the main-checkout guard keeps its own,
 * fused with git state). It uses that sibling's `lex()`.
 *
 * BEST-EFFORT, NOT A SECURITY BOUNDARY: the forms that actually get typed. Each guard's header lists
 * its own known gaps.
 *
 * `commands(command, lex, escapeName)` returns `{ base, rest, restText, viaXargs, assignments }` per
 * command found. A segment whose leading assignments include `escapeName` (the guard's visible escape
 * hatch, e.g. `MAT_PLAN_ALLOW_PATTERN_KILL=1`) yields nothing, nor does anything nested in it.
 */
import { basename } from 'node:path';

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const KEYWORDS = new Set(['!', '{', '}', 'then', 'do', 'else', 'if', 'elif', 'while', 'until']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);
const XARGS_WITH_VALUE = new Set(['-I', '-n', '-P', '-L', '-d', '-E', '-s', '-a', '--arg-file']);
const SUDO_WITH_VALUE = new Set(['-u', '-g', '-C', '-D', '-h', '-p', '-U', '-r', '-t', '-T']);

/** Every command `command` runs, as `{ base, rest, restText, viaXargs, assignments }`. */
export function commands(command, lex, escapeName) {
  const found = [];
  walk(lex(command), found, false, lex, escapeName);
  return found;
}

function walk(tokens, found, escape, lex, escapeName) {
  let segment = [];
  const flush = () => {
    if (segment.length) analyze(segment, found, escape, lex, escapeName);
    segment = [];
  };
  for (const t of tokens) {
    if (t.op) flush();
    else segment.push(t);
  }
  flush();
}

function analyze(tokens, found, inheritedEscape, lex, escapeName) {
  for (const t of tokens)
    for (const sub of t.subs ?? []) walk(sub, found, inheritedEscape, lex, escapeName);

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
  const reLex = (src, esc) => walk(lex(src), found, esc, lex, escapeName);

  let i = 0;
  let escape = inheritedEscape;
  const assignments = []; // `VAR=value` words that set the command's environment
  for (; i < words.length && ASSIGNMENT.test(text(i)); i++) {
    if (text(i) === escapeName) escape = true;
    assignments.push(text(i));
  }
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
        else if (ASSIGNMENT.test(a)) assignments.push(a);
        else if (!a.startsWith('-')) break;
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
        else if (ASSIGNMENT.test(a)) assignments.push(a);
        else if (!a.startsWith('-')) break;
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
      analyze(inner, found, escape, lex, escapeName);
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

  found.push({ base, rest, restText, viaXargs, assignments });
}
