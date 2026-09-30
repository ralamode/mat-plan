# V1-26 — the form knows the movement, and a wrong set is correctable

> Backlog: [plan.md](../plan.md) rows **V1-24** (both P0s) and **V1-25 §2**.
> **Rewritten after two panels. Both found the same blocking flaw, and the UX panel found that my
> headline fix did nothing for the incident it was written about.** Log at the end.

## Goal

Stop the failure that produced the first real data loss. On 2026-09-28 Liam's KB swings were logged
`20 × BW` when the session was `10 reps × 20 lb`, and **the app could not fix it** — corrected out of
band by [`db:correct`](../../packages/db/scripts/corrections/README.md) (#162), a treatment rather
than a cure.

## What the panels changed, before anything else

**My fix for Bug 1 was inert for the actual incident.** `KB Swings` is seeded `isBodyweight: false`,
and `emptySet()` already produces `isBodyweight: undefined` — **the chip was already off.** The
incident happened because someone _tapped BW on a loaded movement_, and under my plan they still
could, silently. I had written a no-op into the acceptance criteria as a passing test.

**And pre-selecting BW would have re-opened V1-19's submit wedge** — found independently by both
panels. `isUntouchedScaffold` requires `!s.isBodyweight` (a predicate **I added in GAP-3 PR 4a**), so
a scaffolded bodyweight card seeded `isBodyweight: true` is **permanently "touched"**, survives
`dropUntouchedMovements`, and blocks submit on a collapsed card whose `required` reps input is
unmounted — the "form appears dead" trap this repo documents twice. Doing 5 of 7 programmed movements
would have been unsubmittable.

## Split — PR-A and PR-B, and they are independent

My stated reason for combining them was **factually wrong**: I claimed both touch
`strength-form.tsx`. Bug 2 touches `set-display.ts`, `editable-set.tsx`, `actions.ts`,
`shared/strength.ts`, `strength-session.ts` — and **not** the form. They share a narrative, not a
file. Combined estimate was 600–900 lines across ~14 files.

### PR-A — the form carries the movement's declaration (~150 lines, ships first)

**Carried by the UNIT, not a pre-tapped BW chip.** The panel's best idea: `scaffoldMovements`
currently hardcodes `DEFAULT_BODYWEIGHT_UNIT` for every card. Seeding the movement's **`unitDefault`**
instead is something the athlete can _see_ in the Unit select and override — self-explaining, and it
sidesteps the invisible-state problem entirely. It also fixes the half of V1-24's second P0 that my
plan left untouched.

**Plus a soft warning on the real failure:** tapping BW on a movement the catalog declares **loaded**
surfaces an inline, non-blocking note next to the chip — _"KB Swings is usually logged with a
weight."_ Not a lockout; the athlete may be right. But the 2026-09-28 tap now says something.

**No BW pre-selection, and no auto-clear.** Both are dropped:

- Pre-selection re-opens the submit wedge (above).
- Auto-clear is a control changing state **off-screen under the keyboard**, announcing nothing to a
  screen reader (the checkbox is `sr-only`) — and it makes `BW+8 (vest)` unmaintainable: backspacing
  a typo in the weight destroys the mode. Leaving BW on has **no** data-loss failure
  (`formatSetLine` renders `8 × BW +10 lb` truthfully); clearing it silently converts a weighted
  push-up to `8 × 10 lb`, which is the KB incident mirrored.

Plumbing, named because I priced it at zero: `programDayRows` select (+2 cols, the `movements` join
exists) → `ProgramDayRow` → `toProgramDay` → `ProgramDayDTO` → `ScaffoldRow` → `scaffoldMovements`.
`ScaffoldRow`'s docblock says its narrowness is deliberate and "a future post-GAP-3 load chip widens
[it] deliberately" — this is that, and the widening is **structure, not prescription** (the same
distinction V1-23 drew for `DEFAULT_SCAFFOLD_SETS`).

**All four quadrants**, since my table had two rows and covered neither real case:

