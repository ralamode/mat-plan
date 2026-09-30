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

| Skill                                               | Use it when                                                                                                                                                                                           | Since        |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| [`start-task`](./start-task/SKILL.md)               | Starting any task that ends in a PR: sync, branch, context, obligations                                                                                                                               | #170         |
| [`plan-with-panel`](./plan-with-panel/SKILL.md)     | A plan is owed, or any UI change (UX panel, including plan-exempt)                                                                                                                                    | #170         |
| [`ship-pr`](./ship-pr/SKILL.md)                     | Work is done: gates → status → commit → PR → post-merge check                                                                                                                                         | #170         |
| [`hold-the-bar`](./hold-the-bar/SKILL.md)           | Before every PR (ship-pr runs it), or whenever red turned green                                                                                                                                       | #170         |
| [`ui-screenshot`](./ui-screenshot/SKILL.md)         | Any visible change: three widths, published to the PR                                                                                                                                                 | pre-existing |
| [`review-pr`](./review-pr/SKILL.md)                 | On request only: review a PR, branch or area → verified P0/P1/P2                                                                                                                                      | #173         |
| [`db-migration`](./db-migration/SKILL.md)           | Any schema, migration, reference table or seed change                                                                                                                                                 | #173         |
| [`add-server-action`](./add-server-action/SKILL.md) | Any new or changed mutation, with its boundary tests                                                                                                                                                  | #173         |
| [`data-correction`](./data-correction/SKILL.md)     | Wrong data in prod the app can't fix                                                                                                                                                                  | #173         |
| [`debug-ci-failure`](./debug-ci-failure/SKILL.md)   | Anything red: CI, local gate, flake, build                                                                                                                                                            | #173         |
| [`keep-mergeable`](./keep-mergeable/SKILL.md)       | After any merge: keep every `shipit`'d PR mergeable (changelog conflicts auto; real ones ask)                                                                                                         | #181         |
| [panel agents](../agents/)                          | one lens each: `correctness-` · `scope-` · `architecture-` · `reuse-` · `db-safety-` · `security-` · `ux-reviewer`, plus `fact-sheet`; shared [reporting contract](./review-pr/reporting-contract.md) | #178         |

## Guards (mechanisms, not procedures)

Where a rule failed as prose, it became a check. Each ships with a self-test, and `pnpm guards:test`
(in `verify`, not in CI) runs them all.

