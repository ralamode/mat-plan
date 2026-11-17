- **2026-11-17** — **FAM-1 12b: the day page's ✓, un-tick and re-tick save for real**
  ([guide](../features/day-page.md)). Three Server Actions (`app/p/[profileId]/row-actions.ts`)
  call lane E's row writer through a new day DAL (`lib/dal/day/day.ts`). Each runs under the
  row-write rate limit (600 per 5 minutes), resolves the athlete in the caller's household, and
  reads today from the active time zone only in the action. The DAL also builds the day's
  `DayPlan` with the household's live athletes for the switcher. No page serves these yet; 12c
  mounts the screen. The helper that keeps a failed query's data out of the runtime log
  (`quietDbErrors`) moves to `lib/dal/` and now covers the row writes too. On the screen, a ✓ the
  server refuses as `bad_value` now offers Reload instead of asking for a new number (the screen
  already checked that number), and a `closed_day` reloads the page's data. No schema change, no
  new dependency.
