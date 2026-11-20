# DX-18 — heavy runs move to GitHub CI; the machine keeps one slot

> **Status: approved** _(maintainer, 2026-11-17, through the FAM-1 board)_. Build order: 1a, then 1b after
> lane A's #554, then 2, then 3; each PR asks the board for its push slot.

> Backlog: [plan.md](../plan.md) → `DX-18` (this PR adds the row). Branch: `docs/dx-18-heavy-runs-to-ci`
> (this plan), then one branch per PR below. Assigned to the Native Scaling lane by the maintainer
> _(orchestrator's chat, 2026-11-17)_: "move everything heavy off of the local machine unless
> otherwise stated".

## Where this sits

- **Pillar:** Platform: CI, hooks and the agent tooling. **Milestone:** none directly. It unblocks every
  Beta 0 lane, all of which queue today for one machine.
- **This plan:** the whole of DX-18, as four PRs (D1).
- **Gated on:** the maintainer's approval of this plan. PR 1b and PR 2 also wait for lane A's #554, which
  rewrites the mutation runner.

_Roadmap alignment (2026-11-17): advances `DX-18`. It touches nothing in `ID-1`, the catalog or the
household scope. It supersedes DX-5(b)'s "`db:mutations` stays local-only" (`dx-5b-local-gates-in-ci.md`).
Checked against the private roadmap; nothing else to add._

## The maintainer's scope, as asked

- **A.** `db:mutations` runs in CI, path-filtered.
- **B.** Screenshots run as a GitHub workflow.
- **C.** CI runs only the jobs for the pillars a PR touches.
- **D.** The pre-push hook runs typecheck plus related tests only.
- **E.** One lock slot for heavy local commands.
- **F.** A guard that blocks pattern kills.
- **G.** The docs ride with each PR.
- **H.** Guidelines for when to run locally, with filtered commands.
- **I.** Tests can be split by pillar or feature: plan it now, build it later if need be.

## Why now

Several lanes run `pnpm verify`, `pnpm e2e:local`, `db:mutations` and the pre-push hook on one machine.
On 2026-11-17 the load average passed 200:

- tests timed out at their limits;
- one e2e run lost a server action;
- one lane's `pkill -f` probably killed another lane's mutation run.

The board ran a hand-allocated slot queue all afternoon. The maintainer's rule is now **one heavy local
run at a time, machine-wide; everything heavy on GitHub CI**.

## What is true today (origin/main, 2026-11-17; CI run 44169956280)

| Claim                                                                          | Truth                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-push runs "typecheck + affected tests" (AGENTS.md)                         | **False.** `.husky/pre-push` is `pnpm typecheck` and `pnpm test`. That is the whole vitest run, about 2,400 cases in 157 files, `packages/*` included (`apps/web/vitest.config.ts`).                                   |
| `db:mutations` is local-only                                                   | True: no workflow runs it. There are 240 patches. **Each one runs a full `db:verify`**, one after another (`mutations.mjs`). How long a whole run takes is **unmeasured**; PR 2 times one shard first.                 |
| `pnpm verify` takes "~40s" (AGENTS.md), "~35s" (ship-pr) or "~25s" (tech-debt) | **False, all three.** The mutation gate alone takes tens of minutes. The figures predate it. This plan deletes them rather than updating them.                                                                         |
| CI's cost                                                                      | Measured: `quality` 3m34s (Test **53s**, Build **23s**), `e2e` 3m16s (in parallel), `gitleaks` 18s.                                                                                                                    |
| CI has required checks                                                         | **None.** The ruleset holds only `deletion` and `non_fast_forward`. DoD line 57 says "required check", and it is wrong.                                                                                                |
| CI skips work by path                                                          | Only e2e does, at step level, through an `INERT` list read from `pulls.listFiles` (`ci.yml:463-507`). That reads `filename` only, so a rename out of `apps/web/` into `docs/` skips the smoke. That is inherited debt. |
| A killed `db:mutations` leaves a patch in source                               | True on main. Lane A's **#554** fixes it with a journal, a lock and signal-safe restore. Its lessons entry already says: never stop a gate by pattern.                                                                 |
| A kill guard                                                                   | None. `guard-main-checkout.mjs` analyses only `git` and `gh` (`analyzeSegment` returns for anything else, line 548).                                                                                                   |
| `.claude/settings.json`                                                        | **Hash-pinned.** `review-prefetch.sh` checks `SETTINGS_SHA256` and `PINNED_HOOKS` (SECURITY.md → Supply chain). Any edit fails the review workflow until the pin is re-read.                                           |

## Decisions

**D1. Four PRs, in order.**

| PR  | Delivers                                                                                                                                                                                               | Waits for                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| 1a  | The slim pre-push and `test:changed` (D, part of I); the when-to-run rule (H); every doc fix (G)                                                                                                       | nothing                                                   |
| 1b  | The kill guard (F) and the heavy-run slot (E), which shares one lock helper with #554's                                                                                                                | #554 merged                                               |
| 2   | `db:mutations` in CI: sharded, scoped, and run in full on every push to main (A). Pillar scopes for the heavy CI steps, from one tested script (C). "`pnpm verify` before a PR is optional" lands here | PR 1b, because it changes `mutations.mjs` after #554 does |
| 3   | Screenshots in CI on request (B)                                                                                                                                                                       | nothing beyond the plan: it runs on request               |

- **1a and #554:** both edit `package.json`'s `guards:test` line and AGENTS.md's guard count, which
  1a deletes. Whichever merges second merges main and resolves that line.
- **Why 1a goes first:** it is the immediate relief. Every push currently runs the full suite.
- **Why C is not its own PR:** measured, it saves 23 seconds of a 3.5-minute job. Its value is the
  mutation scope, which lives in PR 2.
- **Until PR 2 merges, the mutation proof stays local** (D5). Nothing tells a DB change to skip it
  before CI runs it.

**D2. The kill guard (F), in PR 1b.** It is a new `.claude/hooks/guard-process-kill.mjs`, a second `PreToolUse`
Bash hook that applies in every directory.

- **It does not reuse `invocations()`,** which reports only git and gh. It imports the exported `lex()`
  (`guard-main-checkout.mjs:112`), using a **dynamic `import()` placed after its own CI exit**. That way
  no imported code runs in a job that holds a token. It then checks the first word of each segment,
  after a small wrapper walk of its own: `sudo`, `env`, `command`, `timeout`, `nohup`, `xargs`, and a
  re-lex of `sh -c` / `bash -c`. A `git commit -m "…pkill…"` or a heredoc that mentions `pkill` is not
  denied.
- **It denies:**
  - `pkill`, `killall` and `fuser -k` in any form;
  - `kill` whose target is a substitution or comes from a pipe (`$(pgrep …)`, `| xargs kill`);
  - `kill 0`, `kill -1`, any negative pid, and `kill -- …`. Each of these is broader than
    `pkill -f`.
- **It allows** `kill [-SIG] <pid>` with a literal pid of 2 or more, `kill $!`, `kill "$<name>"` and
  `kill %<job>`.
- **The deny reason:** "Stop only a process you started, by the pid you captured (`$!`), or let it
  finish: other lanes run the same scripts on this machine."
- **Wrappers:** the walk covers the same wrappers its sibling unwraps (`guard-main-checkout.mjs:371-449`):
  `sudo`, `doas`, `env`, `command`, `exec`, `eval`, `nice`, `nohup`, `stdbuf`, `timeout`,
  `caffeinate`, `xargs`, `script -c`, `watch`, `find -exec`, `pnpm exec`/`npx`, and a re-lex of
  `sh -c` / `bash -c`. A case per wrapper goes in `hooks.test.sh`.
- **The no-op check:** the hook must contain the exact text `!process.env.CI && !process.env.GITHUB_ACTIONS`,
  because `review-prefetch.sh` greps for that string.
- **Known gaps block:** `node -e 'process.kill(…)'`, `npx kill-port`, and a `while read p; do kill $p`
  loop. Best-effort, like its sibling, and not a security boundary.
- **Fails open,** and does nothing under `CI` or `GITHUB_ACTIONS`.
- **Escape:** `MAT_PLAN_ALLOW_PATTERN_KILL=1`.
- **The pin, in the same PR:**
  - both hooks go into `PINNED_HOOKS`;
  - `SETTINGS_SHA256` is updated, with the DX-1 threat model re-read and logged in the PR;
  - `review-prefetch.test.sh` gains the cases;
  - SECURITY.md → CI / Actions secrets is updated.
- **The shared wrapper walk is not built here, but it is tracked:** PR 1b adds a `docs/tech-debt.md`
  entry, "two shell-wrapper walks". Lifting `guard-main-checkout.mjs`'s walk into one module
  for both hooks is a refactor of a 962-line guard with 221 cases. It is recorded as a follow-up, not
  done in this PR.

**D3. The heavy-run slot (E), in PR 1b.**

- **One lock helper.** `.github/scripts/pid-lock.mjs` is a single helper, `acquire(path, payload,
busyMessage)` and `release()`. #554's per-worktree lock in `mutations.mjs` moves onto it in PR 2, so
  there is one implementation.
  - **Creation is atomic with its content:** the payload goes to a temp file, then
    `linkSync(tmp, lock)`. An empty lock file is never visible.
  - **Taking over a stale lock** is `renameSync(lock, lock + '.stale.' + process.pid)`, then a re-read
    confirming that the renamed content is the dead holder's.
  - **A holder counts as alive** if `process.kill(pid, 0)` succeeds or fails with `EPERM`, **and** its
    start time (`ps -o lstart= -p <pid>`) matches the one recorded. A reused pid is treated as dead.
- **The slot** is `~/.cache/mat-plan/heavy-slot.json`. That path is per user, so it covers every clone
  and copy on the machine. The lock holds:
  - the pid of the wrapper and of its child's process group;
  - the lane (the branch name, with control characters stripped, capped at 80 characters);
  - the command and the start time.

  A lock stays live while either pid is alive, so a `kill -9` of the wrapper doesn't free the slot
  while its child still runs.

- **Where it is taken: inside the runners,** so a `pnpm --filter …` form can't bypass it.
  - `mutations.mjs`, `apps/web/scripts/e2e-local.ts` and `apps/web/scripts/screenshot-ephemeral.ts`
    each take it first.
  - `verify` becomes `node .github/scripts/heavy-slot.mjs -- pnpm verify:run`. The runners inside it
    see `MAT_PLAN_HEAVY_SLOT_HELD`, which must equal the live lock's pid to count, so a stray `export`
    does not turn the slot off.
  - The wrapper spawns its child asynchronously and forwards SIGINT, SIGTERM and SIGHUP. That follows
    #554's lesson that `spawnSync` blocks every handler.
- **When the slot is busy,** the command exits 2 with: **"heavy-run slot held by `<lane>` (`<command>`,
  since `<time>`). Push and let CI gate it, or wait."**
