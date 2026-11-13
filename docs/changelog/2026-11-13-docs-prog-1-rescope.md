- **2026-11-13** — **PROG-1 is re-scoped around a real program: no workout cap, a week template, and
  items with a tracking type** ([decisions](../specs/crud-1-fix-it-yourself.md#prog-1-re-scope-2026-11-13)).
  The maintainer's household runs six different days a week, two to four workouts a day in a fixed
  order, about ten workouts with several reused across days, and items that are only ever checked
  off. PROG-1 as specified allowed at most three workouts rotating on chosen days, so it could not hold
  the program the household would start using. Eleven decisions (R1–R11) now lead the CRUD-1 spec: any
  number of named, reusable workouts; a **week template** owned by the program (0, 1 or many ordered
  workouts per weekday, with an optional slot label) beside rotation; the resolver returns an ordered
  list; a closed menu of seven **tracking types** (Check, Duration, Count, Reps, Weight × reps, Time per
  set, Distance), every item checkable; "write it" numbers as Count items; author instructions plus an
  opt-in athlete note; supersets defined in the program; a builder that edits in place and a log form
  that reuses its cards. Both a push/pull/legs week and the complex week are written down as acceptance
  shapes. **No plan is rewritten here.** ADR 0007 gains Amendment 1, to be signed with it (its decision
  1, "nothing in the backlog needs" workout-level scheduling, is superseded; decision 3's `workouts` arc
  is re-priced under ADR 0009). SCHED-1, ASSIGN-1, V1-22 A4, V1-22 chunk 3, TGT-1, PICK-1 and the
  PROG-1 milestone each carry a banner naming what their revision owes. Two rows are filed: **`ITEM-1`**
  (tracking types; movements and activities converge) and **`SUPERSET-1`** (program-level supersets).
