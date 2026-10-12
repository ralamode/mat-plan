- **2026-10-11** — **SCHED-1: the scheduling model has a file-by-file plan**
  ([plan](../plans/sched-1-scheduling-model.md)). Five independently shippable chunks on
  [ADR 0007](../decisions/0007-scheduling-model.md)'s two authorized tables — the pure day
  primitives and the weekday vocabulary move to `packages/shared`, the A/B resolver becomes a pure
  function of a named anchor and ordered list (**still calendar-indexed, deliberately**),
  `program_assignments` + its weekday rows ship dark, the seed gives the Youth Daily Program seven
  weekday rows, and dueness reaches **Today only**. That last boundary is the plan's main finding:
  `lib/dal/export.ts` re-resolves the CSV's `prescribed` column for _historical_ sessions through
  `programDayRows` with no date argument, so a dueness filter there would rewrite past exports —
  dueness sits above the query and the export is untouched by construction. **The six-lens panel has now run** — ~20 blocking findings, with
  **four reached by two or more lenses independently**: the weekday-origin hazard is stated backwards
  here _and_ in ADR 0007 (measured — ISO agrees on Mon–Sat and `7` trips the CHECK, so the silent
  convention is `0=Mon`, and the origin proof was tautological); 1e's read scoped the profile but not
  the **block**, which `programDayRows` reaches through a hand-written conjunct; the dueness gate was
  **block-agnostic** while the card's content comes from a `newest-block-that-programs-this-day`
  selector, so the two could disagree; and 1e is not "Today only" — `page.tsx` renders the **viewed**
  day, so dueness would have silently blanked historical day views while the CSV kept its `prescribed`
  column for the same date. Also corrected: a `z.infer`-derived seed row that would not have compiled,
  a range CHECK with no proof, a targetless `ON CONFLICT` that is the trap `lessons.md` recorded one
  day earlier, no `architecture.md` edit against ADR 0007's explicit instruction, and the plan's own
  claim that every cite was measured (`migrate.yml:56-57` is `actions/setup-node`; `db:seed` runs at
  `:78-79`). 🔴 **The panel's scheduling finding:** SCHED-1 is **Beta 1 behind a gate that has not been
  reached**, with no Beta 0 consumer — so the plan lands and the chunks wait, and the roadmap cell that
  read "Gated on: Nothing" is corrected here.
