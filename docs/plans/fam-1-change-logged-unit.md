# FAM-1: changing a row logged in another unit than its item's (three forms)

> Backlog: [plan.md](../plan.md) row `FAM-1`, the follow-up the [12d plan](./fam-1-12d-change-on-page.md)
> cut ("Not in this PR", first bullet), decision D20. Branch: `docs/fam-1-change-logged-unit-plan`.
> Lane C ([day-page.md](../features/day-page.md)). **Rev 2, after a three-lens UX panel** (§
> Review-response log). No code: this plan compares three forms so the maintainer can pick one, and
> plans a guard that is owed whichever form is picked.

**Roadmap alignment (2026-11-18):** finishes the screen half of contract change C28 inside `FAM-1`
lane C; gates nothing (12d already shipped with such a row read-only, and step 15 does not wait on
it). Checked against the private roadmap; nothing to add here.

## The case

On the day page a logged row's numbers are changed in place (13b-ii; live since 12d). A row whose
quantity was logged in another unit than the item's **current** unit is offered no Change at all,
reps included: `canChangeValues` (`apps/web/components/day/row-values.ts:220-234`) runs
`fillRowValues(item, logged, null)`, which refuses a quantity whose unit is not `item.unit`
(`packages/shared/src/program/pieces.ts:490`). The writer judges a Change in the **logged** unit
(`amend-row.ts:95-103`, `loggedRowUnit` at `pieces.ts:514`, C28); the contract records that the
screen is stricter (`docs/features/program-contract.md:417-425`, invariant 27). Such a row shows
its load as text with its own unit (`fieldText`, `row-values.ts:153-159`: `27.5 lb` under a `kg`
header), and gives no reason why it cannot be changed.

**How rare it is.** All of these must hold:

1. a row is logged on a weight × reps, distance or count item, the only types whose unit comes from
   the prescription (`pieces.ts:286-326`: a Duration is fixed at `min`, Time per set at `sec`);
2. someone then saves the workout with that prescription's unit edited in place (invariant 27); the
   program is the household's, so the realistic order is **a parent edits the unit, then a kid
   corrects**;
3. the correction is wanted **within today or yesterday** (D20; older days are read-only).

Removed prescriptions never hit it: their `DayItem.unit` comes from the entry (`pieces.ts:576-578`),
and they have no Change anyway (`use-change.ts:85-91`).

## 🔴 A risk on `main` today: un-check, fix the reps, ✓

12d's comments and the guide name **un-tick then a new ✓** as the way to change such a row
(`row-values.ts:225`, `:232`; `day-page.md:134-138`, invariant 14). Followed literally, it can store
a load nobody lifted:

1. Un-checking keeps the reps in the field but **blanks the other-unit load** (`textOf`,
   `row-values.ts:135-146`, applied at `use-row.ts:405-406`).
2. The kid fixes only the reps and taps ✓. The text is no longer the kept text, so `press` skips the
   re-tick (`use-row.ts:429-436`) and reads the fields as a new ✓.
3. `readTyped` lets the blank load through because the prescription can fill it
   (`row-values.ts:91-96`), and `fillRowValues(item, values, item.target)` stores the
   **prescription's kg load** (`:114`; D13). The field showed that number as a grey placeholder
   (`placeholderOf`, `:61-65`), which looks filled in.