| Guard                                                                                                                      | Enforces                                                                                     | Self-test                                           |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| [`guard-main-checkout.mjs`](../hooks/guard-main-checkout.mjs) (PreToolUse)                                                 | The main checkout stays on `main`: an allowlist of read/sync git there (best-effort)         | `bash .claude/hooks/hooks.test.sh`                  |
| [`session-context.mjs`](../hooks/session-context.mjs) (SessionStart)                                                       | Every session starts from the real state: status, open PRs, stale/off-main worktrees         | same                                                |
| [`check-skills.mjs`](../../.github/scripts/check-skills.mjs) (`pnpm skills:check`, in `verify`)                            | A skill can't cite a path or `pnpm` script that doesn't exist                                | `bash .github/scripts/check-skills.test.sh`         |
| [`check-status-touched.mjs`](../../.github/scripts/check-status-touched.mjs) (`pnpm status:check`, `ship-pr` step 3; #177) | A feat/fix/db/perf/refactor/revert branch touched `docs/status.md` (`STATUS_SKIP` overrides) | `bash .github/scripts/check-status-touched.test.sh` |
| [`hold-the-bar/check.sh`](./hold-the-bar/check.sh)                                                                         | The diff didn't lower the quality bar                                                        | `bash .claude/skills/hold-the-bar/check.test.sh`    |

## Backlog, in priority order

Candidates came from the repo's recurring operations and from
[addyosmani/agent-skills](https://github.com/addyosmani/agent-skills). Pick from the top.

| #   | Skill                                                                                | Source   | What it would package                                                                                                                                          | Why                                                                                                                      |
| --- | ------------------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | `@claude review` workflow → **DX-1**, [plan](../../docs/plans/dx-1-claude-review.md) | mat-plan | a GitHub Action that runs `review-pr` when a writer comments `@claude review`; subscription auth (`CLAUDE_CODE_OAUTH_TOKEN`); on request only, never automatic | Ray's call 2026-09-30. **CI change → plan + panel**; the repo is public, so forks and prompt injection are the core risk |
| 2   | baseline audit + P0 fixes                                                            | mat-plan | run `review-pr` in audit mode over each area; P0s become one `fix/` PR per concern                                                                             | Ray asked for it. Seeds below                                                                                            |
| 3   | `source-check`                                                                       | addy     | verify an API or pattern against the official docs for the pinned version before using it                                                                      | Next 16 / React 19.3 / zod 4 / Drizzle 0.45 are newer than most training data                                            |
| 4   | `doubt-check`                                                                        | addy     | a fresh-context adversarial check on one decision mid-implementation (auth, corrections, migrations)                                                           | Panels cover plans; this covers the choices made after them                                                              |
| 5   | `refine-idea`                                                                        | addy     | interview-me / idea-refine for brainstorm docs and PRDs; ends in a "Not doing (and why)" section                                                               | For `*-brainstorm.md` / ONB PRDs; scope discipline                                                                       |
| 6   | session-start hook                                                                   | addy     | print the `docs/status.md` "Where we are" pointer + open PRs at session start                                                                                  | Cheap context; configure via settings hooks, not a skill                                                                 |
| 7   | `seed-program`                                                                       | mat-plan | add or update a program/roster seed with its invariants, and the LLM-never-authors-loads rule                                                                  | Only if it keeps coming up (#151, #152, #154)                                                                            |

### Seeds for the baseline audit (found while building batch 2)

Places where AGENTS.md or the docs claim something the code doesn't do. Each needs a verdict: fix the
code, fix the doc, or record it as accepted debt. **None has been triaged yet.**

- AGENTS.md → "Design" references a root DESIGN.md, which does not exist; the file is `docs/design.md`.
- "No coverage drop on changed files" (Backend/API rules): no coverage tool or threshold exists.
- The CWV budget: nothing measures it (ADR 0001 only plans it).
- `typecheck` and `lint` run from `apps/web`. Package files the app imports are typechecked through it
  (each package's `main` is `src/index.ts`), but files it never imports (`packages/db/scripts/*`:
  `verify.ts`, `correct.ts`, the corrections registry) are never typechecked, and nothing in
  `packages/` is linted.
- `audit --prod` runs only in local `pnpm verify`, not in CI.
- "Keyboard-usable, focus-visible": no automated keyboard or focus check.
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
- **2026-09-30** — `pnpm status:check` (ROI item 5, #177): a feat/fix/db/perf/refactor/revert branch must touch
  `docs/status.md`, with `STATUS_SKIP="<why>"` as a visible override. It runs at the end of `ship-pr` step 3
  (local, like `guides:check` was before CI); self-tested by `.github/scripts/check-status-touched.test.sh`.
- **2026-09-30** — Panel agents (#178): the lenses this session kept re-typing as inline prompts are
  now named agents in `.claude/agents/`, one lens each (the four standing lenses, DB-safety, security
  and UX, plus `fact-sheet`), with one shared reporting contract in `review-pr/`.
  `plan-with-panel` and `review-pr` call them by name. `security-reviewer` carries the
  "cite third-party behaviour from source at the pinned version" rule that caught DX-1's token leak.
- **2026-09-30** — Guards (ROI items 1–3): a `PreToolUse` hook that keeps the main checkout on
  `main`, a `SessionStart` briefing, and `pnpm skills:check` in `verify`. All three enforce rules that
  already existed; the main-checkout rule had failed twice within hours of being written down.
- **2026-09-30** — `keep-mergeable`: `shipit` now means "I keep this mergeable until it lands". Every
  merge in the 09-30 batch re-conflicted the other approved PRs at the same changelog line, and each
  was fixed by hand. The skill merges `main` in from a detached worktree (fast-forward push, never
  force), auto-resolves only changelog/append-style conflicts and asks on anything else. `review-pr`
  gains a "Shipit" step (the bar for posting it), and `ship-pr` step 8 ends with the sweep. The root
  cause, one shared insertion point in `docs/status.md`, is planned separately ([DX-2](../../docs/plans/dx-2-changelog-fragments.md), changelog fragments).
- **2026-09-30** — DX-1 implemented: `review-pr` gained a CI mode and one shared prefetch
  (`.github/scripts/review-prefetch.sh`) for local and `@claude review` runs. Posting is now always
  the caller's job.
