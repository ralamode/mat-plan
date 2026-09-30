---
name: plan-with-panel
description: Draft a mat-plan implementation plan (docs/plans/<id>-<slug>.md) and harden it with the adversarial review panels BEFORE any implementation code — the engineering panel (correctness, simplicity/scope, architecture, reuse, plus DB-safety for migrations) and, for anything a user sees, the UX panel (interaction/first-run, a11y at 360px, trust/data-entry burden). Runs the lenses as parallel subagents, reconciles every critique, writes the review-response log, and links the plan from the backlog. Use when start-task says a plan or UX panel is owed, or when the user says "plan X", "run the panel", "review this plan", "UX review".
---

# Plan with panel

The source rules are [docs/plans/README.md](../../../docs/plans/README.md), which holds the template
and the lens definitions, and [AGENTS.md](../../../AGENTS.md) → "UI PR rules" for the UX panel. When
this skill and those files disagree, **the files win**; fix this skill in the same PR.

## 0. Pick the mode and depth

| Change                                | Engineering panel                                   | UX panel                 | Log lives in       |
| ------------------------------------- | --------------------------------------------------- | ------------------------ | ------------------ |
| Migration / auth / CI / new subsystem | full: 4 standing lenses + DB-safety, then re-review | if UI touched: full      | the plan           |
| Non-trivial multi-file feature        | 4 standing lenses, single pass                      | if UI touched: full      | the plan           |
| New screen or flow                    | as above                                            | **full, 3 lenses**       | the plan           |
| Small visual change (plan-exempt)     | none                                                | **1 reviewer**, required | the PR description |

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

Use the `Plan` subagent for the draft if the area is large. Either way, you own the result.

## 2. Run the panel: lenses in parallel, one subagent each

Send all lens agents **in one message** so they run concurrently. Use read-only agents (`Plan` or
`Explore`). Each gets the same preamble plus its own lens:

> You are an adversarial reviewer on the mat-plan repo (`/Users/rbaker/workspace/mat-plan`). Read
> `AGENTS.md` and the plan at `docs/plans/<file>`. **Your job is to find flaws, not to praise.** Open
> the code the plan touches before criticising it; a critique about code you haven't read is noise.
> The app is used by kids and parents **on a phone, on a gym floor**, built at ~4h/wk. Return at most
> 8 critiques, **severity-ranked** (BLOCKING / SHOULD / NIT), each with: the problem, evidence
> (`path:line` or the plan section), and a concrete suggested fix. If the plan is sound on your lens,
> say so in one line. Don't invent problems to fill the list. **Lens:** <lens below>

**Engineering lenses** (standing, from `docs/plans/README.md`):

1. **Correctness and data integrity.** Edge cases, races, idempotency (client UUIDv7 + ON CONFLICT),
   ownership/IDOR, timezone/local-date, migration or backfill hazards, what breaks in prod.
2. **Simplicity and scope.** Over-engineering, YAGNI, a smaller path. Does it fit one concern and
   <400 lines? What should be cut or split?
3. **Architecture and consistency.** Does it fight AGENTS.md or `docs/spec.md` (RSC-first, the DAL
   boundary, Server Actions vs Route Handlers, a pure engine)? Does it paint a later PR into a corner?
4. **Reuse / DRY.** What does it duplicate that already exists in `packages/shared`, `lib/` or the
   DAL: a constant, zod schema, helper or query? Apply the constants single-source rule.
5. **DB safety** (migration plans only). Squawk rules, lock/statement timeouts, CONCURRENTLY
   isolation, NOT VALID then VALIDATE split across PRs, expand–contract, forward-only, seed idempotency.

**UX lenses** (required for any UI; from AGENTS.md → "UI PR rules"):

6. **Interaction design and first-run / cognitive load.** Fastest path to value, where the flow loses
   people, and whether this is the right pattern at all. Argue it against at least one alternative.
7. **A11y and adaptive/responsive.** Semantic elements, keyboard, focus-visible, ≥44px targets,
   numeric `inputmode`. **Do the width math at 360px**; don't trust flex-wrap.
8. **Trust and data-entry burden** (whenever the screen asks someone to confirm, approve or enter
   something consequential). Does it demand expertise the user lacks, is the mitigation real or
   theatre, and what is the recovery path? Recall that several shapes have no in-app undo.

Add a lens when the change calls for one (security for auth, perf/CWV for a heavy page).

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
