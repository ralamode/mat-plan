# V1-27 — doing some of a movement's sets submits; the empty rows are not logged

> Backlog: [plan.md](../plan.md) row V1-27 (🔴 P0) and AUDIT-1 row 2. Branch: `fix/v1-27-partial-sets`.
> Feature guide: [strength-logging](../features/strength-logging.md) (owns every file below).
>
> **Status: draft, awaiting Ray's review. Lands AFTER #201 (V1-30)**, which edits
> `strength-form.tsx`, `strength-form-scaffold.ts` and the shared strength schemas. The overlap is
> small (V1-30 changes units, this changes `required` and set serialization), but the implementation
> PR is cut from a `main` that already has #201 so it is reviewed against the code it will actually
> merge into.

## Goal

A kid scaffolds the day, does **2 of the 3 prescribed sets** of a movement, and taps **Log strength**.
Today the browser refuses — "Please fill out this field" on the row they deliberately left blank — and
the only way out is a per-row **Remove** button nobody is told about. That is the most likely way to do
a prescribed movement on a gym floor, and it is a wall, not friction.

**Why:** the third row's `reps` input is unconditionally `required` (`set-fields.tsx`), and
`DEFAULT_SCAFFOLD_SETS` is 3. `isUntouchedScaffold` can drop a whole untouched **movement**, but there
is no per-**set** equivalent, so an untouched row inside a touched movement is neither dropped nor
excused.

**The fix, in one sentence:** an **untouched set** inside a movement that has at least one touched set
is not `required` and is not submitted — the same rule the form already applies to an untouched
movement, one level down.

## Definitions (the contract this PR adds)

- **Touched set** — any affirmative entry on the row: `reps` or `weight` non-blank, **BW** or **band**
  tapped, or a non-default status (sub-failure). Exactly the clause `isUntouchedMovement` and
  `isUntouchedScaffold` each already inline today; this PR names it once as `isUntouchedSet` and both
  movement predicates use it.
- **The movement's unit is not a touch.** The unit lives on the movement (invariant 4b), the scaffold
  pre-selects it from the catalog, and an athlete changing it has not logged a set.
- **A set needs `required`** iff it is touched, **or** its movement will be submitted and has **no**
  touched set at all. In code: `setIsRequired(movement, set) = !isUntouchedSet(set) ||
(!isDroppableMovement(movement) && movement.sets.every(isUntouchedSet))`, where
  `isDroppableMovement = isUntouchedMovement || isUntouchedScaffold` (the predicate
  `dropUntouchedMovements` already uses).

The second clause keeps today's behaviour where it is right: a hand-added card the athlete **named** but
gave no sets still blocks with a visible "Please fill out this field" on its first row. Silently dropping
a named movement would be worse than the wall.

## Behaviour, case by case

