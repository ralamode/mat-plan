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

A `shipit` counts only when **the maintainer** posted it (this is a public repo, and the sweep runs
`pnpm install` on the branch it finds) and no later `## shipit withdrawn` cancels it:

```bash
git fetch origin
OWNER=$(gh repo view --json owner --jq .owner.login)
for n in $(gh pr list --state open --json number --jq '.[].number'); do
  last=$(gh pr view "$n" --json comments --jq \
    "[.comments[] | select(.author.login == \"$OWNER\") | .body | split(\"\\n\")[0] | rtrimstr(\"\\r\") | sub(\" +$\"; \"\")
      | select(startswith(\"## shipit\"))] | last // \"\"")
  [ "$last" = "## shipit" ] || continue
  gh pr view "$n" --json number,headRefName,mergeable,mergeStateStatus \
    --jq '"#\(.number) \(.headRefName) mergeable=\(.mergeable) state=\(.mergeStateStatus)"'
done
```

Act when **`mergeable` is `CONFLICTING`** or **`mergeStateStatus` is `BEHIND`** (reported because
"require branches up to date" is on). `UNKNOWN` means GitHub is still computing: wait and re-read,
never guess.

## 2. Merge `main` in, from a detached worktree

The PR branch is usually checked out in its author's worktree. **Don't touch that worktree**, and
never check the branch out a second time:

```bash
git worktree add --detach .claude/worktrees/km-<n> origin/<branch>
cd .claude/worktrees/km-<n>
git merge --no-edit origin/main     # a clean merge commits itself; a conflicted one stops here
```

**A merge, not a rebase**, so the push is a fast-forward. A rebase would need a force-push, and a
force-push leaves the author's local branch diverged. The squash merge discards the merge commit, so
`main` stays linear either way (AGENTS.md → "Git & branch workflow"). The author's next push from
their own worktree needs a `git pull --no-rebase` first ([ship-pr](../ship-pr/SKILL.md) step 1).

## 3. Resolve, or stop

Auto-resolve **only** these shapes:

| Conflict                                                              | Resolution                                                                                   |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Two entries inserted at the top of `docs/status.md` → Changelog       | Keep both, **this PR's first** (newest on top); no blank line between entries                |
| Two entries appended to a changelog list (`.claude/skills/README.md`) | Keep both, **`main`'s first** (merge order)                                                  |
| A table where each side **only added** rows                           | Keep all rows; ignore column padding (prettier re-pads). A row **both** sides edited is real |

**Anything else is a real conflict: stop and ask**, and name the files and hunks. That includes
**`package.json`**: when two scripts land on one line, one side often adds an aggregate (`verify`,
`guards:test`) that should now also run the other side's addition. On 09-30, the correct #179/#177
resolution wired #177's self-test into #179's `guards:test`, which "keep both" would have silently
missed. Code, tests, a migration, a rule stated two ways, a row both sides edited: guessing there is
how work disappears.

Then finish the merge **before** checking anything, because until the merge commit exists `HEAD` is
still the old tip, and every diff-based check shows `main`'s work as this PR's:

```bash
grep -nE '^(<<<<<<<|=======$|>>>>>>>)' <resolved files>   # must print nothing
pnpm exec prettier --write <resolved files>
git add <resolved files>
git rev-parse -q --verify MERGE_HEAD >/dev/null && git commit --no-edit
```

## 4. Prove it, then push fast-forward only

```bash
pnpm install --frozen-lockfile                # AFTER the merge: main may have changed the lockfile
pnpm verify && pnpm guides:check && pnpm status:check
bash .claude/skills/hold-the-bar/check.sh origin/main
git diff origin/main HEAD --stat              # only this PR's files; nothing of main's reverted
git fetch origin <branch> && git merge-base --is-ancestor origin/<branch> HEAD \
  && git push origin HEAD:<branch>            # never --force
```

If the ancestor check fails, or the push is rejected ("fetch first"), someone pushed meanwhile:
remove the worktree and start again from step 2.

## 5. Close the loop

- Wait for CI on the new head: `gh pr checks <n> --watch` (after the runs register).
- Comment one line: `Merged main (#<m> landed); <what conflicted> resolved by keeping both. CI green.`
- Still green and MERGEABLE, so the `shipit` stands. If a check went red, the `shipit` no longer
  holds: comment `## shipit withdrawn` with the reason, then fix it or hand it back.
- `git worktree remove .claude/worktrees/km-<n>`, run from the main checkout. No `--force`: the
  worktree is clean after the push, and the main-checkout guard denies a forced remove.

## Red flags

- A force-push to a PR branch, or checking out a branch another worktree holds.
- "Resolved" by taking one side of a real conflict.
- A `shipit` left standing on a PR that is CONFLICTING, BEHIND or red.
- A merge that shows files from `main` in `git diff origin/main HEAD --stat`, meaning something of
  main's was reverted.
