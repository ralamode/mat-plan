# FAM-1 step 12c-iii: finished workouts and logged sections collapse to one line

> Backlog: [plan.md](../plan.md) row FAM-1, row 12c-iii of [the FAM-1 plan](./fam-1-family-program.md)
> (`fam-1-family-program.md:631`), decision D38 (`:97`). Branch for this plan:
> `docs/fam-1-12c-iii-collapse-plan`. Lane C builds it. Two code PRs, named **12c-iii PR 1 and PR 2**.
>
> **Approved** _(maintainer, 2026-11-19: "Approve (Recommended)")_. Drafted by the plan owner on 2026-11-19 at
> the maintainer's request, from lane C's notes. Panel round 1 is applied; its log is at the end.

## Where this sits

- **Pillar:** FAM-1, the family program. **Milestone:** [FAM-1](../milestones/fam-1-family-program.md)
  (`:328`, bar `c8`). The follow-up D38 owed after 12c: the page's order stays, and what is done gets smaller.
- **The accepted prototype:** [`day-collapse.html`](../prototypes/beta-0/day-collapse.html) _(maintainer,
  2026-11-18)_, v12 plus the fold; its Jump menu has the states `folded` and `foldedall` (`:1053-1054`).
  Every rule below is checked against it. The differences are Open question Q2.
