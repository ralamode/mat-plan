### V1-24 — a log no longer fails when the day's earlier entry is cleared at the same moment

- **A practice or weigh-in that lands as the day is cleared is saved.** Logging skips a practice or
  weigh-in when the day already holds one, then re-reads to say why. If a second phone cleared that
  holder between the two, nothing explained the skip and the person saw the error page.
  `writeCheckinEntries` and `insertBodyweightEntry` now re-run the insert once for exactly those items
  before they throw (the day is free by then); a second miss still throws.
- `db:verify` stages the race on PGlite with a statement-level `AFTER INSERT` trigger that hides the
  holder inside the skipped insert; mutations 420 and 421 remove each retry. Closes the tech-debt row
  "A day-taken insert can throw when the day is cleared in the same instant".
