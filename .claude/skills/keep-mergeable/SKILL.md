---
name: keep-mergeable
description: Keep every mat-plan PR that has a `shipit` comment mergeable until it lands — after any merge to main (or on request), find shipit'd PRs that went CONFLICTING or BEHIND, merge main into each in a detached worktree, auto-resolve only changelog/append-style conflicts (keep both sides, newest first), stop and ask on any real conflict, push fast-forward only, re-run the checks and leave a one-line comment. Use right after a merge lands, when a shipit'd PR shows conflicts, or when the user says "fix the merge conflicts", "keep the PRs mergeable", "update the branches".
---

# Keep shipit'd PRs mergeable

**Posting `shipit` is a promise, not a snapshot.** It says "ready to merge", and it stays true only if
the PR keeps up with `main`. Merges land in batches, and each one re-conflicts the other approved PRs,
almost always at the same line: the top of the `docs/status.md` changelog. Whoever posted `shipit`
keeps the PR mergeable until it merges, without being asked. The rule for posting `shipit` at all is
in [review-pr](../review-pr/SKILL.md) → "Shipit".

## When to run it

- **Right after any merge to `main`** you make or see. [ship-pr](../ship-pr/SKILL.md) step 8 ends
  by running this sweep.
- When a PR you approved shows **CONFLICTING** or **BEHIND**.
- On a timer while a batch of approved PRs is open: `/loop 20m` with this skill.

## 1. Find the PRs

```bash
git fetch origin
for n in $(gh pr list --state open --json number --jq '.[].number'); do
  gh pr view "$n" --json comments --jq '.comments[].body' | grep -q '^## shipit' || continue
  gh pr view "$n" --json number,headRefName,mergeable,mergeStateStatus \
    --jq '"#\(.number) \(.headRefName) \(.mergeable) \(.mergeStateStatus)"'
done
```

Act on `CONFLICTING`, or `BEHIND` (the branch rule requires up to date). `UNKNOWN` means GitHub is
still computing: wait a few seconds and re-read, never guess.

## 2. Merge `main` in, from a detached worktree

The PR branch is usually checked out in its author's worktree. **Don't touch that worktree**, and
never check the branch out a second time:

```bash
git worktree add --detach .claude/worktrees/km-<n> origin/<branch>
cd .claude/worktrees/km-<n> && pnpm install --frozen-lockfile
git merge --no-edit origin/main
```

**A merge, not a rebase**, so the push is a fast-forward. A rebase would need a force-push, and a
force-push leaves the author's local branch diverged. The squash merge discards the merge commit
anyway.

## 3. Resolve, or stop

Auto-resolve **only** these shapes:

| Conflict                                                              | Resolution                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Two entries inserted at the top of `docs/status.md` → Changelog       | Keep both, **this PR's first** (newest on top); no blank line between entries  |
| Two entries appended to a changelog list (`.claude/skills/README.md`) | Keep both, **`main`'s first** (merge order)                                    |
| Two rows added to the same table, or both sides renumbered one        | Keep both rows; take `main`'s version of any row this PR didn't mean to change |
| Two scripts added at the same line of `package.json`                  | Keep both, comma-separated; the JSON must still parse                          |

**Anything else is a real conflict: stop and ask**, and name the files and hunks. Code, tests, a
migration, a rule stated two different ways, a row both sides edited: guessing there is how work
silently disappears. After resolving, `grep -nE '^(<<<<<<<|=======$|>>>>>>>)'` on every touched file
must print nothing.

## 4. Prove it, then push fast-forward only

```bash
pnpm exec prettier --write <resolved files>
pnpm verify                                   # plus pnpm guides:check and pnpm status:check
bash .claude/skills/hold-the-bar/check.sh origin/main
git diff origin/main HEAD --stat              # only this PR's files; nothing of main's reverted
git commit --no-edit                          # the merge commit
git merge-base --is-ancestor origin/<branch> HEAD && git push origin HEAD:<branch>
```

If the `is-ancestor` check fails, someone pushed meanwhile: fetch and start again from step 2. **Never
`--force`.**

## 5. Close the loop

- Wait for CI on the new head: `gh pr checks <n> --watch` (after the runs register).
- Comment one line: `Merged main (#<m> landed); <what conflicted> resolved by keeping both. CI green.`
- Still green and MERGEABLE, so the `shipit` stands. If a check went red, the `shipit` no longer
  holds: say so on the PR and fix it or hand it back.
- `git worktree remove --force .claude/worktrees/km-<n>`.

## Red flags

- A force-push to a PR branch, or checking out a branch another worktree holds.
- "Resolved" by taking one side of a real conflict.
- A `shipit` left standing on a PR that is CONFLICTING, BEHIND or red.
- A merge that shows files from `main` in `git diff origin/main HEAD --stat`, meaning something of
  main's was reverted.
