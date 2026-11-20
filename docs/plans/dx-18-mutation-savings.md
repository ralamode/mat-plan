# DX-18 — catalog batches and runbook edits stop running all 470 mutation patches

> **Status: draft, revised after a five-lens panel (2026-11-19); maintainer decisions owed (§ Open
> questions).** Backlog: [plan.md](../plan.md) → `DX-18`. Branch: `docs/dx-18-mutation-savings-plan`
> (this plan), then one branch per PR below.

## Where this sits

- **Pillar:** Platform (CI, hooks, agent tooling). **Track:** DX-18, heavy runs on GitHub CI. This is
  the follow-up to its PR 2 ([dx-18-heavy-runs-to-ci.md](./dx-18-heavy-runs-to-ci.md) D6 and D7),
  which put the mutation proof in CI. It shortens the queue every Beta 0 lane waits in.
- **This plan:** two of the three savings the maintainer named on 2026-11-19, (c) then a narrow (b).
  The third, (a), is designed but deferred (§ Deferred) until the maintainer answers Q-a.
- **Gated on:** the maintainer's answers to the open questions. PR 2 also waits for PR 1's measured
  relief and the U7 probe. If PR 1 is enough, PR 2 is not built.

_Roadmap alignment (2026-11-19): advances `DX-18`. It does not touch `ID-1` or the household scope.
(c) depends on CAT-3's file layout (`packages/shared/src/catalog/data/`), and its saving ends when
CAT-3's data phase ends. Neither PR changes what runs on `main`, so D6 and Q1 of
dx-18-heavy-runs-to-ci.md stand. Checked against the private roadmap; nothing to add here._

## Goal

Stop running all 470 patches on a PR that cannot change any patch's result, and never skip a patch
that could. Two kinds of PR do this today:

- **A catalog batch** touches only `packages/shared/src/catalog/data/`, which no patch, proof or seed
  reads. It runs all 470 patches anyway.
- **A runbook edit** touches `docs/runbooks.md`, the target of one patch (200). It runs all 470.

## The savings, in the maintainer's words (2026-11-19)

- **(a) "Main skips what its PR proved".** A push to main whose squashed tree equals a PR head that
  already passed the full proof skips main's mutation run. Anything else (a stale or behind merge, an
  admin merge, a direct push) still runs in full. → **Deferred** (§ Deferred).
- **(b) "Run only affected patches on PRs".** A PR runs only the patches whose target paths it touched
  (the `mutations.mjs --list-paths` map), not all 470. Main still runs all, except under (a). → **PR 2,
  narrow form** (B1).
- **(c) "Catalog data doesn't trigger mutations".** Catalog batch files in packages/shared stop being a
  blanket trigger unless a patch targets them. → **PR 1**.

The maintainer's safety follow-up, the same day, added two rulings:

1. **Under (a)**, main skips only the patches the PR ran green on the identical tree. It runs the
   complement, and everything when the tree differs. A skipped or cancelled shard is never a proof.
2. **Under (b)**, "affected" includes the proof side. A change to the proofs, the harness, the schema,
   the migrations, the seed, the runner or the patches runs all.

## Hard constraints, honoured throughout

- **H1, never silently skip.** A job skips only on a literal `'false'`. A missing or failed decision
  runs. The rule is in `changed-scopes.mjs:8-10`, its scan in `changed-scopes.test.sh:117-121`, and the
  job's use in `ci.yml:676`.
- **H2, fail-safe.** Any doubt runs everything: an unreadable listing, a git error, an unresolved
  import, a malformed line.
- **H3, the base's copy decides.** `scopes-step.sh:15` runs the base's `changed-scopes.mjs` from
  `$RUNNER_TEMP`, so a PR cannot reclassify itself. That copy is **one file**, so the decider imports
  no sibling module and no `mutations.mjs` (R3).
- **H4, say what each saving gives up.** See the table below.
- **H5, a mutation-style self-test per saving.** See § Test plan.

## What is true today (origin/main `c90f1afc`)

- **The trigger.** `run_mutations` is true when any changed file matches `MUTATION_TRIGGERS`
  (`changed-scopes.mjs:42-50`), which includes all of `packages/db/` and `packages/shared/`
  (`:43-44`), or is under a non-inert `.github/` path (`:62-66`). It is also true when any file is a
  patch target per `--list-paths` (`:67-72`, `:97-106`).
