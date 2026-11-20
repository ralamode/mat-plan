# Tech debt — the program-tables import pins become lint rules

> Debt row: [tech-debt.md](../tech-debt.md) → "The program-tables guard reads imports with regexes, so
> an unusual spelling slips past" (added 2026-11-18, #552 closed). Branch:
> `chore/td-program-tables-lint`. No `plan.md` row: a tech-debt payoff. Maintainer, 2026-11-18:
> "Close; lint check as tech debt".

_Roadmap alignment (2026-11-20): checked against the private roadmap, `docs/plan.md` and
`docs/roadmap.md` (`git grep -in "regex\|lint check\|program-tables" -- docs/plan.md docs/roadmap.md`
finds nothing); nothing to add here. Gates nothing._

## Where this sits

- **Pillar:** tech debt (no feature). Release: Beta 0, which allows P0–P2 tech debt alongside its own
  items (`docs/roadmap.md:186-187`). The maintainer's sheet: row 67.
- **What this PR is:** the whole payoff, in one PR. The import pins in
  `apps/web/test/program-tables-stay-dark.test.ts` move to ESLint, which parses imports instead of
  matching their text. The table-shape scans stay in the test.
- **Next:** nothing is gated on it. `apps/web/lib/dal/day/importers.test.ts` has the same regex
  weakness and could move to the same machinery later (Out of scope).

## Goal

The guard finds imports by matching specifier text (`program-tables-stay-dark.test.ts:194-200,303`).
#552's security review showed that each regex fix met a new spelling: a comment inside an import, a
backtick specifier, `require (` with a space, a `../node_modules` path, or an `@/` alias walking out
of `apps/web` (`docs/tech-debt.md:60-72`). This PR moves the **import pins** to ESLint, which reads
the AST, so comments and whitespace cannot hide anything. Path pins go through the resolver
eslint-config-next already configures. The **table-shape pins** match code shapes, not imports, so
they stay a source scan.

## Acceptance

- The tech-debt row's fix, verbatim: _"a parser-based check, ESLint `no-restricted-imports` with path
  patterns per directory (or the TypeScript import graph), so every specifier form, comment and alias
  resolves in one place. Then the regex guard's directory rules move into it."_
- Done when:
  - `pnpm lint` fails on every escape form in § Probes, and on each pin's plain form.
  - `pnpm lint` passes on today's tree, with no exception beyond the one in D6.
  - An `eslint-disable` (or `/* eslint … off */`) comment does not silence a boundary rule (D5).
  - The lane P name list is read from the two barrels at lint time. There is no hand copy, and a
    barrel that publishes any other way fails lint (D3).
  - `program-tables-stay-dark.test.ts` keeps only the table-shape, step-5, catalog, privacy-docs and
    barrel-erasure checks (D8).
  - A vitest test runs the real boundary config on fixtures: every #552 form is caught, and a
    legitimate import passes (Test plan).

## Decisions

**D1. Three built-in rules and one small local plugin.** Each pin goes to the cheapest rule that sees
every form of it:

