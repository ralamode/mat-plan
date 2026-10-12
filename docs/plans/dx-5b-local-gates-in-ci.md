# DX-5(b) — the three local-only gates run in CI

> Backlog: [plan.md](../plan.md) row DX-5, part (b). Implementation branch:
> `chore/dx-5b-local-gates-in-ci`. Precedent: [SEC-5](./sec-5-verify-in-ci.md), which wired the audit
> third of (b) and set the shape this plan follows.

## Revised 2026-10-12 — what the five-lens panel changed

The first draft had **three blocking defects**, each found by a lens that could not see the others'
work. Two of them were reached independently by two lenses:

1. **The draft's headline "measured fact" was false.** It said `pnpm <script>` runs with no
   `node_modules`, which made "before Install" a free fail-fast. On pnpm 11, `verify-deps-before-run`
   defaults to `install`, so the first `pnpm run` in a fresh checkout **silently performs a full
   `pnpm install`**: lifecycle scripts, no `--frozen-lockfile`, inside a step named "Skills guard".
   The author's probe had checked for `node_modules` _before_ running the script, not after. Re-run
   both ways (Measured facts): default mode installs, and `pnpm_config_verify_deps_before_run=false`
   does not. _(Security.)_
2. **The label escape hatch could not work.** A re-run replays the original event payload, so a label
   added after the run never reaches `github.event.pull_request.labels`. This repo has proof: PR #67's
   `ci-skip-e2e` was ignored by a re-run 24s after it was added and honoured only by the next push.
   The same defect sits under `docs-skip-feature-map` today, and nothing documents it.
   _(Correctness, Architecture.)_
3. **A green run would have painted the job summary with ~7 "review-prefetch refused" lines.**
   `review-prefetch.sh`'s `die()` appends to `$GITHUB_STEP_SUMMARY`, and its self-test does not
   redirect it. The draft's acceptance 4 checked only annotations. _(Architecture, Correctness,
   Security — three lenses.)_

The rest is in the review-response log at the end.

## Goal

`skills:check`, `guards:test` and `status:check` are real guards with self-tests, and **none of them
runs in CI.** They run only when someone remembers `pnpm verify` or `ship-pr` step 3
(`AGENTS.md:369`: _"run **only here, not in CI**"_). A PR from a session that skipped them, or a guard
whose self-test has only ever passed on macOS, is invisible until it bites. This PR adds them to
`quality` and deletes the standalone audit self-test step SEC-5 left for (b) to remove.

Why now: Platform's next item ([roadmap](../roadmap.md) → Next per pillar). It is disjoint from the
two lanes in flight (PRIV-2: landing page + access gate; TEN-2c: `packages/db`), and none of its files
is owned by a feature guide.

## Acceptance

Verbatim from `docs/plan.md` → DX-5:

