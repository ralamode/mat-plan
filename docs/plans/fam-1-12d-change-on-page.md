# FAM-1 12d: change a logged number on the day page

> Backlog: [plan.md](../plan.md) row `FAM-1`, the [FAM-1 plan](./fam-1-family-program.md) §5 step
> 12d ("Wiring II"), decisions D20 and D39. Branch: `feat/fam-1-12d-change-on-page`. Lane C
> ([day-page.md](../features/day-page.md)). **Rev 2**, after a six-lens panel (§ Review-response
> log), which cut two parts into their own PRs.

## Goal

A parent or athlete can correct a logged number in place on the real day page: today or
yesterday, on a program row. Change already works on the preview route (13b-ii, #462, with the
✕ in #512). The writer, `amendRow`, is merged (11c-i, #539). What is missing is the Server Action
that connects them, and the page passing it. Until then the screen hides Change
(`day-screen.tsx:29`).

This PR also carries:

- **C28's rewording.** Invariant 14 of the day-page guide and two comments in `row-values.ts`
  (lines 136 and 221) say "the item's unit"; since C28 the writer judges a Change in the unit the
  row was LOGGED in (`loggedRowUnit`, `pieces.ts:514`). The screen's rule stays stricter: a row
  logged in another unit is not offered Change. This is L45's owed rewording
  (`fam-1-family-program.md:1155`).
- **The owed tests** (`owed.test.ts:30-33`): the action matrix; an e2e on real data (a weight ×
  reps set and a superset, with a number changed); Change's typed states at 44px and 360px with axe.

**Not in this PR** (panel, round 1):

- **Changing a row logged in another unit** (the board's 2026-11-17 relay; C28's screen half).
  `textOf`, `readNumber`, `readAmend` and `item-card.tsx` all read `item.unit`, and the set table has
  no room for a per-row unit at 360px. **Decided** _(roadmap thread, under the maintainer's
  overnight delegation, 2026-11-18)_: not in 12d; such a row stays read-only, as contract
  invariant 27 (C28) records. A follow-up PR with its own UX panel picks one of three forms (reps
  only with the quantity as text; read-only plus a line saying how to re-log; the full switch with
  the unit under the field), and that choice goes to the maintainer.
- **The two #512 follow-ups**: Escape from the ✓ or ✕, and a ✕ press dragged off. Their own small
  lane C PR straight after this one. The drag-off fix needs lane S's
  `components/ui/inline-edit-actions.tsx`, and must not turn an iPhone tap on ✕ into a save.

**Roadmap alignment (2026-11-18):** advances `FAM-1` lane C on the critical path. 12d gates step
15 (D39: a household is not put on a program before a logged number can be changed on the page).
It is gated by 11c-i (#539) and 12c (#567), both merged. `page.tsx`'s seam queue is now 12c → 12d →
B2 → 12f (board, 2026-11-18; recorded in §6 by the roadmap thread). `ID-1`: nothing new is stored
or keyed; the action is a new caller of the amend writer, which keeps 11c's recorded trade-off (an
athlete who moves household cannot change rows logged under the old one's programs). Checked
against the private roadmap; nothing to add here.

## Acceptance

From plan §5, row 12d, verbatim: _"E `row-actions.ts`: Change (`amendRow`)". Tests: "the
inherited matrix; e2e on the fixture athlete, now on real data: a weight × reps set and a superset
(the strength e2e 3b-page deleted comes back here), change a number; an older day refuses"._

Done when:

- On today or yesterday, a logged number on a program row can be typed over, saved (focus leaves the
  row, Enter, or the ✓), and it survives a reload. Undo and ✕ work as on the preview.
- `amendRowAction` passes the inherited action matrix: no session, wrong household, bad body, and a
  limiter refusal.
- A crafted amend the writer refuses (`closed_day`, `bad_value`, `not_found`) is answered as the
  writer answered it, and the page is not revalidated.
- Change's typed states (typed over, changed with Undo, kept) pass axe and 44px targets at 360px on
  real data.

## File-by-file changes

| File                                                         | NEW/EDIT | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib/dal/day/day.ts`                                | EDIT     | `amendDayRow(input: RowAmend, today)`, the shape of `untickDayRow` (l.80): the scope, then `quietDbErrors('amendRow', () => amendRow(db, { scope, today, input }))`. An entry id only, so a `not_found` is answered and not reported, as un-tick does.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/web/app/p/[profileId]/row-actions.ts`                  | EDIT     | `amendRowAction`, the fourth action, the same body as the other three: Sentry's wrapper, `enterMutation(TRANSPORT_REFUSALS, ROW_WRITE_RATE_LIMIT)`, then `writeRow(rowAmendSchema, input, amendDayRow)`. The docblock drops "amendRow (12d) … not here yet".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/web/app/p/[profileId]/row-actions.registry.ts`         | EDIT     | `amendRowAction: { refusal: TRANSPORT_REFUSALS, scope: ACTION_SCOPE.profile }`. That one row puts it in every boundary matrix (`describeActionMatrices`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/web/app/p/[profileId]/page.tsx`                        | EDIT     | `dayActions` gains `amendRow: amendRowAction` (l.135), and the import; its comment (l.132-133, "Change (`amendRow`) arrives at 12d") names only 15c's `reorderPrograms` as still absent. In the seam queue's 12d slot; before merge, `git grep -n "12c (C) → 12d" origin/main -- docs/plans/fam-1-family-program.md` must find §6's line, or the PR body links the board's decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/web/components/day/row-values.ts`                      | EDIT     | Comments only (l.136, l.221, and `canChangeValues`' at l.226): the writer judges in the logged unit (C28); the screen offers Change only where the logged unit is the item's, which is stricter. No logic change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/web/app/p/[profileId]/row-actions.test.ts`             | EDIT     | `amendRowAction` beside the other three: the DAL gets the parsed input and the zone's today; a success revalidates and answers field by field; each writer refusal (`closed_day`, `bad_value`, `not_found`) passes through and does not revalidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/web/e2e/day-page.spec.ts`                              | EDIT     | `card`/`tick` take a workout name, and `logDay` a workout, instead of being tied to Morning habits. A new serial `Change` group, on Athlete Two (Athlete One's rows belong to the existing groups): on the first of today or yesterday where the fixture's superset workout runs (Heavy A or Heavy B, names from `todayTwoPrograms`, never re-typed; Tuesday and Thursday are Conditioning and Sunday has no workout, but today or yesterday always reaches Heavy A or B), start from a known ✓ state (as the existing group does), change the weight to a value derived from the one shown (so a retry is not a no-op), Undo it, then change it again, leave the row, reload, and see the new number (Undo's baseline lasts one page visit, so it is checked before the reload); change the superset partner's reps the same way. Then, at 360px, the typed-over, changed and kept states pass `expectNoAxeViolations` and `expectTapTargets` (`e2e/a11y-checks.ts`). |
| `apps/web/components/day/owed.test.ts`                       | EDIT     | The matrix and real-data lines are deleted. The typed-states line narrows to the one state not reached: `failed` (a write that fails cannot be provoked against the real server; `change.test.tsx:326-351` covers its copy and focus). A new line records that "an older day refuses" has no e2e (profiles are created today).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `docs/features/day-page.md`                                  | EDIT     | Invariant 14 in C28's words; the map's `row-actions.ts` and `day.ts` rows name four row writes; the 12d row in the step table; `page.tsx`'s queue.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `docs/changelog/2026-11-18-feat-fam-1-12d-change-on-page.md` | NEW      | The fragment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `docs/plan.md`, `docs/roadmap.md`                            | EDIT     | Link this plan from the `FAM-1` row; move 12d in the roadmap's In flight, or say none moved.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

About 220 lines with tests. One PR. The PR body embeds the milestone's progress chart.

## Test plan

- **Unit** (Vitest): `row-actions.test.ts` as above; the matrix through the registry.
- **e2e**: CI's `e2e` job, and `e2e:local` once with the heavy slot.
- **"An older day refuses"**: not reachable end to end, since the page floors at yesterday for a
  profile created today (12c's recorded gap). Covered by the action test (a `closed_day` answer
  passes through and does not revalidate) and by the writer's window, which 11c-i proves on
  `db:verify`. Recorded in `owed.test.ts`.
- **Replay**: the amend has no `clientId` by design (11c's A8: replay is by state). Against a mocked
  DAL a replay test cannot fail, so none is written here; 11c-i's writer proof is the evidence.

## Risks / rollback

- **The action is a public endpoint** from the moment the page imports it (12c's note: Next 16
  forwards an action id POSTed to any App Router path). The matrix and `writeRow`'s order (schema,
  then the athlete in the household, then today, then the writer, which checks the entry in the
  scope and the day's window) are the boundary.
- **A load in the wrong unit**: not reachable here. The screen still refuses Change on a row logged
  in another unit, and the writer refuses a quantity not in the logged unit (`fillRowValues`).
- **Rollback**: revert the PR. The page then hides Change again. No data shape changes.

## Out-of-scope / deferred

- Changing a row logged in another unit (above; its own PR and panel).
- The #512 follow-ups (above; their own PR).
- An "edited" marker on a changed row (a contract question, recorded at 13b-ii).
- C32's supervision label (waits for lane E's resolver field).
- Changing a row on an older day (D20: read-only by decision).

## Open questions

None for this PR. The unit question is decided for 12d (above); the follow-up's form is the
maintainer's choice when it is planned.

## Review-response log (adversarial panel)

### Round 1 (six lenses, Opus 5.5; the Fable spend limit runs until 2026-11-19)

| #                  | Lens                               | Critique (short)                                                                                                             | Verdict      | Resolution                                                                                                    |
| ------------------ | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------- |
| S1                 | Scope                              | The unit switch is under-planned and was owed only as a reword (L45)                                                         | **accepted** | Cut to its own PR; reword only; question to the roadmap thread                                                |
| R1, A2, U2, U5, T1 | Reuse, architecture, UX 1+2, trust | `textOf`, `readNumber`, `readAmend`, `item-card.tsx` all read `item.unit`; `changeUnit` duplicates `loggedRowUnit`           | **accepted** | Moot here (the switch is cut); handed to the follow-up: one derived Change item, `item-card.tsx` in its table |
| T2, U4             | Trust, UX 1+2                      | No room for "lb" beside a 64px load field at 360px; reps-only or read-only-with-a-line are better options                    | **accepted** | Handed to the follow-up's UX panel, with the width math                                                       |
| S2                 | Scope                              | The #512 follow-ups are a separate concern                                                                                   | **accepted** | Their own lane C PR after 12d                                                                                 |
| A4, U1             | Architecture, UX 1+2               | On touch, `pointerleave` fires on every tap: the drag-off fix would save what ✕ discards                                     | **accepted** | Moves with the follow-ups; that PR fires the touch order in a component test                                  |
| R4, A3             | Reuse, architecture                | The ✕ fix needs lane S's `inline-edit-actions.tsx`                                                                           | **accepted** | Moves with the follow-ups                                                                                     |
| R2, U3, A7         | Reuse, UX 1+2, architecture        | Escape handled twice; focus lost when ✕ goes; `onRowKeyDown` doesn't exist                                                   | **accepted** | Moves with the follow-ups                                                                                     |
| A1                 | Architecture                       | `page.tsx` is outside §6's queue                                                                                             | **accepted** | Board, 2026-11-18: 12c → 12d → B2 → 12f; not moving `dayActions` out (keep 12d small)                         |
| S3, R5, A5         | Scope, reuse, architecture         | The owed a11y line names four states and 44px; the plan covered two and axe only                                             | **accepted** | Three states and 44px in the e2e; `failed` stays owed, with why                                               |
| S5, A5             | Scope, architecture                | "The owed line stays, renamed" names a line that doesn't exist                                                               | **accepted** | A new owed line records the older-day gap                                                                     |
| S4                 | Scope                              | The replay test against a mocked DAL can't fail                                                                              | **accepted** | Dropped; 11c-i's writer proof is cited                                                                        |
| R6                 | Reuse                              | The e2e should generalise `card`/`tick`/`logDay`, and take Heavy A/B names from the fixtures                                 | **accepted** | In the e2e row                                                                                                |
| A6                 | Architecture                       | `day.ts`'s guide row, the roadmap, the milestone chart                                                                       | **accepted** | In the docs rows and the PR body                                                                              |
| R7                 | Reuse                              | `changeUnit` is already a verb elsewhere                                                                                     | **moot**     | The helper is cut                                                                                             |
| C1                 | Correctness                        | On touch the drag-off fix saves what ✕ discards; clear the flag before `commit`                                              | **accepted** | Moves with the follow-ups, with the touch-order test the lens wrote                                           |
| C2                 | Correctness                        | The logged unit misses `readAmend`'s three reads, `textOf`, `fieldSpoken`, `item-card.tsx`; an lb edit would vanish silently | **accepted** | The switch is cut (decided, above); the lens's probe goes to the follow-up                                    |
| C3                 | Correctness                        | Escape runs twice from the field; focus falls when ✕ unmounts                                                                | **accepted** | Moves with the follow-ups                                                                                     |
| C4                 | Correctness                        | Chrome focuses ✕ on mousedown, so a dragged-off edit still never sends                                                       | **accepted** | Moves with the follow-ups: a row-level `focusout` whose `relatedTarget` is outside the row                    |
| C5                 | Correctness                        | The replay test can't fail; cite db:verify's "Change 8"                                                                      | **accepted** | Dropped; cited                                                                                                |
| C6                 | Correctness                        | The owed line is deleted at half coverage                                                                                    | **accepted** | As S3                                                                                                         |
| C7                 | Correctness                        | e2e retry safety; the weekday claim was wrong                                                                                | **accepted** | Known ✓ start, a derived value, Undo before reload; claim corrected                                           |

### Decisions taken during the round

- **The unit switch** _(roadmap thread, under the maintainer's overnight delegation, 2026-11-18)_: (A), reword only; the follow-up's form is the maintainer's choice.
- **`page.tsx`'s queue** _(board, 2026-11-18)_: 12c → 12d → B2 → 12f; recorded in §6 by the roadmap thread.

A light re-review of rev 2 (architecture, Opus, medium effort) found no blocking concern; its two SHOULDs (§6's queue line on `main` before merge; the stale `page.tsx` and `day-screen.tsx` comments) are in the file table. No lens's BLOCKING finding survives rev 2: every one is either cut with its part (S1, A2, A4, U1, U2, T1, T2, C1, C2) or fixed in the text (A1, C7).