- **Bypass:** `MAT_PLAN_HEAVY_SLOT=off`, for a person. It does nothing under CI.
- **Tests use their own lock.** `MAT_PLAN_HEAVY_SLOT_PATH` overrides the path, and `heavy-slot.test.sh`
  and `mutations.test.sh` point it at a temp directory. They never take, steal or delete another
  lane's live lock.
- **Putting a fresh lock back** after the steal check uses `link`, never `rename`, so it can't
  overwrite a newer lock.

**D4. The slim pre-push and `test:changed` (D, part of I), in PR 1a.**

- **The hook:** `.husky/pre-push` becomes `pnpm typecheck && pnpm test:changed`.
- **The script:** `.github/scripts/test-changed.mjs` takes its base from `defaultBase()`
  (`.github/scripts/default-base.mjs`, which handles stacked PRs). Then it runs:
  - `vitest run --changed <base>`, which resolves the changed files through git itself. Hand-fed
    repo-relative paths would resolve against `apps/web` and silently match nothing.
  - **The tests that find their targets by reading the filesystem, always.** These are the scanners,
    such as `pages-need-a-session`, `tenancy-is-not-cached`, `bypass-is-contained`,
    `no-bare-unhide` and `notice-content`. The list is derived by grepping test files for
    `globSync` / `readFileSync`, and the script fails if a scanner is missing from it. Import tracing
    alone would never select them.