- **The runner.**
  - `--list-paths` prints only the union of target paths (`mutations.mjs:400-404`).
  - `--list` prints the selection and runs nothing (`:415-418`).
  - An empty selection exits 1 (`:427-434`).
  - A shard writes `--report` only when every patch it ran went RED (`:577-587`).
  - `--verify-reports` checks the reports against `allPatches()` (`:366-396`).
  - The file ends in an unguarded `await main()` (`:591`), so importing it runs it.
- **The jobs.**
  - `mutations-plan` writes the shard list once (`ci.yml:669-671`).
  - `mutations-total` requires that the plan and the shards ended in `success` (`:729-737`), then the
    report check (`:746-748`).
- **The patch map** (read-only, `git apply --numstat` per patch): 470 patches, 71 target files.
  - **Outside `packages/db/`:** `docs/runbooks.md` (patch 200; `verify/schema.ts:2315` reads it),
    `apps/web/lib/dal/entries.ts` (patch 03), and four files under `packages/shared/src/` (one patch
    each).
  - **Cross-file risk:** 60 of the 71 targets, carrying 420 patches (89%), are imported by other
    files. That is why (b) stays narrow (B1) instead of matching single files inside the packages.
- **The catalog's data** is `packages/shared/src/catalog/data/` (`batch-NN.ts`, `index.ts`,
  `shipped.json`, `approved.json`). `check-catalog-append-only.mjs:26` names it as `DIR`.
  - **No patch targets it.**
  - **Its non-test importers** are `apps/web/lib/dal/day/day.ts:4` and
    `apps/web/lib/dal/program/picker.ts:14`. Neither is a patch target.
  - **`packages/db` never imports it.** It imports `@mat-plan/shared`, `/catalog/fixture`
    (`verify/day-plan.ts:43`), `/csv`, `/program/fixtures` and `/program/prescribed-text`. The seed
    imports only the root barrel (`src/seed.ts:1-27`).
  - **The barrel never reaches the data**, and a CI test proves it (`catalog.test.ts:534-538`).

### Measured: the last 150 first-parent commits on `main`

Each commit's final diff stands in for its PR (read-only replay).

| Rule               | Commits that run patches | Patch-runs          | Ran all |
| ------------------ | ------------------------ | ------------------- | ------- |
| Today              | 82 of 150                | 38,540              | 82      |
| + (c)              | 73                       | 34,310 (−11.0%)     | 73      |
| + (c) + narrow (b) | 73                       | **30,558 (−20.7%)** | 65      |

- **68 commits** trigger nothing today. They are unchanged by this plan.
- **(c)** removes 9 commits: catalog batches 1–14 and correction batch 6.
- **Narrow (b)** turns 8 commits from 470 patches into 1. **All 8 touched `docs/runbooks.md`** and
  nothing else that triggers. No commit in the sample reached `entries.ts` alone.
- _Unverified per run (U7):_ these numbers count merged diffs, not the 62 PR runs of 2026-11-19, and
  they assume shard time scales with patch count.

## Decisions

### (c) Catalog data stops being a blanket trigger (PR 1)

**C1. An exclusion inside the trigger match.** `scopesFor` (`changed-scopes.mjs:59-78`) tests
`MUTATION_TRIGGERS` against every changed file except those under `CATALOG_DATA`, and only while C2
holds. The patch-target branch (`:67-72`) still sees every file, so a future patch on catalog data
still triggers with no extra rule. `run_build` and `run_e2e` are untouched: D7 kept build and e2e for
batch files (dx-18-heavy-runs-to-ci.md:261-262), and that stands.

**C2. The importer check, strict.** This is a walk of about 25 lines in `changed-scopes.mjs`. It uses
`source-graph.ts`'s specifier regex and relative resolution (`test-support/source-graph.ts:14-40`),
ported to plain JS because the base copy is one file (H3).

- **Entries:**
  - every `@mat-plan/shared` `exports` target except `./catalog/data` (`packages/shared/package.json:8-15`);
  - every non-test `.ts`/`.tsx` file under `packages/db/`.
- **The walk:** follow relative specifiers and `@mat-plan/shared[/x]` through the exports map.
- **Fails, and keeps catalog files in the change set (so all patches run),** if a reached file is under
  `CATALOG_DATA`, or a first-party specifier does not resolve.
- **Why a walk, not a grep:** a `fixture.ts` that gains `import './data/batch-01'` reaches the data
  from `verify/day-plan.ts:43`. A grep for `catalog/data` would not see it.

