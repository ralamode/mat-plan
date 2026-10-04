# V1-30b — the form stops inviting the shapes V1-30a refuses

> Backlog: [plan.md](../plan.md) row V1-30b. Branch: `fix/v1-30b-form-stops-inviting`.
> Filed by: [v1-30-loggable-units.md § V1-30b](./v1-30-loggable-units.md#v1-30b-filed-not-in-this-pr-the-form-stops-inviting-the-bad-shapes).
> Feature guide: [strength-logging](../features/strength-logging.md) (owns every app and shared file below).
>
> **Status: revised after the engineering panel (correctness, scope, architecture, reuse) and the UX
> panel (interaction, a11y at 360px, trust/data-entry), 2026-10-03, with Ray's two decisions recorded.
> Awaiting Ray's approval. No implementation code until then.**

## Goal

V1-30 made every unit the Measuring picker offers save and export. It did not change what the form
_offers_: a time or distance card still shows the **BW** and **band** chips, which the server then
refuses (V1-30's refine 6), still labels its number field "weight", still blocks `6.25 ft` in the
browser, and still caps a 2-mile run at the 2000 a weight cap was sized for. This plan makes the form
offer only what the server will keep, and makes the number read as what it is — first in the form
(30b-i), then in the stored-value bounds and the history line (30b-ii).

## Ray's decisions (2026-10-03)

1. **History wording:** spell `m`, `yd`, `ft`, `in`, `cm` as words with correct singulars (`20 metres`,
   `1 foot`); keep `lb`, `kg`, `sec`, `min` as codes. The plural is `UNIT_LABELS[u].toLowerCase()`; only
   the singular is new data, and it lives next to `UNIT_LABELS` in `packages/shared`. No second map.
2. **Caps** (sanity bounds on what a person typed — never prescriptions; nothing reads them to suggest a
   load): `lb 2000 · kg 2000 · sec 86400 · min 1440 · in 1200 · cm 3000 · ft 5280 · yd 5280 · m 10000`.
   Roughly 2× the largest real use, so a 2-mile run typed into Inches (`3219 in`) is caught, and kg
   stays 2000 so the log and edit paths agree. One exported `quantityCeiling(unit)`; V1-33 adopts it on
   the edit path.

## The seven filed items, re-verified against `main` (2026-10-03)

| #   | Filed item                                                                       | State on `main`                                                                                                                          | Where it goes |
| --- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 1   | Hide BW / band on a time or distance movement; clear them when Measuring changes | **Open.** `SetModeToggles` renders on every card; `onUnit` patches only `unit`                                                           | 30b-i         |
| 2   | Field label/placeholder per dimension                                            | **Open.** `placeholder="weight"`; `weightInputLabel` → "… weight in sec"                                                                 | 30b-i         |
| 3   | Per-dimension blank copy ("Enter the time.")                                     | **✅ Done by V1-27 (#207)** — `missingQuantityMessage(unit)`. The server's neutral `BLANK_SET_MESSAGE` stays the backstop.               | —             |
| 4   | Mis-tap hint when Measuring differs from the catalog's dimension                 | **Open.** Only V1-26's weight note exists                                                                                                | 30b-i         |
| 5   | `step="0.5"` blocks `6.25 ft` / `1.25 min`                                       | **Open** — and on kg too (`61.25 kg`, 1.25 kg plates)                                                                                    | 30b-i         |
| 6   | The shared 2000 cap refuses a real 3219 m / 2400 sec                             | **Half done.** #201 changed the copy to "…— check the unit." (`NUMBER_TOO_HIGH_MESSAGE`); the cap is still one number (`strength.ts:80`) | 30b-ii        |
| 7   | History shows raw codes (`20 m`, `30 in`)                                        | **Open.** `formatValueUnit` is `${value} ${unit}`                                                                                        | 30b-ii        |

## Size and split

Counted against the files (re-checked after the panels): 30b-i ≈ 150 lines of code + ≈ 200 of tests;
30b-ii ≈ 80 + ≈ 140. Two concerns — what the form offers vs what a stored number may be and how it
reads — so **two PRs, 30b-i first**: it removes the only path a kid can reach the server's refusal
from. If 30b-i grows, the mis-tap hint (item 4, an advisory note rather than "stop offering") is the
first thing to cut to its own PR.

## Acceptance

From plan.md, verbatim: _"Hide BW / band on a time or distance movement and clear them when Measuring
changes; label the field `time` / `distance` instead of `weight` (placeholder and aria-label);
per-dimension blank copy ("Enter the time."); a hint when Measuring differs from the catalog's
dimension; `step="0.5"` blocks `6.25 ft`; the shared 2000 cap now refuses a real 2-mile run in metres
(3219) or a 40-minute hold in `sec` as "too high" (per-dimension caps, copy "check the unit"); history
shows raw codes (`20 m`) where the picker says "Metres"."_

**30b-i, done when:**

1. A card whose unit is not mass renders **no** BW / band chips (unmounted, not hidden); a mass card
   renders them as today.
2. Changing **Measuring** to a non-mass dimension clears `isBodyweight` / `isBand` on every set of that
   card, in the same single state update that changes the unit. Changing the **unit within mass**
   (lb → kg) clears nothing.
3. The number field's placeholder is the dimension's field word — `weight` / `time` / `length` — and
   its accessible name spells the unit for non-mass: "Movement 1 set 2 time in seconds",
   "… length in inches". Mass stays byte-identical ("… weight in lb"), so every mass locator holds.
4. Every number field uses `step="0.001"`, from a shared `QUANTITY_DECIMALS = 3` that the server's
   format check also reads: `6.25 ft`, `1.25 min` and `61.25 kg` are accepted natively; a 4th decimal
   is refused by the browser exactly where the server would refuse it.
5. A scaffolded card whose declared dimension differs from the chosen Measuring shows one advisory line
   **directly under the name / Measuring / Unit row**, wired to the Measuring select by
   `aria-describedby` (read on the control that caused it; no mount-with-text live region).
6. The V1-27 summary line and `isSubmitBlocked` agree with the browser on every case-table row below,
   including the three shapes a Measuring change creates.

**30b-ii, done when:**

7. The stored-value ceiling is per unit (Ray's table), every cap ≤ `numeric(8,3)`'s 99999.999, enforced
   once, in the session refine; over it → "That number looks too high — check the unit." One fault,
   one message.
8. History reads `20 metres`, `1 metre`, `30 inches`, `1 foot`, `6 feet`, `40 yards`, `75 centimetres`;
   `lb`, `kg`, `sec`, `min` unchanged. The CSV is untouched (its spellings are separate).

## Design — 30b-i

- **Remove, don't hide.** `SetModeToggles` renders only when `isMassUnit(movement.unit)`. Unmounted,
  never CSS: a hidden checkbox in the tab order is a trap (the V1-19 lesson).
- **Clear on dimension change, in one state update.** The Measuring `onChange` becomes
  `onDimension(next)`: ONE `setMovements` call that sets `unit` and, when the new unit is not mass, maps
  every set to `{ ...s, isBodyweight: undefined, isBand: undefined }`. One update, so no render ever
  carries BW on a non-mass unit. `undefined`, never `false` — "absent stays absent" on the wire. The
  Unit select's `onUnit` is unchanged: it never crosses a dimension.
- **Rejected alternative (logged):** keep the flags in state and filter them out at serialization. State
  would still count a BW-only set as touched while the wire carried a blank set the server refuses —
  invisible "touched" state, the V1-19 collapsed-card wedge (`strength-form-scaffold.ts`, "a pre-tapped
  chip is invisible state"), and the summary would disagree with the server. Clearing in state keeps
  every V1-27 predicate correct by construction.
- **Consequences of the clear, stated** (all correct, all pinned by case-table rows and
  `expectSummaryAgrees` tests):
  - **reps + BW on a set (the common shape — a `1 × BW` plank, then switched to Time):** the set keeps
    its reps, loses BW, so `weightRequired` turns true. The summary flips to "<name> set 1 needs
    finishing." and the field's bubble is "Enter the time." — a block with the right copy, not a drop.
  - **BW only, on every row (chips-first, then numbers):** every set becomes untouched, so a scaffolded
    card becomes droppable (`isUntouchedScaffold`) and the summary loses a movement.
  - **BW only, on a gap row before a touched set:** it becomes an untouched gap, which `setIsRequired`
    makes a blocker ("Fill in the reps…").
  - **BW plus a typed number (the "BW+8 vest" shape):** the number stays and is now read as the new unit
    ("8 sec"). Visible on the open card; accepted.

  No announcement: no typed number is lost, the chips visibly vanish, the cleared rows are visibly blank
  on a card the kid has open, and an announcement on every Measuring change would be noise. The one cost
  is a Weight → Time → Weight mis-tap round trip losing the BW ticks; recovery is re-tapping visible
  chips.

- **Step: one precision for every unit.** `step="0.001"` everywhere, from `QUANTITY_DECIMALS` in
  `packages/shared` (used by `strength.ts`'s format check and `set-fields.tsx`). The decimal keypad
  comes from `inputMode`, not `step`. This also closes the time → mass step mismatch (a `1.25` carried
  from Time into Weight used to fail `step="0.5"` while the summary said ready), so there is no blind
  spot to record. A `0.5` step on lb caught no real typo.
- **Label.** `weightInputLabel(subject, unitLabel)` becomes `quantityInputLabel(subject, unit)`:
  - mass → `${subject} weight in ${unit}` — byte-identical;
  - non-mass → `${subject} ${fieldWord} in ${UNIT_LABELS[unit].toLowerCase()}` ("time in seconds").
  - The **field word** (placeholder and accessible name) is `QUANTITY_FIELD_WORD`: `weight` / `time` /
    `length`. `length` for the length dimension, because it covers a box-jump HEIGHT and a broad-jump
    DISTANCE (the `units.ts` note), fits the `w-24` field (~52px), and doesn't contradict the blank
    copy "Enter the height or distance." (`distance` would mislabel the main length movement, a box
    jump). The visible echo after the field stays the unit code; the row is ≈ 275 of ≈ 294px at 360px.
  - `editable-set.tsx` passes its unit (mass-only until V1-33, output unchanged).
- **Mis-tap hint.** `MovementVals` gains a TRANSIENT `declaredDimension?: UnitDimension`, set **only by
  the scaffold** from the catalog's `unitDefault` (via the existing `declaredUnit` helper), cleared on
  rename (like `declaredLoaded`), never serialized. A typed name has no declaration, so no hint.
  - **Copy, one function:** `usuallyLoggedAs(name, dimension)` built from `LOGGABLE_DIMENSION_NOUNS`:
    mass → V1-26's exact sentence "<name> is usually logged with a weight."; time → "…as a time.";
    length → "…as a height or distance." V1-26's inline sentence moves into the same function.
  - **Placement and announcement:** a `<p id={hintId}>` directly under the name / Measuring / Unit row,
    and the Measuring `<select>` carries `aria-describedby={hintId}` while the hint shows. No
    `role="status"`. Reflow is acceptable: it happens as the picker sheet closes, and the thumb is not
    on the rows that move.
  - **V1-26's weight note gets the same fix** (cheap, same function): its `<p>` keeps its place below the
    sets (its trigger is a chip in the sets), gains a stable id, and the BW chip that triggered it
    carries `aria-describedby`. No mount-with-text `role="status"`.
- **What does NOT change:** the server refine 6 stays the backstop for a crafted body;
  `strength-form-untouched.ts` is untouched — it reads state, and the clear happens in state.

## Design — 30b-ii

- **Per-unit ceilings.** `MAX_QUANTITY_BY_UNIT` (Ray's table) and `quantityCeiling(unit)` in
  `packages/shared/src/units.ts`. Enforced **once**, in the session refine where the unit is known:
  - **Delete** the per-set `> 2000` check (`strength.ts:80`); otherwise `3219 m` is still refused there.
  - Guard `typeof set.weight === 'number'`: the session refine runs even when a set's format check
    failed and then sees the raw string (a zod 4.6.5 probe: `["plain", "seen string"]`), so an unguarded
    compare would add "too high" on top of "Enter a plain number" — two messages for one fault.
  - A unit with no cap is **refused**, never "no cap": `n > undefined` is false, so a missing entry would
    silently disable the bound. `units.test.ts` also requires a cap for every loggable unit.
  - The edit path's `numericSetSchema.max(2000)` is mass-only until V1-33, and kg stays 2000, so the two
    paths agree today; V1-33 switches the edit path to `quantityCeiling(unit)`.
- **History wording (Ray's decision 1).** `formatValueUnit` spells `m`, `yd`, `ft`, `in`, `cm`:
  plural `UNIT_LABELS[u].toLowerCase()`, singular from `UNIT_SINGULAR_LABELS` beside it in shared
  (`metre`, `yard`, `foot`, `inch`, `centimetre`) when `value === 1`. Codes for `lb`, `kg`, `sec`, `min`.
  It has more callers than the history line — set-display's main and auxiliary quantities
  (`+50 feet distance`) and `entry-label.ts` metric entries — all intended; the bodyweight callers pass
  `lb`/`kg` and are unchanged. The CSV uses its own spellings in `csv/value.ts` and is untouched.

## File-by-file changes

**30b-i**

| Path                                                                            | Change | What & why                                                                                                                             |
| ------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/strength.ts`                                               | EDIT   | Format check reads `QUANTITY_DECIMALS` (behaviour unchanged)                                                                           |
| `packages/shared/src/units.ts`                                                  | EDIT   | `QUANTITY_DECIMALS = 3`                                                                                                                |
| `apps/web/app/p/[profileId]/strength-form.tsx`                                  | EDIT   | Chips only on mass; `onDimension` (one `setMovements`); `declaredDimension` carried + cleared on rename; the hint under the header row |
| `apps/web/app/p/[profileId]/strength-form-scaffold.ts`                          | EDIT   | `declaredDimension` from `unitDefault`                                                                                                 |
| `apps/web/app/p/[profileId]/set-fields.tsx`                                     | EDIT   | Placeholder + accessible name per dimension; `step` from `QUANTITY_DECIMALS`; takes `unit` (typed)                                     |
| `apps/web/app/p/[profileId]/set-mode-toggles.tsx`                               | EDIT   | BW chip accepts `aria-describedby` (the V1-26 note)                                                                                    |
| `apps/web/app/p/[profileId]/editable-set.tsx`                                   | EDIT   | Pass `unit` to the renamed label helper (output unchanged)                                                                             |
| `apps/web/lib/constants.ts`                                                     | EDIT   | `quantityInputLabel` (replaces `weightInputLabel`), `QUANTITY_FIELD_WORD`, `usuallyLoggedAs`                                           |
| `apps/web/app/p/[profileId]/strength-form.test.tsx`                             | EDIT   | The `weightOf` locator (`^Movement N set M weight`) becomes field-word aware — the existing time-card test uses it; new tests below    |
| `apps/web/app/p/[profileId]/strength-form-scaffold.test.ts`                     | EDIT   | `declaredDimension`                                                                                                                    |
| `apps/web/app/p/[profileId]/editable-set.test.tsx`, `apps/web/e2e/a11y.spec.ts` | EDIT   | Locators → `quantityInputLabel`; a11y gains a time-card case                                                                           |
| `apps/web/lib/constants.test.ts`                                                | EDIT   | `quantityInputLabel`, `usuallyLoggedAs`                                                                                                |
| `docs/features/strength-logging.md`                                             | EDIT   | Invariant 4b (what the form offers per dimension); traps: clearing a mode can un-touch a set; filtering at serialization was rejected  |

**30b-ii**

| Path                                                         | Change | What & why                                                                                    |
| ------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------- |
| `packages/shared/src/units.ts`                               | EDIT   | `MAX_QUANTITY_BY_UNIT`, `quantityCeiling`, `UNIT_SINGULAR_LABELS`                             |
| `packages/shared/src/strength.ts`                            | EDIT   | **Delete** the per-set `> 2000` check                                                         |
| `packages/shared/src/strength-session.ts`                    | EDIT   | Per-unit ceiling in the session refine (number-guarded; missing cap refuses)                  |
| `packages/shared/src/units.test.ts`                          | EDIT   | Every loggable unit has a cap ≤ 99999.999 and a singular where spelled                        |
| `apps/web/app/p/[profileId]/strength-set-schema.test.ts`     | EDIT   | The per-set cap tests (`'99999'`, `'3200'`) move to the session level                         |
| `apps/web/app/p/[profileId]/strength-session-schema.test.ts` | EDIT   | Per-unit caps; one message when the format check also fails                                   |
| `apps/web/lib/entries/format-value-unit.ts` (+ `.test.ts`)   | EDIT   | Spell the five codes; singular at 1                                                           |
| `apps/web/app/p/[profileId]/set-display.test.ts`             | EDIT   | `'3 × 30 in'` → `'3 × 30 inches'`; `'+50 ft distance'` → `'+50 feet distance'`                |
| `apps/web/lib/entries/entry-label` tests                     | EDIT   | Metric entries spelled                                                                        |
| `docs/features/strength-logging.md`                          | EDIT   | It owns `units.ts`, `strength.ts`, `strength-session.ts`: the cap moved to the session refine |

## Test plan

Red first where possible: each new test is committed failing on `main`'s code, then fixed.

**30b-i**

| Case                                        | Expected                                                                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Time card                                   | No BW/band checkbox; mass card has both                                                                               |
| BW on a mass card → Measuring to Time       | No chips; payload sets carry no `isBodyweight`; lb → kg keeps BW                                                      |
| reps + BW → Time                            | Blocked: summary "<name> set 1 needs finishing.", bubble "Enter the time."                                            |
| BW only on every row (scaffolded) → Time    | Card droppable; summary one movement fewer                                                                            |
| BW-only gap row before a touched set → Time | Gap row blocks ("Fill in the reps…")                                                                                  |
| Accessible name                             | "Movement 1 set 1 time in seconds"; "… length in inches"; mass "… weight in lb" byte-identical                        |
| Step                                        | `step="0.001"` on every unit; `61.25 kg`, `6.25 ft` valid; `1.2345` invalid                                           |
| Hint                                        | Under the header row; Measuring select `aria-describedby` → its id; not on a match or a typed name; cleared on rename |
| V1-26 note                                  | Stable id; BW chip `aria-describedby` → it; no `role="status"`                                                        |

Every blocking and droppable row runs through `expectSummaryAgrees`. Scaffold unit: `declaredDimension`
from `unitDefault`; null → none. e2e (`a11y.spec.ts`): a time card at 360px — no overflow, axe clean, tap
targets. **Mutations:** chips unconditionally; skip the clear; clear on a mass unit change; two updates
instead of one (a render with BW on Time); `step="0.5"` back; the hint's `aria-describedby` dropped;
drop the rename clear of `declaredDimension`.

**30b-ii**

- Schema: `3219 m`, `2400 sec`, `100 in` accepted; `3219 in`, `10001 m`, `86401 sec`, `2001 kg`,
  `2001 lb` refused with `NUMBER_TOO_HIGH_MESSAGE`; `99999.1234` gets ONE message ("Enter a plain
  number"); a unit with no cap refused; every loggable unit has a cap (`units.test.ts`).
- `formatValueUnit`: `20 metres`, `1 metre`, `1 foot`, `6 feet`, `30 inches`, `75 centimetres`;
  `84.5 lb`, `30 sec` unchanged.
- **Mutations:** the per-set 2000 back; no number guard (two messages); a missing cap read as "no cap";
  plural at 1; `in` back to the code.

## Interactions

- **V1-27:** `isSubmitBlocked`, `weightRequired`, `isUntouchedSet` and the summary line all read state;
  the clear is a state change, so they agree by construction. The three shapes it creates are pinned
  above. With one precision for every unit, a step failure can no longer be created by a Measuring
  switch.
- **V1-30 refine 6:** unchanged, still the backstop.
- **Edit form (V1-9 / 3a-i):** mass-only until V1-33; renamed label helper, identical output.
- **V1-34** (jumps and holds open as Weight / Pounds) is catalog DATA — out of scope. Every catalog
  `unitDefault` today is `lb`, so the hint can only fire for a weighted movement moved off Weight — the
  unrecoverable V1-30 U5 case, which is exactly why its placement is the blocking fix.
- **V1-33** (non-mass sets can't be edited) — out of scope, sequenced after this.
- **V1-37** (filed by this plan): time cards require reps ≥ 1 in a reps × time layout.

## Risks / rollback

- Renaming `weightInputLabel` touches every locator that uses it; mass output is byte-identical, so a
  missed locator fails loudly.
- A Measuring change can block a set or drop a BW-only card (stated above); every shape is visible on the
  open card and pinned by tests.
- Rollback: revert the PR; no schema or data change in either part.

## Out-of-scope / deferred

V1-33 (edit non-mass), V1-34 (catalog unit defaults), V1-35 (ambiguous duplicate names), V1-37 (reps on
time cards), a server-side per-dimension blank message (the client copy covers the reachable path).

## Review-response log

**UX panel (2026-10-03)**

| ID    | Finding                                                                                | Response                                                                                                              |
| ----- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| UX-B1 | The mis-tap hint rendered ~350px below its trigger, in a mount-with-text live region   | **Accepted.** Under the header row, `aria-describedby` on Measuring, no `role="status"`, component test of the wiring |
| UX-S1 | Hint copy "…as Weight." (mid-sentence capital, slash) and a second phrasing of V1-26's | **Accepted.** One `usuallyLoggedAs` from `LOGGABLE_DIMENSION_NOUNS`; mass reuses V1-26's sentence                     |
| UX-S2 | Accessible name "distance in in" reverses the accepted V1-30 item                      | **Accepted.** Non-mass spells the unit ("time in seconds"); mass byte-identical                                       |
| UX-S3 | The side effect can drop a whole movement and can create a blocking gap                | **Accepted.** Consequences rewritten; case rows + tests; no announcement (reasoned); rejected alternative logged      |
| UX-S4 | Length caps at the column limit never fire                                             | **Resolved by Ray's decision 2** (tight caps)                                                                         |
| UX-S5 | History: "1 feet", inconsistent `cm`, a duplicate map                                  | **Resolved by Ray's decision 1** + singulars; plural from `UNIT_LABELS`                                               |
| UX-N1 | `step="0.5"` blocks `61.25 kg`                                                         | **Accepted.** One `QUANTITY_DECIMALS` step for every unit                                                             |
| UX-N2 | "distance" placeholder clips on desktop                                                | **Resolved:** the field word is `length` (~52px), which fits with the spinner                                         |
| UX-O1 | V1-26's note has the same live-region problem                                          | **Accepted** in 30b-i (cheap: the same copy function)                                                                 |
| UX-O2 | Time cards require reps ≥ 1 in a reps × time layout                                    | **Filed** as V1-37                                                                                                    |

**Engineering panel (2026-10-03)**

| ID     | Finding                                                                                      | Response                                                                                                     |
| ------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| ENG-S1 | The cap move is under-specified; the session refine sees the raw string on a format failure  | **Accepted.** Delete the per-set check; number guard; a missing cap refuses; tests move to the session level |
| ENG-S2 | The Consequence section missed the common shape (reps + BW → blocked) and the time→mass step | **Accepted.** Rewritten; the step mismatch is removed by one precision for every unit                        |
| ENG-S3 | Spelling breaks the singular and reaches more callers than history                           | **Accepted.** Singulars; callers and their tests listed; "1 ft" → "1 foot"                                   |
| ENG-S4 | `UNIT_DISPLAY` duplicates `UNIT_LABELS`                                                      | **Accepted.** Plural derived; singulars beside `UNIT_LABELS` in shared                                       |
| ENG-S5 | `step="any"` lets through what the server refuses                                            | **Accepted.** `step="0.001"` from shared `QUANTITY_DECIMALS`, also read by the format check                  |
| ENG-S6 | Accessible name "distance in in"                                                             | **Accepted** (same as UX-S2)                                                                                 |
| ENG-N1 | kg 1000 makes the log and edit paths disagree                                                | **Resolved by Ray's decision 2** (kg 2000); `quantityCeiling` for V1-33                                      |
| ENG-N2 | Incomplete file tables                                                                       | **Accepted.** Completed (the `weightOf` locator, the 30b-ii guide row, both schema test files, set-display)  |
| ENG-A1 | "distance" mislabels a box jump and clashes with the blank copy                              | **Accepted.** Field word `length`                                                                            |
| ENG-A2 | "Only scaffolded or catalog-known cards" is inaccurate                                       | **Accepted.** Scaffolded only                                                                                |
| ENG-A3 | Two state updates can render BW on a non-mass unit                                           | **Accepted.** One `setMovements`; a mutation pins it                                                         |
