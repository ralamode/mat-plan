- **2026-11-16** — **FAM-1: a workout cannot be saved with an item that could never be logged**
  ([guide](../features/program-contract.md); contract change C16). A Count, a Weight × reps or a
  Distance item logs in the unit its prescription names, so `saveWorkoutSchema` now refuses one with
  no unit, with the issue on that item's quantities. The target may still be blank ("log in this
  unit, no target"). A Duration and a Time per set have a fixed unit and are unaffected. The workout
  editor already asks for the unit before Save (#493); this makes the shared save check, the
  preview's fake and the writer refuse the same draft. No schema change, no new dependency.