- **Vitest's force-rerun triggers** gain `pnpm-lock.yaml`, `pnpm-workspace.yaml` and `tsconfig*.json`.
  A change to any trigger means a full run, which takes the slot (D3). With the slot busy, the script
  says so and leaves the full run to CI.
- **When nothing is reached,** the script prints "no tests reached by this change" and exits 0.
- **This is not a gate.** Pre-push is a local courtesy, and CI's `quality` runs the whole suite on every
  code PR. The PR cites the maintainer's directive for narrowing it (hold-the-bar's loosened-bar rule).

**D5. When to run locally (H), written once.** AGENTS.md's "Local hooks vs CI merge-gates" keeps the
**rule**, and the other docs point to it.

- **Run locally:**
  - writing code (one file, one probe);
  - debugging a CI failure;
  - `pnpm probe`;
  - editing CI itself;
  - an Actions outage;
  - `pnpm dev`;
  - production operations (corrections; never tests against production).
- **Everything else heavy runs on CI.** Push, and let it gate.
- **Until PR 2 merges:** a diff touching `packages/db/**`, `packages/shared/**`, the lockfile or a
  manifest still runs `db:mutations` locally, in the slot. **"`pnpm verify` before a PR is optional"
  lands in PR 2**, once CI runs the mutation proof.
