# Implementation plans

One file-by-file plan per **significant** PR, written and reviewed **before** any implementation code
is committed. The plan is the reviewable contract for the change; the PR then executes it.

- **When a plan is required** (see AGENTS.md → "Implementation plans for significant PRs"): the change
  touches CI, a DB migration, auth, a new subsystem/runner, or non-trivial multi-file logic.
- **Exempt:** docs, copy, config one-liners, and single-file mechanical changes.
- **Naming:** `<id>-<slug>.md`, matching the backlog id — e.g. `v0-11-ci-postgres-playwright.md`.
- **Lifecycle:** drafted (usually by the Plan agent) → **adversarial review** (below) → reviewed by a
  human → committed on the feature branch in the **same PR** as the code it plans. The row in
  [../plan.md](../plan.md) links here once a plan exists. Plans are kept as-merged (a historical record
  of intent), not retro-edited to match drift.

## Adversarial plan review (before implementation)

A significant plan is authored at **Staff-SWE level** and then **hardened by an adversarial review
panel** before any code is written. The loop:

1. **Author (Staff SWE).** The Plan agent drafts the file-by-file plan with a senior engineer's rigor:
   explicit risks, edge cases, alternatives considered (and rejected, with why), rollback, and how it
   sets up the _next_ PRs — not just a happy path.
2. **Adversarial panel — ≥3 independent reviewers, each a distinct skeptical lens, prompted to find
   flaws (not to praise).** Each returns concrete, **severity-ranked** critiques with a suggested fix:
   - **Correctness & data integrity** — edge cases, races, migration/backfill hazards, boundary &
     security gaps, "what breaks in prod".
   - **Simplicity & scope** — over-engineering, YAGNI, a smaller/faster path; does it fit the ~4h/wk
     constraint and the one-concern/<400-line target?
   - **Architecture & consistency** — does it fight AGENTS.md / spec.md, paint us into a corner, or
     set up later PRs poorly? Naming/DRY/seams.
     (Add lenses for the PR's nature — a migration plan gets a dedicated DB-safety reviewer, etc.)
3. **Reconcile (author responds).** The author agent reviews each critique and either **incorporates**
   it (revises the plan) or **pushes back with justification**. It records a short **review-response
   log** in the plan doc: each material critique → accepted (what changed) or rejected (why).
4. **Re-review.** A light second pass (or the human) confirms the material critiques were addressed;
   iterate if a reviewer's blocking concern survives. Then implementation proceeds.

The **review-response log stays in the committed plan** so the reasoning (and the pushbacks) survive.
Scale the panel to the risk: a schema/migration or auth plan gets the full panel + re-review; a small
feature plan can run a single-pass panel.

## Template

Copy this shape for a new plan:

```markdown
# <ID> — <title>

> Backlog: [plan.md](../plan.md) row <ID>. Branch: `<type>/<id>-<slug>`.

## Goal

One paragraph: what this PR makes true, and why now.

## Acceptance

- Copy the plan.md acceptance criterion verbatim.
- Concrete "done when" bullets (observable outcomes).

## File-by-file changes

| Path           | Change     | What & why                           |
| -------------- | ---------- | ------------------------------------ |
| `path/to/file` | NEW / EDIT | Exactly what changes and the reason. |

(Expand below the table with the key contents/shape of each new file — config objects,
fixtures, CI job YAML — specific enough that implementation is mechanical.)

## Test plan

What the tests assert, how they're seeded/isolated, the local run command, and the CI run.

## Risks / rollback

Each real risk → its mitigation. Rollback approach.

## Out-of-scope / deferred

What this PR deliberately does NOT do.

## Open questions

Anything to decide before implementation (empty once resolved).

## Review-response log (adversarial panel)

Per critique: reviewer/lens → **accepted** (what changed in the plan) or **rejected** (why). Blocking
concerns must be resolved before implementation.
```
