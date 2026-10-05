import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { GITHUB_REPO } from '../lib/constants';

/**
 * Publish `.screenshots/*.png` so they RENDER inside a GitHub PR (chore/screenshot-publishing).
 *
 * ── Why this script exists ──────────────────────────────────────────────────────────────────────
 * AGENTS.md has required screenshots on every UI PR since V0-1b, and it has never actually worked:
 * `gh` has no image-upload path, so every "screenshots attached" claim was aspirational. This closes
 * that gap.
 *
 * ── What was measured (not assumed) ─────────────────────────────────────────────────────────────
 * Tested in a real logged-in browser against this PRIVATE repo, reading `img.naturalWidth` to prove
 * the pixels actually loaded:
 *
 *   | URL form                                  | Renders |
 *   | ----------------------------------------- | ------- |
 *   | `github.com/<o>/<r>/raw/<branch>/<path>`   | YES     |
 *   | `github.com/<o>/<r>/blob/<path>?raw=true`  | YES     |
 *   | `raw.githubusercontent.com/...`            | NO      |
 *
 * The distinction is authentication, and it is why the obvious choice fails: GitHub does NOT
 * camo-proxy these (the rendered HTML keeps the original `src`), so the viewer's browser fetches them
 * directly. `github.com` web routes accept the session cookie; `raw.githubusercontent.com` requires an
 * `Authorization` header a browser will never send — so on a private repo it 404s and you get a broken
 * image. On a PUBLIC repo all three would work, which is exactly why this trap is easy to miss.
 *
 * Also probed and rejected: there is no official asset-upload API (`repos/:o/:r/assets` → 404), and the
 * endpoint the web UI uses (`github.com/upload/policies/assets`) needs a session cookie + CSRF token,
 * returning 422 for a PAT. So GitHub's own attachment hosting is not reachable from automation.
 *
 * ── How it works ────────────────────────────────────────────────────────────────────────────────
 * Uploads each PNG to an ORPHAN branch (`screenshots`) via the Contents API — no local git surgery, no
 * worktree, and the images never touch `main`'s history or a normal clone's working tree, which keeps
 * AGENTS.md's "never commit them" intact in spirit. Files land at `pr-<n>/<name>.png`, so a PR's shots
 * are self-contained and prunable.
 *
 * Also tested and REJECTED: inlining images as base64 `data:` URIs, which would need no hosting at all.
 * GitHub strips them — the `<img>` survives with an EMPTY `src` and `data:image/png` appears nowhere in
 * the rendered HTML (sanitized server-side, a long-standing XSS/exfil defence). And even if it rendered,
 * a comment body caps at 65,536 characters while one 176KB screenshot is ~235KB of base64 — a single
 * image is ~3.6x over the limit. Two independent blockers, so hosting is unavoidable.
 *
 * Usage:
 *   pnpm --filter web screenshots:publish --pr 92                  # upload + print markdown
 *   pnpm --filter web screenshots:publish --pr 92 --comment        # …and post it as a PR comment
 *   pnpm --filter web screenshots:publish --pr 92 --only today     # filter by filename substring
 *   pnpm --filter web screenshots:publish --pr 92 --comment \
 *     --note 'Chips moved below the row so they wrap at 390px'     # REQUIRED on a re-post
 *
 * Rounds are numbered and `--note` is REQUIRED from round 2 onward: a PR that accumulates several
 * screenshot comments is unreadable without a line saying what changed. The script refuses rather than
 * letting a reviewer diff two images by eye.
 *
 * Images are pruned automatically when the PR closes — see `.github/workflows/prune-screenshots.yml`.
 */

const BRANCH = 'screenshots';
const REPO = GITHUB_REPO;
const SCREENSHOT_DIR = '.screenshots';

/** Hidden marker identifying a comment this script wrote — used to number rounds. Invisible in the
 *  rendered comment, so it costs the reader nothing. */
const MARKER = '<!-- mat-plan:screenshots -->';

/**
 * Appended to EVERY commit this script makes to `screenshots`, so no GitHub Actions workflow runs
 * against an images-only branch. `prune-screenshots.yml` appends the same marker (kept in sync by the
 * comment there, since YAML can't import this const).
 *
 * It does NOT stop Vercel — PR #100 assumed it did, and every screenshot push kept posting a failed
 * preview for two months. Vercel ignores `[skip ci]`; `VERCEL_OPT_OUT` below is what stops it.
 */
const SKIP_CI = '[skip ci]';

