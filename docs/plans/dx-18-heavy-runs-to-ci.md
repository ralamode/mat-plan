# DX-18 — heavy runs move to GitHub CI; the machine keeps one slot

> Backlog: [plan.md](../plan.md) → `DX-18` (added by this plan). Branch: `docs/dx-18-heavy-runs-to-ci`
> (this plan), then one branch per PR below. Assigned to the Native Scaling lane by the maintainer
> _(orchestrator's chat, 2026-11-17)_: "move everything heavy off of the local machine unless
> otherwise stated."

## Where this sits

- **Pillar:** Platform (CI, hooks, the agent tooling). **Milestone:** none directly. It unblocks every
  lane of Beta 0, which today queues for one machine.
- **This plan:** the whole of DX-18, as four PRs. PR 1 needs nothing. PR 2 waits for lane A's #554,
  which changes the mutation runner. PRs 3 and 4 need nothing but are ordered after PR 2, because
  they share `ci.yml`.
- **Gated on:** the maintainer's approval of this plan.

_Roadmap alignment (2026-11-17): advances `DX-18`; touches nothing in `ID-1`, the catalog or the
household scope; supersedes the parts of DX-5(b) and SEC-5 that call `db:mutations` local-only;
checked against the private roadmap, nothing else to add._

## Why now

Several lanes run `pnpm verify`, `pnpm e2e:local`, `db:mutations` and the pre-push hook on one machine.
On 2026-11-17 the load average passed 200:

- tests timed out at their limits (`approvals.test.ts`, `harness.test.ts`);
- one e2e run lost a server action under load;
- one lane killed another's mutation run with `pkill -f`.

The board ran a hand-allocated "one slot" queue all afternoon. The maintainer's rule is now **one heavy
local run at a time, machine-wide, and everything heavy on GitHub CI**.

## What is true today (fact sheet, origin/main 2026-11-17)

| Claim                                                                        | Truth                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-push runs "typecheck + affected tests" (AGENTS.md)                       | **False.** `.husky/pre-push` is `pnpm typecheck` and `pnpm test`, the whole vitest run of about 2,400 cases in 157 files, `packages/*` included (`apps/web/vitest.config.ts`)                                                                                             |
| `db:mutations` is local-only                                                 | True. No workflow runs it. There are 240 patches, and **each runs a full `db:verify`**, serially (`packages/db/scripts/mutations.mjs:44-81`). The whole run's time is **unmeasured** (tens of minutes under 2026-11-17's load; PR 2 measures one shard on a runner first) |
| `pnpm verify` takes "~40s" (AGENTS.md), "~35s" (ship-pr), "~25s" (tech-debt) | **False on all three.** `db:mutations` alone is tens of minutes. The figures predate the mutation count                                                                                                                                                                   |
| CI has required checks                                                       | **None.** The ruleset holds only `deletion` and `non_fast_forward`. DoD:57 says "required check", and that is wrong                                                                                                                                                       |
| CI skips work by path                                                        | Only e2e does, at step level, by an `INERT` file list (`ci.yml:463-507`). Every other step runs on every PR                                                                                                                                                               |
| Screenshots                                                                  | Local only: `screenshot:ephemeral` (embedded Postgres, no secrets), then `screenshots:publish`, which writes the `screenshots` branch and comments through the keyring `gh` token                                                                                         |
| A kill guard                                                                 | None. The PreToolUse hook (`guard-main-checkout.mjs`) guards only the main checkout                                                                                                                                                                                       |
| Killed `db:mutations` leaves a patch in source                               | True on main (lessons.md:705, :948). Lane A's **#554** fixes it with a journal, a per-worktree lock and signal-safe restore                                                                                                                                               |

## Decisions

**D1. The four PRs, in order.**

| PR  | Delivers                                                                                                                               | Waits for                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 1   | The kill guard (F); the heavy-run slot (E); the slim pre-push (D); `test:changed`; the when-to-run guidelines and every doc fix (G, H) | nothing                               |
| 2   | `db:mutations` in CI, sharded and path-scoped (A), plus the runner's `--shard` / `--only` flags (H's subset command)                   | #554 merged (it owns `mutations.mjs`) |
| 3   | Pillar-scoped CI (C): one changed-scopes step, which every heavy step reads                                                            | PR 2 (both edit `ci.yml`)             |
| 4   | Screenshots in CI (B)                                                                                                                  | PR 3 (it reads the scopes)            |

