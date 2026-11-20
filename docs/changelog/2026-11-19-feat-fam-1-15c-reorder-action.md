- **2026-11-19** — **Program order has its server action (FAM-1 15c PR 2).** `reorderProgramsAction`
  (`app/p/[profileId]/row-actions.ts`) saves the order of an athlete's programs: the session and the
  default limiter, `programOrderSchema` (at most 50 ids, so a longer list is `invalid` before the
  writer runs), today from the active zone, then the new `reorderHouseholdPrograms`, which calls lane
  P's `reorderPrograms` inside the household scope and reports a foreign athlete id once
  (`reportAthleteMiss`). No page passes it yet, so Program order stays hidden until 15c PR 3; the
  action is a public endpoint from this merge, and its boundary matrices and foreign-id test land
  with it. `refreshAssignment` moves, unchanged, to `lib/dal/program/revalidate.ts`, so the builder
  and the day page revalidate by one rule. The registry's `household` scope is reworded: a body may
  carry an athlete id and still be household-addressed when the writer makes the one check of it.
