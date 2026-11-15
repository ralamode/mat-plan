# FAM-1 d3, round 1: the Beta 0 prototype v10 (2026-11-15)

Every name is a fixture. **Signed by the maintainer on 2026-11-15**: v10 is the accepted Beta 0
prototype.

**Goal of d3** (FAM-1 milestone): the builder and log-row prototype, plus its UX panel, before the
d2 spec. v9 already had the builder (program page, workout editor, picker, week, copy, order). This
round applies the 2026-11-15 decisions and the fixes the prototype owed, and writes each screen's
design contract (DX-14).

## What changed from v9

| #   | Change                                                                                                                                                                                                                                                     | Source                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1   | **One day page for every day.** The old layout (Check-ins form, Strength form, Log buttons, own-name sections) is gone, from the code too. An athlete with no program gets the same page: Bodyweight, Life, and a "Not on a program yet → Programs" notice | decision 0                                     |
| 2   | **Past entries are read-only rows** under "Logged". Repeated work shows as set rows (Push-ups: 1 · 20 reps, 2 · 30 reps), never "So far: 50". Each row keeps Delete, with the tomb in place                                                                | decisions 1, 2; V1-9b B1-3                     |
| 3   | **Bodyweight is entered once, then only changed.** No Delete, no Undo, so no stacked "deleted · Undo" rows. The entry is a ✓ row like every other, with "Last time 112.8 lb"                                                                               | decision 3                                     |
| 4   | **Wrestling practice is an empty minutes field** with a ✓. Empty ✓ refuses plainly ("Enter the minutes, then ✓.")                                                                                                                                          | decision 4                                     |
| 5   | **No Log button anywhere.** Bodyweight and Life use the same ✓ as workout rows                                                                                                                                                                             | decision 0                                     |
| 6   | **Clear this day names what it hides**: "Morning habits, Heavy A and Evening stretch (17 rows), bodyweight and wrestling practice". Workout rows are cleared and restored with the rest                                                                    | sweep: "clearing a day including workout rows" |
| 7   | **A workout runs at most once a day**: the week's Add hides workouts already on that day, and says so when none are left                                                                                                                                   | ADR 0007 Amendment 2 (signed)                  |
| 8   | **Name limits**: workout 30 characters (with a counter), program 60. An empty workout name refuses Save                                                                                                                                                    | ADR 0007 Amendment 2                           |
| 9   | Un-ticking a workout row leaves no tomb (already true in v9; now tested)                                                                                                                                                                                   | sweep                                          |

Round 1 was checked with a jsdom script (22 real checks; one was vacuous) and screenshots at phone width.

## Design contracts (DX-14)

Each new screen: its job, its primary action, the states it handles, its 360px rules, and the
patterns it rejects.

### The day page (FAM-1 12, 13, 13b; V1-24 3b; V1-9b B1-3, B2)

- **Job:** log today in place, and see what any day holds.
- **Primary action:** ✓ on a row. A ticked row is logged; un-ticking removes it.
- **States:** today on one or several programs; a rest day; a closed past day (change a number,
  un-tick, delete a past entry); a future day (read-only preview); **no program** (Bodyweight and
  Life only, plus a link to Programs); a day before the program (past entries); a cleared day
  (banner + Restore all); a refusal (empty ✓ → a plain sentence, nothing written).
  **Not shown yet:** loading, a failed save, offline.
- **360px:** one column; set rows fit four columns (set, previous, value(s), ✓) with 44px ✓
  targets; names wrap, never truncate.
- **Rejects:** Log buttons; a separate form per kind; folded totals of sets; a "Hidden on this day"
  bar; delete for bodyweight.

### The program page (FAM-1 6–10, 15)

- **Job:** say who's on this program and what they do each weekday.
- **Primary action:** edit a workout; second, put someone on it.
- **States:** no one on it ("Changes affect no one"); new program (rename open); no workouts; a
  rest day; a weekday with every workout already on it; a copied workout ("Copied from …").
- **360px:** week rows stack label · workout with ↑ ↓ ✕ at the end; the Add row's label and select
  share one line.