**C3. One home for the path.** `CATALOG_DATA` is a constant in `changed-scopes.mjs`. A contract test
pins it to `check-catalog-append-only.mjs`'s `DIR` (`:26`), so the two cannot drift. The scopes file
cannot import it (H3).

**C4. What a catalog-only PR gets.** `run_mutations=false`: no shards on the PR. Main still runs all
470 on the merge, so the proof is moved, not dropped.

**C5. Horizon.** The saving is one PR run of each catalog batch (9 of 150 commits). It ends with
CAT-3's data phase. That is why it ships first and alone.

### (b) Narrow: only patches whose target file was touched (PR 2)

**B1. The rule, in order. It only narrows:**

1. Compute today's `run_mutations`, with (c). If it is false, it stays false.
2. If any changed file falls under one of the following, run **all**:
   - `packages/db/**`, which covers the proofs, the harness, the schema, the migrations, the seed, the
     runner and the patches (ruling 2);
   - non-catalog `packages/shared/**`;
   - a non-inert `.github/**` path, exactly today's rule (`:62-66`) and not a second copy of it;
   - `pnpm-lock.yaml` or `pnpm-workspace.yaml`;
   - any `package.json` or `tsconfig*.json`.
3. Otherwise, run the patches with a target file among the changed files, from a per-patch target
   listing (B2). Today that can only mean `docs/runbooks.md` (patch 200) or
   `apps/web/lib/dal/entries.ts` (patch 03).

There is **no import graph and no resolver**. Inside the packages, step 2 runs all, which covers
deleted, renamed and sibling edges. Outside them, only those two files are targets.

**B2. Fail-safe inputs.**

- **A new runner mode, `--list-targets`,** prints one `<patch>\t<path>` line per touched path
  (`touchedPaths`, `mutations.mjs:304-309`).
- **The decider uses the PR's own listing,** as `patchPaths()` does today (`changed-scopes.mjs:93-106`).
  A change to the runner is under `packages/db/`, so it runs all anyway.
- **These all run all:**
  - zero lines, a line without exactly one tab, or a non-zero exit or timeout;
  - a patch name that fails `^\d{2,3}-[a-z0-9-]+\.patch$`;
  - a name the listing does not hold.

**B3. The selection: one parser, passed through `env:`.**

- **The output.** `mutations-plan` gains one output, `mutation_select`: the literal `all`, or a
  space-separated list of patch names that pass the B2 pattern. It is data, never an `if:`.
- **The shards' step** reads it only through `env:`, never `${{ }}` inside `run:`. If it is `all` or
  empty, the step passes nothing. Otherwise it writes the list to a file and passes `--select <file>`.
- **The runner is the only parser.** `--select` exits 1 on an empty file, a name that fails the
  pattern, or a name not in `allPatches()`.
- **Shard count.** The single "Shard count" step (`ci.yml:669-671`) computes
  `n = mutations.mjs --select <file> --list | wc -l` and writes `k = min(4, n)` shards. A one-patch
  selection then runs on one shard, and no shard is left empty to exit 1.
- **Nothing imports `mutations.mjs`**, because of its unguarded `await main()` (`:591`).
- **`mutations-total`** runs `--verify-reports <dir> --select <file>`. It checks that the reports cover
  exactly the selection, each patch once. Without `--select`, it checks every patch, as today.

**B4. Visibility.** When a PR runs a subset, `mutations-plan` writes one `$GITHUB_STEP_SUMMARY` line:
`ran N of 470 patches (targets touched: <paths>); main runs all on merge`.

### What each saving gives up, and what moves from before the merge to after it

| Saving     | What it gives up                                                                                                                                                                                                                   | Moves to after the merge                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| (c)        | A batch file that starts to affect a proof without an import. That cannot happen while C2 holds: the data is TypeScript constants, read only by two web DAL files that no patch targets.                                           | All 470 patches for a catalog-only PR, on main's push run.       |
| narrow (b) | Coupling to the touched file that does not go through an import: a proof reading `docs/runbooks.md` differently, or the web file `entries.ts` changing behaviour through a caller in `apps/web`. A caller in `packages/` runs all. | The other 469 patches for a runbook-only PR, on main's push run. |

**Still caught before the merge:**

