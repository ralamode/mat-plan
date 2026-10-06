---
name: spec-milestone
description: Write the engineering spec for a whole milestone (docs/milestones/<name>-spec.md) — what is true when it is done, as checkable acceptance criteria, plus the data contract that lets tracks split and the chunk order with its real constraints. Runs once per milestone, between the ADR that settles the model and the per-PR plans that build it. Use when the user says "spec the milestone", "write the engineering spec", "what exactly are we building for X", or when a milestone doc names chunks nobody has specified yet.
---

# Spec a milestone

One spec per milestone, written **after** the model is settled (an ADR, or a decision recorded in
[docs/plan.md](../../../docs/plan.md)) and **before** any per-PR plan. It answers "what exactly are we
building, and how will we know it works" once, so the per-PR plans can answer "how do we build this
slice" without re-deciding it each time.

**It is not a replacement for [plan-with-panel](../plan-with-panel/SKILL.md).** The spec covers the
milestone; a plan covers one PR. Both get panelled; the plan is where file-by-file detail lives.

## Why this exists, and what it deliberately is not

Spec-driven development is the 2026 default, and its three recorded failure modes are all things this
repo can walk into:

- **Markdown madness** — so much prose that a reviewer hunts for mistakes buried in it. This repo
  already tends long; a spec that restates the ADR makes it worse.
- **Diminishing returns on a mature codebase** — specs help most greenfield. mat-plan is 150+ merged
  PRs with invariants that live between files.
- **Context blindness** — the agent misses existing code that must change.

The third one is the one that has actually bitten. ADR 0005's first draft drew ~30 blocking findings
across five lenses, and almost none were "insufficiently specified" — they were _didn't read the
feature guide_, _didn't read the existing plan_, _cited a symbol deleted months ago_, _proposed a value
an FK rejects_. **More spec would have prevented none of them. Reading two documents first would have
prevented most.** Hence section 1, which is not optional.

So: take the acceptance-criteria discipline, take nothing else. No `constitution.md` (that is
[AGENTS.md](../../../AGENTS.md)), no separate `tasks.md` (the milestone doc holds the chunks), no
tooling.

## 1. Context first — this step is the point

**Do this before writing a line of spec, and record what you read.** Each item is a path you must open,
not a thing you remember.

| Read                                                    | How to find it                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| The ADR or decision the milestone executes              | `ls docs/decisions/` · the backlog row                                       |
| **Every feature guide that owns a file you will touch** | `grep -l "<path fragment>" docs/features/*.md`, then its `owns:` frontmatter |
| **Existing plans for the rows in scope**                | `ls docs/plans/                                                              | grep -i <id>` — a committed plan is a contract, not a draft |
| Known traps in the area                                 | `grep -n -i '<area>' docs/lessons.md`                                        |
| What the code actually does at each seam the spec names | open it; cite `path:symbol`                                                  |

Two rules that come from this repo's own history:

- **Cite by symbol or constraint name, not line number.** `prescriptions_day_role_check`, not
  `schema.ts:671`. Line numbers go stale on the next refactor, and a spec is meant to outlive one.
- **A guide's invariant outranks your design.** If the spec contradicts one — `docs/features/programming.md`
  says program and routine "co-exist permanently" — either the spec is wrong, or it must say
  explicitly that it overturns the invariant and why. Silently reversing it is how a session gets
  rediscovered.

The spec ends with a **Context read** list. A reviewer who sees a guide missing from it knows where to
look first.

## 2. Write it

`docs/milestones/<milestone>-spec.md`, beside the milestone doc it specs. Sections, in this order:

### Acceptance — what is true when this is done

**Write these as EARS criteria.** The value is not the ceremony, it is that each one is unambiguous and
checkable by a test:

| Pattern      | Shape                                                                |
| ------------ | -------------------------------------------------------------------- |
| Ubiquitous   | The system **shall** `<behaviour>`                                   |
| Event-driven | **When** `<trigger>`, the system **shall** `<behaviour>`             |
| State-driven | **While** `<state>`, the system **shall** `<behaviour>`              |
| Unwanted     | **If** `<condition>`, **then** the system **shall** `<behaviour>`    |
| Optional     | **Where** `<feature is present>`, the system **shall** `<behaviour>` |

