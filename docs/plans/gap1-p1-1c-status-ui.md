# GAP-1 P1-1c — the UI for skipped movements and sub-failure sets

> Backlog: [plan.md](../plan.md) row **GAP-1** · analysis: [csv-recording-gaps.md](../csv-recording-gaps.md) §P1-1.
> Branch: `feat/gap1-p11c-status-ui`. **PR 4 of 4** closing P1-1: #99 (input) → [1a — skipped
> write](./gap1-p1-1a-skipped-write.md) → [1b — sub-failure write](./gap1-p1-1b-subfailure-write.md) →
> **this = the affordances + the read badges**. **No migration, no schema change** — 1a and 1b shipped
> the whole write path; this PR only makes it reachable by a human.
> **First UI PR of the four → owes tri-viewport screenshots.**

## Goal

Make the two statuses reachable from the form, and visible in the day's log:

- a **Skipped** checkbox on a movement card → submits `status: 'skipped'` with `sets: []`;
- a **sub-failure** toggle per set row → submits `status: 'sub_failure'` on that set;
- the day's log renders a set-level status badge (the entry-level one already renders).

And close **BUG-2(b)**, which this PR is the first to make reachable.

## Acceptance

- Checking **Skipped** hides that card's set rows and the add-set control, and the submitted payload
  carries `status: 'skipped'` with `sets: []`.
- **Unchecking restores the typed sets** — preserved in component state, never cleared (superseded-plan
  Open Q2, answered: re-typing on a gym floor is the expensive operation).
- A set row can be marked sub-failure; the payload carries `status: 'sub_failure'` on **that set only**,
  and its `reps` is still required.
- The day's log shows a set's non-`done` status, humanized (`sub-failure`, not `sub_failure`). A `done`
  set renders **byte-identically to today**.
- **BUG-2(b), both directions:** a card is not silently dropped when it carries **either** a movement
  status **or** a set status — it validates and shows `Movement N: Enter a movement.`
- Un-checking Skipped on a blank card makes it droppable **again** (a mis-tap must not wedge the form).
- The existing `done` flow is unchanged: an untouched card still drops, a normal movement still logs.

## Decisions

**D1 — Status lives in form state as the WIRE value, not a boolean.** `MovementVals` gains
`status?: MovementStatus`, `SetVals` gains `status?: SetStatus`. A `skipped: boolean` would need mapping
in two directions at the payload seam and would drift from the schema the moment a third status appears.
The payload spreads it exactly as 1a/1b's writers do — **absent stays absent**.

**D2 — Skipped CONDITIONALLY RENDERS the set rows away; state keeps them.** Not a CSS hide:
`SetRepsWeightFields` marks both inputs `required`, so rows left in the tree would block the native
submit with _"An invalid form control is not focusable"_ — **no visible error, form looks dead.** The
payload emits `sets: []`, but `movement.sets` in `StrengthFormBody`'s state is untouched, so unchecking
re-renders the same values. This works because the inputs are **controlled off parent-owned state** —
unmounting discards DOM only.

**D3 — BUG-2(b): a status is a typed field, at BOTH levels.** `isUntouchedMovement` is today
`movementName.trim() === '' && sets.every(blank)`, and **`[].every(...)` is vacuously true**, so a
skipped card with a blank name is silently discarded. But the identical argument applies to a **set**
status: tapping Sub-failure on a spare card and submitting would drop it just as silently. Both levels
are fixed here, or this PR ships BUG-2(b) in the other direction while claiming to close it.

**D4 — Compare a status to its DEFAULT, never to `undefined`.** `(m.status ?? done) !== done`, and the
toggle sets `status: undefined` on uncheck. Presence-checking would leave a mis-tapped-then-undone blank
card permanently un-droppable, wedging submit behind `Movement 3: Enter a movement.` with Remove as the
only escape.

**D5 — A skipped movement KEEPS its superset tags.** `dissolveSmallSupersets` counts membership, not
sets, and the schema's ≥2-member check does the same — so a zero-set skipped member parses clean today.
That is the right behaviour: **a skipped member is still part of the group the athlete programmed**, and
the log should show the pairing with one side skipped. Rejected: stripping tags on skip, which would
require re-running `dissolveSmallSupersets` from the toggle handler (only `removeMovement` does today) or
the surviving partner hits the ≥2 refine alone and submit dies with an unrecoverable-looking error
caused by a skip tap. Pinned by a schema test and a payload test rather than left to fall out.

