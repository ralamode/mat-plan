#!/usr/bin/env node
/**
 * Which heavy CI steps a pull request needs (DX-18 D7; plan: docs/plans/dx-18-heavy-runs-to-ci.md).
 *
 * Prints three flags, `run_mutations`, `run_build` and `run_e2e`, as `key=value` lines, and appends
 * them to `$GITHUB_OUTPUT` when that is set.
 *
 * - **Polarity:** every flag says RUN, and a workflow skips a step only on a literal `'false'`
 *   (`if: steps.scopes.outputs.run_e2e != 'false'`). A missing, empty or mistyped output runs.
 *   `changed-scopes.test.sh` fails if any workflow compares a scope with `== 'true'`.
 * - **Fail-safe:** any event other than `pull_request`, an unreadable base, a script error or an
 *   empty diff sets every flag to `true`.
 * - **Inputs:** `GITHUB_EVENT_NAME`; `BASE_SHA` (from `resolve-pr-base.sh`); the changed files are
 *   `git diff --name-only --no-renames -z <base> HEAD`, so a move counts its source path too.
 * - **The base's copy decides:** CI runs this file as `git show <base>:.github/scripts/changed-scopes.mjs`,
 *   so a PR cannot reclassify itself. The PR's own copy is exercised by its test. This catches
 *   mistakes, not a hostile author (the residual SECURITY.md accepts for the pin checker).
 *
 * What never skips (format, lint, typecheck, tests, db:verify, gitleaks, the guards, the audit, the
 * status check) is not decided here: those steps take no flag.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Files that cannot change what the app builds or what the smoke sees. Formerly the e2e job's
 * `INERT` list (ci-e2e-auto-skip.md); defined here, once. An image is inert only under `docs/` or
 * `.github/`: one under `apps/web/` is app content.
 */
export const INERT = [
  /^docs\//, // all docs (plans, lessons, ADRs)
  /^[^/]+\.md$/, // root-level markdown (README, AGENTS, …)
  /^\.claude\//, // agent tooling: skills, settings
  /^\.github\/(ISSUE_TEMPLATE|PULL_REQUEST_TEMPLATE)/,
  /^\.github\/SECURITY\.md$/,
  /^LICENSE$/,
  /^\.github\/.*\.(png|jpe?g|gif|svg|webp|ico)$/i, // images in docs/ are covered by docs/ above
];

/** A change here can alter what a mutation patch applies to, or what runs the gate. */
const MUTATION_TRIGGERS = [
  /^packages\/db\//,
  /^packages\/shared\//,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /(^|\/)package\.json$/,
  /(^|\/)tsconfig[^/]*\.json$/,
  /^\.github\//,
];

const ALL_RUN = { run_mutations: true, run_build: true, run_e2e: true };

/**
 * The flags for one list of changed files. `patchPaths()` returns every path a mutation patch
 * touches (`mutations.mjs --list-paths`): a change to one of those runs the proof even outside the
 * packages. It is called only when no trigger already decided, so it usually does not run.
 */
export function scopesFor(files, patchPaths) {
  if (files.length === 0) return { ...ALL_RUN };
  const inert = files.every((f) => INERT.some((re) => re.test(f)));
  const touchesWorkflowsOrScripts = files.some(
    (f) => f.startsWith('.github/') && !INERT.some((re) => re.test(f)),
  );
  const triggered =
    touchesWorkflowsOrScripts || files.some((f) => MUTATION_TRIGGERS.some((re) => re.test(f)));
  const mutations =
    triggered ||
    (() => {
      const paths = patchPaths();
      return files.some((f) => paths.has(f));
    })();
  return {
    run_mutations: mutations,
    run_build: touchesWorkflowsOrScripts || !inert,
    run_e2e: touchesWorkflowsOrScripts || !inert,
  };
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function decide() {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') {
    return { flags: { ...ALL_RUN }, why: `event ${process.env.GITHUB_EVENT_NAME || '(none)'}` };
  }
  const base = process.env.BASE_SHA ?? '';
  if (!/^[0-9a-f]{40}$/.test(base)) return { flags: { ...ALL_RUN }, why: 'no base SHA' };
  const files = git(['diff', '--name-only', '--no-renames', '-z', base, 'HEAD'])
    .split('\0')
    .filter(Boolean);
  // HEAD's patches, listed by HEAD's runner: they are what the shards would apply. That is the PR's
  // own code, so it gets no GITHUB_OUTPUT to write to and a minute to answer. Any change to the
  // runner is under packages/db/ and already triggered the shards, so this runs only on a PR that
  // left it untouched.
  const patchPaths = () =>
    new Set(
      execFileSync('node', ['packages/db/scripts/mutations.mjs', '--list-paths'], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: '' },
        timeout: 60_000,
      })
        .split('\n')
        .filter(Boolean),
    );
  return { flags: scopesFor(files, patchPaths), why: `${files.length} changed file(s)` };
}

function main() {
  let result;
  try {
    result = decide();
  } catch (error) {
    result = {
      flags: { ...ALL_RUN },
      why: `error: ${String(error?.message ?? error).split('\n')[0]}`,
    };
  }
  const lines = Object.entries(result.flags).map(([k, v]) => `${k}=${v}`);
  console.log(lines.join('\n'));
  console.error(`changed-scopes: ${result.why}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
}

// Run when executed, not when imported: compared by real path, because the copy CI runs sits in
// $RUNNER_TEMP and a symlinked temp dir would otherwise never match.
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
)
  main();
