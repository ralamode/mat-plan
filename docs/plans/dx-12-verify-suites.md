# DX-12 — `db:verify` becomes per-feature suites, and gate 6 gets a guard

> 🔴 **Status: PANELLED AND DEFERRED, 2026-11-07. Do not implement from the body below without
> reading the review-response log first — five lenses overturned the plan's premise, its method and
> its scope, and the body is kept UNEDITED above the log so the corrections are legible as
> corrections.** No implementation code was written.
> **Backlog row:** `DX-12` (added by this PR). **Milestone:** none — it unblocks CRUD-1's parallel
> lanes but is not one of its steps.

## Goal

Two things, and the second is why this is worth a plan rather than a tidy-up:

1. **`packages/db/scripts/verify.ts` stops being the file every DB-touching track appends to**, so
   `PROF-1 b` and `V1-24 3b` (profile CRUD ∥ strength CRUD) can run as parallel lanes without a
   guaranteed conflict.
2. **The rule that already forbids this gets a trigger and a gate**, so the next monolith is caught
   while it is 500 lines rather than 7,213.

## The problem, measured

| Fact                          | Value                                                     | Source                     |
| ----------------------------- | --------------------------------------------------------- | -------------------------- |
| `verify.ts` length            | **7,213 lines**                                           | `wc -l`                    |
| Commits in 6 weeks            | **26**                                                    | `git log --since`          |
| Every track's insertion point | **one line**, `console.log('✓ verify passed')` at `:7213` | the file                   |
| Proofs printed                | 79                                                        | `grep -c '✓ '`             |
| Assertions                    | 475                                                       | `grep -c 'assert\.'`       |
| Constraint-rejection probes   | 54                                                        | `grep -c expectRejectedBy` |
| Top-level proof blocks        | 19                                                        | `grep -c '^{$'`            |

🔴 **The rule this violates is already written.** `docs/parallel-work.md` gate 6 — _"Shared
append-only files are sharded … Anything every track must append to — an index, a registry — wants
the same shape"_ — and it names `docs/changelog/` as the precedent the repo already set. `verify.ts`
is exactly the shape gate 6 describes and was never sharded. **This is an unenforced rule, not a
missing one**, which is why half of this plan is the gate rather than the refactor.

## The constraint that shapes the design

`verify.ts` is **not** a test file that a runner can parallelise. It is one sequential script over
**one PGlite connection** (`const db = drizzle(new PGlite(), …)`, `:112`), and PGlite has a single
connection — a query issued on the module-level `db` from inside an open transaction waits forever
(`expectRejectedBy`'s own docblock says so). So:

- there is exactly **one** migrate-and-seed, and every proof runs after it;
- "atomic, standalone files" is not available; the unit is a **suite that receives a context**.

**What a suite actually needs** — measured, not assumed, by scanning the two newest blocks (a-0 and
a-r) for module-level identifiers:

```
schema 23 · db 12 · households 8 · A_SCOPE 8 · asPg 7
expectRejectedBy 3 · verifyHh 2 · B_SCOPE 2 · SEED_PROFILE_* 2
```

That is the entire surface. A context object carrying `{ db, asPg, scopes, seed, helpers }` covers
it; everything else (`renameProfile`, `PROFILE_KIND`) is a plain import a suite makes itself.

## Design

```
packages/db/scripts/
  verify.ts                 ← bootstrap + run the suites. Target ≤ 60 lines.
  verify/
    context.ts              ← VerifyContext + bootstrap(): migrate, seed, derive A_SCOPE/B_SCOPE,
                              expose expectRejectedBy / assertRefTableMatches / columnsOf
    ids.ts                  ← the public_id RANGE per suite — the collision registry
    legacy.ts               ← everything not yet moved, verbatim, running first
    profile.ts              ← PROF-1 a-0 + a-r today; b and a-1 land here
```

```ts
// verify.ts, in full
const ctx = await bootstrap();
for (const suite of SUITES) await suite.run(ctx);
console.log('✓ verify passed');
```

### 1 · The id ranges are what make suites independent, not the file split

🔴 **This is the load-bearing half and it is easy to skip.** A split that leaves suites reading each
other's rows is _worse_ than one file, because the coupling becomes invisible — a reordering would
break a proof with no compile error and no obvious cause.

The convention already exists in practice: the a-r block inserts its own households and rows in its
own `…04a0xx` range precisely so _"a refusal here cannot be satisfied by the absence of rows some
earlier block happened to leave behind"_. `ids.ts` promotes that to a registry: one range per suite,
and a suite creates every row it asserts on.

**A suite that needs the SEED's rows** (several legitimately do — the catalog, the reference-table
parity) reads them from `ctx.seed`, which is bootstrap's output, not another suite's side effect.

