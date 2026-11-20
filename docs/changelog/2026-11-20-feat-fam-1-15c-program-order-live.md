- **2026-11-20** — **FAM-1 15c PR 3: an athlete on two or more programs can set their order from
  the day page, and each program's name there links to its page.** The day page passes
  `reorderProgramsAction` in its `dayActions`, so the Program order button appears when two or more
  programs stay past today, and `ProgramLine` gets `programHrefFor`, so each name on the programs
  line opens `/programs/<id>`. A new e2e journey in `e2e/day-page.spec.ts`, at 360px, builds two
  programs and a new athlete of its own, puts the athlete on both, moves the first program down,
  and checks the announcement, the programs line, the links and the workouts' order, before and
  after a reload. The builder's e2e steps it shares (open Programs, create a program, copy a
  workout onto every weekday, Put on from today) move into `e2e/steps.ts`, unchanged, except that the a11y spec's `reachProgram` now also checks the Programs heading, which `openPrograms` always did. The privacy
  notice now says anyone signed in can change the order an athlete's programs show in. The two
  `owed.test.ts` lines for 15c are deleted.
