#!/usr/bin/env node
/**
 * Feature-guide freshness guard.
 *
 * Each guide in `docs/features/` declares the files it OWNS. If a PR touches an owned file without
 * touching its guide, this fails — so the guide cannot silently drift from the code it describes.
 *
 * WHY A GATE AND NOT A CONVENTION: this repo has the scars. AGENTS.md listed five required CI checks
 * for months that did not exist (docs/tech-debt.md, audited 2026-09-23), and the session handoff that
 * prompted these guides opens by noting "a committed handoff goes stale, which is the exact failure
 * this session spent its time correcting." A guide nobody is forced to update is a guide that lies,
 * and a guide that lies is worse than none — it gets TRUSTED instead of researched.
 *
 * Usage:
 *   node .github/scripts/check-feature-guides.mjs [baseRef]   # default: origin/main
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const GUIDE_DIR = 'docs/features';
const SKIP_LABEL = 'docs-skip-feature-map';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

/**
 * Hand-parsed rather than a YAML dependency: the frontmatter shape is fixed and tiny, and adding a
 * parser dep to a guard that runs on every PR is a supply-chain cost for no benefit.
 */
function parseGuide(path) {
  const text = readFileSync(path, 'utf8');
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return null;
  const owns = [];
  let inOwns = false;
  let feature = null;
  for (const line of m[1].split('\n')) {
    if (/^feature:/.test(line)) feature = line.replace(/^feature:\s*/, '').trim();
    if (/^owns:/.test(line)) {
      inOwns = true;
      continue;
    }
    if (inOwns) {
      // 🔴 A COMMENT INSIDE `owns:` MUST NOT END THE BLOCK. The original `else if` treated every
      // non-item, non-blank line as the end of the list, so the first `# …` note silently truncated
      // it: `write-path.md` DECLARED thirteen entries and this parser READ three, leaving ten
      // unguarded by both rot checks — `mutation-entry.ts`, `mutating-actions.ts`,
      // `packages/db/src/writers/`, `scope.ts`, `seed.ts` and five more. The guard printed OK
      // throughout, which is the worst failure mode a guard has: the rule was not wrong, it was not
      // being applied, and it said nothing.
      // ⚠️ Both comment forms are real. The WHOLE-LINE form is what `write-path.md` uses (four of
      // them). The TRAILING form is what `docs/features/README.md`'s Format section documents —
      // `- packages/db/src/writers/ # a trailing slash owns everything beneath` — and the old parser
      // took the comment as part of the path, so rot check #1 would have failed on the comment text
      // had anyone written the documented syntax.
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) continue;
      const item = /^\s+-\s+(.+?)\s*$/.exec(line);
      if (item) {
        const entry = item[1].replace(/\s+#.*$/, '').trim();
        if (entry) owns.push(entry);
      } else if (trimmed !== '') inOwns = false;
    }
  }
  return { path, feature: feature ?? path, owns };
}

/** A path is owned by an exact match, or by a prefix entry ending in `/`. No globs — `[profileId]` in
 *  this repo's route paths makes glob escaping a footgun, and prefixes cover every real case. */
const ownsFile = (entry, file) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry);

// ── Lanes (DX-14 item 8; .claude/skills/write-spec/SKILL.md → Lanes) ────────────────────────────────
// A milestone or spec declares the lanes that run CONCURRENTLY as flat `lane-<name>:` frontmatter
// lists, in the same entry syntax as `owns:`. Two lanes of one document must not collide on a path,
// nor reach one feature guide: guides:check forces a PR touching an owned file to edit its guide, so
// two lanes under one guide still serialise. That is parallel-work.md gate 1, made mechanical.
// Whole-tree, not diff-based, so it runs before the "no changed files" exit below.
const LANE_DOC_DIRS = ['docs/milestones', 'docs/specs'];
const LANE_KEY = /^(lane-[a-z0-9-]+):\s*(.*)$/;

/** A lane entry, trailing `/` dropped, or null when it is not the plain path syntax `owns:` uses. A
 *  glob, `./`, a leading `/`, `..`, `//`, quotes or a backslash would make the collision rule
 *  inexact, so they are refused (exit 2) rather than silently compared as strings. */
