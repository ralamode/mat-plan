- **2026-11-18** — **A failed read of a workout no longer puts its query's parameters in the
  runtime log.** The workout editor's read (`getWorkoutDraft`) now goes through `quietDbErrors`, as
  every program write already did; plan row 7a-i promised it and the read was missed. A test fails
  without it. No page serves the read yet (FAM-1 7b).
