---
name: ship-pr
description: Take a finished mat-plan branch to an open, reviewable PR without dropping a per-PR obligation — the local gates (verify, guides, hold-the-bar, e2e:local when needed), a changelog fragment and status/plan/lessons in the same PR, Conventional Commit, the template body, the DoD pass — and check main after the squash merge. Use when the work is done and the user says "ship it", "open the PR", "commit and push", "wrap this up", or after a merge to confirm main.
---

# Ship a PR

Source of truth: [docs/definition-of-done.md](../../../docs/definition-of-done.md) and
[.github/PULL_REQUEST_TEMPLATE.md](../../../.github/PULL_REQUEST_TEMPLATE.md). This is the order to
satisfy them in. Committing and pushing are **outward-facing**, so confirm with the user before step 6
unless they have already said to ship.

## 1. Bring the branch up to date with main

```bash
git status --short                       # dirty? commit the work first
git fetch origin
b=$(git symbolic-ref --short HEAD) || { echo "detached HEAD: check out the branch first"; exit 1; }
git ls-remote --exit-code origin "refs/heads/$b" >/dev/null; rc=$?
if [ $rc -eq 0 ]; then                   # already pushed: merge, never rebase
  git pull --no-rebase --no-edit origin "$b" && git merge --no-edit origin/main
elif [ $rc -eq 2 ]; then                 # not on the remote yet: rebase freely
  git rebase origin/main
else
  echo "ls-remote failed ($rc): stop and retry; don't guess"
fi
```