/**
 * Stops Vercel deploying this branch. Vercel builds every pushed branch, and this orphan has no
 * `apps/web` — the project's Root Directory — so each upload and prune failed with "The specified Root
 * Directory 'apps/web' does not exist" and emailed a failed-preview alert.
 *
 * Vercel reads `vercel.json` from the Root Directory OF THE PUSHED COMMIT, so the opt-out has to live
 * on this branch at exactly that path; a `vercel.json` on `main` never sees these pushes. Its presence
 * also makes the Root Directory exist, so even if the opt-out were ignored the failure mode would be a
 * build, not a missing-directory error.
 */
const VERCEL_OPT_OUT = {
  path: 'apps/web/vercel.json',
  content: `${JSON.stringify({ git: { deploymentEnabled: false } }, null, 2)}\n`,
} as const;

/** `gh api` with the keyring token — GH_TOKEN is a fine-grained PAT that cannot read/write everything
 *  this needs, so it is deliberately unset (see docs/runbooks.md). */
async function gh(args: string[], stdin?: string): Promise<string> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const env = { ...process.env };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  const child = promisify(execFile)('gh', args, { env, maxBuffer: 64 * 1024 * 1024 });
  if (stdin) {
    child.child.stdin?.write(stdin);
    child.child.stdin?.end();
  }
  return (await child).stdout;
}

