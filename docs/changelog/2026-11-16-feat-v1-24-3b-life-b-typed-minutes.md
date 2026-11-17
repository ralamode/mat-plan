- **2026-11-16** — **V1-24 3b-life-b: wrestling practice is logged by typing the minutes, and Wake
  can no longer be logged** ([plan](../plans/v1-24-3b-logs-in-place.md) § "3b-life: what the slice
  settles", B1–B7).
  - **The row:** `Wrestling practice` (a real label, so tapping the words focuses the field), an empty
    minutes field, `min`, and the ✓, on one line at 360px. No prefill and no "Last time": practices
    differ in length. The one-tap 90 is gone.
  - **The minutes:** whole minutes from 10 to 300, checked in the browser before any request with
    the action's own rule (`practiceMinutesProblem`): empty; a number that reads as hours (a whole 1–9,
    or a decimal or `1:30` under 10) gets `Minutes, not hours: 2 hours is 120.` (worked out for 1–5);
    the rest `Enter whole minutes, 10 to 300.` The server repeats
    it (`logPracticeSchema`); a tab still on the one-tap page is told to reload.
  - **The ready ✓, on both rows:** the ✓ is outline while its field is empty and filled while a value
    waits to be sent (`LogTick`), so a filled-but-unsent row no longer looks like an empty one.
  - **Refusals, never "saved":** a practice already logged for the day says the typed minutes weren't
    saved, and to use Change to make it that number or enter the total for a second practice; that
    alert stays while Change is open. A reused id and a cleared row each say so. The form mints a new id on
    any refusal, so trying again works.
  - **Wake:** refused by the action (`logPracticeSchema`'s `activityKey`); it stays in the routine catalog,
    which FAM-1 12f owns.
  - **Privacy:** the notice's "What gets logged" now lists wrestling practice minutes, and the
    inventory's `value_num` row names them (both were missing since PRIV-1).
