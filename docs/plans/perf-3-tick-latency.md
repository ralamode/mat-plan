# PERF-3 — a ✓ settles fast

> Backlog: [plan.md](../plan.md) row PERF-3. Branch: `perf/fam-1-tick-latency`. Milestone: Beta 0.
> Tags: `FAM-1`, `tech-debt`, `bug-fix`. Step 1 ships in this PR; steps 2 and 3 get their own plans.

## Where this sits

- **Pillar:** the day page (FAM-1), the app's main screen; the ✓ is its main action.
- **Larger objective:** the first, narrow step of a performance track _(maintainer, 2026-11-26: "less
  layout thrash, and a snappy more efficient UI … thinking forward to the feed, we probably want row
  virtualization as well")_. That track is planned separately; PERF-1(a)'s real-user monitoring is
  its measuring stick.
- _Roadmap alignment (2026-11-26): checked against the private roadmap; nothing to add here. No
  roadmap item moves; PERF-3 is a tech-debt row._

## Goal

Marking a set done on a phone sits in its dashed "saving" state for **0.65–1.4 s** (the maintainer's
iPhone recordings, 2026-11-24; _"the logging pages must be lightning fast and reliable; they are the
heart of the app for now"_, maintainer, 2026-11-25).

## What was measured (2026-11-26)

**Production** (the maintainer's own day, 12 ✓/un-✓ taps on one row, desktop broadband, Playwright
signed in as the maintainer, with their go; the row ended as it started):

|                                       | First tap (cold)                                | Taps 2–12                                 |
| ------------------------------------- | ----------------------------------------------- | ----------------------------------------- |
| ✓ settles (tap → `aria-busy` cleared) | 680 ms                                          | 155–277 ms (median ≈ 175)                 |
| The action's POST: time to first byte | 666 ms                                          | 137–258 ms                                |
| The action's response                 | 8.4 KB                                          | 8.4 KB: a re-render of the whole day page |
| Requests started by one ✓             | **≈ 17**: the POST, then ≈ 16 router prefetches | same                                      |

The ≈ 16 follow-ups are Next's router fetching **every link on the page** again (`/`, `/programs`,
`/settings`, `/privacy`, `/p/[id]/edit`, the other athletes' day pages, a program page), each
80–180 ms and each re-running the session and household checks. Cause: `revalidatePath` in a Server
Action marks the response `ActionDidRevalidateStaticAndDynamic`, and the client's answer to that is
`invalidateEntirePrefetchCache` (Next 16.4.6, `server-action-reducer.js:228-229`). On a phone on gym
LTE those prefetches share the connection with the next ✓.

**Locally** (a production build on a throwaway database, a temporary counting wrapper on the pool):
one ✓ is ≈ 32 sequential queries: ≈ 15 for the write (the household read two or three times), ≈ 17
to re-render the page inside the same response. The count does not grow with the number of checked
items: each query reads a whole kind of row at once.

**On the phone's side** (the same build with React's profiler on, a 4× slower CPU, LTE-like network,
six taps on the fixture day of 12 items; 2026-11-26). Each ✓ makes five React commits:

| Commit                          | When                                 | Components re-rendered                                  | React time |
| ------------------------------- | ------------------------------------ | ------------------------------------------------------- | ---------- |
| 1. the row goes dashed          | at the tap                           | 4 (the row)                                             | ≈ 1 ms     |
| 2. the card learns it is busy   | +10–20 ms                            | 5 (`DayBody`, the card, Collapse)                       | ≈ 1 ms     |
| 3. **the row settles**          | +65–90 ms (the answer)               | 6–7 (the row, `DayBody`)                                | ≈ 1 ms     |
| 4. the card is no longer busy   | + a few ms                           | 5                                                       | ≈ 1 ms     |
| 5. the returned page is applied | ≈ 15–40 ms **after** the row settled | **227: every component on the page**, 21 links included | 7–12 ms    |

Main-thread work per tap: 33–53 ms of script, 2–6 ms of layout in 3 passes, 1–2 ms of style. The
step-5 re-render of the whole page is real, but it is small and it lands **after** the row has
already settled, so it does not lengthen the dashed state. There is no layout thrash. **The delay a
phone shows is the network and the server, not rendering.** Step 2 still removes the whole-page
re-render and the decoding of the 34 KB response (≈ 20–30 ms of main thread per tap), and the cost
grows with the page: on a long list (the feed), per-row isolation and virtualization matter. That
belongs to the performance track.

## The order, and why

| Step                                       | What changes                                                                                                                                                                                  | Removes                               | Risk                                                             |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------- |
| **1 — this PR**                            | The four row actions call Next's `refresh()` instead of `revalidatePath`. The ✓ still answers with the fresh page, so every count, "Done ✓" and Collapse update as today.                     | the ≈ 16-request prefetch burst       | low: one call per action, same response shape                    |
| **2 — the ✓ answers with its row only**    | No page in the response. The card's count, "Done ✓", Collapse, the set table's done look, "+ Add set", Clear this day's summary and Restore are derived on the phone from what the rows show. | the ≈ 17-query re-render and its 8 KB | high: see the panel's findings below; its own plan + UX panel    |
| **3 — the write reads the household once** | Drop the action's athlete pre-read once nothing needs `profile.id`; the writer already checks the athlete inside the household.                                                               | ≈ 2–3 queries per ✓                   | medium: the boundary tests' wrong-owner case moves to the writer |

Step 2 is the "send only what changed" design, and the right end state. It is not a one-line change:
today the rest of the card learns about a ✓ from the page that comes back with it. The panel (below)
found that dropping the page without first moving that state to the phone breaks Collapse after an
un-✓, shows Clear this day a wrong count, shows the old day on Back, and, if the catch-up refresh
then fails on a weak signal, makes the browser reload the page and lose typed numbers. Step 1 needs
none of that.

## Acceptance (step 1)

- A successful ✓, un-✓, re-✓ or Change calls `refresh()` and never `revalidatePath` (unit test).
- **No prefetch burst after a ✓:** on a local production build, RSC fetches in the 2.5 s after each
  tap, once the page has loaded, are **0** (measured below; before: the whole link set each tap).
- Unchanged: what the page shows after a ✓, the response shape, `RowResult`, refusals, the midnight
  pin, Clear this day and Restore all, Program order (still `revalidatePath`, it is not a ✓).
- Production, re-measured after deploy with the maintainer's go: requests per ✓ fall from ≈ 17 to 1.

## File-by-file changes (step 1)

| Path                                                                                                                        | Change | What & why                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| `apps/web/app/p/[profileId]/row-actions.ts`                                                                                 | EDIT   | `writeRow` calls `refresh()` (from `next/cache`) on success; docblock step 6 says why.                               |
| `apps/web/app/p/[profileId]/row-actions.test.ts`                                                                            | EDIT   | A success calls `refresh` four times and `revalidatePath` never; each refusal calls neither.                         |
| `AGENTS.md`                                                                                                                 | EDIT   | Server conventions → Cache: the scoped exception, so later reviews do not flag it.                                   |
| `docs/features/write-path.md`                                                                                               | EDIT   | The "`revalidatePath` is not optional" trap names the exception and the reason.                                      |
| `docs/features/day-page.md`                                                                                                 | EDIT   | The `row-actions.test.ts` row says what is now asserted.                                                             |
| `apps/web/e2e/day-page.spec.ts`                                                                                             | EDIT   | The first ✓ of each item answers `x-action-revalidated: 2`, so a returned `revalidatePath` or cookie write fails CI. |
| `apps/web/app/p/layout.tsx`, `apps/web/app/programs/layout.tsx`                                                             | EDIT   | A comment: the layout renders nothing a ✓ changes, and why that matters now.                                         |
| `.claude/skills/add-server-action/SKILL.md`, `.claude/skills/review-pr/SKILL.md`, `.claude/agents/architecture-reviewer.md` | EDIT   | Name the exception where a reviewer checks for `revalidatePath`.                                                     |
| `docs/plan.md`                                                                                                              | EDIT   | The PERF-3 backlog row.                                                                                              |

## Measured on step 1 (local production build, LTE-like throttling, 4× slower CPU, 8 taps 2.5 s apart)

|                            | Before (`revalidatePath`) | After (`refresh()`)                                                                                                     |
| -------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| ✓ settles                  | ≈ 45–85 ms                | 83–88 ms (unchanged locally: the database is 1 ms away)                                                                 |
| RSC fetches after each tap | the page's link set       | `[7, 3, 0, 0, 0, 0, 0, 0]`: the first two are the page's own first-load prefetches still finishing; **0 per tap after** |

The settle time is unchanged locally because the local database answers in ≈ 1 ms; the win is on
production, where every one of those prefetches was a round trip competing with the next ✓.

## Test plan

- `row-actions.test.ts` (above).
- The e2e smoke's journeys are unchanged: the response still carries the page, so every journey
  that reads counts or Collapse after a ✓ still sees them at once. `day-page.spec.ts` adds one
  assertion: the first ✓ of each item answers `x-action-revalidated: 2`.
- Production re-measure after deploy, with the maintainer's go (it writes to their own day).

## Risks / rollback

- **Other pages' cached copies.** `refresh()` evicts the router's Back/Forward cache exactly as
  `revalidatePath` did (both revalidation kinds call `invalidateBfCache`, Next 16.4.6
  `server-action-reducer.js:213-216`), and the ✓'s returned page is written back, so Back shows the
  day after the ✓ and other pages are fetched again. The prefetch cache it now keeps holds only route
  trees and the layouts above each `loading.tsx` (the root layout, `ClerkRoot`), none of which shows
  ✓-dependent data; `staleTimes` is unset, so a page itself is fetched on every navigation.
- **Rollback:** revert the PR. No data or schema change.

## Out-of-scope / deferred

- Steps 2 and 3 (above), each with its own plan; step 2 with a UX panel.
- **The cold first tap** (≈ 680 ms): a Vercel function and/or Neon compute waking; the maintainer's
  console settings, a separate note with costs.
- **The day page's other writes still call `revalidatePath`:** Bodyweight's and Life's "Log"
  buttons (`actions.ts`), and Clear this day / Restore (`clear-day-actions.ts`), so each still
  empties the prefetch cache. They are one-off submits, not the rapid per-row ticks this step is
  about; moving them is a follow-up once step 1 is measured on production.
- **Showing the dashed state only after ≈ 300 ms:** the UX lens recommends against it (an in-flight
  ✓ must never look saved, FAM-1 12c). Not proposed.

## Review-response log (adversarial panel, 2026-11-26)

The panel reviewed the first draft, which was step 2 done in one go (drop `revalidatePath`, one
debounced `router.refresh()` 2 s after the taps stop). Its findings changed the plan's order.

| Lens          | Finding (severity)                                                                                                    | Response                                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture  | Dropping `revalidatePath` breaks a rule stated in six places (BLOCKING)                                               | **Fixed:** step 1 keeps a refresh in the response and records a scoped exception in AGENTS.md and write-path.md.                                                 |
| Architecture  | A deferred `router.refresh()` re-pings every visible link and blocks the next ✓ in the router queue (BLOCKING)        | **Fixed by the reorder:** no client timer in step 1. Step 2 must not use a timed `router.refresh()`.                                                             |
| Architecture  | `refresh()` from `next/cache` ends the burst and keeps the rule; not argued                                           | **Adopted** as step 1.                                                                                                                                           |
| Architecture  | A deferred refresh pins the day when it runs, so a phone can open on yesterday (BLOCKING)                             | **Moot for step 1;** carried to step 2's plan as a requirement.                                                                                                  |
| UX            | A failed `router.refresh()` makes Next load the page from scratch, losing typed numbers and unsaved rows (P0)         | **Moot for step 1** (no automatic refresh); step 2 requirement: an automatic catch-up must never be able to navigate. Pre-existing for the Reload button: noted. |
| UX / Correct. | Card count, "Done ✓", Collapse, set-table done look, "+ Add set", Clear summary and Restore read the page's data (P1) | **Moot for step 1;** step 2 derives them on the phone first.                                                                                                     |
| UX / Correct. | Back within 2 s of a ✓ shows the day before it (P1 / BLOCKING)                                                        | **Moot for step 1** (the response still updates the page); step 2 requirement.                                                                                   |
| Correctness   | Un-✓ then a re-✓ whose answer is lost leaves the row empty for the visit (BLOCKING)                                   | **Moot for step 1** (the un-✓'s response still shows the empty set); step 2 requirement: end an override on a refresh that started after the write.              |
| Correctness   | PR 2's scope pass-down puts a household scope in `app/` and cannot reach its target (BLOCKING)                        | **Replaced:** step 3 deletes the action's athlete pre-read instead; the writer already checks it inside the scope.                                               |
| Both          | `Promise.all(limiter, lookup)` breaks the documented check order (SHOULD)                                             | **Dropped.**                                                                                                                                                     |
| Both          | A wall-clock e2e budget is flaky; the query-count flag would ship in production (SHOULD)                              | **Dropped** from this PR; the probe stays a local tool, not a spec.                                                                                              |
| UX            | Keep the dashed pending state; don't delay it                                                                         | **Agreed.**                                                                                                                                                      |