PR 1 comes first because it is the immediate relief. It turns the board's manual queue into a lock
and halves the cost of every push. The CI PRs then take the remaining load off the machine.

**D2. The kill guard (F).** A new `.claude/hooks/guard-process-kill.mjs`, registered as a second
`PreToolUse` Bash hook beside `guard-main-checkout.mjs`. It applies in every directory, not just the
main checkout. It reuses that hook's lexer (`invocations()`), extracted into
`.claude/hooks/shell-lex.mjs` so the two hooks share one parser.

It **denies**:

- `pkill` and `killall` in any form;
- `kill` whose argument is a substitution or a pipe (`kill $(pgrep …)`, `pgrep … | xargs kill`).

It **allows** `kill <digits>`, `kill -<SIG> <digits>` and `kill %<job>`.

The deny reason says: "stop only a process you started, by the PID you captured (`$!`), or let it
finish. Other lanes run the same scripts on this machine." Like its sibling, it fails open and is a
no-op under `CI`. Its cases go in `hooks.test.sh`. `MAT_PLAN_ALLOW_PATTERN_KILL=1` is the escape for a
person who means it, the same shape as the existing `MAT_PLAN_ALLOW_MAIN_CHECKOUT=1`.

**D3. The heavy-run slot (E).** A new `scripts/heavy-slot.mjs`, prefixed onto each heavy script in
`package.json`: `verify`, `e2e:local`, `db:mutations`, `screenshot:ephemeral`, `db:verify` when run
on its own, and `pnpm test` when run on its own (the pre-push hook no longer calls it).

- **Where the lock lives:** `$(git rev-parse --git-common-dir)/mat-plan-heavy-slot.json`. That
  directory is shared by every worktree of the clone, which is what "machine-wide" means here (every
  lane uses a worktree of this clone).
- **What it holds:** `{ pid, lane, command, started }`, where `lane` is the branch name.
- **How it is taken:** created atomically (`open(…, 'wx')`).
- **How a dead holder is noticed:** a lock whose `pid` no longer exists (`process.kill(pid, 0)`
  throws `ESRCH`) is stale; it is removed and taken.
- **When it is busy:** the command exits 2 with **"heavy-run slot held by `<lane>` (`<command>`,
  since `<time>`). Push and let CI gate it, or wait."** It never queues silently.
- **Release:** in a `finally` and on SIGINT, SIGTERM and SIGHUP. A `kill -9` leaves a stale lock,
  which the next taker clears.
- **Bypass:** none when CI is set (CI runners each have their own machine), and
  `MAT_PLAN_HEAVY_SLOT=off` for a person.
- **Nesting:** `verify` takes the slot once. Its inner `db:mutations` sees
  `MAT_PLAN_HEAVY_SLOT_HELD=<pid>` from its parent and does not wait on itself.

**D4. The slim pre-push (D) and `test:changed`.** `.husky/pre-push` becomes `pnpm typecheck` then
`pnpm test:changed`.

- **What `test:changed` runs:** `vitest related --run` on the files changed against the upstream
  merge base (`git merge-base HEAD @{upstream}`, or `origin/main` when there is no upstream).
  `vitest related` runs every test whose import graph reaches a changed file. That covers a changed
  test file and every test of a changed module, and it is what AGENTS.md has claimed all along.
- **When nothing reaches the change** (docs only), it runs nothing and says so.
- **Pre-push is not a merge gate** (AGENTS.md: CI is), so this narrows a local courtesy, not a gate.
  CI's `quality` job still runs the whole suite on every PR (and PR 3 keeps it on every code PR).
- **Not wrapped in the slot:** a related run is small. The full suite stays in CI.

**D5. The when-to-run-locally rule (H), written once.** AGENTS.md's "Local hooks vs CI merge-gates"
stays the one list; ship-pr, start-task and the DoD point to it.

- **Run locally:**
  - writing code (one file, one probe);
  - debugging a CI failure;
  - `pnpm probe`;
  - editing CI itself;
  - an Actions outage;
  - `pnpm dev`;
  - production operations (corrections, never tests against production).
