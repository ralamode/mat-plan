---
feature: The day page's workouts (FAM-1 lane C)
owns:
  - apps/web/components/day/
  - apps/web/lib/dal/day/
  # Step 12b adds `apps/web/app/p/[profileId]/row-actions.ts`, and step 12c
  # `apps/web/e2e/day-page.spec.ts`. Neither is listed yet: `guides:check` fails a guide that claims
  # a path which does not exist, so each entry arrives with its file.
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
edited in place. The wiring (12b on) comes next; each step adds its files and invariants here.

## The map

| Step   | Adds                                                                                                              |
| ------ | ----------------------------------------------------------------------------------------------------------------- |
| 13     | Workout cards and single rows, the optimistic ✓ and its failure state, in `day-screen.tsx` and its parts.         |
| 13b    | Set rows, PREVIOUS, "+ Add set", linked supersets, the read-only look-ahead (`set-table.tsx`, `row-parts.tsx`).   |
| 13b-ii | Change: a logged number edited in place, for set rows and single rows (the maintainer split 13b, 2026-11-16).     |
| 13d    | `components/day/{program-line,program-order-dialog,athlete-switcher}.tsx`; the "not on a program" notices.        |
| 12b    | `apps/web/app/p/[profileId]/row-actions.ts` (log, un-tick, re-tick) with its registry file; `lib/dal/day/day.ts`. |
| 12c    | The screen joins `apps/web/app/p/[profileId]/page.tsx`. A seam, shared with lane S, in the plan's §6 order.       |
| 12d    | Change. 15c: program order. 12f: the old forms' code goes.                                                        |

## Files

