# V1-19 — "Start today's program": scaffold the log form from the program

> Backlog: [plan.md](../plan.md) row **V1-19**. Branch: `feat/v1-19-scaffold-impl`. **SHIPPED** — the
> plan merged first (#124); this records what was built against it.
> Upstream analysis: [logging-speed-brainstorm.md](./logging-speed-brainstorm.md) (idea **A**, ranked the
> single biggest win available). Related: [v1-10-2-strength-prefill.md](./v1-10-2-strength-prefill.md)
> (the panel that rejected load prefill — its boundary is preserved here, enforced more precisely).

## Goal

Logging a programmed strength session currently means reading the movement names off the "Today's
program" card and **retyping every one of them** into the form directly below it, then tapping "Add set"
once per set — on a phone, between sets, one-handed. Ray's real Strength B day is **7 movements, 25
sets ≈ 60+ interactions**, and `autoComplete="off"` (`strength-form.tsx:406`) means the browser offers
no help. This is the app's single worst interaction and the only screen where the product loses to
typing a line into a notes app ([product-spec §12](../product-spec.md)).

One tap builds the form from the program the card is already displaying: a movement card per
prescription, in the coach's order, with the right number of set rows. **Structure only — every reps and
weight field arrives empty.** That boundary is the V1-10 panel's and this PR does not relax it in either
direction. This is also the change that makes the product's first success criterion — _an athlete logs a
full day unassisted_ — realistically testable.

## Acceptance

**From plan.md, verbatim:**

> Tap "Start today's program" → the form is pre-built with the day's movements and blank set rows;
> typing only the numbers logs the session

**Done when:**

- A **"Fill in today's movements"** button appears when `programDay.length > 0` — **not** when a
  `day_role` merely resolves, since the weekday map returns a role on every Mon/Wed/Fri whether or not the
  household has a block (`page.tsx:141`). Absent, not disabled, when there is nothing to fill.
- Tapping it replaces the form's movements with one card per prescription, in the coach's `idx` order,
  each carrying the prescribed movement **name** and `sets` set rows.
- **Every reps and weight field is empty** after scaffolding. No authored value reaches any input.
- Scaffolded cards render **collapsed** — a disclosure row per movement with a `done/total` set counter,
  one expanded at a time — and collapsed set rows are **unmounted, not hidden**.
- A live region announces what happened, and focus moves to the first movement.
- **A scaffolded movement left untouched is dropped on submit**, exactly as a blank hand-added card is
  today — so doing 5 of 7 programmed movements submits without first tapping Skipped on the other 2.
- Submitting a scaffolded session writes the same rows as a hand-typed one — proven by the scaffolded
  movement names resolving to the **same `movements` rows** the prescriptions point at.
- Re-tap replaces immediately and offers **Undo**.
- The card (`program-reference.tsx`) still ships **zero client JS**, and the client never receives the
  prescribed `load` at all.

## Decisions

Each of these is a real fork; recording them so implementation is mechanical.

### D1 — The button lives in the form, not on the card

`ProgramReference` is a **server component** and its docblock calls that out deliberately ("ships zero
client JS"). A button that seeds form state must be client-side. Putting it on the card would drag the
card into `'use client'` and regress a stated property.

**So:** `page.tsx` already fetches `programDay` (`page.tsx:69`) and already passes `defaultDayRole` into
`StrengthForm` (`:143`). The rows ride the same seam. The button renders inside `StrengthFormBody`,
directly above the movement list — adjacent to the card visually, but client-side and owned by the form
that it mutates.

### D2 — Re-tap replaces immediately, with Undo

The backlog names this as the open question (replace / append / disabled). **Replace** — append produces
duplicate cards that double-log, and disabling strands an athlete who cleared the form by accident.

**Undo, not confirm** (UX panel). A confirm asks a 10-year-old a question whose consequence is invisible
("_what's_ typed? how much?"), puts two similar-width buttons adjacent at 360px with the destructive one
unlabelled, and costs a decision mid-session. Instead: replace, stash the previous `movements`, and render
in the live region — _"Program loaded — replaced the 2 movements you'd typed."_ **[Undo]**. Same tap count
on the common pristine path, one tap to recover, nothing to read between sets.

**The dirty check cannot use `isUntouchedMovement`** as the first draft assumed. That predicate requires
`movementName.trim() === ''` (`strength-form-supersets.ts:85`) and **every scaffolded card has a name**, so
it reports "dirty" always — the confirm would have fired on every re-tap including immediately after
scaffolding. Diff against the stashed scaffold output instead; "how many did you type" comes from counting
cards that differ from it.

### D3 — Structure only. Reps prefill is CUT, and loads stay out

An earlier draft of this plan put **reps prefill in scope**, arguing that the V1-10 panel's boundary was
about loads because "a wrong load is an injury, a wrong rep is a data bug." **That was a misreading of the
panel, and the panel is right.** Its actual holding
([v1-10-2](./v1-10-2-strength-prefill.md)) gives three reasons, and reason (2) is not about injury:

> (2) prefilling the `required` weight field **destroys the built-in confirm-gate** (a planned load logs
> as "performed" without an affirmative human entry — a data-integrity + injury-safety hole); (3)
> `target_reps` text ("8-12"/"40 yd"/"30-40 s"/"AMRAP") **can't be parsed to the numeric reps field
> without mis-logging.**

**The confirm-gate is a mechanism, not a load-specific rule: the blank `required` field IS the human
confirmation.** It applies to reps identically. Reason (3) is a direct, explicit rejection of the very
thing the draft proposed, from a panel that had already considered it.

Three further findings confirmed it:

- **Blast radius is far larger than claimed.** The draft cited "2 of 7" from Strength B. On **strength_a**,
  `PROGRAM_SEED` yields **5 of 7 prefilled for Liam** across ~20 sets — ~20 `required` fields arriving
  pre-filled with a _plan_ and submitting as _performed fact_ with zero keystrokes.
- **It creates a contradiction on exactly the set that matters.** `sub_failure` means the athlete fell
  short of the prescription — yet the reps field would still hold the prescribed number, one tap from
  submitting `reps = 5, status = sub_failure`. Unrecoverable through V1-9.
- It is **cleanly separable** and ~120 lines, so keeping it buys nothing but risk.

**So this PR scaffolds structure only.** Both reps and loads stay blank. The brainstorm's §4A already
says the structural scaffold is where ~90% of the interaction win lives; the remainder is not worth
reopening a settled safety boundary.

**Deferred, each needing its own argument:** a **prescribed-load chip** post-GAP-3 (ADR 0004 replaces
`weight_label` with typed columns, so building it now means building it twice) — note this is _not_ the
shipped `LoadChips` component (`strength-form.tsx:488`), which renders the canonical `BW`/`band` labels ·
and any reps assistance, which must answer the confirm-gate argument above rather than restate it.

### D4 — Collapsed cards, because the wall of inputs is the real risk

**The UX panel's blocking finding, and it changes the feature's shape.** At 360px a removable set row is
~144px (the chips + sub-failure + remove wrap to a third line), and a card header ≈ 242px. Ray's Strength
B day scaffolds to **~6,600px ≈ 9.5 phone screens of blank inputs**.

Today's form is ~400px and **grows in proportion to work done** — its length is a progress indicator.
Scaffolding inverts that: maximum length at minimum progress, and finding "movement 5, set 3" between
sets becomes a scroll hunt. Shipping the scaffold without collapse would plausibly make the athlete's
experience **worse**, which would defeat the PR's entire purpose.

**So:** scaffolded cards render collapsed — a disclosure row per movement (`min-h-11`) showing
`3 · Overhead Shoulder Press — 4 × 6` and a `0/4` counter, one expanded at a time. The form drops to
~1,050px, shorter than today's blank form past movement 1, and the counter supplies "where am I", which
the current form has never had.

**Do not use native `<details>`.** `SetRepsWeightFields` marks its inputs `required`, and a
hidden-but-present required input blocks native submit with an invisible browser error — the form simply
appears dead. That exact trap is already documented at `strength-form.tsx:457-463`, where the Skipped
branch **unmounts** its set rows rather than hiding them. Collapse must unmount the same way, and a failed
submit must auto-expand the cards the action flagged (`state.fieldErrors.movements` names them).

### D5 — Superset pre-grouping is CUT — the data does not exist

The backlog row promises "superset grouping pre-applied where prescribed." **`prescriptions` has no
superset column** — verified: `blockId`, `movementId`, `dayRole`, `idx`, `sets`, `targetReps`
(`packages/db/src/schema.ts`). A prescription cannot express that two movements are paired.

Supersets are a **performed** concept (`entries.superset_id`, V1-8-1/3c) with no prescribed counterpart.
Adding one is a migration plus an authoring UI — a different PR. **Cut from scope, and the backlog row
is corrected in this PR** so the promise does not outlive the discovery. The athlete groups supersets
with the existing tick-and-group control, exactly as today.

### D6 — A movement-only prescription scaffolds one blank set

`prescriptions.sets` is nullable (a movement-only prescription is legal, per the schema comment). Fall
back to **one** set row — the same `emptyMovement()` default a hand-added card gets. Not zero: a card
with no sets is the vacuous-truth shape BUG-2(b) had to fix.

### D7 — A scaffolded-but-untouched card must still be droppable

**The second blocking finding, and a contract change the draft missed.** `dropUntouchedMovements` is what
lets an athlete leave a spare card blank today — but `isUntouchedMovement` requires
`movementName.trim() === ''` (`strength-form-supersets.ts:85`), and **every scaffolded card has a name**.
So after one tap all 7 cards are permanently "touched": `sessionMovementSchema` demands ≥1 set for a
non-skipped movement and `parseLoad` demands a non-blank weight, so an athlete who performs 5 of 7 **cannot
submit** until they tap Skipped or Remove on the other two — discovered only on a failed submit, behind a
native focus-bubble on an off-screen input.

That directly contradicts this PR's own acceptance ("typing only the numbers logs the session").

**Fix, and it needs both halves:** carry `scaffolded: true` on `MovementVals`; extend the drop predicate to
also drop a movement that is `scaffolded && every set blank && default status`. **And** the collapsed
rows must be unmounted (D4) so their `required` inputs cannot block native submit regardless of what the
payload builder does — the payload fix alone leaves the form dead.

Note this is arguably the _right_ semantics for a deliberate Skipped (GAP-1 P1-1a records real
provenance), but it is a behaviour change and belongs in Acceptance and a test, not in implementation.

### D8 — The client never receives the prescribed load

`ProgramDayDTO` carries `load` (`program-day.ts:27`). Passing the whole DTO into a client component would
leave the prescribed load sitting in client state one `onWeight` away from the field — with this PR's
central invariant defended only by a unit assertion.

**Narrow the prop** to `Pick<ProgramDayDTO, 'idx' | 'movementName' | 'sets'>`. The boundary becomes
type-enforced and unforgeable, the RSC payload shrinks, and a post-GAP-3 load chip widens the prop
**deliberately** rather than inheriting access silently. (`targetReps` is also dropped, since D3 cut reps.)

### D9 — Clamp to the schema's limits

`sessionMovementSchema` caps movements at `MAX_SESSION_MOVEMENTS = 12` and sets at 20
(`packages/shared/src/strength-session.ts`), while `prescriptions_sets_check` allows any `sets > 0`. A day
with 13 prescriptions would scaffold a form that can **never** submit. Clamp in the scaffold using the
shared constants — never re-typed literals — and surface a note when truncated.

## File-by-file changes

| Path                                                        | Change | What & why                                                                                                                                                                   |
| ----------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/app/p/[profileId]/strength-form-scaffold.ts`      | NEW    | Pure rows → `MovementVals[]`, with the D9 clamps. **Colocated, following `strength-form-supersets.ts`** — the identical precedent: a pure, unit-tested sibling of this form. |
| `apps/web/app/p/[profileId]/strength-form-scaffold.test.ts` | NEW    | Unit tests (below).                                                                                                                                                          |
| `apps/web/app/p/[profileId]/strength-form.tsx`              | EDIT   | `programDay` prop (D8-narrowed); the button; the live region + focus move; collapse state; `scaffolded` flag; clear `selected` on replace.                                   |
| `apps/web/app/p/[profileId]/strength-form-supersets.ts`     | EDIT   | Extend the drop predicate for scaffolded-untouched cards (D7). **This is where `isUntouchedMovement` lives** — not `strength-form.tsx` as the draft said.                    |
| `apps/web/app/p/[profileId]/page.tsx`                       | EDIT   | Pass the narrowed `programDay` (already fetched, `:69`) beside `defaultDayRole` (`:143`). No new query.                                                                      |
| `apps/web/app/p/[profileId]/strength-form.test.tsx`         | EDIT   | Component tests (below).                                                                                                                                                     |
| `apps/web/e2e/a11y.spec.ts`                                 | EDIT   | Drive the **scaffolded** state and re-run `expectTapTargets` + axe — 7 cards is exactly where overflow would appear, and the spec never sees it today.                       |
| `docs/plan.md`                                              | EDIT   | Correct the V1-19 row (cut supersets, D5; structure-only, D3) and the V1-21 sequencing note (D10).                                                                           |
| `docs/status.md`                                            | EDIT   | Status rides with the work.                                                                                                                                                  |

### D10 — Inverting the stated V1-19 / V1-21 order, deliberately

`plan.md` says V1-21 is "**explicitly upstream of V1-19**" — it asks whether the form-with-set-rows model
is right at all, before optimising it. This PR inverts that, and the backlog row is corrected rather than
left contradicting a merged plan.

**Why the inversion is defensible:** V1-19 is app-only, no migration, and revert-able in one commit;
V1-21 is a design deliverable requiring rounds of comps and Ray's review, which is a far larger time
commitment at ~4h/wk. Meanwhile **no athlete has used the app yet** — the dogfood test is blocked on
exactly the interaction V1-19 fixes. And D4's collapse is _evidence for_ V1-21 rather than waste: it tests
whether disclosure solves the length problem, which is one of the questions V1-21 would otherwise ask in
the abstract.

### `strength-form-scaffold.ts` — the shape

```ts
/** Program rows → form state. PURE. Structure only: every set's `reps` and `weight` is ''. */
export function scaffoldMovements(
  rows: readonly ScaffoldRow[], // Pick<ProgramDayDTO,'idx'|'movementName'|'sets'> — no load (D8)
  defaultUnit: BodyweightUnit, // the shared union, not `string` (AGENTS.md constants rule)
): MovementVals[];
```

- `sets ?? 1`, then `Math.min(sets, MAX_SETS_PER_MOVEMENT)`; `rows.slice(0, MAX_SESSION_MOVEMENTS)` (D9).
- `scaffolded: true` on each card (D7).
- **`clientId`s are minted inside the click handler, never memoised.** A memoised scaffold replayed after
  a partial write would reuse entry `client_id`s and silently `ON CONFLICT` no-op. `newId` is imported
  directly rather than injected — it is a shared import used throughout, and no test needs determinism.
- `MovementVals` / `SetVals` / `emptySet` stay in `strength-form.tsx` and are imported here — an ordinary
  same-directory import, which is why the colocated module (not `lib/programming/`) is the right home.
  `lib/` importing types from a `'use client'` component under `app/` would invert the dependency;
  nothing in `lib/` does that today.

## Test plan

**Unit** (`strength-form-scaffold.test.ts`, Vitest, no DB):

- Order follows `idx`. `sets: null → 1` row; `sets: 4 → 4`; `sets: 25 → 20` (clamped); 13 rows → 12 (D9).
- **Every produced set has `reps: ''` AND `weight: ''`** — asserted over the whole structure, so a future
  edit that reintroduces either prefill fails here loudly. This is the machine-checkable form of the V1-10
  confirm-gate boundary.
- Every card carries `scaffolded: true` and a distinct `clientId`.
- **Every `CATALOG_MOVEMENTS` name parses under `sessionMovementSchema.shape.movementName`** (M3). That
  schema rejects commas/newlines and caps at 100, while `movements.name` is unconstrained `text` — so a
  catalog name with a comma would scaffold a card that can never submit and cannot be fixed without
  retyping, with the comma invisible as the cause.

**Drop predicate** (`strength-form-supersets.test.ts`): a scaffolded card with blank sets and default
status is dropped; one with any typed value, or a non-default status, is kept.

**Component** (`strength-form.test.tsx`, RTL):

- Button absent when `programDay` is empty, present when populated (the `length > 0` gate, not `dayRole`).
- Tap → N collapsed cards, prescribed names, correct set counts, **reps and weights empty**.
- **Partial session submits:** scaffold 7, fill 5, submit → succeeds, writes 5 (the D7 regression guard).
- Expanding a card mounts its set rows; collapsing unmounts them.
- Re-tap after typing → replaced, live region reports the count, Undo restores.
- Live region announces after tap; focus lands on the first movement.

**E2E** (`e2e/a11y.spec.ts` + the smoke): drive the scaffolded state, re-run `expectTapTargets` + axe; then
scaffold → type weights → submit → the logged session reads back with the programmed movement names
(the D11 identity guard below).

Local: `pnpm --filter web test`. CI runs the full suite plus the smoke.

## Risks / rollback

| Risk                                                                                                                                                                                                                                                                                                                                                                                             | Mitigation                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **D11 — a scaffolded name resolves to a DIFFERENT movement row than the prescription points at.** The form submits free text; `findOrCreateMovementId` slugifies it (`catalog.ts:76`). If the DTO's name ever diverges from `movements.name`, scaffolding silently **creates duplicate catalog rows** — the `RDL` vs `Romanian deadlift` fragmentation ONB-1 R12a spends a migration to prevent. | Verified identity today (`queries/program-day.ts` selects `movements.name`; the same `movementSlug` derives both). Pinned by the E2E assertion **and** the catalog-name schema test above. |
| Scaffolding makes every prescribed movement mandatory (D7).                                                                                                                                                                                                                                                                                                                                      | The `scaffolded`-aware drop predicate **plus** unmounting collapsed required inputs. Both halves, with a component test.                                                                   |
| A wall of blank inputs makes the athlete's experience worse (D4).                                                                                                                                                                                                                                                                                                                                | Collapse + per-movement counter. If real use shows the disclosure is itself friction, that is V1-21's evidence.                                                                            |
| Reps prefill quietly returns in a later edit.                                                                                                                                                                                                                                                                                                                                                    | The unit test asserts `reps: ''` structurally, so reintroducing it fails CI rather than passing review.                                                                                    |
| The weekday → `day_role` map is a hardcoded stopgap, so "today's program" can be wrong.                                                                                                                                                                                                                                                                                                          | Pre-existing ([tech-debt](../tech-debt.md)); this PR makes it more visible, which is an argument for SCHED-1, not a blocker.                                                               |

**Rollback:** pure app code, no migration. Revert the PR; the form returns to hand-entry. A scaffolded
session writes rows indistinguishable from a hand-typed one, so there is no data to undo.

## Out-of-scope / deferred

- **Load chips** — post-GAP-3 (D3).
- **Superset pre-grouping** — needs a prescribed-superset model (D5).
- **"Same as previous set" inheritance, rep steppers, "same as last time"** — brainstorm Tier 1–2, each
  its own small PR.
- **Whether a session-shaped form is right at all** — V1-21. This PR deliberately optimises the existing
  shape and does not foreclose replacing it.
- **Editing the program from this screen.** Read-only stays read-only.

## Open questions

_(None blocking. D1–D6 resolve the forks; D7 is a risk with a test, not a question.)_

## Review-response log (adversarial panel)

Panels run 2026-09-21 on the first draft, **before any implementation**: an engineering panel
(correctness/data-integrity · simplicity+scope+DRY+architecture) and the **required UX panel** (all three
standing lenses). Every claim below was re-verified against the tree before being accepted.

### Blocking

| #   | Lens                                                | Critique                                                                                                                                                                                     | Response                                                                                                                                                                                                                                                                 |
| --- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | Correctness · Scope _(found independently by both)_ | `dropUntouchedMovements` never drops a scaffolded card (`isUntouchedMovement` requires an empty name), so a partial session is unsubmittable and D2's dirty check is vacuously always-dirty. | **Accepted — the sharpest finding.** Verified at `strength-form-supersets.ts:85`. New **D7** (`scaffolded` flag + extended predicate + unmounted required inputs), an acceptance bullet, and a regression test. D2's dirty check rewritten to diff against the scaffold. |
| B2  | UX                                                  | ~6,600px ≈ **9.5 phone screens** of blank inputs; the form's length stops being a progress signal and inverts to max length at min progress. Not shippable as specified.                     | **Accepted.** New **D4** — collapsed cards, one expanded, `done/total` counter. Their `<details>` warning verified at `strength-form.tsx:457-463`: collapsed rows must **unmount**, not hide.                                                                            |
| B3  | UX                                                  | Nothing announces the change; a screen-reader user hears silence after the tap.                                                                                                              | **Accepted.** Live region + focus move, using the in-repo precedents (`checkin-form.tsx:235`, `routine-editor.tsx:155`). Their copy carries the blank-weights boundary in human language, which previously existed only in docblocks and tests.                          |
| B4  | Scope                                               | `lib/programming/scaffold.ts` importing types from a `'use client'` component inverts the `lib/` → `app/` dependency; nothing in `lib/` does this.                                           | **Accepted.** Moved to a colocated `strength-form-scaffold.ts`, following the exact `strength-form-supersets.ts` precedent. This also closes the draft's unresolved "or a sibling `types.ts` if it gets awkward" fork.                                                   |

### Major

| #   | Lens        | Critique                                                                                                                                                                                                                                    | Response                                                                                                                                                                                                                                                                      |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Correctness | **D3 misstates the V1-10 panel.** Its reason (2) is the _confirm-gate_ — the blank `required` field IS the human confirmation — which applies to reps identically; reason (3) explicitly rejects parsing `target_reps` into the reps field. | **Accepted, and it removes a feature.** Verified verbatim at `v1-10-2-strength-prefill.md:90-97`. **Reps prefill is cut.** D3 now quotes the panel rather than paraphrasing it.                                                                                               |
| M2  | Correctness | "2 of 7" is Strength-B-only; `strength_a` prefills **5 of 7 for Liam** across ~20 sets.                                                                                                                                                     | **Accepted** — folded into D3 as blast-radius evidence for cutting.                                                                                                                                                                                                           |
| M3  | Correctness | A prefilled rep on a `sub_failure` set writes a contradiction (`reps = 5, status = sub_failure`), unrecoverable through V1-9.                                                                                                               | **Accepted** — the decisive concrete case; cited in D3. Moot once reps prefill is cut.                                                                                                                                                                                        |
| M4  | Scope       | Don't pass `load` into the client component — the invariant would be defended by a unit test while the value sits one handler away from the field.                                                                                          | **Accepted.** New **D8**: narrow the prop to `Pick<…>`. Type-enforced beats test-enforced.                                                                                                                                                                                    |
| M5  | Scope       | Acceptance gates the button on `day_role`; the test plan gates it on rows. `page.tsx:141` shows the latter is right.                                                                                                                        | **Accepted** — acceptance now says `programDay.length > 0`, with the reason.                                                                                                                                                                                                  |
| M6  | Scope       | The V1-19/V1-21 ordering conflict is waved at; `plan.md` says V1-21 is explicitly upstream.                                                                                                                                                 | **Accepted.** New **D10** argues the inversion and corrects the backlog row rather than leaving both statements committed.                                                                                                                                                    |
| M7  | Correctness | The scaffold can emit a structurally invalid payload (>12 movements, >20 sets).                                                                                                                                                             | **Accepted** — new **D9**, clamped via the shared constants.                                                                                                                                                                                                                  |
| M8  | Correctness | `movements.name` is unconstrained `text` but `sessionMovementSchema.movementName` rejects commas and caps at 100 — a catalog name with a comma scaffolds an unsubmittable card.                                                             | **Accepted** — added the catalog-name schema test. Their related finding that `strength-session.ts:30`'s slug justification is false is **out of scope here**; filed for GAP-1 P2 rather than fixed in a UI PR.                                                               |
| M9  | UX          | D2's confirm is the wrong model — use Undo.                                                                                                                                                                                                 | **Accepted**, over the scope panel's alternative (hide the button while dirty), which it flagged as "weaker on a gym floor — a button vanishing mid-entry is its own confusion." Agreed.                                                                                      |
| M10 | UX          | "Start today's program" implies a mode starting and collides with the card's own title.                                                                                                                                                     | **Accepted** — "Fill in today's movements", with the blank-weights line beneath.                                                                                                                                                                                              |
| M11 | UX          | D4's "marked" discovered-rep sets are undefined; marking without explaining is worse than not marking. Show the coach's verbatim text instead.                                                                                              | **Moot — accepted by deletion.** Cutting reps prefill removes the marked state entirely. Their underlying suggestion (surface `targetReps` verbatim near the input, via `aria-describedby`) is recorded for the deferred reps PR, where it is the better answer than a badge. |

### Minor — all accepted

`isUntouchedMovement` lives in `strength-form-supersets.ts`, not `strength-form.tsx` (file table corrected,
and that module added — the draft omitted it while depending on it) · `clientId`s minted in the handler,
never memoised, or a replay silently `ON CONFLICT` no-ops · `defaultUnit` typed as the shared union, and
the injected `newId` parameter dropped as ceremony · replace must also clear `selected`
(`strength-form.tsx:125`) · disambiguate the deferred "prescribed-load chip" from the shipped `LoadChips`
· extend `e2e/a11y.spec.ts` to the scaffolded state, where 7 cards × chips is exactly where overflow would
appear · `cleanReps` edge cases (`'0'`, `'007'`, >1000) — **moot**, the function is cut.

### Pushed back

| #   | Lens  | Critique                                                                                       | Why not                                                                                                                                                                                                                                        |
| --- | ----- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Scope | Split the structural scaffold and reps prefill into two PRs.                                   | **Superseded rather than rejected** — reps prefill is cut outright (M1), not deferred to a follow-on, so there is nothing to split. Any future reps work must first answer the confirm-gate argument, which is a higher bar than "its own PR". |
| P2  | UX    | Note that the per-card `Unit` select is meaningless for `Pull-Up @ BW` and scaffolding ×7s it. | **Agreed but out of scope** — pre-existing, and fixing it is a form-shape change belonging to V1-21. Recorded there rather than absorbed here.                                                                                                 |

### Net effect

The panels **removed** a feature (reps prefill), **added** one (collapse), and **corrected a defect that
would have shipped** (B1 — a form that silently refuses partial sessions). Estimated diff is roughly
unchanged at ~450 lines: reps (−120) out, collapse and the drop-predicate work (+130) in. Two panelists
independently found B1, which is the strongest signal in this log that it was real.
