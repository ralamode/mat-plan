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
      const item = /^\s+-\s+(.+?)\s*$/.exec(line);
      if (item) owns.push(item[1]);
      else if (line.trim() !== '') inOwns = false;
    }
  }
  return { path, feature: feature ?? path, owns };
}

/** A path is owned by an exact match, or by a prefix entry ending in `/`. No globs — `[profileId]` in
 *  this repo's route paths makes glob escaping a footgun, and prefixes cover every real case. */
const ownsFile = (entry, file) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry);

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

const guides = readdirSync(GUIDE_DIR)
  .filter((f) => f.endsWith('.md') && f !== 'README.md')
  .map((f) => parseGuide(join(GUIDE_DIR, f)))
  .filter(Boolean);

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
