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

// ── Routing (DX-14 item 5a; docs/plans/dx-14-5-skill-routing-guard.md) ──────────────────────────────
// A skill starts when its description matches what the user typed, and every description loads in
// every session. Two skills quoting the same trigger split one request between them ("shipit" vs
// "ship it" did). Triggers are DERIVED from the descriptions (no second copy to keep in sync): the
// double-quoted phrases in the trigger clause, which runs from the first `Use` / `Run it` to the end.
// ⚠️ Claude Code routes SEMANTICALLY; this catches literal and near-literal collisions only.

/** Longest a description may be. Every one loads in every session. */
export const MAX_DESCRIPTION = 500;
const TRIGGER_CLAUSE = /\b(?:Use|Run it)\b/;
/** Placeholder tokens in a trigger ("save X", "review PR <n>"): wildcards, never compared. */
const PLACEHOLDER = new Set(['x', 'y', 'n']);

const tokens = (text) =>
  text
    .replace(/<[^>]*>/g, ' ')
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.filter((t) => !PLACEHOLDER.has(t)) ?? [];

/** True when `needle` occurs as a contiguous run of whole tokens in `hay`, or its tokens joined
 *  occur in a contiguous run of `hay`'s tokens joined, so "shipit" meets "ship it" and vice versa,
 *  but "ownership itself" never contains "shipit". */
function reaches(needle, hay) {
  if (needle.length === 0) return false;
  const joined = needle.join('');
  for (let i = 0; i < hay.length; i++) {
    if (needle.every((t, k) => hay[i + k] === t)) return true;
    let run = '';
    for (let j = i; j < hay.length && run.length < joined.length; j++) {
      run += hay[j];
      if (run === joined) return true;
    }
  }
  return false;
}

/**
 * Pure: `skills` is `[{ name, description }]`; returns problem strings. Exported so a later split of
 * the skills into a portable core (DX-15) can lift it without this file's repo layout.
 */
