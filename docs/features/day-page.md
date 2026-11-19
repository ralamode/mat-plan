---
feature: The day page's workouts (FAM-1 lane C)
owns:
  - apps/web/components/day/
  - apps/web/lib/dal/day/
  - apps/web/app/p/[profileId]/row-actions.ts
  - apps/web/app/p/[profileId]/row-actions.registry.ts
  - apps/web/app/p/[profileId]/row-actions.test.ts
  - apps/web/e2e/day-page.spec.ts
---

# The day page's workouts

**Read this before changing how a day's workouts are shown or logged.** This is **lane C** of the
[FAM-1 plan](../plans/fam-1-family-program.md) (§5, "Lane C").

## What this is

What an athlete sees and ticks on a day: the workouts of every program they are on, in their own
order, each item with its rows. The lane builds the screen against fixtures and fakes on the
preview route first, then wires the first real ✓.

🚧 **Built up step by step.** Step 13 built the workout cards and the single rows (Check, Duration,
Count) with their ✓; 13d the program line, Program order, the athlete switcher and the notices; 13b
the set rows, Previous, Add set, supersets and the look-ahead cards; 13b-ii Change, a logged number
edited in place. 12b wired the row writes; 12c mounted the screen on the athlete's page, with
look-ahead and the narrowed window. Each step adds its files and invariants here.

## The map

| Step   | Adds                                                                                                                                                                                                                                                        |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 13     | Workout cards and single rows, the optimistic ✓ and its failure state, in `day-screen.tsx` and its parts.                                                                                                                                                   |
| 13b    | Set rows, PREVIOUS, "+ Add set", linked supersets, the read-only look-ahead (`set-table.tsx`, `row-parts.tsx`).                                                                                                                                             |
| 13b-ii | Change: a logged number edited in place, for set rows and single rows (the maintainer split 13b, 2026-11-16).                                                                                                                                               |
| 13d    | `components/day/{program-line,program-order-dialog,athlete-switcher}.tsx`; the "not on a program" notices.                                                                                                                                                  |
| 12b    | `apps/web/app/p/[profileId]/row-actions.ts` (log, un-tick, re-tick) with its registry file; `lib/dal/day/day.ts`, `report-miss.ts`, `importers.test.ts`.                                                                                                    |
| 12c    | The screen joins `apps/web/app/p/[profileId]/page.tsx` (a seam shared with lane S, in the plan's §6 order), with the three placed parts, one state notice, look-ahead in `day-nav.tsx` and the today-and-yesterday window in `lib/entries/declared-day.ts`. |
| 12d    | Change on the day page: `amendRowAction` in `row-actions.ts`, `amendDayRow` in `lib/dal/day/day.ts`, and `amendRow` in `page.tsx`'s `dayActions` (§6's queue: 12c → 12d → B2 → 12f). 15c: program order. 12f: the old forms' code goes.                     |

## Files