| Movement state at submit                        | Today                                                                                                                                     | After                                                                                                                   |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Sets 1–2 filled, set 3 blank                    | **Blocked** ("Please fill out this field" on set 3)                                                                                       | Submits **2 sets**; set 3 not logged                                                                                    |
| Sets 1 and 3 filled, set 2 blank                | Blocked                                                                                                                                   | Submits 2 sets, **in order**; the writer numbers them 1, 2 (set position is array index, `writers/strength-session.ts`) |
| Set 3: weight typed, reps blank                 | Blocked on set 3's reps                                                                                                                   | **Still blocked** on set 3's reps — touched, so required. Correct: half a set is a mistake to point at, not to drop     |
| Set 3: BW tapped, reps blank                    | Blocked                                                                                                                                   | Still blocked — BW is an affirmative entry                                                                              |
| Set 3: sub-failure ticked, reps blank           | Blocked                                                                                                                                   | Still blocked — sub-failure records what WAS done, so it needs reps                                                     |
| Scaffolded card, every set blank, **collapsed** | Dropped (V1-19)                                                                                                                           | Unchanged                                                                                                               |
| Scaffolded card, every set blank, **expanded**  | Blocked on its first row                                                                                                                  | Dropped, same as collapsed. Opening a card is not logging it; the two states now behave the same                        |
| Hand-added card, **named**, every set blank     | Blocked on its first row                                                                                                                  | Unchanged — blocked (second clause above)                                                                               |
| Hand-added card, blank name, every set blank    | Dropped                                                                                                                                   | Unchanged                                                                                                               |
| Timed / distance set (V1-30's units)            | Same as above                                                                                                                             | Same rules — "touched" is about entries, not the unit                                                                   |
| **Collapsed** card with 2 of 3 filled           | Inputs unmounted, so the browser can't block; the blank set **reaches the server**, which rejects the whole session with a zod reps error | Blank set dropped on the client; submits 2 sets. This was a second, quieter form of the same bug                        |
| Movement marked **skipped**                     | Submits `sets: []`                                                                                                                        | Unchanged — skip wins over everything, as today                                                                         |

## Acceptance

1. Doing 2 of 3 scaffolded sets and tapping **Log strength** writes exactly those 2 sets, in a real
   browser (an e2e, because jsdom never runs native constraint validation — see the scaffold-submit spec).
2. A half-entered set (weight without reps, BW without reps, sub-failure without reps) still blocks,
   with the browser's message on the visible field.
3. A named, hand-added movement with no entered sets still blocks.
4. No set the athlete touched is ever dropped; no set they did not touch is ever submitted.
5. The server's **validation** is unchanged: `strengthSetSchema` still rejects a blank set, and the session
   superRefine still rejects a non-skipped movement with no sets. An old client, or a crafted request,
   gets exactly today's errors.
6. When a card has both entered and empty rows, it says so before submit (see UX below), so dropping is
   never a surprise.
7. A server error on a set names the set **as the athlete sees it**, even when an earlier set or movement
   was dropped (see "Locating errors after a drop").

## Design decisions

1. **Client-side; no validation change.** The row's first idea was to move "don't submit nothing" into the
   superRefine. It does not need to move: the server **already** owns it (`strength-session.ts`, check 6,
   "Add at least one set.") and already rejects a blank set. What is missing is purely the client
   refusing to send a session that is valid once the blank rows are removed. Keeping validation untouched means no migration and little overlap with #201. The only schema change is the additive, display-only `position` that keeps error messages locatable (below).
2. **Drop at serialization, never in state.** The same rule GAP-1 P1-1c learned for skip: state keeps
   every row, so an athlete who taps "Log" by mistake and then keeps going has lost nothing; only the
   `movementsJson` excludes untouched rows. Emptying state would also break the collapsed counter.
3. **`required` is computed, not removed.** `required` still does its job — pointing at the visible
   field — for every case where blocking is right (rows 3–5 and 8 of the table). It is only lifted for
   rows that will not be sent.
4. **One predicate, three users.** `isUntouchedSet` is extracted to `strength-form-supersets.ts` (beside
   `isUntouchedMovement`), and `isUntouchedMovement`, `isUntouchedScaffold`, `setIsRequired` and
   `dropUntouchedSets` all use it. Today the set clause is written out twice; a third copy would be the
   drift AGENTS.md's reuse rule exists to prevent.
5. **Keep the number of rows.** Dropping a set does not shrink the card or renumber the visible rows
   before submit — the athlete can still fill row 3 later. Only the submitted payload is compacted.

## Locating errors after a drop

**The problem (from #201's UX review).** The action numbers its messages from the **submitted** array:
`actions.ts` builds `Movement ${i.path[1] + 1}` and, since #201, `Movement N, set ${i.path[3] + 1}`.
But the cards and rows are numbered by their **on-screen** position. Today that already drifts for
movements (`dropUntouchedMovements` removes cards before a faulty one, a pre-existing P1); V1-27 makes
it drift for sets too. Drop an untouched set 1 and a server error on set 2 would say **"set 1"**, pointing
the athlete at a row that is fine.

**Options considered:**

| Option                                      | How                                                                                                                                                                   | Verdict                                                                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| A. Carry the on-screen position on the wire | Each movement and set in `movementsJson` gets an optional `position` (1-based, the number the athlete sees). The action labels messages with `position ?? index + 1`. | **Chosen**                                                                                                                       |
| B. Remap on the client                      | The action returns structured `{path, message}` issues; the form keeps a payload→screen index map from serialization and formats the text.                            | Rejected: changes `ActionState`'s shape for every action, and moves message formatting into the client for one form              |
| C. Don't drop on the wire                   | Send untouched sets with a "skip me" marker and drop them in the writer                                                                                               | Rejected: a blank set reaching the server is exactly the shape `strengthSetSchema` exists to refuse; it would reopen invariant 2 |

**Option A, precisely:**

- `position` is **optional** and **display-only**: an integer in `1..MAX_SETS_PER_MOVEMENT` for a set and
  `1..MAX_SESSION_MOVEMENTS` for a movement, validated by zod and used **only** to build a message
  prefix. It never orders, stores or identifies anything — the writer still numbers sets by array
  position, and nothing persists `position`. A crafted value can at worst mislabel the crafter's own
  error message.
- Additive and backward compatible: an old client omits it and gets today's index-based labels.
- It also fixes the **movement** half of the pre-existing drift. If #201 lands naming the movement in the
  prefix (as expected), the movement label is the name and `position` is used only for the set: e.g.
  **"Back squat, set 2: …"**. The plan follows whichever prefix #201 merges with; the set number comes
  from `position` either way.
- The client sets `position` at serialization from the **unfiltered** state, before
  `dropUntouchedMovements` and `dropUntouchedSets` run, so it is always the number on the screen.

## UX

The change is mostly the absence of a wall, but dropping data the athlete can see needs one honest
sentence.

- **A hint on mixed cards.** When an expanded card has at least one touched and at least one untouched
  row, show one line of muted text under its sets: **"Empty sets won't be logged."** Static text, not a
  live region (it is not an event), not an error (nothing is wrong). It disappears when every row is
  filled or emptied. Plain-language, no jargon, readable by a kid.
- **The collapsed counter already tells the truth.** `2/3` on a collapsed card is unchanged and now means
  what it shows: 2 will be logged.
- **After submit, the logged-entries list shows exactly what was saved** — V1-24's principle that the
  record, not the form, is the confirmation.
- **No new controls.** Not a "set count" stepper (that is V1-25 §1), not a confirm dialog (a dialog on a
  gym floor between sets is worse than the hint).
- **a11y:** the hint is ordinary text inside the card, after the set rows, so it is read in order. Removing
  `required` from a row removes its implicit `aria-required` too, which is correct — the field is no longer
  required. No change to the 44px targets or the 360px layout (one line of text under the rows; it wraps).

## File-by-file changes (implementation PR, after #201)

| File                                                                         | Change                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/app/p/[profileId]/strength-form-supersets.ts`                      | Extract `isUntouchedSet(set)`; rewrite `isUntouchedMovement` to use it. Add `isDroppableMovement(m)` (the predicate `dropUntouchedMovements` inlines), `setIsRequired(m, s)` and `dropUntouchedSets(m)` (returns the movement with untouched sets removed when any set is touched; otherwise unchanged). Pure, colocated with the predicates they compose. |
| `apps/web/app/p/[profileId]/strength-form-scaffold.ts`                       | `isUntouchedScaffold` uses `isUntouchedSet`. No other change.                                                                                                                                                                                                                                                                                              |
| `apps/web/app/p/[profileId]/strength-form.tsx`                               | Serialization maps non-skipped movements through `dropUntouchedSets` after `dropUntouchedMovements`. Each set row passes `repsRequired={setIsRequired(m, s)}` and `weightRequired={setIsRequired(m, s) && !s.isBodyweight && !s.isBand}`. The mixed-card hint.                                                                                             |
| `apps/web/app/p/[profileId]/set-fields.tsx`                                  | A `repsRequired` prop (default `true`, so every other caller — `editable-set.tsx` — is unchanged), mirroring the existing `weightRequired`.                                                                                                                                                                                                                |
| `packages/shared/src/strength.ts`, `packages/shared/src/strength-session.ts` | An optional, bounded `position` on the set and movement input schemas (display-only; see "Locating errors after a drop").                                                                                                                                                                                                                                  |
| `apps/web/app/p/[profileId]/actions.ts`                                      | Message prefixes use `position ?? index + 1` for the set (and for the movement, unless #201's name prefix is in place).                                                                                                                                                                                                                                    |
| `apps/web/lib/constants.ts`                                                  | The hint copy.                                                                                                                                                                                                                                                                                                                                             |
| `docs/features/strength-logging.md`                                          | Invariant 2's corollary generalised ("`required` is computed: …"), the Traps entry for this wall, the file map. Guide gate.                                                                                                                                                                                                                                |
| `docs/plan.md`, a changelog fragment                                         | Tick V1-27 and AUDIT-1 row 2.                                                                                                                                                                                                                                                                                                                              |

Estimated ~150 lines of code plus ~200 of tests. One PR. The schema change is additive (optional fields), so it is not a contract break.

## Test plan

- **Unit (`strength-form-supersets.test.ts`):** `isUntouchedSet` for each touch kind (reps, weight, BW,
  band, sub-failure) and for the untouched row; `setIsRequired` across the case table above;
  `dropUntouchedSets` for 2-of-3, a middle gap, all-untouched (unchanged), and order preservation.
- **Action (`actions.test.ts`):** a payload whose first set carries `position: 2` (set 1 was dropped) and
  fails validation → the message says **set 2**; the same payload without `position` → set 1 (backward
  compatible); an out-of-range `position` is rejected by zod; a dropped **movement** before a faulty one →
  the movement label still matches the screen.
- **Component (`strength-form.test.tsx`):** with set 1 untouched and sets 2–3 filled, the serialized sets
  carry `position` 2 and 3; with the first card untouched and dropped, the second card's movement
  `position` is 2.
- **Unit (`strength-form-scaffold.test.ts`):** `isUntouchedScaffold` still agrees with its existing cases
  after the refactor (no behaviour change).
- **Component (`strength-form.test.tsx`, through `payload()`):** 2 of 3 filled → the payload carries 2
  sets; a collapsed card with 2 of 3 filled → 2 sets; the hint shows only on a mixed card.
- **e2e (`e2e/scaffold-submit.spec.ts`):** a new test: scaffold, fill **2 of the open card's 3 rows**, submit,
  and assert exactly those sets landed in Logged entries. It replaces the existing spec's ⚠️ note that
  deliberately avoided this bug. A second assertion: a row with weight but no reps still blocks (the
  button stays, nothing is written). Retry-safe: it reads the counts it creates, not fixed totals.
- **Mutation checks:** revert `dropUntouchedSets` → the payload and e2e tests fail; make `setIsRequired`
  always true → the e2e fails; make it always false → the "half a set still blocks" test fails.
- `pnpm verify`, `pnpm e2e:local`, `guides:check`.

## Risks / rollback

- **A set the athlete did but didn't enter is silently not logged.** That was already true for a whole
  untouched movement (V1-19); this extends it to rows. Mitigated by the hint, the counter and the
  logged-entries list, and recoverable (log it again, or V1-24 3a/3b once they land). The alternative —
  the wall — loses the whole session, which is strictly worse.
- **`required` regressions.** The danger case is a row that should block but doesn't. The case table is
  the test matrix, and "touched ⇒ required" is the property a unit test pins for every touch kind.
- **Rollback:** client-only and stateless; reverting the PR restores today's behaviour exactly. No
  migration, no data change.

## Out-of-scope / deferred

- **Choosing the set count up front** — V1-25 §1. Complementary: fewer blank rows, but a kid can still
  do fewer sets than planned, so this fix is needed either way.
- **Renumbering or collapsing visible rows** before submit.
- **Any change to what the server validates.**

## Open questions for Ray

1. **The hint copy:** "Empty sets won't be logged." — or say nothing and rely on the counter? I recommend
   the hint; it is the one thing that keeps the drop from being a surprise.
2. **Expanded, untouched scaffolded card:** dropped (recommended, matches the collapsed card) or keep
   today's block? Opening a card to look at it shouldn't make it mandatory.

## Review-response log (adversarial panel)

> ⚠️ **Single-author review.** This plan was drafted by a worker session that could not spawn the
> independent subagent panel `plan-with-panel` calls for. The lenses below were applied by the author,
> adversarially, and every finding was folded in, but **the independent engineering and UX panels must
> still run on this plan before implementation** (the parent session schedules them).

| #   | Lens                                         | Finding                                                                                                                                                                              | Response                                                                                                                                                                                                                         |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Correctness                                  | The row proposed moving "don't submit nothing" into the superRefine; the server already owns it (check 6) and already rejects a blank set                                            | **Accepted** — decision 1: no schema change. Removes the main #201 overlap too                                                                                                                                                   |
| A2  | Correctness                                  | A **collapsed** card with 2 of 3 filled never hits native validation (inputs unmounted), so today the blank set reaches the server and the whole session fails with a zod error      | **Accepted** — added to the case table; `dropUntouchedSets` at serialization covers it, with a component test                                                                                                                    |
| A3  | Correctness                                  | Lifting `required` only on "untouched" rows would also lift it on every row of a **named** hand-added card with no sets, silently dropping a movement the athlete deliberately named | **Accepted** — the second clause of `setIsRequired`; table row 8 and acceptance 3                                                                                                                                                |
| A4  | Correctness                                  | `weightRequired` must follow the same rule, or an untouched sibling row still blocks on its weight input                                                                             | **Accepted** — `weightRequired = setIsRequired && !BW && !band`                                                                                                                                                                  |
| A5  | Correctness                                  | Does dropping a middle set break set numbering or idempotency?                                                                                                                       | **Checked** — the writer numbers sets `idx: i + 1` from array position, and mints each set's `client_id` itself (`writers/strength-session.ts`); the client's idempotency key is per entry (movement). Compaction changes no key |
| B1  | Scope                                        | A "set count" stepper (V1-25 §1) would make this unnecessary                                                                                                                         | **Pushed back** — a kid can always do fewer sets than planned; V1-25 §1 reduces blank rows but does not remove the case. Kept out of scope                                                                                       |
| B2  | Scope                                        | A confirm dialog ("3rd set is empty — log anyway?")                                                                                                                                  | **Rejected** — a modal between sets on a gym floor; the static hint carries the same information without a tap                                                                                                                   |
| C1  | Architecture                                 | Where do the set predicates live? `isUntouchedScaffold` is in the scaffold module, `isUntouchedMovement` in supersets                                                                | **Accepted** — `isUntouchedSet` and the new helpers go beside `isUntouchedMovement`; the scaffold predicate imports it. Both modules are already colocated and guide-owned                                                       |
| C2  | Architecture                                 | Land against #201's code, not today's `main`                                                                                                                                         | **Accepted** — status line and branch note: the implementation PR is cut after #201 merges                                                                                                                                       |
| D1  | Reuse                                        | The set clause (`reps/weight blank, !BW, !band, default status`) is already written twice; a third copy is the drift the reuse rule forbids                                          | **Accepted** — decision 4                                                                                                                                                                                                        |
| D2  | Reuse                                        | The hint is a new user-facing string                                                                                                                                                 | **Accepted** — `lib/constants.ts`, imported by the test                                                                                                                                                                          |
| E1  | UX · interaction                             | Silently dropping rows the athlete can see is a trust problem even when it is right                                                                                                  | **Accepted** — the mixed-card hint; the counter and the logged list already confirm afterwards                                                                                                                                   |
| E2  | UX · interaction                             | An expanded-but-untouched scaffolded card behaving differently from a collapsed one is incoherent                                                                                    | **Accepted** — both dropped; flagged as open question 2 because it changes today's behaviour                                                                                                                                     |
| F1  | UX · a11y / 360px                            | The hint must not be a live region (nothing happened) and must not read as an error                                                                                                  | **Accepted** — static muted text after the rows; no `role`                                                                                                                                                                       |
| F2  | UX · a11y / 360px                            | One more line in a card at 360px                                                                                                                                                     | **Checked** — one wrapping line of `text-sm` under the set rows; no new control, no width change                                                                                                                                 |
| G1  | UX · trust / data entry                      | Does the drop ever discard something the athlete DID enter?                                                                                                                          | **Checked** — "touched ⇒ required ⇒ never dropped" is the invariant, pinned per touch kind; acceptance 4                                                                                                                         |
| G2  | UX · trust / data entry                      | Half a set (weight, no reps) should still be pointed at, not dropped                                                                                                                 | **Accepted** — table rows 3–5; an e2e assertion                                                                                                                                                                                  |
| H1  | UX (from #201's review, via the coordinator) | Messages are numbered from the filtered payload, so dropping sets makes "set M" point at the wrong row (the movement half already drifts today)                                      | **Accepted** — "Locating errors after a drop": a display-only, bounded `position` on the wire (option A; B and C rejected with reasons), acceptance 7, action and component tests including a dropped set before a faulty one    |