### 2 · The registry is an explicit array, not a glob

`apps/web/test/source-scan.ts` globs Server Action modules, and that is right there because **order
does not matter**. Here it does, for as long as `legacy.ts` exists. So:

```ts
const SUITES = [legacySuite, profileSuite] as const;
```

One line to append — the `docs/changelog/README.md` index pattern, a trivial conflict — and the
order is visible and reviewable. **Revisit the glob once `legacy.ts` is gone and every suite owns
its rows**, at which point order really is irrelevant and zero shared edits is achievable.

### 3 · 🔴 The guard that would stop guarding — the reason this needs the security lens

`packages/db/src/scope.test.ts` carries two guards over this file and **they behave differently
under the split**:

| Guard                                                     | How it selects files                           | After the split                                           |
| --------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------- |
| _"exactly one module reads `scope.householdId`"_ (`:131`) | globs `packages/db/scripts/**/*.ts`            | ✅ covers new suite files automatically                   |
| _"db:verify mints exactly two named scopes"_ (`:262`)     | **hard-codes `packages/db/scripts/verify.ts`** | 🔴 **blind** — a suite minting a third scope is invisible |

⚠️ **This is the same failure shape a review lens found on #350 hours ago**: that guard's unwrap
regex was case-sensitive on `[Ss]cope`, so `A_SCOPE.householdId` walked past it while all 24
assertions stayed green. A guard that silently stops covering its subject is worse than no guard,
because it is counted as coverage.

**So the split MUST widen `:262` to the directory, and the PR must probe it RED** — add a third
`householdScopeForScript(` in a suite file, watch the guard fail, remove it. Without that probe the
widening is an assertion nobody has seen work.

### 4 · Suites align with the feature guides

Add `verify/profile.ts` to `write-path.md`'s `owns:`, `verify/strength.ts` to
`strength-logging.md`'s, and so on as suites appear. Then `guides:check` works **with** the split:
a strength PR and a profile PR touch different proof files _and_ different guides, so
`parallel-work.md` gate 1 passes mechanically instead of by care. This is the whole point of the
exercise, expressed as a gate.

## Staging — three PRs, and the first one is the only risky one

| PR    | What                                                                                                                                         | ~Lines               |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **1** | `context.ts`, `ids.ts`, the runner, `legacy.ts` (verbatim move), `profile.ts` (a-0 + a-r moved), the `scope.test.ts` widening **probed red** | ~350 moved, ~120 new |
| **2** | The RULE: AGENTS.md § File organization gains the file-level mirror; `parallel-work.md` gate 6 gains the trigger and points at the guard     | ~60 docs             |
| **3** | The GUARD: `pnpm hotspots:check` — an append-only hotspot detector with an allowlist-with-reasons and a dead-entry assertion                 | ~150                 |

🔴 **PR 1 does NOT move the other 17 blocks.** They share seed fixtures deeply and the TEN-1/TEN-2
matrices interleave across ~2,000 lines; moving them is a separate judgement per block, and a lost
assertion in that region is undetectable by reading. `legacy.ts` keeps them verbatim and running
first. **New work goes in new suite files; `legacy.ts` shrinks opportunistically, never on a
deadline.** The parallel-work benefit is fully realised by PR 1 regardless, because what collides is
the _insertion point_, and after PR 1 there isn't one.

## The rule (PR 2), stated so it can be applied

> **A file that every track must append to is sharded into a directory with a manifest.**
> The trigger is not length — it is **shape**: if two tracks working on unrelated features would
> both add a block to it, it is already the wrong shape. Length is only the symptom that proves it
> went unnoticed.

- **Already sharded, and these are the precedents:** `docs/changelog/`,
  `packages/db/scripts/mutations/`, `packages/db/scripts/corrections/`.