- unpatched `db:verify` on every PR (`changed-scopes.mjs:19-20`);
- every patch on a PR that touches the packages, the infrastructure or `.github/`;
- the touched target's own patch.

**The fix-forward duty when main goes red** (proposed; Q3):

- **Who:** the lane that merged the red commit. `mutations-red-on-main` opens or updates one issue
  that names the commit and the run (`ci.yml:751-778`).
- **How fast:** that lane merges nothing else until main is green, and fixes forward or reverts the
  same day. Any lane may revert if the owner is away.
- **How:** the failing shard prints `✗ <patch>: …` (`mutations.mjs:541`, `:559`). The lane re-runs that
  patch with `pnpm --filter @mat-plan/db db:mutations --only <n>`, which is allowed locally (AGENTS.md
  → "When to run locally"), or pushes the fix and lets CI run.
- **Attribution:** per-commit concurrency (`ci.yml:8-14`, D6) is unchanged, so a red run still sits on
  its own commit.

## File-by-file

| PR   | Path                                                                                               | Change   | What & why                                                                                                                                                                                                      |
| ---- | -------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `.github/scripts/changed-scopes.mjs`                                                               | EDIT     | `CATALOG_DATA`, `catalogReachable(read)` (C2), and the exclusion in `scopesFor` (C1). The header gains a "what it gives up" line.                                                                               |
| 1    | `.github/scripts/changed-scopes.test.sh`                                                           | EDIT     | Cases C-1 to C-7, the `CATALOG_DATA` ↔ `DIR` contract test (C3), and the mutants (§ Test plan).                                                                                                                 |
| 1    | `packages/db/scripts/mutations/README.md`                                                          | EDIT     | "Where it runs" (`:9-16`) becomes a pointer to AGENTS.md → "Local hooks vs CI merge-gates" plus the local `--only` command. This also removes the stale "8 on a push to `main`" (`:11`).                        |
| 1    | `docs/architecture.md`                                                                             | EDIT     | The CI diagram's `changed-scopes.mjs` node (`:848`) gains "catalog data: not a mutation trigger".                                                                                                               |
| 2    | `.github/scripts/changed-scopes.mjs`                                                               | EDIT     | `narrowToTargets(files, listTargets)` (B1, B2) and the `mutation_select` output.                                                                                                                                |
| 2    | `packages/db/scripts/mutations.mjs`                                                                | EDIT     | `--list-targets`, `--select <file>`, and `--verify-reports … --select` (B2, B3).                                                                                                                                |
| 2    | `packages/db/scripts/mutations.test.sh`                                                            | EDIT     | `--select` refusals, the selection-aware `--verify-reports`, and the `--select … --list` round trip.                                                                                                            |
| 2    | `.github/workflows/ci.yml`                                                                         | EDIT     | `mutations-plan`: the `mutation_select` output, the shard count from `--list`, and the summary line (B4). `mutations` and `mutations-total`: `env:` → file → `--select`. Comments at `:631-639` and `:666-668`. |
| 2    | `.github/scripts/changed-scopes.test.sh`                                                           | EDIT     | Cases B-1 to B-8, the mutants, and an `if:` scan for `mutation_select`.                                                                                                                                         |
| 2    | `AGENTS.md`, `docs/architecture.md`                                                                | EDIT     | AGENTS.md `:324-326`: "skipped on a PR only when…" becomes "and narrowed to the touched targets when…". The diagram's `mutations` node (`:851`) matches.                                                        |
| 1–2  | `docs/changelog/<date>-<branch>.md`                                                                | NEW      | One fragment per PR.                                                                                                                                                                                            |
| this | `docs/plan.md`, `docs/roadmap.md`, `docs/changelog/2026-11-19-docs-dx-18-mutation-savings-plan.md` | EDIT/NEW | The DX-18 row links this plan, and so does the roadmap row. Plus the fragment. No "superseded" pointer is added to D6 or Q1, because neither PR changes what runs on `main`.                                    |

## Alternatives considered and rejected

