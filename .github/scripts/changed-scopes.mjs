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
 * - **Catalog data is not a mutation trigger** (DX-18 savings (c), docs/plans/dx-18-mutation-savings.md
 *   C1–C5): a file under `CATALOG_DATA` stops counting while `catalogReachable` proves that nothing
 *   `packages/db` runs, nor any other `@mat-plan/shared` export, reaches it. **What it gives up:** a
 *   path to the data the walk cannot see: one built at run time (a name assembled from pieces, a
 *   directory listing of a parent) rather than an import or a literal path it reads as text. The
 *   data is plain constants read only by two web DAL files no patch targets, and `main` still runs
 *   every patch on the merge, so the proof is moved to after the merge, not dropped.
 *
 * What never skips (format, lint, typecheck, tests, db:verify, gitleaks, the guards, the audit, the
 * status check) is not decided here: those steps take no flag.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { posix } from 'node:path';
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
 * The catalog's data. Pinned to `check-catalog-append-only.mjs`'s `DIR` by `changed-scopes.test.sh`:
 * CI runs this file alone, from the base (header), so it cannot import that one.
 */
export const CATALOG_DATA = 'packages/shared/src/catalog/data';
const inCatalogData = (f) => f.startsWith(`${CATALOG_DATA}/`);
/**
 * The files the exclusion covers: the data itself, `.ts` and `.json`. A `package.json` or
 * `tsconfig*.json` placed inside the directory changes resolution, so it still triggers.
 */
const isCatalogDataFile = (f) =>
  inCatalogData(f) && /\.(?:ts|json)$/.test(f) && !/\/(?:package|tsconfig[^/]*)\.json$/.test(f);