Nothing enforces this before merge (branch protection is off; see AGENTS.md → "Git & branch
workflow"), so it's on you: doing it now surfaces conflicts while you still have the context. Once
the branch is on the remote, a rebase would need a force-push, and someone (the `keep-mergeable`
skill) may have merged `main` into it already.

**A conflicted merge:** resolve using [keep-mergeable](../keep-mergeable/SKILL.md) step 3's
table (it is the one source for which shapes auto-resolve), then `git add <files>` and
`git commit --no-edit`, not `rebase --continue`.

## 2. Local gates, cheapest first

```bash
pnpm verify              # format:check → lint → typecheck → test → db:verify → audit --prod (~25s)
pnpm guides:check        # feature guide touched with every owned file it covers
bash .claude/skills/hold-the-bar/check.sh   # the diff did not quietly lower the bar
```

Then, only if the change touches a flow the Playwright smoke covers (see `apps/web/e2e/*.spec.ts`:
the gate login, bodyweight logging, day navigation, the CSV export, a11y):

```bash
pnpm e2e:local           # minutes; throwaway embedded Postgres, never touches Neon
```

A red gate: grep [docs/lessons.md](../../../docs/lessons.md) for the symptom **before** debugging.
If the diagnosis took more than one attempt, add a lessons entry (symptom → cause → fix) in this PR.

Not run locally, so don't claim them: `next build`, gitleaks, the forward-only guard, Squawk, and
CodeQL (which never runs on PRs).

## 3. Status rides with the work (same PR, never a follow-up)

- **A changelog fragment**: add `docs/changelog/<YYYY-MM-DD>-<branch>.md`. The name, the entry format
  and the link forms are in [docs/changelog/README.md](../../../docs/changelog/README.md). Write it
  from the diff, not from memory; #156 exists because the old changelog drifted.
- [docs/status.md](../../../docs/status.md): update the **Where we are** pointer if this moves it, and
  the backlog row. No changelog entry goes here any more. Nothing checks these, so it's on you.
- **The PR description's "Where this sits" block, _if_ this PR advances something larger** — pillar,
  milestone (linked), what this PR is within it, what comes next and what that is gated on. Fill it
  from [roadmap.md](../../../docs/roadmap.md) and the milestone's spec, not from memory. **Delete the
  section** for a standalone PR (dependency bump, one-off bug, typo, config one-liner): `Milestone:
none` is noise. A plan or spec PR is not standalone — it advances its milestone.
- [docs/roadmap.md](../../../docs/roadmap.md): move the item — **In flight**, the active milestone's
  chunk row, **Next per pillar**, **Recently landed**. It is forward-looking, so it is the one a new
  session reads first and the one nobody notices has gone stale. Ids only; never copy a `plan.md` row.
- [docs/plan.md](../../../docs/plan.md): tick or annotate the row, and link the plan if one exists.
- Then confirm: `pnpm status:check` (a feat/fix/db/perf/refactor/revert branch must add a correctly
  named fragment; `STATUS_SKIP="<why>"` to override, and paste the reason into the PR. It also fails
  ANY branch that adds an entry to the frozen status.md or skills-README history, and that part is
  not skippable: [the rule](../../../docs/changelog/README.md)). It runs
  here, after the update, not with the step-2 gates: run earlier it fails on every product branch.
- Feature guide: already enforced by `guides:check`, but reread its traps section. Did this change
  add one?
- [docs/architecture.md](../../../docs/architecture.md): update the diagram if a pivotal flow or
  model changed.

## 4. UI evidence

Any visible change → run the `ui-screenshot` skill (three widths, `.screenshots/`, never committed).
Confirm the **UX panel log** exists, in the plan or ready for the PR description.

## 5. Definition-of-Done pass

Walk [docs/definition-of-done.md](../../../docs/definition-of-done.md) and answer each applicable box
explicitly. For a Server Action or Route Handler, also confirm the boundary tests exist (unauth →
reject, wrong owner → forbid, bad body → zod-reject). For a migration, confirm the generated SQL is
committed and the forward-only rule is untouched. Report any unchecked box to the user; don't
silently skip it.

## 6. Commit

- Conventional Commit, **lowercase subject**, **header ≤ 100 chars**:
  `feat(v1-26): the form knows the movement`. commitlint rejects sentence case and long headers.
  List details in the body, not the subject.
- **Never silence `git commit`'s output** (`>/dev/null`), and chain the next step with `&&`. A
  rejected commit then looks like success until the next git step complains about a dirty tree.
- End the message with the attribution line from the current system instructions.
- **Never write the literal skip-CI marker in a commit message**, not even when describing it. GitHub
  and Vercel match it anywhere in the head commit and a squash carries it onto `main`
  (see lessons.md → "GitHub / PRs").
- Hooks: pre-commit runs lint-staged; pre-push runs typecheck + tests. Don't `--no-verify` past them.
  If a hook is wrong, fix the hook.

## 7. Open the PR

```bash
git push -u origin HEAD
gh pr create --title "<conventional title>" --body-file <scratchpad>/pr-body.md
```

Build the body from the PR template: Description (what, why, backlog id, plan link), Type, How
tested (with boundary cases for endpoints), Test configuration, Screenshots, Diagram. Rules:

- **Mermaid** for any schema, flow or model change: an ERD or flowchart that matches
  `docs/architecture.md`. **No backticks inside node labels**, which breaks the Mermaid lexer.
- The **first** screenshots go in the description (`screenshots:publish --pr <n>`). Later rounds go
  in a comment with `--note`.
- Plan-exempt UI change: paste the UX review-response log into the description.
- End with the PR attribution line from the current system instructions.
- `gh` returning 403: a `GH_TOKEN` in the environment is shadowing the keyring credential. Retry with
  `env -u GH_TOKEN -u GITHUB_TOKEN gh …`.

Then check that the Actions runs actually started. Runs take a few seconds to register after a push,
so `gh pr checks <n> --watch` fired immediately can exit with only the Vercel rows. Wait until
`gh pr checks <n>` lists `quality`, `e2e` and `gitleaks`, then watch. If they **never** appear, check
`gh api "repos/<o>/<r>/actions/runs?head_sha=<sha>" --jq .total_count`: zero means something skipped
CI; it isn't a queue delay.

## 8. After merge

From the **main checkout** (which is on `main`):

```bash
git pull --ff-only origin main
git show HEAD --stat | head -30                     # the squash contains your final commit's files
git worktree remove .claude/worktrees/<slug> && git branch -D <branch>   # -D: squash-merged, so git can't tell it's merged
```

A squash of a stale head silently drops the last pushes (#129 recovered three commits dropped from
#127). If anything is missing, cherry-pick it forward on a follow-up branch **before** removing the
worktree.

Then **sweep the other approved PRs**: this merge probably just put them in conflict. Run
[keep-mergeable](../keep-mergeable/SKILL.md) for every open PR with a `## shipit` comment.

## Red flags

- A backlog item merged, but `docs/roadmap.md` still shows it as next, or in flight, or absent.
- A backlog item merged, but its `docs/status.md` row or "Where we are" pointer unchanged. The guard
  only checks the fragment.
- The PR claims a CI gate that isn't in `.github/workflows/`. AGENTS.md carries an explicit warning
  about exactly this.
- A `ci-skip-e2e` or `docs-skip-feature-map` label applied with no one-line reason in the PR.
- Pushing to fix CI one round at a time when `pnpm verify` / `pnpm e2e:local` would have caught it
  locally.
