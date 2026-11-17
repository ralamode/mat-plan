- **2026-11-16** — **FAM-1: the workout editor asks for a unit on every Count, Weight × reps and
  Distance item before saving** ([plan](../plans/fam-1-family-program.md) §8 "Workout editor"). An item
  saved with no unit could never be logged; Save now refuses it on the unit select, whether or not a
  number is typed, and the message bar counts the fields to fix. A Duration or Time per set item
  loaded with no quantity now saves its fixed unit with no target, rather than nothing. This lands before contract change
  C16, which makes the save refuse it too. Preview route only.
