# DX-13 — coverage as a post-merge measurement, and a sharper e2e budget

## Where this sits

- **Pillar:** Platform (`roadmap.md:35` owns `.github/workflows/` and `DX-*`). Also touches AGENTS.md
  and the DoD, which are **Product & Spec** globs — named so the roadmap edit is deliberate.
- **Milestone:** none — standalone DX work, requested by the maintainer (2026-11-10).
- **Ordering:** Platform's "next" is `SEC-5b` then `DX-5(a)` (`roadmap.md:91`). DX-13 goes **ahead of
  both** because it is small and unblocks nothing; that order is otherwise unchanged.
- **What gates it:** nothing. No app code, no owned feature-guide file.

**Roadmap alignment (2026-11-10):** checked against the private roadmap; nothing to add here — its
index is product features only and none depends on test tooling. No public row existed:
`git grep -inE "coverage tool|measure coverage|coverage report|test metrics"` over `plan.md`,
`roadmap.md` and `tech-debt.md` returns nothing. Added as **DX-13** (`DX-1`…`DX-12` are taken).

## Goal

Two asks, one PR _(maintainer, 2026-11-10: "test coverage (not gating or blocking) as an async
process after merge or in CI", and "ensure e2e are used sparingly still")_.

1. **Measure unit coverage on `main`, and never gate on it.**
2. **Sharpen the written rule for what earns an e2e test.** The lever is the rule, not a cap.

🔴 **Non-gating is the design constraint, not a preference.** The two ways it erodes — a threshold,
and a PR-level delta — are rejected in § Alternatives so a later PR argues with a decision, not a gap.

## Acceptance

- `pnpm --filter web test:coverage` produces a v8 report locally, **no thresholds configured**.
- Coverage runs **post-merge only**, in a workflow that never triggers on `pull_request`, so it
  cannot appear in a PR's check list **even as a skipped row**.
- `pnpm verify`, the hooks, and CI's `quality` / `e2e` jobs are unchanged in behaviour and duration.
- **Fail-loud — six independent conditions, any one of which goes red**, written as six separate
  assertions in the step so they map one-to-one:
  1. the test run exits non-zero — ⚠️ which requires an explicit `shell: bash` on that step, since
     GitHub's default is `bash -e` **without** `pipefail`, so `vitest | tee` would otherwise exit 0;
  2. `coverage-summary.json` is missing **or empty**;
  3. the summary has no `apps/web/` key;
  4. the summary has no `packages/` key;
  5. the run log contains `Excluding it from coverage`;
  6. the run log has no `Coverage summary` block — `sed` with no match exits 0, so the published
     fence would otherwise go silently empty on a green run.
     🔴 **"Either workspace missing", not "both".** The first draft of this bullet said red only when the
     summary named _no_ `apps/web/` **and** _no_ `packages/` file — which cannot catch the case it was
     added for: a mis-rooted `../../packages/*/src/**` leaves the `apps/web` keys present, so the number
     publishes green with a silently smaller denominator. Each condition is its own assertion in the
     step, never a conjunction. (`audit:check`'s rule: "could not check" is never a pass.) Red here still
     blocks no merge — the workflow runs after it.
- An **untested** file inside `include` appears in the summary at **0%** — proven, not assumed, and
  proven on a `packages/*/src` file (see § Test plan for why that file specifically).
- The docs that would otherwise become false are corrected in the same PR: `SKILL.md:120`,
  `SKILL.md:270`, `AGENTS.md:395`, `definition-of-done.md:71`.

## Decision 1 — a separate `metrics.yml`; `codeql.yml`'s frame, `migrate.yml`'s setup steps

`codeql.yml` is already this shape: `push: [main]` + `workflow_dispatch`, its own
`codeql-${{ github.ref }}` group with `cancel-in-progress: true`, `contents: read`, and a header
beginning **"DELIBERATELY NOT A PULL-REQUEST CHECK"** that points back at AGENTS.md's gate list.
`metrics.yml` takes that **trigger, concurrency, permissions and header**.

⚠️ **Its setup steps come from `migrate.yml:53-65`, not from `codeql.yml`** — which has no pnpm/Node
steps at all; the first draft conflated the two halves. That checkout → pnpm → node → install block
already exists four times (`ci.yml` ×2, `migrate.yml`, `migrate-preview.yml`), and `metrics.yml` makes
five. **That is the recorded decision, not an oversight:** `migrate-preview.yml:60-65` rules that a
local composite would **fail `pnpm actions:check`** (`check-action-pins.mjs` does not scan a local
action's own `uses:` lines), that the only de-dup shapes are a `strategy.matrix` or a `workflow_call`
— both new patterns — and ends _"Duplicating is the right call at ~4h/wk — do not 'tidy' it."_
`metrics.yml` carries a one-line pointer to that comment rather than a fifth copy of the reasoning.

**Rejected: a `coverage` job in `ci.yml` gated on `if: github.event_name == 'push'`** — cheaper, and
the scope lens argued for it. Three reasons it loses:

1. A job with a false `if` still renders as a **skipped check row** on every PR. "Cannot appear as a
   PR check" is the maintainer's constraint; a grey row inviting "why is coverage skipped on my PR?"
   is worse than no row.
2. **Once `DX-5(a)` makes checks required, a job in `ci.yml` is one branch-protection click from
   becoming a gate.** A workflow with no `pull_request` trigger cannot be.
3. Doing the same kind of thing differently from its sibling, without a reason, is what AGENTS.md's
   consistency rule forbids.

⚠️ The scope lens's rebuttal of my original concurrency argument was **right and is withdrawn**: a
coverage number for a commit `main` has moved past is worthless, so cancelling is desired, not a cost.
`cancel-in-progress: true`, for that reason. `metrics.yml` is **coverage-only for now**; whether it
becomes the general "report-only measurement" home is left open so `SEC-5b` (which wants
`cancel-in-progress: false`) decides separately rather than inheriting this file's policy.

## Decision 2 — `coverage.include` IS the honest denominator; there is no `all`

🔴 **The first draft specified `all: true`. That option does not exist in vitest 5** —
`CoverageOptions` (`plugin.d.C8mmycim.d.ts:1807`) has no `all`; the only `all?: boolean` in the file
is istanbul's `FileCoverageData` at `:1463`. Since vitest 4 an explicit `coverage.include` is the
switch that counts untested files. Three lenses caught it. Had it shipped it would at best have been
ignored while a comment claimed an honest denominator — the vacuous-guard shape this repo keeps
finding.

The argument is unchanged and is why `include` is explicit: coverage that counts only files which
already have tests **flatters**, because adding an untested module raises the number.

**`include`** (globs relative to the `apps/web` root), **every entry extension-qualified**:

```
'app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}',
'proxy.ts', 'instrumentation.ts', 'sentry.*.config.ts',
'../../packages/*/src/**/*.ts'     // needs allowExternal: true
```

🔴 **Extension-qualified because `app/**` alone sweeps in non-source files.**
`app/globals.css`, `app/design/tokens/token-sets.css` and `app/favicon.ico` all match a bare `app/**`.
Each then lands in one of two bad states: a 0-statement row that istanbul reports as **100%**, or an
`Excluding it from coverage` log line with **exit 0** — a denominator that is wrong and a run that is
green. `test.include` already uses the extension-qualified shape; this matches it.

**`exclude`:** `['**/*.test.{ts,tsx}', 'lib/dal/recording-db.ts']` — two entries, both load-bearing.
The second is **test-support code living in a production directory**: its own docblock says "TEST
SUPPORT ONLY; nothing in the app imports it", it is the recording-pool harness the DAL's emitted-SQL
proofs run on, and `lib/**` would otherwise count a file the app never executes — well covered by
construction, inflating the number by exactly the amount an honest denominator exists to prevent.
⚠️ Found by asking which **non-test** files import vitest or `@testing-library`; it is the only one,
and `apps/web/test/**` (the other support tree) is already outside the include set.
⚠️ **The first draft's exclude list was almost entirely dead, and one entry was actively harmful.**
`**/*.config.*` removed `sentry.server.config.ts` and `sentry.edge.config.ts` — the two files the
include list names **in**, both of which have a test (`sentry-config.test.ts`). Exclude wins over
include everywhere (`isIncluded` checks exclude first; the include matcher is compiled with
`ignore: exclude`), so its only effect was to count those files and then drop them. The rest
(`e2e/**`, `apps/web/test/**`, `.next/**`, `**/*.d.ts`, both `scripts/` trees) match nothing the
include globs reach, and vitest's default `coverage.exclude` is `[]` in 5.0.5, so no default list is
being replaced. Dead config that reads as a decision is what `codeql.yml`'s own header rejects.

**The `scripts/` trees are still excluded in effect, and that is still a decision worth a comment.**
The vitest config deliberately _runs_ `packages/*/scripts/**/*.test.ts` (widened at AUTH-1 1c-4a
because a test written there ran nowhere). Those tests keep executing; only the percentage ignores
them. The comment beside `coverage.include` **points at `test.include` above rather than retelling its
history**, which that config already carries at `:20-31`. `packages/evals/src` is swept **in** by the
glob — named here because the first draft spoke as though only three packages existed.

**`reporter: ['text-summary', 'json-summary']`, stated explicitly.** `text-summary` prints to
**stdout**, not to a file, so the step pipes the run through `tee` and appends that capture to
`$GITHUB_STEP_SUMMARY`; `json-summary` writes `coverage-summary.json`, which conditions 2-4 assert
against. Saying which is which here stops the implementer discovering it at the step. The default is
`['text','html','clover','json']` — which produces **no `coverage-summary.json`** (so fail-loud
condition 2 would fire every run) and still writes the `html` report this plan cut. `enabled` stays
at its default `false`, so the provider never loads during `quality`'s `pnpm test`; `reportOnFailure`
stays off, so a failed run publishes no number. **No `thresholds` key**, with a comment — its absence
is the design, and a comment is what makes that legible.

⚠️ **`test:coverage` must never take a path filter.** Untested files are added to the report only
when `allTestsRun` is true, so `vitest run --coverage lib/` silently loses the honest denominator.
The script takes no argument and the comment says why.

## Decision 3 — the e2e rule belongs in the DoD, which already half-states it

`docs/definition-of-done.md:55-63` already has **"Speed budget (enforced by review)"**: _"E2E is the
only tier allowed to take multiple seconds, so keep it minimal and very selective — a handful of
critical wiring smokes, nothing more."_ The genuinely new content is one sentence and a list, so it
**upgrades that paragraph in place** rather than becoming a second copy in AGENTS.md:

> **An e2e test is earned only by behaviour that cannot be proven below the browser** — real
> navigation and redirects; native or implicit form submission (jsdom implements none, which is why
> PROF-1 a-1d's submit sentinel needed one); actual overflow or tap-target geometry at a width; focus
> moving across a real document; a Server Action round trip. Everything else belongs lower, where it
> runs in milliseconds and fails more precisely. Prefer extending an existing spec's flow to adding a
> `test()`.

`definition-of-done.md:71` ("**E2E:** a few critical flows only") is a **second statement of the same
rule inside the same file** and would diverge from the upgraded paragraph; it becomes a pointer
("what the Speed budget above earns"). The "a new spec **file** gets a reason in the PR description"
rule lives in **one** place — a new DoD checkbox — not in the blockquote as well.

AGENTS.md's `e2e` bullet gets **one pointer line**, not the block. ⚠️ `wc -w AGENTS.md` is **4,748**
against DX-10's accepted **≤ 4,000** ceiling (`docs/plan.md:1317`); DX-10 just cut that file 29% on
"rules stay, stories move", and an eight-line blockquote there reverses it.

Today's baseline, sourced so it ages well: `playwright test --list` → **"Total: 87 tests in 13
files"** (a `grep -c 'test('` gives 71 — it misses loop-generated tests and the `a11y` project).

## Decision 4 — the fact is stated ONCE, and three docs point at it

AGENTS.md's gate list is "**the one list of where each gate runs**; other docs point here rather than
restating it" (`:288-290`). So **"coverage is measured post-merge and gates nothing; no per-PR delta
is computed" is written there once**, as the third "is NOT a gate" sentence beside `@claude review`
and CodeQL. The other three sites point at it rather than re-explaining:

| File                                    | Today                                                                           | Edit                                                                                                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/skills/review-pr/SKILL.md:120` | "There's **no coverage tool**, so judge by reading … Don't claim a percentage." | Keep the instruction, drop the false premise: judge the diff by reading; the post-merge number is not evidence for a PR. One pointer to the gate list.                                       |
| `.claude/skills/review-pr/SKILL.md:270` | Red flag: "Claiming coverage numbers … that doesn't exist"                      | The inverse red flag — citing the post-merge number as PR evidence. One line; every entry there is a rubric inverse.                                                                         |
| `AGENTS.md:395`                         | "**No coverage drop on changed files.**"                                        | **Delete the clause.** That block's subject is the tests that ship with a mutating PR, and this was never one of them; once a tool exists it reads as wired while no delta is ever computed. |

The instruction and the number coexist because they are about **different objects** — the number
measures `main` after merge, the review judges a diff — and that explanation lives at the single
statement, not at each site.

## File-by-file changes

| Path                                                               | Change | What & why                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/package.json`                                            | EDIT   | `@vitest/coverage-v8` at the **same range form as `vitest`** (`^5.0.5`) so Dependabot's minor-and-patch group moves them together — its peer is an exact pin on `vitest@5.0.5`. Script **`test:coverage`**, no path filter.                                                                                        |
| `pnpm-lock.yaml`                                                   | EDIT   | CI installs `--frozen-lockfile`, so this must be committed.                                                                                                                                                                                                                                                        |
| `apps/web/vitest.config.ts`                                        | EDIT   | The `coverage` block from Decision 2, with the `scripts/` pointer comment, the no-`thresholds` comment, and the no-path-filter note.                                                                                                                                                                               |
| `.github/workflows/metrics.yml`                                    | NEW    | `codeql.yml`'s frame; `migrate.yml`'s four setup steps with a pointer to `migrate-preview.yml:60-65`. **Three** actions, reusing ci.yml's pins — `actions/checkout@3d3c42e5…` v7.0.1, `pnpm/action-setup@ea17c68d…` v6.1.0, `actions/setup-node@949feb24…` v7.1.0 — **no fourth, no third-party coverage action**. |
| `docs/definition-of-done.md`                                       | EDIT   | Decision 3: the Speed budget paragraph upgraded, `:71` becomes a pointer, one new checkbox.                                                                                                                                                                                                                        |
| `AGENTS.md`                                                        | EDIT   | The single "is NOT a gate" statement; the `e2e` bullet pointer; `:395`'s clause deleted.                                                                                                                                                                                                                           |
| `.claude/skills/review-pr/SKILL.md`                                | EDIT   | `:120` and `:270`, per Decision 4.                                                                                                                                                                                                                                                                                 |
| `docs/plan.md`, `roadmap.md`, `status.md`, `docs/changelog/<file>` | EDIT   | The DX-13 row linked here, the Platform pointer, the fragment.                                                                                                                                                                                                                                                     |
| `SECURITY.md`                                                      | —      | **Unchanged, deliberately:** no new secret, token scope or processor; the pin rule and the `--prod` audit scope are untouched. Said so the next reviewer does not re-derive it.                                                                                                                                    |
| `.gitignore`                                                       | —      | **No edit needed:** `:26-28` already ignore `coverage/`, `playwright-report/`, `test-results/`.                                                                                                                                                                                                                    |

## Test plan

- `pnpm --filter web test:coverage` exits 0 and writes `coverage/coverage-summary.json`.
- **Probe the honest denominator on a `packages/*/src` file specifically.** An out-of-root file passes
  three separate mechanisms — tinyglobby with `cwd: apps/web`, a picomatch re-check against
  `relative(root, file)`, and `allowExternal` — so a probe on an `apps/web/lib` file proves none of
  them. The file must appear at **0%**, not be absent.
- **Probe that the sentry configs survive:** a `sentry.*.config.ts` key is present in the summary.
  This is the regression the dead `**/*.config.*` entry would have caused.
- **Probe each fail-loud condition independently**, and paste all five exits into the PR: a real run;
  the JSON renamed; the JSON truncated to empty; a summary with no `packages/` key; a run log
  containing `Excluding it from coverage`. ⚠️ **`workflow_dispatch` cannot rehearse this before
  merge** — GitHub registers dispatchable workflows from the **default branch**, so
  `gh workflow run metrics.yml --ref chore/…` 404s for a file not yet on `main`. The first real run is
  post-merge; the PR says so rather than claiming the workflow was observed working.
- `pnpm verify` green and not materially slower; `actions:check` passes.

## Risks / rollback

- **The number becomes a target.** Mitigated structurally: no thresholds, no PR surface, and
  `SKILL.md:120` keeping "judge by reading" as the instruction for a diff.
- **A new dev dependency executes in CI.** `audit:check` is `--prod`, so it does **not** cover this —
  a reason to check by hand, not to assume. `@vitest/coverage-v8@5.0.5` has **no install or
  postinstall script**, was published 2026-10-15 (past `dependabot.yml`'s 7-day cooldown), pins its
  peer exactly, and brings **six** packages new to the lockfile: `magicast`, `tinyrainbow`,
  `@bcoe/v8-coverage`, `ast-v8-to-istanbul`, `@vitest/istanbul-lib-report`,
  `@vitest/istanbul-lib-coverage` (`obug` and `std-env` are already present). The PR description
  carries the lockfile-diff list, "**no `allowBuilds` entry added**" (pnpm 11 hard-errors in CI on an
  unlisted build script, so a transitive needing one fails loudly), and one hand-run full-tree
  `pnpm audit --audit-level high`.
- **Nobody may read a red post-merge run.** `SEC-5b` is gated on exactly this
  (`docs/plan.md:981-985`: "nobody has confirmed that a failed scheduled run reaches a human"). This
  plan **inherits** that open question rather than assuming an answer; the first deliberate red run
  after merge is the test, and the result belongs in SEC-5b.
- **Rollback:** delete `metrics.yml` and the coverage block. No gate changes, no migration.

## Alternatives considered and rejected

| Alternative                                                  | Rejected because                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coverage as a **PR check / delta comment**                   | Becomes a de-facto gate the first time a red delta is treated as blocking, and competes with "judge by reading" on the same diff. A comment-style action would also need `pull-requests: write` — a write token in a job that runs PR-authored code.                                                                             |
| **Thresholds**                                               | A gate by another name; the ask was non-gating.                                                                                                                                                                                                                                                                                  |
| **Codecov / Coveralls**                                      | A third party receiving repo contents needs the privacy lens by AGENTS.md's own rule, for a number a step summary already shows.                                                                                                                                                                                                 |
| A **hard cap on e2e count**                                  | A gate, and the wrong unit — one new spec covering real browser-only behaviour beats three unit-provable ones.                                                                                                                                                                                                                   |
| **Publishing the HTML report as an artifact**                | Cut. It embeds the full source of every counted file into a world-readable artifact; nothing leaks today (the inventory's one working-tree personal-data occurrence is in `migrations/`, outside every include glob) but it turns any later include widening into a data-publication change. Also closes the retention question. |
| **Playwright JSON reporter + e2e count in the step summary** | Cut. Four file touches and a `continue-on-error` parser whose only consumer is a summary nobody opens on a green run — and `continue-on-error` means it can stop reporting silently, the shape this plan refuses elsewhere. Duration is on every run page; the count is one `--list` away.                                       |
| Coverage inside **`pnpm verify`**                            | `verify` is the ~40s pre-PR loop; an instrumented run slows it for a number nobody needs before opening a PR.                                                                                                                                                                                                                    |

## Out-of-scope / deferred

- Both `scripts/` trees in the denominator (Decision 2 says why, and when to revisit).
- Any change to which tests exist; this writes a rule, it does not apply it retroactively.
- A coverage trend, badge or history — worth building once there are runs to trend.
- Extracting the five-times-duplicated setup block — blocked on `check-action-pins` learning local
  actions (`migrate-preview.yml:60-65`); its own chunk, not this one.
- The archived → Restore e2e gap (`tech-debt.md`), which Decision 3's rule will justify when taken.

## Review-response log (adversarial panel)

### Round 1 — scope · security · architecture (2026-11-10)

| #     | Lens         | Critique (short)                                                                                                                    | Verdict      | Resolution                                                                                                                                                                                                                                |
| ----- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1    | Scope        | **BLOCKING:** `all: true` does not exist in vitest 5                                                                                | **accepted** | Verified independently; Decision 2 rewritten around `coverage.include` + `allowExternal`. Also A2.                                                                                                                                        |
| A1    | Architecture | **BLOCKING:** "no coverage tool" lives in `SKILL.md:120`, not AGENTS.md — the plan named the wrong file and that line becomes false | **accepted** | Verified. Decision 4 + a `SKILL.md` row. The premise was wrong, not just the table.                                                                                                                                                       |
| A3    | Architecture | `AGENTS.md:395` "No coverage drop on changed files" becomes claimed-but-not-wired                                                   | **accepted** | Verified. Clause deleted. No lens of mine had looked for it.                                                                                                                                                                              |
| S3/A4 | Scope + Arch | The e2e rule duplicates `definition-of-done.md:55-63`, into a file 748 words over DX-10's ceiling                                   | **accepted** | Both verified. Rule into the DoD; AGENTS.md gets a pointer.                                                                                                                                                                               |
| S2    | Scope        | Cut the Playwright JSON reporter + summary step                                                                                     | **accepted** | Cut — and it moots security S3 and architecture 8e entirely, the better argument for cutting it.                                                                                                                                          |
| S7    | Scope        | Drop the HTML artifact                                                                                                              | **accepted** | Cut; also retires security S4's structural risk and the retention question.                                                                                                                                                               |
| A5    | Architecture | The `include` set does not match the layout                                                                                         | **accepted** | Rewritten against `ls`, not memory.                                                                                                                                                                                                       |
| A6    | Architecture | Fail-loud has no confirmed reader; cancel policy unstated                                                                           | **accepted** | Inherits SEC-5b's open question; `cancel-in-progress: true` with its reason.                                                                                                                                                              |
| Sec1  | Security     | "Every action SHA-pinned" named no action                                                                                           | **accepted** | Three actions named with ci.yml's pins, plus "no fourth, no third-party coverage action".                                                                                                                                                 |
| Sec2  | Security     | "first-party, already trusted" understates the new lockfile packages                                                                | **accepted** | § Risks carries the facts; PR commits to the list, no-`allowBuilds`, a hand audit.                                                                                                                                                        |
| Sec5  | Security     | The `workflow_dispatch` rehearsal cannot run for a workflow not on `main`                                                           | **accepted** | Verified by mechanism. Probe is local and exact; the limitation is stated.                                                                                                                                                                |
| SecN  | Security     | ref-keyed concurrency · mis-rooted glob shrinks the denominator · say SECURITY.md is unchanged                                      | **accepted** | All three; N2 became a fail-loud condition — see C1 below for how it was still wrong.                                                                                                                                                     |
| S4    | Scope        | Fold `metrics.yml` into `ci.yml` as a push-gated job                                                                                | **rejected** | A false `if` still renders a **skipped check row**; `DX-5(a)` would put a `ci.yml` job one click from being a gate; `codeql.yml` is the sibling. ⚠️ Its rebuttal of my concurrency argument was right and that argument is **withdrawn**. |
| S5    | Scope        | Two concerns — split the PR                                                                                                         | **rejected** | With S2/S3 accepted the e2e half is a ~6-line DoD edit and a pointer: a rider on the same request.                                                                                                                                        |
| S-nit | Scope        | "87 tests" may be wrong; grep gives 71                                                                                              | **rejected** | `playwright test --list` → "Total: 87 tests in 13 files". The grep misses loop-generated tests and the `a11y` project. Source now cited.                                                                                                  |
| misc  | Arch + Scope | `test:coverage` not `coverage`; pillar is Platform; `.gitignore` row is dead                                                        | **accepted** | All three.                                                                                                                                                                                                                                |

### Round 2 — correctness · reuse (2026-11-10), on the revised plan

| #   | Lens        | Critique (short)                                                                                                              | Verdict      | Resolution                                                                                                                                                                                                              |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Correctness | **BLOCKING:** the fail-loud "no `apps/web` **and** no `packages`" criterion cannot catch the mis-rooted glob it was added for | **accepted** | My own acceptance bullet contradicted my own probe. Now four independent conditions, "either missing", never a conjunction.                                                                                             |
| C2  | Correctness | **BLOCKING:** `**/*.config.*` silently drops the two `sentry.*.config.ts` files the include names IN — its only effect        | **accepted** | Verified (exclude is applied after include and wins; both files have a test). Entry deleted; a probe now asserts the key is present. Also R1.                                                                           |
| C3  | Correctness | The reporter is never specified, and the default produces no `coverage-summary.json` (and still writes the cut HTML)          | **accepted** | `reporter: ['text-summary','json-summary']`, stated. Fail-loud condition 2 would otherwise have fired on every run.                                                                                                     |
| C4  | Correctness | Extension-less `app/**` sweeps in `.css`/`.ico`, which report as 100% or are dropped at exit 0                                | **accepted** | Every include glob is extension-qualified, matching `test.include`'s shape; "Excluding it from coverage" became the fourth fail-loud condition.                                                                         |
| C5  | Correctness | The denominator probe must name a `packages/*/src` file; and `allTestsRun` means a path filter silently loses untested files  | **accepted** | Both. The probe names the file class, and `test:coverage` takes no path filter, with the reason in the config.                                                                                                          |
| R1  | Reuse       | The In and Out lists are one rule written twice, and already disagree                                                         | **accepted** | Exclude cut to the entries that are live; the rest matched nothing the include reaches. A round-3 spot-check then added `lib/dal/recording-db.ts` — test-support code under `lib/`, which `**/*.test.*` does not catch. |
| R2  | Reuse       | After the PR the same fact is stated in four places; AGENTS.md's gate list is "the one list"                                  | **accepted** | Decision 4 rewritten: one statement, three pointers.                                                                                                                                                                    |
| R3  | Reuse       | The setup block's sibling is `migrate.yml`, and `migrate-preview.yml:60-65` already RULED on not extracting it                | **accepted** | Decision 1 corrected and now cites the ruling instead of re-deriving it; added to Out-of-scope.                                                                                                                         |
| R4  | Reuse       | `definition-of-done.md:71` is a second statement inside the same file; "reason in the description" lands twice                | **accepted** | `:71` becomes a pointer; the rule lives in the checkbox only.                                                                                                                                                           |
| R5  | Reuse       | The config comment should point at `test.include`, not retell its history                                                     | **accepted** | Done.                                                                                                                                                                                                                   |
| C7  | Correctness | "~5 packages" is six                                                                                                          | **accepted** | Six, named, with the two already present called out.                                                                                                                                                                    |

Both round-2 lenses state that no round-1 verdict looks wrong, including the three pushbacks.

### Round 3 — confirmation (2026-11-10)

The correctness lens re-checked C1-C5 and C7 against the rewritten plan: **all six resolved, nothing
newly broken.** It verified the include/exclude set by running picomatch 4.0.7 the way vitest compiles
it (`sentry.*.config.ts` in; `globals.css`, `token-sets.css`, `favicon.ico` out;
`../../packages/*/src/**/*.ts` reaching `packages/db/src` and `packages/shared/src/csv` but not
`packages/db/scripts`), and read `isIncluded` / `getUntestedFilesByRoot` to confirm the out-of-root
path handling.

Two spot-check findings, both taken: `lib/dal/recording-db.ts` (above), and the acceptance bullet
saying "four conditions" while listing five. One judgement call left as-is and recorded here:
`packages/evals/src` is swept in deliberately — eval tooling rather than test code, and its
`fixtures/nl-inputs.ts` will read near 0%. That is denominator purity, not a defect, and nothing is
gated on the number.

**Panel complete. Awaiting the maintainer's approval; no implementation code is committed before it.**
