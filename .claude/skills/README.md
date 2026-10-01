# Agent skills: index and roadmap

Project skills for working in mat-plan. Claude Code loads each `*/SKILL.md` automatically: the
`description` decides when it triggers, and the body is the procedure. **This file holds the lifecycle,
the guards and the backlog; the skills are their own index** (below). Record a skill change with a [changelog fragment](../../docs/changelog/README.md) in the same PR.

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

**The skills are their own index.** Each `SKILL.md`'s `description` says what it does and when to use
it, and Claude Code lists them every session. Print them all with
`grep -H '^description' .claude/skills/*/SKILL.md` (the filename names the skill). The hand-maintained table that used to be here
conflicted on every skill PR (DX-2). The review lenses are named agents in [`../agents/`](../agents/),
sharing one [reporting contract](./review-pr/reporting-contract.md).

## Guards (mechanisms, not procedures)

Where a rule failed as prose, it became a check. Each ships with a self-test, and `pnpm guards:test`
(in `verify`, not in CI) runs them all.

| Guard                                                                                                                      | Enforces                                                                                                                                                                                                                                | Self-test                                           |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| [`guard-main-checkout.mjs`](../hooks/guard-main-checkout.mjs) (PreToolUse)                                                 | The main checkout stays on `main`: an allowlist of read/sync git there (best-effort)                                                                                                                                                    | `bash .claude/hooks/hooks.test.sh`                  |
| [`session-context.mjs`](../hooks/session-context.mjs) (SessionStart)                                                       | Every session starts from the real state: status, open PRs, stale/off-main worktrees                                                                                                                                                    | same                                                |
| [`check-skills.mjs`](../../.github/scripts/check-skills.mjs) (`pnpm skills:check`, in `verify`)                            | A skill can't cite a path or `pnpm` script that doesn't exist                                                                                                                                                                           | `bash .github/scripts/check-skills.test.sh`         |
| [`check-status-touched.mjs`](../../.github/scripts/check-status-touched.mjs) (`pnpm status:check`, `ship-pr` step 3; #177) | A feat/fix/db/perf/refactor/revert branch adds a [changelog fragment](../../docs/changelog/README.md) (`docs/status.md` before DX-2; `STATUS_SKIP` overrides), and fails any branch adding an entry to a frozen history (not skippable) | `bash .github/scripts/check-status-touched.test.sh` |
| [`hold-the-bar/check.sh`](./hold-the-bar/check.sh)                                                                         | The diff didn't lower the quality bar                                                                                                                                                                                                   | `bash .claude/skills/hold-the-bar/check.test.sh`    |
| [`review-prefetch.sh`](../../.github/scripts/review-prefetch.sh) (`@claude review` + local `review-pr`; DX-1)              | A PR head is reviewed as inert data, and the review job refuses a base whose agent config could widen it (`.claude/settings.json` hash-pinned)                                                                                          | `bash .github/scripts/review-prefetch.test.sh`      |
| [`review-post.sh`](../../.github/scripts/review-post.sh) (`@claude review` post job; DX-1)                                 | One comment per request, never silence; secrets withheld; `@mentions` broken; partial runs bannered                                                                                                                                     | `bash .github/scripts/review-post.test.sh`          |

## Backlog, in priority order

Candidates came from the repo's recurring operations and from
[addyosmani/agent-skills](https://github.com/addyosmani/agent-skills). Pick from the top, skipping rows marked done.

| #   | Skill                                                                                                                       | Source   | What it would package                                                                                                                                          | Why                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | ✅ **done (#185), dormant by choice**: `@claude review` workflow → **DX-1**, [plan](../../docs/plans/dx-1-claude-review.md) | mat-plan | a GitHub Action that runs `review-pr` when a writer comments `@claude review`; subscription auth (`CLAUDE_CODE_OAUTH_TOKEN`); on request only, never automatic | Ray's call 2026-09-30. **CI change → plan + panel**; the repo is public, so forks and prompt injection are the core risk |
| 2   | baseline audit + P0 fixes                                                                                                   | mat-plan | run `review-pr` in audit mode over each area; P0s become one `fix/` PR per concern                                                                             | Ray asked for it. Seeds below                                                                                            |
| 3   | `source-check`                                                                                                              | addy     | verify an API or pattern against the official docs for the pinned version before using it                                                                      | Next 16 / React 19.3 / zod 4 / Drizzle 0.45 are newer than most training data                                            |
| 4   | `doubt-check`                                                                                                               | addy     | a fresh-context adversarial check on one decision mid-implementation (auth, corrections, migrations)                                                           | Panels cover plans; this covers the choices made after them                                                              |
| 5   | `refine-idea`                                                                                                               | addy     | interview-me / idea-refine for brainstorm docs and PRDs; ends in a "Not doing (and why)" section                                                               | For `*-brainstorm.md` / ONB PRDs; scope discipline                                                                       |
| 6   | ✅ **done (#179)**: session-start hook                                                                                      | addy     | print the `docs/status.md` "Where we are" pointer + open PRs at session start                                                                                  | Cheap context; configure via settings hooks, not a skill                                                                 |
| 7   | `seed-program`                                                                                                              | mat-plan | add or update a program/roster seed with its invariants, and the LLM-never-authors-loads rule                                                                  | Only if it keeps coming up (#151, #152, #154)                                                                            |

### Baseline audit (done 2026-09-30)

The 10 doc-vs-code seeds recorded here were audited: [report](../../docs/audits/2026-09-30-baseline.md)
→ section (b) has each verdict (fix code / fix doc / accept as debt), and the fix queue is
**AUDIT-1** in [plan.md](../../docs/plan.md).

## How to write a skill here

- **Point, don't copy.** AGENTS.md, the DoD, `docs/plans/README.md` and lessons.md stay the source of
  truth. A skill is the _order_ to apply them in, plus the traps. If a skill and a source doc
  disagree, the doc wins; fix the skill in that PR.
- **The description is the trigger, and it loads in every session.** Say what it does, then "Use
  when …" with the phrases people actually type. The steps belong in the body, not the description.
- **`AGENTS.md` is already in context** (via `CLAUDE.md`, for subagents too). Name the sections to
  apply; don't tell an agent to read the file, since each panel spawn would pay for it again.
- **Include Red flags and, where useful, Common rationalizations**, seeded from real incidents (cite
  the PR number or the lessons entry). That's what stops an agent rationalising its way past a step.
- **Scripts beat prose for mechanical checks** (see `hold-the-bar/check.sh`), and a script ships with
  a test of its own failure cases.
- `.claude/` is on the e2e auto-skip allowlist. A skills-only PR is docs-shaped: no plan, no panel.

> **New entries go in [docs/changelog/](../../docs/changelog/README.md)** (DX-2). The history below
> is frozen: `status:check` fails a branch that adds to it.

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
- **2026-09-30** — Token trim, only where nothing that carries weight goes. `ui-screenshot` drops a
  stale section that called the repo private and prescribed a Chrome-MCP upload; it now points at
  `screenshots:publish` and names the three widths (1,403 → 986 words). Reviewer agents apply
  AGENTS.md sections from context instead of re-reading the file on every spawn, and stop summarising
  the reporting contract they are told to read. Four descriptions (loaded every session) keep their
  triggers and lose their step lists. Other skills were audited and left alone: at 5–11% savings the
  churn wasn't worth it.
