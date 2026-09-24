# GAP-3 PR 4 — the typed log form

> Backlog: [plan.md](../plan.md) row GAP-3, the last step of the arc
> ([gap3-typed-measurements.md §7.7](./gap3-typed-measurements.md)). Branch:
> `feat/gap3-pr4-typed-log-form`. Follows [PR 3](./gap3-pr3-entry-set-quantities.md) (#139).

## Goal

#139 built the typed model and deleted the free-text load, but the **form** still submits one text
string that `parseLoad` reverse-engineers. Two things follow from that, and this PR fixes both:

1. **A regression I knowingly shipped in #139.** `BW+8 (vest)`, `BW (unassisted)`, `15/DB` and
   `30 (2x 15 DB)` used to store as text and are now **rejected outright** — there is no column for
   them and no control to express them. `BW+8 (vest)` is a real YDP shape on four movements.
2. **The numeric keypad is still gone.** GAP-1 P0-2 traded `inputMode="decimal"` for
   `inputMode="text"` so `BW` could be typed at all — on iOS the decimal pad has no letters. With
   `BW` becoming a _toggle_, the weight field goes back to being a number and the keypad returns for
   the ~90% case.

**The form stops describing a load in prose and starts naming its parts.** That is the whole PR.

## The problem this has to solve, stated honestly

§7.2c flagged this as the hard part and it still is: **how does a 360px row express a set with three
worn loads without putting a "slot" concept in front of a ten-year-old on a gym floor?**

The clean answer — movements declare their slots, the form draws exactly those fields — **needs
V1-22, which does not exist.** So this PR takes the escape hatch its predecessor named: **a movement
declaring no slots renders exactly today's single field**, and an auxiliary load is something the
athlete _adds_ on the rare set that needs one. When V1-22 lands, declared slots pre-render those same
rows and the add-affordance becomes the exception rather than the route.

**Measured against the real constraint** (AGENTS.md: a phone, on a gym floor, sometimes a kid): the
common set must cost **zero extra taps** versus today. A back squat is still `reps × weight`. Nothing
below may regress that, and that is the first thing the UX panel should try to break.

## Proposed shape

**Layout at 360px.** Usable width is ~296px (`main px-4` + `fieldset px-4`); today's line 1 is ~262px,
which is why the existing card already splits into two explicit lines rather than trusting flex-wrap.

```
┌ Movement 1 ─────────────────────────────┐
│ Name  [ Back squat            ]         │
│ Unit  [ lb ▾ ]          ← already exists│
│ Sets                                    │
│  1  [ 5 ] × [ 185 ]      ← numeric,     │
│     [BW] [band] [+ load]    keypad back │
│     [ ] Sub-failure   [Remove]          │
└─────────────────────────────────────────┘
```

With an auxiliary load added (the `BW+8 (vest)` case):

```
│  1  [ 8 ] × [     ]   ← empty: BW is the load
│     [BW▪] [band] [+ load]
│     └ [ vest ▾ ] [ 8 ] lb   [×]
│     [ ] Sub-failure   [Remove]
```

**Four changes, and no more:**

| #   | Change                                             | Why                                                                                                                                                                                                     |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `set-fields.tsx` loses `mode: 'numeric' \| 'load'` | The prop exists ONLY to support text loads (§7.4). The weight input is numeric again everywhere — `inputMode="decimal"`, `min=0`, `step=0.5` — so log and edit stop diverging.                          |
| 2   | `load-chips.tsx` → `set-mode-toggles.tsx`          | The chips survive as CONTROLS but stop writing strings. `aria-pressed` toggles that set `isBodyweight`/`isBand` booleans. The ergonomic argument for one-tap is untouched; the storage is what changes. |
| 3   | A collapsed auxiliary-load row behind `+ load`     | Restores `BW+8 (vest)`. Hidden by default → zero cost to the common set. Slot select is `vest`/`ankle`/`wrist`/`distance` from `QUANTITY_SLOT_CODES`, never free text.                                  |
| 4   | The movement unit select widens                    | Today it is `lb`/`kg` (`BODYWEIGHT_UNITS`). A box jump's `30in` and a hold's `20s` are PRIMARY quantities, so they need `in`/`cm`/`ft`/`sec`/`min` here or they are unloggable.                         |

### The wire changes shape, and `parseLoad`'s log branch retires

Today the form sends `{ reps, weight: string }` and `parseLoad` infers structure from prose. The form
already knows the structure — it has the toggles and the selects — so it should **send** it:

```ts
// SetVals (form state) and the wire, together
{ key, reps: string, weight: string, isBodyweight: boolean, isBand: boolean,
  aux: { key, slot: QuantitySlot, value: string, unit: Unit }[], status?: SetStatus }
```

`strengthSetSchema` validates that directly. **`parseLoad` is NOT deleted** — its
`PRESCRIPTION_SHAPE` guard (`~90`, `12-15`) and its `SKIPPED` refusal are load-bearing for V1-19's
prefill and stay as the guard on any _text_ that still reaches a numeric field. What retires is its
role as the log path's structure-inference engine.

**This is a shrinking of the trust surface, not a widening:** a number field plus two booleans plus a
closed slot vocabulary cannot express `seventy five pounds`, and the boundary no longer has to
recognise it in order to reject it.

## Acceptance

- A plain `reps × weight` set takes **the same number of taps as today**, with the numeric keypad.
- `BW` and `band` are one tap each and write booleans.
- `BW+8 (vest)` is loggable again — the regression #139 shipped is closed.
- A box jump (`30in`) and a hold (`20s`) are loggable via the movement unit select.
- Every control ≥44px, labeled, keyboard-reachable; the card works at **360px** with no horizontal
  scroll — verified by the existing a11y e2e specs, which already assert the tap-target bar on the
  strength form in both collapsed and scaffolded states.
- `pnpm verify` + `pnpm e2e:local` green; screenshots at mobile/tablet/desktop attached to the PR.

## File-by-file changes

| Path                                           | Change | What & why                                                                                          |
| ---------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------- |
| `apps/web/app/p/[profileId]/set-fields.tsx`    | EDIT   | Drop the `mode` prop and the text branch; weight is numeric everywhere.                             |
| `apps/web/app/p/[profileId]/load-chips.tsx`    | RENAME | → `set-mode-toggles.tsx`. Boolean toggles, not string writers.                                      |
| `apps/web/app/p/[profileId]/aux-load-row.tsx`  | NEW    | The collapsed auxiliary-load row: slot select + numeric value + unit + remove.                      |
| `apps/web/app/p/[profileId]/strength-form.tsx` | EDIT   | `SetVals` gains the flags + `aux`; the set row renders 2–3 lines; `+ load` handler.                 |
| `packages/shared/src/strength.ts`              | EDIT   | `strengthSetSchema` takes the structured shape. `parseLoad` keeps its guards, loses the log role.   |
| `packages/shared/src/strength-session.ts`      | EDIT   | `unit` widens from `BODYWEIGHT_UNITS` to a new `LOGGABLE_UNITS` (mass + length + time).             |
| `packages/shared/src/units.ts`                 | EDIT   | `LOGGABLE_UNITS` — the units a movement may be logged in, excluding `bool`/`timing`/`count`.        |
| `packages/db/src/writers/strength-session.ts`  | EDIT   | Write the aux quantities alongside the primary (the loop already exists; it gains the aux rows).    |
| `apps/web/app/p/[profileId]/*.test.ts(x)`      | EDIT   | Schema + form tests for the new shape; the aux round-trip.                                          |
| `packages/db/scripts/verify.ts`                | EDIT   | A `BW+8 (vest)` round-trip **through the real writer** — #139 proved the table, not the write path. |
| `apps/web/e2e/`                                | EDIT   | Extend the strength-form a11y spec to the expanded aux state.                                       |
| `docs/status.md`, `docs/plan.md`               | EDIT   | Status rides with the work.                                                                         |

## Risks

| Risk                                                                                        | Mitigation                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The common set gets slower.** Three controls added to a row that already splits at 360px. | `+ load` is collapsed; the toggles replace chips 1:1 in the same slot. Net new chrome on a plain set: **one button**. The UX panel should verify this claim against the real widths, not accept it. |
| **The unit select becomes a trap** — a kid picks `sec` for a squat.                         | It is movement-level and sticky, not per-set, and defaults to the household mass unit. Still the weakest part of the design; the panel should attack it.                                            |
| **`aux` widens the wire**, and every Server Action is a public endpoint.                    | Slot is a zod enum over `QUANTITY_SLOT_CODES`; value is numeric and non-negative; the composite FK is the backstop even if the boundary is wrong.                                                   |
| A `distance` aux on a mass movement is expressible and nonsensical.                         | The composite FK permits it (`distance`+`length` is a legal pair). Writer-enforced only. Acceptable — it is a _weird_ log, not a corrupt one.                                                       |

## Out-of-scope

- **V1-22's movement-declared slot sets.** This PR's add-affordance is the interim; declared slots
  pre-render the same rows later. Nothing here has to change when that lands.
- **`BW (unassisted)` / `30 (2x 15 DB)`** — qualitative prose, not quantities. They belong in
  `entries.notes` via **V1-9a**, and stay rejected until then. Stated so it is not mistaken for done.
- The no-vest/not-logged ambiguity — still V1-22's (see #139).

## Open questions

1. Should the unit select be **movement-level** (proposed, sticky, fewer taps) or **per-set** (a
   sled's mass and distance differ within one set)? The aux row carries its own unit either way.
2. Does `distance` belong in the aux slot list at all, given a sled push is the only case and the
   movement's PRIMARY could be the mass with distance aux — or is that backwards?

## Review-response log

Three lenses ran 2026-09-23 **before implementation**: two UX (interaction/first-run · a11y/responsive,
both REQUIRED by AGENTS.md on a UI PR) and one combined engineering lens. All three did width
arithmetic or read the a11y gate rather than taking the plan's claims on faith.

### Blocking — all accepted

| Finding                                                                                                                                                                                                                    | Response                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **All three: `required` on the weight input makes a BW set unsubmittable**, silently — the trap `strength-form.tsx:450-453` already documents twice. It works today only because the chip WRITES `BW` into the field.      | **Accepted.** `required` comes off; set validity moves to a `superRefine` — reps AND (weight OR isBodyweight OR isBand OR aux) — surfaced through the existing per-movement `fieldErrors` path.                                                                        |
| **UX-interaction: a BW-only set is silently DELETED at submit.** `strength-form-supersets.ts:87` / `strength-form-scaffold.ts:96` gate "untouched" on `reps==='' && weight===''`. Neither file was in my plan.             | **Accepted.** Both predicates extend to the flags + aux; both files added to the file list; a unit test pins `{reps:'',weight:'',isBodyweight:true}` as NOT untouched.                                                                                                 |
| **All three: the 9-unit select is a trap** — off-screen behind the keyboard, raw 1-2 char codes adjacent on an iOS wheel, and UNRECOVERABLE (a `sec` squat gets no Edit button, and there is no delete action in the app). | **Accepted, redesigned.** Dimension-first: "What are we measuring? **Weight · Height · Time**" once per movement, then `unitsOfDimension()` renders 2-3 codes. A squat can no longer be logged in seconds. Default `mass` → the common movement costs zero extra taps. |

### Major — accepted

- **The aux row does not fit at 360px** (both UX lenses, independently: ~376px into 268px). Fixed by
  **cutting `distance` from the aux picker** — vest/ankle/wrist are mass-only, so the aux UNIT SELECT
  disappears entirely, and the slot `<select>` becomes three chips. Row lands at ~222px. This also
  answers my Open Question 2, which **m9 showed was already settled by #139** — distance is aux, the
  mass is primary. Question deleted.
- **Aux constraint violations arrive as raw 500s that discard the whole session** — no `try/catch` in
  the action, no `onConflict` on the quantity insert. Every guard moves to the boundary: max length,
  distinct-slot refine, `primary` excluded via a derived `AUX_SLOT_CODES`, non-negative bounded value,
  and `slotAcceptsDimension()` as a refinement.
- **`updateStrengthSetById` has no arity check** while `isEditableSet` requires `quantities.length===1`.
  Unreachable today; PR 4's aux row is the first writer that makes it reachable. A `NOT EXISTS
(non-primary live quantity)` clause lands in the same PR, with a boundary test.
- **`LOGGABLE_UNITS` as a hand-written third list is the drift the constants rule targets.** Derived
  instead: `QUANTITY_SLOT_DIMENSIONS_BY_CODE[QUANTITY_SLOT.primary].flatMap(unitsOfDimension)`.
- **A live `formatSetLine` echo under each set row** (UX M5) — one reused function that fixes three
  findings at once: it makes BW+weight read as legal, makes the unit visible at entry time, and makes a
  wrong unit catchable before submit instead of never.
- **Slot select → three chips; "+ load" → "+ worn weight"**; accessible names per set; focus moves to
  the new row on add and back to the button on remove.
- **My acceptance section claimed verification that does not exist.** `a11y.spec.ts` runs at **390px**,
  nothing asserts horizontal scroll, and `expectTapTargets` skips invisible controls — so a collapsed
  aux row would have passed all three existing scans vacuously. Replaced with concrete new assertions.

### Corrected — my errors

- **`parseLoad` is NOT load-bearing for V1-19.** Verified: the scaffold writes `weight: ''`
  structurally (`strength-form-scaffold.ts:63-67`) and never calls it. After this PR it has **zero
  production callers**. It is deleted in 4a, with its tests — a large, cheap-to-review deletion.
- **`BW+8 (vest)` is ONE census cell** (L3: 1 slot, 2 rows), not "four YDP movements" — I conflated it
  with the bodyweight-or-loaded count at §7.3.
- **#139 did prove the write path** (`verify.ts:1863-1975` drives the real writer). The actual gap is
  narrower: the multi-row aux write and the flag-plus-magnitude combination.

### Split — accepted

~900-1100 lines is well past the <400 target and mixes two risk profiles. **And the seam is not the
obvious one:** `30in`/`20s` are loggable TODAY only through the text field, so making the weight
numeric REMOVES that capability — the unit work must ship with it.

- **4a** — numeric weight + keypad · chips → boolean toggles · dimension-first unit · `parseLoad`
  deleted. ~350 lines, no new component, no array on the wire.
- **4b** — the aux row, carrying all the boundary hardening, the `updateStrengthSetById` arity fix, and
  the `verify.ts` aux proof as one coherent concern.

Cost: #139's `BW+8 (vest)` regression stays open one more PR. At one authored cell in the corpus, that
is the right price for a reviewable endpoint-hardening PR.
