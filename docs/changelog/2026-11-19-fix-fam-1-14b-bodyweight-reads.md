### Fixed

- **A Wake time past midnight shows as its number, not a wrapped clock** (FAM-1 14b follow-up). The
  day page and the export now share one check, `isMinuteOfDay` in `@mat-plan/shared`, so a stored
  `1440` reads `1440` on both instead of `12:00 AM` on the day page.
- **A weigh-in that names a movement leaves the export in one file.** `bodyweightEntry()` now
  requires `movement_id IS NULL`, so the strength log alone takes such a row. No writer makes one
  today; `db:verify` plants it and mutation 379 proves the check can fail.
