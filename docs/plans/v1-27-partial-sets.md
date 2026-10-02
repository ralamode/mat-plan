# V1-27 — doing some of a movement's sets submits; trailing empty rows are not logged

> Backlog: [plan.md](../plan.md) row V1-27 (🔴 P0) and AUDIT-1 row 2. Branch: `fix/v1-27-partial-sets`.
> Feature guide: [strength-logging](../features/strength-logging.md) (owns every code file below).
>
> **Status: ✅ approved by Ray (2026-10-01)** after the independent engineering and UX panels and three
> re-review rounds. Ray explicitly accepted the trade-off: a forgotten _trailing_ set is logged short
> rather than blocking the session (the summary line is the mitigation). **Implemented after #201 (V1-30)**, which edits `strength-form.tsx`, `strength-form-scaffold.ts`,
> `actions.ts` and the shared strength schemas. The implementation PR is cut from a `main` that already
> has #201, so it is reviewed against the code it will actually merge into.

## Goal

A kid scaffolds the day, does **2 of the 3 prescribed sets** of a movement, and taps **Log strength**.
Today the browser refuses — "Please fill out this field" on the row they deliberately left blank — and
the only way out is a per-row **Remove** button nobody is told about. That is the most likely way to do
a prescribed movement on a gym floor, and it is a wall, not friction.

**Why:** the third row's `reps` input is unconditionally `required` (`set-fields.tsx`), and
`DEFAULT_SCAFFOLD_SETS` is 3. `isUntouchedScaffold` can drop a whole untouched **movement**, but there
is no per-**set** equivalent, so an untouched row inside a touched movement is neither dropped nor
excused.

**The fix, in one sentence:** untouched sets **after the last touched set** of a movement are not
`required` and are not submitted, and a line above **Log strength** says exactly what will be logged.

## Definitions (the contract this PR adds)

- **Touched set** — any affirmative entry on the row: `reps` or `weight` non-blank (including `0`),
  **BW** or **band** tapped, or a non-default status (sub-failure). Named once as `isUntouchedSet`, and
  every other "untouched" judgement — both movement predicates **and the collapsed-card counter** — uses
  it.
- **The movement's unit is not a touch.** The unit lives on the movement (invariant 4b), the scaffold
  pre-selects it, and changing it has not logged a set.
- **Renaming a scaffolded card is a touch of the movement.** The name handler clears `scaffolded`, the
  same way it already clears `declaredLoaded`, so a renamed card is treated as hand-added and named. Side
  effect, intended: a renamed card **never collapses again** (`collapsed` requires `scaffolded`), so a
  named all-blank card can never become an invisible block on a collapsed card.
- **Trailing untouched sets** of a movement are the untouched sets after its last touched set. Only these
  are dropped. An untouched set **before** a touched one (a gap) is not dropped. **A movement with no
  touched set has no trailing run:** it is either dropped whole (`isDroppableMovement`) or every row is
  required.
- **A set is `required`** iff it is touched, **or** its movement will be submitted and the set is not a
  trailing untouched set. In code:
  `setIsRequired(m, s, i) = !isUntouchedSet(s) || (!isDroppableMovement(m) && i < trailingStart(m))`,
  where `trailingStart(m)` is the index after the last touched set, or **`sets.length` when none is
  touched** (no trailing run, so every row of a submitted all-blank movement stays required and
  `dropTrailingUntouchedSets` leaves it unchanged), and
  `isDroppableMovement = isUntouchedMovement || isUntouchedScaffold`.
- **Which inputs are required** (B4 of the re-review): `repsRequired = setIsRequired(m, s, i)` and
  `weightRequired = setIsRequired(m, s, i) && !s.isBodyweight && !s.isBand`. The BW/band exemption is
  today's load-bearing rule (`strength-form.tsx`, "BW or band ⇒ weight not required") and is kept verbatim.
  **Both are exported from `strength-form-untouched.ts`** and are the only source the inputs read.