- **The filtered commands** go into `debug-ci-failure` and `ship-pr`, linked from AGENTS.md. That keeps
  AGENTS.md under DX-10's word cap:
  - one file or test name: `pnpm --filter web exec vitest run <path> -t "<name>"`;
  - one package: `pnpm --filter web exec vitest run ../../packages/shared/src`;
  - what a change reaches: `pnpm test:changed`;
  - some mutations (PR 2): `pnpm --filter @mat-plan/db db:mutations --only 271-278` or
    `--only <substring>`;
  - one Playwright spec: `pnpm e2e:local e2e/<spec>.ts -g "<name>"`.

**D6. `db:mutations` in CI (A), in PR 2.** A new `mutations` job with a matrix of shards.

- **Shard count:** set after one shard is timed on a runner (8 to start). Each shard runs
  `db:mutations --shard ${{ strategy.job-index }}/${{ strategy.job-total }}`. The count is never written
  twice.
- **`fail-fast: false`,** and a final `mutations-total` job checks that the shards together ran every
  patch exactly once.
- **Its own job, not a step in `quality`:** a matrix needs a job. Leaving `quality` is what keeps the
  heavy shards off the 3.5-minute gate, and `ci.yml:244`'s comment is updated to say why. No check is
  required, so this changes no merge rule.
- **When it runs:**
  - on a PR, when `run_mutations` (D7) is not `false`;
  - on **every push to main, all shards, unconditionally.** A red run then sits on the commit that
    caused it _(until the 2026-11-19 revision under Concurrency: runs now coalesce, so a red run
    covers a range)_. A final job opens or updates one issue, "mutation gate red on main", in a job that
    holds only `issues: write`.
- **As built after #700 (2026-11-19, CI runs queued for most of an hour):** a `mutations-plan` job runs
  the scopes once and outputs `run_mutations` and the shard list, written once in its "Shard count"
  step: **4 on every event** (8 on a push to main until 2026-11-19, maintainer, after eleven queued
  main runs of 8 shards each held every PR behind them). Every push to main still runs every patch,
  and a red run still sits on its own commit. `mutations` and `mutations-total` skip at job level when
  `run_mutations` is `false`, so a PR that cannot affect a patch takes one runner for the proof, not
  nine. A failed plan leaves the output empty, which still runs `mutations-total`, and it goes red.
- **No cron.** A scheduled run tells nobody, and public-repo schedules lapse after 60 days.
- **Concurrency:** `cancel-in-progress` only for `pull_request`. On `push`, the group is keyed by
  `github.sha`. GitHub keeps only one _pending_ run per group even without cancelling (AGENTS.md
  records this for `migrate.yml`), so a shared group would drop a middle commit's shards on quick
  merges.
  - **Revised (maintainer, 2026-11-19):** pushes to main now share one group on purpose, so a burst
    of merges costs at most two runs and the middle commits' runs are dropped. The newest run checks
    everything before it, and a red run covers the commits since the last green one, narrowed with
    `db:mutations --only <n>`. Eleven queued main runs had held every PR behind them; the trade and
    its numbers are in [dx-18-mutation-savings.md](./dx-18-mutation-savings.md).
- **The runner flags,** added to `mutations.mjs` on top of #554's journal:
  - `--shard i/n` and `--only <range|substring>`;
  - `--list-paths`, which prints the union of the paths the patches touch, through #554's
    `touchedPaths()`.

  #554's lock moves onto `pid-lock.mjs` (D3).

- **Requirements:** the job needs only `github.token`. It uses PGlite, no database service and no
  secret.

**D7. Pillar scopes (C), in PR 2: one script, run flags only.**

- **The script:** `.github/scripts/changed-scopes.mjs` prints `run_mutations`, `run_build` and `run_e2e`.
  - **Polarity rule:** every output says _run_, and a step skips **only on a literal `'false'`**
    (`if: steps.scopes.outputs.run_e2e != 'false'`). A missing, empty or mistyped output runs. The
    script's test asserts that no workflow compares a scope with `== 'true'`.
- **Inputs:** the changed files come from `resolve-pr-base.sh`'s base and
  `git diff --name-only --no-renames -z <base> HEAD`, with `fetch-depth: 0` in every job that runs the
  scopes. `--no-renames` sees a move's source path. `pulls.listFiles` is retired; it reads only
  `filename` and stops at 3,000 files.
- **The base's copy decides.** The job runs `git show <base>:.github/scripts/changed-scopes.mjs` from
  `$RUNNER_TEMP`, so a PR can't reclassify itself. The PR's own copy is exercised by its test, the
  pattern `review-prefetch.sh` uses for its guards. This catches mistakes, not a hostile author, the
  same residual SECURITY.md already accepts for the pin checker.
