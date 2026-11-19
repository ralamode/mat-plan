# FAM-1 step 15c: Program order, wired

> Backlog: [plan.md](../plan.md) row FAM-1, step 15c of [the FAM-1 plan](./fam-1-family-program.md)
> (row 15c, `fam-1-family-program.md:632`). Branch for this plan: `docs/fam-1-15c-program-order-plan`.
> Lane C builds it. Three code PRs, named **15c PR 1–3** here.
>
> **Approved** _(maintainer, 2026-11-19: "Approve (Recommended)")_. Drafted by the plan owner on 2026-11-19 at
> the maintainer's request, from lane C's notes, each checked against the code. Hardened by a
> five-lens panel the same day (the log is at the end). Amended the same day for the maintainer's
> answers to Q5 and Q6: "Links in 15c; cap at 50" (the Amendment section).

## Where this sits

- **Pillar:** FAM-1, the family program. **Milestone:** [FAM-1](../milestones/fam-1-family-program.md).
- **What this is:** the step where an athlete on several programs sets their order from their day
  page. The pieces exist: the writer (6d-ii, #633), the day's read with `endsToday` (C37, #637), the
  dialog and the button (13d, #433, on the preview only), and the day page (12c, #567). The real
  page passes no reorder action (`app/p/[profileId]/page.tsx:133-140`), so the control is hidden
  (`components/day/program-line.tsx:26`, `:34`).
- **Before it:** every gate in the row is on `main`: 6d-ii #633, 6d-iii #641, 12c #567, 13d #433.
  **After it:** step 16's acceptance (`docs/milestones/fam-1-family-program.md:191-195`).
- _Roadmap alignment (2026-11-19): advances FAM-1 step 15c. Adds no column, no scope and no role
  check. `docs/plan.md` and `docs/roadmap.md` were grepped for "program order" and "reorder": no
  other row owns this. `ID-1`'s six items are answered in the log below._

## Checked against the code

- **`apps/web/lib/dal/program/` is lane B's, not lane P's** as lane C's notes say: the lane table
  (`fam-1-family-program.md:684`), the builder's guide (`docs/features/program-builder.md:6`) and
  `lib/dal/day/importers.test.ts:33`. Lane P's writer is already exported
  (`packages/db/src/writers/program/index.ts:14`); lane P has nothing to add. See Q1.
- **No guide owns `components/ui/sheet.tsx`.** The notes call it lane B's; no `owns:` list under
  `docs/features/` names `components/ui/`, and `movement-picker.md:25` says it is not that guide's.
  The board settled it (Q2): it is lane B's.
- **The row's e2e is one journey** (two programs, reordered). The row lists the ending-today cases
  as dialog tests (`fam-1-family-program.md:632`). This plan does both.
- **D47 quotes the note in the singular.** The prototype also has a plural, for two or more
  (`docs/prototypes/beta-0/program-order-ends-today.html:3369-3377`). Both are built.
- **The prototype's explainer has a third sentence** the code lacks: "A program added later goes
  where it sits in the Programs list." (`docs/prototypes/beta-0/index.html:3313`;
  `components/day/day-copy.ts:116-117`). True since 6d-iii merged; PR 1 adds it.
- **The prototype disables the end arrows.** The code keeps them focusable with `aria-disabled`, a
  13d decision (`program-order-dialog.tsx:66-68`). Kept.

## Goal

On their day page, an athlete with two or more programs that stay opens Program order, moves a
program with ↑ or ↓, and the day's workouts follow, now and after a reload. A program whose last
day is today is shown as fixed. Nothing new is stored: the order is `program_assignments.idx`.

## Acceptance

Row 15c, verbatim (`fam-1-family-program.md:632`): **Program order, wired**: the reorder action joins
`DayActions`, and the Program order control appears. **The Reorder dialog lists a program ending today
below the movable ones with no arrows**, "N of M" counts the movable ones, and the Program order
button shows only when two or more programs stay (D47; the accepted prototype is
[`program-order-ends-today.html`](../prototypes/beta-0/program-order-ends-today.html), its two Jump
entries marked NEW; §8; it reads `endsToday`, contract change C37;
`components/day/program-order-dialog.tsx`, `program-line.tsx`). The order sent is still the full list.
Tests: e2e: two programs on one day, reordered; dialog tests for a program ending today (no arrows,
not counted, still in the order sent) and the button hidden with one staying.

Done when:

- On `/p/<id>`, "Program order" shows when all four hold: the day can be logged (today or
  yesterday), two or more programs are on the viewed day, two or more programs **stay** (D47), and
  the page supplies the action. With fewer than two staying there is no button. Two staying with
  only one on the viewed day (the second starts tomorrow) is also no button, as today
  (`program-line.tsx:27`).
- A move saves, the programs line and the workouts take the new order, and a reload shows the same.
- A program ending today sits under the note, by name with "· last day today", with no number and
  no arrows. A move says "{program} moved to N of M", M counting the programs that stay.
- The order sent holds every current program, the ending ones included.
- A refused save puts the list back and says why; a stale list re-reads the page. **The dialog
  never vanishes while it is open**: if the re-read leaves fewer than two staying, it stays up with
  its message until the person closes it.
- Each program's name on the programs line is a link to that program's page (the Amendment; D49).
- A list of more than 50 ids is refused as `invalid` before the writer runs (the Amendment; D49).

## File-by-file changes

### 15c PR 1: the dialog as D47 shows it, and the names as links (≈ 300 lines with tests)

Seen on the preview only: production still passes no action. **Gate: the contract owner's commit**
(Contract and preview, below), which lands first: the split of staying and ending programs, and a
fixture with two staying and one ending, so this PR can be shown beside both of the prototype's NEW
states (§8 of the FAM-1 plan, `fam-1-family-program.md:801-803`). Sheet is a guest edit (Q2).

| Path                                                                      | Change | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/program/` (the contract owner's commit, before PR 1) | —      | `programsByStay(programs)` answers `{ staying, ending }`, split on `endsToday === true` (`day-shapes.ts:257-266`). It would otherwise be a third copy of the rule the fake and the fixture builder already hold (`app/design/program/fakes.ts:346-347`; `fixtures/build.ts:211-212`), which then call it too. The server-rendered line and the client dialog both import it. PR 1 adds no helper of its own.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/web/components/day/program-line.tsx`                                | EDIT   | `canOrder` asks for two or more **staying** programs in place of two or more current ones (`:27`). The other three conditions stay: two programs on the viewed day, a writable day, the action supplied (`:19-22`). The docblock says so. **The line renders `ProgramOrderButton` whenever those three hold and passes it `canOrder`**: the client hides the button when `canOrder` is false but keeps its dialog mounted while it is open, so a re-read never unmounts an open dialog (`:34` unmounted both). **Links (the Amendment):** an optional `programHrefFor`; given it, each name on the line is a link to its program's page, and without it the names stay text. The docblock's "so the names are not links" (`:16-17`) is rewritten.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/web/components/day/program-order-dialog.tsx`                        | EDIT   | `order` stays the full list, so what is sent does not change (`:153-156`). (1) The numbered list maps `staying`; an end arrow is the first or last **of the staying** (`:203`); a move swaps inside `staying` with `moveUp` and `moveDown` as today (`lib/routine/editor.ts:32`; `:16`, `:194`) and rebuilds `[...staying, ...ending]` (`:192-200`). (2) Under the list, when any program ends today: the note, then a second list, a `<ul role="list">` named by the note (`aria-labelledby`), one row each: the name with `NAME_WRAP_CLASS` as the staying rows have (`:256`), then "· last day today" in the muted colour, kept on one line (`whitespace-nowrap`), its "·" hidden from a screen reader with a comma read in its place; no number, no buttons. A long unbroken name is the case to test at 360px: the name column is about 182px. (3) The announcement counts the staying: `PROGRAM_COPY.moved(name, place among the staying, staying.length)` (`:189`). (4) The U+00A0 trick goes (`:141-142`): `status` becomes `{ text, n }`, each announcement a new `n`, passed as `status` and `statusKey`. (5) One focus rule: whenever the arrow to refocus, or the arrow that has focus, no longer exists (its program now ends today, after a re-read or after a revert, where today's refocus is a silent no-op, `:134-139`), focus goes to Done, and Done is described by the error line while there is one. (6) Opened with fewer than two staying left (a stale refusal's re-read), the dialog shows what stays with both arrows `aria-disabled`, the note and the message; Done returns focus through the sheet's existing fallback to `main`. |
| `apps/web/components/day/day-copy.ts`                                     | EDIT   | `PROGRAM_COPY.endingNote(count)`: "This one comes off after today, so it is listed last and can’t be moved." and, for two or more, "These come off after today, so they are listed last and can’t be moved." "last day today" has one wording: the dialog calls lane B's `lastDayText(plan.today, plan.today)` (`components/program-builder/builder-text.ts:136-137`) where it prints the row, with no wrapper of its own; `day-copy.ts` already imports from there (`:3`). `orderExplainer` gains the prototype's third sentence. `moved` keeps its words (`:120`); only the count passed to it changes. The line's label ("Program:" or "Programs:") can be printed alone, for the linked line; `line` keeps its words (the Amendment).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/web/components/ui/sheet.tsx` · `sheet.test.tsx`                     | EDIT   | One optional prop, `statusKey?: number`, beside `status` (`:84-85`, `:398`), passed to the region as `messageKey` (`:603`; `components/ui/announcer.tsx:45-50`, `:70`). With no key the region renders as today, so the picker and the builder's two dialogs do not change. One test: the same `status` with a new key is a new node. About 6 lines and one test. Not lane C's file: Q2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `program-parts.test.tsx` · `day-notices.test.ts`                          | EDIT   | See Test plan. The three-program state is built in the test from `todayTwoPrograms`, as `program-parts.test.tsx:424-425` already does.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `docs/features/day-page.md` · `docs/tech-debt.md`                         | EDIT   | The two files' rows (`day-page.md:57-58`); the "one copy is left" note closes (`tech-debt.md:688-691`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### 15c PR 2: the action and its DAL function (≈ 210 lines with tests)

No page passes the action yet. Independent of PR 1. Q1 is answered: the DAL hunks are a guest edit.

| Path                                                                          | Change     | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/lib/dal/program/writes.ts`                                          | EDIT       | `reorderHouseholdPrograms(input: ProgramOrder, today)`, shaped as Put on and Take off (`:125-144`): `getHouseholdScope()`, lane P's `reorderPrograms(db, scope, input, today)` inside `quietDbErrors` (`packages/db/src/writers/program/reorder-programs.ts:39-44`), and on `not_found` the miss report. Lane B's file: Q1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/web/lib/dal/program/report-miss.ts`                                     | EDIT       | `reportAthleteMiss(scope, profilePublicId)`: the athlete probe `reportAssignMiss` already holds (`:156-160`), taken out as one helper both use. No new query. An archived athlete of this household is found, so the writer's `not_found` for them reports nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/web/lib/dal/program/revalidate.ts` · `apps/web/app/programs/actions.ts` | NEW · EDIT | `refreshAssignment` moves here from `app/programs/actions.ts:184-190`, unchanged, and that file imports it. Lane B's: a guest edit lane B reviews (Q1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/web/app/p/[profileId]/row-actions.ts`                                   | EDIT       | `reorderProgramsAction(input: unknown): Promise<ProgramResult>`, where the file says it goes (`:25-26`). The instrumentation wrapper with no options; `enterMutation(TRANSPORT_REFUSALS)` with the **default** limiter; `programOrderSchema`, else `invalid`; today from `getActiveLocalDay()`; one DAL call. A refusal is returned as it is. On success it calls the one rule that already revalidates after an assignment change, `refreshAssignment` (`app/programs/actions.ts:184-190`: the Programs layout, Home and the athlete's page), moved to `apps/web/lib/dal/program/revalidate.ts`, beside the DAL that owns the assignment, which both action files import (lane B's file and function: a guest edit in this PR, with the import swap in `app/programs/actions.ts`, reviewed by lane B under Q1). The id it passes is `parsed.data.profilePublicId`, which the schema hands back in lower case; never the URL's segment. The program page lists each athlete's other programs in their order (`packages/db/src/queries/program/program-view.ts:54`, `:111`), and Home's tiles do. The answer is `{ ok: true }`, built here. It does not use `writeRow` (`row-actions.ts:56-75`), which speaks `RowResult`. The module docblock is reworded: four row writes, and the order. |
| `apps/web/app/p/[profileId]/row-actions.registry.ts`                          | EDIT       | `reorderProgramsAction: { refusal: TRANSPORT_REFUSALS, scope: ACTION_SCOPE.household }`. Household, as Put on and Take off are (`app/programs/actions.registry.ts:9-10`): the writer's `lockAthletes` is the one check of the athlete (`reorder-programs.ts:54-55`). A registry may mix scopes (`app/p/profile-actions.registry.ts:25`, `:56`). The docblock's "each is profile-addressed" (`row-actions.registry.ts:8`) is reworded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/web/app/p/[profileId]/mutating-actions.test.ts` · `mutating-actions.ts` | EDIT       | The pinned, sorted list of household-addressed actions gains `'reorderProgramsAction', // FAM-1 15c, row-actions.ts` (`mutating-actions.test.ts:116-126`); without it CI fails. The docblock that defines the scopes says `profile` means "the body carries a `profileId`" (`mutating-actions.ts:67-71`): it is reworded to say a body may carry an athlete's id and still be household-addressed when the writer makes the one check of that athlete, as Put on and Take off are. Both files are the write path's (`docs/features/write-path.md`): a guest edit in its queue, placed by the board.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `row-actions.test.ts` · `program-dal.test.ts` · `report-miss.test.ts`         | EDIT       | See Test plan.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/web/components/day/owed.test.ts`                                        | EDIT       | Delete `:40` (a list that is not a permutation answers `invalid`): proved by lane P (`fam-1-6d-ii-program-order.md:99-101`), passed through by this action, and shown by the dialog as stale (`program-parts.test.tsx:398-412`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `day-page.md` · `program-builder.md` · `docs/privacy/data-inventory.md`       | EDIT       | The action's rows (`day-page.md:39`, `:67-69`); the DAL rows (`program-builder.md:99`, `:105`); "Called by no action until step 15c" (`data-inventory.md:315-317`) names the action. The privacy docs are a queue (`fam-1-family-program.md:732`): the board places the turn.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

### 15c PR 3: the control and the links on the real page, and the e2e (≈ 250 lines)

Waits for PR 1 and PR 2, so production never shows the dialog D47 replaced.

| Path                                                                            | Change | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/app/p/[profileId]/page.tsx`                                           | EDIT   | `reorderPrograms: reorderProgramsAction` joins `dayActions` (`:135-140`), which already reaches `ProgramLine` and `DayScreen` (`:223`, `:258`). The two "arrives at 15c" comments go (`:133-134`, `:221-222`), with `program-line.tsx:22` and `day-screen.tsx:29`. **Links (the Amendment):** `ProgramLine` gets `programHrefFor={programPath}` (`:223`), with `programPath` imported beside `PROGRAMS_PATH` (`:10`). `page.tsx` is a queued file with no turn for 15c (`fam-1-family-program.md:730`): Q4. |
| `apps/web/e2e/steps.ts` · `apps/web/e2e/program-builder.spec.ts`                | EDIT   | `openPrograms` and `createProgram` (`program-builder.spec.ts:61-78`), the copy onto every weekday (`:288-298`) and Put on from today (`:322-328`) move into `steps.ts` as helpers; the builder's spec and its a11y spec's `reachProgram` (`program-builder.a11y.spec.ts:49-55`) use them. The specs are lane B's: a guest edit that moves code and changes no step, reviewed by lane B (Q1).                                                                                                                |
| `apps/web/e2e/day-page.spec.ts`                                                 | EDIT   | The journey in Test plan, at 360px.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `owed.test.ts` · `day-page.md` · `docs/privacy/notice.md` · `notice-content.ts` | EDIT   | Delete `owed.test.ts:20` and `:39`. The notice's list of what anyone signed in can do (`notice.md:42-45`) gains "and change the order an athlete's programs show in"; `notice-content.ts` is regenerated (`pnpm --filter web privacy:generate`), and the notice's `Last updated` moves to the day of the commit (`docs/plan.md`, the pre-invite sign-off's done-when).                                                                                                                                      |

Each PR carries its changelog fragment, its `docs/status.md` and `docs/roadmap.md` move, and the
FAM-1 milestone chart in its description.

## What a person sees and hears

- **After a move:** focus stays on the arrow tapped (`program-order-dialog.tsx:132-139`). When the
  save settles, never before, the sheet's polite region says "{program} moved to N of M". M is the
  number of staying programs, which is also the length of the list a screen reader counts. The
  typed "1." is hidden from it (`:257`); the ending rows are a second list, read after the note.
- **A refused save:** the list goes back to the last order the server took
  (`program-order-dialog.tsx:163-170`), and each arrow is described by the error line (`:216`).
  "Couldn’t save. Try again." for `retry` or a dropped connection (`day-copy.ts:97`, `:121`). "This
  changed since the page loaded. Here are the programs now." for `invalid` and `not_found`, and the
  page re-reads (`day-copy.ts:98`, `:123`; `program-order-dialog.tsx:28`, `:171-173`). The writer
  answers `invalid` for a list made stale by a put on, a take off or midnight
  (`reorder-programs.ts:20-24`, `:65-70`).
- **A re-read that leaves fewer than two staying** (someone took the athlete off a program elsewhere): the dialog stays open with its message; only the button behind it goes. Nobody is left looking at a page with no dialog and no word of what happened.
- **After a save:** the action revalidates the day page, and the dialog adopts the page's new order
  once nothing is pending (`program-order-dialog.tsx:112-125`). _Unverified_ that a revalidation
  inside an action re-renders the open page with no reload; the row writes rely on it
  (`row-actions.ts:67-68`), and the e2e checks the page before its reload.

## Contract and preview

Nothing in `packages/shared/src/program/` or `apps/web/app/design/program/` has to change for the
code or its tests. The input and the member exist (`program-shapes.ts:529`, `actions.ts:142`). The
fake keeps an ending program last (`app/design/program/fakes.ts:343-348`;
`fakes.test.ts:845-859`). `coach-label-program-ending-today` has one program staying and one
ending (`fixtures/index.ts:446-458`), so after PR 1 its preview shows the "no button" state.

**The contract owner's commit, BEFORE PR 1** (one contract PR; PR 1 waits for it):

- `programsByStay(programs)` in `packages/shared/src/program/`, used by the fake and the fixture
  builder, with its tests.
- One new day fixture: an athlete on three programs, two staying and one whose last day is today
  (Q3). The preview then has both of the prototype's NEW states (`order-ending`, and
  `order-one-stays` through `coach-label-program-ending-today`), and the a11y walk scans both.

**The contract owner's commit, after PR 1:** `docs/features/program-contract.md:555-557` ("Until
lane C's dialog reads the flag, it still shows arrows there") is rewritten, and row 15c, §8 and the
milestone are updated. The harness passes `programHrefFor` (the Amendment).

## Amendment: links and the cap (maintainer, 2026-11-19)

The maintainer answered Q5 and Q6 with the approval: "Links in 15c; cap at 50" (FAM-1 plan decision
D49). Both fit the three PRs. Neither adds one.

**1. Links.** Each program's name on the day page's programs line becomes a link to that program's
page, inside this step and not in a later row.

- **Why now.** The accepted prototype has them: each name is a text button followed by "›", and the
  "›" is hidden from a screen reader (`docs/prototypes/beta-0/index.html:2566-2575`;
  `program-order-ends-today.html:2607`). The code left the names as text because the program pages
  were not wired when 13d was built (`program-line.tsx:16-17`). The pages are real since 7b-i (#636),
  so that reason has passed.
- **The prop.** `ProgramLine` (`apps/web/components/day/program-line.tsx`) gains an optional prop,
  `programHrefFor?: (programPublicId: string) => string`. Given it, each program's name on the line
  is a link to `programHrefFor(programPublicId)`. The link is named by the program's name, and the
  prototype's "›" follows the name inside the link, `aria-hidden`. Without the prop the names stay
  text, as today.
- **The sentence stays.** The line is still "Programs: A, B" (13d): the label and the commas are
  text between the links. The prototype sets the names apart with a gap and no comma; the commas
  are 13d's and are kept.
- **Every day the line shows.** A read-only day links too, and so does a program the athlete has
  since come off: an id in `plan.programs` is one the household can use now (contract change C21).
- **Size and wrap.** The link takes the class of the page's other inline link, `QUIET_LINK_CLASS`
  (`not-on-a-program.tsx:43`), which holds the 44px tap target (`min-h-11`), with `NAME_WRAP_CLASS`
  so a long unbroken name wraps at 360px.
- **Not built.** The prototype's "Since" tooltip on a name. The day's read carries no start date:
  a program on the line is an id and a name (`programRefSchema`).
- **15c PR 1** builds the prop, with a component test. With the prop: one link per program, each
  with the right `href` and name. Without it: no link.
- **15c PR 3** passes it on the real page: `programHrefFor={programPath}`. `programPath` is lane B's
  helper (`apps/web/components/program-builder/routes.ts:15`), in the module `page.tsx` already
  imports `PROGRAMS_PATH` from (`page.tsx:10`).
- **The contract owner's commit after PR 1** passes the preview's own href in the harness
  (`app/design/program/preview-harness.tsx:218`). Contract guide invariant 11: the harness mounts
  what the page does. The preview has no `/programs/<id>`, so the link opens one of the preview's
  own program page states, as its Programs link opens the preview's list. The preview walk then
  scans the links. **PR 1's own preview capture still shows plain names**, because lane C does not
  edit the harness. The linked line is first seen in that commit, and it is checked against the
  prototype's line there, at 360px.
- **Why no new PR.** PR 1 already edits `program-line.tsx`, `day-copy.ts` and
  `program-parts.test.tsx`. PR 3 already edits `page.tsx` at the `ProgramLine` it passes the prop
  to, and takes that file's turn. PR 2 does not change. PR 1 grows by about 50 lines (about 20 in
  the line and its copy, about 30 of tests), from ≈ 250 to ≈ 300. PR 3 grows by about 10 (an
  import, a prop, the e2e's check and the guide's line), from ≈ 240 to ≈ 250. Both stay under 400.

**2. The cap.** `programOrderSchema.programPublicIds` holds at most 50 ids (`MAX_ORDER_PROGRAMS`,
`packages/shared/src/program/program-shapes.ts`).

- **Why.** The list had a minimum and no maximum, so the body was capped only by the framework's
  limit (the correctness lens, Co-X).
- **Where.** In the contract, in the contract owner's PR that records this approval. It merges
  before 15c PR 2.
- **What the action does.** PR 2's action parses with `programOrderSchema` first, so a longer list
  answers `invalid` before the writer runs. PR 2 adds one case: 51 distinct ids are `invalid` and
  the DAL is not called. The preview's fake parses with the same schema and answers the same.
- **What it is not.** It is not a cap on how many programs an athlete may be on: Put on has none.
  An athlete on more than 50 current programs could not reorder, and the dialog would show its
  stale-list message. That is accepted: 50 is far above any real use.

## Test plan

- **Component (PR 1), `program-parts.test.tsx`:** with two staying and one ending: two numbered
  rows; the ending row has its name and "last day today", no number, no button; the note in the
  singular, and the plural with two ending. ↓ on the first sends all three ids, the ending one last,
  and says "moved to 2 of 2". The last staying program's ↓ is an end arrow. One staying and one
  ending (`coachLabelProgramEndingToday`): no button. Three staying, none ending: no note. The same
  sentence twice is a new node with the same text. A re-read that makes the focused arrow's program
  end today puts focus on Done. Every existing case stays. Added by the panel: two staying with only one on the viewed day shows
  no button; a stale refusal whose re-read leaves one staying keeps the dialog open, with the
  message visible and announced, and focus on Done; a revert that removes the arrow to refocus puts
  focus on Done; the ending rows are a list named by the note, and a long unbroken name wraps
  inside the dialog. Sheet's `statusKey` gets a unit test (`programsByStay`'s are the contract's).
  **Links (the Amendment):** with `programHrefFor`, each program on the line is a link with the
  right `href` and the program's name, the "›" is not part of the name, and a long unbroken name
  wraps; without it the line holds no link.
- **Beside the prototype (PR 1):** a 360px capture of the preview's two fixture states next to the
  prototype's two NEW Jump entries, in the PR.
- **Action (PR 2), `row-actions.test.ts`:** the action joins `describeActionMatrices` (`:103-120`)
  with a `scopeMiss` binding that makes the DAL answer `not_found`, as
  `app/programs/actions.test.ts:186-195` does, and no `limit`, so the matrix holds it to the default
  limiter. `mutating-actions.test.ts:179-185` then proves it is not on the row budget. `mutating-actions.test.ts:116-126`'s pinned list gains the action. Hand-written:
  **another household's athlete id** (write-path invariant 13; `mutating-actions.ts:47-55`): the
  mocked DAL answers `not_found`, the refusal's bytes match the no-session one, and nothing is
  revalidated (the writer's own proof is `packages/db/scripts/verify/program.ts:3160`);
  a bad body is `invalid` and the DAL is not called, a list of 51 distinct ids among them (the Amendment); the DAL gets `(parsed, TODAY)` from the mocked
  day; `invalid`, `not_found` and `retry` pass through with nothing revalidated; a success
  calls `refreshAssignment` with the parsed, lower-cased athlete id; the `satisfies` pin (`row-actions.test.ts:91-96`) gains the member.
- **DAL (PR 2):** `program-dal.test.ts`, as Put on's block (`:286-332`): scope, the writer's
  arguments, no scope, the miss reported once, another refusal passed through.
  `report-miss.test.ts`: a foreign athlete id reports once; an archived athlete of the household
  does not.
- **e2e (PR 3), `day-page.spec.ts`, the row's journey at 360px,** on this run's own athlete and
  programs, never a seeded athlete or a fixture program (`program-builder.spec.ts:45-53`): two
  programs, each with a fixture workout on all seven weekdays; a new athlete is put on both from
  today. On their day page: open Program order; the dialog passes `expectNoAxeViolations`,
  `expectTapTargets` and `expectNoOverflowWithin`. The starting order is read from the dialog,
  never assumed. ↓ on the first: the status says `PROGRAM_COPY.moved(name, 2, 2)`, read from the
  copy module the spec already imports (`day-page.spec.ts:5`), never typed by hand. Done: the
  programs line and the workouts follow. **Reload: the same line and the same workout order.**
  The line's two names are links whose `href` is `programPath` of each program (the Amendment); the
  journey reads them and does not follow them.
  The ending-today states are not in the e2e (the scope lens): the dialog's tests hold them, the
  writer's ordering is lane P's proof (`verify/program.ts:3160`), and the preview's walk scans both
  fixture states.
- **Probes** (`pnpm probe`, RED before trusted): an action that drops `today`; a dialog that counts
  the ending program in M, or sends only the staying ids; a line that counts current programs.
- **db:verify:** none new. The writer, its replay and the ending-today rule are lane P's proofs
  (`packages/db/scripts/verify/program.ts:3160`). The e2e runs in CI, or locally on the board's slot.

## Alternatives considered and rejected

- **Let the day DAL call the writer** (widen `DAY_DAL_MAY_IMPORT`). The board refused it
  (`fam-1-6d-ii-program-order.md:54-56`); the day DAL keeps its one lane P import.
- **A profile-addressed action**, as the four row writes are. Two checks of one athlete with two
  rules (`getProfileByPublicId` finds an archived athlete, `lib/dal/profiles.ts:206-208`; the writer
  refuses one, `reorder-programs.ts:32-33`), and a DAL function that leaves an id unreported
  (`writes.ts:45-47`).
- **Its own action module, or `app/programs/actions.ts`.** The first is a third registry and test
  file for one action; `row-actions.ts` is the one module the day page imports for `DayActions`
  (`page.tsx:45`; `lib/dal/day/importers.test.ts:21-25`). The second is imported only by pages
  under `app/programs/` (`docs/features/program-builder.md:362-364`).
- **Wire first, D47 second.** Production would show, for a while, arrows that move nothing.
- **Send only the staying programs.** The writer refuses a shorter list as `invalid`
  (`reorder-programs.ts:63-70`), and the row says the full list.
- **The row-write limiter.** A reorder is not a row write (`lib/rate-limit.ts:64-84`), and a save
  in flight holds later taps back (`program-order-dialog.tsx:144-148`).

## Risks / rollback

- **The action is a public endpoint from PR 2's merge**, before any page passes it: the day page
  imports the module, so its action ids are in the build (`row-actions.ts:42-45`). Its checks and
  its matrix land with it.
- **A list that changes under an open dialog.** After midnight, a put on, or a take off that removes
  a program, the next move is `invalid`: the dialog says so and re-reads. A take off that leaves the
  program on for today is accepted, and the re-read shows it under the note. If fewer than two then
  stay, the button goes and **the open dialog stays** (the UX lens's blocking finding: unmounted,
  it took its message with it and dropped focus to `<body>`, since the sheet's close handler never
  runs on an unmount, `sheet.tsx:463-480`). A PR 1 test pins it.
- **Two people reorder at once.** The last one wins (`docs/features/program-writers.md:62`).
- **The e2e spends one athlete slot a run** (`program-builder.spec.ts:50-53`), as the builder's
  own journey does.
- **Rollback:** each PR reverts on its own. Reverting PR 3 hides the control; saved orders stay and
  still sort the day. PR 1 is not reverted while PR 3 is live.

## Out-of-scope / deferred

- **The Put-on dialog's order hint**, lane B's string, still says a program "goes after their other
  programs" (`components/program-builder/builder-text.ts:690-695`). False since 6d-iii; to the board.
- The fake accepting an archived athlete's reorder (`program-contract.md:560-562`): the contract
  owner's known gap. Drag to reorder. A cap on an athlete's programs
  (`fam-1-6d-ii-program-order.md:124-125`). Home's tiles (15 PR 3, lane B).
- **Moved into this step on 2026-11-19** (the Amendment): program names as links on the day page's
  line, and a bound on the order's list. Both were listed here until the maintainer answered Q5 and Q6.

## Open questions

- **Q1, answered by the board (2026-11-19): lane C, as a guest edit.** Lane C adds
  `reorderHouseholdPrograms` in `lib/dal/program/writes.ts` and the `report-miss.ts` helper inside
  15c PR 2, and lane B reviews those hunks, the move of `refreshAssignment` to
  `lib/dal/program/revalidate.ts` with the import swap in `app/programs/actions.ts`, and the e2e
  helper move in PR 3. Lane P has nothing to change.
- **Q2, answered by the board (2026-11-19): `components/ui/sheet.tsx` is lane B's**, and lane C
  adds `statusKey?: number` in 15c PR 1 as a guest edit lane B reviews.
- **Q3, answered by the contract owner (2026-11-19): yes, and before PR 1.** A fixture with two
  programs staying and one ending today joins the contract in the contract owner's commit that
  gates PR 1 (Contract and preview), so PR 1 can be captured beside the prototype's main NEW state
  and the a11y walk scans it.
- **Q4, answered by the plan owner (2026-11-19): 15c PR 3 takes `page.tsx` when it is ready.** Its
  edit is one property and two comments. The queue ended "B2 → 12f" and named no turn for 15c or
  12c-iii (`fam-1-family-program.md:730`); the plan owner adds both turns when this plan merges,
  and the board orders them against B2 and 12f.
- **Q6, answered by the maintainer (2026-11-19): "Links in 15c; cap at 50".** The order's list is
  capped at 50: a structural bound in the contract, so a huge body is refused as `invalid` before it
  reaches the writer (the Amendment; D49). Asked by the correctness lens. The plan owner had
  suggested 50, and had placed it in the commit before PR 1; it lands before PR 2, the PR that
  parses the list.
- **Q5, answered by the maintainer (2026-11-19): "Links in 15c; cap at 50".** Program names become
  links to their program page inside 15c (the Amendment; D49). The plan owner had recommended its
  own small row after this step; the maintainer chose this step.

## Review-response log (adversarial panel)

> Panel cost: correctness 85k · 2m32s, scope 68k · 1m08s, architecture 97k · 2m41s, reuse 62k ·
> 1m18s, UX (three sub-lenses in one pass) 69k · 1m19s.
> Models: high-stakes no · every lens: opus.

### `ID-1`'s six keep-open items

| #   | Item                                                     | Answer                                                                                                                                                                               |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | The principal is a login, not a profile                  | No column links a profile to a login; the action acts for the signed-in login.                                                                                                       |
| 2   | Every access decision goes through `getHouseholdScope()` | The DAL function takes the scope first, and the writer locks the athlete inside it.                                                                                                  |
| 3   | "One household per person" is not relied on              | The scope comes from the session.                                                                                                                                                    |
| 4   | Nothing keys on (household, profile)                     | The order is `idx` on the athlete's own assignment rows; no new key, index or cache key.                                                                                             |
| 5   | No age-based permission logic                            | No `kind` or age check: any live athlete's programs can be reordered, an adult's included.                                                                                           |
| 6   | Roles are a const plus a CHECK                           | No role changes. **Who may do it:** any signed-in member (the 2026-11-06 authority model). Accepted: a member can reorder another adult's programs; a later grant would narrow this. |

### Engineering and UX panel

| #             | Lens                      | Critique (short)                                                                                                                                                                                                                                                                            | Verdict      | Resolution                                                                                                    |
| ------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------- |
| Sc-B1         | Scope                     | PR 1 has no preview state to put beside the prototype's main NEW state                                                                                                                                                                                                                      | **accepted** | The fixture is a gate for PR 1, in the contract owner's commit before it; a 360px capture joins the Test plan |
| UX-B1         | UX                        | The dialog can vanish while open, taking its message and dropping focus                                                                                                                                                                                                                     | **accepted** | The button's client keeps the dialog mounted while open; done-when, the dialog row, Risks and a PR 1 test     |
| Ar-B1 · Co-S1 | Architecture, correctness | The pinned list of household actions is missing, so CI would fail                                                                                                                                                                                                                           | **accepted** | `mutating-actions.test.ts` in PR 2's table and the Test plan                                                  |
| Sc-S1         | Scope                     | The e2e goes past the row: three programs, a ✓ and two Take offs                                                                                                                                                                                                                            | **accepted** | Two programs, a move, a reload; the ending-today states stay in the dialog's tests and the preview walk       |
| Re-S1         | Reuse                     | The three revalidations already exist as `refreshAssignment`                                                                                                                                                                                                                                | **accepted** | Moved to a shared server module both action files import; lane B reviews                                      |
| Re-S2         | Reuse                     | `programsByStay` would be the rule's third copy                                                                                                                                                                                                                                             | **accepted** | It goes in the contract, in the commit before PR 1; the fake and the fixture builder call it                  |
| UX-S2         | UX                        | "Focus goes to Done" misses the revert path                                                                                                                                                                                                                                                 | **accepted** | One rule in the dialog row, with Done described by the error                                                  |
| UX-S3         | UX                        | The ending rows' markup and wrapping are not specified                                                                                                                                                                                                                                      | **accepted** | A named `<ul>`, `NAME_WRAP_CLASS`, the suffix kept on one line; a long-name test                              |
| Co-S2         | Correctness               | Done-when omits the "two on the viewed day" condition the line keeps                                                                                                                                                                                                                        | **accepted** | All four conditions in done-when, and a component case                                                        |
| Ar-S2         | Architecture              | The foreign-id row a household action owes is not named                                                                                                                                                                                                                                     | **accepted** | In the Test plan, citing write-path invariant 13                                                              |
| Ar-S3         | Architecture              | The scopes' docblock says a body with a profile id is profile-addressed                                                                                                                                                                                                                     | **accepted** | Reworded in PR 2, as a guest edit in the write path's queue                                                   |
| NITs          | all                       | "`moved` keeps its words"; which id is revalidated; a citation off by six lines; the "·" read aloud; the list's element; no `lastDayToday` wrapper; `moveUp`/`moveDown` named; e2e copy from the copy module; `reachProgram` uses the moved helper; "is an unused export served" is settled | **accepted** | Each in its row                                                                                               |
| Co-X          | Correctness               | Outside the plan: the order's list has no maximum                                                                                                                                                                                                                                           | **raised**   | Q6, for the maintainer; the contract owner's file                                                             |

### Lane C's feasibility review (2026-11-19)

Buildable as written, sizes right (PR 3 may run a little over 240, still under 400). Two fixes taken: the fixture lands **before** PR 1 everywhere the plan says so (Q3 said "after"), and `refreshAssignment`'s new home is named (`lib/dal/program/revalidate.ts`). The privacy notice's change in PR 3 is a turn in the privacy docs' queue, placed by the board.

### Amendment (2026-11-19)

The maintainer approved the plan ("Approve (Recommended)") and answered Q5 and Q6: "Links in 15c; cap
at 50". Two changes, set out in the Amendment section. Program names on the day page's line become
links, built in PR 1 behind an optional prop, passed by the page in PR 3 and by the preview in the
contract owner's commit after PR 1; PR 1 is now ≈ 300 lines and PR 3 ≈ 250. The order's list is capped
at 50 in the contract before PR 2. Both left Out-of-scope. No panel re-read: neither adds a PR or a
file outside the PRs' tables. Two choices here are the plan owner's and not the maintainer's: the
line keeps 13d's commas between the links, where the prototype has a gap, and the prototype's
"Since" tooltip on a name is not built (the day's read carries no start date). Both are put to
the maintainer.
