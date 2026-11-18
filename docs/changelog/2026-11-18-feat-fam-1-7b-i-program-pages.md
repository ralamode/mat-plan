- **2026-11-18** — **FAM-1 7b-i: a parent opens Programs from Home, and the list and program pages
  are real** ([plan](../plans/fam-1-7b-builder-pages.md)). `/programs` and `/programs/[programId]`
  are session-gated pages on the household's own data (`getProgramList`, `getProgramView` in
  `lib/dal/program/reads.ts`), with static titles ("Programs", "Program"), `not-found.tsx`,
  `loading.tsx`, and no household sent Home. Home's Household nav lists Programs, then Settings; the
  desktop rail gains a Programs row (a board-granted guest edit of `nav-rail.tsx`). Every builder
  action is now reachable. The program page stops at its caps before the work: "+ New workout" at 50,
  a day's "+ Add" at 30, and a full day is inactive in the add form and in Copy; a `limit_reached`
  is said in the screen's words. "Who's on it" says Put on isn't in the app yet (step 15).
  `TimeZoneSync` moves to `components/layout/`. The stay-dark pin lifts, replaced by "only a program
  page imports the actions" and the privacy list it owed: the notice drops "coming" for programs,
  recounts the text boxes, names the builder's ids and what a save hides, says who sees who is on a
  program, and says how to have a program, workout or typed item removed (H7 (a)).