Write them readably — "When a prescription is edited, the system shall leave every already-logged
entry's `prescribed` text unchanged" — not stiffly. **Every criterion names something a test could
fail on.** A criterion no test can fail is the thing this skill exists to stop; see the vacuous-gate
examples in [review-pr](../review-pr/SKILL.md).

### The data contract

The shapes crossing a seam, so two tracks can proceed without guessing at each other. This is the
section that makes backend and frontend parallelisable, and AGENTS.md gates that split on it.

Name the shape and where it lives (`packages/shared`), not the implementation.

### Chunks, in order, with the constraint that fixes the order

A numbered list. For each: what it delivers, and — where the order is not arbitrary — **why it cannot
move**. Orders that matter are usually one of:

- a **window that closes** (data reconstructible now and never again),
- a **gate** (nothing else can ship until this is true),
- an **expand→contract** step that AGENTS.md requires be split across PRs.

Say which chunks can run **in parallel** and which cannot. Parallel tracks also need the data contract
agreed and the panels run — that is AGENTS.md's gate, not this skill's.

### Out of scope

Explicit. At ~4h/week this section is load-bearing, and "deferred to X" beats silence.

### Risks

Each real failure mode → its mitigation. For this app that usually means data integrity on the write
path, the **LLM-never-authors-loads** rule, and household scoping.

### Context read

The list from section 1.

## 3. Panel it

Same machinery as a plan — the named agents in [`.claude/agents/`](../../agents/), sent **in one
message** so they run concurrently, each following the
[reporting contract](../review-pr/reporting-contract.md).

| Always                                                                                 | Add when                                                     |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `correctness-reviewer` · `scope-reviewer` · `architecture-reviewer` · `reuse-reviewer` | —                                                            |
| `db-safety-reviewer`                                                                   | the milestone touches the schema, a seed or a correction     |
| `security-reviewer`                                                                    | anything unauthenticated, secrets, or CI                     |
| `privacy-reviewer`                                                                     | the schema, the DAL, an export, logging, or a new dependency |
| `ux-reviewer` ×3                                                                       | a milestone with screens                                     |

Ask each one to check the **acceptance criteria can actually fail**, not only that the design is
sound — that is the spec-specific question a plan review does not ask.

Reconcile every blocking and should-fix critique into a **review-response log** in the spec: accepted
(what changed) or rejected (why). Pushbacks stay. If a finding reshapes the spec, send it back to the
lens that raised it for a light second pass.

⚠️ **Verify every fix actually landed in the text before claiming it in the log.** A log asserting a
change that was never applied is worse than no log — it is the one artifact a later reader trusts
without re-checking. This has already happened once.

## 4. Commit the spec, then plan

The spec lands **before** the first chunk's plan, on its own branch, as its own PR. Link it from the
milestone doc and the backlog rows it covers.

Then each chunk goes through the normal lifecycle: `start-task` → `plan-with-panel` → `ship-pr`. The
plan cites the spec's acceptance criteria rather than restating them.

**During the milestone, every PR review checks for drift** — does this still build what the spec says?
Call it out against the spec by name ([review-pr](../review-pr/SKILL.md)).

## Keeping it short

A spec longer than the ADR plus the first two plans has stopped helping. Levers, in order:

- **Point, don't copy.** Link the ADR for reasoning; restate only what a builder needs in hand.
- **A criterion, not a paragraph.** If prose explains a behaviour, it is probably an acceptance criterion.
- **Cut anything no chunk consumes.** A section nothing depends on is a section nobody maintains.

## Red flags

- Writing the spec before opening the feature guides. This is the failure this skill was built for.
- An acceptance criterion no test could fail.
- A spec that re-decides what the ADR settled, or settles what the ADR deferred.
- Chunk ordering with no stated reason — then it is a list, not a sequence, and someone will reorder it.
- Restating `AGENTS.md` rules. They already apply.
- A review-response log with no rejections on a spec that grew.
