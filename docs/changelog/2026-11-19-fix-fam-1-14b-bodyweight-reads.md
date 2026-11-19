### Fixed

- **A clock reading past midnight is written as its number, never a wrapped time** (FAM-1 14b
  follow-up). The app's clock formatter (`minutesToClock`) and the export's `HH:MM` now share one range
  check, `isMinuteOfDay` in `@mat-plan/shared`, so a stored `1440` is `1440` in both rather than
  `12:00 AM` in the formatter. The day page does not render a Wake time today, so nobody sees the
  difference; it keeps the two from disagreeing.
- **A weigh-in that names a movement leaves the export in one file.** `bodyweightEntry()` now
  requires `movement_id IS NULL`, so the strength log alone takes such a row. The strength log writes
  set values, so such a row's own `value_num` is not exported; accepted because no writer makes one
  today. `db:verify` plants it and mutation 379 proves the check can fail.
