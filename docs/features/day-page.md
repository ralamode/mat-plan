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
Count) with their ✓. An item logged set by set shows its heading and "N logged" until 13b. Each later step
adds its files and invariants here.

## The map

| Step | Adds                                                                                                              |
| ---- | ----------------------------------------------------------------------------------------------------------------- |
| 13   | Workout cards and single rows, the optimistic ✓ and its failure state, in `day-screen.tsx` and its parts.         |
| 13b  | Set rows, PREVIOUS, "+ Add set", linked supersets, the read-only look-ahead.                                      |
| 13d  | `components/day/{program-line,program-order-dialog,athlete-switcher}.tsx`; the "not on a program" notices.        |
| 12b  | `apps/web/app/p/[profileId]/row-actions.ts` (log, un-tick, re-tick) with its registry file; `lib/dal/day/day.ts`. |
| 12c  | The screen joins `apps/web/app/p/[profileId]/page.tsx`. A seam, shared with lane S, in the plan's §6 order.       |
| 12d  | Change. 15c: program order. 12f: the old forms' code goes.                                                        |

## Files

| File                                       | What it is for                                                                                                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/components/day/day-screen.tsx`   | `DayScreen({ plan, actions })`. A section of the day page: the workouts, the one live region, the failure count, read-only after a `closed_day`.                             |
| `apps/web/components/day/day-context.tsx`  | What every row of one day shares: athlete, day, actions, `readOnly`, `announce`, `reload`.                                                                                   |
| `apps/web/components/day/workout-card.tsx` | One workout: slot line, name, progress ("2 of 10", "Done ✓", none at total 0), "N not saved", items.                                                                         |
| `apps/web/components/day/item-card.tsx`    | One item: its heading, and for a Check, Duration or Count its single row (field, "Last time", ✓). Set-type items: heading and "N logged" until 13b.                          |
| `apps/web/components/day/use-row.ts`       | One row's ✓, un-tick and re-tick: optimistic display, `clientId` per attempt, refusals. 13b reuses its write state machine per set; the single-number reader moves out then. |
| `apps/web/components/day/row-values.ts`    | Pure: read what was typed (D13's empty ✓), compare and format a row's values. Fields come from `TRACKING_TYPE_FIELDS`.                                                       |
| `apps/web/components/day/day-copy.ts`      | Every sentence the screen says, and each refusal's copy.                                                                                                                     |
| `apps/web/components/day/*.test.ts(x)`     | The screen's tests over the fixtures and the preview's fake; `row-values.test.ts` for the pure helpers.                                                                      |
| `apps/web/components/day/owed.test.ts`     | The lane's `it.todo` list: the tests its steps still owe the contract. Delete a line in the PR that writes its test.                                                         |
| `apps/web/lib/dal/day/index.ts`            | A placeholder so the directory exists.                                                                                                                                       |

## Invariants

1. 🔴 **One mount point** (plan §6). The day page mounts `DayScreen` with a `DayPlan` and a
   `DayActions`, once, at step 12c. What a later step adds lives inside the screen, so it shows on
   the page with no further mounting. The screen's props are its contract with the page and the
   preview harness: change them through the contract owner.
2. 🔴 **The screen is a section, not the page.** The page keeps its `<h1>` and composes Bodyweight
   and Life before it; those sections and Clear this day are lane S's. Of the plan's own lanes only
   this one edits `page.tsx`, in the order the plan's §6 seam table gives.
3. 🔴 **A screen writes only through `DayActions`.** A member that is `undefined` is an action not
   wired yet, and the screen hides its control: Change and Program order arrive that way at 12d
   and 15c.
4. 🔴 **No production file imports a fixture or a fake.** They are preview and test data
   ([program-contract.md](./program-contract.md) invariant 4, held by a source scan). A screen's
   own `*.test.tsx` may.
5. **A ✓ is optimistic, and one attempt has one `clientId`** (plan D24, §4). If the write fails
   the row un-ticks, keeps what was typed and says so. When the retry reuses the `clientId`, and
   when a ✓ mints a new one, is invariant 11. `/design/program?screen=day&fixture=today-two-programs&fail=next`
   shows the failure.
6. **Each screen step is checked against its prototype states** (plan §8), at 360px on the preview
   route. The a11y scan walks every state there, so a step never edits a spec to add one.
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
    new `clientId`, or the server would answer with the first attempt's.
12. **Read-only is `!writable`, a workout that left the week, or a `closed_day` already seen.** Such
    rows show what was logged as text, with no ✓, field or "Last time" (D33). A read-only row shows no
    message and no longer counts as "not saved": there is nothing left to retry. The count is an
    effect of the row's own failure, so a row that succeeds, reloads or leaves the page stops
    counting.
13. **A new Server Action module brings its own registry and test files**, so the lane edits no
    shared table ([write-path.md](./write-path.md) invariant 1 names the three files).

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
- A logged number shows as text until Change arrives at 12d.
- An empty ✓ that fails leaves the field empty rather than filling in the target.
- Until 13b, a set-type item shows "N logged" under its heading, so a closed day does not look
  empty.

**Known gap, owed by the contract:** a logged value is spelled by `formatValueUnit` (`30 sec`,
`40 yards`), while the prescription beside it is spelled by `prescribed-text.ts` (`30 s`, `40 yd`).
The latter's unit spelling is private, and its subpath pulls `csv/` into a client bundle, so one
client-safe renderer has to come from the contract owner.

## Changing it

Start from the step's row in the plan (§5) and its prototype states (§8). A screen step gets a UX
panel before it is built ([AGENTS.md](../../AGENTS.md) → "UI PR rules"). Re-run `pnpm test`, and
`pnpm e2e:local e2e/program-preview-a11y.spec.ts` for the screen on the preview route.
