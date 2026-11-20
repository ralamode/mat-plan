# Tech debt — the program-tables import pins read the TypeScript import graph

> Debt row: [tech-debt.md](../tech-debt.md) → "The program-tables guard reads imports with regexes, so
> an unusual spelling slips past" (added 2026-11-18, #552 closed). Branch:
> `chore/td-program-imports-graph`. No `plan.md` row: a tech-debt payoff.

_Roadmap alignment (2026-11-20): checked against the private roadmap, `docs/plan.md` and
`docs/roadmap.md` (`git grep -in "regex\|lint check\|program-tables\|import graph" -- docs/plan.md
docs/roadmap.md` finds nothing); nothing to add here. No roadmap item moves. Gates nothing._

## Where this sits

- **Pillar:** tech debt (no feature). Release: Beta 0, which allows P0–P2 tech debt alongside its own
  items (`docs/roadmap.md:186-187`). The maintainer's sheet: row 67.
- **What this PR is:** the whole payoff, in one PR. The regex import pins in three test files become
  one guard that reads the TypeScript import graph, and that guard runs only when a change can
  affect it.
- **Order:** it comes after #767 (merged), which retired the CAT-3 `describe`. It touches no catalog
  or seed file. It gates nothing.

## Decisions on record

- Maintainer, 2026-11-18: _"Close; lint check as tech debt"._
- Maintainer, 2026-11-20, via the board, verbatim: _"Use whatever is better and only if there are
  files that were changed in that commit that match the filter. No need to lint or test things
  unchanged."_ This settles two things: the route (D1) and the scoped run (D7).

## Goal

The pins find imports by matching specifier text (`apps/web/test/program-tables-stay-dark.test.ts:194-200,303`,
`apps/web/lib/dal/day/importers.test.ts:51-71`, `apps/web/lib/dal/entries.test.ts:128-132`).
#552's security review found spellings that miss: a comment inside an import, a backtick, `require (`,
a `../node_modules` path, and an `@/` alias walking out of `apps/web` (`docs/tech-debt.md:60-72`).
This PR makes every import pin compare **resolved files**, the way the compiler resolves them, so a
spelling cannot matter. A specifier that does not resolve fails closed.

## Acceptance

- The row's fix: _"a parser-based check … (or the TypeScript import graph), so every specifier
  form, comment and alias resolves in one place. Then the regex guard's directory rules move into
  it."_
- Done when:
  - Every form in § Probes is refused, with a message naming the file, the rule and the target. A
    legitimate import passes.
  - The import pins of all three files live in one guard, `apps/web/test/program-imports.test.ts`,
    with one `ALLOWED_IN` table.
  - CI skips that guard only when the scope step says `run_import_pins=false`. Pre-push skips it
    only when the same matcher finds no changed file in scope.

## Decisions

**D1. The route: the TypeScript import graph inside vitest, not ESLint.** In the ESLint route
(round 0 of this plan), the resolver silently skipped every `@/` import when run from another cwd,
a local plugin had to re-implement normalisation, and suppressions needed a second lint pass. In
the graph route, `ts.resolveModuleName` with `apps/web/tsconfig.json`'s options is the compiler's
own answer, from an explicit `WEB_DIR` and never `process.cwd()`. A test has no inline-disable
channel, so nothing needs a suppression policy. And the scope gate (D7) is per test file, which
vitest already supports. `typescript` 5.9.3 is already an `apps/web` devDependency
(`apps/web/package.json:68`). Loading it costs about 107 ms (probed).

**D2. `importsOf(file, text?)` in `apps/web/test/source-scan.ts`.** It walks a SourceFile, not
`ts.preProcessFile`, because names, re-exports and the directive prologue are needed. The
`ScriptKind` comes from the extension (`.ts .tsx .js .jsx .mjs .cjs .mts .cts`). It returns:

```ts
type ImportRef = {
  spec: string | null; // null: computed (`import(p)`)
  resolved: string | null; // repo-relative, realpathSync.native, true case
  names: string[]; // imported names; 'default' for a default import
  kind: 'static' | 'dynamic' | 'require' | 're-export' | 'star' | 'type';
  line: number;
};
// plus: client (the prologue holds 'use client'), unfollowable[] (see below), sf
```

