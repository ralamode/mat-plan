# Implementation plans

One file-by-file plan per **significant** PR, written and reviewed **before** any implementation code
is committed. The plan is the reviewable contract for the change; the PR then executes it.

- **When a plan is required** (see AGENTS.md → "Implementation plans for significant PRs"): the change
  touches CI, a DB migration, auth, a new subsystem/runner, or non-trivial multi-file logic.
- **Exempt:** docs, copy, config one-liners, and single-file mechanical changes.
- **Naming:** `<id>-<slug>.md`, matching the backlog id — e.g. `v0-11-ci-postgres-playwright.md`.
- **Lifecycle:** drafted (usually by the Plan agent) → reviewed → committed on the feature branch in
  the **same PR** as the code it plans. The row in [../plan.md](../plan.md) links here once a plan
  exists. Plans are kept as-merged (a historical record of intent), not retro-edited to match drift.

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
```
