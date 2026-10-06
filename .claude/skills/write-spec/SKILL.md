---
name: write-spec
description: Write the engineering spec for work that spans several PRs (docs/specs/<id>-<slug>.md) — what is true when it is done, as acceptance criteria a test can fail, plus the data contract that lets tracks split and the order with the constraint that fixes it. For a milestone, a large feature, or any change where several PRs must agree on something the ADR and AGENTS.md do not settle. Use when the user says "spec this", "write the engineering spec", "what exactly are we building for X", or when a backlog row names work nobody has specified.
---

# Write a spec

One spec per piece of work that **several PRs have to agree on**. Written after the model is settled
(an ADR, or a decision recorded in [docs/plan.md](../../../docs/plan.md)) and before any per-PR plan,
so each plan answers "how do we build this slice" without re-deciding what the slice is for.

**It is not a replacement for [plan-with-panel](../plan-with-panel/SKILL.md).** A spec covers the work;
a plan covers one PR. Both get panelled; file-by-file detail lives in the plan.

## Does this need a spec?

The trigger is not size and not the word "milestone" — it is **shared agreement across PRs**:

|                                                                                             |                                                                            |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| One PR does it                                                                              | **No spec.** A plan is enough; it is the same artifact at the right grain. |
| Several PRs, each independent                                                               | **No spec.** They are backlog rows. Nothing to agree on.                   |
| Several PRs that share acceptance criteria, a data contract, or an order that cannot change | **Spec.**                                                                  |
| A milestone                                                                                 | Usually a spec, because a milestone is the above by definition.            |
| A large feature inside one milestone                                                        | Also a spec. The milestone is not what makes it earn one.                  |

If you cannot name what the PRs have to agree on, you do not need a spec, and writing one adds prose
nobody maintains.

## Why this is narrow on purpose

Spec-driven development's three recorded failure modes are all available here:

- **Markdown madness** — so much prose that a reviewer hunts for mistakes buried in it. This repo
  already tends long; a spec that restates the ADR makes it worse.
- **Diminishing returns on a mature codebase** — specs help most greenfield. This one has 150+ merged
  PRs and invariants that live between files.
- **Context blindness** — the agent misses existing code that has to change.

The third is the one that has actually bitten. ADR 0005's first draft drew ~30 blocking findings across
five lenses, and almost none were "insufficiently specified" — they were _didn't read the feature
guide_, _didn't read the existing plan_, _cited a symbol deleted in #151_, _proposed a value an FK
rejects_. **More spec would have prevented none of them. Reading two documents first would have
prevented most.** Hence section 1, which is not optional.

So: take the acceptance-criteria discipline, take nothing else. No `constitution.md` (that is
[AGENTS.md](../../../AGENTS.md)), no separate `tasks.md` (the backlog row and the spec's own chunk list
hold that), no tooling.

## 1. Context first — this step is the point

**Before writing a line of spec, and recorded in it.** Each row is a path you open, not a thing you
remember.

| Read                                                 | How to find it                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| The ADR or decision this executes                    | `ls docs/decisions/` · the backlog row                                       |
| **Every feature guide owning a file you will touch** | `grep -l "<path fragment>" docs/features/*.md`, then its `owns:` frontmatter |
| **Existing plans for the rows in scope**             | `ls docs/plans/` — a committed plan is a contract, not a draft               |
| Known traps in the area                              | `grep -n -i '<area>' docs/lessons.md`                                        |
| What the code does at each seam the spec names       | open it; cite `path:symbol`                                                  |

Two rules this repo paid for:

- **Cite by symbol or constraint name, not line number.** `prescriptions_day_role_check`, not
  `schema.ts:671`. Line numbers go stale on the next refactor and a spec outlives one.
- **A guide's invariant outranks your design.** If the spec contradicts one — `docs/features/programming.md`
  says program and routine "co-exist permanently" — either the spec is wrong, or it states plainly that
  it overturns the invariant and why. Silently reversing it is how a session gets rediscovered.

The spec ends with a **Context read** list. A reviewer who sees a guide missing from it knows where to
look first.

## 2. Write it

`docs/specs/<id>-<slug>.md`. Same singular/plural convention the repo already uses:
[docs/spec.md](../../../docs/spec.md) is the standing architecture; `docs/specs/` holds one spec per
piece of work — exactly as [docs/plan.md](../../../docs/plan.md) is the backlog and `docs/plans/` holds
one plan per PR.

Sections, in this order:

### Acceptance — what is true when this is done

