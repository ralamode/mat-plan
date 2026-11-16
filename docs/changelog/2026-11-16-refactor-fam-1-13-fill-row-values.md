- **2026-11-16** — **FAM-1: the day page judges a row's numbers by the writer's own rule**
  ([guide](../features/day-page.md); contract change C10, #472). What an empty ✓ shows it will
  store, and whether a logged row's numbers can be changed in place, now come from the contract's
  `fillRowValues`, the rule the row and amend writers use, instead of the screen's own copy of it.
  So the screen cannot accept a number the writer would refuse, or show a different filled-in
  number than the writer stores. No visible change; no schema change, no new dependency.
