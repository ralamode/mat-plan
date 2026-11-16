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
  if (process.env.GITHUB_ACTIONS) return FALLBACK;
  let prBase = '';
  try {
    prBase = run('gh', ['pr', 'view', '--json', 'baseRefName', '-q', '.baseRefName']);
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