- **(b) with an import graph inside the packages** (the first draft's B2). It follows imports both
  ways from each changed file. On the first draft's replay it came to 31,408 patch-runs, against
  30,558 for narrow (b) here. The replays differ slightly in how they emulate today's trigger, so the
  graph showed no measurable gain. It needed a resolver for `@/`, the exports map and the barrel, and
  it trusted a static graph to see every coupling (panel: correctness B3, architecture B1, scope S2).
- **A grep for `catalog/data` as the importer check.** It misses an indirect path, such as
  `fixture.ts` importing a batch file. The walk is about 25 lines (C2).
- **Importing `mutations.mjs` for a shared `parseSelection`.** Its `await main()` (`:591`) runs on
  import. Making the runner the only parser removes the need.
- **A JSON array in `mutation_select`.** That means a second parser in shell. A space-separated list
  of names that pass the B2 pattern has no quoting to get wrong.
- **(a) now.** See § Deferred.

## Risks / rollback

| #   | Risk                                                                                                                                   | Mitigation                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Over-skip, the failure this gate exists to catch                                                                                       | (b) only narrows a true trigger. Every doubt runs all (B2). Each saving has mutants the tests must catch. Main still runs all.                                 |
| R2  | Shards and total disagree about the selection                                                                                          | One parser, the runner. The shard count and `--verify-reports` both read the same file through it. The round-trip case B-6.                                    |
| R3  | **A saving that never saves:** the base copy in `$RUNNER_TEMP` cannot import a sibling, so a split decider throws and runs all forever | Everything stays in `changed-scopes.mjs`. Case C-1 and case B-1 run through `scopes-step.sh` with the base copy and must yield the narrowed answer, not `all`. |
| R4  | Injection through a planted patch name                                                                                                 | The name pattern (B2), `env:` only (B3).                                                                                                                       |
| R5  | Main goes red after a merge more often                                                                                                 | Main runs all, as today. The fix-forward duty above.                                                                                                           |

**Rollback:** each PR reverts on its own. (c) is one predicate. For (b), returning `all` from
`narrowToTargets` turns it off.

## Test plan

Everything runs in `guards:test` (`package.json:41`), offline, in throwaway repos, in the shape of
`changed-scopes.test.sh:17-46`. Locally: `bash .github/scripts/changed-scopes.test.sh`. **RED probe
first:** each case is written and run against today's script, where it must fail. The PR description
records that output.

| Case | Setup                                                                                               | Expect                                    |
| ---- | --------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| C-1  | A batch file plus `docs/` change, through `scopes-step.sh` with the base copy                       | `run_mutations=false`; build and e2e true |
| C-2  | C-1, plus a `packages/db` file importing `@mat-plan/shared/catalog/data`                            | mutations true                            |
| C-3  | C-1, plus a planted patch targeting `catalog/data/batch-01.ts`                                      | mutations true (the target branch, C1)    |
| C-4  | A catalog file plus `packages/shared/src/x.ts`                                                      | mutations true                            |
| C-5  | A fixture with a relative specifier that does not resolve                                           | mutations true                            |
| C-6  | `git` made to fail                                                                                  | mutations true                            |
| C-7  | `fixture.ts` gains `import './data/batch-01'`                                                       | mutations true                            |
| C-8  | `CATALOG_DATA` ↔ `check-catalog-append-only.mjs` `DIR`                                              | equal                                     |
| B-1  | `docs/runbooks.md` only, through `scopes-step.sh`                                                   | `mutation_select` = patch 200 only        |
| B-2  | B-1 plus any `packages/db/**` file, or `.github/scripts/x.mjs`, or `pnpm-lock.yaml` (one case each) | `all`                                     |
| B-3  | A docs-only change (no target)                                                                      | `run_mutations=false`, as today           |
| B-4  | `--list-targets` prints zero lines / a malformed line / a bad name / exits 1                        | `all`                                     |
| B-5  | `--select` with an empty file, a bad name, an unknown name                                          | exit 1                                    |
| B-6  | Round trip: the decider's `mutation_select` → file → `--select --list`                              | exactly the decider's names               |
| B-7  | `--verify-reports --select`: reports missing one selected patch / one extra                         | exit 1                                    |
| B-8  | Polarity: no `if:` reads `mutation_select`; the existing `== 'true'` scan                           | pass                                      |

**The tests can fail: mutation-style self-tests (H5).**

- **The mechanism.** A section of `changed-scopes.test.sh` copies `changed-scopes.mjs` and applies one
  from/to literal per mutant. Each `from` must match **exactly once**, the rule `probe.mjs:117-121`
  enforces. It then runs `node --check` on the copy, so a mutant that does not compile is a test
  failure, not a pass. It asserts that the **named** case goes RED and every other case stays green.
- **No marker comments in the shipped source.** A check asserts that `@mutant` appears nowhere under
  `.github/scripts/` except the test.
- **Mutants:**
  - (c) `c-walk-ignores-relative`: the walk skips relative specifiers. C-7 must fail.
  - (c) `c-unresolved-is-fine`: an unresolved specifier is skipped. C-5 must fail.
  - (c) `c-any-throw-is-no-match`: a git or read error reads as "nothing reaches the data". C-6 must
    fail.
  - (b) `b-db-not-run-all`: `packages/db/` is dropped from step 2. The `packages/db` row of B-2 must
    fail.
  - (b) `b-widens-false`: step 1's early return is removed. B-3 must fail.
  - (b) `targets-empty-is-proof`: zero target lines reads as "no patch is affected". B-4's first row
    must fail.
- **`pnpm probe`** runs one hand-picked mutant against the whole test (`pnpm probe --file
.github/scripts/changed-scopes.mjs --from … --to … --gate "bash .github/scripts/changed-scopes.test.sh"`)
  as each PR's own RED evidence. The suite above is the standing proof.

**After merge, on CI (each PR's description owes the run links):**

- PR 1: the next catalog batch PR shows `mutations-plan` false and no shards. Its push to `main` runs 4
  shards.
- PR 2: a runbook-only PR runs patch 200 on one shard, with the summary line. Its push to `main` runs
  all.

## Proposed PR split

| PR  | Saving     | About     | Gate to start                                                                                         |
| --- | ---------- | --------- | ----------------------------------------------------------------------------------------------------- |
| 1   | (c)        | 90 lines  | This plan approved.                                                                                   |
| 2   | narrow (b) | 200 lines | PR 1's measured relief, plus the U7 shard-duration probe. **Stop here if the queue is short enough.** |

## Out of scope

- (a), and coalescing main's runs (§ Deferred, Q-a, Q-coalesce).
- Changing the shard count; narrowing build or e2e; making any check required.
- An import graph for (b).

## § Deferred: main skips what its PR proved, (a)

**Recommended:** defer until a merge queue exists (scope S1).

- **The hit rate.** Of 33 PRs merged on 2026-11-19 (UTC), only **3** merged with main unchanged since
  their last PR run. Strict tree equality would have spared about 3 main runs that day.
- **Re-running before the merge does not help.** A re-run reuses the old merge ref. Only a new head
  commit, or a merge queue, produces a run on the tree that will land (correctness S8).

**The design, kept for whoever builds it:**

- **On the PR side:** after a passing `mutations-total` on a PR, upload a record. It holds the tree
  of the tested merge ref, the patches the reports show ran and passed, and the PR, head, run id and
  attempt.
- **On the push side:** look the record up by tree, check it, and run the complement. Run everything
  when the tree differs, the record is missing, or any shard was skipped or cancelled.
- **Already checked by probe (2026-11-19):**
  - squash tree = tested merge tree, on 3 of 3 merges where main had not moved (#719, #706, #705);
  - the runs API reports the PR head, not the merge commit;
  - artifacts can be listed by name, with the repository and head fields that the checks need;
  - `commits/{sha}/pulls` returns `merge_commit_sha` and `head.sha`.

**What any future (a) must fix** (the panel's blocking findings):

1. **`HEAD^` is not main-before-the-push** under a rebase merge or a multi-commit push. The repo
   allows merge, rebase and squash (correctness B2, security B1). Use `BASE_SHA=github.event.before`,
   require `HEAD^ == before`, and otherwise run all. Q-merge would remove the case.
2. **The record is produced by the PR's own `ci.yml` and runner.** If the push touches
   `.github/workflows/ci.yml`, `.github/scripts/**` or `packages/db/scripts/mutations.mjs`, run all.
   Take the patch list from `git ls-tree` of the pushed tree, never from the record (correctness B1,
   security S2, architecture S6).
3. **The fetch step's failure modes.** Under `bash -e`, `> f` creates the file before the command
   fails, and `gh api` writes error bodies to stdout. The step needs `continue-on-error`,
   `timeout-minutes`, writes to a temporary name and then an atomic rename, strict shape checks in the
   decider, and an A-10b case for an error body that parses as JSON (security S3).
4. **Bind the evidence to one run.** The same run id and attempt must appear across the artifact,
   `run.json`, `jobs.json` and the record. List with `per_page=100`. Filter by `repository_id` and
   `head_sha` before downloading. Use `overwrite: true` on re-runs. Put the tree in each shard report
   (correctness S6, security S4).
5. **Permissions.** Do the fetch in a separate push-only job, so `mutations-plan`, which runs PR code,
   stays at `contents: read` (architecture S5, security N5).
6. **The alternative to (a): coalescing.** Give main's mutation jobs a push-only concurrency group
   that keeps one pending run, so a burst of N merges becomes at most 2 runs. It costs D6 its
   per-commit attribution: a red run covers a range of commits, bisected with `--only`. That goes to
   the maintainer as Q-coalesce (scope S3).

## Open questions (for the maintainer; recommended option first)

- **Q-a.** Defer (a) until a merge queue exists _(recommended)_, or build it now with the six
  safeguards above.
- **Q-coalesce.** Keep D6's per-commit runs on main _(recommended, unless the queue stays the
  bottleneck after PR 1)_, or coalesce main's mutation runs and accept range attribution.
- **Q-merge.** Turn off rebase-merge and merge-commit merges in the repository settings, so squash is
  enforced. It is an outward-facing settings change, so the maintainer makes it. It removes
  deferred-(a)'s first hazard and matches AGENTS.md's "Merge = squash".
- **Q3.** Confirm the fix-forward duty: the merging lane merges nothing else and fixes or reverts the
  same day.

## Unverified claims, and the probe for each

- **U5.** A `mutation_select` of about 1 KB in the worst realistic case (a handful of names) fits the
  job-output limit. _Probe:_ B-1 on a test PR.
- **U7.** The table's savings: merged diffs stand in for runs, and shard time is assumed linear in
  patch count. _Probe:_ compare a one-patch shard's duration with a full shard's after PR 2, before
  deciding PR 2 is worth it.
  The deferred (a)'s unverified claims (token scopes, retention, re-run attempts) stay with it and do
  not apply to PRs 1–2.

## Review-response log (adversarial panel)

> Panel cost: not reported to the author (relayed by the coordinator). Models: high-stakes no ·
> correctness, scope, architecture, reuse, security: opus.
> The coordinator relayed the findings below by id. Any finding not relayed is not recorded here, and
> no relayed finding was rejected.

| Lens         | Id   | Critique (as relayed)                                                                         | Verdict                 | Resolution                                                                                                                          |
| ------------ | ---- | --------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| scope        | S1   | (a)'s hit rate (3/33) does not pay for its machinery                                          | **accepted**            | (a) moved to § Deferred, recommended until a merge queue exists; Q-a                                                                |
| correctness  | B1   | The record comes from the PR's own `ci.yml` and runner, which grade themselves                | **accepted (deferred)** | § Deferred item 2: run all if those files changed; patch list from `git ls-tree`                                                    |
| security     | S2   | Same as correctness B1                                                                        | **accepted (deferred)** | § Deferred item 2                                                                                                                   |
| architecture | S6   | Same as correctness B1                                                                        | **accepted (deferred)** | § Deferred item 2                                                                                                                   |
| correctness  | B2   | `HEAD^` is not main-before-the-push under a rebase merge or a multi-commit push               | **accepted (deferred)** | § Deferred item 1: `github.event.before`, require `HEAD^ == before`; Q-merge                                                        |
| security     | B1   | Same as correctness B2                                                                        | **accepted (deferred)** | § Deferred item 1                                                                                                                   |
| security     | S3   | The fetch step's `bash -e`, `> f`, error-to-stdout and no-timeout failure modes               | **accepted (deferred)** | § Deferred item 3, case A-10b                                                                                                       |
| correctness  | S6   | Evidence not bound to one run and attempt; trees not in shard reports                         | **accepted (deferred)** | § Deferred item 4                                                                                                                   |
| security     | S4   | Pagination, pre-download filtering, re-run overwrite                                          | **accepted (deferred)** | § Deferred item 4                                                                                                                   |
| architecture | S5   | `actions: read` in a job that runs PR code                                                    | **accepted (deferred)** | § Deferred item 5: a separate push-only fetch job                                                                                   |
| security     | N5   | Same as architecture S5                                                                       | **accepted (deferred)** | § Deferred item 5                                                                                                                   |
| correctness  | S8   | Q1's "re-run before merge" does not help: a re-run reuses the old merge ref                   | **accepted**            | § Deferred states it; Q1 rewritten as Q-a (merge queue)                                                                             |
| scope        | S3   | Coalescing main's runs is the cheaper alternative and was not named; state its cost to D6     | **accepted**            | § Deferred item 6, Q-coalesce                                                                                                       |
| correctness  | B3   | (b)'s import graph is unsound for couplings it cannot see                                     | **accepted**            | (b) is now narrow (B1): no graph                                                                                                    |
| architecture | B1   | (b) could widen a false trigger; it should only narrow                                        | **accepted**            | B1 step 1                                                                                                                           |
| scope        | S2   | The resolver is the bulk of PR 2 for a small margin                                           | **accepted**            | Resolver, Q4, U4, the graph cases and mutants deleted; B3 re-measured over all 150 commits                                          |
| reuse        | B1   | The resolver duplicates `source-graph.ts`                                                     | **moot**                | The (b) resolver is gone. (c)'s walk ports `source-graph.ts`'s regex and resolution and cites them (C2)                             |
| reuse        | S5   | Keep today's `.github` trigger exactly; do not restate it                                     | **accepted**            | B1 step 2 reuses `:62-66`                                                                                                           |
| architecture | S2   | Importing `mutations.mjs` runs `await main()` (`:591`)                                        | **accepted**            | The runner is the only parser; nothing imports it (B3)                                                                              |
| reuse        | S3   | Two parsers for the selection                                                                 | **accepted**            | One parser, the runner; the shard count is from `--select … --list` (B3), round trip B-6                                            |
| correctness  | also | `parseSelection` and the selection format drifted between shards and total                    | **accepted**            | B3, B-6                                                                                                                             |
| correctness  | S4   | Zero targets, or a thrown git or read error, can read as "nothing affected"                   | **accepted**            | B2 runs all; mutants `targets-empty-is-proof` and `c-any-throw-is-no-match`                                                         |
| security     | N6   | Patch names reach a shell                                                                     | **accepted**            | The name pattern in B2; `env:` only (B3)                                                                                            |
| architecture | also | Validate names; `env:` only                                                                   | **accepted**            | As security N6                                                                                                                      |
| correctness  | also | A PR that runs a subset should say so                                                         | **accepted**            | B4, the step-summary line                                                                                                           |
| scope        | S4   | (c) as an exclusion inside the trigger match, not a separate branch                           | **accepted**            | C1; the old C2.1, C-3-as-condition and its mutant dropped (the target branch covers it)                                             |
| correctness  | S5   | C2's grep misses an indirect import of the data                                               | **accepted**            | C2 is a walk; case C-7 and mutant `c-walk-ignores-relative`                                                                         |
| security     | also | Same as correctness S5                                                                        | **accepted**            | C2                                                                                                                                  |
| architecture | S4   | Same as correctness S5                                                                        | **accepted**            | C2                                                                                                                                  |
| reuse        | S6   | `CATALOG_DATA` duplicates `check-catalog-append-only.mjs`'s `DIR`; reuse source-graph's rules | **accepted**            | C3 contract test (C-8); C2 cites `source-graph.ts`                                                                                  |
| scope        | S5   | State (c)'s horizon                                                                           | **accepted**            | C5                                                                                                                                  |
| reuse        | B2   | Mutants anchored on `@mutant` markers in shipped source                                       | **accepted**            | from/to literals, exactly once (`probe.mjs:117-121`); a no-marker check                                                             |
| correctness  | S7   | The mutant check passes on a mutant that does not compile, or reddens the wrong case          | **accepted**            | `node --check` first; the named case must be RED and the rest green; `pnpm probe` for each PR's evidence                            |
| architecture | S7   | The mutations README restates the gate                                                        | **accepted**            | PR 1 cuts it to a pointer plus the `--only` command, which also fixes "8 on a push"                                                 |
| reuse        | S7   | Same as architecture S7                                                                       | **accepted**            | PR 1                                                                                                                                |
| scope        | S6   | Docs owed in this plan's own PR                                                               | **accepted**            | `docs/plan.md` and `docs/roadmap.md` DX-18 rows and a fragment, in this PR. No D6/Q1 pointer, because main's behaviour is unchanged |
| architecture | N8   | PR 1 restates AGENTS.md; and "Milestone: none" should name the track                          | **accepted**            | PR 1 does not edit AGENTS.md; § Where this sits names the DX-18 track                                                               |
| scope        | N8   | PR 2 only if PR 1 is not enough                                                               | **accepted**            | Split: PR 2 waits on PR 1's relief and U7                                                                                           |