- **Deliberate exceptions, with their reason** (an exception without a reason is a hole):
  `docs/roadmap.md` — small, pointer-only, tracks move single rows, so a conflict is a one-line
  merge (gate 6 already says this). `docs/plan.md` and `docs/status.md` — append-shaped, rows are
  far apart, and splitting the backlog costs more in findability than it saves in merges.
- **What to do when you notice one:** propose the shard in the PR that noticed it, the way
  AGENTS.md already asks for a _directory_ that starts collecting unrelated files. This rule is that
  rule's mirror, one level down.

## The guard (PR 3), and what it must NOT be

A hotspot detector over `git log`: for each tracked file, commits in a window × current length, and
**fail when a file crosses the threshold and is not on an allowlist carrying a reason**. The
repo's own idiom — `scoped.test.ts`'s `ALLOWED_UNSCOPED`, `pages-need-a-session.test.ts`'s
`ALLOWLIST` — including the **dead-entry assertion**, so a file that _does_ get sharded is forced
off the list rather than left there as coverage nobody re-earned.

⚠️ **It must not be a line-count lint.** A 2,000-line file one track owns is fine; a 300-line
registry every track appends to is not. The metric has to carry the _churn_, or it will flag
`actions.test.ts` (1,782 lines, one owner, no shared insertion point) and miss the next real one.

🔴 **Open question for the panel:** is PR 3 worth building at all, or does PR 2's written rule plus
the review-pr rubric do enough? The counter-evidence is real — gate 6 has been written since
2026-10-07 and `verify.ts` grew to 7,213 lines underneath it, which is an argument that the written
rule does _not_ do enough. The counter-counter is that nobody was looking for it, and now they will
be. **Decide this with the panel, not in implementation.**

## Alternatives considered and rejected

| Alternative                                      | Why not                                                                                                                                                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Split all 19 blocks now**                      | 7,213 lines of the most safety-critical file in the repo, where a lost assertion is undetectable by reading. The benefit (no shared insertion point) is fully delivered by moving two blocks. |
| **Leave it; fix conflicts as they come**         | 26 commits in 6 weeks, and a conflict in `verify.ts` is a merge of two proof blocks — the kind where "take both" is usually right and occasionally silently wrong.                            |
| **One file per PROOF rather than per feature**   | 79 files, most of them 20 lines, and the `✓` output order becomes a manifest nobody reads. Per feature matches the guides, which is what makes gate 1 mechanical.                             |
| **Glob the directory from day one**              | Order is load-bearing while `legacy.ts` exists. A glob now buys zero shared edits and pays with an implicit ordering nobody can see. Revisit when legacy is gone.                             |
| **Split by milestone (`ten-1.ts`, `auth-1.ts`)** | Matches how the file grew, not how it is read. A future `PROF-1 c` proof would have nowhere obvious to go, and it would not align with the feature guides, losing the gate-1 benefit.         |

## Risks / rollback

| Risk                                                   | Mitigation                                                                                                                                                                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔴 **A proof is silently lost in the move**            | `db:mutations` **13/13 RED before and after**, and the `✓` output **diffed literally, line for line** — not eyeballed. Both, because the first proves the assertions still bite and the second proves none vanished. |
| 🔴 **The scope guard goes blind** (§3)                 | Widen `:262` to the directory **and probe it red** with a third mint. The probe is the deliverable, not the widening.                                                                                                |
| A suite starts depending on another's rows             | `ids.ts` ranges + the convention that a suite creates what it asserts on. ⚠️ Not mechanically enforced in PR 1 — a candidate for PR 3's guard, and an honest gap to state rather than claim away.                    |
| PGlite's single connection breaks on refactor          | The runner stays sequential and `await`s each suite. No concurrency is introduced — and none is possible.                                                                                                            |
| The move churns `verify.ts` the moment two lanes start | PR 1 lands **before** `b-s`, or the lanes stay offset until it does.                                                                                                                                                 |

**Rollback:** PR 1 is a pure move plus a runner; reverting restores the single file with no data or
schema consequence. Nothing in it touches a migration.

## Out of scope

- Moving the other 17 blocks (opportunistic, no deadline).
- `docs/plan.md` / `status.md` sharding — named as deliberate exceptions above, not deferred work.
- Making `db:verify` parallel or faster. **It is not a performance change**, and claiming it as one
  would be the kind of unearned benefit this repo's review rubric exists to catch.
- `actions.test.ts` (1,782 lines) — one owner, no shared insertion point, so gate 6 does not reach
  it. Flagged here only so the panel can disagree.

