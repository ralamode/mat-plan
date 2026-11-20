- **2026-11-19** — **Program order has its server action (FAM-1 15c PR 2).** `reorderProgramsAction`
  (`app/p/[profileId]/row-actions.ts`) saves the order of an athlete's programs: the session and the
  default limiter, `programOrderSchema` (at most 50 ids, so a longer list is `invalid` before the
  writer runs), today from the active zone, then the new `reorderHouseholdPrograms`, which calls lane
  P's `reorderPrograms` inside the household scope. A foreign athlete id is reported once
  (`reportAthleteMiss`); an `invalid` order reports the first program id that is not the
  household's (`reportOrderProgramMiss`, one read), and a stale list of its own programs reports
  nothing. No page passes the action yet, so Program order stays hidden until 15c PR 3; it is a
  public endpoint from this merge, and its boundary matrices and foreign-id test land with it.
  `refreshAssignment` moves, unchanged, to `lib/dal/program/revalidate.ts`, so the builder and the
  day page revalidate by one rule. The registry's `household` scope is reworded: a body may carry an
  athlete id and still be household-addressed when the writer makes the one check of it.