- **The rules:**
  - `run_mutations` is false only when no changed file is under `packages/db/**` or
    `packages/shared/**`, matches the `--list-paths` union, or is `pnpm-lock.yaml`,
    `pnpm-workspace.yaml`, any `package.json`, any `tsconfig*.json`, or anything under `.github/`.
  - `run_build` and `run_e2e` are false only when every file is inert. The inert list is e2e's
    `INERT`, which moves here so there is one definition. Its image rule is narrowed to `docs/**` and
    `.github/**`: an image under `apps/web/` is app content. The `.github/` templates stay inert.
    Every other `.github/` change sets every flag to run.
  - **Fail-safe:** a script error, an unreadable base, or any event other than `pull_request` sets
    every flag to run.
- **What never skips:** format, lint, typecheck, `test`, `db:verify`, gitleaks, the guards, the audit and
  the status check.
- **Dropped:** a catalog-only scope. Batch files are TypeScript bundled into the app, and the e2e seed is
  the only PR-time proof that a batch loads. Also dropped: `web` and `workflows` scopes, which nothing
  needs.
- **Docs:** AGENTS.md and `ci-e2e-auto-skip.md` link to the script instead of restating the list.

**D8. Screenshots in CI (B), in PR 3: on request, same-repo PRs only.**

- **What to capture is an input.** CI can't infer a route or a tap state from a diff. The PR body carries
  a block, and `screenshots.yml` reads it:

  ```
  screenshots:
  - /p/<fixture>/today
  - /p/<fixture>/today --state sheet-open
  ```

  A `screenshots` label (`types: [labeled, opened, synchronize, reopened]`) or a `workflow_dispatch`
  starts a run.
  A `workflow_dispatch` run never publishes (the publish job requires `event == 'pull_request'`);
  its images are only an artifact.

- **The entries reach the script through `env:` or a file,** never `${{ }}` inside `run:`, so PR-body
  text can't inject into the shell.

- **The capture workflow, `screenshots.yml`:**
  - runs on `pull_request`, with `permissions: contents: read`, `persist-credentials: false` and no
    secrets;
  - builds once, runs `screenshot:ephemeral` per entry (embedded Postgres, credentials blanked by the
    script itself), and uploads `.screenshots/` as an artifact.
- **The publish workflow, `screenshots-publish.yml`** (`workflow_run`, `contents: write`,
  `pull-requests: write`), publishes **only when `workflow_run.head_repository.full_name ==
github.repository`**: a same-repo PR, whose author already has write access. A fork gets the artifact
  link instead. Safeguards:
  - it resolves the PR by listing open PRs where `head.sha == workflow_run.head_sha` and the head repo
    matches, and refuses unless exactly one matches. It never trusts a number in the artifact;
  - it requires `workflow_run.event == 'pull_request'` and `conclusion == 'success'`;
  - it downloads to `$RUNNER_TEMP`, never into the checkout, using `actions/download-artifact` pinned
    at a version with the zip-slip fix (confirmed from its source at the pin);
  - no `cache`, no `actions/cache`, and no install step with the token in its environment;
  - `GH_TOKEN` is set only on the one publish step;
  - it shares `prune-screenshots`' concurrency group.
- **`publish-screenshots.ts` gains:**
  - a token path that switches on `GITHUB_ACTIONS` plus an explicit `--ci` flag. Its keyring default
    stays: the local `GH_TOKEN` is a PAT that can't do this work;
  - a filename allowlist (`^[a-z0-9-]+\.png$`), a PNG magic-byte check, and caps on count and size,
    which turn its silent `.png` filter into a refusal;
  - a fixed `--note` of the head SHA;
  - round counting from `github-actions[bot]` comments only, so a planted marker can't force a
    `--note`.
- **The baseline:** the first CI round is a comment marked as the baseline. AGENTS.md's UI rule
  ("first set in the description") is amended to say so; see Q3.
- **A real fork test** is a post-merge obligation. `workflow_run` always runs main's copy, so PR 3
  can't test its own publish job before merge.

**D9. Splitting tests by pillar (I).**

- **Built now:** `test:changed` (D4), and the CI scopes (D7).
- **Deferred to `DX-18b`:** per-pillar vitest projects and `test:pillar`. The trigger is CI's Test step
  passing 3 minutes; it was 53s on 2026-11-17. The row also records two constraints:
  - `check-feature-guides.mjs`'s `owns:` parser must first move into an importable module (it runs on
    import today);
  - a file can belong to several guides, or to none, so the projects are many-to-many plus a catch-all,
    not "exactly one".

  Q2 asks the maintainer to confirm the deferral.

## File-by-file

