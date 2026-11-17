- **2026-11-17** — **V1-9b B2-0: a hidden entry records whether Clear this day hid it, and the
  writers that clear a day and restore it** ([plan](../plans/v1-9b-delete-and-restore.md) § B2-0;
  migration `0030`).
  - **`entries.hide_reason`:** `'clear_day'` or NULL. One CHECK limits it to `HIDE_REASONS`; another
    refuses it on a live row, so every un-hide clears it in the same statement (`UNHIDE`).
  - **`clearDay`** hides every live entry of an athlete's day as one event with the reason; a replay
    answers that clear. **`restoreClear`** brings back exactly that clear's entries. Both work out the
    rows on the server, so neither has a cap _(maintainer, 2026-11-17)_; a Restore all retried after
    it succeeded answers `notFound`, which B1-2 shows as already restored.
  - **Every other hide writes no reason** (a blank clear, an un-tick, a swap's holder), and a partial
    Restore all drops the reason of entries left hidden, so the banner does not come back.
  - **No screen yet:** the action, dialog and banner are B2; B1-2's Restore all calls `restoreClear`.
