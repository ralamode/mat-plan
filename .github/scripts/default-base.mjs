/**
 * The base a LOCAL run of a PR guard compares with, when none is passed.
 *
 * CI always passes one: `resolve-pr-base.sh` prints the first parent of the merge ref, which for a
 * stacked PR (one opened against another open PR's branch) is that branch, not main. A local run used
 * to default to `origin/main`, so on a stacked branch it compared with the wrong base: the parent PR's
 * files read as this PR's own, and a guard that CI would fail passed locally (FAM-1 lane A's #448,
 * whose parent was #437).
 *
 * So, with no base given and outside CI: ask GitHub for this branch's PR base. If the PR targets a
 * branch other than main and that branch is fetched, compare with `origin/<base>`. Anything else
 * (no `gh`, no PR, offline, a PR into main) is `origin/main`, as before. Never called in CI, where
 * the base is always explicit, so a guard there never depends on `gh` or the network.
 *
 * Used by check-feature-guides.mjs and check-status-touched.mjs. Self-test: default-base.test.sh.
 */
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const FALLBACK = 'origin/main';

const run = (cmd, args) =>
  execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 10_000,
  }).trim();

/** The explicit base if one was passed, else the stacked PR's base, else `origin/main`. */
export function defaultBase(explicit) {
  if (explicit) return explicit;
  // CI always passes its base (resolve-pr-base.sh). An empty one there is a wiring fault, not a
  // reason to guess: it used to exit 2 in the guards, so it still does.
  if (process.env.GITHUB_ACTIONS) {
    console.error("No base passed in CI; the workflow must pass resolve-pr-base.sh's output.");
    process.exit(2);
  }
  let prBase = '';
  try {
    // OPEN only: `gh pr view` also returns a merged or closed PR, so a reused branch name would
    // otherwise pick up an old parent.
    prBase = run('gh', [
      'pr',
      'view',
      '--json',
      'baseRefName,state',
      '-q',
      'select(.state == "OPEN") | .baseRefName',
    ]);
  } catch {
    return FALLBACK; // no gh, no PR for this branch, or offline
  }
  if (!prBase || prBase === 'main') return FALLBACK;
  const ref = `origin/${prBase}`;
  try {
    run('git', ['rev-parse', '--verify', '--quiet', ref]);
  } catch {
    console.error(
      `(base: this PR targets '${prBase}', but ${ref} is not fetched; using ${FALLBACK})`,
    );
    return FALLBACK;
  }
  console.error(`(base: this branch is a stacked PR into '${prBase}', so comparing with ${ref})`);
  return ref;
}

// `node .github/scripts/default-base.mjs [base]` prints the base, for the bash guards
// (hold-the-bar's check.sh).
// Resolved through realpath and pathToFileURL, so a path with a space, a symlink or macOS's /tmp
// (a symlink to /private/tmp) still matches.
// When imported (or under `node -e`, where argv[1] is not a script), argv[1] may not be a path at
// all, so a failed realpath means "not run as the script".
const runAsScript = () => {
  try {
    return (
      !!process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
    );
  } catch {
    return false;
  }
};
if (runAsScript()) process.stdout.write(defaultBase(process.argv[2]));