- **Before it:** 12c (#567, merged). **Gates nothing**; not on the critical path (milestone `:349`).
- **Two PRs, where D38 said "its own small PR"**: one more in FAM-1's PR count. When the maintainer
  accepts the plan, the plan owner updates row 12c-iii, the milestone's count and the review log.
- **An earlier row, `UI-1`** (`docs/plan.md:1001`), decided two of the same things for the old strength
  form, and this plan takes both: derive the state from progress and store nothing (`:1028-1029`), and
  no native `<details>` around inputs, which stay mounted (`:1023-1026`).
- _Roadmap alignment: advances FAM-1 row 12c-iii; stores nothing, reads nothing new, adds no action.
  `ID-1`'s six items are answered in the log below._

## Goal

A person who comes back to a day that can be logged sees each finished workout, a logged Bodyweight
and a fully logged Life as one line, so the next thing to do is near the top of a phone. A tap opens
a line. Nothing folds while the person is working: what they finish during a visit stays where it is.

## Acceptance

Row 12c-iii, verbatim (`fam-1-family-program.md:631`): **Finished workouts and logged sections
collapse to one line** (D38; the accepted prototype is
[`day-collapse.html`](../prototypes/beta-0/day-collapse.html)). On a day that can be logged, a workout
whose every row is logged shows as one line: ✓, its name, its label (or its program, on a two-program
day with no label) and "10 of 10". A tap opens it, and an open finished workout has a "Collapse"
button. **It collapses when the person comes back to the day**: what is finished during a visit stays
open, so nothing moves under a thumb. Bodyweight collapses the same way once logged, and Life once
every Life item the athlete has is logged. A closed day and a future day never collapse. It is page
state only: `DayPlan` already gives each workout's rows, and nothing is stored. **It needs lane C's own
plan first**: which components hold the state, where focus goes after an open and a collapse, what a
screen reader hears, the a11y spec's states, and who edits Bodyweight and Life, which are lane S's
sections. Tests: per that plan: a component test for each rule above, focus and announcements, and no
sideways scroll at 360px. Gate: 12c · lane C's plan for it.

Done when:

- A writable day opens with each finished workout as one line: a tick, the name, the label (else the
  program's name on a two-program day) and the count. The first paint is already collapsed.
- The last ✓ of a workout during a visit leaves it open, now with "Collapse". A reload, or a change of
  day and back, shows it as one line. Bodyweight (one weight) and Life (every shown item) do the same.
- A tap on a line opens it and focus lands on "Collapse". "Collapse" folds it and focus lands on the
  line. "Collapse" is not offered while the part is busy (§4).
- A closed day, a future day and an archived athlete's day show no line and no "Collapse".
- Region names and heading levels are the same in both states, and both states pass axe, 44px targets
  and no sideways scroll at 360px.

## What the plan settles

### 1. Where the state lives, and what "coming back" is

- **A hook per part, `useCollapse(finished)`** (new, `components/day/use-collapse.ts`), holding one
  boolean, `folded`. Each workout card calls it; PR 2's wrapper calls it for Bodyweight and for Life.
  **Not a set owned by `DayScreen`**, as lane C's notes suggest: Bodyweight and Life are composed by
  the page beside the screen, not inside it (`app/p/[profileId]/page.tsx:233-258`), and the screen is
  not mounted for an athlete on no program with no rows (`components/day/day-notices.ts:83`).
- **"Finished when the person arrived" is the hook's initial state**, `useState(finished)`, read once
  when the part mounts. After that: `finished` turning false sets `folded` false for the rest of the
  visit (adjusted during render, as `workout-card.tsx:154-156` does); a tap on the line sets it false;
  "Collapse" sets it true. A part that mounts unfinished never folds by itself: the prototype's
  `seenOpen` rule (`day-collapse.html:2497-2511`).
- **A part mounts when a visit starts.** Lane C's VERIFY holds: the screen's body is keyed on athlete
  and day (`day-screen.tsx:76-78`; guide invariant 9, `docs/features/day-page.md:109`), so a change of
  `?d=` remounts every card. The page itself does **not** remount on a change of day
  (`bodyweight-section.tsx:62-66`), and the sections key their islands on the day only (`live-${day}`,
  `:60`, `life-section.tsx:65`). The wrapper's key adds the athlete: `fold-${profileId}/${day}`.
- **Coming back is** a new mount: opening the page (a link, the switcher, a typed address), a reload,
  and changing the day or the athlete and returning. **Not a new mount:** a save's own re-render
  (`revalidatePath`, `row-actions.ts:68`) and the Reload button on a stale row (`router.refresh`,
  `day-screen.tsx:140-143`). The prototype's visit is the same (`:2487-2494`, `:3534`).
- **The tab regaining focus, or the phone waking, folds nothing by itself. That is not a guarantee:**
  a browser that reloads the page on wake, or a Back button that gives a fresh mount (_unverified_
  whether it does), is coming back, and folds what is finished.

### 2. What "finished" means, and what never collapses

`finished` is the card's "Done ✓" test, `total > 0 && done >= total` on `workout.progress`
(`workout-card.tsx:43-50`), plus `notSaved === 0` and `!readOnly`. A day with nothing finished
renders what it renders today: no line, no button.

| Case                                            | Result, and what decides it                                                                                                                                                                                                            |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A closed day, a future day, an archived athlete | Never. One field decides: `readOnly` (`day-context.tsx:18-19`), which is `!plan.writable \|\| closed` (`day-screen.tsx:125`). `writable` is false on all three (`day-shapes.ts:224-229`), so `plan.future` needs no check of its own   |
| A ✓ that meets `closed_day` during a visit      | `closed` turns `readOnly` on, so every line opens. The notice at the top takes focus, as today (`day-screen.tsx:118-121`)                                                                                                              |
| A refresh brings another phone's un-tick        | The Reload button, or any save's re-render, can show a row another phone un-ticked. The part is no longer finished, so a closed line opens during the visit and the page below it moves. Accepted: the data changed. Focus: §4. Tested |
| Bodyweight and Life                             | The page's `writable` (`page.tsx:101-105`), which folds in archive (`bodyweight-section.tsx:38-40`). On a future day the sections are not rendered (`day-notices.ts:82`)                                                               |
| Sets added beyond the prescription              | Counted while logged: `total` is "the prescribed rows plus any logged beyond them" (`day-shapes.ts:178-179`). An added set not ticked yet is not in the data (`:119-123`): the workout is still finished, and busy (§4)                |
| A workout with no rows                          | Never: `total` 0 never reads as done (`workout-card.tsx:46-47`). A workout no longer live is 0 of 0 (`day-shapes.ts:182`)                                                                                                              |
| Shown only for its logged rows, on a closed day | Never: the day is read-only. `closed-day-logged-only` has Heavy B at 14 of 14 and stays open (`fixtures.test.ts:619-622`)                                                                                                              |
| A workout that left the week, on a writable day | Follows its count, which is the whole workout (`day-shapes.ts:178-181`): it folds only if all of it was logged                                                                                                                         |
| A row un-ticked after the workout was re-opened | The count drops when the save's data arrives: not finished, and already open. Ticking it back finishes it during the visit: still open, with "Collapse"                                                                                |
| A save that failed                              | `notSaved > 0` (`day-screen.tsx:162-163`) is not finished, so no "Collapse". The prototype's test has no such check (`:2587`; Q2 g). A write cannot start behind a line, nor be in flight when a part is collapsed (§4)                |
| The count lags the row                          | The count is the page's data; a row shows its own ✓ first (`use-row.ts:167-216`). "Collapse" appears when "Done ✓" does today                                                                                                          |

### 3. The collapsed line

- **Element:** a plain `<button type="button" aria-expanded="false" aria-controls={bodyId}>` inside the
  part's existing heading: the workout's `<h3>` (`workout-card.tsx:62`), a section's `<h2>`
  (`bodyweight-section.tsx:53`, `life-section.tsx:60`), as the prototype (`:2512-2525`, `:2593`). Not
  `Button`, which is `whitespace-nowrap` (`lib/constants.ts:191-192`, `components/ui/button.tsx:20`).
- **It shows** the filled tick of a logged row, the name, then `workout.label ?? programName`, then
  `DAY_COPY.progress(done, total)` (`day-copy.ts:60`) and a chevron. `programName` is already `null`
  unless the day has two programs (`day-screen.tsx:157-161`): with a label the program is not named;
  with neither, the name stands alone. The tick is inline today in lane S's
  `logged-value-row.tsx:30-35`; PR 1 moves it to one `DoneTick` (`components/ui/`) that both use.
- **Accessible name:** its content, with no `aria-label`, and a visually hidden ", " between its
  parts: exactly "Morning habits, Morning, 10 of 10"; with no label and one program, "Morning habits,
  10 of 10"; for Life, "Life, Wrestling practice 90 min". The tick, the "·" and the chevron are
  hidden from a screen reader. Tests assert all three names.
- **The region keeps its bare name in both states:** `aria-labelledby` moves from the heading to a
  `<span>` around the name alone. The prototype names a folded region by its whole line (`:2591-2597`,
  `:2781-2783`; Q2 f): "Bodyweight 84.5 lb". The e2e finds regions by exact name (`e2e/steps.ts:78-83`).
- **The slot line above the `<h3>`** (`workout-card.tsx:55-60`) is not rendered while folded: the line
  carries the label or the program. Open, it is where it is today.
- **Colour:** `LOGGED_ROW_CLASS` (`lib/constants.ts:701-702`), the label and count in
  `done-muted-foreground`: the prototype's muted grey on the tint (`:1015`) is 4.27:1 here and fails
  AA (`app/done-tokens.test.ts:116`; `docs/design.md:93-95`). Focus ring: `Button`'s own classes
  (`button.tsx:20`), `focus-visible:ring-3 focus-visible:ring-ring`, 3:1 on the tint (`design.md:96-98`).
- **Size at 360px:** `w-full min-h-12 text-left` (the prototype's 48px, `:990`). Of the page's 328px
  (`page.tsx:169-170`), less 2px of border, 24px padding, a 24px tick, a 10px chevron, a 60px count
  (`shrink-0 whitespace-nowrap`) and four 10px gaps, the name and label get about 170px. Both carry
  `NAME_WRAP_CLASS` (`constants.ts:189`): a 30-character workout name or a 60-character program name
  (`packages/shared/src/programming.ts:136-138`) wraps, and the line grows taller.

### 4. Open, Collapse, busy and focus

- **The body is hidden, never unmounted**: one `<div id={bodyId} hidden>` around everything under the
  heading. A row holds this visit's typed text, its un-tick token and what it is waiting for the data
  to show (`use-row.ts:145-216`); unmounting would drop them. The prototype does not render a folded
  body (`:2589-2597`); the guide records that. _Unverified_: that no display class defeats `hidden`;
  the `div` carries none, and a test asserts the body cannot be reached by role.
- **"Collapse"** is the word, a ghost `Button` (`min-h-11` and the focus ring from its base,
  `button.tsx:20`) with `min-w-11`, in the open part's heading row: after "Done ✓" in a workout
  (`workout-card.tsx:61-76`; prototype `:2642`), beside the `<h2>` in a section. `aria-expanded="true"`,
  `aria-controls={bodyId}`, named "Collapse Morning habits" (`:2526-2537`). At 360px "Done ✓" and
  "Collapse" take about 140px and the row already wraps (`workout-card.tsx:61`).
- **"Collapse" is offered only while the part is finished and not busy**, as the prototype, where a
  section being edited is not done (`:2777`). A workout is busy while any of its rows has a write in
  flight (the screen's in-flight set, `day-screen.tsx:95-99`, fed by `use-row.ts:253-257`), a Change
  typed and not saved (`dirty`, `use-change.ts:171`), or an added set not ticked (`pendingExtra`,
  `set-table.tsx:95-97`). The last two report through a new `setRowBusy(rowKey, busy)` in the day's
  context, beside `setRowPending` (`day-context.tsx:24-25`); the screen hands each card one `busy`
  boolean, as it counts "N not saved" (`day-screen.tsx:162-163`). The sections' rule is in §5. So
  nothing typed, pending or failed is ever behind a line.
- **Focus after a tap:** to "Collapse" after the line is tapped, to the line after "Collapse": the
  prototype's targets (`:3936-3946`; lane C's notes keep focus on the line, but the open part has
  none). Moved by the repo's existing disclosure idiom, not a layout effect. The pattern, in full, so
  it stands if 12f deletes the file first: one number in state per target, starting at zero; the tap
  handler adds one to the target's number in the same handler that changes `folded`; a `useEffect`
  that lists only that number focuses the target's ref when the number is above zero
  (`strength-form.tsx:161-162`, `:199-204`, `:224-232`). So it runs after `open()` or `collapse()` and
  never after a change of `folded` that the data caused; at zero it does nothing, so a mount, and its
  second run under StrictMode, moves no focus. Each button also carries `aria-expanded` and an
  `aria-controls` that names a body which is always mounted, as that toggle does (`:221-222`).
- **Focus when a control goes away by itself** (a `closed_day`, a refresh with another phone's
  un-tick): the line goes when a folded part opens, and "Collapse" goes when an open part stops being
  finished. If the control that goes held focus, focus moves to the open part's name `<span>`;
  otherwise it is left where it is. The name span is a different element in each state (inside the
  line when folded, directly in the heading when open), so a cleanup cannot focus the old one. The
  island's pattern is used: the leaving control's ref cleanup sets a pending claim if it held focus
  and no tap caused it (after a tap the counter above moves focus), and the open span takes it, at once if it is mounted ("Collapse" went), else in its ref callback
  when it mounts (the line went) (`single-value-live.tsx:140-155`, `:172-186`).
- **The name span carries `tabIndex={-1}` and `FOCUS_TARGET_CLASS` (`constants.ts:721`) only while
  the part is open.** Folded, it sits inside the line's `<button>`, where a focusable child could
  trip axe's `nested-interactive` rule. The preview walk on `yesterday-half-done` confirms axe passes
  on the folded line (§6).
- **A screen reader hears** the focused button: "Collapse Morning habits, button, expanded", or
  "Morning habits, Morning, 10 of 10, button, collapsed". **Nothing goes through a live region**: the
  prototype's "Opened" and "Collapsed" (`:3939`, `:3945`) would be the same news twice, against guide
  invariant 7 (`day-page.md:101-103`). The screen's `Announcer` (`day-screen.tsx:200`) is not called.
- **Keyboard and headings:** native buttons (Enter, Space); the line is one tab stop. The `<h1>`
  (`page.tsx:173`), each section's `<h2>` and the hidden "Workouts" `<h2>` (`day-screen.tsx:168-170`),
  each workout's `<h3>` and each item's `<h4>` (`e2e/steps.ts:234`) keep their levels and ids.

### 5. Bodyweight and Life (lane S's sections)

- **The seam is a wrapper lane C provides**, `CollapsibleSection` (new, `components/day/`): a client
  component that takes over each section's shell (`<section>`, heading, body) and gets the
  server-rendered rows as children. Props: `headingId`, `heading`, `summary`, `finished`.
- **The island tells the wrapper it is busy, through a context.** The wrapper provides it and exports
  `useSectionBusy(busy)`, which counts callers that pass `true`, in an effect with a cleanup as
  `use-row.ts:253-257` does, so an editor that unmounts while open takes its count back off; outside
  a wrapper it does nothing.
  Two one-line calls in lane S's files (Q1): `single-value-amend.tsx` passes `editing || pending`
  (`:87-88`: an editor open, a save in flight), and the island, `single-value-live.tsx`, passes
  `alert !== null` (`:114-119`): its alert and live region are inside the body (`:219-238`). A
  context, not a callback: the sections are server components and cannot hand a function down. A
  failed Change keeps its editor open and shows the alert (`single-value-amend.tsx:109-110`), so it
  cannot sit behind a closed section.
- **Bodyweight passes** `finished={writable && logged.length === 1}` and the weight as the receipt
  prints it (`formatLoggedWeights`, `bodyweight-receipt.tsx:10-12`). **Two or more weights stay
  open**: the receipt treats them as a problem to resolve, with an "ask a parent" line (`:60-69`).
- **Life passes** `finished={writable && open.length === 0}`. The section already knows which items
  the athlete has (the routine's life keys, less Wake, `life-section.tsx:17-19`, `:51`), which are not
  logged (`open`, `:56`), and renders nothing with none to show (`:52`). The summary is exactly the
  prototype's (`:2829-2836`): a check item's label alone, minutes as "Wrestling practice 90 min",
  items joined with ", "; built from the labels map (`:54`) and `formatValueUnit` (`:86`).

### 6. The preview harness and the contract: no change

The preview mounts `DayScreen` with a named fixture (`app/design/program/preview-harness.tsx:182`,
`:213`), and a mount is an arrival. **`yesterday-half-done` already is "came back to a day with a
finished workout"**: writable, with Morning habits 10 of 10, Heavy A 4 of 17 and Evening stretch 3 of
3 (`fixtures.test.ts:431-437`); `yesterday-edited-after-logging` has Morning habits 10 of 10 through
an added set (`:546`). So the a11y walk, which scans every fixture state
(`e2e/program-preview-a11y.spec.ts:16-22`), sees the collapsed state with no new fixture. Its
tap-target scan skips controls that are not visible (`e2e/a11y-checks.ts:76`), and the harness's own
tests replace `DayScreen` with a recorder (`preview-harness.test.tsx:54`). **So this step has no
contract owner's commit.** The preview mounts no Bodyweight or Life; PR 2 is scanned on the real page.

## Alternatives considered and rejected

| Alternative                                                 | Why it lost                                                                                                                                                                                                                                              |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Collapse the moment the last row is ticked                  | The maintainer chose "When you come back" (D38). The card would shrink under the thumb that ticked it and the next card would jump up                                                                                                                    |
| Remember open and closed across reloads, in browser storage | Row 12c-iii: "nothing is stored". The state is derived from the day's data at each arrival; storage would also make the first paint differ from the server's                                                                                             |
| A native `<details>`                                        | `UI-1` ruled it out around inputs (`docs/plan.md:1023-1026`). Its toggle is the `<summary>` in both states, so the word "Collapse" in the open part would be a second control. _Unverified_ and not needed: how a heading inside `<summary>` is read out |
| A set of open ids in `DayScreen` (lane C's notes)           | Bodyweight and Life are outside it, and it is sometimes not mounted (§1)                                                                                                                                                                                 |
| One heading button in both states (lane C's notes)          | The open heading would be a button on finished workouts only, beside a "Collapse" that does the same thing                                                                                                                                               |
| Unmount the body when folded                                | Drops un-tick tokens and what a row is waiting for the data to show (§4)                                                                                                                                                                                 |
| Let "Collapse" hide a part that is busy (the first draft)   | A failed Change or a half-typed number would sit behind a closed line (panel item 1)                                                                                                                                                                     |

## File-by-file changes

### 12c-iii PR 1: workouts (lane C, ≈ 580 lines, about 330 of them tests)

**A size exception, stated:** over the 400-line target. Splitting is worse: the hook, the line, the
card and the busy rule are one behaviour, so a first half would ship either a "Collapse" with no busy
guard (the panel's blocker) or plumbing that nothing reads; and `program-builder.spec.ts` breaks the
moment a card can fold, so its fix must ride with the card. **One PR is the default. The builder may
choose lane C's alternative** if PR 1 grows in the build: a small PR 0 that lands first with the
`openWorkout` helper and its call sites in the existing tests (a no-op until a card can fold),
`DoneTick`, and the `setRowBusy` plumbing with nothing reading it yet. PR 0 would add an `it.todo`
to `owed.test.ts` for the reader, which PR 1 deletes.

| Path                                                                     | Change     | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/components/day/use-collapse.ts`                                | NEW        | `useCollapse(finished)` → `{ folded, bodyId, lineRef, collapseRef, nameRef, open, collapse }`: the initial state and the adjust-on-unfinished rule (§1), the two focus counters and the pending focus claim for a control that goes by itself (§4). ≈ 60 lines                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/web/components/day/collapsed-line.tsx`                             | NEW        | `CollapsedLine` (the button of §3) and `CollapseButton` (§4). Shared by the card and, in PR 2, the wrapper. ≈ 70 lines                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `apps/web/components/ui/done-tick.tsx` · `logged-value-row.tsx`          | NEW · EDIT | `DoneTick`: the filled tick, moved out of `app/p/[profileId]/logged-value-row.tsx:30-35`, which now renders it. No visual change. `logged-value-row.tsx` is lane S's file: a guest edit under Q1, in this PR because the line needs the tick                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/web/components/day/workout-card.tsx`                               | EDIT       | `finished` from `progress`, `notSaved` and `useDay().readOnly`; a new `busy` prop. The `<h3>` holds the name in a `<span id={headingId}>`: directly when open, with `tabIndex={-1}`; inside `CollapsedLine` when folded, without it. `CollapseButton` after the progress text while `finished && !busy`. The slot line only when open. The description and item list move into the hidden body `div`. ≈ 45 lines                                                                                                                                                                                                                  |
| `day-context.tsx` · `day-screen.tsx` · `use-change.ts` · `set-table.tsx` | EDIT       | `setRowBusy(rowKey, busy)` in the context; the screen keeps a `busy` set beside `inFlight` (`day-screen.tsx:95-99`) and passes each card `busy`; `useChange` reports `dirty` and the set table reports `pendingExtra` under its item's key, each in an effect with a cleanup, as `use-row.ts:253-257`. ≈ 35 lines                                                                                                                                                                                                                                                                                                                 |
| `apps/web/components/day/day-copy.ts`                                    | EDIT       | `DAY_COPY.collapse` ("Collapse") and `collapseLabel(name)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/web/components/day/day-test-utils.tsx` and three test files        | EDIT       | `mount` and `show` stay as-arrived. A new `openWorkout(name)` taps the line, then blurs, so focus is not left on "Collapse". Called only where an existing test acts on a workout that is finished in its fixture: about 15 tests (8 in `day-screen.test.tsx`, about 5 in `change.test.tsx`, 2 in `set-rows.test.tsx`; a scan for tests that mount `yesterdayHalfDone` or `yesterdayEditedAfterLogging` and name Morning habits or Evening stretch; tests on clones of those fixtures were not counted)                                                                                                                           |
| `apps/web/components/day/collapse.test.tsx`                              | NEW        | The rules of §1 to §4 (Test plan). ≈ 220 lines                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/web/e2e/steps.ts` · `apps/web/e2e/day-page.spec.ts`                | EDIT       | A strict `openCollapsed(region)` in `steps.ts`: it asserts the line is there, then taps it. A new test in the spec's 360px block (`:242`): finish the daily stretch, see it open with "Collapse"; reload, see the line; scan; open; scan; collapse                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/web/e2e/program-builder.spec.ts`                                   | EDIT       | `:334-338` ticks a one-item workout, reloads and reads the ✓. That workout MUST now arrive collapsed: the spec asserts the line, then `openCollapsed`, then reads the ✓. The journey also renames its copied workout to a 30-character unbroken name in the editor (the name field it fills at `:146`), so the line is measured at 360px (`:56`) with the longest name; _unverified_ that the copy's editor is reachable with the spec's helpers. **Lane B's spec** (`docs/features/program-builder.md:7`): a guest edit by lane C that lane B reviews. The board's clearance (Q1) covered lane S's files only, so this one is Q4 |
| `docs/features/day-page.md`                                              | EDIT       | A new invariant (the fold is page state, decided at mount, hidden not unmounted, never offered while busy), the new files, the differences from the prototype (Q2, and the hidden body), and `openCollapsed` under "Changing it"                                                                                                                                                                                                                                                                                                                                                                                                  |

### 12c-iii PR 2: Bodyweight and Life (≈ 370 lines, about 240 of them tests; after PR 1)

| Path                                                    | Change | What & why                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/components/day/collapsible-section.tsx`       | NEW    | `'use client'`. The shell of §5: `<section aria-labelledby>`, the `<h2>` with the name `<span id={headingId}>` (`tabIndex={-1}` only when open), `CollapsedLine` or the heading row with `CollapseButton`, the hidden body `div` around `children`, and the busy context with `useSectionBusy`. With `finished` false it renders today's markup. ≈ 70 lines                                           |
| `apps/web/components/day/collapsible-section.test.tsx`  | NEW    | Its states, focus, the bare region name, the key on athlete and day, no "Collapse" while busy. ≈ 110 lines                                                                                                                                                                                                                                                                                            |
| `bodyweight-section.tsx` · `life-section.tsx`           | EDIT   | The `<section>` and `<h2>` (`bodyweight-section.tsx:52-55`, `life-section.tsx:59-62`) become `<CollapsibleSection key={…} headingId="log-bw-heading" …>` (`"life-heading"`) with the props of §5; Life builds its summary. Lane S's files (Q1). ≈ 30 lines                                                                                                                                            |
| `single-value-amend.tsx` · `single-value-live.tsx`      | EDIT   | One `useSectionBusy(…)` call each (§5). Lane S's editor and island (Q1). ≈ 6 lines                                                                                                                                                                                                                                                                                                                    |
| `bodyweight-section.test.tsx` · `life-section.test.tsx` | EDIT   | Tests that mount a logged, writable section and then press Change (`bodyweight-section.test.tsx:116-128`, `:243-363`) open it first. New cases: one weight arrives as the line; two weights, a read-only day and a weight logged during the visit stay open; a change of day folds; no "Collapse" while the editor is open, a save is in flight or an alert shows. Lane S's files (Q1). ≈ 70 lines    |
| `apps/web/e2e/steps.ts`                                 | EDIT   | A conditional `openIfCollapsed(region)`, used only where the state depends on earlier steps or on a retry: at the top of `logBodyweight` (`:126-145`; its retry path reads the receipt), `logPractice` (`:173-188`) and `clearAnyPractice` (`:217-225`, which would otherwise find no Change button and return as if nothing were logged). A shared file; these helpers are lane S's (Q1). ≈ 15 lines |
| `apps/web/e2e/bodyweight-receipt.spec.ts`               | EDIT   | `:113-114` reloads after a log and reads the weight: it now asserts the collapsed line shows it. `:117-118` opens yesterday, which holds a weight, and presses Change: `openCollapsed` first. Lane S's spec (Q1). ≈ 4 lines                                                                                                                                                                           |
| `apps/web/e2e/day-navigation.spec.ts`                   | EDIT   | `:53-63` opens Athlete One's yesterday and expects the field or Change. The export spec may have logged that day first (`global.setup.ts:37-40`), so `openIfCollapsed` before the check. Lane C's own file: no guide's `owns:` lists it, the FAM-1 plan names it among the files row 12c edits (`fam-1-family-program.md:626`), and 12c (#567) last changed it. Not under Q1. ≈ 2 lines               |
| `apps/web/e2e/day-page.spec.ts`                         | EDIT   | A 360px test on a fresh athlete: log a weight and a practice, reload, both are lines; scan; open Bodyweight; no "Collapse" while its Change is open; Change saves; collapse. ≈ 40 lines                                                                                                                                                                                                               |

**Walked and needing no edit**, because the helpers above open first: `e2e/global.setup.ts:48` (it
logs a warm-up weight on Athlete Two's today, so later visits there arrive with Bodyweight
collapsed), `export-full-day.spec.ts:126`, `:132`, `log-bodyweight.spec.ts:69-117` (one visit; its
reload at `:183` reads only the date) and `a11y.spec.ts:369-372` (the helper leaves the receipt open,
so the scan at `:374` still sees it).

Neither PR edits `page.tsx`, `packages/shared/src/program/` or `apps/web/app/design/program/`. Each
carries its changelog fragment, its `docs/status.md` and `docs/roadmap.md` move, the FAM-1 milestone
chart in its description, and screenshots of both states at three widths.

## Test plan

- **Component, PR 1 (`collapse.test.tsx`), one test per row of §2 and per rule of §1 and §3:**
  `yesterdayHalfDone` arrives with Morning habits and Evening stretch as lines and Heavy A open; the
  line's exact accessible name with a label, with the program's name, and with the name alone; the
  last ✓ during a visit leaves the card open with "Collapse" (the fake hands back new props on one
  mount, `day-test-utils.tsx:54-76`); a new mount of that plan, and a change of `plan.day` and back,
  is a line; `closedDayLoggedOnly`, `archivedAthleteToday` and `futurePreview` show no line.
- **Busy:** no "Collapse" while a write is held in flight (`held()`, `day-test-utils.tsx:116-123`),
  while a Change is typed and not saved, and while an added set is not ticked; it returns when each
  settles. PR 2: none while the editor is open, a save is in flight or the alert shows.
- **Focus and announcements:** `document.activeElement` is "Collapse" after an open and the line
  after a collapse; a mount under StrictMode moves no focus; new props that un-finish a folded part
  open it and leave focus where it was; the same with focus on the line, and an open part un-finished
  with focus on "Collapse", put focus on the open name span; the folded span has no `tabindex`;
  a `closed_day` opens every line and the notice has focus; `aria-expanded` and `aria-controls` on
  both buttons; the status region's text is unchanged by either tap (`status()`,
  `day-test-utils.tsx:104`); the region's name and the heading levels are equal in both states.
- **Probes** (`pnpm probe`, RED before trusted): a hook that re-reads `finished` after mount; a body
  unmounted instead of hidden; "Collapse" offered while busy; a focus effect keyed on `folded`.
- **e2e at 360px:** the new tests, each with axe, tap targets and no sideways scroll in both states,
  as `day-page.spec.ts:258-260` does, and the builder journey's 30-character name. The preview walk
  covers the collapsed card (§6). By hand, before each merge: one pass with a phone's screen reader.
- **`components/day/owed.test.ts`:** this step adds no line and deletes none. An opened finished part
  is reached by a tap, which the preview walk cannot load (`program-preview-a11y.spec.ts:18-22`);
  each PR's own e2e checks it. If an e2e slips out of its PR, that PR adds an `it.todo` for "12c-iii:
  an opened finished workout passes axe, 44px and 360px (e2e)". The standing lines (`:41-42`) stay.
- **db:verify:** none. Run `pnpm test`, then `pnpm e2e:local` with the board's slot, otherwise CI.

## Risks / rollback

- **Existing tests assume everything is open.** Sure breaks: `program-builder.spec.ts:334-338`, about
  15 component tests on `yesterdayHalfDone` (PR 1's table), and the two specs in PR 2's table.
  `day-page.spec.ts` ticks three of Morning habits' ten rows (`:36-41`, `:75-101`;
  `fixtures.test.ts:285`) and should stay open: _unverified_ until CI runs.
- **The walk no longer scans the open form of two fixtures' finished workouts** (Q3); PR 1's e2e
  scans an opened one. **A correction is one tap further away** for a logged weight or a finished
  workout: accepted with the prototype, and the line still shows the weight and the count.
- **An added set left un-ticked keeps "Collapse" away for the rest of the visit.** Intended: it is
  unfinished business, and it goes on the next arrival, as today (`set-table.tsx:40`). A line can
  also open by itself when another phone's un-tick arrives, and the page below moves (§2).
- **Rollback:** each PR reverts on its own, PR 2 first if both go. Nothing is stored, so nothing is
  migrated or cleaned up.
- **Shared files and order.** `e2e/steps.ts` is shared with other lanes: merge `main` in before each
  push, and never rebase a pushed branch (`AGENTS.md:224-225`). Lane C's queued follow-up to #688
  (the other-unit note shown once per exercise; it touches `row-parts.tsx`'s `ItemHeading`,
  `set-table.tsx` and `use-row.ts`, as lane C reports) lands first. Then PR 1, which also edits
  `set-table.tsx` and `use-change.ts` and adds `setRowBusy` beside `setRowPending`. 12f's routine trim
  edits `life-section.tsx`'s Wake filter (`:17-19`), which PR 2 reads through `open` (`:56`):
  whichever of the two lands second merges `main` in first.

## Out-of-scope / deferred

- Reordering the page or moving finished parts down (D38 keeps the order); "Collapse all" or "Open
  all"; collapsing an unfinished workout, an item inside a workout, the program line or "This week".
- Remembering the state across reloads or devices. Anything on a closed or a future day.
- The old strength form's own collapse, which 12f retires with the form.

## Open questions

- **Q1, for lane S (through the board): who edits lane S's files?** In PR 1, `logged-value-row.tsx`
  (the tick moves out, no visual change). In PR 2, the two sections, `single-value-amend.tsx` and
  `single-value-live.tsx` (one line each), their two test files, the three helpers in `e2e/steps.ts`
  and `bodyweight-receipt.spec.ts`. **Answered by the board (2026-11-19): lane C makes them as guest edits, and lane S reviews.**
- **Q2, answered by the maintainer (2026-11-19): "Accept all six (Recommended)".** The six
  differences from the accepted prototype are (a), (b), (c), (d), (f) and (g); FAM-1 plan decision D50.
  - (a) Opening or collapsing is not spoken as "Opened" or "Collapsed": a screen reader reads the
    button that takes focus, which says the same thing once.
  - (b) No visible change: the heading level of a workout's line matches the rest of the app.
  - (c) The label and the count are a slightly darker grey, so the text can be read.
  - (d) Bodyweight stays open on a day with two or more weights, which the page marks "ask a parent".
  - (e) Withdrawn (panel item 1): "Collapse" is not offered during an edit, as the prototype.
  - (f) No visible change: to a screen reader a collapsed section keeps its plain name
    ("Bodyweight"), where the prototype names it by the whole line.
  - (g) A workout with a save that failed is not finished and stays open; the prototype ignores them.
- **Q3, answered by the contract owner (2026-11-19): accepted, with no new fixture.** Nothing is asked
  of the contract or the harness (§6). The a11y walk now sees two fixtures' finished workouts
  collapsed, so it no longer measures `yesterday-edited-after-logging`'s added set in the open; an
  opened part is reached by a tap, which no fixture can load, and PR 1's e2e scans one.
- **Q4, answered by the board (2026-11-19): yes.** Lane C edits lane B's
  `e2e/program-builder.spec.ts` (`:334-338`, and the rename near `:146`) as a guest edit in PR 1, and
  lane B reviews those hunks.

## Review-response log (adversarial panel)

> Panel cost: correctness 86k · 2m30s, scope 68k · 1m36s, architecture and reuse (one agent) 78k ·
> 1m47s, UX accessibility 66k · 1m29s, UX interaction and trust 61k · 1m18s.
> Models: high-stakes no · every lens: opus.

### `ID-1`'s six keep-open items

| #   | Item                                                     | Answer                                                                             |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | The principal is a login, not a profile                  | No column and no stored state: the fold lives in the page and ends with the visit. |
| 2   | Every access decision goes through `getHouseholdScope()` | No read, write or action is added; the step shows data the page already fetched.   |
| 3   | "One household per person" is not relied on              | Nothing here reads a household.                                                    |
| 4   | Nothing keys on (household, profile)                     | The only key is a component key of athlete public id and day, in memory.           |
| 5   | No age-based permission logic                            | No `kind` or age check: a child's and an adult's day collapse alike.               |
| 6   | Roles are a const plus a CHECK                           | No role is read. Anyone who can open the day sees the same lines.                  |

### Engineering and UX panel (round 1)

| #   | Lens                        | Critique (short)                                                                        | Verdict      | Resolution                                                                                                                                              |
| --- | --------------------------- | --------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Correctness, both UX lenses | Blocking: "Collapse" could hide an open editor, a write in flight or a failed Change    | **accepted** | §4's busy rule and `setRowBusy`; §5's busy context from the island and the editor; Q2 (e) withdrawn; Risks rewritten                                    |
| 2   | UX accessibility            | Blocking: where focus goes when a part opens by itself                                  | **accepted** | §4: focus moves only after a tap; a line that held focus hands it to the name span; tests added                                                         |
| 3   | Correctness                 | The Reload button can bring another phone's un-tick                                     | **accepted** | §2's row; a test; a Risks line                                                                                                                          |
| 4   | UX accessibility            | The line's name runs its parts together                                                 | **accepted** | §3: a visually hidden ", "; the test asserts the exact name                                                                                             |
| 5   | UX accessibility            | The line cannot wrap as a `Button`; width, slot line, target and ring unnamed           | **accepted** | §3: a plain `<button>`, the count `shrink-0 whitespace-nowrap`, about 170px, the slot line per state, the ring; §4: `min-w-11`; a 30-character name e2e |
| 6   | Scope                       | PR 2's e2e call sites were not walked                                                   | **accepted** | PR 2's table lists each file, its lines, its change and its owner; four sites need no edit; PR 2 is ≈ 370 lines                                         |
| 7   | Scope                       | Two PRs add one to FAM-1's count                                                        | **accepted** | "Where this sits": the plan owner updates the row, the count and the log on acceptance                                                                  |
| 8   | Scope                       | Q2 misses two differences and is not worded for a yes or no                             | **accepted** | Q2 gains (f) and (g) and is reworded; the guide's list also records the hidden body                                                                     |
| 9   | Scope, architecture         | `mount` and `show` should not open everything                                           | **accepted** | They stay as-arrived; `openWorkout(name)` at about 15 call sites                                                                                        |
| 10  | Architecture                | The builder spec's workout must arrive collapsed                                        | **accepted** | It asserts the line and uses a strict `openCollapsed`; `openIfCollapsed` is PR 2's, for helpers and one order-dependent spec                            |
| 11  | Architecture                | Use the repo's focus idiom, not a layout effect                                         | **accepted** | §4: counter state and `useEffect`, citing `strength-form.tsx`; its toggle is the precedent until 12f                                                    |
| 12  | Reuse                       | The filled tick would be copied                                                         | **accepted** | One `DoneTick` in `components/ui/`; PR 1 edits lane S's `logged-value-row.tsx` under Q1                                                                 |
| 13  | UX interaction and trust    | "The phone waking" is not a guarantee                                                   | **accepted** | §1: a reload on wake or a fresh mount on Back is coming back                                                                                            |
| 14  | Several (NITs)              | Done-when wording; the wrapper's key; `finished`'s wording; Life's summary; PR 1's size | **accepted** | Done-when bullet 5; §1's key adds the athlete; §2's first sentence; §5's summary; PR 1's size exception, now ≈ 580 lines                                |

### Re-review (correctness and accessibility, light pass)

Nothing blocking, and PR 1's size exception stands. Five points, all accepted.

| #   | Lens          | Critique (short)                                                                       | Verdict      | Resolution                                                                                            |
| --- | ------------- | -------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------- |
| R1  | Accessibility | Focus can fall to `<body>` from "Collapse" when another phone's un-tick arrives        | **accepted** | §4: "Collapse" hands focus to the name span as the line does; a test                                  |
| R2  | Correctness   | The name span is remounted between states, so a cleanup that focuses the old one fails | **accepted** | §4: a pending claim set in the cleanup and taken by the open span, as `single-value-live.tsx:172-186` |
| R3  | Accessibility | A `tabIndex={-1}` span inside the line's button may trip `nested-interactive`          | **accepted** | §4: the attribute only while open; the preview walk confirms axe on the folded line                   |
| R4  | Accessibility | Only the three-part name was given                                                     | **accepted** | §3: the name with no label and Life's name, each tested                                               |
| R5  | Correctness   | `useSectionBusy` must give its count back when a caller unmounts                       | **accepted** | §5: an effect with a cleanup, as `use-row.ts:253-257`                                                 |

Also settled by reading: `e2e/day-navigation.spec.ts` is lane C's (PR 2's table), not under Q1.

### Lane C's feasibility review (2026-11-19)

Buildable, and the core design is right. Four fixes and one NIT, all applied.

| #   | Point                                                                                | Where it changed                                                                                  |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| F1  | PR 1 edits lane B's `program-builder.spec.ts`; the board cleared lane S's files only | PR 1's table names a guest edit lane B reviews; Open question Q4, for the board                   |
| F2  | "Rebase before each push" contradicts AGENTS.md                                      | Risks: merge `main` in before each push                                                           |
| F3  | Order against lane C's queued work and 12f                                           | Risks: the #688 follow-up, then PR 1; PR 2 and 12f's routine trim, the second merges `main` first |
| F4  | PR 1 is about 580 lines                                                              | One PR stays the default; a small PR 0 is recorded as the builder's choice                        |
| F5  | NIT: §4 cites `strength-form.tsx`, which 12f deletes                                 | §4 describes the focus pattern in prose as well                                                   |
