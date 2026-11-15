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

🚧 **Written at step 0b, before the lane's first step.** The screen is a stub. Each step below adds
its files, its diagram and its invariants here.

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

| File                                          | What it is for                                                                                                       |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `apps/web/components/day/day-screen.tsx`      | `DayScreen({ plan, actions })`. A section of the day page. A stub until 13.                                          |
| `apps/web/components/day/day-screen.test.tsx` | The stub's own output. Step 13 replaces it with the screen's tests.                                                  |
| `apps/web/components/day/owed.test.ts`        | The lane's `it.todo` list: the tests its steps still owe the contract. Delete a line in the PR that writes its test. |
| `apps/web/lib/dal/day/index.ts`               | A placeholder so the directory exists.                                                                               |

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
   the row un-ticks, keeps what was typed and says so; the retry reuses the `clientId`; a ✓ after
   an un-tick mints a new one. `/design/program?screen=day&fixture=today-two-programs&fail=next`
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
9. **A new Server Action module brings its own registry and test files**, so the lane edits no
   shared table ([write-path.md](./write-path.md) invariant 1 names the three files).

## Changing it

Start from the step's row in the plan (§5) and its prototype states (§8). A screen step gets a UX
panel before it is built ([AGENTS.md](../../AGENTS.md) → "UI PR rules"). Re-run `pnpm test`, and
`pnpm e2e:local e2e/program-preview-a11y.spec.ts` for the screen on the preview route.
