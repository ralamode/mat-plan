- **2026-11-13** — **The roadmap says what order the releases go in, and Beta 0 stops looking like
  the first slice of the product** ([roadmap](../roadmap.md) § The long arc, [beta-1](../milestones/beta-1.md) §
  The remaining path). The repo could already tell you the next step in each pillar, and each
  cross-pillar dependency **if you went looking for it** — `ID-1` precedes `SOCIAL-1`, `PUB-1` and
  `COACH-1`; `MOT-1`'s streak breaks on a rest day unless `SCHED-1` can say what was due. What no
  document said was the **order**. The long arc is now four **releases**, each defined by who may
  use the app: Beta 0 (one invited family), Beta 1 (3–5 families), **Pilot** (one local club) and
  Open. It names the milestones and rows that land in each, with three gates pointed at the rows
  that own them. It also fixes three words: **release** (a who-may-use-it gate), **milestone** (an
  id'd bundle inside one) and **row**. "Block" is dropped because it is already `program_blocks`.
  🔴 **Beta 0 is nearly disjoint from the feature work.** Its gate is ~10–11 PRs and two manual
  steps, mostly the `V1-9b` delete/restore arc plus ops and privacy; `UI-5`, `PICK-1` PR 4 and
  `V1-22` 4–6 are **not in it**. The Pilot has **no milestone document yet**, and its club layer
  (clubs, challenges, a club feed) has no rows; both are named as gaps rather than invented here.
  The PROG-1 re-scope (week template, no workout cap, item tracking types) is flagged as pending its
  own PR. Three rows are filed for work nothing owned: **`FUEL-1`** (meal and water logging),
  **`PROGS-1`** (the program list screen) and **`PROGS-2`** (duration and muscles worked, gated on
  `CAT-3`). A per-exercise rest timer is **not** filed: it is `TIMER-1`'s engine with a one-interval
  setting, and the row says so. Also corrected: two stale "no plan file yet" claims for `V1-22` chunk 3
  (#375); the CRUD-1 milestone's Beta 0/1 split, where `V1-24` 3b is Beta 0 because `V1-9b` B1-3 sits
  on it; and the Insight pillar owning "the CSV contract", which ADR 0009 retires.
