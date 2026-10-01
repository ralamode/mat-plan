# V1-27 — doing some of a movement's sets submits; trailing empty rows are not logged

> Backlog: [plan.md](../plan.md) row V1-27 (🔴 P0) and AUDIT-1 row 2. Branch: `fix/v1-27-partial-sets`.
> Feature guide: [strength-logging](../features/strength-logging.md) (owns every code file below).
>
> **Status: revised after the independent engineering and UX panels (2026-10-01); awaiting Ray's
> review. Lands AFTER #201 (V1-30)**, which edits `strength-form.tsx`, `strength-form-scaffold.ts`,
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
  same way it already clears `declaredLoaded`, so a renamed card is treated as hand-added and named.
- **Trailing untouched sets** of a movement are the untouched sets after its last touched set. Only these
  are dropped. An untouched set **before** a touched one (a gap) is not dropped.
- **A set is `required`** iff it is touched, **or** its movement will be submitted and the set is not a
  trailing untouched set. In code:
  `setIsRequired(m, s, i) = !isUntouchedSet(s) || (!isDroppableMovement(m) && i < trailingStart(m))`,
  where `trailingStart(m)` is the index after the last touched set (`0` when none is touched, so every
  row of a submitted all-blank movement stays required) and
  `isDroppableMovement = isUntouchedMovement || isUntouchedScaffold`.

**Why trailing only (panel finding arch-B1).** The P0 case — "did 2 of 3" — is a trailing blank row.
Dropping only trailing rows keeps every submitted set's array index equal to its on-screen number, so the
server's existing `set M` labels stay correct with **no wire or contract change**. A gap is unusual,
deliberate input (skipping set 1 but doing 2 and 3); it keeps today's block, now with a message that names
the way out (below).

## Behaviour, case by case