- **When the tap is blocked** (final re-review B-A): `isSubmitBlocked(movements, expandedId)` is true iff
  the **browser** would refuse the submit on a blank required field — i.e. on the **expanded**,
  non-droppable, non-skipped card: its movement name is blank (the name input is always `required`), or
  some row has `repsRequired` with blank reps or `weightRequired` with blank weight. It reads the same
  exported `repsRequired`/`weightRequired` as the inputs, so the summary and the inputs cannot drift.
  **Collapsed cards never count:** their inputs are unmounted, so the browser cannot block on them; a
  collapsed gap card is sent and refused by the server, which the existing error path reports (now naming
  the movement, #201).

**Why trailing only (panel finding arch-B1).** The P0 case — "did 2 of 3" — is a trailing blank row.
Dropping only trailing rows keeps every submitted set's array index equal to its on-screen number, so the
server's existing `set M` labels stay correct with **no wire or contract change**. A gap is unusual,
deliberate input (skipping set 1 but doing 2 and 3); it keeps today's block, now with a message that names
the way out (below).

## Behaviour, case by case

| Movement state at submit                               | Today                                                       | After                                                                                                     |
| ------------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Sets 1–2 filled, set 3 blank                           | **Blocked** ("Please fill out this field" on set 3)         | Submits **2 sets**; set 3 not logged; the summary line says so                                            |
| Set 1 filled, sets 2–3 blank                           | Blocked                                                     | Submits 1 set                                                                                             |
| Sets 1 and 3 filled, set 2 blank (a gap), **expanded** | Blocked on set 2 with the browser's generic message         | **Still blocked** on set 2, with "Fill in this set, or tap Remove if you didn't do it."                   |
| A gap on a **collapsed** card                          | The blank set reaches the server; the session is rejected   | Unchanged: the server rejects it, and the label "set 2" is correct (nothing before it was dropped)        |
| Set 3: weight typed, reps blank                        | Blocked on set 3's reps (generic message)                   | Still blocked — touched, so required — with the same named message                                        |
| Set 3: BW tapped, reps blank                           | Blocked                                                     | Still blocked, named message                                                                              |
| Set 3: **BW + reps**, weight blank                     | Submits; weight not required                                | Unchanged — reps required, **weight not required** (BW exemption kept)                                    |
| Set 3: **band + reps**, weight blank                   | Submits; weight not required                                | Unchanged — reps required, weight not required                                                            |
| Set 3: sub-failure ticked, reps blank                  | Blocked                                                     | Still blocked — sub-failure records what WAS done                                                         |
| **Collapsed** card, 2 of 3 filled                      | Blank set reaches the server; the whole session is rejected | Trailing blank set dropped on the client; submits 2 sets (a second, quieter form of the same bug)         |
| Scaffolded card, every set blank, **collapsed**        | Dropped (V1-19)                                             | Unchanged                                                                                                 |
| Scaffolded card, every set blank, **expanded**         | Blocked on its first row                                    | Dropped, same as collapsed (card 1 is auto-expanded by the scaffold, so "expanded" is not intent)         |
| Scaffolded card **renamed**, every set blank           | Collapsed: dropped. Expanded: blocked                       | **Blocked** on its first row; the card stays expanded (rename clears `scaffolded`, so it never collapses) |
| Hand-added card, **named**, every set blank            | Blocked on its first row                                    | Unchanged                                                                                                 |
| Hand-added card, blank name, every set blank           | Dropped                                                     | Unchanged                                                                                                 |
| Timed / distance set (V1-30's units)                   | Same as above                                               | Same rules — "touched" is about entries, not the unit                                                     |
| Movement marked **skipped**                            | Submits `sets: []`                                          | Unchanged — skip wins over everything                                                                     |

## Acceptance

1. Doing 2 of 3 scaffolded sets and tapping **Log strength** writes exactly those 2 sets, in a real
   browser (an e2e — jsdom never runs native constraint validation).
2. On an **expanded** card, a half-entered set and a gap still block **natively** (no request is sent),
   and the browser shows "Fill in this set, or tap Remove if you didn't do it." on the field. The message
   never lingers: once the field stops being required or is filled, it is valid again.
3. A named movement with no entered sets — hand-added, or a renamed scaffolded card — still blocks.
4. No set the athlete touched is ever dropped; only trailing untouched sets are.
5. The server's validation and the wire format are unchanged. An old client or a crafted request gets
   exactly today's errors.
6. Before submit, a line directly above **Log strength** states what the tap will log — "Logs 4
   movements, 11 sets." — computed from the same post-drop payload the form sends. A dropped set or
   movement is therefore visible at the moment of commit, on every card, collapsed or not. When the tap
   would be blocked, the line says so instead of describing a payload that will not be sent.
7. The collapsed counter and the summary use `isUntouchedSet`; nothing else re-derives "touched".

## Design decisions

1. **Client-side; no validation or wire change.** The row's first idea was to move "don't submit
   nothing" into the superRefine. It does not need to move: the server already rejects a blank set
   (`reps` coerces blank to 0, which `.positive()` refuses) and a non-skipped movement with no sets
   (check 6). What is missing is only the client refusing to send a session that is valid once the
   trailing blank rows are removed.
2. **Drop at serialization, never in state.** State keeps every row, so the athlete's view never loses
   anything before submit. ⚠️ **This is not a safety net after submit** (panel finding cor-S5): a tap on
   **Log strength** commits what is filled, the form then remounts empty (`gen` bumps), and a set entered
   afterwards becomes a second entry for that movement. The summary line is what protects against an
   early tap — see Risks.
3. **`required` is computed, not removed.** It still blocks everywhere blocking is right (the table's
   "still blocked" rows); it is lifted only on rows that will not be sent.
4. **One predicate module.** A new `strength-form-untouched.ts` holds `isDefaultStatus`, `isUntouchedSet`,
   `isUntouchedMovement`, `isUntouchedScaffold`, `isDroppableMovement`, `trailingStart`, `setIsRequired`,
   `dropUntouchedMovements`, `dropTrailingUntouchedSets`, and the consumers' view of them — `repsRequired`,
   `weightRequired` and `isSubmitBlocked` (the inputs and the summary read only these). This removes the existing
   `strength-form-supersets.ts` ↔ `strength-form-scaffold.ts` import cycle; each module does one job
   (panel finding arch-S3). `fillFromProgram`'s inline `!isUntouchedMovement(m) && !isUntouchedScaffold(m)`
   becomes `!isDroppableMovement(m)`, so the "touched" judgement has one call site per concept.
5. **Keep the number of rows.** The card is not shrunk or renumbered before submit; only the payload is
   compacted.
6. **The custom message is set declaratively, not by an event.** A `useEffect` on `[required, value,
missingMessage]` runs `el.setCustomValidity(missingMessage && required && value.trim() === '' ?
missingMessage : '')`. An `onInvalid`/`onInput` pair (the first draft) leaves a stale custom error when
   the field stops being required by other means — BW tapped, or the later set removed so this row becomes
   trailing — and the form then stays blocked on a field that must stay empty, the "form appears dead"
   trap `set-fields.tsx` already documents. The effect also never claims a step/min failure (reps `0`,
   `2.5`, weight `17.3`): those keep the browser's own message, because the custom one is only set when the
   value is blank. The message is an optional `missingMessage` prop that only `strength-form.tsx` passes, so
   `editable-set.tsx` — which has no **Remove** button — is unchanged.
7. **Movement numbering is out of scope.** Messages still number movements by payload index, which drifts
   when an untouched card is dropped before a faulty one — pre-existing (#54 + #60), not caused here.
   #201 replaces the number with the movement's name; the remaining ambiguity (the same movement twice in a
   day) is filed as **V1-35**.

## UX

- **The summary line (the real mitigation).** Always mounted directly above **Log strength**, `text-sm`,
  muted: **"Logs 4 movements, 11 sets."** (singular forms for 1; **"Nothing to log yet."** when the
  payload is empty). A movement marked **skipped** is sent with `sets: []` and is not "logged", so it is
  counted separately: **"Logs 3 movements, 9 sets, 1 skipped."** When `isSubmitBlocked` is true (a
  gap, a half-entered set, a named all-blank card, or a blank movement name — on the **expanded** card),
  the line reads **"A set needs finishing before this can log."** instead. It reads the same exported
  `repsRequired`/`weightRequired` the inputs render from, so **it agrees with the browser on every blank
  required field**. Two accepted exceptions, where the browser blocks but the line says "Logs…": a
  non-blank invalid value (reps `0` or `2.5`, a step/min failure the browser names itself), and a
  `type=number` field holding partial input (see Risks). A collapsed gap card is not "needs finishing": the
  tap sends and the server refuses it with a named message. Otherwise the counts come from the exact
  payload `movementsJson` is built from; a payload whose only movements are skipped reads **"Nothing to log
  yet."** Tied to the button with
  `aria-describedby`, so a screen reader hears it on the button. Not a live region — it is a description,
  not an event. ~26 characters ≈ 180px at 360px, inside the ~294px usable width.
- **A hint on mixed cards (the local cue).** When an expanded card has at least one touched set and at
  least one trailing untouched set: **"Empty sets at the end won't be logged."** ("at the end" because a
  gap card also has a trailing run, and its gap row still blocks — the unqualified copy would be false
  there.) Rendered **after** the **Add set**
  button, so its appearance and disappearance never move a control under the thumb (panel finding ux-N1).
  It has a stable id, and while the card is mixed, each trailing untouched row's reps input and **Add set**
  carry `aria-describedby` pointing at it, so keyboard and screen-reader users in forms mode meet it
  (ux-S2).
- **A message that names the way out.** Any required row with blank reps or weight gets **"Fill in this
  set, or tap Remove if you didn't do it."**, set declaratively (decision 6) so it disappears the moment
  the field is filled or stops being required. A kid who typed a weight on all three rows and reps on two
  no longer gets a generic bubble that contradicts the hint (ux-S3).
- **The collapsed counter tells the truth.** `2/3` counts `!isUntouchedSet` rows, so it now agrees with
  what is sent, sub-failure-only rows included (ux-S1, arch-S2, cor-S3).
- **No new controls.** No set-count stepper (V1-25 §1, complementary) and no confirm dialog.
- **a11y:** lifting `required` removes the implicit `aria-required` exactly on rows that won't be sent. No
  change to targets or the 360px row layout.

## File-by-file changes (implementation PR, after #201)

| File                                                         | New/Edit | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/app/p/[profileId]/strength-form-untouched.ts`      | NEW      | The predicates and drops in decision 4, plus `repsRequired`, `weightRequired` and `isSubmitBlocked` (the inputs and the summary both consume them). Pure.                                                                                                                                                                                                                                                                                                                                     |
| `apps/web/app/p/[profileId]/strength-form-untouched.test.ts` | NEW      | Unit tests (below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/web/app/p/[profileId]/strength-form-supersets.ts`      | Edit     | Loses the moved predicates; superset transforms only. No import of the scaffold module.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/web/app/p/[profileId]/strength-form-supersets.test.ts` | Edit     | Its `dropUntouchedMovements` / `isUntouchedMovement` cases move to `strength-form-untouched.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/web/app/p/[profileId]/strength-form-scaffold.test.ts`  | Edit     | Its `isUntouchedScaffold` cases move to `strength-form-untouched.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/web/app/p/[profileId]/strength-form.test.tsx`          | Edit     | The component tests below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/web/app/p/[profileId]/strength-form-scaffold.ts`       | Edit     | `isUntouchedScaffold` moves out; imports nothing from supersets.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/web/app/p/[profileId]/strength-form.tsx`               | Edit     | Serialization: `dropTrailingUntouchedSets` after `dropUntouchedMovements`. `repsRequired = setIsRequired(…)`, `weightRequired = setIsRequired(…) && !isBodyweight && !isBand`, and `missingMessage` passed. Rename clears `scaffolded`. Counter via `isUntouchedSet`. `fillFromProgram` via `isDroppableMovement`. The summary line and the hint. `SetVals` comment points at the one predicate.                                                                                              |
| `apps/web/app/p/[profileId]/set-fields.tsx`                  | Edit     | A `repsRequired` prop (default `true`) and an optional `missingMessage` prop (absent ⇒ no custom validity), so `editable-set.tsx` is unchanged; `aria-describedby` passthrough; the declarative `setCustomValidity` effect on reps and weight (decision 6).                                                                                                                                                                                                                                   |
| `apps/web/lib/constants.ts`                                  | Edit     | The hint, the summary (a pluralising function) and the invalid-row message.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/web/e2e/scaffold-submit.spec.ts`, `e2e/a11y.spec.ts`   | Edit     | Below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `docs/features/strength-logging.md`                          | Edit     | `owns:` gains the new module. Rewritten: the Trap "'Untouched' is computed per set-level field, in THREE places" (now one module), the "Changing it" row "adding a field to a set" (→ `isUntouchedSet` only), and the Trap "Doing SOME of a movement's sets blocks the submit (V1-27, open)" (→ ✅ fixed). New Traps: `required` now depends on sibling rows (trailing rule); the summary's blocked state reads `isSubmitBlocked` and is blind to step/min and `badInput` failures. File map. |
| `docs/plan.md`, a changelog fragment                         | Edit/NEW | Tick V1-27 and AUDIT-1 row 2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

`actions.ts` and the shared schemas are **not** touched, so `write-path.md` owes nothing. Estimated ~130
lines of code plus ~220 of tests — **about 350 lines, at the 400 target rather than comfortably under it**,
most of it tests. One concern: which rows the strength form sends and requires.

## Test plan

- **Unit (`strength-form-untouched.test.ts`):** `isUntouchedSet` for each touch kind (reps, weight, `0`,
  BW, band, sub-failure) and the untouched row; `trailingStart` — including
  **`trailingStart([blank, blank, blank]) === 3`** (no trailing run); `setIsRequired` across the case table,
  including the gap and the renamed card; `dropTrailingUntouchedSets` for 2-of-3, 1-of-3, a gap (unchanged),
  all-untouched (unchanged) and order preservation; the moved predicates still pass their existing cases.
- **Component (`strength-form.test.tsx`):** for every table row, the reps and weight inputs are
  `toBeRequired()` / `not.toBeRequired()` as the table says — including the **BW + reps** and **band +
  reps** rows (weight not required) — this pins the wiring, not just the function (cor-S2). **The custom
  message never lingers:** a blank required weight has `validity.customError` true; after tapping **BW**
  it is false; a gap row with the message set has `customError` false once the later set is removed (it is
  now trailing); and `editable-set.tsx` sets no custom validity. Through `payload()`: 2 of 3 → 2 sets; collapsed 2 of 3 → 2 sets; a gap → 3 sets sent. The
  summary text for several payloads (plural/singular, empty, **", 1 skipped"**, a **skipped-only** payload
  → "Nothing to log yet.", and the "needs finishing" wording), and its `aria-describedby` on the button.
  **For every case-table row, the summary reads "needs finishing" iff some rendered input is required and
  blank** — including **BW + reps** (not blocked), a **blank-name hand-added card with filled sets**
  (blocked), and a **collapsed gap card** (not "needs finishing"; it is sent); the hint only on a mixed
  card, and **its id referenced by `aria-describedby` on the trailing untouched rows and Add set**;
  renaming a scaffolded card makes its first row required **and the card no longer collapses**; the counter
  shows `3/3` for a sub-failure-only third row.
- **e2e (`scaffold-submit.spec.ts`):** scaffold, count the open card's rows (`n` — the scaffold's count
  depends on the day's prescription, so it is read, not assumed), fill **all but the last** with values
  distinct from the existing test's (`7 × 17.5`), submit, and assert the logged-entries count rose by
  exactly `n − 1` (a before/after delta, so it is retry-safe and does not collide with the spec beside it,
  cor-N3). Then a row with weight but no reps: assert `input.evaluate(el => el.validity.valueMissing)` is
  true, **`el.validationMessage` equals the constant**, and **no** server-action request was sent (a request
  listener on the `Next-Action` header) — proving the **native** block and its message, which the server's
  own rejection would otherwise mask (cor-S2). The spec's existing "deliberately does not assert" V1-27
  comment is rewritten to point at this test.
- **a11y (`a11y.spec.ts`):** run `expectNoAxeViolations` in the 360px test, whose card is already mixed, so
  the hint state is scanned.
- **Mutation checks:** revert the drop → the payload tests and the e2e fail; drop only-trailing for
  drop-all → the gap test fails; `setIsRequired` always false → the native-block e2e fails; the counter
  back to its inline copy → the sub-failure counter test fails; remove the rename clear → the renamed-card
  test fails; `trailingStart` back to `0` for all-blank → the `=== 3` unit case and the named-card
  `toBeRequired` case fail; replace the declarative effect with `onInvalid`-only → the "after BW" and
  "after removing the later set" `customError` tests fail; drop `missingMessage` → the e2e
  `validationMessage` assertion fails; drop the BW/band exemption from `weightRequired` → the BW/band
  `toBeRequired` rows fail; compute `isSubmitBlocked` from `setIsRequired` alone (ignoring the BW/band
  exemption and the name) → the BW+reps and blank-name summary rows fail.
- `pnpm verify`, `pnpm e2e:local`, `guides:check`.

## Risks / rollback

- **A trailing set the athlete did but didn't enter is not logged.** The old wall caught a forgotten row as
  a true positive; this design trades that for never losing a whole session. **The summary line is the
  mitigation** — a kid who meant 3 sets sees "2" at the moment of commit. **Recovery today is not in the
  app:** there is no "add a set to a logged entry" (V1-24's 1b amends values; 3a/3b are a receipt and a
  list move, not set addition), and logging the set again creates a **second entry** for the movement on
  that day. A guarded `db:correct` correction is the only way to merge them. The consequence is a set
  **undercount**, which errs conservative for progression. "Add a set to a logged entry" is filed under
  V1-24.
- **An early tap commits a partial session** (decision 2): the same second-entry recovery. And if the
  response is lost on gym wifi and the kid adds set 3 before retrying, the retry hits the entry's
  `client_id` (`ON CONFLICT DO NOTHING`, invariant 6) and set 3 is dropped while success is shown. The
  mechanism is pre-existing; this PR makes "submit some, then add more" a natural flow for the first time,
  so it is written down here, not fixed here.
- **`required` regressions.** The danger is a row that should block but doesn't. The component test pins
  the attribute for every table row.
- **A one-keystroke rename that is then reverted** leaves the card hand-added: it stays expanded and blocks
  if all its sets are blank, where today the same card would collapse and be dropped. Accepted: it errs
  toward blocking, never toward a silent drop, and **Remove** clears it (re-review P2; a `scaffoldedName`
  comparison was considered and rejected — see the log).
- **Accepted: two cases where the browser blocks but the summary says "Logs…".** (a) A non-blank invalid
  value — reps `0` or `2.5`, weight `17.3` against `step=0.5` — fails native step/min validation, which no
  pure-state predicate can see; the browser shows its own message on the field. (b) A `type=number` input
  holding partial input (e.g. `.` on the iOS decimal pad) is `''` in React state while the browser reports
  `badInput`: the row counts as untouched (so trailing and un-required), yet the browser still blocks it
  with its generic message. (b) is pre-existing; both go in the guide's Traps.
- **Rollback:** client-only and stateless; reverting restores today's behaviour exactly. No migration, no
  data change, no wire change.

## Out-of-scope / deferred

- **Choosing the set count up front** — V1-25 §1. Complementary.
- **Dropping a gap** (a middle or leading untouched set). It would need a locator for set errors on the
  wire; not worth it for unusual input that now gets a clear message.
- **Movement-number ambiguity** in error prefixes — V1-35.
- **Adding a set to a logged entry** — filed under V1-24.
- **Auto-expanding the card an error names** (a collapsed gap only shows the bottom banner) — a later fix.

## Open questions for Ray

None blocking. The panel's recommendations are adopted: keep the hint copy **and** add the summary line;
drop an expanded-but-untouched scaffolded card (safe now that renaming counts as a touch and the summary
shows one fewer movement). One trade-off is yours to accept explicitly: **a forgotten trailing set is
logged short rather than blocked** (Risks, first bullet).

## Review-response log

The independent panels ran on 2026-10-01 against the first draft: engineering correctness (cor),
architecture/reuse/scope (arch), and UX across interaction, a11y/360px and trust (ux). Every finding:

| #       | Finding                                                                                                                  | Response                                                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ux-B1   | The hint shows only on an expanded card; collapsed cards say only `2/3`, so the drop is a surprise                       | **Accepted** — the always-mounted summary line above **Log strength**, from the post-drop payload; acceptance 6 restated to match                                   |
| ux-B2   | The claimed recovery ("log it again, or V1-24 3a/3b") doesn't exist                                                      | **Accepted** — Risks rewritten: a second entry or a correction; the undercount stated; "add a set to a logged entry" filed under V1-24                              |
| ux-S1   | The collapsed counter is a fourth "touched" copy that omits sub-failure                                                  | **Accepted** — the counter uses `isUntouchedSet`; a test for a sub-failure-only row                                                                                 |
| ux-S2   | The hint is unreachable in screen-reader forms mode                                                                      | **Accepted** — stable id, `aria-describedby` from trailing untouched rows and **Add set**; the summary on the button                                                |
| ux-S3   | A half-entered row still gets the generic "Please fill out this field", contradicting the hint                           | **Accepted** — "Fill in this set, or tap Remove if you didn't do it." on reps and weight (mechanism revised by rr-B2)                                               |
| ux-N1   | The hint's placement is unspecified and its appearance moves **Add set**                                                 | **Accepted** — rendered after **Add set**, so nothing moves under the thumb                                                                                         |
| ux-N2   | "If #201 names the movement" is moot; #201 numbers by index                                                              | **Resolved** — #201's review round adds the name prefix (in progress on its branch); movement numbering is out of scope here (decision 7) and the residual is V1-35 |
| ux-Q1/2 | Open questions                                                                                                           | **Adopted** — keep the hint and add the summary; drop an expanded-but-untouched card (card 1 is auto-expanded, so expansion is not intent)                          |
| arch-B1 | The `position` wire field is a second concern and not the smallest fix; only trailing drops are needed for the P0        | **Accepted** — trailing-only; `position` removed; no wire or contract change; a gap stays blocked                                                                   |
| arch-B2 | A `position` bounded by the payload caps rejects valid sessions                                                          | **Resolved** by arch-B1 — no `position`                                                                                                                             |
| arch-S1 | `actions.ts` is owned by write-path.md; three strength-logging passages are missed                                       | **Accepted** — `actions.ts` no longer touched; the three passages named, the V1-27 trap marked fixed, a new trap for the trailing rule                              |
| arch-S2 | The untouched rule has three copies, not two                                                                             | **Accepted** — one module; the counter uses it                                                                                                                      |
| arch-S3 | The helpers belong in their own module; adding them to supersets deepens an import cycle                                 | **Accepted** — `strength-form-untouched.ts`; the cycle is removed; the guide's `owns:` updated                                                                      |
| arch-N1 | Single-author log; the plan.md row's "likely fix" contradicts the plan; no NEW/EDIT column                               | **Accepted** — this log; plan.md's text updated; the column added                                                                                                   |
| arch-N2 | The recovery claim is overstated                                                                                         | **Accepted** — see ux-B2                                                                                                                                            |
| cor-B1  | `position` bounded by payload limits rejects valid sessions                                                              | **Resolved** by arch-B1                                                                                                                                             |
| cor-S1  | `position` is read from unvalidated JSON on the error path                                                               | **Resolved** by arch-B1                                                                                                                                             |
| cor-S2  | The "half a set still blocks" e2e can't fail on its named mutation (the server masks it)                                 | **Accepted** — assert `validity.valueMissing` and that no action request was sent; component tests pin `required` per row                                           |
| cor-S3  | The counter disagrees with `isUntouchedSet`                                                                              | **Accepted** — see ux-S1                                                                                                                                            |
| cor-S4  | Dropping an expanded-but-untouched card silently drops a **renamed** movement                                            | **Accepted** — rename clears `scaffolded`; a table row and a test                                                                                                   |
| cor-S5  | Decision 2's "lost nothing" is false: an early tap commits a partial session, and lost-response + retry drops later sets | **Accepted** — decision 2 corrected; both scenarios in Risks with their recovery                                                                                    |
| cor-N1  | Commit to `position` for both levels                                                                                     | **Superseded** by arch-B1                                                                                                                                           |
| cor-N2  | Put `position` on the session wrapper, not the set schema                                                                | **Superseded** by arch-B1                                                                                                                                           |
| cor-N3  | The new e2e collides with its neighbour's fixed values                                                                   | **Accepted** — distinct values and a before/after delta                                                                                                             |

### Re-review (2026-10-01, fresh reviewer against the revised plan)

| #     | Finding                                                                                                                                            | Response                                                                                                                                                                                                                                                                                                               |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| rr-B1 | `trailingStart = 0` when nothing is touched makes every row of a named all-blank card un-required and drops all its sets — contradicting the table | **Accepted** — `trailingStart` is `sets.length` when none is touched ("no trailing run"); unit case `trailingStart([blank, blank, blank]) === 3`                                                                                                                                                                       |
| rr-B2 | `onInvalid` + clear-on-input leaves a stale custom error (BW tapped; later set removed), claims step/min failures, and leaks into the edit form    | **Accepted** — decision 6: a declarative `setCustomValidity` effect on `[required, value, missingMessage]`, only for a blank value; an optional `missingMessage` prop that only `strength-form.tsx` passes                                                                                                             |
| rr-B3 | No test fails without the custom message                                                                                                           | **Accepted** — the e2e asserts `validationMessage`; component tests assert `customError` false after BW and after the later set is removed; both in the mutation list                                                                                                                                                  |
| rr-B4 | `weightRequired` from `setIsRequired` alone would require weight on BW/band sets                                                                   | **Accepted** — `weightRequired = setIsRequired(…) && !isBodyweight && !isBand`; BW and band table rows and `toBeRequired` tests                                                                                                                                                                                        |
| rr-P1 | Rename clearing `scaffolded` makes the card never collapse; a reverted rename stays un-droppable                                                   | **Accepted (clear `scaffolded`)** — the never-collapses effect is stated and tested; it is the safe direction (no invisible block). **Pushed back** on a `scaffoldedName` comparison: a new state field to restore droppability after a revert, for a rare edit that errs toward blocking, with **Remove** as the exit |
| rr-P2 | "Empty sets won't be logged." is false on a gap card                                                                                               | **Accepted** — the copy becomes "Empty sets at the end won't be logged." (chosen over suppressing it on gap cards: one rule, always true)                                                                                                                                                                              |
| rr-P3 | The summary counts a skipped movement as logged, and describes an unsendable payload when the tap will be blocked                                  | **Accepted** — ", 1 skipped" is counted separately; when any submitted row is required and blank the line reads "A set needs finishing before this can log.", from the same predicates the inputs use                                                                                                                  |
| rr-P4 | The moved predicates' existing tests and `strength-form.test.tsx` are missing from the file table; `fillFromProgram` inlines the drop rule         | **Accepted** — the three test files added to the table; `fillFromProgram` uses `isDroppableMovement`                                                                                                                                                                                                                   |
| rr-P5 | The e2e assumes card 1 has 3 rows                                                                                                                  | **Accepted** — it reads the row count, fills all but the last and asserts `n − 1`; the spec's old V1-27 comment is rewritten                                                                                                                                                                                           |
| rr-P6 | No test pins the hint's `aria-describedby`                                                                                                         | **Accepted** — a component test asserts the hint's id on the trailing untouched rows and **Add set**                                                                                                                                                                                                                   |
| rr-P7 | ~350 lines is at the 400 target, not under it                                                                                                      | **Accepted** — the size statement now says so                                                                                                                                                                                                                                                                          |

### Final re-review (2026-10-01)

| #     | Finding                                                                                                                       | Response                                                                                                                                                                                                                                                           |
| ----- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| fr-BA | The summary's blocked state ignored the always-required name and could drop the BW/band exemption; "can never disagree" false | **Accepted** — `repsRequired`, `weightRequired` and `isSubmitBlocked` are exported from the untouched module and consumed by both the inputs and the summary; a per-row component test and a mutation entry pin it; the claim is narrowed to blank required fields |
| fr-BA | Collapsed gap card: blocked or not?                                                                                           | **Decided** — not "needs finishing": its inputs are unmounted, so the browser cannot block; the tap sends and the server refuses it with a named message                                                                                                           |
| fr-P1 | Stale "decision 6" cross-reference in ux-N2                                                                                   | **Fixed** — decision 7                                                                                                                                                                                                                                             |
| fr-P2 | Decision 6's continuation lines not formatted                                                                                 | **Fixed** — prettier                                                                                                                                                                                                                                               |
| fr-P3 | A non-blank invalid value blocks natively while the summary says "Logs…"                                                      | **Accepted** as a trap (Risks); the browser names the field itself                                                                                                                                                                                                 |
| fr-P4 | `type=number` partial input is `''` in state but `badInput` to the browser                                                    | **Accepted** as a pre-existing trap (Risks, guide)                                                                                                                                                                                                                 |
| fr-P5 | A skipped-only payload's summary is unspecified                                                                               | **Decided** — "Nothing to log yet."; added to the summary test                                                                                                                                                                                                     |

## Implementation deviation log

Recorded here rather than by changing the design above.

| #   | Deviation                                                                                                                                                                                                                                                                                                       | Why                                                                                                                                                                                                                                                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | The movement-name input's `required` is now `nameRequired(m)` = `!isDroppableMovement(m)`, not always on                                                                                                                                                                                                        | `isSubmitBlocked` counts a blank name only on a non-droppable card (fr-BA). The input was unconditionally `required`, so a blank hand-added card — dropped from the payload — still blocked natively in a real browser. Making the input agree with the summary also closes that pre-existing wall.                                                 |
| D2  | `isSubmitBlocked` considers every **rendered** card (`!(scaffolded && not expanded)`), not only "the expanded card"                                                                                                                                                                                             | A hand-added card is always rendered and is never "the expanded one" (that state tracks scaffolded cards only). Taking the plan literally would miss a blank required field on a hand-added card while the browser blocks it.                                                                                                                       |
| D3  | Two small exported helpers beyond decision 4: `nameRequired` (D1) and `hasTrailingUntouched` (the hint's condition)                                                                                                                                                                                             | So the form renders the hint and the name's `required` from the module rather than re-deriving them inline — the one-call-site-per-concept rule decision 4 states.                                                                                                                                                                                  |
| D4  | **Revises ux-S3** (implementation UX review P1): the custom message is PER FIELD — reps "Fill in the reps, or tap Remove if you didn't do this set." (Remove clause only when the card has more than one set, else "Fill in the reps for this set."); weight "Enter the weight, or tap BW if there wasn't one." | ux-S3 considered only blank reps. On a one-set card there is no per-set Remove, so the single message pointed at the movement's Remove (no undo) — and on weight, "if you didn't do it" was false for a kid who did the set and invited typing `0`, a fake load. Component tests pin both, and that a one-set card's messages never mention Remove. |
| D5  | The blocked summary NAMES the first blocker (`firstBlocker`): "<Movement> set N needs finishing." / "Movement N needs a name.", names capped at `SUMMARY_NAME_MAX` (20)                                                                                                                                         | Implementation UX review P2-2/P2-3: "A set needs finishing" blamed a set when the cause was a blank name, and on a phone the blocker can be ~800px up the page. Same predicates as before; `expectSummaryAgrees` now also checks the named set is the first blank required input.                                                                   |
| D6  | `isCollapsed(m, expandedId)` exported and used by both the form and `firstBlocker`                                                                                                                                                                                                                              | Correctness review P2-1: the collapse rule was written twice, so the summary could drift from what is rendered.                                                                                                                                                                                                                                     |
| D7  | The blank-quantity bubble is chosen by unit (`missingQuantityMessage`): a mass unit says "Enter the weight, or tap BW or band if there wasn't one."; a time or distance says "Enter the time." / "…height or distance." (the server's own noun).                                                                | Confirmation review P1: on a timed card "tap BW" sent the kid into V1-30's refusal. Band added for a banded set. A component test on a timed card pins the wiring.                                                                                                                                                                                  |