- **What it reads:**
  - `ImportDeclaration`; `import * as` gives the kind `star`.
  - `ExportDeclaration` with a specifier: `export *` and `export * as` give `star`; the rest give
    `re-export`.
  - `import x = require()` gives `require`.
  - `import(…)`, and `require(…)` called on the identifier `require`.
  - `typeof import('…')` gives `type`, the same reach as the old `\bimport\(` regex.
  - A string literal or a no-substitution template literal is a specifier. Anything else is
    computed.
- **Unfollowable, so refused by the AST:** `require.*` (`resolve`, `context`), `module.require`,
  `import.meta.webpackContext`, and any identifier `createRequire`, which also covers `node:module`'s
  `createRequire` in every import form.
- **Resolution:** `ts.resolveModuleName(spec, file, options, ts.sys)`, with options from
  `ts.getParsedCommandLineOfConfigFile(WEB_DIR/tsconfig.json)`, then `realpathSync.native`. One
  fallback: a relative or `@/` specifier naming an **existing non-code file** (`./globals.css`) is an
  asset, resolved by path. TypeScript does not resolve stylesheets (`app/layout.tsx`,
  `app/design/tokens/page.tsx`).
- **Fails closed:** an unresolved specifier that is first-party, meaning it starts with `.`, `@/`,
  `#` or `@mat-plan/` (case-insensitive), or normalises through `node_modules` or `packages/db`. A
  computed specifier fails closed too. A third-party specifier that does not resolve (`server-only`,
  `node:fs`) is ignored.

**D3. The pins compare resolved files, in `program-imports.test.ts`.**

