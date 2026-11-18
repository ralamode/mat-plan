- **2026-11-17** — **FAM-1 step 12a-ii: the day's read is proved after a workout is edited, renamed
  or taken off the week** ([plan](../plans/fam-1-12a-day-resolver.md) § 12a-ii,
  [FAM-1](../plans/fam-1-family-program.md) §5 step 12a-ii). `db:verify` now seeds the four
  `DayPlan` fixtures that describe "logged, then something changed" from their `before` world, logs
  their rows, makes the change with lane P's real writers (`saveWorkout`, `saveWeek`; the programs'
  reorder by a direct `idx` update, which the board allowed until 6d's writer exists), and
  deep-equals the fixture with ids mapped exactly. A calibration save first proves the seeder's rows
  and the writer's agree. New proofs pin what only a replay reaches: a closed day shows a workout's
  name as it was logged and a writable day the new one; a closed day heads an edited item with what
  its row was logged against; a removed prescription's rows stay their own item even when the
  movement is back, one per prescription, headed by its lowest set; and one movement twice in a
  workout. No resolver code changed. Mutations 255–259 and 340.
