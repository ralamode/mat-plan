- **2026-11-16** — **FAM-1: a workout cannot be saved with an item that could never be logged**
  ([guide](../features/program-contract.md); contract change C16). A Count, a Weight × reps or a
  Distance item logs in the unit its prescription names, so `saveWorkoutSchema` now refuses one with
  no unit, with the issue on that item's quantities. The target may still be blank ("log in this
  unit, no target"). A Duration and a Time per set have a fixed unit and need none. An item whose
  quantity is in a unit its type does not log in (a Count in `bool`, a Duration in seconds), or
  whose target is over what its unit can log, is refused too. The workout
  editor already asks for the unit before Save (#493) and holds a target to its unit's ceiling;
  this makes the shared save check and the preview's fake refuse the same drafts. No schema change, no new dependency.