| Pin (old lines)                                                                                   | Check                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web` reaches `packages/db` only through its entry (`stay-dark :158-162`, the erasure half)  | Any resolved file under `packages/db/` other than `packages/db/src/index.ts` is refused. This covers `erasure/`, `@mat-plan/./db/src/erasure/graph`, and `../node_modules/@mat-plan/db/src/…`.                                                                                                                                        |
| `packages/db/src/index.ts` does not publish `erasure/` (`:161`)                                   | `importsOf(index.ts)`: no re-export resolves into `packages/db/src/erasure/`. The old version was `/\berasure\b/` on the text.                                                                                                                                                                                                        |
| Names (`stay-dark :83-84,164-289`; `importers.test.ts :36-45,98-138`; `entries.test.ts :120-136`) | For each `static` or `re-export` ref resolving to `index.ts`, every name in `ALLOWED_IN` must be imported from a file under one of its directories.                                                                                                                                                                                   |
| No `import * as`, `export *`, `import()` of the package (`stay-dark :198-200,268-272`)            | A `star`, `dynamic`, `require` or `type` ref resolving to `index.ts` is refused everywhere, the DALs included.                                                                                                                                                                                                                        |
| Neither DAL re-exports a lane P name (`:232-243`)                                                 | In `lib/dal/program/` and `lib/dal/day/`, refuse each of: `export { x }`, `export { x as y }`, `export { x as 'y' }`; `export const v = x` after unwrapping `( )`, `as`, `satisfies`, `!` and `x.bind(…)`; `export default x`. A wrapper call is not unwrapped, so `reads.ts:38`'s `cache(async function …)` is not a false positive. |
| Only `app/programs/**/page.tsx` imports `actions` / `actions.contract` (`:290-353,395-415`)       | A ref resolving to either file, from anything other than a page there or the module trio (`actions`, `.registry`, `.contract`).                                                                                                                                                                                                       |
| Only the day page imports `row-actions` (`importers.test.ts :140-160`)                            | The same check, one row of the same `MODULES` table.                                                                                                                                                                                                                                                                                  |
| No `'use client'` file imports `@mat-plan/db` or `lib/dal/program` (`:355-378`)                   | `client` and (a ref resolving to `index.ts`, or under `packages/db/`, or under `apps/web/lib/dal/program/`).                                                                                                                                                                                                                          |

```ts
/** Each name, and where it may be imported from `@mat-plan/db`. The one home of every allowance. */
const ALLOWED_IN: Record<string, readonly string[]> = {
  ...Object.fromEntries(LANE_P.map((n) => [n, [PROGRAM_DAL]])), // read from the barrels (D4)
  workoutInHousehold: [PROGRAM_DAL, DAY_DAL], // lane P's; the day DAL's scope-miss report (12b)
  resolveDayPlan: [DAY_DAL],
  logRow: [DAY_DAL],
  untickRow: [DAY_DAL],
  retickRow: [DAY_DAL],
  prescriptionLiveIn: [DAY_DAL], // importers.test.ts's names
  readLiveSets: ['apps/web/lib/dal/entries.ts'], // #766
  insertProgramBlockOwnedBy: [],
  insertWorkoutOwnedBy: [],
  programBlockByClientId: [],
  liveTemplateBlockIn: [], // the ownership helpers: nowhere
};
```

The scan's domain is the old one: `apps/web/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}`, without
`node_modules`, `.next` and `*.test.*`. The old guard read `.ts`/`.tsx` only. One reviewed exception:
`test/action-registry.ts:44` (`await import(registryFile)`, test infrastructure) may have a
computed import.

**D4. Lane P's names come from the barrels, read by the TypeScript parser, asserted, not thrown.**
`barrelNames(file)` returns `{ names, unreadable, diagnostics }`:

- `names`: each element of an `export { … } from` (`a as b` publishes `b`; `type T` counts, as
  today, `MovementOption`).
- `unreadable`: any other top-level export (`export *`, a local `export { x }`, `export const`,
  `export function`, `export default`).
- `diagnostics`: syntactic diagnostics from `ts.transpileModule(…, { reportDiagnostics: true })`,
  which is public API.

The test asserts `unreadable` and `diagnostics` are `[]`, and that the sentinels are present
(`createProgram`, `renameProgram`, `saveWorkout`, `readWorkoutDraft`, `workoutInHousehold`). That
replaces `stay-dark :211-218,276-278`.

**D5. The alias premises are test assertions, not prose:**

- `tsconfig.json`'s `paths` deep-equals `{ '@/*': ['./*'] }`, and there is no `baseUrl`
  (`apps/web/tsconfig.json:21-23`).
- Neither `apps/web/package.json` nor `packages/db/package.json` has `"imports"`.
- `next.config.ts` has no `resolveAlias` or `alias`.

A premise that breaks fails the guard with a message saying the resolver may now disagree with the
bundler.

**D6. Messages are specific, and the tests assert them.** Each violation is
`` `${file}:${line} ${rule}: ${detail}` `` (`name saveWorkout → only apps/web/lib/dal/program/`,
`whole-package star`, `deep packages/db: packages/db/src/erasure/graph.ts`, `unresolved first-party
'./nope'`, `unfollowable require.context`). Fixture tests compare the exact rule and detail, so a
row cannot pass on an unrelated violation.

**D7. The scoped run (the maintainer's second ask).** It is a scoping, not a loosening: `main` runs
the guard on every push, and any doubt runs it.

- **The scope, one matcher**, exported from `.github/scripts/changed-scopes.mjs`:

  ```js
  export const IMPORT_PINS_SCOPE = [
    /^apps\/web\/.+\.[cm]?[jt]sx?$/, // every scanned file, the guard and source-scan.ts included
    /^apps\/web\/(tsconfig[^/]*|package)\.json$/,
    /^apps\/web\/next\.config\./,
    /^packages\/db\/package\.json$/, // `exports`, `main`: how `@mat-plan/db` resolves
    /^packages\/db\/src\/index\.ts$/,
    /^packages\/db\/src\/(?:writers|queries)\/program\/index\.ts$/, // the barrels
    /^packages\/db\/src\/erasure\//,
    /^pnpm-(?:lock|workspace)\.yaml$/, // the workspace link and the TypeScript version
    /^\.github\/scripts\/(?:changed-scopes|test-changed)\.mjs$/,
  ];
  export const importPinsInScope = (files) =>
    files.length === 0 || files.some((f) => IMPORT_PINS_SCOPE.some((re) => re.test(f)));
  ```

- **Verified against what the pins read.** The scan reads `apps/web` sources. The barrels supply
  `LANE_P`. `index.ts` is the resolution target, and its re-exports are checked. The two manifests
  and `tsconfig.json` decide resolution. `next.config` is a premise. The lockfile pins `typescript`
  and the workspace link. A file elsewhere in `packages/db` cannot change a verdict unless
  `index.ts` or an `apps/web` file changes too. **No root `tsconfig.json` exists**, and
  `apps/web/tsconfig.json` has no `extends`.
- **CI:** `scopesFor` adds `run_import_pins: touchesWorkflowsOrScripts || importPinsInScope(files)`.
  `ALL_RUN` and `scopes-step.sh`'s `all()` print it as `true`. The quality job already has its
  scopes step (`ci.yml:58-64`). The Test step (`ci.yml:417-418`) gains
  `env: RUN_IMPORT_PINS: ${{ steps.scopes.outputs.run_import_pins }}`. The scopes step runs the
  **base's** copy of the script (`scopes-step.sh:15`), so on this PR the flag is missing, and the
  guard runs.
- **The guard:** `describe.skipIf(process.env.RUN_IMPORT_PINS === 'false')`. Probed in vitest 5.1.0:
  unset, `''`, `true` and `bogus` all run; only `false` skips.
- **Pre-push:** `test-changed.mjs` imports `importPinsInScope` and drops
  `apps/web/test/program-imports.test.ts` from the scanners when it is false. The guard reads files
  with `globSync`, so it is a scanner (`test-changed.mjs:51`). A missing base fails before this,
  as today. The table-shape scanner (`program-tables-stay-dark.test.ts`) stays unscoped.
- **Polarity:** `changed-scopes.test.sh:351`'s refusal of a comparison with `true` gains
  `run_import_pins|RUN_IMPORT_PINS`.

**D8. What leaves, what stays.**

- `program-tables-stay-dark.test.ts` loses `:83-84` and `:158-415`. The privacy-docs test
  (`:380-393`) moves with them to `program-imports.test.ts`, since it is 7b-i's privacy list for
  the same pins. The file keeps the table shapes (`:24-156`).
- `lib/dal/day/importers.test.ts` is deleted (161 lines): all five of its tests are regex pins now
  in `ALLOWED_IN` and `MODULES`.
- `lib/dal/entries.test.ts` loses `:120-136`.

## Probes (pinned versions)

typescript 5.9.3, vitest 5.1.0, Node 26 locally (CI: Node 22, `ci.yml:325`). The prototype is
`.../scratchpad/probe/graph/{graph,pins,cases,v,tree}.mjs`: `importsOf` and the D3 checks, run from
the scratchpad with an explicit `WEB`.

| Form                                                                                                                                                                                     | Resolved (macOS)                                                                                      | Verdict                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `@mat-plan/db`, **`@mat-plan/./db`**, **`@mat-plan/x/../db`**, `@mat-plan//db`, `@mat-plan/db/`, **`../../node_modules/@mat-plan/db`**, **`@/../../packages/db/src`**                    | `packages/db/src/index.ts`                                                                            | names checked ✅                                         |
| **`@mat-plan/./db/src/erasure/graph`**, `../../node_modules/@mat-plan/db/src/erasure/graph`, **`@/../../packages/./db/src/erasure/graph`**                                               | `packages/db/src/erasure/graph.ts` (the dot segment gets past `exports`)                              | deep `packages/db` ✅                                    |
| `@mat-plan/db/.`, `@mat-plan/db/src/erasure/graph`                                                                                                                                       | unresolved                                                                                            | fail-closed ✅                                           |
| **`@mat-plan/DB`**                                                                                                                                                                       | `index.ts`, true case via `realpathSync.native`                                                       | names ✅ (Linux: U1)                                     |
| **backtick** static import; **comment** in braces and before the specifier; `'saveWorkout' as s`                                                                                         | `index.ts`                                                                                            | names ✅                                                 |
| **`require ('@mat-plan/db')`**, ``require(`…`)``, `import m = require(…)`; `import()` with `'…'` or `` `…` ``; `typeof import(…)`; `import * as`; `export *`                             | `index.ts`, kind `require` / `dynamic` / `type` / `star`                                              | whole-package ✅                                         |
| `import(p)`                                                                                                                                                                              | computed                                                                                              | fail-closed ✅                                           |
| **`@/../web/app/programs/actions`**, `@/./lib/../app/programs/actions.contract`, `../../app/programs/actions.ts`, `@/App/Programs/actions`                                               | the module file                                                                                       | module pin ✅                                            |
| `#internal/x`, `./nope`, `./nope.css`                                                                                                                                                    | unresolved                                                                                            | fail-closed ✅                                           |
| `require.resolve`, `require.context`, `import.meta.webpackContext`, `module.require`, `createRequire` (named, via default `mod.createRequire`)                                           | n/a                                                                                                   | unfollowable ✅                                          |
| `'use client'` first; after comments; after `'use strict'` / `"use client"` without `;`                                                                                                  | n/a                                                                                                   | client ✅                                                |
| `'use client'` after an import; `const s = 'use client'`                                                                                                                                 | n/a                                                                                                   | not client ✅                                            |
| ALLOWED_IN: day DAL `workoutInHousehold, logRow` / `+ saveWorkout`; program DAL `resolveDayPlan` or `liveTemplateBlockIn`; `lib/dal/dayx/`; `readLiveSets` outside / inside `entries.ts` | n/a                                                                                                   | clean / ✅ / ✅ / ✅ / ✅ / clean                        |
| DAL re-export: `as 'isOurs'`, `as typeof w`, `.bind(null)`, `!`, `export default`; `export const getX = cache(readWorkoutDraft)`                                                         | n/a                                                                                                   | ✅ ×5; clean                                             |
| **Real files:** `lib/dal/program/reads.ts` linted as a component; the four pages; `program-screen.tsx`                                                                                   | five lane P names refused; each page's `../…/actions.contract` resolves to the module; `client: true` | non-vacuity ✅                                           |
| **The real tree**: 256 files, the old guard's non-test domain plus the new extensions                                                                                                    | about 0.5 s                                                                                           | clean except `test/action-registry.ts:44` (D3 exception) |
| `barrelNames` on both barrels                                                                                                                                                            | 9 + 12 names                                                                                          | `unreadable` and `diagnostics` `[]`                      |
| `describe.skipIf(env === 'false')` with unset / `''` / `true` / `bogus` / `false`                                                                                                        | n/a                                                                                                   | run ×4 / skip                                            |

