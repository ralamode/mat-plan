### Added

- **A ✓ after an un-tick brings the same row back** (FAM-1 11c-ii, the D35 revive;
  [plan](../plans/fam-1-11c-change-and-revive.md)).
  - **The revive:** a ✓ under a new `clientId` on a set on which the athlete's own entries are all hidden (another athlete's entry on the set is ignored) revives the most recently hidden one, instead of inserting a second entry beside it. It
    carries this ✓'s numbers (filled from the prescription for an empty ✓), the current
    prescription's text, unit and superset group, and this `clientId`.
  - **After a Clear this day,** the revive clears `hide_reason` too, so the row leaves the "Day
    cleared · n hidden" count.
  - **Its scope:** another athlete's hidden entry is never revived. A refused ✓ leaves the hidden
    entry untouched. The revive's UPDATE runs in a savepoint, so a row another live entry now holds
    answers `slot_taken`.
  - **Three 11b proofs rewritten:** a replay of the replaced `clientId` is `slot_taken`; re-ticking a
    revived entry answers it as it is now; the ✓ that races an un-tick brings the un-ticked entry
    back. `db:verify` proves each rule (nine proofs; one was dropped in review because it could not fail), and mutations 341–347 and 357 prove the proofs can fail.
