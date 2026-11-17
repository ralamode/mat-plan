- **2026-11-16** — **FAM-1: the workout editor never shows a saved number in a unit its item can't
  hold** ([plan](../plans/fam-1-family-program.md) §8 "Workout editor"). A Duration stored in seconds
  loaded as that many minutes and saved 60× the time; a Count stored in another unit made Save fail
  with nothing to fix. The editor now reads each item's quantity from its own slot, keeps it only in a
  unit the item can hold, and otherwise leaves the number empty with a note saying what it was. It
  never converts a number itself. Preview route only; no saved programs exist yet.
