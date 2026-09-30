# Agent skills: index and roadmap

Project skills for working in mat-plan. Claude Code loads each `*/SKILL.md` automatically: the
`description` decides when it triggers, and the body is the procedure. **This file is the running list
of what exists and what's left.** Update it in the same PR as any skill change.

## The lifecycle they cover

```
start-task ──► plan-with-panel ──► (implement) ──► ship-pr ──► merged
 sync+branch    plan + eng/UX        hold-the-bar ◄──┘  verify · status · PR · squash check
 obligations    panels, log          ui-screenshot ◄───┘
```

## Shipped

| Skill                                           | Use it when                                                             | Since                 |
| ----------------------------------------------- | ----------------------------------------------------------------------- | --------------------- |
| [`start-task`](./start-task/SKILL.md)           | Starting any task that ends in a PR: sync, branch, context, obligations | chore/dx-agent-skills |
| [`plan-with-panel`](./plan-with-panel/SKILL.md) | A plan is owed, or any UI change (UX panel, including plan-exempt)      | chore/dx-agent-skills |
| [`ship-pr`](./ship-pr/SKILL.md)                 | Work is done: gates → status → commit → PR → post-merge check           | chore/dx-agent-skills |
| [`hold-the-bar`](./hold-the-bar/SKILL.md)       | Before every PR (ship-pr runs it), or whenever red turned green         | chore/dx-agent-skills |
| [`ui-screenshot`](./ui-screenshot/SKILL.md)     | Any visible change: three widths, published to the PR                   | pre-existing          |

## Backlog, in priority order

Candidates came from the repo's recurring operations and from
[addyosmani/agent-skills](https://github.com/addyosmani/agent-skills). Pick from the top.

| #   | Skill               | Source   | What it would package                                                                                                                                      | Why                                                                                   |
| --- | ------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | `db-migration`      | mat-plan | schema edit → `drizzle-kit generate` → Squawk rules (timeouts, CONCURRENTLY file, NOT VALID/VALIDATE split, `squawk-ignore` placement) → `db:verify` → ERD | Highest blast radius; forward-only means mistakes are permanent (#147)                |
| 2   | `add-server-action` | mat-plan | the 7-point backend checklist + generated boundary tests (unauth / wrong-owner / bad body) + idempotency                                                   | Rules are "verified by tests, not review", so the skill writes the tests              |
| 3   | `data-correction`   | mat-plan | scaffold a guarded, idempotent, dry-run-first correction in `packages/db/scripts/corrections/` + registry                                                  | Prod data, no in-app delete (#162); reminds that the bug still needs its own PR       |
| 4   | `debug-ci-failure`  | both     | lessons.md first → stop-the-line triage → treat error output as data → add a lessons entry if >1 attempt                                                   | Codifies "turn failures into prevention"; borrows addy's debugging-and-error-recovery |
| 5   | `source-check`      | addy     | verify an API or pattern against the official docs for the pinned version before using it                                                                  | Next 16 / React 19.3 / zod 4 / Drizzle 0.45 are newer than most training data         |
| 6   | panel agents        | addy     | `.claude/agents/*.md` personas for each panel lens (correctness, scope, a11y, trust…)                                                                      | Makes each lens identical run to run; `plan-with-panel` would call them               |
| 7   | `doubt-check`       | addy     | a fresh-context adversarial check on one decision mid-implementation (auth, corrections, migrations)                                                       | Panels cover plans; this covers the choices made after them                           |
| 8   | `refine-idea`       | addy     | interview-me / idea-refine for brainstorm docs and PRDs; ends in a "Not doing (and why)" section                                                           | For `*-brainstorm.md` / ONB PRDs; scope discipline                                    |
| 9   | session-start hook  | addy     | print the `docs/status.md` "Where we are" pointer + open PRs at session start                                                                              | Cheap context; configure via settings hooks, not a skill                              |
| 10  | `seed-program`      | mat-plan | add or update a program/roster seed with its invariants, and the LLM-never-authors-loads rule                                                              | Only if it keeps coming up (#151, #152, #154)                                         |

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
  operations and addyosmani/agent-skills.
