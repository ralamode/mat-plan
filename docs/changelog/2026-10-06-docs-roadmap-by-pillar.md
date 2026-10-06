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