export function checkRouting(skills) {
  const problems = [];
  const parsed = skills.map(({ name, description }) => {
    if (!description) {
      problems.push(`${name}: no single-line \`description:\` in the frontmatter`);
      return { name, clause: [], triggers: [] };
    }
    if (description.length > MAX_DESCRIPTION) {
      problems.push(
        `${name}: description is ${description.length} characters (max ${MAX_DESCRIPTION}); the steps belong in the body`,
      );
    }
    const at = description.search(TRIGGER_CLAUSE);
    if (at === -1) {
      problems.push(`${name}: no trigger clause (a "Use when …" / "Use for …" / "Run it …")`);
      return { name, clause: [], triggers: [] };
    }
    const clause = description.slice(at);
    const triggers = [...clause.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    if (triggers.length === 0)
      problems.push(`${name}: the trigger clause quotes no phrase anyone types`);
    for (const t of triggers) {
      if (tokens(t).length === 0) problems.push(`${name}: trigger "${t}" is only a placeholder`);
    }
    return { name, clause: tokens(clause), triggers };
  });
  for (const a of parsed) {
    for (const t of a.triggers) {
      for (const b of parsed) {
        if (b !== a && reaches(tokens(t), b.clause)) {
          problems.push(`collision: ${a.name}'s trigger "${t}" also reaches ${b.name}`);
        }
      }
    }
  }
  return problems;
}

/**
 * The lines of a `## <heading>` section, up to the next `## ` heading OUTSIDE a code fence, or null
 * when the section is missing. Shared by checkDoneWhen and checkCitations so a fenced `## Example`
 * can't end a section early in one check and not the other.
 */
export function sectionLines(body, heading) {
  const lines = body.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) return null;
  const out = [];
  let fenced = false;
  for (const l of lines.slice(start + 1)) {
    if (/^\s*(```|~~~)/.test(l)) fenced = !fenced;
    if (!fenced && /^## /.test(l)) break;
    out.push(l);
  }
  return out;
}

/**
 * Every skill ends with an exit checklist (DX-14 item 5b): a `## Done when` section holding at least
 * one `- [ ]` box, so an agent can tell "I followed the steps" from "the result is right". Pure, like
 * checkRouting: `skills` is `[{ name, body }]`.
 */
export function checkDoneWhen(skills) {
  return skills.flatMap(({ name, body }) => {
    const section = sectionLines(body, 'Done when');
    if (section === null) return [`${name}: no \`## Done when\` exit checklist`];
    return section.some((l) => /^- \[ \] \S/.test(l))
      ? []
      : [`${name}: \`## Done when\` has no \`- [ ]\` item`];
  });
}

/** Open PRs (and the one under review) sit above the latest MERGED number by up to this much. */
export const PR_MARGIN = 50;

/**
 * The ONE definition of a red flag's citation (DX-15; docs/plans/dx-15-rules-cite-incidents.md). The
 * skills README states the rule and points here. Each form's `check` returns null when valid, else
 * the problem. `cites: false` marks the honest no-incident label.
 */
export const CITATION_FORMS = [
  {
    label: '(#NNN) or (#NNN, #MMM): a PR whose failure earned it',
    match: /^#\d+(?:, #\d+)*$/,
    check: (c, { maxPr }) => {
      const bad = c
        .match(/\d+/g)
        .map(Number)
        .filter((n) => n < 1 || n > maxPr);
      return bad.length
        ? `cites #${bad.join(', #')}, past the bound #${maxPr} (latest merged + ${PR_MARGIN})`
        : null;
    },
  },
  {
    label: '(lessons: "phrase"): an entry in docs/lessons.md containing the phrase',
    match: /^lessons: "[^"]+"$/,
    check: (c, { lessons }) => {
      const phrase = /"([^"]+)"/.exec(c)[1];
      return lessons.includes(phrase)
        ? null
        : `cites lessons "${phrase}", which docs/lessons.md doesn't contain`;
    },
  },
  { label: '(maintainer, YYYY-MM-DD): a dated ruling', match: /^maintainer, \d{4}-\d{2}-\d{2}$/ },
  { label: '(enforced by `path`): a rule a guard already holds', match: /^enforced by `[^`]+`$/ },
  { label: '(hypothesis): no incident yet', match: /^hypothesis$/, cites: false },
];

/**
 * Every Red flags item ends with what earned it, as its LAST parenthetical (optionally `_…_`, the
 * house spelling of a ruling), so a `#3` or a `lessons.md` mention elsewhere in the text can't pass.
 * Per item, wrapped and nested lines joined. It checks the FORM, the PR bound and the lessons phrase;
 * whether the incident is the right one is review's question. Every skill has a Red flags section
 * with at least one item. Pure: `skills` is `[{ name, body }]`.
 */
export function checkCitations(skills, { maxPr = Infinity, lessons = '' } = {}) {
  const problems = [];
  let cited = 0;
  let hypotheses = 0;
  const forms = CITATION_FORMS.map((f) => f.label).join(' · ');
  for (const { name, body } of skills) {
    const section = sectionLines(body, 'Red flags');
    if (section === null) {
      problems.push(`${name}: no \`## Red flags\` section`);
      continue;
    }
    const items = [];
    for (const l of section) {
      if (/^- /.test(l)) items.push(l.slice(2));
      else if (/^\s+\S/.test(l) && items.length) items[items.length - 1] += ` ${l.trim()}`;
    }
    if (items.length === 0) problems.push(`${name}: \`## Red flags\` has no items`);
    for (const item of items) {
      const short = item.length > 60 ? `${item.slice(0, 57)}…` : item;
      const c = /_?\(([^()]*)\)_?\s*$/.exec(item)?.[1].trim() ?? '';
      const form = CITATION_FORMS.find((f) => f.match.test(c));
      if (!form) {
        problems.push(`${name}: "${short}" ends with no citation. Forms: ${forms}`);
        continue;
      }
      const problem = form.check?.(c, { maxPr, lessons }) ?? null;
      if (problem) problems.push(`${name}: "${short}" ${problem}`);
      else if (form.cites === false) hypotheses++;
      else cited++;
    }
  }
  return { problems, cited, hypotheses };
}

/** The highest `(#N)` squash-merge number in commit subjects, or null when there is none to read
 *  (a fixture, a shallow clone): then the PR bound can't be checked, and the caller says so. */
export function latestMergedPr(subjects) {
  const ns = [...subjects.matchAll(/\(#(\d+)\)$/gm)].map((m) => Number(m[1]));
  return ns.length ? Math.max(...ns) : null;
}

/**
 * Agent definitions that pin a model the policy forbids in frontmatter (DX-11 follow-up, 2026-11-16).
 *
 * Fable is for high-stakes plans and reviews only, and `plan-with-panel` / `review-pr` ask for it at
 * spawn time (`model: "fable"`, which beats frontmatter) when the work touches an area in
 * `.claude/skills/README.md` → "When a lens runs on Fable". A reviewer PINNED to fable runs every `review-pr` fan-out, doubt-check and
 * ad-hoc spawn on it too. That is how DX-11's pin spent the account's monthly Fable budget on PR
 * reviews across six lanes (2026-11-16), so a pin is refused here rather than remembered.
 *
 * Pure: takes `[{ file, text }]`, returns problem strings.
 */
export const FORBIDDEN_AGENT_MODELS = ['fable'];
export function checkAgentModels(agents) {
  return agents.flatMap(({ file, text }) => {
    // CRLF-tolerant, and a quoted value (`model: "fable"`, `'fable'`) is the same YAML scalar.
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
    const model = /^model:[ \t]*['"]?([^'"\s#]+)/m.exec(fm)?.[1]?.toLowerCase();
    return model &&
      FORBIDDEN_AGENT_MODELS.some((m) => model === m || model.startsWith(`claude-${m}`))
      ? [
          `${file}: frontmatter pins \`model: ${model}\`. Reviewer agents default to opus; a high-stakes ` +
            'plan or review passes `model: "fable"` at spawn time (.claude/skills/README.md → When a lens runs on Fable)',
        ]
      : [];
  });
}

/** `{ name, description, body }` for each `.claude/skills/<name>/SKILL.md`. */
function readSkills() {
  const dir = join(ROOT, '.claude/skills');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'SKILL.md')))
    .map((e) => {
      const text = readFileSync(join(dir, e.name, 'SKILL.md'), 'utf8');
      const fm = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
      const description = /^description:[ \t]*(\S.*)$/m.exec(fm)?.[1]?.trim() ?? null;
      return { name: e.name, description, body: text };
    });
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
  const skills = readSkills();
  let subjects = '';
  try {
    subjects = execFileSync('git', ['-C', ROOT, 'log', '--format=%s'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    // not a git repo: no subjects, so latestMergedPr returns null below
  }
  const latest = latestMergedPr(subjects);
  if (latest === null)
    console.warn('Skills guard: no merged PR numbers in history; the PR bound is not checked.');
  const lessonsPath = join(ROOT, 'docs/lessons.md');
  const citations = checkCitations(skills, {
    maxPr: latest === null ? Infinity : latest + PR_MARGIN,
    lessons: existsSync(lessonsPath) ? readFileSync(lessonsPath, 'utf8') : '',
  });
  const problems = [
    ...files.flatMap(checkFile),
    ...checkRouting(skills),
    ...checkDoneWhen(skills),
    ...citations.problems,
    ...checkAgentModels(
      markdownFiles(join(ROOT, '.claude/agents')).map((f) => ({
        file: relative(ROOT, f),
        text: readFileSync(f, 'utf8'),
      })),
    ),
  ];
  if (problems.length) {
    console.error(`Skills guard FAILED — ${problems.length} problem(s):\n`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    console.error(
      '\nFix the reference, or update the skill to match what the repo now does. A routing problem: ' +
        '.claude/skills/README.md → "How to write a skill here".',
    );
    process.exit(1);
  }
  console.log(
    `Skills guard OK — ${files.length} file(s), every cited path and pnpm script exists; ` +
      `${skills.reduce((n, sk) => n + [...(sk.description ?? '').slice(Math.max(0, (sk.description ?? '').search(TRIGGER_CLAUSE))).matchAll(/"[^"]+"/g)].length, 0)} trigger(s) across ${skills.length} skill(s), no collisions; ` +
      `red flags: ${citations.cited} cited, ${citations.hypotheses} hypothesis.`,
  );
}
