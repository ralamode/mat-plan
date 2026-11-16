- **2026-11-16** — **V1-24 3b-0: a second phone can no longer log a second wrestling practice on the
  same day** ([plan](../plans/v1-24-3b-logs-in-place.md) § "3b-0: what the slice settles").
  - **The database:** migration 0025 adds `uq_entries_profile_day_practice`, one live
    `practice_minutes` row per athlete and day, so a day's minutes can no longer be summed twice. It
    takes migration 0012's shape: the table is locked, a pre-check refuses with a count and a runbook
    pointer if a duplicate already exists, then the index is built. A cleared practice frees its day.
  - **The insert:** the check-in and life insert is target-less, so a second phone's practice is
    skipped rather than raising an error, and a habit in the same submit still saves. A non-insert is
    classified in a fixed order: replay (now only for the same metric and day), `day_taken`,
    `own_hidden`, conflict. Until 3b-life the life action answers `day_taken` as saved, because the ✓
    still writes a fixed 90 minutes.
  - **Restore:** its duplicate catch is a list of index names (`DAY_SLOT_INDEXES`), which FAM-1 11b
    extends. Restore all into a day whose practice was re-entered answers `slot_taken` for that item
    and restores the rest.
  - **Proofs:** `verify/single-values.ts` § 3b-0; mutation patches 62–67, and patch 40 regenerated.
  - **The runbook** gains "If 3b-0's migration refuses".