## Acceptance

- `pnpm db:verify` prints the **same 79 `✓` lines in the same order**, proved by a literal diff.
- `pnpm db:mutations` is **13/13 RED**, unchanged.
- `packages/db/scripts/verify.ts` is **≤ 60 lines**.
- A third `householdScopeForScript(` in any `scripts/verify/*.ts` turns `scope.test.ts` **red** —
  demonstrated in the PR, not asserted.
- `PROF-1 b` and `V1-24 3b` can each add a proof **without touching a file the other touches**.

## Review-response log

### Engineering panel — 2026-11-07, five lenses

> Cost: correctness 94k · security 133k · scope 85k · architecture 105k · reuse 74k.

🔴 **The panel rejected the plan's premise, its method, its completeness and its scope. Nothing was
implemented, which is the entire point of panelling a plan rather than a diff.** Every finding below
was re-verified against the tree before being accepted.

#### The premise was false — and the answer already existed, in a tracked document

| #   | Lens                 | Critique                                                                                                                                                                                                                                                                                                                           | Verdict      | Resolution                                                                                                                              |
| --- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | scope                | 🔴 **`V1-24 3b` does not edit `verify.ts` at all.** Its `verify.ts` rows belong to PRs 1b and 1d, both shipped. The motivating collision does not exist                                                                                                                                                                            | **accepted** | § Goal's parallel-lane justification is void                                                                                            |
| P2  | scope · architecture | 🔴 **`docs/milestones/crud-1-fix-it-yourself.md` already ran this analysis on 2026-10-23** and concluded _"Gate 1 fails for every pair, on the guide alone… the lanes below are **orders of work, not concurrency**"_ — every mutating PR edits `write-path.md`. It even names the serial chain `a-0 → a-g → a-r → b → a-1 → a-1d` | **accepted** | The plan re-derived an existing artifact and reached the opposite conclusion. `start-task` step 2: _"an existing plan is the contract"_ |
| P3  | architecture         | Sharding `verify.ts` would **not** make gate 1 pass for the named pair anyway: `PROF-1 b` touches `writers/profile.ts`, `V1-24 3b` touches `writers/strength-session.ts`, and `write-path.md` owns `packages/db/src/writers/` by prefix                                                                                            | **accepted** | The residual is a prose merge in one guide. DX-12 cannot claim it                                                                       |
| P4  | architecture         | The "unenforced rule" framing is wrong. Gate 6 is a **scheduling** check, and `parallel-work.md:186-188` already documents the structural response — _"the file is doing two jobs — which is a refactor, filed as a row"_                                                                                                          | **accepted** | **DX-12 _is_ that row.** The honest framing is "gate 6 was never run against a verify-appending pair", not "a rule nobody enforced"     |

#### The method would not have proved what it claimed

| #   | Lens                                  | Critique                                                                                                                                                                                                                                                                         | Verdict      | Resolution                                                                                                                                                               |
| --- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1  | correctness · security                | 🔴 **The `✓` diff cannot see a dropped assertion.** `verify.ts` is fail-fast, so a _deleted_ assertion changes zero bytes of stdout. Of the 19 assertions PR 1 moves, **one** is covered by a mutation patch                                                                     | **accepted** | Acceptance needs a mechanical assertion inventory (`grep -c` parity against `origin/main`) and a `diff -w` of moved bodies. The ✓ diff proves **labels**, not assertions |
| M2  | correctness · security · architecture | 🔴 **"`db:mutations` 13/13 unchanged" is unachievable** — patch `02` patches `verify.ts` itself at the `A_SCOPE` mint. After the move it fails `git apply --check`: **12/13**, reported as "does not apply"                                                                      | **accepted** | PR 1 must regenerate `02` and re-demonstrate its `.expect` is still the first failure                                                                                    |
| M3  | correctness · security · architecture | 🔴 **`bootstrap()` cannot derive `B_SCOPE`.** It is minted at `:3936` from a household a legacy block inserts at `:3918` — ~3,700 lines in — and `:320` asserts `households.length === 1` before that. **So a-r is NOT self-contained**, which was the plan's load-bearing claim | **accepted** | Three ways out, each with a cost; none is "verbatim". Must be chosen and written down, not glossed                                                                       |

#### The completeness claim was wrong

