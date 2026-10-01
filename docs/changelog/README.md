# Changelog fragments

One file per change, so no two PRs ever edit the same line. Before DX-2 every PR inserted its entry
at the top of `docs/status.md` → Changelog, and each merge re-conflicted every other open PR
([plan](../plans/dx-2-changelog-fragments.md)). That history stays where it is, unrewritten.

## The rule

A product branch (`feat|fix|db|perf|refactor|revert`) **adds** one file here, in the same PR as the
change. Docs and chore PRs usually write one too. `pnpm status:check` enforces it for product
branches (`STATUS_SKIP="<why>"` overrides, visibly).

**Name:** `<YYYY-MM-DD>-<branch>.md`, where `<branch>` is the full branch name with `/` → `-`, and the
date is the day you wrote it (for an entry moved out of the old history, keep its own date):

```
feat/v1-24-1a-bodyweight-receipt  →  docs/changelog/2026-10-02-feat-v1-24-1a-bodyweight-receipt.md
```

Directly in this folder, not nested. The guard checks the name literally.

**The old histories are frozen.** Adding an **entry** (a `- ` line) to `docs/status.md` → Changelog or
to `.claude/skills/README.md` → Changelog fails `status:check` on **every** branch type, and
`STATUS_SKIP` doesn't bypass it: an entry that exists can always move here instead. Fixing an
existing entry (a typo, a stale path `skills:check` flags) is fine, and so is re-wrapping one;
renaming either heading fails.

**What stays in `docs/status.md`:** the **Where we are** pointer and the backlog rows. Update them in
the same PR when the change moves them. The guard doesn't check those; review does.

## The entry

The same entry that used to go into status.md, as a single bullet:

```markdown
- **YYYY-MM-DD** — **<ID>: <what is now true>** ([plan](../plans/<file>.md)). <Why it matters.>
```

Write it from the diff, not from memory: #156 is what happened when the record was rebuilt from
recall. **Links are one level deeper than status.md was**, so use `../plans/…`, `../features/…`,
`../lessons.md`, and `../../.claude/…` or `../../apps/…` for the repo root.

## Reading it

Newest first, by merge date, with the PR number from the squash subject:

```bash
git log --diff-filter=A --format='%cs %s' -- docs/changelog/ | head -20
```

Run it on an up-to-date `main`. On a feature branch it lists that branch's own commits, and a shallow
clone shows only one entry. `ls` sorts by the filename date, which is when the entry was **written**,
not when it merged.
