- **2026-09-30** — **DX-2: changelog fragments** ([plan](../plans/dx-2-changelog-fragments.md)). A
  changelog entry is now its own file in `docs/changelog/`, so PRs stop re-conflicting each other at
  the top of `docs/status.md`. `pnpm status:check` requires the fragment on product branches once
  `docs/changelog/README.md` exists in the working tree, so a pre-DX-2 branch that merges `main` fails
  until `keep-mergeable` moves its entry into a fragment. The old history stays in status.md and is
  frozen: the guard fails any branch, of any type, that adds to it (or to the skills README's
  changelog), and `STATUS_SKIP` doesn't bypass that. The hand-maintained "Shipped" table in
  `.claude/skills/README.md`, the other recurring conflict, is gone: each skill's description is the
  index.
