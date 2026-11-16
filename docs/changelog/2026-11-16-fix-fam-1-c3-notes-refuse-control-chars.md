- **2026-11-16** — **FAM-1 contract fix: a workout's description, an item's instructions and a new
  item's name refuse a control character** ([guide](../features/program-contract.md), invariants).
  `nullableNoteSchema` and `newItemSchema` were built on `freeTextNoteSchema` and
  `movementNameSchema`, which refuse a line break (and a comma) but let a NUL through;
  `saveWorkoutSchema` accepted `notes: 'Feet\u0000flat'`. A NUL that parses reaches Postgres, which
  refuses it, so the action would have thrown instead of answering `invalid`. Found by lane B's
  review of step 8 before any real action existed. `control-chars.test.ts` now sweeps every typed
  text field of the write schemas (eleven fields; three failed before the fix). No shape changed.
