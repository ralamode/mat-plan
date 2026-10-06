- **2026-10-06** — **The forward-looking view of the whole program has a file now, and pillars that
  mean something mechanical.** There were four overlapping tracking docs and none of them answered
  "what is the state of the whole thing right now" — `plan.md` is the backlog by vintage,
  `status.md` looks backwards, `milestones/` sequences one milestone. So the cross-program view lived
  only in whatever session happened to be running, and did not survive a session boundary.
  [`docs/roadmap.md`](../roadmap.md) is that view: seven pillars, what's in flight, what's next per
  pillar, and what each thing waits on. It is a **pointer** document — ids only, never a second copy of
  a `plan.md` row, because the second copy is the one that goes stale. The pillars are grouped over the
  **20 id prefixes already in use** rather than a new taxonomy, since renaming ~80 rows would cost real
  time and buy nothing. Two departures from the obvious cut, both argued in the file: there is no
  "Tech Leads" pillar (coordination is a role, and a pillar owning no files cannot be assigned or
  checked — it is **Product & Spec**, which owns `docs/decisions/`, `docs/specs/` and
  `docs/milestones/`), and measurement sits with logging rather than with dashboarding, because capture
  and read share no files. The load-bearing idea: **a pillar is a set of owned file globs, not a
  theme**, because the question a session actually needs answered is "can this run in parallel", and
  that is a file question — the Authoring milestone's chunk 2 and `v1-30b` both touch
  `strength-form.tsx`, and any theme grouping would have called them independent.
- **2026-10-06** — **A rubric for when two tracks may run at once, and the first thing it caught was
  this milestone.** [`docs/parallel-work.md`](../parallel-work.md) is the per-**track** sibling of the
  per-PR definition of done: six gates, each earned by a failure that actually happened here. The one
  that matters is **gate 1, disjoint file globs with the feature guides included** — because a shared
  roadmap, an agreed data contract, landed infra and an approved prototype are all **green** for
  Authoring chunk 2 and `v1-30b`, and both edit `strength-form.tsx` under one owning guide.
  `pnpm guides:check` makes that worse in a non-obvious way: two tracks editing _different_ code under
  _one_ guide still collide, on the guide. The other five sharpen the obvious gates into checkable
  ones — a contract must be **sufficient** (the Authoring panel found `ProgramEditDTO` unbuildable
  despite existing), blocking work must be **observed landed** rather than merged (`migrate.yml:52-54`
  `exit 0`s when the secret is absent, so a green migrate job can mean nothing applied), the closed
  questions must be written down (ADR 0005's item 0 drifted to three different ranges across three
  documents), the prototype's **omissions** must be enumerated and decided, and shared append-only
  files must be sharded (which is why `docs/changelog/` is one file per change). Applied immediately:
  **`v1-30b` now goes before Authoring chunk 2**, recorded in the roadmap with its reason, while
  chunk 1 stays parallel because it is backend-only.