Write each as a criterion a test could **fail**:

| Pattern      | Shape                                                                |
| ------------ | -------------------------------------------------------------------- |
| Ubiquitous   | The system **shall** `<behaviour>`                                   |
| Event-driven | **When** `<trigger>`, the system **shall** `<behaviour>`             |
| State-driven | **While** `<state>`, the system **shall** `<behaviour>`              |
| Unwanted     | **If** `<condition>`, **then** the system **shall** `<behaviour>`    |
| Optional     | **Where** `<feature is present>`, the system **shall** `<behaviour>` |

Keep them readable — "When a prescription is edited, the system shall leave every already-logged
entry's `prescribed` text unchanged" — not stiff. **A criterion no test can fail is the thing this
skill exists to stop**; the vacuous-gate examples in [review-pr](../review-pr/SKILL.md) are what that
looks like in practice.

### The data contract

The shapes crossing a seam, so two tracks proceed without guessing at each other. Name the shape and
where it lives (`packages/shared`), not the implementation. This section is what AGENTS.md's
parallel-track gate requires before a backend and frontend thread can split.

### Chunks, in order, with the constraint that fixes the order

Numbered. For each: what it delivers, and — where the order is not arbitrary — **why it cannot move**.
Orders that matter are usually:

- a **window that closes** (something reconstructible now and never again),
- a **gate** (nothing else ships until this is true),
- an **expand→contract** step AGENTS.md requires be split across PRs.

Say which chunks can run **in parallel**. Parallel tracks also need the data contract agreed and the
panels run — AGENTS.md's gate, not this skill's.

### Out of scope

Explicit. At ~4h/week this section is load-bearing, and "deferred to X" beats silence.

### Risks

Each real failure mode → its mitigation. Here that usually means data integrity on the write path, the
**LLM-never-authors-loads** rule, and household scoping.

### Context read

The list from section 1.

## 3. Panel it

Same machinery as a plan — the named agents in [`.claude/agents/`](../../agents/), sent **in one
message** so they run concurrently, each following the
[reporting contract](../review-pr/reporting-contract.md).

| Always                                                                                 | Add when                                                     |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `correctness-reviewer` · `scope-reviewer` · `architecture-reviewer` · `reuse-reviewer` | —                                                            |
| `db-safety-reviewer`                                                                   | the schema, a seed or a correction                           |
| `security-reviewer`                                                                    | anything unauthenticated, secrets, or CI                     |
| `privacy-reviewer`                                                                     | the schema, the DAL, an export, logging, or a new dependency |
| `ux-reviewer` ×3                                                                       | it has screens                                               |

Ask each to check that the **acceptance criteria can actually fail** — the spec-specific question a
plan review does not ask.

Reconcile every blocking and should-fix critique into a **review-response log**: accepted (what
changed) or rejected (why). Pushbacks stay. If a finding reshapes the spec, send it back to the lens
that raised it for a light second pass.

⚠️ **Verify every fix actually landed in the text before claiming it in the log.** A log asserting a
change that was never applied is worse than no log — it is the one artifact a later reader trusts
without re-checking. This has already happened once.

## 4. Commit the spec, then plan

The spec lands **before** the first chunk's plan, on its own branch, as its own PR. Link it from the
backlog rows it covers and from the milestone doc when there is one.

Then each chunk runs the normal lifecycle: `start-task` → `plan-with-panel` → `ship-pr`. A plan cites
the spec's acceptance criteria rather than restating them.

**While the work is in flight, every PR review checks for drift** — is this still building what the
spec says? Call it out against the spec by name ([review-pr](../review-pr/SKILL.md)).

## Keeping it short

A spec longer than the ADR plus the first two plans has stopped helping. Levers, in order:

- **Point, don't copy.** Link the ADR for reasoning; restate only what a builder needs in hand.
- **A criterion, not a paragraph.** If prose explains a behaviour, it is probably an acceptance criterion.
- **Cut anything no chunk consumes.** A section nothing depends on is a section nobody maintains.

## Red flags

- Writing the spec before opening the feature guides. This is the failure the skill was built for.
- An acceptance criterion no test could fail.
- A spec for work that is really one PR, or for several PRs with nothing to agree on.
- Re-deciding what the ADR settled, or settling what it deferred.
- Chunk ordering with no stated reason — then it is a list, not a sequence, and someone will reorder it.
- Restating `AGENTS.md` rules. They already apply.
- A review-response log with no rejections on a spec that grew.
