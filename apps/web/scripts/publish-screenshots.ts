import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

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
 * Usage:
 *   pnpm --filter web screenshots:publish --pr 92                  # upload + print markdown
 *   pnpm --filter web screenshots:publish --pr 92 --comment        # …and post it as a PR comment
 *   pnpm --filter web screenshots:publish --pr 92 --only today     # filter by filename substring
 */

const BRANCH = 'screenshots';
const REPO = 'ralamode/mat-plan';
const SCREENSHOT_DIR = '.screenshots';

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
  const tree = JSON.parse(
    await gh(
      ['api', '-X', 'POST', `repos/${REPO}/git/trees`, '--input', '-'],
      JSON.stringify({
        tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: blob.sha }],
      }),
    ),
  ) as { sha: string };
  const commit = JSON.parse(
    await gh(
      ['api', '-X', 'POST', `repos/${REPO}/git/commits`, '--input', '-'],
      JSON.stringify({
        message: 'chore: initialise screenshot host branch',
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

async function upload(localPath: string, remotePath: string): Promise<string> {
  const content = (await readFile(localPath)).toString('base64');
  const sha = await existingSha(remotePath);
  const body: Record<string, unknown> = {
    message: `chore(screenshots): ${remotePath}`,
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

  const all = (await readdir(SCREENSHOT_DIR)).filter((f) => f.endsWith('.png'));
  const files = only ? all.filter((f) => f.includes(only)) : all;
  if (files.length === 0) {
    throw new Error(
      `no PNGs in ${SCREENSHOT_DIR}${only ? ` matching "${only}"` : ''} — run \`pnpm --filter web screenshot:ephemeral <route>\` first`,
    );
  }

  if (!(await branchExists())) await createOrphanBranch();

  const links: { name: string; url: string }[] = [];
  for (const file of files.sort()) {
    const url = await upload(join(SCREENSHOT_DIR, file), `pr-${pr}/${file}`);
    console.log(`✓ ${file}`);
    links.push({ name: basename(file, '.png'), url });
  }

  // Group by viewport so the comment reads as one row per screen, not a wall of images.
  const markdown = [
    '## Screenshots',
    '',
    ...links.map(
      (l) =>
        `<details open><summary><code>${l.name}</code></summary>\n\n![${l.name}](${l.url})\n\n</details>`,
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
