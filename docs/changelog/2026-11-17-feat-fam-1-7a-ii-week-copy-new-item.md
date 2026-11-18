- **2026-11-17** — **FAM-1 7a-ii: the program builder can save a week, copy a workout and add a new
  item, and has its own picker list** ([plan](../plans/fam-1-family-program.md) step 7a-ii;
  [guide](../features/program-builder.md) invariant 19). Three more Server Actions (`saveWeekAction`,
  `copyWorkoutAction`, `newItemAction`) call lane P's writers through the household's scope, under
  7a-i's rules: the session and the limiter first, the contract's schema, one DAL call, a scope-miss
  report on a missed id (a week's program then each workout it names; a copy's target program then
  its source workout). A week that names a workout twice on one day is `once_per_day`, as the
  preview's fake says. The six actions are assembled as the real `ProgramActions`. The item
  picker's data lists the household's own items and, until the catalog's fresh start, every old
  built-in: one the movement library has data for shows the library's equipment and muscles with
  the database row's name and tracking type, and one it has none for shows how it is logged only.
  When "+ New item" selects an item the list did not have, the status says nothing new was made
  instead of "is in the list". The builder's links can be told not to prefetch, for the design
  preview. The privacy notice now says which things we ask about before erasing one athlete (a
  program only they were on, a workout copied out of it, a movement only they used) and who can see
  a movement name typed into a program. No page imports any of this until 7b. No schema change, no
  new dependency.
