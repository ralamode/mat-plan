- **2026-11-15** — **FAM-1 step 0b, second half: every FAM-1 screen has a stub on a preview route,
  with fakes behind it, and each lane has a guide** ([plan](../plans/fam-1-family-program.md) §4, §5
  and §6). `/design/program` (behind the session, `noindex`, linked from nowhere) lists every screen
  with every named fixture of its shape, and `?screen=…&fixture=…` mounts one inside the real app
  shell; `&fail=next` makes the next write fail. The four screens (`ProgramsListScreen`,
  `ProgramScreen`, `WorkoutEditorScreen` in `components/program-builder/`, `DayScreen` in
  `components/day/`) are stubs typed to their final props, the contract's data and its actions
  object, for lanes B and C to fill in. `app/design/program/fakes.ts` holds in-memory
  `ProgramActions` and `DayActions` that follow the accepted prototype's rules over one fixture,
  each rule with a test; two of them reproduce a named fixture exactly (reordering programs gives
  `today-stretching-first`, Take off gives `family-program-after-take-off`). `MovementOptionDTO`
  gains `trackingType`, and the `picker-options` fixture is the prototype's catalog in that shape.
  A new Playwright spec walks every state on the route (axe, 44px targets, no sideways scroll at
  360px) from the route's own list, so a lane that adds a fixture edits no spec. Five guides
  ([program-contract](../features/program-contract.md),
  [program-writers](../features/program-writers.md), [day-writers](../features/day-writers.md),
  [program-builder](../features/program-builder.md), [day-page](../features/day-page.md)) own the
  lanes' directories, which now exist, and the [milestone](../milestones/fam-1-family-program.md)
  declares five lanes that `guides:check` reads: no two overlap or reach one guide. No schema
  change, no migration, no new dependency; nothing in production links to the route or imports a
  fake.
