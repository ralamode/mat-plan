---
name: plan-with-panel
description: Draft a mat-plan implementation plan (docs/plans/<id>-<slug>.md) and harden it BEFORE any implementation code with the adversarial review panels — engineering, plus UX for anything a user sees — run as parallel subagents, reconciled into a committed review-response log. Use when start-task says a plan or UX panel is owed, or when the user says "plan X", "run the panel", "review this plan", "UX review".
---

# Plan with panel

The source rules are [docs/plans/README.md](../../../docs/plans/README.md), which holds the template
and the lens definitions, and [AGENTS.md](../../../AGENTS.md) → "UI PR rules" for the UX panel. When
this skill and those files disagree, **the files win**; fix this skill in the same PR.

## 0. Pick the mode and depth

| Change                                | Engineering panel                                                                                                   | UX panel                 | Log lives in       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------ |
| Migration / auth / CI / new subsystem | full: 4 standing lenses + DB-safety (migration) and/or security (auth, CI, unauthenticated surface), then re-review | if UI touched: full      | the plan           |
| Non-trivial multi-file feature        | 4 standing lenses, single pass                                                                                      | if UI touched: full      | the plan           |
| New screen or flow                    | as above                                                                                                            | **full, 3 lenses**       | the plan           |
| Small visual change (plan-exempt)     | none                                                                                                                | **1 reviewer**, required | the PR description |

**Scale the depth of a panel, never whether it runs.**

## 1. Draft the plan (Staff-SWE level)

Write `docs/plans/<id>-<slug>.md` from the template in `docs/plans/README.md`, section by section.
The bar:

- **Acceptance** copies the `docs/plan.md` criterion verbatim, then gives observable "done when" bullets.
- **File-by-file** is specific enough that implementation is mechanical: exact paths, NEW or EDIT, and
  the shape of each new thing.
- **Alternatives considered and rejected, with the reason.** A plan that shows only the chosen path
  hasn't been designed.
- **Risks / rollback** name real failure modes (for this app that usually means data integrity on the
  write path, the "LLM never authors loads" rule, and ownership scoping by `household_id`).
- **Out-of-scope** is explicit. At ~4h/wk that section is load-bearing.
- Ground every claim in code you have opened. Cite `path:line`.

Use the `Plan` subagent for the draft if the area is large. Either way, you own the result. If the
plan depends on how existing code really behaves, run the `fact-sheet` agent **before drafting** and
draft from its answers, including its "claimed but not wired" section.

## 2. Run the panel: lenses in parallel, one named agent each

The lenses are **named agents in [`.claude/agents/`](../../agents/)**, one lens each, so the
≥3 independent reviewers AGENTS.md and `docs/plans/README.md` require stay independent. Each carries
its own checklist and follows the shared
[reporting contract](../review-pr/reporting-contract.md). Send them **in one message** so they run
concurrently. The prompt only has to name the target: _"Review the plan at `docs/plans/<file>`
(worktree `<path>`)."_

| Change                                                          | Agents (each is a separate, parallel invocation)                                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Any significant plan (the four standing lenses)                 | `correctness-reviewer` · `scope-reviewer` · `architecture-reviewer` · `reuse-reviewer`                             |
| A migration, schema, seed or correction                         | + `db-safety-reviewer` (the dedicated DB-safety reviewer)                                                          |
| Auth, secrets, CI/workflows, anything reachable unauthenticated | + `security-reviewer`                                                                                              |
| New screen or flow                                              | + `ux-reviewer` **three times**, one per sub-lens (`Lens: 1` interaction · `Lens: 2` a11y/360px · `Lens: 3` trust) |
| Small visual change (plan-exempt)                               | + `ux-reviewer` once, all three sub-lenses (**required**)                                                          |

Add a one-off lens (perf/CWV for a heavy page) with an inline prompt when no agent fits.

**Claims about third-party behaviour cite the source at the pinned version**, not its README. On
DX-1 that rule turned "read-only by default" into "writes the job token into `.git/config`".

## 3. Reconcile: every material critique gets a verdict

For each BLOCKING and SHOULD critique, either **incorporate** it (edit the plan) or **push back with a
reason**. Record the result in the plan's `## Review-response log`:

```markdown
### Engineering panel (round 1)

| #   | Lens        | Critique (short)                              | Verdict      | Resolution                                                               |
| --- | ----------- | --------------------------------------------- | ------------ | ------------------------------------------------------------------------ |
| C1  | Correctness | Retry double-writes when the action times out | **accepted** | Added client_id + ON CONFLICT; see §File-by-file                         |
| S2  | Scope       | Split the editor into its own PR              | **rejected** | Editor is 40 lines; splitting costs a review cycle for no risk reduction |
```

Pushbacks stay in the log; that record is the point. NITs may be batched in one line.

## 4. Re-review and hand off

- If any BLOCKING critique was accepted in a way that reshaped the plan, send the **revised** plan
  back to the lens that raised it (one light pass). Iterate until no blocking concern survives.
- Link the plan from its row in `docs/plan.md`.
- **Stop and hand the plan to the user for human review.** Summarise what the panels changed, the
  pushbacks, and any open questions. No implementation code gets committed until they approve.
- A plan-only PR is fine and common (`docs(<id>): plan …, reshaped by two panels`). Ship it with
  `ship-pr`.

## Common rationalizations

| Thought                                                  | Reality                                                                                                                                  |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| "The change is obvious; the panel is ceremony."          | Panels here caught a 44px CI gate, a 360px row that only fit by luck, and an onboarding flow whose safety argument collapsed on a phone. |
| "I'll run the panel after I've written the code."        | Then its job becomes defending sunk cost. The rule is before implementation.                                                             |
| "All the critiques were fair, so I accepted everything." | Accepting everything usually bloats scope. Push back where the simplicity lens would.                                                    |
| "One reviewer can cover all the lenses."                 | Distinct lenses find distinct problems. Keep them separate and parallel.                                                                 |

## Red flags

- A critique that cites no file or plan section.
- A review-response log with no rejections on a plan that grew in size.
- A UX panel with no 360px width math.
- Implementation files staged before the user has approved the plan.