| #   | Lens                   | Critique                                                                                                                                                                                                                                              | Verdict      | Resolution                                                            |
| --- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------- |
| C1  | security               | 🔴 **A THIRD guard hard-codes `verify.ts`** — `apps/web/lib/household-synthetic-is-dark.test.ts:49`, an exact-`toEqual` allowlist whose docblock forbids widening it. §3's table claimed completeness at two                                          | **accepted** | Verified. §3's "two guards" is false                                  |
| C2  | correctness · security | The widened mint guard must be `toBe(2)` over `verify.ts` + `verify/**`, not `≤ 2` over `scripts/**` — `corrections/registry.ts:86` mints once, so a directory-wide count is red at baseline, and `≤ 2` reads `0 ≤ 2` green when it loses its subject | **accepted** | The widening as drafted recreates the blindness it was written to fix |

#### The scope was too large in both directions

| #   | Lens                         | Critique                                                                                                                                                                                                          | Verdict      | Resolution                                                                                               |
| --- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------- |
| S1  | scope · architecture         | **PR 3 (`hotspots:check`) should not be built.** Running the proposed metric over the tree: 14 of the top 20 are docs that are append-shaped by design; the allowlist opens at ~15 entries; day-one catch is zero | **accepted** | Deleted. ⚠️ And the metric would flag `write-path.md` (37 commits) — a guide every track edits by design |
| S2  | architecture                 | § Out-of-scope's claim that `actions.test.ts` has "one owner, no shared insertion point" is **false**: 1,791 lines, 12 commits from **10 distinct backlog ids**, 21 appended `describe`s                          | **accepted** | Another unverified assertion. If a guard is ever built the metric is _distinct backlog ids_, not commits |
| S3  | scope · reuse · architecture | **PR 2 is the fifth written copy** of a rule already in gate 6, AGENTS.md § File organization, and `tech-debt.md:459` (2026-09-24, which already set the trigger)                                                 | **accepted** | Folded to one line in gate 6 plus a two-line header in the file. No AGENTS.md change                     |
| S4  | scope                        | PR 1 is over-scoped: `legacy.ts` moves ~6,900 lines to remove one insertion point, and the top risk exists _only because of that move_                                                                            | **accepted** | The minimal version is a `SUITES` loop at the bottom of an otherwise untouched `verify.ts`, ~300 lines   |

#### Precedents cited wrongly, and one defect in shipped code

| #   | Lens                 | Critique                                                                                                                                                                                   | Verdict                         | Resolution                                                                                                                     |
| --- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| R1  | reuse · architecture | 🔴 **`a-g` and `a-r` already share the public_id `…04a001`**, and a-r's comment claims _"public_ids in its own range"_. It works only because a-g hard-deletes its row 3,000 lines earlier | **accepted — a defect in #350** | Fails loud (`profiles_public_id_unique`), not silent. **The real defect is the false comment.** Fix independently of this plan |
| R2  | reuse                | `docs/changelog/README.md` has **no index** — the "index pattern" cited does not exist. The real precedent is `CORRECTIONS` in `corrections/registry.ts:818`                               | **accepted**                    | Verified: 0 index lines                                                                                                        |
| R3  | reuse                | The allowlist-with-reasons idiom is `scoped.test.ts`'s `ALLOWED_UNSCOPED`, not `pages-need-a-session.test.ts`'s `ALLOWLIST` (`string[] = []`, no reasons)                                  | **accepted**                    | Verified                                                                                                                       |
| R4  | reuse · architecture | Helpers belong in `verify/helpers.ts`, imported — not on the context. They close over nothing, and putting them on `ctx` breaks the "verbatim" claim at 48 call sites                      | **accepted**                    | Context carries state; helpers are a module                                                                                    |
| R5  | reuse · architecture | `tech-debt.md:459` already records this debt (at _"~3,000 lines"_, now 7,213)                                                                                                              | **accepted**                    | Update that row rather than open a second account of it                                                                        |

### What this round cost, and what it bought

The plan was wrong about **why** to do the work, **whether** the evidence would prove it safe, **how
many** guards it would blind, and **how big** it should be. Four of those are claims I asserted
without checking — the same failure the `PROF-1` a-r panel found hours earlier, at the level of a
plan instead of a diff.

**It bought the cheapest possible discovery of all of it: no code was written.**