| File                                               | What it is for                                                                                                                                                                                                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/components/day/day-screen.tsx`           | `DayScreen({ plan, actions })`. A section of the day page: the workouts, the one live region, the failure count, read-only after a `closed_day`.                                                                                                                 |
| `apps/web/components/day/day-context.tsx`          | What every row of one day shares: athlete, day, actions, `readOnly`, `announce`, `reload`.                                                                                                                                                                       |
| `apps/web/components/day/workout-card.tsx`         | One workout: slot line, name, progress ("2 of 10", "Done ✓", none at total 0), "N not saved", items.                                                                                                                                                             |
| `apps/web/components/day/item-card.tsx`            | One item: an empty card on a look-ahead day, its single row (field, "Last time", ✓), or its set table.                                                                                                                                                           |
| `apps/web/components/day/set-table.tsx`            | A set-by-set item's table: Set, Previous, a column per field, ✓; "+ Add set"; every row shown this visit stays for the visit.                                                                                                                                    |
| `apps/web/components/day/row-parts.tsx`            | What both rows share: the card's classes and tint, the heading (superset label, what logged rows were against), the ✓, a row's message, a number field.                                                                                                          |
| `apps/web/components/day/use-row.ts`               | One row's ✓, un-tick and re-tick, for a single row or one set: optimistic display, `clientId` per attempt, refusals. Its text is a row's fields (`RowText`).                                                                                                     |
| `apps/web/components/day/use-change.ts`            | Change (13b-ii): a logged row's edit, when it is sent, Undo's baseline, the line under the row, and what the ✓ means during an edit.                                                                                                                             |
| `apps/web/components/day/change-parts.tsx`         | Change's field (select-all on focus, Escape, Enter) and the line under a row ("Not saved. Was 30 lb." with Cancel; "Changed 30 → 35" with Undo; or the row's error).                                                                                             |
| `apps/web/components/day/row-values.ts`            | Pure: a row's fields (`fieldsOf`: a load and/or reps), reading what was typed (D13's empty ✓, whole reps), comparing and formatting a row's values in the contract's spelling (`quantityText`).                                                                  |
| `apps/web/components/day/athlete-switcher.tsx`     | The household's athletes as first-name pills under the `<h1>`; a switch opens that athlete's today. Server-safe (no state).                                                                                                                                      |
| `apps/web/components/day/program-line.tsx`         | "Programs: A, B" (renders on the server), and Program order when the day has two programs, the athlete is on two now, the day is writable and `reorderPrograms` is supplied.                                                                                     |
| `apps/web/components/day/program-order-dialog.tsx` | `ProgramOrderButton` and the dialog (client code): ↑ ↓ per program; each tap saves the whole order; taps during a save are sent together, and the page's older order cannot undo them; a failure restores the last saved order; focus stays on the arrow tapped. |
| `apps/web/components/day/not-on-a-program.tsx`     | "Not on a program yet" / "on this day". No link until the Programs page exists (`programsHref`).                                                                                                                                                                 |
| `apps/web/components/day/day-copy.ts`              | Every sentence the screen says, and each refusal's copy.                                                                                                                                                                                                         |
| `apps/web/components/day/*.test.ts(x)`             | The screen's tests over the fixtures and the preview's fake; `row-values.test.ts` for the pure helpers.                                                                                                                                                          |
| `apps/web/components/day/day-test-utils.tsx`       | The tests' shared harness (mount, queries). It holds no fake: a test file passes `createFakeDayActions` to `makeMount`, since only `*.test.ts(x)` may import the preview's fakes.                                                                                |
| `apps/web/components/day/owed.test.ts`             | The lane's `it.todo` list: the tests its steps still owe the contract. Delete a line in the PR that writes its test.                                                                                                                                             |
| `apps/web/lib/dal/day/index.ts`                    | A placeholder so the directory exists.                                                                                                                                                                                                                           |

## Invariants

1. 🔴 **`DayScreen`, plus three parts the page places** (plan D34, decided by the
   maintainer for 13d, 2026-11-16). The day page mounts `DayScreen` with a `DayPlan` and a `DayActions`,
   once, at step 12c, after Bodyweight and Life. v12 puts three things above those sections, so
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
   route. The a11y scan walks every state there, so a step never edits a spec to add one.
   13d's three page-placed parts joined the preview at #441, and their side-by-side was taken in 13b.
7. **The rules every screen step carries** are the plan's (§5, end): keyed components and no full
   redraw, so typed values survive ticking another row; set rows as a list or a table with headers;
   the day label as a heading; one persistent live region; 44px targets; the layout at 360px.
8. **The DAL resolves the household scope itself**, and sets `writable`, `future` and
   `canGoForward`. The tenancy scan (`lib/dal/scoped.test.ts`) reaches sub-directories, so it
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
    un-tick holds until the data has shown the set empty, and the set shown logged after that is the
    truth (another phone's ✓, or this phone's whose answer was lost); a ✓ holds while the data
    still shows what it showed when the ✓ was sent.
12. **Read-only is `!writable`, a workout that left the week, or a `closed_day` already seen.** Such
    rows show what was logged as text, with no ✓, field or "Last time" (D33). A read-only row shows no
    message and no longer counts as "not saved": there is nothing left to retry. The count is an
    effect of the row's own failure, so a row that succeeds, reloads or leaves the page stops
    counting.
13. **A new Server Action module brings its own registry and test files**, so the lane edits no
    shared table ([write-path.md](./write-path.md) invariant 1 names the three files).
14. 🔴 **Change never puts a load in the wrong unit.** A Change is sent in the item's unit
    (`rowAmendSchema`), so a row whose quantity was logged in another unit is not editable at all,
    reps included (`canChangeValues`); un-tick then a new ✓ changes it. Change's reader
    (`readAmend`) fills nothing from the prescription: a blank, a non-number or an out-of-range
    number keeps **its own field's** logged number, and the row's other fields are still sent.
15. 🔴 **The ✓ never un-ticks a row whose press began during an edit.** Safari does not focus a
    tapped button, so a field's blur arrives before the ✓'s click and has already sent or reverted
    the edit; `use-change.ts` notes on pointer-down whether an edit was open, and such a click saves
    a change that is still open or does nothing. A keyboard press reads the row as it is.
16. 🔴 **A number that is not saved never looks logged** (invariant 10's rule for Change). Typed
    over, a field drops the green edge (`CHANGED_FIELD_CLASS`) and the row says "Not saved. Was
    30 lb." with Cancel; a failed save keeps the typed number with that line, and counts as not
    saved. A saved Change shows its numbers until the page's data shows them too (the `amended`
    override in `use-row.ts`), and another phone's Change retires the line and its Undo.

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
number is typed over, the row says "Not saved. Was 30 lb." with a Cancel, since phones have no
Escape key. No trace of a Change shows after a reload; an "edited" marker is a contract question for
later. Also different from v12: a Change is sent once per row, when focus leaves it (v12 per field);
the ✓ during an edit saves it (v12 un-ticked); a number is checked as a ✓'s is (v12 took anything
`+v` reads, such as `1e3`); and a row logged in another unit stays text.

**Decided for 13d (maintainer, 2026-11-16):** the switcher shows first names in their own row (not
v12's initials beside the name); a switch opens the athlete's today, as v12 does; Program order
shows as v12 shows it (two programs that day, a writable day); the rest-day line is v12's ("Rest
day. Nothing is scheduled on Sundays." / "Rest day on Family program."), and only on today,
yesterday and look-ahead days, since on an older day an empty program means skipped. v12's
explainer sentence about where a program added later goes is left out until the writer is checked
against it.

A logged value and a prescription are spelled the same way (`30 s`, `40 yd`): both use the
contract's `quantityText` (C1, #436).

## Changing it

Start from the step's row in the plan (§5) and its prototype states (§8). A screen step gets a UX
panel before it is built ([AGENTS.md](../../AGENTS.md) → "UI PR rules"). Re-run `pnpm test`, and
`pnpm e2e:local e2e/program-preview-a11y.spec.ts` for the screen on the preview route.