// The specifier scan and relative resolution of packages/shared/src/test-support/source-graph.ts,
// in plain JS for the same reason.
// Line comments first, and only where `//` follows a start of line, a space or punctuation (not a
// URL's `https://`): a `/*` inside a `//` comment must not swallow the code up to the next `*/`.
// What survives an unclosed `/*` stays as code, which only makes the walk see more.
const code = (text) =>
  text.replace(/(^|[\s;{}(),])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
const SPECIFIER = /\b(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g;
const specifiersOf = (text) => [...code(text).matchAll(SPECIFIER)].map(([, s]) => s);
/** The code with every import specifier blanked: what is left that names the data is a read by path. */
const withoutSpecifiers = (text) => code(text).replace(SPECIFIER, '');
const SHARED = '@mat-plan/shared';
const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/;
const TEST_FILE = /\.test\.(?:[cm]?[jt]sx?)$/;
/**
 * A code file the walk cannot follow, or that reads the data by path. Any of these answers true:
 * - a non-literal `import(…)`/`require(…)`, or `createRequire`, names a module the scan cannot read;
 * - a path to the data as text (`readFileSync(new URL('…/shipped.json', import.meta.url))`, the way
 *   the proofs read repo files). Import specifiers are blanked first (`withoutSpecifiers`): an import is the walk's to judge.
 */
const UNFOLLOWABLE =
  /\b(?:import|require)\s*\(\s*[^'"\s]|\bcreateRequire\b|\b(?:import\.meta|require)\.resolve\b/;
const READS_DATA = /catalog\/data|shipped\.json|approved\.json/;
/** Inside `catalog/`, a relative path to its `data/` directory (`'./data/batch-03.ts'`) is a read too. */
const READS_DATA_RELATIVE = /['"`](?:\.\/|(?:\.\.\/)+)data(?:[/'"`])/;
/** Either project's tsconfig remapping specifiers (`paths`, `baseUrl`) is resolution the walk lacks. */
const TSCONFIGS = ['packages/db/tsconfig.json', 'packages/shared/tsconfig.json'];

/**
 * Whether anything a mutation run executes can reach the catalog's data. The entries are every
 * `@mat-plan/shared` export except `./catalog/data`, and every non-test code file in `packages/db/`
 * (`.ts`, `.mjs`, `.js`, …; scripts included). The walk follows relative specifiers and
 * `@mat-plan/shared[/x]` through the exports map. True, so the mutations run, on: a reached data
 * file; a first-party specifier that does not resolve (`#imports` included); a reached code file the
 * walk cannot follow or that names the data by path (`UNFOLLOWABLE`, `READS_DATA`); a tsconfig with
 * `paths` or `baseUrl`; no `packages/db` files at all.
 * `io` is `{ read(path), isFile(path), listDb() }`, repo-relative; any error it throws is the
 * caller's to read as true.
 */
export function catalogReachable(io) {
  // `extends` too: a base config's `paths` would remap resolution where the walk does not look.
  if (TSCONFIGS.some((f) => /"(?:paths|baseUrl|extends)"/.test(io.read(f)))) return true;
  const exportsMap = JSON.parse(io.read('packages/shared/package.json')).exports;
  const fromExports = (target) => posix.join('packages/shared', target);
  // undefined: a third-party package, not followed. null: first-party, and it does not resolve.
  const resolve = (from, spec) => {
    if (spec.startsWith('#')) return null; // package.json `imports`: not mapped here
    if (spec.startsWith('.')) {
      const base = posix.join(posix.dirname(from), spec);
      return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(io.isFile) ?? null;
    }
    // Another workspace package (`@mat-plan/db`, …) is first-party but not mapped here: treat it as
    // unresolved, so the walk runs everything rather than skipping a path it cannot follow.
    if (spec.startsWith('@mat-plan/') && spec !== SHARED && !spec.startsWith(`${SHARED}/`))
      return null;
    if (spec !== SHARED && !spec.startsWith(`${SHARED}/`)) return undefined;
    const target = exportsMap[`.${spec.slice(SHARED.length)}`];
    return typeof target === 'string' ? fromExports(target) : null;
  };
  const dbFiles = io.listDb();
  if (dbFiles.length === 0) return true; // nothing listed proves nothing
  const entries = [
    ...Object.entries(exportsMap)
      .filter(([key]) => key !== './catalog/data')
      .map(([, target]) => fromExports(target)),
    ...dbFiles.filter((f) => CODE_FILE.test(f) && !TEST_FILE.test(f)),
  ];
  const seen = new Set();
  const stack = [...entries];
  while (stack.length > 0) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (inCatalogData(file)) return true;
    const text = io.read(file);
    if (CODE_FILE.test(file)) {
      if (UNFOLLOWABLE.test(code(text))) return true;
      const rest = withoutSpecifiers(text);
      if (READS_DATA.test(rest)) return true;
      if (file.startsWith('packages/shared/src/catalog/') && READS_DATA_RELATIVE.test(rest))
        return true;
    }
    for (const spec of specifiersOf(text)) {
      const next = resolve(file, spec);
      if (next === null) return true; // unresolved: it could be the data
      if (next !== undefined) stack.push(next);
    }
  }
  return false;
}

/**
 * The flags for one list of changed files. `patchPaths()` returns every path a mutation patch
 * touches (`mutations.mjs --list-paths`): a change to one of those runs the proof even outside the
 * packages. It is called only when no trigger already decided, so it usually does not run.
 * `catalogReaches()` says whether catalog data still triggers (`catalogReachable`); it is asked only
 * when catalog data is all that would trigger, and without it the data triggers, as it always did.
 */
export function scopesFor(files, patchPaths, catalogReaches = () => true) {
  if (files.length === 0) return { ...ALL_RUN };
  const inert = files.every((f) => INERT.some((re) => re.test(f)));
  const touchesWorkflowsOrScripts = files.some(
    (f) => f.startsWith('.github/') && !INERT.some((re) => re.test(f)),
  );
  const trigger = (f) => MUTATION_TRIGGERS.some((re) => re.test(f));
  const triggered =
    touchesWorkflowsOrScripts ||
    files.some((f) => !isCatalogDataFile(f) && trigger(f)) ||
    (files.some(isCatalogDataFile) && catalogReaches());
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
  // HEAD's tree, as the shards would see it. Any error keeps the catalog data a trigger.
  const catalogReaches = () => {
    try {
      return catalogReachable({
        read: (path) => readFileSync(path, 'utf8'),
        isFile: (path) => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false,
        listDb: () => git(['ls-files', '-z', '--', 'packages/db']).split('\0').filter(Boolean),
      });
    } catch {
      return true; // an error proves nothing: the catalog data still triggers
    }
  };
  return {
    flags: scopesFor(files, patchPaths, catalogReaches),
    why: `${files.length} changed file(s)`,
  };
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