| `isBodyweight` | `unitDefault`         | Unit select seeds | BW chip                 |
| -------------- | --------------------- | ----------------- | ----------------------- |
| `true`         | `null` (push-ups)     | household default | off, no warning         |
| `false`        | `'lb'` (KB swings)    | **`lb`**          | off; **warn if tapped** |
| `false`        | `null` (Pallof press) | household default | off, no warning         |
| `true`         | non-null              | the declared unit | off, no warning         |

### PR-B — a wrong set is correctable: **remove + undo**, not edit-the-mode

**Option B, not A.** Both panels landed here, and the engineering trace is decisive: **option A cannot
work as a WHERE widening.** A bodyweight set has **no quantity row at all**, so
`updateStrengthSetById` would `UPDATE` zero rows and **silently return success with no load written**.
Creating one needs `slot`/`unit`/`dimension`/`client_id`, and **the unit lives on the parent
`entries` row**, not the set — so if that entry is `sec` or `in`, inserting a mass violates the
composite FK and 500s, rolling back the transaction.

The UX argument agrees from the other side: a parent seeing `20 × BW` thinks _"get rid of it"_, not
_"open the editor and change the load mode"_. And **A fixes one wrong thing** — wrong movement, wrong
set count, duplicate log, logged on the wrong kid are all gym-floor-plausible and none are
recoverable. B fixes the class.

**B is also cheaper than I priced it.** Soft-delete's supposed problem does not bite: both readers
already filter through a live set (`entries.ts`, `export-month.ts`), and `uq_entry_sets_entry_idx` is
partial on `deleted_at IS NULL`, so the `idx` slot frees. Cost: one guarded writer mirroring
`updateStrengthSetById`'s ownership WHERE, one action, one affordance — and soft-delete the set's
quantity rows in the same transaction for hygiene.

**Inline undo, not a modal confirm** — the scaffold's undo pattern already exists, and a confirm
dialog on a phone mid-set is worse than an undo.

**V1-9's guard stays.** My justification for weakening it answered a **stale docblock**; the live
reason is in `set-display.ts` and the SQL: the guard excludes sets on _what they are_ — a `30 in` box
jump, a `20 sec` hold — because the edit form submits a bare number. GAP-3 did not invalidate that; it
re-derived it on firmer ground. B does not touch the guard at all, which is a further argument for it.

## Affordance parity — the finding that explains the incident

**Every set line gets the same control.** Today `8 × 20 lb` renders an Edit button and `8 × BW`
renders a plain `<li>` — no explanation, no learnable pattern, and `axe` cannot see a _missing_
control, so the gate is green on it.

> _"A user who is told why will stop hunting; a user shown nothing concludes the app is broken —
> which is what happened on 2026-09-28."_

Where a set is not correctable by the shipped path, render the control **disabled with an
`aria-describedby` reason**, never absent.

## Acceptance

**PR-A**

- A scaffolded `KB Swings` card seeds the Unit select to **`lb`**; a scaffolded push-up seeds the
  household default. All four quadrants have a test.
- Tapping BW on a catalog-declared-loaded movement shows the inline note; **it does not block**.
- **No set is pre-seeded `isBodyweight`** — asserted directly, because that is the submit-wedge
  regression, and all three untouched predicates keep working.
- Scaffolding 7 movements, filling 5, and submitting **succeeds** (the wedge, as an e2e).
- Renaming a scaffolded card clears the carried declaration — it was derived from a name that is gone.

**PR-B**

- A `20 × BW` set can be **removed** through the UI, with undo — the 2026-09-28 case, as an e2e.
- Every set line carries a control; unavailable ones are **disabled with a reason**, not absent.
- Removing a set soft-deletes its quantity rows in the same transaction.
- Ownership: wrong-profile remove → no rows, typed error. Boundary tests per AGENTS.md.
- The `isEditableSet` ⟷ SQL contract becomes a **CI gate**: one shared fixture list of set shapes with
  an expected `editable`, asserted against `isEditableSet` in a unit test **and** against the real
  writer in `db:verify`. One list, two consumers — the `weeklyAdherenceRows` pattern. Prose mirroring
  is what let these two drift.
