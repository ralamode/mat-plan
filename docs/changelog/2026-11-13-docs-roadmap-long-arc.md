- **2026-11-13** — **The roadmap says what order the next two years go in, and Beta 0 stops looking
  like the end of it** ([roadmap](../roadmap.md) § The long arc, [beta-1](../milestones/beta-1.md) §
  The remaining path). The repo could already tell you the next step in each pillar, and could tell
  you each cross-pillar dependency **if you went looking for it** — `ID-1` precedes `SOCIAL-1`,
  `PUB-1` and `COACH-1`; `MOT-1`'s streak breaks on a rest day unless `SCHED-1` can say what was
  due. What no document said was the **order**, which is how a hinge gets skipped and the feed turns
  out unbuildable. The long arc is four blocks of ids — logging, streaks, identity, other people —
  with the two gates pointed at the rows that own them, not restated here (`roadmap.md` is a pointer
  document). 🔴 **The correction that matters most: Beta 0 is not at the end of that arc, it sits
  inside the first block and is nearly disjoint from it.** Its gate is ~10–11 PRs and two manual
  steps, of which five or six are the `V1-9b` delete/restore arc and four are ops and privacy;
  `UI-5`, `PICK-1` PR 4 and `V1-22` 4–6 are **not in it at all**. That sequence had been sitting
  un-merged on a local branch, which is a poor place for the answer to "when is beta". Three rows
  are filed for work the arc depends on and nothing owned: **`FUEL-1`** (meal and water logging —
  easy on a schema already built for typed quantities, hard because food data about a minor is a new
  category to hold, next to weight-cutting), **`PROGS-1`** (the list screen `CLONE-1` and `RETIRE-1`
  both assume) and **`PROGS-2`** (a program's duration and muscles-worked, gated on `CAT-3`). A
  fourth candidate was **not** filed: a per-exercise rest timer is `TIMER-1`'s own engine with a
  one-interval setting, and its row now says so, so nobody files it twice. Two stale claims that
  `V1-22` chunk 3 has "no plan file yet" are corrected — it merged as #375.
