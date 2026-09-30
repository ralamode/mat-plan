# Agent skills: index and roadmap

Project skills for working in mat-plan. Claude Code loads each `*/SKILL.md` automatically: the
`description` decides when it triggers, and the body is the procedure. **This file is the running list
of what exists and what's left.** Update it in the same PR as any skill change.

## The lifecycle they cover

```
start-task ──► plan-with-panel ──► (implement) ──► ship-pr ──► review-pr ──► merged
 sync+branch    plan + eng/UX        │                │ hold-the-bar   on request: P0/P1/P2
 obligations    panels, log          │                │ ui-screenshot  (+ fix mode)
                                     ├─ db-migration      (schema / seed)
                                     ├─ add-server-action (any mutation)
                                     └─ data-correction   (wrong prod data; the bug gets its own PR)
 debug-ci-failure: whenever anything is red
```

## Shipped

| Skill                                               | Use it when                                                             | Since        |
| --------------------------------------------------- | ----------------------------------------------------------------------- | ------------ |
| [`start-task`](./start-task/SKILL.md)               | Starting any task that ends in a PR: sync, branch, context, obligations | #170         |
| [`plan-with-panel`](./plan-with-panel/SKILL.md)     | A plan is owed, or any UI change (UX panel, including plan-exempt)      | #170         |
| [`ship-pr`](./ship-pr/SKILL.md)                     | Work is done: gates → status → commit → PR → post-merge check           | #170         |
| [`hold-the-bar`](./hold-the-bar/SKILL.md)           | Before every PR (ship-pr runs it), or whenever red turned green         | #170         |
| [`ui-screenshot`](./ui-screenshot/SKILL.md)         | Any visible change: three widths, published to the PR                   | pre-existing |
| [`review-pr`](./review-pr/SKILL.md)                 | On request only: review a PR, branch or area → verified P0/P1/P2        | #173         |
| [`db-migration`](./db-migration/SKILL.md)           | Any schema, migration, reference table or seed change                   | #173         |
| [`add-server-action`](./add-server-action/SKILL.md) | Any new or changed mutation, with its boundary tests                    | #173         |
| [`data-correction`](./data-correction/SKILL.md)     | Wrong data in prod the app can't fix                                    | #173         |
| [`debug-ci-failure`](./debug-ci-failure/SKILL.md)   | Anything red: CI, local gate, flake, build                              | #173         |

## Backlog, in priority order

Candidates came from the repo's recurring operations and from
[addyosmani/agent-skills](https://github.com/addyosmani/agent-skills). Pick from the top.

| #   | Skill                     | Source   | What it would package                                                                                                                                          | Why                                                                                                                      |
| --- | ------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | `@claude review` workflow | mat-plan | a GitHub Action that runs `review-pr` when a writer comments `@claude review`; subscription auth (`CLAUDE_CODE_OAUTH_TOKEN`); on request only, never automatic | Ray's call 2026-09-30. **CI change → plan + panel**; the repo is public, so forks and prompt injection are the core risk |
| 2   | baseline audit + P0 fixes | mat-plan | run `review-pr` in audit mode over each area; P0s become one `fix/` PR per concern                                                                             | Ray asked for it. Seeds below                                                                                            |
| 3   | `source-check`            | addy     | verify an API or pattern against the official docs for the pinned version before using it                                                                      | Next 16 / React 19.3 / zod 4 / Drizzle 0.45 are newer than most training data                                            |
| 4   | panel agents              | addy     | `.claude/agents/*.md` personas for each panel lens (correctness, scope, a11y, trust…)                                                                          | Makes each lens identical run to run; `plan-with-panel` and `review-pr` would call them                                  |
| 5   | `doubt-check`             | addy     | a fresh-context adversarial check on one decision mid-implementation (auth, corrections, migrations)                                                           | Panels cover plans; this covers the choices made after them                                                              |
| 6   | `refine-idea`             | addy     | interview-me / idea-refine for brainstorm docs and PRDs; ends in a "Not doing (and why)" section                                                               | For `*-brainstorm.md` / ONB PRDs; scope discipline                                                                       |
| 7   | session-start hook        | addy     | print the `docs/status.md` "Where we are" pointer + open PRs at session start                                                                                  | Cheap context; configure via settings hooks, not a skill                                                                 |
| 8   | `seed-program`            | mat-plan | add or update a program/roster seed with its invariants, and the LLM-never-authors-loads rule                                                                  | Only if it keeps coming up (#151, #152, #154)                                                                            |

### Seeds for the baseline audit (found while building batch 2)

Places where AGENTS.md or the docs claim something the code doesn't do. Each needs a verdict: fix the
code, fix the doc, or record it as accepted debt. **None has been triaged yet.**

- AGENTS.md → "Design" references a root `DESIGN.md`; the file is `docs/design.md`.
- "No coverage drop on changed files" (Backend/API rules): no coverage tool or threshold exists.
- The CWV budget: nothing measures it (ADR 0001 only plans it).
- `typecheck` and `lint` cover `apps/web` only, so `packages/` is neither typechecked nor linted.
- `audit --prod` runs only in local `pnpm verify`, not in CI.
- "Keyboard-usable, focus-visible": no automated keyboard or focus check.
- The corrections README mentions an `applied` flag the `Correction` type doesn't have.
- The CONCURRENTLY "transaction-stripping runner" AGENTS.md describes doesn't exist (tech-debt.md).
- AGENTS.md says "Idempotency-Key → persist first result"; the code uses a `clientId` field + ON CONFLICT.
- No automated tests for corrections (`registry.ts`).

**Deliberately not adopting** from addyosmani/agent-skills: spec-driven, planning, code-review,
code-simplification, security-hardening, TDD, perf, ADRs, git-workflow, ci-cd, shipping,
deprecation-and-migration. mat-plan's own rules are stricter or more specific, or built-ins
(`/code-review`, `/simplify`, `/security-review`) already cover them. A second copy would be a second
source of truth.

## How to write a skill here

- **Point, don't copy.** AGENTS.md, the DoD, `docs/plans/README.md` and lessons.md stay the source of
  truth. A skill is the _order_ to apply them in, plus the traps. If a skill and a source doc
  disagree, the doc wins; fix the skill in that PR.
- **The description is the trigger.** Say what it does, then "Use when …" with the phrases people
  actually type.
- **Include Red flags and, where useful, Common rationalizations**, seeded from real incidents (cite
  the PR number or the lessons entry). That's what stops an agent rationalising its way past a step.
- **Scripts beat prose for mechanical checks** (see `hold-the-bar/check.sh`), and a script ships with
  a test of its own failure cases.
- `.claude/` is on the e2e auto-skip allowlist. A skills-only PR is docs-shaped: no plan, no panel.

## Changelog

- **2026-09-30** — Shipped `start-task`, `plan-with-panel` (it absorbs the planned standalone
  `ux-panel`), `ship-pr` and `hold-the-bar`. Seeded this backlog from the audit of recurring
  operations and addyosmani/agent-skills. Shipped with `ship-pr` itself (#170). The dry run found two
  gaps, both fixed: step 1 can't rebase a dirty tree, and `check.sh` lacked the self-test this file
  requires.
- **2026-09-30** — Batch 2 (#173): `review-pr` (the rubric the on-demand `@claude review` workflow will
  run), `db-migration`, `add-server-action`, `data-correction` and `debug-ci-failure`. Each was
  written from a fact sheet of the actual code rather than from AGENTS.md alone, which surfaced the
  audit seeds above. Skills say what's really wired (no auth, no action rate limits, no coverage
  tool) instead of what AGENTS.md claims.
