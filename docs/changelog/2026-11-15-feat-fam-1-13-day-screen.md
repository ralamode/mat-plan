- **2026-11-15** — **FAM-1 step 13: the day screen shows a day's workouts, and a Check, Duration or
  Count can be ticked, un-ticked and ticked back** ([plan](../plans/fam-1-family-program.md) §5's
  step 13 row, D13, D20, D24, D33; [guide](../features/day-page.md)). On the preview route only
  (`/design/program?screen=day`); the day page mounts the screen at 12c. Each workout is a section with
  its slot line, its progress ("2 of 10", "Done ✓", and nothing for a workout with no rows to count)
  and its items. A single row shows what was done last time, a field whose placeholder is the
  prescription (an empty ✓ logs it), and a 44px ✓. The ✓ is optimistic; a failed save, or a dropped
  connection, un-ticks the row, keeps what was typed and says "Couldn't save. Try again."; the retry
  reuses its `clientId` unless the number changed. Un-tick keeps the old number in the field, and ✓
  with it unchanged restores the same entry. A non-number, a negative or a number past the unit's
  ceiling is refused by the field, which takes focus. A refusal that means the page is out of date
  offers Reload; the first `closed_day` turns the screen read-only. A row's state is keyed by athlete
  and day, so nothing carries into another day. A closed day and a workout that left the week show
  what was logged as text, with no ✓ and no "Last time". Items logged set by set show their heading
  only, until 13b. Three differences from the v12 prototype, decided with the maintainer: a logged row
  is neutral rather than green (no colour token yet), "N not saved" beside a workout's progress, and
  the Reload button. No schema change, no new dependency, no change to production behaviour.
