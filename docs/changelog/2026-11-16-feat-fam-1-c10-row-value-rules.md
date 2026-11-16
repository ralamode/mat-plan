- **2026-11-16** — **FAM-1 contract change C10: the rules for what a logged row stores are shared
  code** ([plan](../plans/fam-1-family-program.md) §4, steps 11b, 12a, 12c and 14;
  [contract](../features/program-contract.md) invariant 17). Asked for by the row writer's review
  panel, so that the writer, the Change writer and the preview's fake cannot disagree. In
  `@mat-plan/shared`: `fillRowValues` (typed numbers, else the prescription's; `null` for a bad
  value), which now also refuses a slot named twice and a value over the unit's ceiling;
  `prescriptionTarget` (how an item's prescribed numbers are built; a range has no number an empty
  ✓ can accept); `entryUnitFor` (a Check stores `bool`, Reps store `count`, every other type its
  prescribed unit); and `inWritableWindow` with `WRITABLE_DAY_RADIUS` (today and yesterday, never a
  day after today). The fake calls `fillRowValues` and judges the values before the set, as the
  real writer will, so a bad number on a logged set answers `bad_value`. The older forms' day check
  (`declared-day.ts`) reads the shared radius and is otherwise unchanged: it still accepts tomorrow
  until step 12c. Preview route only; no production behaviour, schema or stored data changes; no
  new dependency.
