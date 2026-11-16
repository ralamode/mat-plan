- **2026-11-16** — **FAM-1 step 13b: the day screen shows a set-by-set item as a table of its
  sets, with what was done last time, "+ Add set", supersets, and look-ahead cards**
  ([plan](../plans/fam-1-family-program.md) §5's 13b row, D7, D13, D33;
  [guide](../features/day-page.md)). On the preview route; 12c places the screen on the real page.
  Each set is a row of a table with headers (Set, Previous, a column per field, ✓): a weight × reps
  set has a load and a reps field, and an empty field logs the prescription's number (reps only when
  whole). Previous is left out on a day that cannot be written (D33). "+ Add set" adds one row at a
  time, kept until it is ticked (maintainer, 2026-11-16). Neighbouring items of one superset sit
  together under "Superset A", each with its ordinal label (A1, A2: the contract's
  `supersetLabels`) and the group's rest. A look-ahead workout says its size ("6 items"). After the
  program was edited, a logged row keeps what it was logged against ("Logged rows were against
  4 × 8 @ 25 lb."), a set beyond a reduced count still shows, and a removed item's logged rows can be
  un-ticked and ticked back. The screen now uses the contract's row helpers and spelling (C1, C2,
  #436): a logged `30 s` reads as the prescription does. Change, editing a logged number in place,
  is 13b-ii. Also: 13d's program line, Program order, athlete switcher and notices, now on the preview (#441), get their 360px side-by-side with v12. No schema change, no new dependency, no change to production behaviour.