- **Rejects:** a hidden "current athlete"; drag as the only way to reorder; the same workout twice
  on a day.

### The workout editor (FAM-1 8, 8b, 9)

- **Job:** build one workout: items, what each prescribes, instructions, supersets.
- **Primary action:** Save workout (one Save; Cancel discards).
- **States:** new and empty; editing; a superset of 2 or more with "Rest after each round"; an item
  whose type is locked by logs; an empty name refused.
- **360px:** cards full width; prescribed fields in one row of small inputs; ↑ ↓, Superset with
  next, Remove in one tool row.
- **Rejects:** a modal per item; autosave on every keystroke to the server; free-text prescriptions.

### The picker (FAM-1 9)

- **Job:** add several items at once, or create a new one with its type.
- **Primary action:** "Add n items".
- **States:** nothing selected (button says "Pick items to add"); search with no match (**not
  shown**); new item open.
- **360px:** full screen, sticky footer button.
- **Rejects:** one-at-a-time adding; changing an item's type after it has logs.

### The dialogs: Put someone on, Copy to, Order, Clear this day

- Each opens with focus on its first control, keeps Tab inside, closes on Escape and Cancel, returns
  focus to what opened it, and states its effect in one sentence before the button. Clear needs
  "delete" typed; its button is a danger button. (True from round 2; round 1 claimed it falsely.)

## Round 2: the UX panel (2026-11-15)

Three lenses (phone usability, accessibility, fidelity to the decisions and ADR 0007) found **5
blocking**, about 20 should-fix and a dozen nits. Fixed in the prototype the same day; the jsdom
script now runs **38 checks, all passing**.