| PR   | Path                                                                                                                                     | Change   | What & why                                                                                                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1a   | `.github/scripts/test-changed.mjs` + `.test.sh`                                                                                          | NEW      | D4. The test covers: a `packages/shared` file reaches its test; a new `page.tsx` selects `pages-need-a-session`; `notice.md` selects `notice-content`; a docs-only change runs nothing |
| 1a   | `.husky/pre-push`, `package.json` (`test:changed`; `guards:test`), `apps/web/vitest.config.ts` (force-rerun triggers)                    | EDIT     | D4                                                                                                                                                                                     |
| 1a   | `AGENTS.md`                                                                                                                              | EDIT     | The when-to-run rule (D5). Corrects the pre-push claim and Squawk. **Deletes** the verify timings and the guard count (pointing at `package.json`). Adds `eval` to the list            |
| 1a   | `.claude/skills/{ship-pr,start-task,db-migration,keep-mergeable,review-pr,debug-ci-failure}/SKILL.md`                                    | EDIT     | Point to the one list. The filtered commands go here. ship-pr's red flag at line 212 ("pushing to fix CI one round at a time") is rewritten, citing 2026-11-17                         |
| 1a   | `docs/definition-of-done.md`                                                                                                             | EDIT     | Line 57: no check is required; green CI is the bar                                                                                                                                     |
| 1a   | `docs/lessons.md`                                                                                                                        | EDIT     | One entry: load timeouts that look like failures (symptom → cause → fix). The kill lesson stays #554's                                                                                 |
| 1b   | `.github/scripts/pid-lock.mjs`, `heavy-slot.mjs` + `.test.sh`                                                                            | NEW      | D3. The test covers: two takers racing; stealing a stale lock; a reused pid; a dead wrapper with a live child; nesting; CI                                                             |
| 1b   | `apps/web/scripts/e2e-local.ts`, `screenshot-ephemeral.ts`; `package.json` (`verify` → `verify:run` behind the slot)                     | EDIT     | Each takes the slot first                                                                                                                                                              |
| 1b   | `.claude/hooks/guard-process-kill.mjs`, `.claude/settings.json`, `.claude/hooks/hooks.test.sh`                                           | NEW/EDIT | D2. About 30 cases: each deny form, wrapped forms (`sudo`, `env`, `timeout`, `bash -c`, `xargs`), the allowed pid/`$!`/job forms, and both hooks loading                               |
| 1b   | `.github/scripts/review-prefetch.sh` + `.test.sh`, `.github/SECURITY.md`                                                                 | EDIT     | `PINNED_HOOKS` and `SETTINGS_SHA256` (D2)                                                                                                                                              |
| 1b   | `docs/lessons.md`                                                                                                                        | EDIT     | #554's kill entry gains "→ now denied by `guard-process-kill.mjs`"                                                                                                                     |
| 2    | `packages/db/scripts/mutations.mjs` + `mutations.test.sh` (#554's)                                                                       | EDIT     | `--shard`, `--only`, `--list-paths`; the lock on `pid-lock.mjs`; a partition test (every patch in exactly one shard)                                                                   |
| 2    | `.github/scripts/changed-scopes.mjs` + `.test.sh`                                                                                        | NEW      | D7. The test covers every rule and fail-safe, #306's lockfile-only change, a rename, and the `== 'true'` scan                                                                          |
| 2    | `.github/workflows/ci.yml`                                                                                                               | EDIT     | The `mutations` matrix, `mutations-total` and the issue job; scopes in `quality` and `e2e` (`fetch-depth: 0`); the concurrency change; `INERT` moves to the script                     |
| 2    | `AGENTS.md`, `docs/architecture.md` §5, `docs/tech-debt.md`, `packages/db/scripts/mutations/README.md`, `docs/plans/ci-e2e-auto-skip.md` | EDIT     | `db:mutations` in CI; "`pnpm verify` is optional"; the CI diagram; the rename-skip debt closed                                                                                         |
| 3    | `.github/workflows/screenshots.yml`, `screenshots-publish.yml`                                                                           | NEW      | D8                                                                                                                                                                                     |
| 3    | `apps/web/scripts/publish-screenshots.ts`, `docs/runbooks.md`                                                                            | EDIT     | D8's script changes; the runbook's token note                                                                                                                                          |
| 3    | `.claude/skills/ui-screenshot/SKILL.md`, `AGENTS.md` (UI PR rules), `docs/definition-of-done.md` line 17, `docs/architecture.md` §5      | EDIT     | Screenshots come from CI; a local capture is for debugging                                                                                                                             |
| this | `docs/plan.md` (DX-18 and DX-18b rows), `docs/roadmap.md` (In flight), changelog fragment                                                | EDIT/NEW | The rows ride with the plan                                                                                                                                                            |

**Size:** PR 1a about 250 lines, mostly docs; 1b about 350; PR 2 about 350; PR 3 about 300.

## Test plan

- **Every PR** is gated by CI. No local `pnpm verify` is run, and the new suites are light and run in
  `guards:test`.
- **PR 2:**
  - a probe PR touching `packages/db/` runs every shard, and the total job counts 240 patches;
  - a docs-only change, a lockfile-only change and a rename each set the right flags;
  - a deliberately broken mutation goes red in its shard;
  - main's next push runs every shard.
- **PR 3:**
  - a same-repo UI PR with a `screenshots:` block gets its comment;
  - a crafted artifact is refused: a bad filename, non-PNG bytes, and an oversize file.

## Risks / rollback

- **A scope skips something:**
  - flags default to run, and only a literal `false` skips;
  - the base's copy of the script decides;
  - the trigger set includes the lockfile, manifests, tsconfigs and `.github/`;
  - `--no-renames` sees a move's source;
  - main's push runs every shard.
- **The slot blocks a person:** use `MAT_PLAN_HEAVY_SLOT=off`. The busy message says who holds it.
- **The screenshot token:** publishing happens only for same-repo PRs. It runs main's code on PNG bytes
  that pass the checks, and holds no cache.
- **The kill guard breaks:** it fails open. Its escape is `MAT_PLAN_ALLOW_PATTERN_KILL=1`.
- **Rollback:** each PR reverts on its own.

## Out of scope

- Making any check required in branch protection. That is the maintainer's setting.
- The Neon-branch migration rehearsal.
- `next build` in `pnpm verify`.
- Lifting `guard-main-checkout`'s wrapper walk into a shared module (a follow-up).
- Moving `check-feature-guides` and `check-status-touched` onto one changed-files helper (a follow-up).
- Per-pillar vitest projects (`DX-18b`).

## Decided _(maintainer, 2026-11-17, through the FAM-1 board; each quotes the option chosen)_

- **Q1, "Every push to main (Recommended)":** each merge to main runs every mutation shard. No cron.
- **Q2, "Plan now, build when slow (Recommended)":** `test:changed` ships in DX-18. Per-pillar CI test
  projects are `DX-18b`, built once CI's Test step passes 3 minutes.
- **Q3, "As PR comments (Recommended)":** CI screenshots arrive as PR comments, the first one marked as
  the baseline. No write token sits beside a fork's files.
- **The plan, "Approve (Recommended)".**

## Review-response log (adversarial panel)

> Panel cost: correctness 109k · 7m27s, scope 75k · 4m09s, architecture 95k · 4m52s, reuse 107k · 5m00s,
> security 121k · 7m51s. Models: CI and workflows for a public repo · every lens on opus (Fable cap until
> 2026-11-19 03:00 ET). Every lens was told to run nothing heavy; two ran probes of seconds each.

Lenses: C correctness, S scope, A architecture, R reuse, X security.

| #   | Lens       | Critique (short)                                                                                                                                     | Verdict                 | Resolution                                                                                                                     |
| --- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| B1  | A          | Between PR 1 and PR 2, nothing would run the mutation proof                                                                                          | **accepted**            | D5: it stays local until PR 2; "verify optional" lands in PR 2                                                                 |
| B2  | S, R, X    | `invocations()` sees only git and gh, so the lexer can't be lifted "unchanged" for the kill guard                                                    | **accepted**            | D2: import `lex()`, plus the guard's own wrapper walk; the shared walk is a follow-up                                          |
| B3  | C, X       | A missing or mistyped scope output read as "skip"; "all true" also turned on skip flags                                                              | **accepted**            | D7: run-flags only, skip on a literal `'false'`, and a scan asserts no `== 'true'`                                             |
| B4  | X          | `settings.json` is hash-pinned; the lexer import would run outside the CI no-op proof                                                                | **accepted**            | D2: a dynamic import after the CI exit; `PINNED_HOOKS` and `SETTINGS_SHA256` in PR 1b                                          |
| B5  | S, A, X, C | CI can't infer what to screenshot; the publish job's write token sat beside a fork's artifact; the PR-number check has nothing to compare for a fork | **accepted**            | D8: routes from the PR body, same-repo publish only, PR resolved by head SHA, artifact checks                                  |
| 1   | C, R, X    | The slot lock races (two holders in 1 of 3 probe trials); pid reuse; the stale steal                                                                 | **accepted**            | D3: link-from-temp creation, steal by rename, start-time check, race cases in the test                                         |
| 2   | A, R       | The slot duplicates #554's lock; PR 1 conflicts with #554 on `package.json` and AGENTS.md                                                            | **accepted**            | D3: one `pid-lock.mjs`; PR 1 split, with 1b after #554                                                                         |
| 3   | A, C       | The slot is attached at the wrong layer; `--filter` forms bypass it; `verify`'s `&&` chain; a dead wrapper with a live child                         | **accepted**            | D3: taken inside the runners, `verify:run` behind one wrapper, the child's pgid recorded                                       |
| 4   | C, A, X    | The slot's location is clone-wide, not machine-wide                                                                                                  | **accepted**            | D3: `~/.cache/mat-plan/heavy-slot.json`                                                                                        |
| 5   | C, X, R    | The mutation scope missed the lockfile, manifests and `.github/`; #306 would have skipped every shard; defined twice                                 | **accepted**            | D7: one definition with the full trigger set; #306 is a test case                                                              |
| 6   | C          | `vitest related` misses the filesystem scanners and route files; repo-relative paths resolve against `apps/web` and match nothing                    | **accepted**            | D4: `--changed <base>`, scanners always included, extra force triggers                                                         |
| 7   | A, R       | `@{upstream}` is the last push, not main; `default-base.mjs` already exists                                                                          | **accepted**            | D4: `defaultBase()`                                                                                                            |
| 8   | C, A, X, S | The nightly cron shared CI's concurrency group, alerted no one, and ran every job; it contradicted Q1                                                | **accepted**            | D6: every push to main runs every shard, an issue on red, no cron; PR-only cancel                                              |
| 9   | X, C       | `INERT`'s image rule and catalog-only would also skip `build`; a rename hides a source path; `pulls.listFiles` caps at 3,000                         | **accepted**            | D7: the image rule narrowed, catalog scope dropped, `--no-renames`, git diff                                                   |
| 10  | X          | The PR's own scope script would classify itself                                                                                                      | **accepted**            | D7: the base's copy decides; the residual is stated                                                                            |
| 11  | X, R, A    | The publish script's token switch, `--note`, the silent `.png` filter, and round counting from any comment                                           | **accepted**            | D8's script changes                                                                                                            |
| 12  | S          | PR 3 (C) saves 23 seconds; fold it in                                                                                                                | **accepted**            | C is part of PR 2: four PRs become three, plus the 1a/1b split                                                                 |
| 13  | S          | Split PR 1 by concern                                                                                                                                | **accepted**            | 1a and 1b                                                                                                                      |
| 14  | S          | Cut DX-18b to a trigger, and ask about the deferral                                                                                                  | **accepted**            | D9 and Q2                                                                                                                      |
| 15  | S          | This plan PR needs its row, fragment and roadmap move, and A–I quoted                                                                                | **accepted**            | The "this" row; the scope block at the top                                                                                     |
| 16  | A, R       | Stale skills and `architecture.md` §5 weren't listed; delete counts and timings rather than updating them; one lessons entry, not two                | **accepted**            | The file table                                                                                                                 |
| 17  | R          | Lift the wrapper walk into a shared `commands()` for both hooks now                                                                                  | **rejected (deferred)** | Refactoring a 962-line guard with 221 cases is its own concern. The kill guard's wrapper list is small and tested; a follow-up |
| 18  | R          | Move the two older checks onto one changed-files helper                                                                                              | **rejected (deferred)** | Not needed to deliver DX-18; recorded in Out of scope                                                                          |
| 19  | X          | Allow-listing `kill <digits>` admits `kill 0`, `-1` and negative pids                                                                                | **accepted**            | D2: only a pid of 2 or more; the broad forms denied                                                                            |
| 20  | S, R       | Slot nesting through an env var; the duplicate lessons entry                                                                                         | **accepted**            | D3: HELD must match the live pid; D2's lessons line extends #554's entry                                                       |

### Re-review (all five; one light pass each)

No blocker survived, and the reshaping added none. These were folded in:

- **C:**
  - tests set `MAT_PLAN_HEAVY_SLOT_PATH`, so they never touch a live lock;
  - push runs' concurrency group is keyed by `github.sha`, because GitHub keeps one pending run per
    group;
  - a fresh lock is restored with `link`, not `rename`.
- **S:**
  - PR 3 no longer waits for PR 2;
  - PR-body entries reach the script through `env:`, never `${{ }}` inside `run:`.
- **X:**
  - the hook contains the exact no-op text `review-prefetch.sh` greps for;
  - a `workflow_dispatch` run never publishes.
- **R:**
  - the kill guard's wrapper list matches its sibling's;
  - the deferred shared walk gets a tech-debt entry in PR 1b.
- **A:** 1a and #554 share one line in `package.json` and one in AGENTS.md; whichever merges second
  merges main.
