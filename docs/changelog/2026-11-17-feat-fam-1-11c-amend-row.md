- **2026-11-17** — **FAM-1 step 11c planned: Change a logged row, and a ✓ that brings an un-ticked
  row back** ([plan](../plans/fam-1-11c-change-and-revive.md), [FAM-1](../plans/fam-1-family-program.md)
  §5 step 11c). The plan only: two writers, approved by the maintainer after a six-lens review. 11c-i
  adds `amendRow`, which corrects a logged row's numbers in place on today or yesterday, checked
  against the unit the row was logged in. 11c-ii makes a ✓ on a set whose entry was un-ticked, or
  hidden by Clear day, bring that entry back with the new numbers instead of adding a second one
  (D35). The pre-existing gap in the strength fix-a-set path, which can change a program row outside
  the today-and-yesterday window, is filed in `docs/tech-debt.md`.