| File                                                 | What it is for                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/components/day/day-screen.tsx`             | `DayScreen({ plan, actions })`. A section of the day page: the workouts, the island's live region, the failure count, read-only after a `closed_day`; the rest line and "No workouts logged" boxes.                                                                                                                                                                                                                                                                                                                                                                                                  |
| `apps/web/components/day/day-context.tsx`            | What every row of one day shares: athlete, day, actions, `readOnly`, `announce`, `reload`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/web/components/day/workout-card.tsx`           | One workout: slot line, name, progress ("2 of 10", "Done ✓", none at total 0), "N not saved", items.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/web/components/day/item-card.tsx`              | One item: an empty card on a look-ahead day, its single row (field, "Last time", ✓), or its set table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/web/components/day/set-table.tsx`              | A set-by-set item's table: Set, Previous, a column per field, ✓; "+ Add set"; every row shown this visit stays for the visit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/web/components/day/row-parts.tsx`              | What both rows share: the card's classes and tint, the heading (superset label, what logged rows were against), the ✓, a row's message, a number field.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/web/components/day/use-row.ts`                 | One row's writes (✓, un-tick, re-tick, a Change's `amend`), for a single row or one set: optimistic display, `clientId` per attempt, refusals, and the overrides that hold what this visit wrote until the page's data shows it (invariant 11). Its text is a row's fields (`RowText`).                                                                                                                                                                                                                                                                                                              |
| `apps/web/components/day/use-change.ts`              | Change (13b-ii): a logged row's edit, when it is sent, Undo's baseline, the line under the row, and what the ✓ means during an edit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/web/components/day/change-parts.tsx`           | Change's field (select-all on focus, Escape, Enter) and the line under a row ("Not saved. Was 30 lb." with an icon-only ✕ under the row's ✓; "Changed 30 → 35" with Undo; or the row's error).                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/web/components/day/row-values.ts`              | Pure: a row's fields (`fieldsOf`: a load and/or reps), reading what was typed (`readTyped`, D13's empty ✓, except a row un-ticked this visit whose load was logged in another unit, whose load must be typed: `other_unit`, H9, 12d-ii; `readAmend`, a Change), one number reader for both; what a ✓ stores and whether a Change can be sent are judged by the writer's own rule, the contract's `fillRowValues` (C10), so the screen cannot accept what the writer refuses; `canChangeValues` (the unit rule), comparing and formatting a row's values in the contract's spelling (`quantityText`). |
| `apps/web/components/day/day-notices.ts`             | `restNotice` and `nothingLoggedNotice`, both read through the contract's `showsOnlyLogged` (C23: neither writable nor look-ahead): the notices as pure functions of the plan, with no directive, so a server component can call them.                                                                                                                                                                                                                                                                                                                                                                |
| `apps/web/components/day/athlete-switcher.tsx`       | The household's athletes as first-name pills under the `<h1>`; a switch opens that athlete's today; hidden only when no one else is listed. Server-safe (no state).                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `apps/web/components/day/program-line.tsx`           | "Programs: A, B" (renders on the server), and Program order when the day has two programs, the athlete is on two now, the day is writable and `reorderPrograms` is supplied.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/web/components/day/program-order-dialog.tsx`   | `ProgramOrderButton` and the dialog (client code): ↑ ↓ per program; each tap saves the whole order; taps during a save are sent together, and the page's older order cannot undo them; a failure restores the last saved order; focus stays on the arrow tapped.                                                                                                                                                                                                                                                                                                                                     |
| `apps/web/components/day/not-on-a-program.tsx`       | "Not on a program yet" / "on this day". No link until the Programs page exists (`programsHref`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/web/components/day/day-copy.ts`                | Every sentence the screen says, and each refusal's copy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/web/components/day/*.test.ts(x)`               | The screen's tests over the fixtures and the preview's fake; `row-values.test.ts` for the pure helpers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/web/components/day/day-test-utils.tsx`         | The tests' shared harness (mount, queries). It holds no fake: a test file passes `createFakeDayActions` to `makeMount`, since only `*.test.ts(x)` may import the preview's fakes.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/web/components/day/owed.test.ts`               | The lane's `it.todo` list: the tests its steps still owe the contract. Delete a line in the PR that writes its test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/web/lib/dal/day/day.ts`                        | `getDayPlan` (lane E's resolver, handed `CATALOG_MOVEMENTS` for the coach label (C32), plus `athletes`, the household's live athletes) and the four row writes, each through the caller's scope with `today` as an argument, inside the shared `quietDbErrors`.                                                                                                                                                                                                                                                                                                                                      |
| `apps/web/lib/dal/day/report-miss.ts`                | `reportRowMiss`: on a ✓'s `not_found` only, which id missed the household, reported once through `reportScopeMiss` (C11). The workout first (`workoutInHousehold`), then the prescription (`prescriptionLiveIn`), first miss only. Never throws.                                                                                                                                                                                                                                                                                                                                                     |
| `apps/web/lib/dal/day/importers.test.ts`             | Pins that only `lib/dal/day/` imports the day's reads and row writers from `@mat-plan/db` (`workoutInHousehold` also from `lib/dal/program/`, for copy's miss report), and that only the day page imports `row-actions.ts` (a tripwire so a new importer is reviewed; the boundary is each action's own checks).                                                                                                                                                                                                                                                                                     |
| `apps/web/app/p/[profileId]/row-actions.ts`          | `logRowAction`, `untickRowAction`, `retickRowAction` and `amendRowAction` (12d, Change): the row writes of `DayActions`. Entry under the row limit, the contract's schema, the athlete, today from the active zone, one DAL call, revalidate the day page on success. Served since 12c, and to a POST on any route once built (Next 16 forwards an action id), so each action is its own boundary.                                                                                                                                                                                                   |
| `apps/web/app/p/[profileId]/row-actions.registry.ts` | Each action's refusal set and scope (`profile`), read by the boundary matrices.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/web/app/p/[profileId]/row-actions.test.ts`     | The inherited matrices under `ROW_WRITE_RATE_LIMIT`, then what they cannot say: `bad_value` before any read, today from the action, answers field by field, refusals passed through unrevalidated.                                                                                                                                                                                                                                                                                                                                                                                                   |

