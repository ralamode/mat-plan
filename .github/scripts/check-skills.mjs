#!/usr/bin/env node
/**
 * Skills freshness guard: an agent skill may not cite a path or a pnpm script that doesn't exist.
 *
 * Skills (`.claude/skills/*.md`) and agent definitions (`.claude/agents/*.md`) are procedures an agent
 * follows literally. A skill that names a renamed file or a script that was removed is worse than no
 * skill, because it gets TRUSTED instead of checked (the same reasoning as check-feature-guides.mjs).
 * The first batch of skills shipped with a wrong claim within a day, so this is not hypothetical.
 *
 * Checks every backticked token and markdown link in those files:
 *   - repo paths (`apps/…`, `packages/…`, `docs/…`, `.github/…`, `.claude/…`, `.husky/…`): must exist
 *   - root-shaped file names (`AGENTS.md`, `package.json`, `.squawk.toml`, `ci.yml`): must exist at the
 *     root, next to the skill, or as the name of some file in the repo
 *   - relative markdown links (`](../../../docs/x.md)`, `](check.sh)`): must resolve from the skill's
 *     own directory, or failing that from the repo root
 *   - every `pnpm [--filter|-F <pkg>] [run] <script>` in a span: the script must exist in that
 *     package.json; `<pkg>` is resolved from the workspace packages' own `name` fields
 * Line suffixes (`:12`, `:L12`, `#L3`) and `#anchors` are stripped before the existence check.
 * Templates are skipped: anything with `<`, `*`, `{`, `$`, `NNNN` or `…` is a pattern, not a path.
 * Gitignored paths are skipped too (`.claude/worktrees/`, `apps/web/.env.local`): they are runtime
 * state a skill legitimately names, and a fresh checkout never has them. To mention a file that
 * deliberately does not exist, don't backtick it.
 *
 * Usage:
 *   node .github/scripts/check-skills.mjs [repoRoot]   # default: cwd
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname, resolve, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.argv[2] ?? '.');
const SOURCES = ['.claude/skills', '.claude/agents'];
const WORKSPACE_GROUPS = ['apps', 'packages'];
const PATH_PREFIX = /^(apps|packages|docs|\.github|\.claude|\.husky)\//;
/** A slash-less name shaped like a root/config file: `README.md`, `package.json`, `.prettierrc`. */
const ROOT_SHAPED =
  /^(?:[A-Z][A-Z0-9_-]*\.md|[\w.-]+\.(?:json|ya?ml|toml)|\.[\w-]+(?:\.(?:mjs|cjs|js)|rc))$/;
const TEMPLATE = /[<>*{}$…]|NNNN|\.\.\.|\bpr-\d/;
const PNPM_BUILTINS = new Set([
  'install',
  'i',
  'add',
  'remove',
  'update',
  'exec',
  'dlx',
  'audit',
  'why',
  'list',
  'ls',
  'store',
  'outdated',
  'rebuild',
  'prune',
  'create',
  'init',
  'publish',
  'pack',
  'config',
  'env',
]);

/** pnpm filter → package dir, from the workspace packages' own `name` fields (and `./dir`). */
function workspaceFilters() {
  const map = new Map();
  for (const group of WORKSPACE_GROUPS) {
    const dir = join(ROOT, group);
    if (!existsSync(dir)) continue;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const pkgDir = `${group}/${e.name}`;
      const file = join(ROOT, pkgDir, 'package.json');
      if (!e.isDirectory() || !existsSync(file)) continue;
      const { name } = JSON.parse(readFileSync(file, 'utf8'));
      if (name) map.set(name, pkgDir);
      map.set(`./${pkgDir}`, pkgDir);
      map.set(pkgDir, pkgDir);
    }
  }
  return map;
}
const FILTERS = workspaceFilters();

/** Base names of every file in the repo (tracked or not, minus ignored ones). */
const REPO_NAMES = new Set(
  (() => {
    try {
      return execFileSync(
        'git',
        ['-C', ROOT, 'ls-files', '--cached', '--others', '--exclude-standard'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 },
      )
        .split('\n')
        .filter(Boolean)
        .map((f) => basename(f));
    } catch {
      return []; // not a git repo: root-shaped names must then exist at the root or next to the skill
    }
  })(),
);

function markdownFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return markdownFiles(p);
    return e.name.endsWith('.md') ? [p] : [];
  });
}

const scriptsCache = new Map();
function scriptsOf(pkgDir) {
  if (!scriptsCache.has(pkgDir)) {
    const file = join(ROOT, pkgDir, 'package.json');
    scriptsCache.set(
      pkgDir,
      existsSync(file)
        ? new Set(Object.keys(JSON.parse(readFileSync(file, 'utf8')).scripts ?? {}))
        : null,
    );
  }
  return scriptsCache.get(pkgDir);
}