**D6 — The badge is a SIBLING of the read line, and its label lives in `packages/shared`.**
`formatSetLine` stays unchanged (1b's S8, pinned by a test) — a status is a distinct visual affordance,
and appending `(sub-failure)` would leak an un-styleable blob into any future `aria-label`.
`ENTRY_STATUS_LABELS` goes in `packages/shared/src/enums.ts` beside the statuses, **not** app-local:
1b's S3 pins `sub-failure` as the **CSV export byte**, so V1-13 needs the identical string, and the
sibling label maps (`DAY_ROLE_LABELS`, `SESSION_TYPE_LABELS`) already live there. Applied to the
**entry** badge too — `page.tsx` renders `{entry.status}` raw today, and shipping a humanized set badge
beside a raw `skipped` on the same screen is the drift this PR would be introducing.

**D7 — One toggle idiom, a checkbox wrapped in its label, at both levels.** `e2e/a11y.spec.ts` runs
zero-tolerance axe **plus** a bespoke 44px tap-target measurement that reports `no bound <label> to act
as its tap target` for an `aria-label`-only checkbox — so the obvious version fails a real CI check. The
existing superset toggle is already this shape. The set-level accessible name must be **unique per set**
(five controls all named "Sub-failure" are indistinguishable in a screen-reader forms list) and the
visible text must be a **substring** of it (WCAG 2.5.3) — the existing superset checkbox violates that
second rule; don't copy it forward.

**D8 — The set row becomes two explicit lines, not wrap-luck.** At 360px the usable width is ~296px
(`main px-4` + `fieldset px-4`), and line 1 already consumes ~262px. Adding a control relies on flex-wrap
landing well. Specify it: line 1 = index + reps × load; line 2 = chips + sub-failure + remove.

**Rejected.** (a) **Clearing sets on skip** — D2. (b) **Rendering the badge inside `formatSetLine`** — D6.

## File-by-file changes

| Path                                                         | Change  | What & why                                                                                                                                                                                                                                     |
| ------------------------------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/enums.ts`                               | EDIT    | `ENTRY_STATUS_LABELS`, keyed off `ENTRY_STATUS` members (D6) — the CSV byte and the badge share one string                                                                                                                                     |
| `apps/web/app/p/[profileId]/strength-form.tsx`               | EDIT    | `MovementVals.status` + `SetVals.status`; Skipped checkbox; per-set toggle; **widen `onSet`'s patch type** (it is `Pick<…,'reps'\|'weight'>` today and cannot carry a status); payload emits `sets: []` when skipped and spreads both statuses |
| `apps/web/app/p/[profileId]/strength-form-supersets.ts`      | EDIT    | **BUG-2(b)** — `MovementDraft` gains a movement `status` **and** a set `status`; `isUntouchedMovement` compares both to the default (D3/D4)                                                                                                    |
| `apps/web/app/p/[profileId]/page.tsx`                        | EDIT    | set badge beside the read line; apply `ENTRY_STATUS_LABELS` to the **entry** badge too (D6); read `<li>` gets `flex flex-wrap items-baseline gap-2` so a long load + badge doesn't overflow at 360                                             |
| `apps/web/app/p/[profileId]/strength-form.test.tsx`          | **NEW** | RTL + jsdom (precedent: `components/profiles/profile-tile.test.tsx`). The **only** place the payload-shape and state-preservation criteria are testable — asserts the serialized `input[name="movements"]` JSON                                |
| `apps/web/app/p/[profileId]/strength-form-supersets.test.ts` | EDIT    | BUG-2(b) regressions, both levels + the uncheck-restores-droppable case                                                                                                                                                                        |
| `apps/web/app/p/[profileId]/strength-session-schema.test.ts` | EDIT    | pin D5 — a skipped, zero-set movement carrying superset tags parses                                                                                                                                                                            |
| `apps/web/app/p/[profileId]/set-display.test.ts`             | EDIT    | the label map                                                                                                                                                                                                                                  |
| `docs/plan.md` · `docs/status.md`                            | EDIT    | GAP-1 P1-1 complete; BUG-2 fully closed                                                                                                                                                                                                        |

**Not touched:** every schema, writer, DAL and migration (1a/1b shipped them) · `formatSetLine` (D6) ·
**`editable-set.tsx`** — `isEditableSet` now requires `status === 'done'`, so `<EditableSet>` can never
receive a non-`done` set and can never render a badge. The read-only `<li>` branch is the only place a
set badge can appear.

## Test plan

- **`isUntouchedMovement`:** a skipped card with a blank name is **not** untouched; a card whose only
  input is a **set** status is **not** untouched; check-then-uncheck returns it to droppable; an
  ordinary blank card still drops; a named card still doesn't.
- **`strength-form.test.tsx`** (the R1 gate): render, check Skipped → the hidden `movements` JSON carries
  `status:'skipped'` **and** `sets: []`; an ordinary movement emits **no** `status` key; type reps →
  check → uncheck → the JSON still carries the typed reps (state preservation).
- **Schema:** a skipped zero-set movement with `supersetClientId`/`supersetOrder` parses (D5).
- **Label map:** `sub_failure` → `sub-failure`; `done` has no badge.
- **Screenshots (required, tri-viewport ~390 / 820 / 1280):** a **3-set** card with one set marked
  sub-failure and one `band` chip active (the crowded case, not a 1-set card); a card with Skipped
  checked; the day's log showing both badges. Eyeball 360px in devtools.
- Regression: full unit suite + typecheck. `db:verify` untouched (no writer change).

## Risks / rollback

- **R1 — the payload seam is where a status silently goes missing.** The class that made #98's `dayRole`
  inert. Gated by asserting the **serialized JSON**, not React state.
- **R2 — order of operations.** `sets: []` must be produced in the serialization `.map`, **after**
  `dropUntouchedMovements`. Emptying `sets` earlier (e.g. in the toggle handler) makes a skipped
  blank-name card `name:'' + sets:[]` → vacuously untouched → dropped again, reopening the exact bug D3
  closes, with the D3 fix in place and looking correct.
- **R3 — new read markup gets no automated a11y coverage.** The seeded Today page has no skipped or
  sub-failure rows, so axe never scans the badge. Accepted for this PR and recorded here; seeding an
  e2e fixture is the follow-up.
- **R4 — `key={gen}` remount** clears statuses along with everything else after a successful log. Correct,
  but stated so it isn't rediscovered as a bug.
- **Rollback:** revert. No migration; rows written before a revert still read correctly.

## Out of scope

Editing or un-skipping an already-logged movement (**V1-9b**) · clearing a `sub_failure` after the fact
(V1-9b) · the CSV export (**V1-13**) · `prescribed` (P1-2) · bodyweight `context` (P1-3) · extracting a
`SetRow` component (`MovementCard` reaches ~15 props — a separate refactor).

## Review-response log (single-pass panel)

| #      | Lens                   | Critique → resolution                                                                                                                                                                                                                                            |
| ------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B1** | correctness (BLOCKING) | The `isUntouchedMovement` fix was **half a fix** — a card whose only input is a SET status would still be silently dropped, shipping BUG-2(b) in the other direction. → **Accepted: D3** covers both levels.                                                     |
| **B2** | correctness (BLOCKING) | Skipped × superset was **unspecified**, and the pipeline silently accepts an incoherent group (verified: `dissolveSmallSupersets` counts membership, and the schema's ≥2 check does too). → **Accepted: D5**, keep tags, pinned by tests.                        |
| **B3** | scope (BLOCKING)       | No component test file, so two acceptance criteria and both risks were **untestable** — the same omission class as 1a's missing `SetDTO` and 1b's missing DAL row. → **Accepted:** `strength-form.test.tsx` added; RTL+jsdom already available with a precedent. |
| C3     | correctness            | "Hides" was ambiguous; CSS-hiding `required` inputs blocks submit with an invisible browser error. → **Accepted: D2** says conditionally rendered.                                                                                                               |
| C6     | correctness            | `onSet`'s patch type is `Pick<…,'reps'\|'weight'>` and cannot carry a status — invisible in a "UI-only" table. → **Accepted:** called out in the table.                                                                                                          |
| C7     | correctness            | Uncheck must restore **droppable**, or a mis-tap wedges the form. → **Accepted: D4** (compare to default, set `undefined` on uncheck).                                                                                                                           |
| S1     | simplicity             | `editable-set.tsx` is **dead code** for this PR — 1b's `isEditableSet` excludes every non-`done` set. → **Accepted:** row removed, prop-drilling avoided.                                                                                                        |
| S2     | code reuse             | The label map belongs in `packages/shared`, not app-local — 1b/S3 pins `sub-failure` as the CSV byte, so an app-local map guarantees V1-13 re-types it. → **Accepted: D6**.                                                                                      |
| A1     | a11y (CI-detectable)   | An `aria-label`-only checkbox **fails** `e2e/a11y.spec.ts`'s 44px bound-label assertion; names must be unique per set and satisfy WCAG 2.5.3. → **Accepted: D7**.                                                                                                |
| A2     | responsive             | The 360px row is already at ~262/296px; a new control relied on wrap luck. → **Accepted: D8** (two explicit lines).                                                                                                                                              |
| A4     | a11y                   | Nothing announces the set rows disappearing — reads as "did I break it?" and is silent to a screen reader. → **Accepted:** a static "no sets will be logged" line replaces the list.                                                                             |
| A5     | consistency            | The entry badge renders the raw enum; a humanized set badge beside it would be visible drift. → **Accepted: D6** applies the map to both.                                                                                                                        |
| A3     | screenshots            | A 1-set card hides the crowding the new control causes. → **Accepted:** the screenshot spec requires a 3-set card with a chip active.                                                                                                                            |
| A6     | a11y coverage          | New read markup isn't axe-scanned, since the seed has no such rows. → **Accepted as a known gap: R3**, with seeding as the follow-up rather than scope creep here.                                                                                               |
| S4     | simplicity             | A rejected-alternatives entry argued with a strawman nobody proposed. → **Accepted:** trimmed.                                                                                                                                                                   |
