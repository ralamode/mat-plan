---
name: write-spec
description: Write the engineering spec for work spanning several PRs (docs/specs/<id>-<slug>.md) — acceptance criteria a test can fail, the data contract that lets tracks split, and the order with the constraint that fixes it, complete enough to hand to a session with no context. For a milestone, a large feature, or any change where several PRs must agree on something the ADR and AGENTS.md do not settle. Use when the user says "spec this", "write the engineering spec", "what exactly are we building for X", or when a backlog row names work nobody has specified.
---

# Write a spec

One spec per piece of work **several PRs have to agree on**. Written after the model is settled (an
ADR, or a decision in [docs/plan.md](../../../docs/plan.md)) and before the first plan, so each plan
answers "how do we build this slice" without re-deciding what the slice is for.

Not a replacement for [plan-with-panel](../plan-with-panel/SKILL.md): a spec covers the work, a plan
covers one PR. Both get panelled; file-by-file detail lives in the plan.

## Does this need a spec?

The trigger is **shared agreement**, not size:

| Shape                                                                                  | Verdict                                                               |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| One PR                                                                                 | **No.** A plan is the same artifact at the right grain.               |
| Several PRs, each independent                                                          | **No.** They are backlog rows.                                        |
| Several PRs sharing acceptance criteria, a data contract, or an order that cannot move | **Spec.**                                                             |
| A milestone                                                                            | Usually — because it is the row above, not because it is a milestone. |

If you cannot name what the PRs must agree on, there is nothing for a spec to hold.

## Why it is narrow

Spec-driven development's three failure modes are all available here: **markdown madness** (prose
nobody reads), **diminishing returns on a mature codebase**, and **context blindness**. Only the third
has actually bitten — ADR 0005's first draft drew ~30 blocking findings across five lenses and almost
none were "underspecified"; they were wrong premises. So: take the acceptance-criteria discipline, take
nothing else. No `constitution.md` ([AGENTS.md](../../../AGENTS.md) is it), no separate `tasks.md`, no
tooling.

## 1. Context first — this is the step that pays

Open each; do not recall it. Record the list in the spec.

| Read                                                 | Find it with                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| The ADR or decision this executes                    | `ls docs/decisions/` · the backlog row                                       |
| **Every feature guide owning a file you will touch** | `grep -l '<path fragment>' docs/features/*.md`, then its `owns:` frontmatter |
| **Existing plans for the rows in scope**             | `ls docs/plans/` — a committed plan is a contract, not a draft               |
| Traps in the area                                    | `grep -n -i '<area>' docs/lessons.md`                                        |
| The code at each seam the spec names                 | open it; cite `path:symbol`                                                  |

**A guide's invariant outranks your design.** If the spec contradicts one, either the spec is wrong or
it says plainly that it overturns the invariant and why. Silently reversing one is how a session gets
rediscovered.

## 2. Derivation traps — how this repo has actually been wrong

Every one of these produced a defect here. The signature is always the same: **the premise looked
right.** `docs/lessons.md` is full of the phrasing — _"even though the parent obviously has one"_,
_"against an index that plainly exists"_.

| Trap                                   | How it shows up                                  | The check                                                                                                                                                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stale doc**                          | A docblock describes code that has since changed | `grep` the symbol in `apps/ packages/`. A comment is not code. `DAY_ROLE_BY_WEEKDAY` was cited from docs months after #151 deleted it; a docblock still claimed the form remounts on `key={gen}` after it had moved to `key={day}`                                                |
| **Quote without its scope**            | A rule quoted from a section that scopes it      | Open the file; find the heading it sits under. "Gaps are normal — do not backfill" governs **`## bodyweight`**, not the strength CSV, whose rule is the inverse                                                                                                                   |
| **Plausible mechanism**                | "X works because Y is excluded"                  | Run it. `next/image` was argued safe because the matcher excludes `/_next/image`; the optimizer's own internal fetch re-enters the proxy and 400s for everyone                                                                                                                    |
| **Type or constraint unchecked**       | A value proposed for a column                    | Read the column and the const it mirrors. `unit_default` is an FK to `units.code`; `count` is deliberately excluded from `LOGGABLE_UNITS`                                                                                                                                         |
| **Provenance untraced**                | "one column" for a composed value                | Follow every part to its table. The exported `prescribed` string is built from `prescriptions` **and** `prescription_targets`, so an FK to one freezes nothing                                                                                                                    |
| **Name read instead of definition**    | "the index plainly exists"                       | Partial? Composite? Deferrable? `uq_prescriptions_block_day_role_idx` is a partial **index**, so `ON CONFLICT` must repeat its predicate and `SET CONSTRAINTS` does not exist                                                                                                     |
| **Vacuous gate**                       | A check that cannot fail on the thing it names   | Ask what input turns it red. `expectTapTargets` excludes `<a>` by design, so a link-only screen passes it measuring nothing                                                                                                                                                       |
| **Unverified edit**                    | A log claiming a change that never landed        | Assert the anchor matched, then re-read the file. A review-response log recorded two fixes that were never applied                                                                                                                                                                |
| **Line number from a filtered stream** | `path:12` that reads as verified                 | `grep -n` the symbol in the **FILE**, never in an `awk`/`sed`/pipe extract — those renumber from 1. A plan's citations were all off by exactly 161 (its table started at `:162`); the same error then recurred twice inside its own fix. Prefer `path:symbol`, which cannot drift |