**Unverified:**

- U1. On Linux (CI), `@mat-plan/DB` and `@/App/…` do not resolve, so the guard fails closed by the
  first-party rule. That is reasoned from a case-sensitive filesystem, not run. The guard's own CI
  run on this PR settles it, because the fixture expects either "names" or "fail-closed" for those
  rows, and nothing else.
- U2. `ts.transpileModule`'s `diagnostics` contains the syntactic errors of a malformed barrel. A
  fixture with `export { a ` checks it in the test.

## File-by-file changes

| Path                                                          | Change | What & why                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/test/source-scan.ts`                                | EDIT   | `importsOf`, `resolveFrom`, `barrelNames` (D2, D4). About +100.                                                                                                                                                                                                                                         |
| `apps/web/test/program-imports.test.ts`                       | NEW    | `ALLOWED_IN`, `MODULES`, the D3 pins, the D5 premises, the privacy-docs test, and the fixture and real-file non-vacuity rows. About 200.                                                                                                                                                                |
| `apps/web/test/program-tables-stay-dark.test.ts`              | EDIT   | D8: about −260. The header docblock points at the new guard.                                                                                                                                                                                                                                            |
| `apps/web/lib/dal/day/importers.test.ts`                      | DELETE | D8: −161.                                                                                                                                                                                                                                                                                               |
| `apps/web/lib/dal/entries.test.ts`                            | EDIT   | D8: −17.                                                                                                                                                                                                                                                                                                |
| `.github/scripts/changed-scopes.mjs`                          | EDIT   | `IMPORT_PINS_SCOPE`, `importPinsInScope`, `run_import_pins` in `scopesFor` and `ALL_RUN`; the header lists the flag. About +20.                                                                                                                                                                         |
| `.github/scripts/scopes-step.sh`                              | EDIT   | `all()` prints `run_import_pins=true`.                                                                                                                                                                                                                                                                  |
| `.github/scripts/changed-scopes.test.sh`                      | EDIT   | Six expected-output strings gain the flag. New cases: docs-only gives `false`; an `apps/web` `.mjs`, `index.ts`, a barrel, `erasure/x.ts` and the lockfile give `true`; `packages/db/src/writers/day/x.ts` gives `false`; a push and no base give `true`. The polarity regex gains the flag. About +20. |
| `.github/scripts/test-changed.mjs`                            | EDIT   | `select()` drops the guard from the scanners when `importPinsInScope(changed)` is false. About +6.                                                                                                                                                                                                      |
| `.github/scripts/test-changed.test.sh`                        | EDIT   | Two `--dry-run` cases: a `packages/db/src/writers/day` change omits the guard; an `apps/web` change lists it. About +12.                                                                                                                                                                                |
| `.github/workflows/ci.yml`                                    | EDIT   | The Test step's `env: RUN_IMPORT_PINS` (D7).                                                                                                                                                                                                                                                            |
| `AGENTS.md`                                                   | EDIT   | "Local hooks vs CI merge-gates", the one list of where each gate runs: the guard is scoped on PRs and pre-push by `importPinsInScope`, and runs on every push to `main`. A scoping, not a loosening. About +3.                                                                                          |
| `apps/web/app/programs/actions.contract.ts`                   | EDIT   | `:23`: the comment cites `test/program-imports.test.ts`.                                                                                                                                                                                                                                                |
| `packages/db/src/queries/program/exists.ts`                   | EDIT   | `:13`: comment only (lane P's file).                                                                                                                                                                                                                                                                    |
| `packages/db/src/writers/ownership.ts`                        | EDIT   | `:578`: comment only (lane A's file). "Nothing calls them" is now held by `ALLOWED_IN`'s empty rows.                                                                                                                                                                                                    |
| `docs/privacy/data-inventory.md`                              | EDIT   | `:526-527`: "holds both" and "holds who imports the actions" now cite `program-imports.test.ts`. `:534` cites the CAT-3 `describe` that #767 retired: repointed to #767's replacement, or the cite dropped, whichever #767 left true.                                                                   |
| `docs/features/write-path.md`                                 | EDIT   | `:119` cites the new guard. Also owed by `guides:check`: `lib/dal/entries.test.ts` is its most specific owner (`write-path.md:3`).                                                                                                                                                                      |
| `docs/features/day-page.md`                                   | EDIT   | Owed by `guides:check` (`lib/dal/day/`, `day-page.md:5`): the day DAL's allowance lives in `ALLOWED_IN`.                                                                                                                                                                                                |
| `docs/features/program-builder.md`                            | EDIT   | `:371` cites the new guard (it owns `app/programs/` and `lib/dal/program/`, `:5-6`).                                                                                                                                                                                                                    |
| `docs/features/program-writers.md`                            | EDIT   | `:74`: a dated note that the seam turn's case is now an `ALLOWED_IN` row, and that the barrels keep to `export { … } from` (asserted by D4).                                                                                                                                                            |
| `docs/tech-debt.md`                                           | EDIT   | Delete the row (`:60-72`), per `:7-8`.                                                                                                                                                                                                                                                                  |
| `docs/lessons.md`                                             | EDIT   | One entry: _an import guard written as a regex meets a new spelling with each fix_ → it matches text, not the module graph → resolve with `ts.resolveModuleName` and fail closed on an unresolved first-party specifier.                                                                                |
| `docs/changelog/2026-11-20-chore-td-program-imports-graph.md` | NEW    | `### Changed`. The name follows the branch, as `status:check` requires.                                                                                                                                                                                                                                 |
| `docs/plans/td-program-tables-import-graph.md`                | NEW    | This plan.                                                                                                                                                                                                                                                                                              |