- **Everything else heavy runs on CI:** push, and let it gate.
- **`pnpm verify` before a PR becomes optional.** CI is the gate, and the section says so plainly.
- **Filtered commands** the section carries, copy-paste ready:
  - one vitest file or name: `pnpm --filter web exec vitest run <path> -t "<name>"`;
  - one package's tests: `pnpm --filter web exec vitest run ../../packages/shared/src`;
  - what a change reaches: `pnpm test:changed`;
  - a subset of mutations (PR 2): `pnpm --filter @mat-plan/db db:mutations --only 271-278` or
    `--only <name-substring>`;
  - one Playwright spec or name: `pnpm e2e:local e2e/<spec>.ts -g "<name>"` (args already pass
    through).

**D6. `db:mutations` in CI (A).** A new `mutations` job in `ci.yml`, with an 8-way matrix:
`shard: [1, …, 8]`.

- **Each shard** runs `db:mutations --shard <i>/8`, which takes the patches whose sorted index modulo
  8 equals `i − 1`.
- **Path scope, derived rather than hand-written:** a step computes the PR's changed files against
  the resolved base. It also computes the union of the paths any `*.patch` touches (`git apply
--numstat`), plus `packages/db/**` and `packages/shared/**`, because `db:verify` imports from both.
- **If the two sets don't meet,** every later step is skipped at step level and the shard reports
  success with "no mutated path changed". It is never a job-level `if:`, so the check is always
  reported (ci.yml's e2e pattern).
- **Default to run** when the file list cannot be read, or on any `push` to main.
- **A full nightly run** (`schedule`) covers changes the filter missed, which keeps "nothing goes
  unrun" true.
- **Runner flags** (`--shard`, `--only`) are added to `mutations.mjs` after #554 merges, on top of its
  journal. The flags only choose which patches run; each patch's apply, verify and restore are
  #554's, unchanged.
- **The job needs nothing but `github.token`** and the repo: PGlite, no database service, no secret.

**D7. Pillar-scoped CI (C).** One step, `changed-scopes`, runs early in each job. It calls
`.github/scripts/changed-scopes.mjs`, which reads the changed files and prints booleans: `web`, `db`,
`docs_only`, `catalog_data_only`, `workflows`.

- The e2e job's `INERT` regexes move into that script, so there is one definition of "inert".
- **What a scope skips:**
  - `docs_only` skips `build`, e2e and the mutations job;
  - `catalog_data_only` (only `packages/shared/src/catalog/data/**`, the changelog and the data
    guide) skips `build` and e2e, and still runs `test`, `db:verify` and the append-only check;
  - a PR with no `db` scope skips the mutations job.
- **What never skips:** `format:check`, `lint`, `typecheck`, `test`, gitleaks, the guards, the audit
  and the status check. They are fast, and they are the gate.
- **Fail-safe:**
  - a script error, or an unreadable file list, means every scope is `true`;
  - a `push` to main means every scope is `true`;
  - a change under `.github/` means every scope is `true`, so CI changes test themselves in full.
- `changed-scopes.test.sh` joins `guards:test`.

**D8. Screenshots in CI (B).** Two workflows, the standard split for untrusted PRs:

1. **`screenshots.yml`** (`pull_request`, `permissions: contents: read`, no secrets).
   - It runs when the `web` scope is true and the change touches `apps/web/app/**` or
     `apps/web/components/**`, or when the PR has a `screenshots` label.
   - It builds, runs `screenshot:ephemeral` (embedded Postgres, no credentials: it blanks Clerk,
     Upstash and Sentry itself), and uploads `.screenshots/` as an artifact with the PR number.
2. **`screenshots-publish.yml`** (`workflow_run` on the first, `permissions: contents: write,
pull-requests: write`).
   - It downloads the artifact and runs `screenshots:publish --pr <n> --comment` with
     `github.token`.
   - It **does not check out or run the PR's code.** It runs main's publish script against the
     artifact's image files only.
   - It refuses an artifact whose PR number doesn't match the triggering run's PR, and any file that
     isn't a `.png`.

A fork PR's capture runs with no token that can write anything. The publish step runs trusted code on
untrusted bytes, the documented safe pattern. `publish-screenshots.ts` gains a `GH_TOKEN` path
alongside its keyring path.

**D9. Splitting tests by pillar (I): what is built now, and what is deferred.**

- **Built now (PR 1):** `test:changed` (D4), the cheap, exact half: it follows imports, not a
  hand map.
- **Built now (PR 3):** CI scopes by pillar for the heavy jobs (D7).
- **Deferred to a new row, `DX-18b`:** `pnpm test:pillar <name>`, and CI running only the affected
  pillars' vitest files.
  - **Why deferred:** the roadmap's pillar globs are prose in a table, not machine-readable, and
    vitest runs as one project. Splitting it means one vitest project per pillar, built from the
    feature guides' `owns:` frontmatter, which `guides:check` already parses.
  - **What it costs:** that changes how 157 files are collected, and needs a proof that every test
    file belongs to exactly one project, so none goes unrun.
  - **Why it can wait:** `test:changed` already gives a local run its pillar's reach, and CI's full
    `test` time on a runner is to be read from the `quality` job's step timings (_unverified_; PR 1 records it). The row records the design (projects from `owns:`, a
    coverage proof, and a full run on main) so the next owner does not start over.

