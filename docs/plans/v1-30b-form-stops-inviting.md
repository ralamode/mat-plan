# V1-30b — the form stops inviting the shapes V1-30a refuses

> Backlog: [plan.md](../plan.md) row V1-30b. Branch: `fix/v1-30b-form-stops-inviting`.
> Filed by: [v1-30-loggable-units.md § V1-30b](./v1-30-loggable-units.md#v1-30b-filed-not-in-this-pr-the-form-stops-inviting-the-bad-shapes).
> Feature guide: [strength-logging](../features/strength-logging.md) (owns every app file below).
>
> **Status: DRAFT, awaiting the engineering panel, the UX panel and Ray's approval. No implementation
> code until then.**

## Goal

V1-30 made every unit the Measuring picker offers save and export. It did not change what the form
_offers_: a time or distance card still shows the **BW** and **band** chips, which the server then
refuses (V1-30's refine 6), still labels its number field "weight", still blocks `6.25 ft` in the
browser, and still caps a 2-mile run at the 2000 a weight cap was sized for. This plan makes the form
offer only what the server will keep, and makes the number read as what it is — first in the form
(30b-i), then in the stored-value bounds and the history line (30b-ii).

## The seven filed items, re-verified against `main` (2026-10-03)

| #   | Filed item                                                                          | State on `main`                                                                                                                                                                                                                                            | Where it goes |
| --- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 1   | Hide BW / band on a time or distance movement; clear them when Measuring changes    | **Open.** `SetModeToggles` renders on every card (`strength-form.tsx` ~902); `onUnit` patches only `unit`                                                                                                                                                  | 30b-i         |
| 2   | Field label/placeholder per dimension (`time` / `distance`, not `weight`)           | **Open.** `placeholder="weight"` and `weightInputLabel` → "… weight in sec" (`set-fields.tsx:134-135`, `constants.ts:168`)                                                                                                                                 | 30b-i         |
| 3   | Per-dimension blank copy ("Enter the time.")                                        | **✅ Done by V1-27 (#207)** — `missingQuantityMessage(unit)` (`constants.ts`) gives "Enter the time." / "Enter the height or distance." on the client. The server's unit-neutral `BLANK_SET_MESSAGE` ("Enter a number.") stays as the backstop, correctly. | —             |
| 4   | Mis-tap hint when Measuring differs from the catalog's dimension                    | **Open.** Only the V1-26 "usually logged with a weight" note exists (`strength-form.tsx` ~955), which keys off `declaredLoaded`                                                                                                                            | 30b-i         |
| 5   | `step="0.5"` blocks `6.25 ft` / `1.25 min`                                          | **Open.** `set-fields.tsx:130`                                                                                                                                                                                                                             | 30b-i         |
| 6   | The shared 2000 cap refuses a real 3219 m / 2400 sec                                | **Half done.** #201 changed the copy to "…— check the unit." (`NUMBER_TOO_HIGH_MESSAGE`), but the cap is still one number for every unit (`strength.ts:80`)                                                                                                | 30b-ii        |
| 7   | History shows raw codes (`20 m`, `30 in`) where the picker says "Metres" / "Inches" | **Open.** `formatValueUnit` is `${value} ${unit}` (`format-value-unit.ts:36`)                                                                                                                                                                              | 30b-ii        |

## Size and split

Counted against the files: 30b-i is ~130 lines of code + ~170 of tests; 30b-ii is ~70 + ~110. Together
~480 — over the 400-line target, and two different concerns (what the form offers vs what a stored number
is allowed to be and how it reads). **Two PRs, 30b-i first**: it removes the only path a kid can reach
the server's refusal from, which is the user-visible bug. 30b-ii is correctness of bounds and wording.

## Acceptance

From plan.md, verbatim: _"Hide BW / band on a time or distance movement and clear them when Measuring
changes; label the field `time` / `distance` instead of `weight` (placeholder and aria-label);
per-dimension blank copy ("Enter the time."); a hint when Measuring differs from the catalog's
dimension; `step="0.5"` blocks `6.25 ft`; the shared 2000 cap now refuses a real 2-mile run in metres
(3219) or a 40-minute hold in `sec` as "too high" (per-dimension caps, copy "check the unit"); history
shows raw codes (`20 m`) where the picker says "Metres"."_

**30b-i, done when:**

1. A card whose unit is not mass renders **no** BW / band chips; a mass card renders them as today.
2. Changing **Measuring** to a non-mass dimension clears `isBodyweight` / `isBand` on every set of that
   card. Changing the **unit within mass** (lb → kg) clears nothing.
3. The number field's placeholder and accessible name use the dimension noun: "weight" / "time" /
   "distance" (accessible name: "Movement 1 set 2 time in sec"). Mass stays byte-identical
   ("… weight in lb"), so every existing locator holds.
4. A non-mass field accepts `6.25` / `1.25` natively; a mass field keeps `step="0.5"`.
5. A scaffolded card whose catalog dimension differs from the chosen Measuring shows one advisory line,
   "<name> is usually logged as <Label>." (`role="status"`, below the sets, the V1-26 idiom).
6. The V1-27 summary line and `isSubmitBlocked` still agree with the browser on every case-table row,
   including a set whose only touch was a BW tap that Measuring then cleared.

**30b-ii, done when:**

7. The stored-value ceiling is **per unit** (table below), each ≤ the column's physical limit
   (`numeric(8,3)` → 99999.999); over it → "That number looks too high — check the unit."
8. History reads `20 metres`, `30 inches`, `6 feet`, `40 yards`, `75 cm`; `lb`, `kg`, `sec`, `min` are
   unchanged (open question 1).

## Design — 30b-i

- **Hide.** `SetModeToggles` renders only when `isMassUnit(movement.unit)`. Hidden by unmounting, never
  CSS: a hidden checkbox in the tab order is a trap (the V1-19 lesson).
- **Clear on dimension change, in the one place the dimension changes.** The Measuring `onChange`
  becomes `onDimension(next)`: it patches `unit` **and**, when the new unit is not mass, maps every set
  to `{ ...s, isBodyweight: undefined, isBand: undefined }`. `undefined`, never `false`, so "absent
  stays absent" on the wire (the existing convention). The Unit select's `onUnit` is unchanged: it
  never crosses a dimension.
- **Consequence to state, not to hide:** a set whose ONLY touch was a BW tap becomes untouched once
  cleared, so if it is trailing V1-27 drops it. Correct — it carried no number, and BW is refused on a
  time — but the summary line will drop by one set, which is the V1-27 safeguard working as designed. A
  case-table row and a component test pin it.
- **Label.** `weightInputLabel(subject, unitLabel)` becomes `quantityInputLabel(subject, unit)` →
  `${subject} ${noun} in ${unit}`, `noun` from `LOGGABLE_DIMENSION_NOUNS`, but `distance` for `length`
  (the noun map says "height or distance", which is ~135px — too wide for the `w-24` placeholder; the
  accessible name uses the same short word for consistency). One copy constant map,
  `QUANTITY_FIELD_NOUN`, in `lib/constants.ts`. `editable-set.tsx` passes its unit too (it is mass-only
  until V1-33, so its output is unchanged).
- **Step.** `step={isMassUnit(unit) ? '0.5' : 'any'}`. `any`, not `0.001`: the server already accepts
  3 decimals, and `any` keeps the decimal keypad without inventing a precision.
- **Mis-tap hint.** `MovementVals` gains a TRANSIENT `declaredDimension?: UnitDimension`, set by the
  scaffold from the catalog's `unitDefault` (the `declaredUnit` helper already exists), cleared on rename
  (like `declaredLoaded`), never serialized. Copy: `MEASURING_HINT(name, label)`. Only scaffolded or
  catalog-known cards carry it; a typed name has no declaration, so no hint (no false positives).
- **What does NOT change:** the server refine 6 stays as the backstop (a crafted body is still refused);
  `strength-form-untouched.ts` is untouched — it reads state, and the clear happens in state.

## Design — 30b-ii

- **Per-unit ceilings** — `MAX_QUANTITY_BY_UNIT` in `packages/shared/src/units.ts`, enforced in the
  log schema's quantity refine where the unit is known (the session refine, per movement), replacing the
  flat 2000 there. **These are sanity bounds on what a person typed, not prescriptions** — nothing reads
  them to suggest a load, and the LLM-never-authors-loads rule is untouched.

  | unit | cap   | why                         |
  | ---- | ----- | --------------------------- |
  | lb   | 2000  | unchanged                   |
  | kg   | 1000  | ≈ 2000 lb                   |
  | sec  | 86400 | one day                     |
  | min  | 1440  | one day                     |
  | m    | 99999 | the column limit (≈ 100 km) |
  | yd   | 99999 | column limit                |
  | ft   | 99999 | column limit                |
  | in   | 99999 | column limit                |
  | cm   | 99999 | column limit (1 km)         |

  The set-level numeric schema's `.max(2000)` is the EDIT path's (mass-only until V1-33) and stays.

- **History wording.** `formatValueUnit` keeps codes for `lb`, `kg`, `sec`, `min` (unambiguous, and
  bodyweight's `84.5 lb` is pinned by e2e) and spells the rest: `UNIT_DISPLAY` in `lib/constants.ts`.
  `in` is the real bug — "30 in" reads as a preposition.

## File-by-file changes

**30b-i**

| Path                                                                                                      | Change | What & why                                                                                                            |
| --------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------- |
| `apps/web/app/p/[profileId]/strength-form.tsx`                                                            | EDIT   | Toggles only on mass; `onDimension` clears modes; `declaredDimension` carried + cleared on rename; the measuring hint |
| `apps/web/app/p/[profileId]/strength-form-scaffold.ts`                                                    | EDIT   | Set `declaredDimension` from `unitDefault`                                                                            |
| `apps/web/app/p/[profileId]/set-fields.tsx`                                                               | EDIT   | Placeholder + accessible name per dimension; `step` per dimension; takes `unit` (typed)                               |
| `apps/web/app/p/[profileId]/editable-set.tsx`                                                             | EDIT   | Pass `unit` to the renamed label helper (output unchanged)                                                            |
| `apps/web/lib/constants.ts`                                                                               | EDIT   | `quantityInputLabel` (replaces `weightInputLabel`), `QUANTITY_FIELD_NOUN`, `MEASURING_HINT`                           |
| `apps/web/app/p/[profileId]/strength-form.test.tsx`, `strength-form-scaffold.test.ts`, `set-fields` tests | EDIT   | Below                                                                                                                 |
| `apps/web/e2e/a11y.spec.ts`, `editable-set.test.tsx`                                                      | EDIT   | Locators → `quantityInputLabel`                                                                                       |
| `docs/features/strength-logging.md`                                                                       | EDIT   | Invariant 4b (what the form offers per dimension); trap: clearing a mode can un-touch a set                           |

**30b-ii**

| Path                                                            | Change | What & why                                                                     |
| --------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------ |
| `packages/shared/src/units.ts`                                  | EDIT   | `MAX_QUANTITY_BY_UNIT`                                                         |
| `packages/shared/src/strength.ts`, `strength-session.ts`        | EDIT   | Per-unit ceiling in the session refine; the flat 2000 leaves the log path only |
| `apps/web/lib/entries/format-value-unit.ts`, `lib/constants.ts` | EDIT   | `UNIT_DISPLAY`                                                                 |
| `packages/shared/src/units.test.ts`                             | EDIT   | Every loggable unit has a cap ≤ 99999.999 (the chain test)                     |
| tests for the refine and `formatValueUnit` callers              | EDIT   | Below                                                                          |

## Test plan

Red first where possible: each new test is committed failing on `main`'s code, then fixed.

**30b-i**

- Component: a time card has no BW/band checkbox; a mass card has both.
- Component: tap BW on a mass card, switch Measuring to Time → no chips, and the serialized payload's
  sets carry no `isBodyweight`; switch lb → kg → BW still set.
- Component: a BW-only trailing row cleared by the switch is dropped, and the summary line counts one
  fewer set (`expectSummaryAgrees` on that row).
- Component: accessible name "Movement 1 set 1 time in sec"; mass "… weight in lb" byte-identical.
- Component: a time field has `step="any"`, a mass field `step="0.5"`.
- Scaffold unit: `declaredDimension` from `unitDefault`; null → none.
- Component: the measuring hint renders on a scaffolded mismatch, not on a match, not on a typed name;
  cleared on rename.
- e2e (`a11y.spec.ts`): a time card at 360px — no overflow, axe clean, tap targets.
- **Mutations:** render chips unconditionally; skip the clear; clear on a mass unit change; keep
  `step="0.5"` everywhere; drop the rename clear of `declaredDimension`.

**30b-ii**

- Schema: `3219 m` and `2400 sec` accepted; `100000 m` and `86401 sec` refused with the constant;
  `2001 lb` refused (unchanged); every loggable unit has a cap (`units.test.ts`).
- `formatValueUnit`: `20 metres`, `30 inches`; `84.5 lb`, `30 sec` unchanged.
- **Mutations:** flat 2000 back; a unit missing from the map; `in` back to the code.

## Interactions

- **V1-27:** `isSubmitBlocked`, `weightRequired`, `isUntouchedSet` and the summary line all read state;
  the clear happens in state, so they stay in agreement by construction. The one new behaviour (a
  BW-only row becoming untouched) is pinned above.
- **V1-30 refine 6:** unchanged and still the backstop for a crafted body.
- **Edit form (V1-9/3a-i):** mass-only until V1-33; it gets the renamed label helper with identical
  output. V1-33 will inherit the per-dimension label for free.
- **V1-34** (jumps and holds open as Weight/Pounds) is catalog DATA (`unitDefault: null`), fixed by a
  correction or migration — **out of scope**; the measuring hint cannot fire for them until V1-34 gives
  them a declaration, which is the honest result.
- **V1-33** (non-mass sets can't be edited) — **out of scope**, sequenced after this.

## Risks / rollback

- Renaming `weightInputLabel` touches every locator that uses it. Mass output is byte-identical, so a
  missed locator fails loudly in CI, not silently.
- A BW-only row disappearing on a Measuring switch could surprise; mitigated by the summary line, and it
  only ever drops a row with no number.
- Rollback: revert the PR; no schema or data change in either part.

## Out-of-scope / deferred

V1-33 (edit non-mass), V1-34 (catalog unit defaults), V1-35 (ambiguous duplicate names), a server-side
per-dimension blank message (the client copy covers the reachable path; the server stays neutral).

## Open questions

1. **History wording (30b-ii):** spell `m`, `yd`, `ft`, `in`, `cm` as words (`20 metres`, `30 inches`)
   and keep `lb`/`kg`/`sec`/`min` as codes — or spell everything? Recommendation: the split above; `in`
   is the only genuinely misleading code, and changing `lb` would churn the bodyweight receipt for no gain.
2. **Caps (30b-ii):** are the per-unit ceilings in the table right for your athletes? They are sanity
   bounds only, never prescriptions.

## Review-response log (adversarial panel)

_Empty — the engineering panel (correctness, scope, architecture, reuse) and the UX panel (interaction,
a11y at 360px, trust/data-entry) run on this draft next._