| Found                                                                                                                                                                                                                                                            | Lens                       | Fix in v10                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Logged days weren't frozen.** Rows were keyed by a workout's position in the week, and past days drew the program as it is now: reordering Friday turned yesterday's "Done ✓" into "0 of 10"; removing an item or renaming rewrote yesterday. Present since v6 | fidelity (blocking)        | A logged row is keyed by program + workout (the ADR's arbiter). The first ✓ of a workout on a day freezes it; that day draws from the frozen copy, and a workout removed from the week still shows on days it was logged |
| Typed numbers in un-ticked rows were wiped by ticking another set                                                                                                                                                                                                | usability (blocking)       | Unsaved typing is kept per field until logged                                                                                                                                                                            |
| On a closed day, un-ticking a row deleted it for good (it vanished, so it couldn't be re-ticked)                                                                                                                                                                 | usability, fidelity        | The un-ticked row stays in place and re-ticks                                                                                                                                                                            |
| Feedback was invisible: refusals in a banner at the top, confirmations only for screen readers                                                                                                                                                                   | usability, a11y (blocking) | Refusals show under their field with `aria-invalid`, and focus moves to it; a toast shows every confirmation; Clear scrolls to Restore all                                                                               |
| Focus fell to the page after every action; dialogs didn't hold or return focus                                                                                                                                                                                   | a11y (blocking)            | Focus stays on the control, or goes where the action names (Delete → Undo → Delete; Change → input → Change); dialogs focus their first control, trap Tab, and return focus                                              |
| Clear → log → Restore all stacked "Bodyweight deleted · Undo"                                                                                                                                                                                                    | fidelity                   | A hidden bodyweight never shows a tomb                                                                                                                                                                                   |
| Numbers unchecked ("abc", 1134 lb, 600 min)                                                                                                                                                                                                                      | usability, fidelity        | Numbers only; bodyweight 40–400 lb; minutes 1–300; an amend to text or empty keeps the old value                                                                                                                         |
| Practice minutes could only be deleted, not corrected                                                                                                                                                                                                            | usability                  | Change, like bodyweight (Delete stays, per B1-3)                                                                                                                                                                         |
| Targets under 44px; the unticked ✓ border failed 3:1                                                                                                                                                                                                             | a11y, usability            | ✓ is 44×44 with a visible border; text buttons are 44px tall                                                                                                                                                             |
| Copy into the same program could pass 30 characters and recorded a workout name as provenance                                                                                                                                                                    | fidelity                   | Name cut to fit " (copy)"; provenance is always the program's name                                                                                                                                                       |
| New program and workout names prefilled; focus on the heading                                                                                                                                                                                                    | usability                  | Empty with a placeholder; the cursor is in the name                                                                                                                                                                      |
| Adding one workout to five days took five rounds                                                                                                                                                                                                                 | usability                  | The week's Add picks several days; days that already have it are skipped and named                                                                                                                                       |
| Start with no one ticked closed silently                                                                                                                                                                                                                         | usability                  | Start is off until someone is picked                                                                                                                                                                                     |
| Practice sat ~4,600px down                                                                                                                                                                                                                                       | usability                  | **Life moved under Bodyweight**, above the workouts (a layout change for the maintainer to see)                                                                                                                          |
| Smaller: "Program order"; scoped Delete labels ("Delete all 3 sets", "Delete Push-ups set 2 (30 reps)"); week ↑ ↓ name their workout and day; chevrons hidden from screen readers; "Previous" wraps; a viewport meta; dead `renderOwn` removed                   | all                        | done                                                                                                                                                                                                                     |

**Rules for d2 (the real app, not the prototype):** render with keyed components, never by
replacing the page; counters sit outside the label, linked by `aria-describedby`, announced near
the limit; Clear's button uses `aria-disabled`, not `disabled`; past set rows are a list or a table
with headers; the day label and week days are headings; one persistent live region.

**Questions d2 must answer** (the prototype doesn't decide them): how custom labels order against
Morning / After school / Evening; take someone off and put them back on (ASSIGN's shifted band);
what happens to "rest after each round" when a superset is split or shrinks to one item; whether
Change updates bodyweight's recorded time; an empty ✓ on a workout row logs the prescription while
an empty Bodyweight or Practice ✓ refuses, so which rule a program's practice default follows;
duplicate workout names in a program; where a legacy athlete's prescribed day appears now the old
forms are gone (step 12's legacy read).

## Round 3: the maintainer's answers (2026-11-15)

- **Single-value entries are edit-only.** Bodyweight, wrestling practice and any one-line Life
  field: enter once, then **Change**. No Delete, no Undo, no tomb, under any circumstance (the
  maintainer saw three stacked "Wrestling practice deleted · Undo" rows). Skipping means leaving it
  blank; **Change to blank clears it** back to an empty field, with no tomb.
- **Old entries are out until FAM-1 is done.** Nobody uses the app yet, so history isn't a
  concern. The prototype drops the "Earlier entries" section, the pre-program sample data and their
  jumps. The maintainer is asked again when FAM-1 closes.
- **Life sits under Bodyweight**: accepted.
- **✓ for bodyweight and practice**: accepted (the open question was answered by the panel and
  not contested).

**What this does to the plans:** V1-9b B1-3's Delete covered Life and past entries; with Life
edit-only and past entries deferred, **nothing is left of B1-3 on the new page** (workout rows
un-tick; Clear this day is B2). V1-24 3b shrinks to **Life and Bodyweight, edit-only**, with no
past-entry rows. The FAM-1 gates that waited on them loosen again.

## For the maintainer to decide (round 2, now answered or moot)

1. **Bodyweight and practice use the ✓, not a Log button.** That follows "no Log buttons anywhere",
   and makes every row on the page work the same way. OK?
   The panel agrees, now that numbers are checked and refusals show by the field.
2. **The past-entries heading.** "Logged" clashed with today's logged rows, so v10 now says
   **"Earlier entries"** with "From before programs. Read-only; delete a mistake." OK?
3. **A strength entry from before the program deletes as a whole**, now labelled "Delete all 3
   sets", because the old form saved it as one entry. Accept for Beta 0? (Panel: yes.)
4. **Life (practice minutes) now sits under Bodyweight**, above the workouts, instead of at the
   bottom. OK?

## Still not shown (for round 2 or d2)

- A second weigh-in defined by a program (morning and evening).
- A program-set default for practice minutes (Life sits outside programs today).
- Loading, failed save and offline states on the day page.
- Picker search with no match.
- "Do someone else's workout today": Beta 1 per the milestone, so out of this prototype.
