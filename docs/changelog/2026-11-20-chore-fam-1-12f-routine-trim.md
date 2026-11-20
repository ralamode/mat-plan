### Changed

- **The routine page offers only what it can still switch on** (FAM-1 12f PR 5,
  [plan](../plans/fam-1-12f-retire-old-forms.md); D28).
  - **The routine catalog** is now `strength` and Wrestling practice: the check-in keys and Wake left, and
    `lib/checkins` (the check-in field registry nothing else used) is deleted.
  - **The editor** lists Wrestling practice only. Save carries `strength`, with its day-conditional
    marker, at its place, and saves `strength` alone when nothing is listed, so it is never disabled for
    being empty.
  - **No athlete's day page changes.** Q5's read of production found three stored shapes, and none shows
    a Life item before or after. A stored check-in or Wake key is dropped when read and leaves storage
    only when that routine is next saved; no stored routine is rewritten.
  - **Old Wake entries still export** as a clock time: the `wake` activity type and the export path are
    untouched.
