- **2026-11-15** — **FAM-1 step 0a: the shared contract the program builder and the day page are
  built against** ([FAM-1 plan](../plans/fam-1-family-program.md) §4, §5). `@mat-plan/shared` now
  holds: `TRACKING_TYPES` with its type, schema, named members and labels (`movements.ts`);
  `PROGRAM_NAME_MAX`, `WORKOUT_NAME_MAX`, `SLOT_LABEL_MAX`, `MAX_WORKOUT_ITEMS` and
  `SLOT_LABEL_SUGGESTIONS` (`programming.ts`); and a new `program/` directory with a zod schema and
  type for every shape in the plan's §4 (`WorkoutDraft`, `WeekDraft`, `ProgramList`, `ProgramView`,
  the dialog drafts, `DayPlan`, the row writes and `RowResult`), the `ProgramActions` and
  `DayActions` interfaces, and `prescribedText`, one renderer for all seven tracking types in the
  prototype's format (`4 × 8 @ 25 lb`). The seventeen named fixtures are the accepted prototype's
  data, transcribed once and built by the prototype's own rules; they are the
  `@mat-plan/shared/program/fixtures` subpath, so preview data stays out of client bundles. Each
  fixture parses by its own schema in the suite, and `program/owed.test.ts` lists, by step, the tests
  each consumer still owes. Scaffolding only: no column, no migration, no screen and no behaviour
  change. The CHECK that pins the tracking types arrives with step 3.
