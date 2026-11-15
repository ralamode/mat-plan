- **2026-11-15** — **SCHED-1 1a (FAM-1 step 2): the pure day helpers and the weekday vocabulary now
  live in `@mat-plan/shared`** ([SCHED-1 plan](../plans/sched-1-scheduling-model.md),
  [FAM-1 plan](../plans/fam-1-family-program.md) §5). `isoDayDiff`, `addDays` and `localWeekday` moved
  from `apps/web/lib/date.ts` to `packages/shared/src/day.ts`, and `WEEKDAYS`, `Weekday` and
  `weekdaySchema` sit beside them, in `localWeekday`'s origin (0 = Sunday). A package cannot import
  from the app, so the scheduling tables and FAM-1's contract shapes had no way to name a weekday or
  step a calendar date. No behaviour change and no database change: the five importers switched to
  the package, `localWeekStartIso` calls `localWeekday` instead of repeating `getUTCDay()`, and the
  timezone-bound helpers (`localDayIso`, the formatters) stay in the app. `floorMod` and the named
  `WEEKDAY` map are not in this PR (the plan's review log moved the first to 1b; the second waits for
  its first consumer).
