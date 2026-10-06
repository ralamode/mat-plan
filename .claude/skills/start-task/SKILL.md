---
name: start-task
description: Start any new piece of mat-plan work correctly — sync main, cut the task its own git worktree under .claude/worktrees/ on a correctly named branch (the main checkout stays on main), load the feature guide and backlog row, and decide whether the change needs a committed plan and which review panels it owes. Use at the START of every task that will end in a PR, before reading or editing code — "let's do V1-x", "fix this bug", "start on", "pick up the next item".
---

# Start a task

The rules live in [AGENTS.md](../../../AGENTS.md) → "Git & branch workflow", "Feature guides" and
"Implementation plans". This skill is the order to apply them in. Do not restate them in the PR.

## 1. Sync, then cut a worktree (every task, never skip)

Run these from the **main checkout**, which stays on `main`:

```bash
git worktree list                                   # what's already in flight; don't collide with it
git fetch origin && git pull --ff-only origin main   # keep the main checkout current (it stays on main)
git worktree add .claude/worktrees/<slug> -b <type>/<id>-<slug> origin/main
cd .claude/worktrees/<slug> && pnpm install          # node_modules are per worktree
```

**All work for the task happens in that worktree.** The rule is AGENTS.md → "Git & branch workflow".

- `type` ∈ `feat|fix|chore|docs|refactor|perf|test|db`. `id` is the backlog id, lowercased
  (`v1-26`, `gap-3`, `ydp-2`). No backlog id? Use a scope instead (`chore/dx-…`), and ask whether the
  work should get a row in [docs/plan.md](../../../docs/plan.md) first.
- **Don't switch the main checkout to a feature branch**, not even "just for a small fix". Other
  sessions read it and expect `main`.
- `.claude/worktrees/`, not `/tmp`. `/tmp` is wiped on reboot and invisible to other sessions.
- The main checkout is on a feature branch, or `--ff-only` fails? Something else is using it, or
  local `main` has commits that aren't on origin. Stop and ask. Do not merge, reset or check out
  over it.
- A worktree in `git worktree list` whose branch is merged is stale. Mention it to the user; only
  remove worktrees you created.

**Why:** a branch cut from a stale `main` silently omits a just-merged migration or schema change,
and the drift surfaces in CI instead of at your desk. A shared checkout lets one session's
`checkout` or `rebase` move another session's files out from under it.

## 2. Load the context before touching code

Read these in order and stop as soon as you have enough:

1. **The backlog row**: `grep -rn '<ID>' docs/plan.md docs/status.md docs/changelog/`. Copy its acceptance criterion
   verbatim; it becomes the plan's Acceptance and the PR's Description.
2. **An existing plan**: `ls docs/plans/ | grep -i <id>`. If one exists, it is the contract. Follow it,
   and record any deviation in the PR rather than editing the merged plan.
3. **The feature guide**, if the change touches an owned file:
   `grep -l '<path fragment>' docs/features/*.md`. The guides today cover strength logging, the write
   path and programming. Read the invariants and traps sections before anything else.
4. **Known traps**: `grep -n -i '<area keyword>' docs/lessons.md` (e.g. `migration`, `playwright`,
   `mermaid`, `squash`).
5. **Standing decisions** in the user's memory (for example, the A/B rotation is calendar-indexed on
   purpose). Don't "fix" a recorded decision.

## 3. Classify the change and state the obligations up front

Tell the user, in one short block, what this task owes before it can ship:

| If the change…                                                                           | It owes                                                                                         |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| touches CI, a migration, auth, a new subsystem/runner, or non-trivial logic across files | a committed plan at `docs/plans/<id>-<slug>.md` + the engineering panel → `plan-with-panel`     |
| touches anything a person sees                                                           | a **UX panel before implementation** (any size; depth scales) → `plan-with-panel`               |
| adds or changes a Server Action / Route Handler                                          | the 7-point backend checklist + boundary tests (AGENTS.md → "Backend / API PR rules")           |
| changes the schema                                                                       | a generated migration + the DB rules (AGENTS.md → "Database / migration PR rules")              |
| touches a file a feature guide owns                                                      | that guide updated in the same PR (`pnpm guides:check`)                                         |
| changes a pivotal flow or data model                                                     | a Mermaid diagram in the PR description + [docs/architecture.md](../../../docs/architecture.md) |
| is docs, copy, a config one-liner or a single-file mechanical change                     | no plan; still `ship-pr`                                                                        |

If a plan is owed, **no implementation code is committed before the plan is reviewed**. Go to
`plan-with-panel` next.

## 4. Will this run alongside something else?

`git worktree list` is what is in flight. If any of it overlaps, run the rubric in
[docs/parallel-work.md](../../../docs/parallel-work.md) **before** cutting code — gate 1 (disjoint file
globs, **feature guides included**) is the one that actually fails, and a shared roadmap, an agreed
contract and an approved prototype all pass it without noticing. When a gate fails, pick an order and
write the reason into the roadmap's "In flight", rather than discovering it in a merge.

## 5. Scope check

At ~4h/wk, the one-concern / <400-line target is a real constraint. If the task clearly exceeds it,
propose the split (1a/1b/1c, as in `gap1-p1-*`, `v1-18-*`) before starting, not after.

## Red flags

- About to edit code on `main`, or on a branch cut before the latest merge.
- Starting work with no backlog id and no conversation about whether it needs one.
- "It's small, it doesn't need the UX panel." Every UI change needs one; only the depth scales.
- Reading the whole codebase when a feature guide exists for the area.
- Starting alongside another worktree without intersecting the file lists — _and_ their guides, since
  `guides:check` makes two tracks under one guide collide even when the code files differ.
