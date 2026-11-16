- **2026-11-16** — **V1-24 3b-bw: the day page's bodyweight row logs with a ✓, and a blank Save
  clears it** ([plan](../plans/v1-24-3b-logs-in-place.md) § "3b-bw: what the slice settles").
  - **The unlogged row:** an empty text field with a decimal keypad, the unit select (starting on
    the last weigh-in's unit) and an outline ✓, on one row at 360px. A muted `Last time 72.5 lb` line
    above it names the athlete's latest earlier weigh-in, with its weekday or date when it was not the
    day before. An empty ✓ is refused in the browser, with focus on the field. `84,5` reads as 84.5;
    anything that is not plain digits, or has more than three decimal places, gets the bound's own message.
  - **The logged row:** `✓ 84.5 lb` in the done colours, read as "Logged 84.5 lb", and Change.
    `Saved:` and `One weigh-in per day.` are gone.
  - **Change:** opens with the value selected; Cancel, then Save. While the field is empty, Save reads
    **Clear**, and a line under the field always says how to remove a weigh-in. A clear hides the row
    through `hideEntries`, which makes it the first removal the app does not offer to undo (ADR 0008 Amendment 1), and a cleared weigh-in is not in the export;
    the privacy notice and the data inventory say so. An archived athlete can still change a weight
    but not clear it.
  - **Announcements and focus:** a new `single-value-live.tsx` island announces a log, a change and a
    clear from the action's own result, shows a clear (`Bodyweight cleared. It was 84.5 lb.`) and any
    refusal whose form has gone, and hands focus to Change or the field.
  - **The server:** `editBodyweightAction` now bounds a change or a clear by **the row's own day**, so
    a POST cannot change a weigh-in outside today and yesterday by naming another day (the same ±1 of
    the active time zone every write uses). New `clearBodyweight` and
    `bodyweightRowForAmend` (`packages/db/src/writers/single-value.ts`) and `lastBodyweightBefore`
    (`packages/db/src/queries/last-bodyweight.ts`), proved in `verify/single-values.ts`, with four
    mutation patches (46–49).