**The guard (recommended as its own small PR, ahead of any form):** on a row un-checked this visit
whose held load is in another unit than the item's, an empty load answers `missing` (the existing
`TYPED_PROBLEM_COPY`, `use-row.ts:440-448`) instead of D13's fill, so the person has to type the load.
An untouched re-tick still restores the lb row. Files: `use-row.ts` (`press`), `row-values.ts`
(`readTyped` takes "no fill for the load"), a test in `set-rows.test.tsx`; ~40 lines. It covers this
visit only: after a reload the un-check is gone and the row is an ordinary empty row (D20; `use-row.ts:36`,
`:60`: the un-tick is this visit's state), where D13's fill is the intended behaviour.

## Width facts (360px), re-verified

- Card inner width **302px**, **288px** in a superset (`set-table.tsx:49`; `CARD_CLASS` is
  `rounded-xl border p-3`, `row-parts.tsx:30`).
- Set table: `table-fixed`, columns set `w-7` (28), load `w-16` (64), reps `w-14` (56), ✓ `w-14`
  (56) (`set-table.tsx:120-128`, `fieldColumnClass` at `:198-201`, `TICK_COLUMN_CLASS` at `:190`).
  Weight × reps: 204px fixed, so **Previous gets 98px (84 in a superset)**. Distance has no reps
  column: 148px fixed, Previous 154 (140).
- Load cell: 64 − the cell's `px-0.5` = **60px** of text. As a field: 60 − the field's `px-0.5` (4,
  overriding `INPUT_CLASS`'s `px-3`, `lib/constants.ts:643`) − `border-2` while typed over (4,
  `CHANGED_FIELD_CLASS`, `row-parts.tsx:55`) = **52px**; `1012.5` needs ~51px at 16px
  (`set-table.tsx:193-197`). **No room for a unit beside or inside the field.** As text, `132.5 lb`
  at `text-base font-medium` is ~59px: it may break before `lb`, as `fieldText` already can.
- Item card (count type): `ChangeInput` `w-20` (80), `gap-2`, the unit suffix **beside** it, then the
  44px ✓ (`item-card.tsx:113-133`, `:165`). The left text gets ~138px. A suffix fits there.
- A line under a set row spans the table (`colSpan`, `set-table.tsx:327-344`): 302/288px at
  `text-sm`, about 40 characters a line, so a 95-character line is three lines.

## The three forms

### Form 1: reps only (weight × reps)

The load stays text, never a field; only the reps cell becomes a `ChangeInput`.

- **Width:** as today; see `132.5 lb` above. The visible code is `aria-hidden`, with the spoken unit
  in `sr-only` (`unitSpoken`, `row-values.ts:189-191`), so a reader hears "27.5 pounds", not
  "27.5 lb pounds".
- **`readAmend` must change** (`row-values.ts:244-277`). It loops over `fieldsOf(item)`, so the
  hidden load (blank in `textOf`) reads as `missing` and pushes a kept line; and its gate
  `fillRowValues(item, values, null)` (`:275`) refuses the unchanged lb quantity against a kg item,
  so `send` is `null` and **the typed reps would vanish**. Fix: `readAmend` takes the fields shown
  (`['reps']`) and judges with `{ ...item, unit: loggedRowUnit(item.trackingType, logged) }`, the
  writer's own rule (C28). `canChangeValues` becomes a three-way answer (all, reps only, none).
- **Distance and count rows get nothing from it** (no reps: `pieces.ts:286-297`, `:320-326`).
- **Contract:** invariant 27's last sentence ("offers no Change at all") becomes false; lanes do not
  edit the contract, so the rewording goes to the roadmap thread.

### Form 2: read-only plus a line

The row stays as today and carries a line. Rev 1's copy ("un-check it and log it again in kg") is
**withdrawn**: it sends the person into the prescription fill above, and it asks a kid to convert
units on the gym floor, where the likeliest entry is `27.5` typed as kg.

### Form 3: full switch to the logged unit

The field shows and sends the logged unit. One derived item in `useChange`
(`use-change.ts:82`): `changeItem = { ...item, unit: loggedRowUnit(item.trackingType,
entry.values) }`, fed to `canChangeValues` (`:91`), `textOf` (`:131`), `readNumber`'s ceiling
(`row-values.ts:214`), `readAmend` (`use-change.ts:201`), `keptText`/`changedText`, and the field's
name via `fieldSpoken` (`row-parts.tsx:243-245`, called from `change-parts.tsx:98`).

- **Set table:** the unit on its own line **under** the field (`set-table.tsx:270-285`): fits in
  width, costs ~16px of height, and the header still reads `kg` (`fieldHeader`,
  `row-parts.tsx:317-321`) above an lb field.
- **Item card (count):** cheap and readable: `unitSuffix(item.unit)` at `item-card.tsx:128-132`
  reads the change unit, beside the field as now. ⚠️ A plain count has **no suffix**
  (`unitSuffix('count')` is `''`, `row-values.ts:184-186`), so a row logged as a plain count under
  an item now in kg would show a bare field: that case needs a visible word, or stays read-only.

## The line on every other-unit row (whichever form)

Lens 3's copy, units spelled out (the `unitSpoken` convention), asking for no conversion:

> _Logged in pounds before the workout changed to kilograms. Ask whoever changed it to fix the load._

- **On every such row, logged or un-checked.** Today an un-checked row with a field exposes nothing
  of what it held (`kept` is `null` when `hasField`, `use-row.ts:460`), so `use-row` must expose the
  held values for the line to survive the un-check. Un-checked, the line adds that the load must be
  entered again (the guard enforces it). If the line mentions un-checking at all: "Tap ✓ to
  un-check".
- **Set table:** the row's second `<tr>` (`set-table.tsx:327-344`) renders when the row has a status
  **or** this line; the two are stacked siblings in the cell, line first. Three lines of text a row
  at 360px; four sets add twelve lines (accepted for a rare state; the panel may shorten later rows).
- **Item card:** the `mt-2 empty:hidden` slot (`item-card.tsx:174`) holds `RowStatus`; the line goes
  in a sibling above it, not inside it, so an error never replaces it.
- **Copy:** `DAY_COPY.otherUnit(logged, now)` in `day-copy.ts` (beside `change`, `:62`), from
  `UNIT_LABELS` (`units.ts:66-80`) lower-cased; a plain count reads "as a plain number", since
  `unitSpoken('count')` is `''`.
- **A11y:** `secondaryText(onTint)` for the line on the tint (`row-parts.tsx:33`). Only the
  other-unit rows' ✓ (and Form 1's reps field) add the line's id to `aria-describedby`; no id is
  referenced when the line is absent. Not a live region (`change-parts.tsx:124`).
