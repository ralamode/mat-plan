- **2026-10-11** — **SCHED-1: the scheduling model has a file-by-file plan**
  ([plan](../plans/sched-1-scheduling-model.md)). Five independently shippable chunks on
  [ADR 0007](../decisions/0007-scheduling-model.md)'s two authorized tables — the pure day
  primitives and the weekday vocabulary move to `packages/shared`, the A/B resolver becomes a pure
  function of a named anchor and ordered list (**still calendar-indexed, deliberately**),
  `program_assignments` + its weekday rows ship dark, the seed gives the Youth Daily Program seven
  weekday rows, and dueness reaches **Today only**. That last boundary is the plan's main finding:
  `lib/dal/export.ts` re-resolves the CSV's `prescribed` column for _historical_ sessions through
  `programDayRows` with no date argument, so a dueness filter there would rewrite past exports —
  dueness sits above the query and the export is untouched by construction. **The adversarial panel
  has not run yet**; the plan carries an empty review-response log for it.