/** Does the orphan branch exist yet? */
async function branchExists(): Promise<boolean> {
  try {
    await gh(['api', `repos/${REPO}/git/ref/heads/${BRANCH}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create `screenshots` as a TRUE ORPHAN — an empty tree and a parentless commit. Deliberately not
 * branched off `main`: it must share no history, so it can be force-reset or pruned without ever
 * touching source history, and a `git log main` never shows image churn.
 */
async function createOrphanBranch(): Promise<void> {
  console.log(`▸ creating orphan branch '${BRANCH}'…`);
  // GitHub rejects an EMPTY tree (`422 Invalid tree info`), so the branch is seeded with a README —
  // which doubles as documentation for anyone who stumbles onto the branch wondering what it is.
  const readme = [
    '# screenshots',
    '',
    'PR screenshots, hosted so they render inside GitHub PR comments.',
    '',
    '**This is an ORPHAN branch** — it shares no history with `main`, is never merged, and is not part',
    'of a normal checkout. Do not branch from it or merge it anywhere.',
    '',
    'Written by `pnpm --filter web screenshots:publish`. One directory per PR (`pr-<n>/`), so a merged',
    "PR's images can be pruned by deleting its directory.",
    '',
    'Why not `raw.githubusercontent.com`? On a private repo it needs an `Authorization` header a browser',
    "never sends, so images 404. `github.com/<owner>/<repo>/raw/...` uses the viewer's session and works.",
    '',
  ].join('\n');
  const blob = JSON.parse(
    await gh(
      ['api', '-X', 'POST', `repos/${REPO}/git/blobs`, '--input', '-'],
      JSON.stringify({ content: Buffer.from(readme).toString('base64'), encoding: 'base64' }),
    ),
  ) as { sha: string };
  const optOut = JSON.parse(
    await gh(
      ['api', '-X', 'POST', `repos/${REPO}/git/blobs`, '--input', '-'],
      JSON.stringify({ content: VERCEL_OPT_OUT.content, encoding: 'utf-8' }),
    ),
  ) as { sha: string };
  const tree = JSON.parse(
    await gh(
      ['api', '-X', 'POST', `repos/${REPO}/git/trees`, '--input', '-'],
      JSON.stringify({
        tree: [
          { path: 'README.md', mode: '100644', type: 'blob', sha: blob.sha },
          { path: VERCEL_OPT_OUT.path, mode: '100644', type: 'blob', sha: optOut.sha },
        ],
      }),
    ),
  ) as { sha: string };
  const commit = JSON.parse(
    await gh(
      ['api', '-X', 'POST', `repos/${REPO}/git/commits`, '--input', '-'],
      JSON.stringify({
        message: `chore: initialise screenshot host branch ${SKIP_CI}`,
        tree: tree.sha,
        parents: [], // parentless => a true orphan
      }),
    ),
  ) as { sha: string };
  await gh(
    ['api', '-X', 'POST', `repos/${REPO}/git/refs`, '--input', '-'],
    JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: commit.sha }),
  );
  console.log(`✓ created '${BRANCH}'`);
}

/** The existing blob sha at `path`, or undefined. Required to OVERWRITE (the Contents API rejects a
 *  create when the file already exists), so re-running after a new screenshot round just works. */
async function existingSha(path: string): Promise<string | undefined> {
  try {
    const out = await gh(['api', `repos/${REPO}/contents/${path}?ref=${BRANCH}`]);
    return (JSON.parse(out) as { sha: string }).sha;
  } catch {
    return undefined;
  }
}

/** Heal a branch created before the opt-out existed (or one someone rewrote). Runs BEFORE the first
 *  upload, so the image commits that follow are already covered. One `GET` when it is present. */
async function ensureVercelOptOut(): Promise<void> {
  if (await existingSha(VERCEL_OPT_OUT.path)) return;
  console.log(`▸ adding ${VERCEL_OPT_OUT.path} so Vercel stops deploying '${BRANCH}'…`);
  await gh(
    ['api', '-X', 'PUT', `repos/${REPO}/contents/${VERCEL_OPT_OUT.path}`, '--input', '-'],
    JSON.stringify({
      message: `chore(screenshots): opt this branch out of Vercel deployments ${SKIP_CI}`,
      content: Buffer.from(VERCEL_OPT_OUT.content).toString('base64'),
      branch: BRANCH,
    }),
  );
}

async function upload(localPath: string, remotePath: string): Promise<string> {
  const content = (await readFile(localPath)).toString('base64');
  const sha = await existingSha(remotePath);
  const body: Record<string, unknown> = {
    message: `chore(screenshots): ${remotePath} ${SKIP_CI}`,
    content,
    branch: BRANCH,
  };
  if (sha) body.sha = sha; // overwrite rather than fail on re-run
  await gh(
    ['api', '-X', 'PUT', `repos/${REPO}/contents/${remotePath}`, '--input', '-'],
    JSON.stringify(body),
  );
  // The `/raw/` form, NOT raw.githubusercontent.com — see the header note. This is the whole point.
  return `https://github.com/${REPO}/raw/${BRANCH}/${remotePath}`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const prIdx = argv.indexOf('--pr');
  const pr = prIdx >= 0 ? argv[prIdx + 1] : undefined;
  if (!pr || !/^\d+$/.test(pr)) throw new Error('--pr <number> is required');
  const onlyIdx = argv.indexOf('--only');
  const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : undefined;
  const postComment = argv.includes('--comment');
  const noteIdx = argv.indexOf('--note');
  const note = noteIdx >= 0 ? argv[noteIdx + 1] : undefined;

  const all = (await readdir(SCREENSHOT_DIR)).filter((f) => f.endsWith('.png'));
  const files = only ? all.filter((f) => f.includes(only)) : all;
  if (files.length === 0) {
    throw new Error(
      `no PNGs in ${SCREENSHOT_DIR}${only ? ` matching "${only}"` : ''} — run \`pnpm --filter web screenshot:ephemeral <route>\` first`,
    );
  }

  // Which round is this? Counted from our own marker, so a reviewer can follow the progression — and so
  // a re-post can be REQUIRED to explain itself.
  const existing = JSON.parse(
    await gh(['api', `repos/${REPO}/issues/${pr}/comments`, '--paginate']),
  ) as { body: string }[];
  const round = existing.filter((c) => c.body.includes(MARKER)).length + 1;
  if (round > 1 && !note) {
    throw new Error(
      `this is screenshot round ${round} on PR #${pr} — pass --note "<what changed>".\n` +
        'A PR with several screenshot comments is unreadable without it; a reviewer should not have to\n' +
        'diff two images by eye to work out what you changed.',
    );
  }

  if (!(await branchExists())) await createOrphanBranch();
  await ensureVercelOptOut();

  const links: { name: string; url: string }[] = [];
  for (const file of files.sort()) {
    const url = await upload(join(SCREENSHOT_DIR, file), `pr-${pr}/${file}`);
    console.log(`✓ ${file}`);
    links.push({ name: basename(file, '.png'), url });
  }

  // Round 1 renders expanded; later rounds collapse, so a stack of superseded shots doesn't bury the
  // current ones. The `--note` is the first thing a reviewer reads.
  const markdown = [
    MARKER,
    round === 1 ? '## Screenshots' : `## Screenshots — round ${round}`,
    '',
    ...(note ? [`**What changed:** ${note}`, ''] : []),
    ...links.map(
      (l) =>
        `<details${round === 1 ? ' open' : ''}><summary><code>${l.name}</code></summary>\n\n![${l.name}](${l.url})\n\n</details>`,
    ),
  ].join('\n');

  console.log(`\n${'─'.repeat(60)}\n${markdown}\n${'─'.repeat(60)}`);

  if (postComment) {
    await gh(['pr', 'comment', pr, '--body', markdown]);
    console.log(`\n✓ posted to PR #${pr}`);
  } else {
    console.log('\n(pass --comment to post this to the PR)');
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