> (b) a CI change to run `skills:check`, `guards:test` and `status:check` (DX-2's guard), which needs
> its own plan and panel. **The audit third of (b) is done** — SEC-5 wired `audit:check` into `quality`
> and carved its own self-test out of `guards:test` as a standalone step; **(b) deletes that step** when
> it wires `guards:test` properly, and could reasonably take `check-action-pins.test.sh` with it
> (offline, fixture-only, ~1s)… Then update AGENTS.md's gate list…

Done when:

1. `quality` runs `pnpm skills:check` and `pnpm guards:test` on every run (PR and push to `main`), and
   `pnpm status:check` on every PR. All three run **before** `Install (frozen lockfile)` **and install
   nothing**, which a following step asserts (`node_modules` absent).
2. The standalone "Audit guard self-test" step is gone. All nine suites, including `check-audit` and
   `check-action-pins`, run in CI from the one `package.json:35` definition. The green log shows each
   suite's pass line.
3. **Each gate is seen red at the level CI adds.** The red proofs in the Test plan, each linked from
   the PR description.
4. A green run carries **zero annotations and an empty job summary** from the guard steps. No
   self-test writes to the real `GITHUB_STEP_SUMMARY`, `GITHUB_OUTPUT` or `GITHUB_ENV`.
5. `status:check` judges the PR's real branch name: the green log has no "detached HEAD" line, and a
   wrongly named fragment goes red. The `docs-skip-changelog` label maps to `STATUS_SKIP`, takes
   effect **on the next push**, and never bypasses the frozen-history check.
6. **One place says where each gate runs:** AGENTS.md → "Local hooks vs CI merge-gates". Every other
   doc that claims a location either points there or stops claiming one. That includes the
   `actions:check` "single definition" sentence, which is false today.

## Measured facts (2026-10-12, macOS, pnpm 11.13.1)

- **`pnpm run` in a fresh clone installs first, unless told not to.** In a clone with no
  `node_modules`:
  - `CI=true pnpm run skills:check` exits 0, prints an install (`Done in …`), and leaves
    `node_modules` behind.
  - `pnpm_config_verify_deps_before_run=false CI=true pnpm run skills:check` exits 0, installs
    nothing, and leaves no `node_modules`.
  - The mechanism, at the pinned source per the security lens (pnpm `v11.13.1`, `85e3b80`):
    `config/reader/src/index.ts:211` defaults `verify-deps-before-run` to `'install'`;
    `exec/commands/src/run.ts:206-207` checks before every script; `runDepsStatusCheck.ts` spawns a
    plain `pnpm install`. The env var outranks `pnpm-workspace.yaml` (`config/reader/src/index.ts:1074-1079`).
- **Every guard script imports only `node:` builtins** (grep of `.github/scripts/*.mjs` and
  `.claude/hooks/*.mjs`), so with the override they truly need no install.
- **All three pass on `main` today**, with and without `CI=true GITHUB_ACTIONS=true`.
  `guards:test` takes ~50s: `hooks.test.sh` ~23s, `check-status-touched.test.sh` ~10s.
- `guards:test` is **nine** suites (`package.json:35`). **None has ever run on ubuntu** (R1).
- The hook self-tests already run under `env -u CI -u GITHUB_ACTIONS`
  (`hooks.test.sh:39,41,307,337`) and assert the CI no-op deliberately (`:284-288`), so CI does not
  disarm them.
- **The only `GITHUB_*` file writes in any guard** are `review-prefetch.sh:33` (`die()` →
  `GITHUB_STEP_SUMMARY`) and its `head_sha=` line (→ `GITHUB_OUTPUT`). In the test,
  `review-prefetch.test.sh:54` (`run()`) redirects `GITHUB_OUTPUT` only, and case 1a (`:79`)
  redirects neither. `::error::` from `check-audit.test.sh:21` / `check-preview-isolation.test.sh:29`
  fires only on a failed case.
- `status:check` (`check-status-touched.mjs`):
  - An empty base exits 2 (`??` at `:73` keeps `''`), so the step is PR-only.
  - The branch comes from `STATUS_BRANCH`, else `rev-parse` (`:85-87`). On the PR merge ref it is
    detached, which only warns (`:89-96`) and accepts any generic-shaped fragment.
  - `STATUS_SKIP` is read at `:241-242` via `?.trim()`, so `''` counts as unset. The frozen-history
    check exits at `:151-161`, before the skip is read.
  - The failure text (`:262-264`) offers only the env var, which a CI reader cannot set.
- **Labels in `ci.yml` are read from the event payload** (`:236` and the e2e guard), and PR #67 shows a
  re-run does not refresh them.

## Decision 1 — three steps in `quality`, before `Install`, with deps verification off

They run through **`pnpm <script>`**, so `package.json` stays the one definition. They sit between
`Setup Node` and `Install`, and `pnpm_config_verify_deps_before_run: 'false'` is set **on the job**:

- The env var is set once, not three times. After the explicit `Install` it is moot, because deps are
  then up to date.
- It also covers any `pnpm` step someone later adds before `Install`. That is the trap this panel
  found, and it is worth closing for the whole job rather than per step.

The order is **cheapest and most likely to fail first**: skills (~1s), status (~1s), then guards
(~50s). Then a one-line assertion proves nothing was installed.

```yaml
quality:
  env:
    # pnpm 11 defaults verify-deps-before-run to `install`: the first `pnpm run`
    # in a fresh checkout would silently `pnpm install` (lifecycle scripts, no
    # --frozen-lockfile) before the explicit Install step below. Off for the
    # whole job; after Install it is moot. docs/lessons.md → pnpm.
    pnpm_config_verify_deps_before_run: 'false'
  steps:
    # … checkout, action pins, forward-only, squawk, feature guides, Setup pnpm, Setup Node …

    # ── Local gates in CI (DX-5(b)) ───────────────────────────────────────
    # Through pnpm, so package.json stays the single definition. Steps that must
    # run before `Setup pnpm` (action pins, feature guides) call `node` directly;
    # that is the only exception. These are integrity checks for honest authors,
    # not a security boundary: a PR runs its own copy of every script here.
    - name: Skills guard
      run: pnpm skills:check

    - name: Status guard (changelog fragment)
      if: github.event_name == 'pull_request'
      env:
        BASE_SHA: ${{ github.event.pull_request.base.sha }}
        # Step-level, never job-level: the status self-test (in "Guard
        # self-tests") never sets STATUS_BRANCH, so a job-level one would leak
        # into its detached-HEAD cases. Passed via env only, never into run:,
        # because head_ref is attacker-controlled on a fork PR.
        STATUS_BRANCH: ${{ github.head_ref }}
        # Read from the event payload, so the label takes effect on the NEXT
        # PUSH, not on a re-run (AGENTS.md → CI checks). The literal mirrors
        # SKIP_LABEL in check-status-touched.mjs.
        STATUS_SKIP: >-
          ${{ contains(github.event.pull_request.labels.*.name, 'docs-skip-changelog')
              && 'docs-skip-changelog label' || '' }}
      run: pnpm status:check "$BASE_SHA"

    - name: Guard self-tests
      run: pnpm guards:test

    - name: Assert the guards installed nothing
      run: test ! -e node_modules || { echo '::error::a guard step ran pnpm install'; exit 1; }

    # … Install (frozen lockfile), audit, format, lint, …
```

**Delete** the "Audit guard self-test" step and its banner. `check-audit.test.sh` is suite 8 of
`guards:test`.

## Decision 2 — the skip label: `docs-skip-changelog`, honest about re-runs

- **Name: `docs-skip-changelog`**, following `<scope>-skip-<gate>` (`ci-skip-e2e`,
  `docs-skip-feature-map`). It skips only the changelog fragment, which is a docs artifact. The frozen
  check runs regardless. _(Architecture S4; it overturns the draft's `status-skip`.)_
- **It maps to `STATUS_SKIP`, not a step-level `if:`.** A skipped step would also skip the
  frozen-history check, which the script makes unskippable on purpose (`:16`, `:158`).
- **It takes effect on the next push.** The other options were rejected:
  - **Reading labels live** (`gh api …/labels` + `pull-requests: read`) widens `quality`'s token and
    adds a network call to a step that is offline today.
  - **A `labeled` trigger** re-runs build + e2e on every label change.

  Pushing is what already works for `ci-skip-e2e`, as PR #67 proved. The fix is to say so: **one
  sentence in AGENTS.md → CI checks covers all three labels** ("labels are read from the event; after
  adding one, push a commit — a re-run will not see it"), plus a `lessons.md` entry with the #67
  evidence.

- **The label literal lives in two places, each pointing at the other.** It's `SKIP_LABEL` in
  `check-status-touched.mjs`, so the failure message can name it, and the YAML expression, which a
  script cannot reach. This is the `docs-skip-feature-map` precedent (`check-feature-guides.mjs:22` +
  `ci.yml:236`). Passing all labels in and mapping them in the script was considered. That makes one
  copy, but it is new parsing logic plus a self-test case for a two-copy problem that a comment
  already bounds. _(Reuse S2, option b.)_
- The CI skip reason is `'docs-skip-changelog label'`, not a sentence claiming "the reason is in the
  description". The script prints that reason as text to paste into the PR description, so the draft
  string was circular. _(Reuse, also-found.)_
- **The label rule is written once, in [docs/changelog/README.md](../changelog/README.md)**, which
  already owns "the rule". Everything else links to it. _(Reuse S1.)_
- The label is created on the repo (`gh label create docs-skip-changelog`) as an implementation step, **and so is `docs-skip-feature-map`**. It is documented at `AGENTS.md:347` but `gh label list` shows it does not exist, so that escape hatch cannot be applied today. _(Architecture round 2, outside the diff.)_

## Decision 3 — ubuntu is the target; harness-only fixes, bounded

The CI guards (`check-audit`, `check-action-pins`, `check-preview-isolation`, `check-status-touched`)
execute on ubuntu, so their self-tests must pass there. Cloud agent sessions run Linux too.

**The bound:** a suite is changed in this PR only for **portability** (GNU vs BSD, bash 5 vs 3.2,
locale) or **CI isolation** (not writing into the real runner's files), and never by removing or
loosening an assertion. `hold-the-bar` runs on the diff. The one isolation fix already known:

- `review-prefetch.test.sh`: `run()` (`:54`) and case 1a (`:79`) set
  `GITHUB_STEP_SUMMARY="$tmp/summary"` and `GITHUB_OUTPUT="$tmp/gho"`. The refusal cases then
  **assert** the refusal reached `$tmp/summary`, which turns the leak into a stronger test.

**If ubuntu needs more than that:** stop and re-plan. No macOS fallback job. It would add a check name
DX-5(a) inherits, and it would quietly move `check-audit`'s self-test off the platform its guard runs
on. _(Scope N1, Architecture S3.)_

**Implementation order de-risks R1:** the first push to the PR carries only the `Guard self-tests`
step (plus the job env), so the ubuntu verdict arrives before any doc work.

## File-by-file changes

| Path                                                     | Change                 | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`                               | EDIT                   | The job `env`, the four steps (Decision 1), and deleting "Audit guard self-test" and its banner.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `.github/scripts/check-status-touched.mjs`               | EDIT                   | Add `SKIP_LABEL = 'docs-skip-changelog'`. The failure text (`:262-264`) names it ("in CI: add the `docs-skip-changelog` label and push"). The header (`:36`, `:39-40`) stops claiming "local-only" and links to AGENTS.md. The owes/skip/frozen logic is unchanged.                                                                                                                                                                                                                                                                                                                                                                       |
| `.github/scripts/check-status-touched.test.sh`           | EDIT                   | One case: the failure text names `SKIP_LABEL`, so the message and the const cannot drift.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `.github/scripts/review-prefetch.test.sh`                | EDIT                   | CI isolation (Decision 3): redirect `GITHUB_STEP_SUMMARY` / `GITHUB_OUTPUT` in `run()` and case 1a, and assert refusals land in the scratch summary.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| other `*.test.sh`                                        | EDIT, only if R1 bites | Portability fixes under Decision 3's bound, each listed in the PR with the ubuntu failure it fixes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `AGENTS.md`                                              | EDIT                   | "Local hooks vs CI merge-gates" becomes **the** list: `skills:check`, `guards:test` and `status:check` run in `verify` and CI. `db:mutations` stays local-only, with no comparison. The `actions:check` sentence says what is true (CI calls `node` directly, before pnpm exists). `:273` points at that list. One sentence on labels being read from the event (push, don't re-run). `docs-skip-changelog` joins the label prose at `:347`. `:347` and `:410` (`ci-skip-e2e`) each get a "(push to apply)" pointer to that sentence. `:387`'s "plus its own self-test before the install" becomes "its self-test runs in `guards:test`". |
| `.claude/skills/README.md`                               | EDIT                   | `:33-34` stops claiming a location and links to AGENTS.md. Two missing rows, `check-audit.mjs` and `check-preview-isolation.mjs`, are added, because `:33` says `guards:test` "runs them all". _(Architecture, outside the diff.)_                                                                                                                                                                                                                                                                                                                                                                                                        |
| `.claude/skills/ship-pr/SKILL.md`                        | EDIT                   | Step 3: keep the local `status:check` run, since it is cheaper than a CI round trip. The label lives in the changelog README. The `:169` red flag adds `docs-skip-changelog` to the labels that need a reason in the PR.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `docs/changelog/README.md`                               | EDIT                   | The one home of the label rule: what it skips, and that it never bypasses the frozen check. For when it applies, it **links** to the AGENTS.md push sentence rather than restating it.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `docs/working-with-agents.md`                            | EDIT                   | `:87` "a local check" → "a check".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `docs/features/README.md`                                | EDIT                   | `:23` (the `docs-skip-feature-map` escape hatch): add "(push to apply; see AGENTS.md → CI checks)". Today it implies adding the label is enough.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `docs/plan.md`                                           | EDIT                   | The DX-5 row: rewrite the "run only in local `pnpm verify`, never in CI" sentence (`:1031-1032`) and mark (b) done.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `docs/roadmap.md`                                        | EDIT                   | Platform: `DX-5(b)` → done.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `docs/lessons.md`                                        | EDIT                   | Two entries: **pnpm 11 `verify-deps-before-run` installs on the first `pnpm run`** (symptom: `node_modules` appears in a step that never installed), and **a re-run does not see a newly added label** (PR #67). Plus any ubuntu failure that took more than one attempt.                                                                                                                                                                                                                                                                                                                                                                 |
| `docs/changelog/<date>-chore-dx-5b-local-gates-in-ci.md` | NEW                    | The fragment. Added **last** (Test plan).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

**Not touched:** `package.json` (the definitions are already right), `docs/definition-of-done.md`, and
the SEC-5 plan's "seven" (a committed plan is a record).

## Test plan

**Order matters:** the fragment is added in the **last** commit. Until then, this `chore/` branch owes
nothing by type, and the red proofs control what it owes. _(Correctness S1 / Scope S1: with the
fragment present, two of the draft's reds could not go red.)_

Red proofs, each a temporary commit with its failing run linked in the PR description, then reverted:

1. **`skills:check`:** a skill cites a path that does not exist → red.
2. **`status:check` owes:** an empty `feat(x):` commit, no fragment → red.
3. **`status:check` reads the real branch:** the `feat(x):` commit, plus a fragment named
   `<date>-chore-wrong.md` (generic shape, wrong name). It goes red only if `STATUS_BRANCH` reached the
   script; detached mode would pass it. **Judged by its log line**, `Found, but not a valid entry for
this branch: docs/changelog/<date>-chore-wrong.md` (`check-status-touched.mjs:220`). Red alone could
   be exit 2, an earlier failed step, or red 2 again. _(Correctness S2; round 2.)_
4. **The label:** with the `feat(x):` commit and no fragment, add `docs-skip-changelog` and **push**.
   The run must be green **and** its log must show `Status guard SKIPPED (STATUS_SKIP):
docs-skip-changelog label`, not merely green.

Dropped from the draft: flipping a self-test's exit code (shell `&&` semantics, already proven per
suite) and label + frozen entry (already `check-status-touched.test.sh:191-193`, which now runs in CI).
_(Scope S2.)_

Green-run assertions:

- All nine suites' pass lines appear, the "detached HEAD" warning is absent, and the "Assert the
  guards installed nothing" step passes.
- The run's annotation list and job summary are empty for these steps.
- After merge, the push run shows `Skills guard` and `Guard self-tests` ran and `Status guard`
  skipped.
- Locally: `pnpm verify`, `guides:check`, `hold-the-bar/check.sh`, `status:check`.

## Risks / rollback

| #   | Risk                                                                                                               | Mitigation                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | A suite fails on ubuntu. A likely candidate is `review-post.test.sh:83`, a 300 × `é` byte-cap case under `C.UTF-8` | First push carries only the guards step. Harness-only fixes under Decision 3; else stop and re-plan.                                                                                                             |
| R2  | A guard step installs deps after all (a pnpm upgrade changes the default, or the env var is renamed)               | The "Assert the guards installed nothing" step fails loudly.                                                                                                                                                     |
| R3  | Summary or annotation noise from failure-path fixtures                                                             | The isolation fix to `review-prefetch.test.sh`, plus acceptance 4 checked on the real run.                                                                                                                       |
| R4  | An author adds the label, re-runs, stays red, and admin-merges                                                     | The failure text names the label **and** says "push". The AGENTS.md sentence and the lessons entry back it. None of these checks is required, so red is a signal.                                                |
| R5  | An earlier failing suite hides `check-audit.test.sh` behind the `&&` chain                                         | Accepted. The step is still red, and the first failure is the one to fix. Splitting the chain would re-type the definition.                                                                                      |
| R6  | `head_ref` injection                                                                                               | `env` only, and `execFileSync` (no shell). It is matched by a **fixed** regex (`:88`) and compared literally (`:210-215`), never compiled into a `RegExp`. Git refnames cannot contain `:`, so no `::command::`. |

**Rollback:** revert the `ci.yml` hunk. No data, deploy or migration is involved.

## Alternatives considered and rejected

- **A separate `guards` job.** It would run in parallel, but it's a new check name for ~50s (SEC-5's
  same trade), and the draft's macOS variant would move `check-audit`'s test off ubuntu.
- **Re-typing the suites in `ci.yml`.** That makes a second definition, which is the drift
  `actions:check` already shows.
- **`node …` direct calls instead of `pnpm`,** to dodge the auto-install. That also makes a second
  definition. The env var fixes the cause.
- **Live label lookup, or a `labeled` trigger** (Decision 2).
- **`if: !contains(labels, …)`.** It would bypass the frozen check.
- **Wiring `hold-the-bar/check.sh`.** It's a judgement aid, not a pass/fail gate, and out of (b).

## Out-of-scope / deferred

- **Moving the action-pins step to `pnpm actions:check`.** It deliberately runs first, before
  `Setup pnpm` (`ci.yml:34`), so it is not a one-liner. This PR only makes AGENTS.md describe it
  truthfully.
- **`persist-credentials: false` on `quality`'s checkout** _(security, outside the diff)_. It costs
  nothing and the token is read-only. It's a follow-up, not this concern.
- **A job-level `BASE_SHA`** to collapse its six copies _(reuse NIT)_. Pre-existing; a follow-up.
- **Making checks required:** DX-5(a), repo-admin. **DX-8**. **`merge_group`:** no queue exists.

## Open questions

None. The draft's two are resolved: the label name is `docs-skip-changelog` (Decision 2), and the
`actions:check` wording is fixed in AGENTS.md while the YAML move stays deferred.

## Review-response log (adversarial panel)

### Engineering panel, round 1 — correctness · scope · architecture · reuse · security

| #                 | Lens                                         | Critique (short)                                                                                 | Verdict                  | Resolution                                                                                                                                                                                     |
| ----------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1                | Security                                     | `pnpm run` with no `node_modules` silently installs on pnpm 11; the "measured fact" was false    | **accepted**             | Re-measured both ways. Job-level `pnpm_config_verify_deps_before_run: 'false'`, an assertion step, and a lessons entry. Revised banner item 1.                                                 |
| B2                | Correctness, Architecture                    | A re-run doesn't see a newly added label (PR #67 evidence)                                       | **accepted**             | The label takes effect on the next push. Documented once for all three labels, plus a lessons entry. Red proof 4 pushes.                                                                       |
| B3                | Architecture (+ Correctness S3, Security S1) | `review-prefetch.test.sh` writes refusals into the real job summary                              | **accepted**             | Isolation fix plus an assertion. Decision 3's bound widened to "portability or CI isolation". Acceptance 4 covers the summary.                                                                 |
| C-S1 / Sc-S1      | Correctness, Scope                           | The PR's own fragment makes red proofs 3 and 4 pass                                              | **accepted**             | The fragment lands last. Red 4 is judged by its log line, not green.                                                                                                                           |
| C-S2              | Correctness                                  | Nothing proves `STATUS_BRANCH` took effect                                                       | **accepted**             | Red 3 (wrong-name fragment) plus a "no detached HEAD" green assertion.                                                                                                                         |
| Sc-S2             | Scope                                        | Drop the redundant reds (exit-code flip; label + frozen)                                         | **accepted**             | Dropped, with the reason in the Test plan.                                                                                                                                                     |
| Sc-S3, R-S5, A-S5 | Scope, Reuse, Architecture                   | The AGENTS.md `actions:check` "single definition" claim is false and would be rewritten in place | **accepted, partly**     | The wording is fixed in this PR. The YAML move is **rejected for this PR**: the step deliberately runs before pnpm (`ci.yml:34`), so it isn't the one-liner the draft claimed.                 |
| Sc-S4             | Scope                                        | The plan PR must link the backlog row and move the roadmap                                       | **accepted**             | Done in this plan PR (row link, roadmap "planned", fragment).                                                                                                                                  |
| R-S1              | Reuse                                        | The label rule would be written in 4–5 places                                                    | **accepted**             | One home (the changelog README). Everything else links.                                                                                                                                        |
| R-S2              | Reuse                                        | The failure message can't name a label the script doesn't know                                   | **accepted, option (b)** | `SKIP_LABEL` const plus a mirrored YAML literal, with cross-comments, and a test pins the message. Option (a), mapping labels in the script, was rejected: new parsing for a two-copy problem. |
| R-S3, A-S4        | Reuse, Architecture                          | ship-pr's red-flag list omits the new label; the name breaks the `<scope>-skip-<gate>` pattern   | **accepted**             | Renamed `docs-skip-changelog`, added to `ship-pr:169` and `AGENTS.md:347`.                                                                                                                     |
| R-S4              | Reuse                                        | Location claims are re-copied instead of removed; two copies were missed                         | **accepted**             | AGENTS.md is the one list. The skills README and script header link to it. `working-with-agents.md:87` and `plan.md:1031` are added.                                                           |
| A-S3              | Architecture                                 | The macOS fallback un-does SEC-5's ubuntu coverage                                               | **accepted**             | Fallback removed: stop and re-plan instead (also Scope N1).                                                                                                                                    |
| A-N6, C-N1        | Architecture, Correctness                    | Order fails slow: status (1s) runs after guards (50s)                                            | **accepted**             | Order is skills, then status, then guards. The timing claim is corrected.                                                                                                                      |
| C-N2              | Correctness                                  | Make "all nine suites ran" explicit                                                              | **accepted**             | Green assertion: nine pass lines.                                                                                                                                                              |
| Se-N1, Se-N2      | Security                                     | Say "fixed regex, never compiled", and that these are not a security boundary                    | **accepted**             | R6 wording, plus a line in the step banner.                                                                                                                                                    |
| Sc-N2             | Scope                                        | The label must exist on the repo                                                                 | **accepted**             | `gh label create` as an implementation step.                                                                                                                                                   |
| A-also            | Architecture                                 | The skills README guards table lacks `check-audit` / `check-preview-isolation` rows              | **accepted**             | Two rows, since `:33` claims "runs them all".                                                                                                                                                  |
| Se-also           | Security                                     | `check-audit.test.sh` can be masked by an earlier failure in the `&&` chain                      | **rejected**             | Still red, and the first failure is the one to fix. Splitting the chain re-types the definition (R5).                                                                                          |
| Se-out            | Security                                     | `persist-credentials: false` on `quality`                                                        | **deferred**             | A real, cheap improvement, but a separate concern. Listed under Out of scope.                                                                                                                  |
| R-N6              | Reuse                                        | A job-level `BASE_SHA`                                                                           | **deferred**             | Pre-existing pattern. Follow-up.                                                                                                                                                               |
| C-also            | Correctness                                  | De-risk R1 by pushing the guards step first                                                      | **accepted**             | Decision 3, implementation order.                                                                                                                                                              |

### Engineering panel, round 2 — the lenses that raised blockers

| #    | Lens         | Critique (short)                                                                                                                                                    | Verdict      | Resolution                                                                                                                                                                              |
| ---- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C2-1 | Correctness  | All four round-1 findings resolved. Red 3 must assert its log line, or it can go red for unrelated reasons                                                          | **accepted** | Red 3 requires the `:220` line, as red 4 requires its SKIPPED line.                                                                                                                     |
| C2-2 | Correctness  | `pull_request.base.sha` vs the merge commit's first parent could disagree, so main-side `feat:` subjects could leak into `mergeBase..HEAD`                          | **deferred** | Pre-existing: the feature-guides step uses the same base. `HEAD^1` is right only on a merge-ref checkout, so the fix belongs with both steps in one follow-up, not in one of them here. |
| A2-1 | Architecture | The push rule is missing where readers learn the existing labels (`docs/features/README.md:23`, `AGENTS.md:347`, `:410`), and the changelog README would restate it | **accepted** | Pointers at all three. The changelog README links rather than restates. `docs/features/README.md` is added to the table.                                                                |
| A2-2 | Architecture | `AGENTS.md:387` still describes the standalone audit self-test step this PR deletes                                                                                 | **accepted** | Reworded in the AGENTS.md row.                                                                                                                                                          |
| A2-3 | Architecture | `docs-skip-feature-map` does not exist as a repo label                                                                                                              | **accepted** | Created alongside `docs-skip-changelog` (Decision 2).                                                                                                                                   |
| Se2  | Security     | Round-1 blocker resolved. No new findings; the job-level env var has no side effect on later steps or the pnpm-shimming self-tests                                  | —            | No change.                                                                                                                                                                              |