| Movement state at submit                               | Today                                                       | After                                                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Sets 1–2 filled, set 3 blank                           | **Blocked** ("Please fill out this field" on set 3)         | Submits **2 sets**; set 3 not logged; the summary line says so                                     |
| Set 1 filled, sets 2–3 blank                           | Blocked                                                     | Submits 1 set                                                                                      |
| Sets 1 and 3 filled, set 2 blank (a gap), **expanded** | Blocked on set 2 with the browser's generic message         | **Still blocked** on set 2, with "Fill in this set, or tap Remove if you didn't do it."            |
| A gap on a **collapsed** card                          | The blank set reaches the server; the session is rejected   | Unchanged: the server rejects it, and the label "set 2" is correct (nothing before it was dropped) |
| Set 3: weight typed, reps blank                        | Blocked on set 3's reps (generic message)                   | Still blocked — touched, so required — with the same named message                                 |
| Set 3: BW tapped, reps blank                           | Blocked                                                     | Still blocked, named message                                                                       |
| Set 3: sub-failure ticked, reps blank                  | Blocked                                                     | Still blocked — sub-failure records what WAS done                                                  |
| **Collapsed** card, 2 of 3 filled                      | Blank set reaches the server; the whole session is rejected | Trailing blank set dropped on the client; submits 2 sets (a second, quieter form of the same bug)  |
| Scaffolded card, every set blank, **collapsed**        | Dropped (V1-19)                                             | Unchanged                                                                                          |
| Scaffolded card, every set blank, **expanded**         | Blocked on its first row                                    | Dropped, same as collapsed (card 1 is auto-expanded by the scaffold, so "expanded" is not intent)  |
| Scaffolded card **renamed**, every set blank           | Collapsed: dropped. Expanded: blocked                       | **Blocked** on its first row in both states — the athlete named it (rename clears `scaffolded`)    |
| Hand-added card, **named**, every set blank            | Blocked on its first row                                    | Unchanged                                                                                          |
| Hand-added card, blank name, every set blank           | Dropped                                                     | Unchanged                                                                                          |
| Timed / distance set (V1-30's units)                   | Same as above                                               | Same rules — "touched" is about entries, not the unit                                              |
| Movement marked **skipped**                            | Submits `sets: []`                                          | Unchanged — skip wins over everything                                                              |

## Acceptance

1. Doing 2 of 3 scaffolded sets and tapping **Log strength** writes exactly those 2 sets, in a real
   browser (an e2e — jsdom never runs native constraint validation).
2. On an **expanded** card, a half-entered set and a gap still block **natively** (no request is sent),
   and the browser shows "Fill in this set, or tap Remove if you didn't do it." on the field.
3. A named movement with no entered sets — hand-added, or a renamed scaffolded card — still blocks.
4. No set the athlete touched is ever dropped; only trailing untouched sets are.
5. The server's validation and the wire format are unchanged. An old client or a crafted request gets
   exactly today's errors.
6. Before submit, a line directly above **Log strength** states what the tap will log — "Logs 4
   movements, 11 sets." — computed from the same post-drop payload the form sends. A dropped set or
   movement is therefore visible at the moment of commit, on every card, collapsed or not.
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
   `dropUntouchedMovements` and `dropTrailingUntouchedSets`. This removes the existing
   `strength-form-supersets.ts` ↔ `strength-form-scaffold.ts` import cycle; each module does one job
   (panel finding arch-S3).
5. **Keep the number of rows.** The card is not shrunk or renumbered before submit; only the payload is
   compacted.
6. **Movement numbering is out of scope.** Messages still number movements by payload index, which drifts
   when an untouched card is dropped before a faulty one — pre-existing (#54 + #60), not caused here.
   #201 replaces the number with the movement's name; the remaining ambiguity (the same movement twice in a
   day) is filed as **V1-35**.

## UX

- **The summary line (the real mitigation).** Always mounted directly above **Log strength**, `text-sm`,
  muted: **"Logs 4 movements, 11 sets."** (singular forms for 1; **"Nothing to log yet."** when the
  payload is empty). Computed from the exact payload `movementsJson` is built from. Tied to the button with
  `aria-describedby`, so a screen reader hears it on the button. Not a live region — it is a description,
  not an event. ~26 characters ≈ 180px at 360px, inside the ~294px usable width.
- **A hint on mixed cards (the local cue).** When an expanded card has at least one touched set and at
  least one trailing untouched set: **"Empty sets won't be logged."** Rendered **after** the **Add set**
  button, so its appearance and disappearance never move a control under the thumb (panel finding ux-N1).
  It has a stable id, and while the card is mixed, each trailing untouched row's reps input and **Add set**
  carry `aria-describedby` pointing at it, so keyboard and screen-reader users in forms mode meet it
  (ux-S2).
- **A message that names the way out.** Any required row with blank reps or weight gets, via `onInvalid`
  → `setCustomValidity`, **"Fill in this set, or tap Remove if you didn't do it."** (cleared `onInput`).
  A kid who typed a weight on all three rows and reps on two no longer gets a generic bubble that
  contradicts the hint (ux-S3).
- **The collapsed counter tells the truth.** `2/3` counts `!isUntouchedSet` rows, so it now agrees with
  what is sent, sub-failure-only rows included (ux-S1, arch-S2, cor-S3).
- **No new controls.** No set-count stepper (V1-25 §1, complementary) and no confirm dialog.
- **a11y:** lifting `required` removes the implicit `aria-required` exactly on rows that won't be sent. No
  change to targets or the 360px row layout.

## File-by-file changes (implementation PR, after #201)

| File                                                         | New/Edit | Change                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/app/p/[profileId]/strength-form-untouched.ts`      | NEW      | The predicates and drops in decision 4. Pure.                                                                                                                                                                                                                                                                                                                                          |
| `apps/web/app/p/[profileId]/strength-form-untouched.test.ts` | NEW      | Unit tests (below).                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/web/app/p/[profileId]/strength-form-supersets.ts`      | Edit     | Loses the moved predicates; superset transforms only. No import of the scaffold module.                                                                                                                                                                                                                                                                                                |
| `apps/web/app/p/[profileId]/strength-form-scaffold.ts`       | Edit     | `isUntouchedScaffold` moves out; imports nothing from supersets.                                                                                                                                                                                                                                                                                                                       |
| `apps/web/app/p/[profileId]/strength-form.tsx`               | Edit     | Serialization: `dropTrailingUntouchedSets` after `dropUntouchedMovements`. `repsRequired`/`weightRequired` from `setIsRequired`. Rename clears `scaffolded`. Counter via `isUntouchedSet`. The summary line and the hint. `SetVals` comment points at the one predicate.                                                                                                               |
| `apps/web/app/p/[profileId]/set-fields.tsx`                  | Edit     | A `repsRequired` prop (default `true`, so `editable-set.tsx` is unchanged), `aria-describedby` passthrough, and the `onInvalid`/`onInput` custom message on reps and weight.                                                                                                                                                                                                           |
| `apps/web/lib/constants.ts`                                  | Edit     | The hint, the summary (a pluralising function) and the invalid-row message.                                                                                                                                                                                                                                                                                                            |
| `apps/web/e2e/scaffold-submit.spec.ts`, `e2e/a11y.spec.ts`   | Edit     | Below.                                                                                                                                                                                                                                                                                                                                                                                 |
| `docs/features/strength-logging.md`                          | Edit     | `owns:` gains the new module. Rewritten: the Trap "'Untouched' is computed per set-level field, in THREE places" (now one module), the "Changing it" row "adding a field to a set" (→ `isUntouchedSet` only), and the Trap "Doing SOME of a movement's sets blocks the submit (V1-27, open)" (→ ✅ fixed). New Trap: `required` now depends on sibling rows (trailing rule). File map. |
| `docs/plan.md`, a changelog fragment                         | Edit/NEW | Tick V1-27 and AUDIT-1 row 2.                                                                                                                                                                                                                                                                                                                                                          |

`actions.ts` and the shared schemas are **not** touched, so `write-path.md` owes nothing. Estimated ~130
lines of code plus ~220 of tests. One PR, one concern.

## Test plan

- **Unit (`strength-form-untouched.test.ts`):** `isUntouchedSet` for each touch kind (reps, weight, `0`,
  BW, band, sub-failure) and the untouched row; `trailingStart`; `setIsRequired` across the case table,
  including the gap and the renamed card; `dropTrailingUntouchedSets` for 2-of-3, 1-of-3, a gap (unchanged),
  all-untouched (unchanged) and order preservation; the moved predicates still pass their existing cases.
- **Component (`strength-form.test.tsx`):** for every table row, the reps and weight inputs are
  `toBeRequired()` / `not.toBeRequired()` as the table says — this pins the wiring, not just the function
  (cor-S2). Through `payload()`: 2 of 3 → 2 sets; collapsed 2 of 3 → 2 sets; a gap → 3 sets sent. The
  summary text for several payloads, and its `aria-describedby` on the button; the hint only on a mixed
  card; renaming a scaffolded card makes its first row required; the counter shows `3/3` for a
  sub-failure-only third row.
- **e2e (`scaffold-submit.spec.ts`):** scaffold, fill **2 of the open card's 3 rows** with values distinct
  from the existing test's (`7 × 17.5`), submit, and assert the logged-entries count rose by exactly those
  two (a before/after delta, so it is retry-safe and does not collide with the spec beside it, cor-N3).
  Then a row with weight but no reps: assert `input.evaluate(el => el.validity.valueMissing)` is true and
  that **no** server-action request was sent (a request listener on the `Next-Action` header) — proving the
  **native** block, which the server's own rejection would otherwise mask (cor-S2).
- **a11y (`a11y.spec.ts`):** run `expectNoAxeViolations` in the 360px test, whose card is already mixed, so
  the hint state is scanned.
- **Mutation checks:** revert the drop → the payload tests and the e2e fail; drop only-trailing for
  drop-all → the gap test fails; `setIsRequired` always false → the native-block e2e fails; the counter
  back to its inline copy → the sub-failure counter test fails; remove the rename clear → the renamed-card
  test fails.
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
| ux-S3   | A half-entered row still gets the generic "Please fill out this field", contradicting the hint                           | **Accepted** — `onInvalid` → "Fill in this set, or tap Remove if you didn't do it." on reps and weight                                                              |
| ux-N1   | The hint's placement is unspecified and its appearance moves **Add set**                                                 | **Accepted** — rendered after **Add set**, so nothing moves under the thumb                                                                                         |
| ux-N2   | "If #201 names the movement" is moot; #201 numbers by index                                                              | **Resolved** — #201's review round adds the name prefix (in progress on its branch); movement numbering is out of scope here (decision 6) and the residual is V1-35 |
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