**Size, excluding this plan:** about +390 / −470 lines (code about +360 / −455, docs about +30 / −15).
The deletions are the regex pins of three files.

## Test plan

- `program-imports.test.ts`:
  1. The premises (D5).
  2. The barrel names (D4), including a malformed fixture.
  3. The tree is clean, apart from the one exception.
  4. Fixtures: every ✅ row of § Probes, each asserting its rule and detail (D6), and the clean rows.
  5. Real files: `reads.ts` read as a component; the four pages' own imports resolve to
     `actions.contract.ts`; `program-screen.tsx` is `client`; `day.ts` imports a day name and is
     clean; `entries.ts` imports `readLiveSets` and is clean.
  6. `importsOf(index.ts)` resolves nothing into `erasure/`, and a fixture `export * from
'./erasure/graph'` is refused.
- Local: `pnpm --filter web exec vitest run test/program-imports.test.ts
test/program-tables-stay-dark.test.ts`. Then `bash .github/scripts/changed-scopes.test.sh` and
  `bash .github/scripts/test-changed.test.sh`, both inside `pnpm guards:test`.
- CI: `quality` → Test (`ci.yml:417-418`), as the old pins ran. No check is required (AGENTS.md), so
  the bar is review-pr's "CI green", unchanged.

## Risks / rollback

