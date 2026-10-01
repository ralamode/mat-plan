#!/usr/bin/env node
/**
 * Action-pin guard (SEC-2): every `uses:` in a workflow is pinned to a full commit SHA with a bare
 * `# vX.Y.Z` comment. A tag can be moved by whoever controls it; a SHA can't. The rule and its
 * reasoning live in .github/SECURITY.md → "Supply chain"; plan: docs/plans/sec-2-pin-actions.md.
 *
 * Offline (every run): the ref is `owner/repo[/path]@<40 lowercase hex>` and the rest of the line is
 * exactly `# vX.Y.Z`. Nothing may follow the version: Dependabot rewrites the comment only when it
 * ENDS with the version (dependabot-core version_commenter.rb), so trailing prose would go stale.
 * A local `./` action fails too (its own `uses:` lines are not scanned), except a local reusable
 * workflow under `./.github/workflows/`, which this scan already covers.
 *
 * `--resolve` (CI, on push to main and on PRs touching workflows): each pin must EQUAL the commit its
 * version tag points to in the canonical repo. A SHA that merely exists proves nothing: a fork's
 * commit is reachable through the parent's path (the "imposter commit"). Only a 200 is compared;
 * anything else fails, so a check that couldn't check never passes.
 *
 * Fails closed on shape: any line that MENTIONS a `uses:` key (outside a comment) but isn't the one
 * accepted form fails, so a value on the next line, a flow mapping (`- {uses: x@v1}`) or a quoting
 * trick can't slip past the strict regex. CRLF files are read line by line like LF ones.
 *
 * Usage:
 *   node .github/scripts/check-action-pins.mjs [--resolve] [dir]   # default: <repo>/.github/workflows
 * Exit: 0 ok · 1 a bad pin · 2 usage/IO error, nothing scanned, or the GitHub API unreachable
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RULE =
  'pin to a full commit SHA with a bare "# vX.Y.Z" comment (.github/SECURITY.md → "Supply chain")';
const USES = /^\s*(?:-\s+)?["']?uses["']?\s*:\s*["']?([^\s"'#]+)["']?(.*)$/;
// Owner, repo, then an optional path whose segments may not be `.` or `..`.
const REMOTE = /^[A-Za-z0-9][\w.-]*\/[\w.-]+(?:\/(?!\.\.?(?:\/|@))[\w.-]+)*@[0-9a-f]{40}$/;
const VERSION = /^\s+#\s*(v\d+\.\d+\.\d+)\s*$/; // a full vX.Y.Z: a bare major tag moves
const MENTIONS_USES = /(?:^|[\s{,?-])["']?uses["']?\s*:/;
const COMMENT = /(?:^|\s)#.*$/;
const LOCAL_WORKFLOW = /^\.\/\.github\/workflows\/[\w.-]+\.ya?ml$/;

const args = process.argv.slice(2);
const resolve = args.includes('--resolve');
const rest = args.filter((a) => a !== '--resolve');
if (rest.length > 1 || rest.some((a) => a.startsWith('-'))) {
  console.error('usage: check-action-pins.mjs [--resolve] [dir]');
  process.exit(2);
}
const dir = rest[0] ?? fileURLToPath(new URL('../workflows', import.meta.url));

let files;
try {
  files = readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f));
} catch (e) {
  console.error(`check-action-pins: cannot read ${dir}: ${e.message}`);
  process.exit(2);
}
if (files.length === 0) {
  console.error(
    `check-action-pins: no workflow files in ${dir}; a guard that checked nothing must not pass`,
  );
  process.exit(2);
}

const bad = [];
const pins = []; // { where, repo, sha, version }
for (const f of files.sort()) {
  const path = join(dir, f);
  const rel = relative(process.cwd(), path);
  const where0 = rel && !rel.startsWith('..') ? rel : path;
  readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .forEach((line, i) => {
      const where = `${where0}:${i + 1}`;
      const m = USES.exec(line);
      if (!m) {
        if (MENTIONS_USES.test(line.replace(COMMENT, '')))
          bad.push(
            `${where}  ${line.trim()}  — write \`uses: owner/repo@<sha> # vX.Y.Z\` on one line`,
          );
        return;
      }
      const [, ref, after] = m;
      if (ref.startsWith('./')) {
        if (!LOCAL_WORKFLOW.test(ref))
          bad.push(
            `${where}  ${ref}  — a local action's own uses: lines are not scanned; extend this guard and Dependabot's directories: first`,
          );
        else pins.push(null);
        return;
      }
      const v = VERSION.exec(after);
      if (!REMOTE.test(ref) || !v) return bad.push(`${where}  ${ref}${after.trimEnd()}  — ${RULE}`);
      const [name, sha] = ref.split('@');
      pins.push({ where, repo: name.split('/').slice(0, 2).join('/'), sha, version: v[1] });
    });
}

if (pins.length + bad.length === 0) {
  console.error(
    `check-action-pins: no uses: found in ${dir}; a guard that checked nothing must not pass`,
  );
  process.exit(2);
}
if (bad.length) {
  console.error(`✗ ${bad.length} action ref(s) not pinned:\n  ${bad.join('\n  ')}`);
  process.exit(1);
}

if (resolve) {
  const remote = pins.filter(Boolean);
  const cache = new Map();
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'mat-plan-check-action-pins',
  };
  if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;

  // → { sha } | { missing: true } | { error: string }
  async function tagCommit(repo, version) {
    const url = `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(version)}`;
    let last = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
        if (res.status === 200) {
          const sha = (await res.json()).sha;
          return /^[0-9a-f]{40}$/.test(sha ?? '')
            ? { sha }
            : { error: 'a 200 without a valid sha' };
        }
        if (res.status === 404 || res.status === 422) return { missing: true }; // 422: GitHub's unknown-ref answer
        last = `HTTP ${res.status}`;
        if (res.status < 500) break; // 401/403/429 and the rest: retrying won't help
      } catch (e) {
        last = e.message;
      }
    }
    return { error: last };
  }

  const wrong = [];
  for (const p of remote) {
    const key = `${p.repo}@${p.version}`;
    if (!cache.has(key)) cache.set(key, await tagCommit(p.repo, p.version));
    const r = cache.get(key);
    if (r.error) {
      console.error(
        `check-action-pins: GitHub API lookup failed for ${key} (${r.error}); not a verdict on the pin. Re-run the job, or check GH_TOKEN.`,
      );
      process.exit(2);
    }
    if (r.missing) wrong.push(`${p.where}  tag ${p.version} not found in ${p.repo}`);
    else if (r.sha !== p.sha)
      wrong.push(`${p.where}  pin ${p.sha} is not ${p.repo}@${p.version}'s commit (${r.sha})`);
  }
  if (wrong.length) {
    console.error(
      `✗ ${wrong.length} pin(s) don't match their version tag:\n  ${wrong.join('\n  ')}`,
    );
    process.exit(1);
  }
  console.log(
    `Action pins OK — ${remote.length} pin(s) in ${files.length} file(s), each resolved against its tag (${cache.size} lookup(s)).`,
  );
} else {
  console.log(
    `Action pins OK — ${pins.length} ref(s) in ${files.length} file(s) pinned to a SHA with a version comment.`,
  );
}