## File-by-file

| PR  | Path                                                                        | Change   | What & why                                                                                                                                                                                                                    |
| --- | --------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `.claude/hooks/shell-lex.mjs`                                               | NEW      | `invocations()` lifted out of `guard-main-checkout.mjs`, unchanged                                                                                                                                                            |
| 1   | `.claude/hooks/guard-main-checkout.mjs`                                     | EDIT     | Imports the lexer                                                                                                                                                                                                             |
| 1   | `.claude/hooks/guard-process-kill.mjs`                                      | NEW      | D2                                                                                                                                                                                                                            |
| 1   | `.claude/settings.json`                                                     | EDIT     | The second `PreToolUse` Bash hook                                                                                                                                                                                             |
| 1   | `.claude/hooks/hooks.test.sh`                                               | EDIT     | Deny and allow cases for D2. The lexer move is covered by the existing 221 cases                                                                                                                                              |
| 1   | `scripts/heavy-slot.mjs` + `scripts/heavy-slot.test.sh`                     | NEW      | D3. The test takes the lock, refuses a second taker, clears a dead holder's lock, nests, and is a no-op under CI                                                                                                              |
| 1   | `package.json`                                                              | EDIT     | The heavy scripts gain the slot prefix; `test:changed`; `guards:test` gains the slot's suite                                                                                                                                  |
| 1   | `.husky/pre-push`                                                           | EDIT     | `pnpm typecheck && pnpm test:changed` (D4)                                                                                                                                                                                    |
| 1   | `AGENTS.md`                                                                 | EDIT     | "Local hooks vs CI merge-gates": the when-to-run rule, the filtered commands, the slot, the guard; fixes the stale claims (pre-push "affected tests", the verify time, the guard count, `eval` missing from the list, Squawk) |
| 1   | `.claude/skills/ship-pr/SKILL.md`, `.claude/skills/start-task/SKILL.md`     | EDIT     | Point to the one list; `pnpm verify` optional before a PR; the "~35s" figure removed                                                                                                                                          |
| 1   | `docs/definition-of-done.md`                                                | EDIT     | Line 57: no check is required; CI green is the bar                                                                                                                                                                            |
| 1   | `docs/lessons.md`                                                           | EDIT     | The 2026-11-17 entries: a pattern kill across lanes; load timeouts that look like failures (symptom, cause, fix)                                                                                                              |
| 1   | `docs/plan.md`, `docs/roadmap.md`, changelog fragment                       | EDIT/NEW | The `DX-18` and `DX-18b` rows; the item moves to In flight                                                                                                                                                                    |
| 2   | `packages/db/scripts/mutations.mjs` (after #554)                            | EDIT     | `--shard i/n`, `--only <range or substring>`                                                                                                                                                                                  |
| 2   | `packages/db/scripts/mutations.test.sh` (#554's)                            | EDIT     | Shard partitioning (every patch in exactly one shard), and `--only` selection                                                                                                                                                 |
| 2   | `.github/workflows/ci.yml`                                                  | EDIT     | The `mutations` matrix job; its path-scope step; the `schedule` trigger for the nightly full run                                                                                                                              |
| 2   | `AGENTS.md`, `docs/tech-debt.md`, `packages/db/scripts/mutations/README.md` | EDIT     | `db:mutations` is no longer local-only; how to read a red shard                                                                                                                                                               |
| 3   | `.github/scripts/changed-scopes.mjs` + `.test.sh`                           | NEW      | D7                                                                                                                                                                                                                            |
| 3   | `.github/workflows/ci.yml`                                                  | EDIT     | Each heavy step reads the scopes; e2e's `INERT` moves into the script                                                                                                                                                         |
| 3   | `AGENTS.md`, `docs/plans/ci-e2e-auto-skip.md`                               | EDIT     | Which job runs for which change                                                                                                                                                                                               |
| 4   | `.github/workflows/screenshots.yml`, `screenshots-publish.yml`              | NEW      | D8                                                                                                                                                                                                                            |
| 4   | `apps/web/scripts/publish-screenshots.ts`                                   | EDIT     | The `GH_TOKEN` path; refuse a mismatched PR number or a non-PNG file                                                                                                                                                          |
| 4   | `.claude/skills/ui-screenshot/SKILL.md`, `AGENTS.md` (UI PR rules)          | EDIT     | Screenshots come from CI; a local capture is for debugging                                                                                                                                                                    |

**Size:** PR 1 is about 350 lines, half of it docs; PR 2 about 150; PR 3 about 200; PR 4 about 200.

## Test plan

- **PR 1:**
  - `hooks.test.sh` gains about 20 kill cases (each deny form, and the PID and job forms allowed);
  - `heavy-slot.test.sh` covers a second taker refused with the message, a dead holder cleared,
    nesting, and CI;
  - the pre-push hook is exercised by the PR's own push;
  - `test:changed` on a docs-only diff runs nothing, and on a one-file diff runs that file's tests.
- **PR 2:**
  - the shard test proves every patch runs in exactly one shard;
  - a probe PR that touches `packages/db/` shows all 8 shards run;
  - a docs-only change shows all 8 report "no mutated path changed";
  - one deliberately broken mutation goes red in its shard.
- **PR 3:**
  - `changed-scopes.test.sh` covers every scope, including the fail-safe cases;
  - three probe PRs (docs only, catalog data only, UI only) show the right steps skipped;
  - a `.github/` change runs everything.
- **PR 4:**
  - a same-repo UI PR gets its screenshot comment;
  - the publish step refuses a crafted artifact;
  - a fork is simulated by a PR from a branch with no labels and no secrets referenced.
- **Every PR** is gated by CI, with no local `pnpm verify`. The new suites are light and run in
  `guards:test`.

## Risks / rollback

- **A scope filter skips something it shouldn't.**
  - Fail-safe to run everywhere (D7).
  - A full run on every `push` to main, and nightly for mutations.
  - A `.github/` change runs everything.
  - The filter is a tested script, not inline YAML.
- **The slot blocks a person who needs to run now:** `MAT_PLAN_HEAVY_SLOT=off`, and the busy
  message says who holds it.
- **A stale lock after `kill -9`:** cleared by the next taker, via the pid check.
- **Mutations in CI cost minutes.** There are 8 shards on PRs that touch the DB, and none otherwise.
  The repo is public, so Actions minutes on standard runners are free; the cost is queue time.
- **The screenshot publish step runs on a fork's artifact:** it runs only trusted code, takes PNG
  files only, and checks the PR number.
- **Rollback:** each PR reverts on its own. The slot and the guard each have a person's bypass.

## Out of scope

- Making any check _required_ in branch protection. That is the maintainer's setting, unchanged.
- The Neon-branch migration rehearsal (tech-debt's "last unwired CI gate").
- `next build` in `pnpm verify`.
- Per-pillar vitest projects (`DX-18b`, D9).

## Open questions

- **Q1 (the maintainer's):** should a push to main run the mutation shards every time, or only when
  the DB scope changed, with the nightly full run as the backstop? **Recommended: only when
  changed,** because main merges are frequent and the nightly run catches what the filter misses.

## Review-response log (adversarial panel)

_Pending._