- **R1. The resolver disagrees with the bundler.** The D5 premises fail the guard first. A
  disagreement left over (for example a Turbopack-only alias) is the residual, and it is the same as
  `tsc`'s.
- **R2. The scope misses an input.** Then a PR skips a guard it needed. `main` runs everything on
  the merge, so the miss is found at most one merge late, as for the mutations (`AGENTS.md`).
  `changed-scopes.test.sh` pins each scope entry with a case.
- **R3. A barrel changes form.** The guard fails with the barrel and the statement named. Lane P
  must know: their review is required.
- **R4. Out of the threat model, as today:** `eval`, `new Function`, `globalThis.require`, and a
  symlink inside `apps/web` (`docs/tech-debt.md:67-68`).
- **Rollback:** revert the PR. No data, schema or runtime path is touched.

## Alternatives considered and rejected

- **ESLint rules (this plan's round 0).** Superseded by D1: the resolver depended on cwd, it needed
  a local plugin and a second lint pass, and the maintainer chose "whatever is better".
- **Keep the regexes.** #552 tried, and each fix met another form.
- **`ts.preProcessFile`.** It lists specifiers, `require` included, but no names, kinds or directive.
  It would need a second walk anyway.
- **ts-morph or dependency-cruiser.** Each is a new dependency for what the installed `typescript`
  does.
- **One flag for every scanner.** It is broader than the maintainer's ask, and the other scanners
  have their own domains.

## Out-of-scope / deferred

- The table-shape scans in `program-tables-stay-dark.test.ts`.
- Other regex import scans (`use-server-exports`, `tenancy-is-not-cached`, …): only the three files
  named in D8 fold in.
- New bans beyond the old pins and the panel's findings.
- `packages/shared/src/catalog/owed.test.ts:19` and `docs/specs/cat-3-movement-library.md:224` still
  cite the retired CAT-3 `describe`. Both belong to lane A, and #767's follow-up owns them.

## Reviewers

- **Lane P:** the barrels' form (D4), `exists.ts:13`.
- **Lane B:** `app/programs/` and `lib/dal/program/` (`program-builder.md:5-6`).
- **Lanes C and E:** the day DAL rows in `ALLOWED_IN`, and `importers.test.ts`'s deletion
  (`day-page.md:5`).
- **Lane A:** `ownership.ts:578` (a comment).
- **Panel round 2:** correctness, scope, architecture, reuse, security. No migration and no UI. Privacy
  is not owed: no personal data, schema, export or third party is touched; the inventory edits are
  citations.

## Review-response log (adversarial panel)

> Panel cost: round 1, not in the relay (the lens reports were not passed to this author).
> Models: high-stakes no · per-lens models not in the relay.

**Round 1** (correctness, scope, architecture, reuse, security, on the ESLint draft). The findings
reached this author as the coordinator's summary, not as lens texts, so a finding is attributed to
"the panel" where the relay did not name its lens.

| #   | Finding (lens)                                                                                                                                                     | Verdict             | Resolution                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Take the TypeScript import graph, not ESLint (scope's resolver probe, `scratchpad/probe.cjs`; the maintainer, 2026-11-20)                                          | accepted            | D1. Re-probed: dot segments, backticks, a comment, `require (`, `@/..` and case (§ Probes).                                                                                                                            |
| 2   | Resolve from an explicit `WEB_DIR`, never cwd (correctness, `probe/tsres.cjs`)                                                                                     | accepted            | D2. The ESLint draft's cwd trap is gone.                                                                                                                                                                               |
| 3   | An unresolved first-party specifier fails closed, `#…` and paths through `packages/db` or `node_modules` included (the panel)                                      | accepted            | D2. Plus the asset fallback the tree needed (`globals.css`).                                                                                                                                                           |
| 4   | Dot-segment spellings (`@mat-plan/./db`, `@mat-plan/x/../db`) reach the package or `erasure/` past `exports` (correctness)                                         | accepted            | Probed: they resolve. D3 compares the resolved file, so they are refused or name-checked.                                                                                                                              |
| 5   | Barrel names: assert unreadable forms and parse diagnostics, do not throw (the panel)                                                                              | accepted            | D4.                                                                                                                                                                                                                    |
| 6   | Scan `.js .jsx .mjs .cjs .mts .cts` too (the panel)                                                                                                                | accepted            | D3's domain; the tree stays clean.                                                                                                                                                                                     |
| 7   | `require` and `createRequire` in all forms, `node:module`, `require.context`, `import.meta.webpackContext` (security)                                              | accepted            | D2: `require(…)` is resolved; the rest are refused by the AST.                                                                                                                                                         |
| 8   | The alias premises as assertions (architecture)                                                                                                                    | accepted            | D5.                                                                                                                                                                                                                    |
| 9   | The four re-export forms the regex caught (string-literal specifier, `as`, `.bind`, `!`), not "any identifier", or `reads.ts:38` is a false positive (correctness) | accepted            | D3 row 5. Probed both ways.                                                                                                                                                                                            |
| 10  | Page non-vacuity: the four pages' real imports resolve to the module (correctness)                                                                                 | accepted            | Test plan 5. Probed.                                                                                                                                                                                                   |
| 11  | A real-file `'use client'` check (`program-screen.tsx`) (correctness)                                                                                              | accepted            | Test plan 5. Probed.                                                                                                                                                                                                   |
| 12  | Message-specific assertions (the panel)                                                                                                                            | accepted            | D6.                                                                                                                                                                                                                    |
| 13  | One `ALLOWED_IN` table; fold in `importers.test.ts` and `entries.test.ts` only if small (reuse)                                                                    | accepted, folded    | D3, D8: seven table rows and one `MODULES` row replace 178 lines.                                                                                                                                                      |
| 14  | Repoint `data-inventory.md:520-521` (now `:526-527`), `write-path.md:118` (now `:119`), `ownership.ts:578` (the panel)                                             | accepted            | File table. `:534` added: it cites the describe #767 retired.                                                                                                                                                          |
| 15  | Correct the line cites; drop Q1; say no roadmap item moved; no extra bans (the panel)                                                                              | accepted            | Cites re-read after the merge. Q1 is gone (`lib/dal/program/` is lane B's, `program-builder.md:6`). D7 of round 0, the default-import and `createRequire` bans, is dropped. `createRequire` returns only as finding 7. |
| 16  | The local ESLint plugin; the two-pass lint and `boundaries.config`; the `package.json` lint change; `noInlineConfig`; resolver order and `basePath`                | moot: route changed | Removed with the ESLint route.                                                                                                                                                                                         |
| 17  | Scope the run to changed files (the maintainer, 2026-11-20)                                                                                                        | accepted            | D7.                                                                                                                                                                                                                    |

**Round 2:** _pending._