function normalizeLaneEntry(entry) {
  if (/[*?"'`\\]/.test(entry) || entry.startsWith('./') || entry.startsWith('/')) return null;
  if (entry.includes('//') || entry.split('/').includes('..')) return null;
  return entry.replace(/\/$/, '');
}

/** Two normalised paths collide when equal or when one is a path-SEGMENT prefix of the other:
 *  `src/a` and `src/a/b.ts` collide, `src/a` and `src/ab.ts` don't. */
const segmentsCollide = (a, b) => a === b || b.startsWith(`${a}/`) || a.startsWith(`${b}/`);

/** The declared lanes of one document, or null when it declares none. Strict where `owns:` is
 *  lenient: inside a lane's list an unrecognised line is an error, never the end of the list —
 *  the silent truncation `parseGuide`'s comment above records cannot recur here. */
function readLanes(path) {
  const text = readFileSync(path, 'utf8');
  const errors = [];
  if (/^\uFEFF/.test(text) || text.includes('\r')) {
    // A BOM or CRLF hides the frontmatter from the regex below, which would read as "no lanes".
    return /^lane-/m.test(text)
      ? {
          path,
          lanes: new Map(),
          errors: [`${path}: BOM or CRLF line endings; lanes cannot be read`],
        }
      : null;
  }
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return null;
  const lanes = new Map();
  let current = null;
  for (const line of m[1].split('\n')) {
    if (/^\S/.test(line)) {
      // Column 0: a new top-level key, which is the only thing that ends a lane's list.
      const key = LANE_KEY.exec(line);
      current = null;
      if (!key) {
        if (/^lane/.test(line))
          errors.push(`${path}: '${line}' is not a lane key (lane-<a-z0-9->:)`);
        continue;
      }
      if (key[2].replace(/#.*$/, '').trim())
        errors.push(`${path}: ${key[1]} must be a list, not an inline value`);
      if (lanes.has(key[1])) errors.push(`${path}: ${key[1]} is declared twice`);
      current = key[1];
      lanes.set(current, []);
      continue;
    }
    if (current === null) continue;
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const item = /^\s+-\s+(.+?)\s*$/.exec(line);
    if (!item) {
      errors.push(`${path}: ${current}: unrecognised line '${trimmed}'`);
      continue;
    }
    const raw = item[1].replace(/\s+#.*$/, '').trim();
    const entry = normalizeLaneEntry(raw);
    if (entry === null)
      errors.push(`${path}: ${current}: '${raw}' is not a plain path or dir/ prefix`);
    else lanes.get(current).push(entry);
  }
  for (const [name, entries] of lanes) {
    if (entries.length === 0) errors.push(`${path}: ${name} declares no paths`);
  }
  return lanes.size === 0 && errors.length === 0 ? null : { path, lanes, errors };
}

/** The guides a lane entry reaches: it collides with one of the guide's `owns:` entries, or it IS
 *  the guide (how a lane that will ADD files names the guide it will edit). */
const guidesReached = (entry, guides) =>
  guides.filter(
    (g) => entry === g.path || g.owns.some((o) => segmentsCollide(entry, o.replace(/\/$/, ''))),
  );

function checkLanes(guides) {
  const docs = LANE_DOC_DIRS.filter((d) => existsSync(d))
    .flatMap((d) =>
      readdirSync(d)
        .filter((f) => f.endsWith('.md'))
        .map((f) => join(d, f)),
    )
    .map(readLanes)
    .filter(Boolean);
  const errors = docs.flatMap((d) => d.errors);
  // One home per milestone: a milestone and a spec of the same name can't both declare lanes.
  const byName = new Map();
  for (const d of docs) {
    const name = d.path.split('/').pop();
    if (byName.has(name))
      errors.push(`${byName.get(name)} and ${d.path} both declare lanes; keep one`);
    else byName.set(name, d.path);
  }
  if (errors.length > 0) {
    console.error('\nLanes guard: malformed lanes (exit 2):\n');
    for (const e of errors) console.error(`  • ${e}`);
    console.error('\nFormat: .claude/skills/write-spec/SKILL.md → Lanes.\n');
    process.exit(2);
  }
  const collisions = [];
  for (const { path, lanes } of docs) {
    const list = [...lanes];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [an, ae] = list[i];
        const [bn, be] = list[j];
        for (const a of ae) {
          for (const b of be) {
            if (segmentsCollide(a, b))
              collisions.push(`${path}: ${an} '${a}' and ${bn} '${b}' overlap`);
          }
        }
        const reachedBy = (entries) =>
          new Map(entries.flatMap((e) => guidesReached(e, guides).map((g) => [g.path, e])));
        const ag = reachedBy(ae);
        for (const [guide, b] of reachedBy(be)) {
          if (ag.has(guide)) {
            collisions.push(
              `${path}: ${an} '${ag.get(guide)}' and ${bn} '${b}' both reach ${guide}`,
            );
          }
        }
      }
    }
  }
  if (collisions.length > 0) {
    console.error('\nLanes guard failed: two lanes of one document would serialise.\n');
    for (const c of collisions) console.error(`  • ${c}`);
    console.error(
      '\nSplit the path or the guide, or give it to integration (which is not a declared lane):\n' +
        'docs/parallel-work.md → Gate 1.\n',
    );
    process.exit(1);
  }
  const lanes = docs.reduce((n, d) => n + d.lanes.size, 0);
  console.log(`Lanes OK — ${lanes} lane(s) in ${docs.length} document(s).`);
}

const guides = readdirSync(GUIDE_DIR)
  .filter((f) => f.endsWith('.md') && f !== 'README.md')
  .map((f) => parseGuide(join(GUIDE_DIR, f)))
  .filter(Boolean);

checkLanes(guides);

const base = process.argv[2] ?? 'origin/main';
let mergeBase;
try {
  mergeBase = git('merge-base', base, 'HEAD');
} catch {
  console.error(`Could not resolve a merge base with '${base}'. Pass one explicitly.`);
  process.exit(2);
}

// Committed changes PLUS the working tree (staged + unstaged + untracked). Without the second half
// a local run before committing reports "no changed files" and is useless — which is exactly when you
// want the answer. CI has everything committed, so the extra sources are empty there.
const changed = [
  ...new Set([
    ...git('diff', '--name-only', `${mergeBase}...HEAD`).split('\n'),
    ...git('diff', '--name-only', 'HEAD').split('\n'),
    ...git('ls-files', '--others', '--exclude-standard').split('\n'),
  ]),
].filter(Boolean);

if (changed.length === 0) {
  console.log('Feature-guide guard OK — no changed files.');
  process.exit(0);
}

const problems = [];

for (const guide of guides) {
  // Rot check #1: the map must point at files that exist. A rename or delete that skips the guide
  // leaves an entry pointing nowhere, and the guard would then silently stop covering that file.
  for (const entry of guide.owns) {
    const target = entry.endsWith('/') ? entry.slice(0, -1) : entry;
    if (!existsSync(target)) {
      problems.push(
        `${guide.path} claims to own '${entry}', which does not exist.\n` +
          `    A rename or delete must update the guide's \`owns:\` list in the same PR.`,
      );
    }
  }

  // Rot check #2: touching owned code without touching the guide.
  const touched = changed.filter((f) => guide.owns.some((e) => ownsFile(e, f)));
  if (touched.length > 0 && !changed.includes(guide.path)) {
    problems.push(
      `${guide.path} (${guide.feature}) was not updated, but this PR changes files it documents:\n` +
        touched.map((f) => `      ${f}`).join('\n'),
    );
  }
}

if (problems.length === 0) {
  console.log(`Feature-guide guard OK — ${guides.length} guide(s) consistent with the diff.`);
  process.exit(0);
}

console.error('\nFeature-guide guard failed:\n');
for (const p of problems) console.error(`  • ${p}\n`);
console.error(`These guides exist so the NEXT change to this feature costs one read instead of an
afternoon of research. That only works if they are true, so touching the code and
the guide is one action, not two.

  1. Open the guide and make it describe what you just changed — the diagram and
     the invariants, not just a changelog line.
  2. If a file moved, update the \`owns:\` list.
  3. If this change genuinely does not affect the guide (a typo, a comment), add
     the \`${SKIP_LABEL}\` label to the PR. Use it sparingly — it is visible on the
     PR, which is the point.

Convention: ${GUIDE_DIR}/README.md\n`);
process.exit(1);