## Invariants

1. 🔴 **`DayScreen`, plus three parts the page places** (plan D34, decided by the
   maintainer for 13d, 2026-11-16). The day page mounts `DayScreen` with a `DayPlan` and a `DayActions`,
   once, since step 12c, after Bodyweight and Life. v12 puts three things above those sections, so
   they are their own components, given the **same `plan`** (and the same `actions` where they
   write): `AthleteSwitcher({ plan, hrefFor, className: 'lg:hidden' })` under the `<h1>` (the
   nav rail lists the athletes from `lg`), then
   `ProgramLine({ plan, actions })` and `NotOnAProgram({ plan, programsHref? })`. Everything else a
   later step adds lives inside the screen. The preview's day case mounts all four in the page's order (the contract owner's, #441), and 12c places them on the page. Their props are a contract with the page and the harness: change them through the contract owner.
2. 🔴 **The screen is a section, not the page.** The page keeps its `<h1>` and composes Bodyweight
   and Life before it; those sections and Clear this day are lane S's. Of the plan's own lanes only
   this one edits `page.tsx`, in the order the plan's §6 seam table gives.
3. 🔴 **A screen writes only through `DayActions`.** A member that is `undefined` is an action not
   wired yet, and the screen hides its control: Change arrives that way at 12d, and Program order
   (in `ProgramLine`, which hides it the same way) at 15c.
4. 🔴 **No production file imports a fixture or a fake.** They are preview and test data
   ([program-contract.md](./program-contract.md) invariant 4, held by a source scan). A screen's
   own `*.test.tsx` may. The tests'
   shared harness (`day-test-utils.tsx`) holds none either: each test file hands it the fake's
   factory, and mocks `next/navigation` for the screen's Reload.
5. **A ✓ is optimistic, and one attempt has one `clientId`** (plan D24, §4). If the write fails
   the row un-ticks, keeps what was typed and says so. When the retry reuses the `clientId`, and
   when a ✓ mints a new one, is invariant 11. `/design/program?screen=day&fixture=today-two-programs&fail=next`
   shows the failure.
6. **Each screen step is checked against its prototype states** (plan §8), at 360px on the preview
   route. The a11y scan walks every state a fixture can load there, so a step never edits a spec to
   add one. A state reached only by typing (Change's typed over, changed, kept, failed) is not
   scanned there; it is owed at 12d's e2e (`owed.test.ts`).
   13d's three page-placed parts joined the preview at #441, and their side-by-side was taken in 13b.
7. **The rules every screen step carries** are the plan's (§5, end): keyed components and no full
   redraw, so typed values survive ticking another row; set rows as a list or a table with headers;
   the day label as a heading; one live region per island, never two for one action; 44px targets; the layout at 360px.
8. **The DAL resolves the household scope itself**; lane E's resolver sets `writable`, `future`
   and `canGoForward` (C17), and the DAL adds `athletes`. The tenancy scan (`lib/dal/scoped.test.ts`) reaches sub-directories, so it
   holds `lib/dal/day/` to that.
   [write-path.md](./write-path.md) invariants 1, 2 and 8 still apply to the actions and the DAL,
   though the guide gate no longer sends a PR there.
9. 🔴 **A row's state is keyed by athlete and day.** `DayScreen` keys its body on
   `profilePublicId/day`: the page moves between days on one mount and a workout has the same ids
   every week, so typed text, a failure or an un-tick token would otherwise carry into another day.
10. 🔴 **A rejected action is a `retry`.** The contract's actions never throw for a refusal, but a
    dropped connection rejects; `use-row.ts` turns that into "Couldn't save. Try again." so no row
    stays ticked over a save that never happened.
11. **Re-tick only when nothing new was typed.** After an un-tick the field keeps the old number; ✓
    with it unchanged calls `retickRow` (the same entry back), a changed or emptied field is a new
    `logRow`, because a re-tick restores the old numbers. A retry with different numbers mints a
    new `clientId`, or the server would answer with the first attempt's. **An entry id does not say
    the data has caught up** (a writer may revive an un-ticked entry, so a ✓ after an un-tick can come back with the same id): an
    un-tick holds until the data has shown the entry and then the set empty (a late refresh from
    before the un-tick shows the entry first), and the set shown logged after that is the truth
    (another phone's ✓, or this phone's whose answer was lost); a ✓ holds while the data still
    shows what it showed when the ✓ was sent; a Change holds while the data shows its numbers from
    before (the data's, or this visit's), and any other numbers are another phone's.
12. **Read-only is `!writable`, a workout that left the week, or a `closed_day` already seen.** Such
    rows show what was logged as text, with no ✓, field or "Last time" (D33). A read-only row shows no
    message and no longer counts as "not saved": there is nothing left to retry. The count is an
    effect of the row's own failure, so a row that succeeds, reloads or leaves the page stops
    counting.
13. **A new Server Action module brings its own registry and test files**, so the lane edits no
    shared table ([write-path.md](./write-path.md) invariant 1 names the three files). The
    exceptions are the two pinned lists: the module list in `app/pages-need-a-session.test.ts`, and
    the row-limit list in `mutating-actions.test.ts` (one line each, sorted).
14. 🔴 **Change never puts a load in the wrong unit.** The writer judges a Change in the unit the
    row was LOGGED in (`loggedRowUnit`, contract change C28), but this screen's field shows and
    sends the item's current unit, so the screen is stricter (contract invariant 27): a row whose
    quantity was logged in another unit is not editable at all, reps included (`canChangeValues`);
    un-tick then a new ✓ changes it. Offering Change in the logged unit is a follow-up whose form is
    the maintainer's choice (12d plan, decided 2026-11-18). Change's reader
    (`readAmend`) fills nothing from the prescription: a blank, a non-number or an out-of-range
    number keeps **its own field's** logged number, and the row's other fields are still sent.
    🔴 **Nor does a ✓ after an un-tick** (H9, maintainer, 2026-11-18; 12d-ii): a row whose load
    was logged in another unit opens with that field blank (`textOf`), and an empty load there is
    refused as `other_unit` (`readTyped`'s `fillQuantity: false`, set in `use-row.ts`'s `press`),
    never filled from the prescription. D13's fill is unchanged everywhere else.
15. 🔴 **The ✓ never un-ticks a row whose press began during an edit.** Safari does not focus a
    tapped button, so a field's blur arrives before the ✓'s click and has already sent or reverted
    the edit; `use-change.ts` notes on pointer-down whether an edit was open, and such a click saves
    a change that is still open or does nothing. A keyboard press reads the row as it is.
16. 🔴 **A number that is not saved never looks logged** (invariant 10's rule for Change). Typed
    over, a field drops the green edge (`CHANGED_FIELD_CLASS`) and the row says "Not saved. Was
    30 lb." with a ✕ (cancel); a failed save keeps the typed number, says "Couldn't save. Still
    30 lb." with Try again and the ✕, and counts as not saved (a failed Undo does not count: nothing typed
    is lost). A saved Change shows its numbers until the page's data shows them too (the `amended`
    override in `use-row.ts`), and another phone's Change retires the line and its Undo.

17. 🔴 **Today is read in the row actions and nowhere below** (AGENTS.md → Server conventions, Time; FAM-1 board, 2026-11-16; plan row 12b's "works out the athlete's `today`" is the action's job, not `day.ts`'s). The
    action calls `getActiveLocalDay()`; `lib/dal/day/day.ts` and lane E's writers take `today` as an
    argument, and the writer holds the row's `day` to the window itself (`rowDayOpen`: today and
    yesterday, never a later day, an archived athlete never). So a crafted older or future day
    answers `closed_day` whatever the page rendered. Since 12c the older forms' `isWritableDay` and
    `resolveDeclaredDay` are the same window (they call the shared `inWritableWindow`, D32), so
    bodyweight, practice and a row agree. The page reads today too, from the same zone, to resolve
    the day it renders and hand it to `getDayPlan`.
18. **No refusal marks the field.** The screen checks every number by the writer's own rule
    (`fillRowValues`) before sending it, so a refused ✓ or Change is never the typed number's
    fault: `bad_value` from the server means the item changed under the page, and offers Reload.
    A `closed_day` also fetches the page's data again, since a retried ✓ refused at the window may
    have been saved the first time (UX panel, 12b).
19. 🔴 **The day is pinned in the URL before a write, once midnight has passed** (12c;
    `pinDayBeforeWrite` in `day-screen.tsx`). On the bare path a ✓'s own revalidated render
    computes today again; after local midnight that is a new day, and the screen would remount on
    it mid-workout. So every action the screen hands its rows, and its Reload, first sets `?d=` to
    the viewed day when the URL does not already name it and the device's day is after
    `plan.today`. Pinning after
    the first write is too late (that write's response is the jump), and pinning always would open
    a stale tab on yesterday the next morning. The date line says "Yesterday ·" there (v12's label).
    ⚠️ `replaceState`'s first argument stays `null`: Next syncs its router only for a call without
    its own `__NA` state, so passing `window.history.state` would leave the revalidated render on the
    old URL. `e2e/day-page.spec.ts`'s PROBE test pins this, and fails if it breaks.
20. 🔴 **The page shows one state notice, never a stack** (12c; maintainer, 2026-11-17): the
    archived notice ("… Nothing new can be logged. Restore them in Household settings."), else
    "Coming up" on a future day, else the closed-day sentence, above the program line (D36). The screen
    adds none of its own except its `closed_day` callout, which says only what happened ("Not
    saved. This day can't be logged any more."), so it is true for an archived athlete too.
    "Not on a program yet." says "Bodyweight and practice log here." only on a writable day.
21. **A future day is look-ahead, and only while on a program** (D32, plan §9). `dayNavBounds`
    sets both arrows and the week strip from `DayPlan.canGoForward`; `resolveViewedDay` passes a
    future `?d=` through and the page renders today instead unless the athlete is on a program
    that day, and never past today plus `LOOK_AHEAD_DAYS` (6, the rest of the coming week; D37;
    maintainer, 2026-11-17), past which a `?d=` renders today. A future day renders no Bodyweight or
    Life and no ✓.
22. **A write in flight looks pending and warns before the page is left** (maintainer,
    2026-11-17: "Warn + record"). A pending ✓ has a dashed border, `aria-busy` and "Saving…";
    `beforeunload` asks while any row's write is in flight. ⚠️ **Recorded gap:** iOS ignores
    `beforeunload`, and switching athlete is an in-app navigation no prompt covers, so a write
    that fails after the screen has gone is not reported; the row reads un-ticked when the athlete
    is opened again.

## Recorded differences from the prototype (v12)

**Decided with the maintainer at step 13 (2026-11-15):**

- A logged row was to stay neutral until a "done" colour existed. #424 added the `done` tokens
  before this step merged, so the row uses them as `docs/design.md` sets out: a `border-done` edge,
  a `done-surface` tint (dropped while the row shows a message, because `destructive` is 4.30:1
  on the light tint), a `done` ✓ with a heavier border under forced colours, and a `foreground`
  focus outline outside the ✓.
- "N not saved" shows beside a workout's progress while a save has failed.
- A Reload button appears on a refusal that means the page is out of date.

**Calls made inside the step's row:**

- The program name is plain text, because the program page is not wired. As in v12, it shows only
  on a day with two programs.
- A logged number shows as text until Change is wired (12d): the screen offers Change only when
  `amendRow` is supplied, which the preview route does.
- An empty ✓ that fails leaves the field empty rather than filling in the target.
- A set-type card looks done (edge and tint) only when every set shown is logged, as v12's does.

**Decided for 13b (maintainer, 2026-11-16):** "+ Add set" adds one row at a time, kept until it is
ticked and gone on reload (v12 kept it); a look-ahead workout says its size ("6 items"), as v12.
For 13b-ii: Change edits a logged number in place, with select-all on focus, Escape to revert and a
visible "Changed 30 → 35 · Undo"; a changeable logged number is a green-edged field (v12's has no
border).

**Decided for 13b-ii (maintainer, 2026-11-16, after the UX panel):** Undo returns the numbers from
before the first Change this visit (a typo between two changes never comes back). While a logged
number is typed over, the row says "Not saved. Was 30 lb." with a cancel, since phones have no
Escape key. **It is an icon-only ✕** (lane S's `InlineEditActions`, its ✕-alone form),
at the right end of that line, directly under the row's ✓ _(maintainer, 2026-11-17, from three
options captured at 360px)_; why there: `RowStatus` in `change-parts.tsx`. No trace of a Change shows after a reload; an "edited" marker is a contract question for
later. Also different from v12: a Change is sent once per row, when focus leaves the row from one of its fields (v12 per field) _(⚠️ **pending the maintainer**, PR `fix/fam-1-change-escape-and-drag-off`: "from any of its controls", and a ✕ press that gets no click (dragged off, a long press) or ends in a scroll is called off and leaves the row as a tap outside would: sent when focus leaves the row, at once if it already has (Safari with a mouse); the alternative keeps it typed and unsent. Escape now reverts from any control in the row, focus going to the ✓ when the revert removes the focused button)_;
the ✓ during an edit saves it (v12 un-ticked); a number is checked as a ✓'s is (v12 took anything
`+v` reads, such as `1e3`); and a row logged in another unit stays text.

**Decided for 13d (maintainer, 2026-11-16):** the switcher shows first names in their own row (not
v12's initials beside the name); a switch opens the athlete's today, as v12 does; Program order
shows as v12 shows it (two programs that day, a writable day); the rest-day line is v12's ("Rest
day. Nothing is scheduled on Sundays." / "Rest day on Family program."), and never on a day that
shows only what was logged (`showsOnlyLogged`: an older day, or an archived athlete's today or yesterday), since
there an empty program means skipped. v12's explainer sentence about where a program added later
goes is left out until the writer is checked against it.

**Decided after C18 (maintainer, 2026-11-17):** a day that shows only what was logged, on a
program, with no workouts, says "No workouts logged on Tue, Nov 10." ("No workouts logged today."
on today), in the notice box (`PROGRAM_COPY.nothingLogged`, beside the rest lines). "Workouts", because Bodyweight and Life above it may hold a weigh-in
or a practice; the day as the page's date line writes it (`formatDayShort`). The switcher hides
only when no one else is listed: `athletes` leaves an archived athlete out, so on their day one
live athlete is the way back, no pill is the current one (as in the nav rail), and the pills show
whole names, since the viewed athlete's own name is not listed to be told apart from.

**Decided for 12c (maintainer, 2026-11-17, after the UX panel):** the page keeps D34's order, the
workouts below Bodyweight and Life ("chosen by person who programmed the workout / day");
collapsing already-completed items is owed as its own follow-up, prototyped and reviewed first. A
future day shows v12's "Coming up. This is what <Name> has on Mondays. You can log it on the day."
with no Bodyweight or Life. **Different from v12:** the one state notice sits above the program
line (v12 puts its read-only notice after it), since it explains why everything below is inert;
the switcher is under the `<h1>`, not beside it (13d's decision; beside, a long name is squeezed
to a few letters a line at 360px); and Export sits at the foot beside rename, a parent's action,
so the header above the day's work is shorter.

A logged value and a prescription are spelled the same way (`30 s`, `40 yd`): both use the
contract's `quantityText` (C1, #436).

## Changing it

Start from the step's row in the plan (§5) and its prototype states (§8). A screen step gets a UX
panel before it is built ([AGENTS.md](../../AGENTS.md) → "UI PR rules"). Re-run `pnpm test`, and
`pnpm e2e:local e2e/program-preview-a11y.spec.ts` for the screen on the preview route.