- **Coverage:** no e2e spec reaches this state (`apps/web/e2e/a11y.spec.ts` and the day-page spec
  seed no row in another unit than its item). A component test covers it; an e2e fixture (a row
  logged, then its prescription's unit edited) is owed, and listed in the PR as not built.

## Trust and safety (the inviolable rule: no load stored in the wrong unit)

Direction matters. The number a person sees next time is Previous (`day-shapes.ts:47-63`), and a
person picks the next load from it. **An overstated history is worse**: it pushes the next load up.
An understated one pushes it down, the safe side.

|                                     | Error it allows                                                 | Direction                              | Likelihood                                                                                                |
| ----------------------------------- | --------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Today, and Form 2 without the guard | Fix reps, ✓: the prescription's kg load is stored               | Either: the prescription, not the lift | Medium: it is the documented path                                                                         |
| Form 2 with rev 1's copy            | `27.5` typed as kg for a 27.5 lb lift                           | **Over, ×2.2**                         | Medium: the copy asks for a conversion                                                                    |
| Form 1 (+ guard, + line)            | None for the load: never typed, sent back in its own unit       | —                                      | —                                                                                                         |
| Form 3                              | A kg number typed into the lb field (`60` kg stored as `60 lb`) | Under, ×0.45                           | Low: a kid correcting yesterday's lift remembers it in the unit it was logged in, the one the field shows |

**Recovery.** Undo returns this visit's first number (`use-change.ts:96`). An un-checked row's held
value is the **only copy on screen, and only for this visit** (`use-row.ts:36`, `:60`; after a reload
the row is empty, D20). After yesterday the day is read-only (D20) and only a data correction
(`db:correct`) can fix it. And un-checking yesterday's row without logging again **changes today's
Previous**, which falls back to an older day or none (`day-shapes.ts:47-63`).

## Alternatives considered

- **Convert the logged number** (27.5 lb → 12.47 kg): the app would restate a load; C28 rejects it.
- **A per-row unit select:** no width at 360px, and a second decision in one tap.
- **A mixed column header** (`kg / lb`): every row reads as ambiguous to fix one rare row.
- **Warn when the unit is edited**, at the workout's save: "3 rows logged in pounds in the last two
  days stay in pounds." Prevents the surprise at its source, for the parent who caused it. It is
  lane B's file (`apps/web/components/program-builder/`, `program-builder.md`); proposed to lane B,
  not built here, and it does not replace the guard.
- **The editor refuses a unit edit** while such rows exist: refuses a legitimate edit.
- **A Change sheet for that row:** a new pattern for a rare case.
- **Do nothing:** leaves the prescription-fill risk above open.

## Recommendation (to the maintainer; the choice is yours)

1. **The guard first, as its own PR** (~40 lines): it closes a risk that is live today whatever form
   ships.
2. **Then Form 1 for weight × reps**, with the line on every other-unit row: reps, the likeliest
   correction, are fixed in place; the load is shown and never typed, so no form of misreading can
   store it in the wrong unit; the line asks nobody to convert.
3. **Distance rows: the line only, read-only.** No reps to change, and no room for a unit under a
   64px field without Form 3's header contradiction.
4. **Count rows: the line only in that PR**; Form 3 on the item card is a cheap, readable later step
   (the suffix sits beside the field), except a plain count, which has no suffix to show.

Form 3 in the set table stays not recommended: its risk is low and on the safe side, but it puts an
lb field under a kg header for a case this rare.

## File-by-file

**Guard PR** (~40 lines): `apps/web/components/day/use-row.ts` EDIT (`press`); `row-values.ts` EDIT
(`readTyped`'s no-fill option); `set-rows.test.tsx` EDIT (un-check an lb row on a kg item, fix the
reps, ✓ → `missing`, nothing sent; untouched ✓ → re-tick in lb; a same-unit row still fills, D13);
`docs/features/day-page.md` EDIT (invariant 14 no longer says "un-tick then a new ✓ changes it");
comments at `row-values.ts:225`, `:232`.

**Form 1 PR** (~170 lines with tests)

| File                                    |      | Change                                                                                                                                                                                                                                                   |
| --------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/components/day/row-values.ts` | EDIT | `canChangeValues` three-way; `readAmend` takes the fields shown, judged in the logged unit; `loggedInOtherUnit(item, values)`                                                                                                                            |
| `apps/web/components/day/use-row.ts`    | EDIT | expose an un-checked row's held values                                                                                                                                                                                                                   |
| `apps/web/components/day/use-change.ts` | EDIT | the changeable fields                                                                                                                                                                                                                                    |
| `apps/web/components/day/set-table.tsx` | EDIT | reps-only `ChangeInput`; load text with `aria-hidden` code and `sr-only` words; the line in the second `<tr>`                                                                                                                                            |
| `apps/web/components/day/item-card.tsx` | EDIT | the line above the status slot                                                                                                                                                                                                                           |
| `apps/web/components/day/day-copy.ts`   | EDIT | `otherUnit(logged, now)`                                                                                                                                                                                                                                 |
| `row-values.test.ts`, `change.test.tsx` | EDIT | reps change sends lb unchanged, no kept line, Undo; the load is never a field; the line logged and un-checked, on the tint, plain count; `aria-describedby` only with the line; replaces the 🔴 tests at `row-values.test.ts:262`, `change.test.tsx:108` |
| `docs/features/day-page.md`             | EDIT | invariant 14                                                                                                                                                                                                                                             |

**Form 3 instead** (~220 lines): `use-change.ts` (`changeItem`), `change-parts.tsx` (the name),
`set-table.tsx` (the unit line), `item-card.tsx` (suffix), the same line and tests, and an e2e at
360px for the taller row.

Every PR adds a changelog fragment and screenshots at three widths; Forms 1 and 3 send invariant
27's rewording to the roadmap thread.

## Open questions

- **Which form?** The maintainer's choice; the recommendation above is Form 1 plus the line, after
  the guard.

## Review-response log

### UX panel (three lenses, Opus 5.5)

| #    | Lens         | Critique (short)                                                                                                     | Verdict      | Resolution                                                                                                          |
| ---- | ------------ | -------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------- |
| U1.1 | Interaction  | Form 2's recovery logs the prescription's kg load: un-check blanks the load, a reps fix skips the re-tick, D13 fills | **accepted** | Verified (`row-values.ts:91-96`, `:114`; `use-row.ts:429-436`); the guard, as its own PR first; also live on `main` |
| U1.2 | Interaction  | "Log it again in kg" asks a kid to convert; 27.5 typed as kg is likely                                               | **accepted** | Copy withdrawn; the new line asks for no conversion                                                                 |
| U1.3 | Interaction  | Form 3's misread scenario is too pessimistic                                                                         | **accepted** | Rescored: low, under-stated, with the parent-then-kid order                                                         |
| U1.4 | Interaction  | Warn at the unit edit is missing                                                                                     | **accepted** | Listed; lane B's file, proposed to lane B                                                                           |
| U1.5 | Interaction  | A Form 2 fallback for distance and count re-opens the conversion                                                     | **accepted** | Those rows get the no-conversion line, read-only                                                                    |
| U1.6 | Interaction  | "Un-check" names an action, not its cost                                                                             | **accepted** | "Tap ✓ to un-check" and "the load must be entered again"                                                            |
| U2.1 | A11y / 360px | Form 2's line is gone once the row is un-checked                                                                     | **accepted** | Verified (`use-row.ts:460`); `use-row` exposes the held values                                                      |
| U2.2 | A11y / 360px | `aria-describedby` would dangle on rows without the line                                                             | **accepted** | Only other-unit rows reference it                                                                                   |
| U2.3 | A11y / 360px | Unit codes are read aloud as letters                                                                                 | **accepted** | Words in the copy; `sr-only` words in Form 1                                                                        |
| U2.4 | A11y / 360px | The count unit has no suffix or spoken word                                                                          | **accepted** | "as a plain number"; Form 3 on count needs a visible word                                                           |
| U2.5 | A11y / 360px | Form 1 would read "27.5 lb pounds"                                                                                   | **accepted** | Code `aria-hidden`, words `sr-only`                                                                                 |
| U2.6 | A11y / 360px | Form 1 alone gives no reason why the load is fixed                                                                   | **accepted** | The line on every other-unit row                                                                                    |
| U2.7 | A11y / 360px | No fixture reaches this state                                                                                        | **accepted** | Component test now; e2e fixture owed and named in the PR                                                            |
| U2.8 | A11y / 360px | A small line on the tint needs `secondaryText`                                                                       | **accepted** | In the line's spec                                                                                                  |
| U2.9 | A11y / 360px | `132.5 lb` is ~59px in a 60px cell                                                                                   | **accepted** | Recorded; a break before the unit is allowed, as `fieldText` already does                                           |
| U3.1 | Trust        | The prescription fill (as U1.1)                                                                                      | **accepted** | As U1.1                                                                                                             |
| U3.2 | Trust        | The conversion over-states ×2.2, the worse direction for Previous                                                    | **accepted** | The trust table now scores direction                                                                                |
| U3.3 | Trust        | The un-checked value is the only copy, for one visit                                                                 | **accepted** | In Recovery                                                                                                         |
| U3.4 | Trust        | Un-checking yesterday's row changes today's Previous                                                                 | **accepted** | In Recovery (`day-shapes.ts:47-63`)                                                                                 |
| U3.5 | Trust        | "Un-check" names no cost                                                                                             | **accepted** | As U1.6                                                                                                             |