When the spec rests on any of these, **verify it and cite what you ran**, not what you concluded.

## 3. Write it

`docs/specs/<id>-<slug>.md`. Same split the repo already uses: [docs/spec.md](../../../docs/spec.md) is
the standing architecture, `docs/specs/` is one per piece of work — as `docs/plan.md` is the backlog and
`docs/plans/` is one per PR.

**The handoff test: a session with only this spec and the links in it must be able to execute the first
chunk without asking a question.** If it would have to ask, the answer belongs in the spec. That is what
"all-encompassing" means here — not longer, but closed over its own dependencies.

### Acceptance

Each criterion is something a test can **fail**:

| Pattern      | Shape                                                                |
| ------------ | -------------------------------------------------------------------- |
| Ubiquitous   | The system **shall** `<behaviour>`                                   |
| Event-driven | **When** `<trigger>`, the system **shall** `<behaviour>`             |
| State-driven | **While** `<state>`, the system **shall** `<behaviour>`              |
| Unwanted     | **If** `<condition>`, **then** the system **shall** `<behaviour>`    |
| Optional     | **Where** `<feature is present>`, the system **shall** `<behaviour>` |

Readable, not stiff. A criterion no test can fail is the defect this artifact exists to prevent.

### The data contract

The shapes crossing a seam, so two tracks proceed without guessing at each other. Name the shape and
where it lives (`packages/shared`), not the implementation. AGENTS.md gates a backend/frontend split on
this existing.

### Chunks, in order, with the constraint that fixes the order

For each: what it delivers, and where the order is not arbitrary, **why it cannot move** — usually a
**window that closes**, a **gate**, or an **expand→contract** step AGENTS.md requires be split across
PRs. Say which can run in parallel.

### Decisions already made

One line each, with where it was settled. This is what stops a later session reopening a closed
question, and it is the section the handoff test most depends on.

### Out of scope · Risks · Context read

Explicit out-of-scope ("deferred to X" beats silence). Each risk → its mitigation; here that usually
means write-path data integrity, the **LLM-never-authors-loads** rule, and household scoping. Then the
list from section 1.

## 4. Panel it

The named agents in [`.claude/agents/`](../../agents/), sent **in one message** so they run
concurrently, each following the [reporting contract](../review-pr/reporting-contract.md).

| Always                                                                                 | Add when                                       |
| -------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `correctness-reviewer` · `scope-reviewer` · `architecture-reviewer` · `reuse-reviewer` | —                                              |
| `db-safety-reviewer`                                                                   | schema, seed or correction                     |
| `security-reviewer`                                                                    | anything unauthenticated, secrets, CI          |
| `privacy-reviewer`                                                                     | schema, DAL, export, logging, a new dependency |
| `ux-reviewer` ×3                                                                       | it has screens                                 |

Ask each the spec-specific question a plan review does not ask: **can each acceptance criterion
actually fail?**

Reconcile every blocking and should-fix critique into a **review-response log** — accepted (what
changed) or rejected (why). Pushbacks stay. If a finding reshapes the spec, send it back to the lens
that raised it for a light second pass.

⚠️ **Verify each fix landed in the text before claiming it in the log.** A log asserting a change that
was never applied is worse than no log — it is the artifact a later reader trusts without re-checking.
This has happened.

## 5. Commit, then plan

The spec lands before the first chunk's plan, as its own PR, linked from the backlog rows it covers.
Each chunk then runs `start-task` → `plan-with-panel` → `ship-pr`, and a plan **cites** the spec's
criteria rather than restating them. Every review checks for drift against the spec by name
([review-pr](../review-pr/SKILL.md)).

## Keeping it short

A spec longer than the ADR plus the first two plans has stopped helping.

- **Point, don't copy.** Link the ADR for reasoning; restate only what a builder needs in hand.
- **A criterion, not a paragraph.** Prose explaining a behaviour is usually an acceptance criterion.
- **Cut what no chunk consumes.** A section nothing depends on is a section nobody maintains.

Length is not the same as closure: the handoff test can require _more_ detail while these cut prose.
When they conflict, closure wins — a spec that forces a question is worse than one that is long.

## Red flags

- Writing before opening the feature guides.
- An acceptance criterion no test could fail.
- A spec for one PR, or for PRs with nothing to agree on.
- Re-deciding what the ADR settled, or settling what it deferred.
- Chunk order with no stated reason — then it is a list, and someone will reorder it.
- Restating AGENTS.md rules; they already apply.
- A review-response log with no rejections on a spec that grew.