- An e2e that **opens the corrector at 360px** and runs axe + tap targets + overflow. No test has ever
  clicked Edit.

## Also, in whichever PR touches them

- **Fix the stale docblock** at `shared/strength.ts` that still justifies the edit guard by
  `weight_label` masking — a column GAP-3 deleted.
- **Extract `assertSomeLoad`** so "a set must carry SOME load" is one exported refine rather than
  living only on `strengthSetSchema`. Any widening of the edit path would otherwise reopen `5 × ?`.
- **`editStrengthSetAction` has NO day bound** — it never calls `resolveDeclaredDay`. My claim that
  this work "keeps the ±1 write-bound" was false. Either add the check or drop the claim; PR-B should
  add it, because a remove is destructive.

## Out of scope, explicitly

- **A non-`done` set stays uncorrectable** (`sub_failure` BW). Not the 2026-09-28 case; named so the
  guide's "uncorrectable" trap is not claimed closed when it is not.
- **A hand-typed movement never resolves to the catalog**, and `findOrCreateMovementId` hard-codes
  `isBodyweight: false` — so every athlete-created movement is born declaring "not bodyweight",
  regardless of truth. Belongs in tech-debt with the picker.
- V1-25 §1 and §3; V1-24's full reframe.

## Review-response log

Two panels (UX — required for UI — and engineering), run before implementation.

### Blocking — all accepted

| Finding                                                                                                                                                                                                                       | Response                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Both panels: pre-selecting BW re-opens V1-19's submit wedge** via `isUntouchedScaffold`, a predicate I added in GAP-3 PR 4a. 5-of-7 movements would be unsubmittable, with an invisible error on a collapsed card.          | **Accepted — pre-selection dropped entirely.** The declaration rides the **unit** instead, which is visible and overridable. |
| **UX: Bug 1's fix was INERT for the incident.** KB Swings is already `isBodyweight: false` and the chip already starts off; I codified a no-op as a passing acceptance criterion.                                             | **Accepted.** The real failure is _tapping BW on a loaded movement_, so PR-A adds an inline warning on exactly that.         |
| **Eng: option A cannot work as a WHERE widening** — a BW set has no quantity row, so the update writes nothing and silently succeeds; and the unit lives on the parent entry, so a `sec`/`in` entry 500s on the composite FK. | **Accepted — switched to option B.**                                                                                         |
| **Eng: widening the edit schema reopens "a set with no load"** — the refine lives only on `strengthSetSchema`.                                                                                                                | **Accepted;** moot under B, and `assertSomeLoad` is extracted regardless.                                                    |
| **UX: option A's edit row is ~586px at 296px available**, and no test has ever clicked Edit.                                                                                                                                  | **Accepted;** moot under B, and the 360px corrector e2e is now an acceptance criterion.                                      |

### Major — accepted

- **My reason for combining the two P0s was factually wrong** — they share no file. Split into PR-A
  and PR-B, independent.
- **My "GAP-3 invalidated V1-9's guard" argument answered a stale docblock**; the live reason is the
  dimension one. The guard stays, and the stale docblock gets fixed.
- **"It keeps the ±1 write-bound" was false** — `editStrengthSetAction` never calls
  `resolveDeclaredDay`. PR-B adds it.
- **"Scaffolded cards carry the declaration" was not true** and is a five-layer change I priced at
  zero. Files named.
- **Affordance parity** — a missing control is worse than a disabled one, and `axe` cannot see it.
  This is the finding that explains the incident.
- **The identical-predicate contract becomes a CI gate** (shared fixture list, two consumers) instead
  of mirrored prose.
- **The decision table had a hole** — `isBodyweight: false` + `unitDefault: null` (Pallof press). All
  four quadrants now specified.
- **The progress counter would read 3/3 on an untouched card** — same root cause as the wedge, fixed
  by dropping pre-selection.
- **Auto-clear dropped** — invisible under the keyboard, silent to a screen reader, and it makes
  `BW+8 (vest)` unmaintainable.
- **Renaming a scaffolded card must clear the carried declaration.**