/** Runtime paths (gitignored) exist on a working machine, never in a checkout. */
function isIgnored(p) {
  try {
    execFileSync('git', ['-C', ROOT, 'check-ignore', '-q', '--no-index', p], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Strip trailing punctuation, then a `:12` / `:L12` / `#L3` line suffix or `#anchor`, from a path. */
export const cleanPath = (t) =>
  t
    .replace(/[.,;)]+$/, '')
    .replace(/#.*$/, '')
    .replace(/:L?\d+(-L?\d+)?(,\d+)*$/, '')
    .replace(/[.,;:)]+$/, '');

/**
 * Every `pnpm … <script>` in a span, as { filter, dir, script }. Builtins, templates and
 * `-r`/`--recursive` runs are skipped; `-C <dir>` names the package directory directly.
 */
export function pnpmInvocations(span) {
  const words = span.split(/[\s;&|()]+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < words.length; i++) {
    if (words[i] !== 'pnpm') continue;
    let filter = null;
    let dir = null;
    let recursive = false;
    let j = i + 1;
    for (; j < words.length && words[j].startsWith('-'); j++) {
      const w = words[j];
      if (w === '--filter' || w === '-F') filter = words[++j] ?? null;
      else if (w.startsWith('--filter=')) filter = w.slice('--filter='.length);
      else if (/^-F./.test(w)) filter = w.slice(2);
      else if (w === '-C' || w === '--dir') dir = words[++j] ?? null;
      else if (w.startsWith('--dir=')) dir = w.slice('--dir='.length);
      else if (w === '-r' || w === '--recursive') recursive = true;
    }
    if (recursive) continue; // runs the script wherever it exists: nothing single to check
    let script = words[j];
    if (script === 'run' || script === 'run-script') {
      for (j++; words[j]?.startsWith('-'); j++);
      script = words[j];
    } else if (PNPM_BUILTINS.has(script)) continue;
    if (!script || !/^[a-z][\w:.-]*$/.test(script)) continue;
    if ((filter !== null && TEMPLATE.test(filter)) || (dir !== null && TEMPLATE.test(dir)))
      continue;
    out.push({ filter, dir: dir && dir.replace(/^\.\//, '').replace(/\/+$/, ''), script });
  }
  return out;
}

export function checkFile(file) {
  const problems = [];
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const where = (i) => `${relative(ROOT, file)}:${i + 1}`;
  const here = dirname(file);
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) inFence = !inFence;

    // Relative markdown links: from the skill's directory, else from the repo root.
    for (const [, raw] of line.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('#') || raw.startsWith('/')) continue;
      const target = cleanPath(raw);
      if (!target || TEMPLATE.test(target)) continue;
      if (
        !existsSync(resolve(here, target)) &&
        !existsSync(join(ROOT, target)) &&
        !isIgnored(target)
      )
        problems.push(`${where(i)}: link → ${target} does not exist`);
    }

    // Backticked tokens outside fences; inside fences, whole lines are commands.
    const tokens = inFence ? [line.trim()] : [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    for (const tok of tokens) {
      for (const word of tok.split(/\s+/)) {
        const p = cleanPath(word.replace(/^["'(]|["')]$/g, ''));
        if (!p || TEMPLATE.test(p)) continue;
        if (PATH_PREFIX.test(p)) {
          if (!existsSync(join(ROOT, p)) && !isIgnored(p))
            problems.push(`${where(i)}: path ${p} does not exist`);
        } else if (ROOT_SHAPED.test(p)) {
          const found =
            existsSync(join(ROOT, p)) ||
            existsSync(join(here, p)) ||
            REPO_NAMES.has(p) ||
            isIgnored(p);
          if (!found)
            problems.push(
              `${where(i)}: file ${p} does not exist (not at the root, next to the skill, or anywhere in the repo)`,
            );
        }
      }
      for (const { filter, dir, script } of pnpmInvocations(tok)) {
        const pkgDir = dir !== null ? dir || '.' : filter === null ? '.' : FILTERS.get(filter);
        if (pkgDir === undefined) continue; // unknown filter: not ours to judge
        const scripts = scriptsOf(pkgDir);
        if (scripts && !scripts.has(script))
          problems.push(
            `${where(i)}: pnpm ${dir !== null ? `-C ${dir} ` : filter === null ? '' : `--filter ${filter} `}${script} is not a script in ${pkgDir}/package.json`,
          );
      }
    }
  });
  return problems;
}

function isEntryPoint() {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false; // imported (tests), or argv[1] unreadable
  }
}

if (isEntryPoint()) {
  const files = SOURCES.flatMap((s) => markdownFiles(join(ROOT, s)));
  const problems = files.flatMap(checkFile);
  if (problems.length) {
    console.error(`Skills guard FAILED — ${problems.length} stale reference(s):\n`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    console.error('\nFix the reference, or update the skill to match what the repo now does.');
    process.exit(1);
  }
  console.log(
    `Skills guard OK — ${files.length} file(s), every cited path and pnpm script exists.`,
  );
}