| Pin (today's lines)                                                                                | Goes to                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| (a) no `apps/web` file reaches `erasure/` (`:158-162`, the `apps/web` half)                        | `mat-plan/module-specifier`: no specifier into `packages/db` except `'@mat-plan/db'` itself. `erasure/` is not in the barrel (the barrel half stays a scan, D8), so a deep path is the only way in.                                                          |
| (b) `apps/web` calls no ownership helper (`:83-84,164-167`)                                        | core `no-restricted-imports`, `paths[{ name: '@mat-plan/db', importNames: HELPERS }]`, everywhere in `apps/web`. The four are published by `export * from './writers/ownership'` (`packages/db/src/index.ts:66`).                                            |
| (c) lane P names only in the program DAL; the day DAL only `workoutInHousehold` (`:169-289`)       | core `no-restricted-imports` with three option sets, one per scope: everywhere else, all lane P names and HELPERS; `lib/dal/day/**`, all but `workoutInHousehold`, plus HELPERS; `lib/dal/program/**`, HELPERS only.                                         |
| (c) no `import * as`, `export *` or dynamic `import()` of `@mat-plan/db` (`:198-200,268-272`)      | `no-restricted-syntax` selectors on the canonical specifier. A default import is banned too (new, D7).                                                                                                                                                       |
| (c) neither DAL re-exports a lane P name (`:232-243`)                                              | `no-restricted-syntax` in both DAL scopes: `ExportSpecifier[local.name=…]`, `ExportNamedDeclaration VariableDeclarator[init.name=…]`, `ExportDefaultDeclaration > Identifier[name=…]`. The selectors are generated from the barrels.                         |
| (d) only `app/programs/**/page.tsx` imports `actions` / `actions.contract` (`:290-353,395-430`)    | `import/no-restricted-paths`: one zone whose `from` is the two module files, in a block that `ignores` the pages, the module and its registry. Resolved, so `@/`, `./`, `../`, `@/./…/../`, an extension and a side-effect import all land on the same file. |
| (e) no `'use client'` file imports `@mat-plan/db` (or a subpath) or `lib/dal/program` (`:355-378`) | `mat-plan/client-imports` (local). A glob cannot select files by directive, so this is the one pin that needs a rule of its own.                                                                                                                             |

`no-restricted-syntax` also bans `require(…)`, `import x = require(…)` and importing `createRequire`
everywhere in `apps/web`. None of the three is in the tree today (§ Probes, tree run).

**D2. The local plugin is two rules in `apps/web/eslint/boundaries.mjs`, about 50 lines.**

- `module-specifier`: for each literal specifier (`ImportDeclaration`, `ExportNamedDeclaration`,
  `ExportAllDeclaration`, `ImportExpression`), lower-case it and `path.posix.normalize` it. Then report
  it if it contains a `node_modules` segment, or contains `packages/db`, or starts
  `@mat-plan/` + `db` without being exactly `'@mat-plan/db'` (tested on the raw text, because
  normalising turns `@mat-plan/db/.` into the canonical form). It also reports an `import()` whose
  argument is not a string literal: a template literal or a variable.
  - **Why a rule, not `no-restricted-imports` `patterns`:** the core rule does not see `import()`
    (probed: `await import('@mat-plan/db')` passes it). Its `caseSensitive: false` regex left
    `'@mat-plan/DB'` clean, because the negative lookahead that keeps the canonical spelling legal
    goes case-insensitive too (probed). On macOS a different case resolves.
  - **Why this closes the names pin:** core `no-restricted-imports` matches the specifier string, and
    the resolver resolves `'@mat-plan//db'`, `'@mat-plan/db/'`, `'@mat-plan/db/.'` and
    `'../node_modules/@mat-plan/db'` to the same `index.ts` (probed). Once this rule makes
    `'@mat-plan/db'` the only spelling that reaches the package, a name check on that one string is
    complete.
- `client-imports`: when the program's leading directives include `'use client'`
  (`ExpressionStatement.directive`, so a comment above the directive still counts), report a
  specifier that starts with `@mat-plan/db`, or that resolves to `lib/dal/program` or below. A `@/`
  specifier is resolved by `path.join(WEB, rest)` and a relative one by `path.resolve(dirname(file),
spec)`, compared case-insensitively. This is **normalisation, not resolution**, and is complete
  only because `module-specifier` has already banned `node_modules` and `packages/db` spellings and
  `tsconfig.json:21-23` has one alias and no `baseUrl` (D-risk R3).

**D3. The lane P names come from the barrels at lint time, read by the TypeScript parser.**
`publishedNames(source)` in `boundaries.mjs` reads each barrel with `ts.createSourceFile`
(`typescript` 5.9.3, already an `apps/web` devDependency, `apps/web/package.json:68`) and collects
the published name of each `export { … } from` element (`a as b` publishes `b`; `type T` is included,
as today's list includes `MovementOption`). **Any other top-level export throws** (`export *`, a
local `export { x }`, `export const`, `export function`, `export default`), so ESLint fails to load
its config and `pnpm lint` exits non-zero. That replaces today's assertions that the barrels name what
they publish (`:211-218`) and the hand-written parser's caveat (`:276-278`). `HELPERS` (four names)
and `DAY_DAL_MAY_IMPORT` move into this module and are no longer in the test, so each still has one
home.

**D4. The boundary rules are 'error'.** `pnpm lint` has no `--max-warnings` (`apps/web/package.json`
`"lint": "eslint"`), so a warning would never fail CI.

**D5. Suppressions: a second, boundary-only pass with `--no-inline-config`.** `noInlineConfig` and
`--no-inline-config` apply to every rule in a file, not to some rules. `apps/web` has one inline
directive today, `app/settings/athlete-list.tsx:224` (`react-hooks/exhaustive-deps`). So:

- `apps/web/eslint/boundaries.config.mjs` is eslint-config-next's parser, plugin and resolver blocks
  with their `rules` removed, followed by the boundary blocks. Nothing else runs in it.
- `"lint": "eslint && eslint --no-inline-config -c eslint/boundaries.config.mjs"`. Pass 1 is
  unchanged except that it now includes the boundary blocks, so editors and lint-staged show them.
  In pass 2 no directive takes effect, so a suppressed boundary violation still fails.
- **Not `linterOptions.noInlineConfig: true` in that config:** probed, it still errors but also warns
  `"… has no effect because you have 'noInlineConfig'"` on every directive in the tree, including
  athlete-list's, on every run. `reportUnusedDisableDirectives: 'off'` and
  `reportUnusedInlineConfigs: 'off'` do not stop that warning (probed). The CLI flag is silent and
  still errors (probed).
- Pass 1 keeps eslint-config-next's `reportUnusedDisableDirectives: 1` (`eslint --print-config`), and
  `hold-the-bar`'s `eslint-disable` check (`.claude/skills/hold-the-bar/check.sh:37`) still flags an
  added directive.
- `hold-the-bar`'s bar-file list (`check.sh:58-61`) gains `'apps/web/eslint/*'`, so a change to the
  boundary rules is reported as an edit to the bar.
- lint-staged (`package.json` `"apps/web/**/*.{ts,tsx}": "pnpm --filter web exec eslint --fix"`)
  stays at pass 1. Pre-commit is a courtesy; CI runs both passes.

**D6. One reviewed exception.** `test/action-registry.ts:44` uses `await import(/* @vite-ignore */
registryFile)`, a computed specifier, which is legitimate test infrastructure (`write-path.md` owns
it). A block for that one file sets `mat-plan/module-specifier: ['error', { allowComputedImport:
true }]`. That is the only option the rule takes. It is visible in config, which `hold-the-bar` now
reports.

**D7. Tighter than today, on purpose, and only where the tree already complies:**
`import db from '@mat-plan/db'` (the package has no default export) and `createRequire`. Neither
appears in `apps/web`. Nothing is loosened. The one semantic change: HELPERS was a bare-name match
anywhere (`:83-84`), and it becomes an import restriction. A local function with the same name is
not a call to the helper, and `import *`, `require` and deep paths to `ownership.ts` are all banned,
so the only way to call a helper is to import it by name. The invariant is the same.

**D8. What stays in `program-tables-stay-dark.test.ts`.** Lines 24-156 (TABLES, NEW_TABLES,
PATTERNS, the allowlists, `files`, the pattern and step-5 tests); the barrel half of `:158-162`
(`packages/db/src/index.ts` does not name `erasure`), retitled to say the app half is lint's; the
privacy-docs test (`:380-393`); and the CAT-3 catalog `describe` (`:432-463`). Deleted: `:83-84`,
`:164-167`, `:169-289`, `:290-378`, `:395-430`, and the `dirname`/`relative` imports they used. The
header docblock (`:17-22`) points at `apps/web/eslint/boundaries.mjs` for the import pins.

## Probes (pinned versions)

Versions from `node_modules/.pnpm`: eslint 9.39.5, eslint-config-next 16.4.5, eslint-plugin-import
2.32.0, eslint-import-resolver-typescript 3.10.1, eslint-import-resolver-node 0.3.10,
typescript-eslint 8.72.1, typescript 5.9.3.

**Availability, with no new dependency:** eslint-config-next registers `import` as a plugin and sets
`import/resolver` to the node resolver **first**, then the TypeScript resolver (`alwaysTryTypes`),
keyed by `require.resolve` path (`eslint-config-next/dist/index.js:117-121,160-169`). So
`import/no-restricted-paths` is usable from `apps/web/eslint.config.mjs`. Its visitor runs with
`commonjs: true` (`eslint-plugin-import/lib/rules/no-restricted-paths.js:242-244`). Neither
eslint-config-next block sets `no-restricted-imports` or `no-restricted-syntax`
(`eslint --print-config`).

**Harness:** a scratch script builds `[...nextVitals, ...nextTs (rules stripped), ...boundaries]`
through `new ESLint({ cwd: 'apps/web', overrideConfigFile: true, baseConfig })` and calls `lintText`
with a virtual `filePath` under `apps/web`. It is run **with `apps/web` as the process cwd**. The CLI
form was probed with `eslint --no-inline-config -c <cfg> --stdin --stdin-filename <path>`.

| Form (#552 escapes in bold)                                                                                                                                                                                                                                                                     | Result                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `import { saveWorkout } from '@mat-plan/db'` in a component; `as`, `type`, inline `type`, `export { } from`, `"saveWorkout" as s`                                                                                                                                                               | `no-restricted-imports` ✅                                                                                                      |
| **a comment inside the braces**, or between `from` and the specifier                                                                                                                                                                                                                            | `no-restricted-imports` ✅ (the AST has no comments in it)                                                                      |
| **backtick specifier** in a static import                                                                                                                                                                                                                                                       | **parse error** (`Module specifier must be a string literal`), so lint fails ✅. In `import()`: `module-specifier`, computed ✅ |
| **`require ('@mat-plan/db')`** with a space; `import m = require(…)`; `import { createRequire }`                                                                                                                                                                                                | `no-restricted-syntax` ✅ (also eslint-config-next's `@typescript-eslint/no-require-imports`)                                   |
| **`'../../node_modules/@mat-plan/db'`**, `'@/node_modules/…'`, `'../../NODE_MODULES/…'`                                                                                                                                                                                                         | `module-specifier` ✅                                                                                                           |
| **`'@/../../packages/db/src'`**, `'@/../../packages/./db/src'`, `'../../../../packages/db/src/erasure/graph'`                                                                                                                                                                                   | `module-specifier` ✅                                                                                                           |
| `'@mat-plan//db'`, `'@mat-plan/db/'`, `'@mat-plan/db/.'`, `'@mat-plan/DB'`, `'@mat-plan/db/src/erasure/graph'`                                                                                                                                                                                  | `module-specifier` ✅ (all but the last resolve to `index.ts`, by the node or TS resolver)                                      |
| `import * as`, `export *`, `export * as`, `await import('@mat-plan/db')`                                                                                                                                                                                                                        | `no-restricted-syntax` ✅ (core `no-restricted-imports` reports the star forms too, and **misses `import()`**)                  |
| day DAL: `workoutInHousehold` alone / with `saveWorkout`; `lib/dal/dayx/`                                                                                                                                                                                                                       | clean / ✅ / ✅                                                                                                                 |
| DAL re-export: `export { x as isOurs }`, `as "isOurs"`, `export const a = x`, `export default x`, `export { x } from`                                                                                                                                                                           | `no-restricted-syntax` ✅. A wrapper `export async function saveWorkout(…) { return w(…) }` stays clean, as today               |
| actions: `@/app/programs/actions`, `.contract`, `@/./…/../programs/actions`, **`@/../web/app/programs/actions`**, `../../app/programs/actions.ts`, side-effect, `import()`, `export { } from`                                                                                                   | `import/no-restricted-paths` ✅                                                                                                 |
| actions from `app/programs/page.tsx`, `…/workouts/new/page.tsx`; `actions.registry`; `actions-copy`                                                                                                                                                                                             | clean                                                                                                                           |
| actions from `app/programs/layout.tsx`, `app/programs/actions.form.tsx`                                                                                                                                                                                                                         | ✅                                                                                                                              |
| `'use client'`: `@mat-plan/db` (incl. `import type`), `@mat-plan/db/queries/program`, `@/lib/dal/program`, `@/lib/dal/program/reads`, `../../lib/dal/program/reads`, `@/lib/../lib/dal/…`, `@/lib/DAL/Program/…`, `export { } from`, `import()`; `"use client"` without `;`; a comment above it | `client-imports` ✅                                                                                                             |
| `'use client'`: `@/lib/dal/programs-extra`, `@mat-plan/dbx`, `../../lib/dal/day/day`; a server file importing `@/lib/dal/program/reads`                                                                                                                                                         | clean                                                                                                                           |
| `// eslint-disable-next-line no-restricted-imports`, `/* eslint-disable */`, `/* eslint no-restricted-imports: off */`                                                                                                                                                                          | pass 2 (`--no-inline-config`): still error ✅. Pass 1: suppressed, as expected                                                  |
| `publishedNames`: `export { a as b, c, type T } from`; a commented multi-line list                                                                                                                                                                                                              | `['b','c','T']`; `['a']`                                                                                                        |
| `publishedNames`: `export *`, `export * as`, `export function`, `export { x }`, `export const`, `export default`                                                                                                                                                                                | throws ✅                                                                                                                       |
| **The real tree** (395 files): pass 2                                                                                                                                                                                                                                                           | clean except `test/action-registry.ts:44` (D6). About 2.6s                                                                      |

**Resolver facts that shaped D2:** with the process cwd outside `apps/web`, the TS resolver finds no
`tsconfig.json` and **every `@/` import is unresolved and silently skipped** by
`import/no-restricted-paths`. The node resolver ignores `exports`, so `'@mat-plan/db/src/…'`
resolves through the symlink to `apps/web/node_modules/@mat-plan/db/src/…`, not to `packages/`.
`basePath` defaults to `process.cwd()`. Hence `basePath: import.meta.dirname` in the zone, the
cwd-independent string rule for `packages/db`, and the alias cases in the test.

**Unverified:**

- U1. `new ESLint({ overrideConfigFile: 'eslint/boundaries.config.mjs' })` evaluates `files` globs
  against `cwd`, as `-c` does (probed for the CLI: a config outside `apps/web` matched
  `lib/dal/day/**` with cwd `apps/web`). The test would fail visibly if it did not.
- U2. `tsc --noEmit` accepts a `.ts` test importing `./boundaries.mjs` (`allowJs: true`,
  `tsconfig.json:5`; `.mjs` is not in `include`, but it is reached by import). Probe: `pnpm
typecheck` on the branch.
- U3. `next build` (16.4.5) does not run ESLint, so the config's `typescript` import never reaches
  the build. If it does run ESLint, the config still loads. Probe: CI's build step.

## File-by-file changes

| Path                                                        | Change | What & why                                                                                                                                                                                                                                                |
| ----------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/eslint/boundaries.mjs`                            | NEW    | `publishedNames`, `LANE_P`, `HELPERS`, `DAY_DAL_MAY_IMPORT`, the local plugin (D2), the generated selectors, and `export const boundaries` (the blocks below). Each block's docblock names the pin it holds and the test that proves it. About 150 lines. |
| `apps/web/eslint/boundaries.config.mjs`                     | NEW    | Pass 2 (D5): `[...nextVitals, ...nextTs].map(({ rules, ...c }) => c)`, then `...boundaries`. About 15 lines.                                                                                                                                              |
| `apps/web/eslint/boundaries.test.ts`                        | NEW    | Test plan. About 110 lines, table-driven.                                                                                                                                                                                                                 |
| `apps/web/eslint.config.mjs`                                | EDIT   | `import { boundaries } from './eslint/boundaries.mjs'`; `...boundaries` after the existing rules block.                                                                                                                                                   |
| `apps/web/package.json`                                     | EDIT   | `"lint": "eslint && eslint --no-inline-config -c eslint/boundaries.config.mjs"`.                                                                                                                                                                          |
| `apps/web/test/program-tables-stay-dark.test.ts`            | EDIT   | D8: about 250 lines removed, the docblock repointed.                                                                                                                                                                                                      |
| `apps/web/app/programs/actions.contract.ts`                 | EDIT   | `:23` cites `eslint/boundaries.mjs` instead of the test.                                                                                                                                                                                                  |
| `packages/db/src/queries/program/exists.ts`                 | EDIT   | `:13` likewise (lane P's file; comment only).                                                                                                                                                                                                             |
| `.claude/skills/hold-the-bar/check.sh`                      | EDIT   | `:60` adds `'apps/web/eslint/*'` to the bar files.                                                                                                                                                                                                        |
| `docs/features/program-builder.md`                          | EDIT   | `:371`: the pin now lives in `apps/web/eslint/boundaries.mjs`. Required by `guides:check`, since the guide owns `app/programs/`.                                                                                                                          |
| `docs/features/program-writers.md`                          | EDIT   | `:74`: a dated note that the seam turn's case and the day-DAL allowance moved to `boundaries.mjs`, and that the barrels must keep to `export { … } from` (now a lint failure). Required, since the guide owns `queries/program/`.                         |
| `docs/tech-debt.md`                                         | EDIT   | Delete the row (`:60-72`), per the file's rule (`:7-8`). Add a short row for `importers.test.ts` (Out of scope).                                                                                                                                          |
| `docs/lessons.md`                                           | EDIT   | One entry: _an import guard written as a regex meets a new spelling with each fix_ → it matches text, not the module graph → use the parser (ESLint) and the resolver, and pin non-vacuity with fixtures.                                                 |
| `docs/changelog/2026-11-20-chore-td-program-tables-lint.md` | NEW    | `### Changed`: the import boundaries are lint rules; what each catches; the second pass.                                                                                                                                                                  |
| `docs/plans/td-program-tables-lint.md`                      | NEW    | This plan.                                                                                                                                                                                                                                                |

Estimated change, excluding this plan: about +300 / −255 lines.

The blocks in `boundaries`, in order (flat config replaces a rule's options when a later block for the
same file sets it, so each DAL block re-lists the shared selectors):

```js
const TESTS = ['**/*.test.ts', '**/*.test.tsx']; // parity: the guard skips tests
const PAGES_AND_MODULE = [
  'app/programs/**/page.tsx',
  'app/programs/actions.ts',
  'app/programs/actions.registry.ts',
  'app/programs/actions.contract.ts',
];
[
  {
    files: ['**/*.{ts,tsx}'],
    ignores: TESTS,
    plugins: { 'mat-plan': plugin },
    rules: {
      'no-restricted-imports': ['error', names([...LANE_P, ...HELPERS])],
      'no-restricted-syntax': ['error', ...SYNTAX],
      'mat-plan/module-specifier': 'error',
      'mat-plan/client-imports': 'error',
    },
  },
  {
    files: ['lib/dal/program/**'],
    ignores: TESTS,
    rules: {
      'no-restricted-imports': ['error', names(HELPERS)],
      'no-restricted-syntax': ['error', ...SYNTAX, ...REEXPORT],
    },
  },
  {
    files: ['lib/dal/day/**'],
    ignores: TESTS,
    rules: {
      'no-restricted-imports': ['error', names([...LANE_P.filter(notDay), ...HELPERS])],
      'no-restricted-syntax': ['error', ...SYNTAX, ...REEXPORT],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    ignores: [...TESTS, ...PAGES_AND_MODULE],
    rules: {
      'import/no-restricted-paths': [
        'error',
        {
          basePath: import.meta.dirname /* apps/web */,
          zones: [
            {
              target: '.',
              from: ['./app/programs/actions.ts', './app/programs/actions.contract.ts'],
            },
          ],
        },
      ],
    },
  },
  {
    files: ['test/action-registry.ts'],
    rules: {
      'mat-plan/module-specifier': ['error', { allowComputedImport: true }],
    },
  }, // D6
];
// SYNTAX: ImportExpression[source.value='@mat-plan/db'] · ImportDeclaration[source.value='@mat-plan/db'] >
//   ImportNamespaceSpecifier · … > ImportDefaultSpecifier · ExportAllDeclaration[source.value='@mat-plan/db'] ·
//   CallExpression[callee.type='Identifier'][callee.name='require'] · TSImportEqualsDeclaration ·
//   ImportSpecifier[imported.name='createRequire']
// REEXPORT: the three selectors in D1, each `name=/^(?:…LANE_P…)$/`
```

Each message says what to do instead, for example _"lane P's writers and reads are reached through
`lib/dal/program/` (AGENTS.md → DAL)"_, so a failing author is not left with only a rule id.
`import.meta.dirname` needs Node ≥ 20.11. CI sets up Node 22 (`ci.yml:325`), and the machine runs
Node 26.

## Test plan

`apps/web/eslint/boundaries.test.ts` (vitest, `environment: 'node'`, `apps/web/vitest.config.ts`;
the file matches `include: '**/*.test.{ts,tsx}'`):

1. **One ESLint instance** on pass 2's config: `new ESLint({ cwd: WEB_DIR, overrideConfigFile:
'eslint/boundaries.config.mjs', allowInlineConfig: false })`, so the test exercises exactly what CI
   runs.
2. **Caught, table-driven:** `[file, source, ruleId]` rows covering every row of § Probes marked ✅,
   one per #552 escape at least. Each asserts that **that rule** reported, not just that something
   did, so a row cannot pass on an unrelated error. The static backtick row asserts a fatal parse
   error.
3. **Passes:** the clean rows of § Probes, plus `import { db, profiles } from '@mat-plan/db'` in a
   component.
4. **Real code as fixtures (non-vacuity against today's tree):** lint the real text of
   `lib/dal/program/reads.ts` under the virtual path `components/x.tsx` and expect
   `no-restricted-imports`. Lint `app/programs/page.tsx`'s real text as `components/x.tsx` and expect
   `import/no-restricted-paths`. Then lint both at their real paths and expect clean.
5. **The name list:** `LANE_P` contains `createProgram`, `renameProgram`, `saveWorkout`,
   `readWorkoutDraft` and `workoutInHousehold` (today's sentinels, `:215-218,257`). `publishedNames`
   throws on each non-`export { } from` form.
6. **The alias is live:** the `@/app/programs/actions` row fails if the TS resolver did not find
   `tsconfig.json`, which is the cwd trap in § Probes. The test asserts `process.cwd() === WEB_DIR`
   first, with a message that says why.

The remaining `program-tables-stay-dark.test.ts` runs unchanged. Local: `pnpm --filter web exec vitest
run eslint/boundaries.test.ts test/program-tables-stay-dark.test.ts`, then `pnpm lint`. CI: `quality`
→ Lint (`ci.yml:411-412`) and Test (`ci.yml:417`).

**Where it gates:** lint runs in CI's `quality` job, the same job as today's vitest guard
(`ci.yml:28-29`). Per AGENTS.md no CI check is a required status check, so the bar is review-pr's
"CI green", as for the test today. Gate strength is unchanged; the forms it catches grow.
`pnpm verify` runs `pnpm lint` (root `package.json` `verify:run`), so both passes run there too.

## Risks / rollback

- **R1. The cwd trap.** Run with another cwd, the alias zone silently resolves nothing. `pnpm lint`
  (via `--filter web`), lint-staged (`--filter web exec`) and vitest (`--filter web`) all run in
  `apps/web`. The test asserts the cwd and holds an alias row (Test plan 6). An editor's ESLint run
  from the repo root may under-report. That is a local nuisance, not a gate.
- **R2. A barrel changes form.** If lane P writes `export function` in a barrel, lint fails at
  config load, with the barrel named in the error. This is today's assertion `:211-214`, now
  fail-closed and earlier. Lane P must know: their review is required.
- **R3. `client-imports` normalises, it does not resolve.** It is complete given D2's premises (one
  alias, no `baseUrl`, `node_modules` and `packages/db` spellings banned). A future `paths` alias in
  `tsconfig.json` would need a line here. The rule's docblock says so, and `tsconfig.json` is a bar
  file `hold-the-bar` already reports.
- **R4. Out of the threat model:** `eval`, `new Function`, `module.require`, and a symlink created
  inside `apps/web`. That is the same as today: the row's impact line is about spellings written in
  good faith (`docs/tech-debt.md:67-68`).
- **R5. Lint time:** pass 2 is about 2.6s on 395 files (probed). Pass 1 gains the resolver lookups
  of one zone.
- **Rollback:** revert the PR. The deleted test lines come back with it. No data, schema or runtime
  path is touched.

## Alternatives considered and rejected

- **Keep the regexes and patch each spelling.** #552 tried this. Each patch met another form, and
  the tech-debt row exists because of it.
- **Core `no-restricted-imports` `patterns` alone** (the row's first suggestion). It cannot see
  `import()`, it matches strings not resolved paths (so `actions` by alias, relative and `..`-walk
  needs normalising regexes again), and its case-insensitive regex could not keep the canonical
  spelling legal (probed). It does the name half, and that is where it is used.
- **`import/no-restricted-paths` for everything.** It resolves, but it has no `importNames`, so it
  cannot express "these names from this module". It cannot select `'use client'` files. And
  `'@mat-plan/db'` resolves to `apps/web/node_modules/…/index.ts` while a relative path resolves to
  `packages/…/index.ts` (probed), so path zones on the package depend on resolver order.
- **`@typescript-eslint/no-restricted-imports`.** Its one addition is `allowTypeImports`. Today's
  guard restricts type imports too (`:194`), so keeping them restricted needs nothing it adds. Not
  probed beyond its docs; it is not used.
- **A TypeScript import graph via ts-morph, or dependency-cruiser.** Each is a new dependency
  (AGENTS.md and SECURITY.md supply-chain review, the audit gate) for what the installed ESLint
  stack does. dependency-cruiser would also be a second config language for the same rules.
- **`linterOptions.noInlineConfig` for all of `apps/web`.** It would forbid the one legitimate
  `react-hooks` directive and every future one, a policy change this row did not ask for (D5).
- **Read the barrels with a regex in the config.** That is the hand parser this PR retires. The
  TypeScript parser is already installed.

## Out-of-scope / deferred

- `apps/web/lib/dal/day/importers.test.ts` (lanes C and E): the same regex shape for the day DAL's
  names and the row-actions importer. The `boundaries` machinery would hold it in about 20 lines. It
  is a separate pin with separate owners, so it gets a one-line tech-debt row in this PR, not a
  rewrite.
- The table-shape scans (D8) and the catalog `describe`, which retires at CAT-3 P11-ii-b.
- Widening `client-imports` to all of `lib/dal/` or `server-only` modules: parity only.
- A boundary-only lint-staged pass (D5).

## Open questions

- Q1 (lane P, lane B): the program DAL's owner. The brief names lane P;
  `docs/features/program-builder.md:6` lists `apps/web/lib/dal/program/` under lane B's guide. Both
  are asked to review. Either way, nothing in this plan depends on the answer.

## Reviewers

- **Lane P** — the barrels' form is now a lint precondition (D3, R2), plus `exists.ts:13`.
- **Lane B** — `app/programs/` and `lib/dal/program/` (`program-builder.md:5-6`).
- **Lanes C and E** — the day DAL's one-name allowance (`lib/dal/day/`, `day-page.md:5`).
- **Panel:** correctness, simplicity & scope, architecture & consistency, code reuse, plus
  **security** (the debt came from #552's security review). No migration, no UI, so no DB-safety or
  UX lens. Privacy: no personal data, schema, export or third party is touched; the lens is not owed.

## Review-response log (adversarial panel)

> Panel cost: _pending_
> Models: high-stakes no · _pending_

_Pending: the panel has not run._
