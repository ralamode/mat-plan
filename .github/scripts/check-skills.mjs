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
 *   - repo paths (`apps/…`, `packages/…`, `docs/…`, `.github/…`, `.claude/…`, root files): must exist
 *   - relative markdown links (`](../../../docs/x.md)`): must resolve from the skill's own directory
 *   - `pnpm <script>` / `pnpm --filter <pkg> <script>`: the script must exist in that package.json
 * Templates are skipped: anything with `<`, `*`, `{`, `$`, `NNNN` or `…` is a pattern, not a path.
 * Gitignored paths are skipped too (`.claude/worktrees/`, `apps/web/.env.local`): they are runtime
 * state a skill legitimately names, and a fresh checkout never has them.
 *
 * Usage:
 *   node .github/scripts/check-skills.mjs [repoRoot]   # default: cwd
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const ROOT = resolve(process.argv[2] ?? '.');
const SOURCES = ['.claude/skills', '.claude/agents'];
const PATH_PREFIX = /^(apps|packages|docs|\.github|\.claude|\.husky)\//;
const ROOT_FILES = new Set(['AGENTS.md', 'CLAUDE.md', 'README.md', 'package.json', '.squawk.toml']);
const TEMPLATE = /[<>*{}$…]|NNNN|\.\.\.|\bpr-\d/;
const PNPM_BUILTINS = new Set([
  'install',
  'i',
  'add',
  'remove',
  'update',
  'exec',
  'dlx',
  'run',
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
const FILTERS = {
  web: 'apps/web',
  '@mat-plan/db': 'packages/db',
  '@mat-plan/shared': 'packages/shared',
};

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

/** Strip a `:line`/`:a-b` suffix and trailing punctuation from a cited path. */
const cleanPath = (t) => t.replace(/:\d+(-\d+)?(,\d+)*$/, '').replace(/[.,;:)]+$/, '');

export function checkFile(file) {
  const problems = [];
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const where = (i) => `${relative(ROOT, file)}:${i + 1}`;
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) inFence = !inFence;

    // Relative markdown links, resolved from the skill's directory.
    for (const [, target] of line.matchAll(/\]\((\.{1,2}\/[^)#\s]+)(?:#[^)]*)?\)/g)) {
      if (TEMPLATE.test(target)) continue;
      if (!existsSync(resolve(dirname(file), target)))
        problems.push(`${where(i)}: link → ${target} does not exist`);
    }

    // Backticked tokens outside fences; inside fences, whole lines are commands.
    const tokens = inFence ? [line.trim()] : [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    for (const tok of tokens) {
      for (const word of tok.split(/\s+/)) {
        const p = cleanPath(word.replace(/^["'(]|["')]$/g, ''));
        if (!p || TEMPLATE.test(p)) continue;
        if (
          (PATH_PREFIX.test(p) || ROOT_FILES.has(p)) &&
          !existsSync(join(ROOT, p)) &&
          !isIgnored(p)
        )
          problems.push(`${where(i)}: path ${p} does not exist`);
      }
      const m = /(?:^|\s)pnpm\s+(?:--filter\s+(\S+)\s+)?([a-z][\w:-]*)/.exec(tok);
      if (m && !TEMPLATE.test(tok)) {
        const [, filter, script] = m;
        if (!filter && PNPM_BUILTINS.has(script)) continue;
        if (filter && (script === 'exec' || PNPM_BUILTINS.has(script))) continue;
        const pkgDir = filter ? FILTERS[filter] : '.';
        if (pkgDir === undefined) continue; // unknown filter: not ours to judge
        const scripts = scriptsOf(pkgDir);
        if (scripts && !scripts.has(script))
          problems.push(
            `${where(i)}: pnpm ${filter ? `--filter ${filter} ` : ''}${script} is not a script in ${pkgDir}/package.json`,
          );
      }
    }
  });
  return problems;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
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
