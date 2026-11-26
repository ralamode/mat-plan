# PERF-3 step 2 — measure the page re-render, then make it cheaper before removing it

> Backlog: [plan.md](../plan.md) row PERF-3, step 2. Parent: [perf-3-tick-latency.md](./perf-3-tick-latency.md)
> (step 1, #821). Milestone: Beta 0. Tags: `FAM-1`, `tech-debt`. **Plan only; reshaped by a seven-lens
> panel. Needs the maintainer's pick (§ Decision) before any code.**

## Where this sits

- **Pillar:** the day page (FAM-1). Step 1 (#821) stopped the ≈ 16 prefetches after each ✓. What is
  left on the server side of a ✓ is the day page re-rendered inside the response (≈ 17 queries) and
  the write itself (≈ 15, step 3).
- **The wider performance track** _(maintainer, 2026-11-26)_ owns the "send only what changed"
  design below; this step records what it will take.
- _Roadmap alignment (2026-11-26): checked against the private roadmap; nothing to add here. The
  v1.5 offline queue (`/api/sync`, TanStack Query, [spec](../spec.md) §6) is where a client-side copy
  of the day naturally lands._

## What the panel found (2026-11-26)

The first draft of this plan made the ✓ answer with its row only: the phone would patch its own copy
of the day, and re-read it at defined moments through a new GET route. Seven lenses (correctness,
scope, architecture, reuse, security, privacy, UX) reviewed it. None found a security or privacy
blocker. All found that it is far larger than it looked, because today the rest of the screen learns
about a ✓ from the page that comes back with it. Doing it correctly needs all of this:

| Need                                                                                                                                                                                                                                                                                                                               | Found by                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **Contract additions:** `DayRow.extra` (an un-✓'d extra set is dropped by the server, and the phone cannot tell it from a prescribed one), `prescribedText` in `RowResult` (re-✓ and revive restore or re-freeze it), and `previous` for a new extra set                                                                           | correctness, architecture, reuse    |
| **A keyed store at module level** (`useSyncExternalStore`, keyed by athlete and day) that wraps the actions (send, success, settle), so a ✓ answering after an athlete or day switch lands on its own day, never another child's                                                                                                   | correctness, architecture, security |
| **A log of settled writes replayed onto every server copy** (props or a re-read), instead of "props wait for pending writes", which brings back an un-✓'d set as ticked                                                                                                                                                            | correctness, UX                     |
| **Midnight:** a tab left open overnight logs onto yesterday under a "Today" title, because nothing re-renders the page; needs a date check on returning to the tab                                                                                                                                                                 | UX                                  |
| **Clear this day's dialog** computed on the phone from the same copy, or it names stale counts in a destructive confirmation                                                                                                                                                                                                       | correctness, UX, architecture       |
| **The re-read route:** refresh the Clerk token first (it expires in ≈ 60 s and is not refreshed in a hidden tab, so the first read after unlock is likely a 404), one shared day-resolution helper, no `athletes` in the response, a 404 that clears what the phone kept, a reset on sign-out, SECURITY.md and data-inventory rows | security, privacy, reuse            |
| **A page-wide rule** for what a re-read may change silently (row states only) and when it must ask (archived, programs changed, `writable` turned false)                                                                                                                                                                           | UX, architecture                    |
| **The design-preview fake becomes the shared patch**, not a third copy; the contract proof lives in `db:verify`, chained (✓ → un-✓ → re-✓), with a mutation patch that turns it red                                                                                                                                                | reuse, correctness                  |

That is several PRs in the app's most important screen, and the panel's scope lens asked the question
it could not answer: **how many milliseconds of a ✓ is the page re-render?** The parent plan measured
the phone's render at ≈ 10 ms, after the row settles. The server's share of the production POST
(137–258 ms to first byte) has not been split out.

## A cheaper step that keeps today's behaviour

The re-render is slow mostly because its reads run **one after another**. On a ✓ today
(`app/p/[profileId]/page.tsx`): session → athlete (`:82`) → household state (`:86`) → time zone
(`:92`) → the day's plan (`:100`, itself ≈ 8 queries in a row in `day-plan.ts:107-233`) → entries and
clears (`:151`, together) → last bodyweight (`:169`) → the athlete list (`:200`). Several do not
depend on each other: household state, the time zone and the athlete list do not need the plan, and
some of the plan's own reads (logged rows, prescriptions) need only the athlete and day.

Running the independent reads together keeps everything the page shows exactly as it is (the response
still carries the page, so counts, Collapse, Clear and midnight all behave as today), and it shortens
every page load, not only a ✓.

## Decision for the maintainer

| Option                                         | What                                                                                                                                                                                                                           | Size           | Risk                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | -------------------------------------------------------------------- |
| **A. Measure, then parallelise (recommended)** | (1) split the production POST's time into write vs re-render from Vercel's function logs and the Sentry action span (no code); (2) run the page's independent reads together; (3) step 3 (the write reads the household once). | 1–2 small PRs  | low: no change to what the screen shows                              |
| B. The row-only design now                     | everything in the table above                                                                                                                                                                                                  | 4–5 PRs        | high: the screen's state moves to the phone, in the heart of the app |
| C. Defer to v1.5                               | do A now; build the row-only design with the offline queue, where TanStack Query and an outbox provide the store, the write log and the re-read the panel asked for                                                            | A now, B later | low now                                                              |

**Recommendation: A now, then C.** If the measurement shows the re-render is a large share of a
phone ✓ even after parallelising, B comes back with this table as its requirements list.

## If A is chosen: acceptance

- The production POST's time is split into write and re-render, recorded here, before any code.
- On a local production build with a counting wrapper, the ✓'s response does the same queries in
  fewer sequential round trips (the number is recorded before and after).
- Production, with the maintainer's go: time to first byte of the ✓'s POST, before and after.
- Nothing the page shows changes; every unit, `db:verify` and e2e proof passes unchanged.

## Review-response log (seven lenses, 2026-11-26)

> Lenses: correctness, scope, architecture, reuse, security, privacy, UX (all three sub-lenses).

| #                         | Lens                          | Critique (short)                                                                                         | Verdict      | Resolution                                                                 |
| ------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------- |
| SC-B1                     | Scope                         | The catch-up route, epoch and visibility rule are a hand-built query cache before v1.5                   | **accepted** | Option C defers it to the offline queue.                                   |
| SC-S1                     | Scope                         | No millisecond figure for what the work saves                                                            | **accepted** | Option A measures first.                                                   |
| SC-S2                     | Scope, UX, arch.              | `WorkoutCard` and `ItemCard` are already memoised                                                        | **accepted** | Draft's `React.memo` row was wrong; removed.                               |
| SC-S6                     | Scope                         | The 2b "safety net" claim was wrong (server props replace the patch in the same answer)                  | **accepted** | Split removed with the design.                                             |
| C-B1, R-B2, A-B1          | Correctness, reuse, arch.     | Un-✓ of an extra set cannot be patched without a contract field                                          | **accepted** | Listed as a requirement for B.                                             |
| C-B2, R-B1, A-B2          | Correctness, reuse, arch.     | `workoutProgress(workout)` cannot be the server's rule (it counts before filtering)                      | **accepted** | Requirement for B: delta update, server's loop untouched.                  |
| C-B3, A-B1                | Correctness, arch.            | The wire input cannot locate or rebuild a re-✓'d row                                                     | **accepted** | Requirement for B: a located patch input; `prescribedText` in `RowResult`. |
| C-B4, UX-P1-1             | Correctness, UX               | "Props wait for pending writes" restores a saved or un-✓'d row wrongly                                   | **accepted** | Requirement for B: replay a settled-write log onto every server copy.      |
| C-B5, A-S1, SEC-S4        | Correctness, arch., security  | The store must be keyed by athlete and day and live beyond one mount                                     | **accepted** | Requirement for B.                                                         |
| UX-P1-3/4                 | UX                            | Midnight: dropping the in-response render loses today's "Yesterday" correction                           | **accepted** | Requirement for B; A keeps the render, so nothing changes.                 |
| UX-P1-5, C-S1, A-B3, R-S5 | UX, correctness, arch., reuse | Clear this day's dialog names stale counts                                                               | **accepted** | Requirement for B; A keeps the server's summary current.                   |
| SEC-S3, PRIV-S2/S3        | Security, privacy             | Clerk token expiry makes the re-read's first try a 404; a 404 must clear the kept day; reset on sign-out | **accepted** | Requirements for B's route.                                                |
| PRIV-S1, SEC-S1/S2, R-B3  | Privacy, security, reuse      | No `athletes` in the response; `today` from the cookie; one shared day resolver                          | **accepted** | Requirements for B's route.                                                |
| R-S2, A-S2                | Reuse, arch.                  | The design-preview fake already applies writes; it must become the shared patch                          | **accepted** | Requirement for B.                                                         |
| UX-P2-2                   | UX                            | A 60 s re-read lands under a thumb; re-read after a stale refusal instead                                | **accepted** | Open question 1 of the draft answered: no timer.                           |
| —                         | Privacy, security             | No blocker: same audience, `no-store`, no new processor, bodyweight absent                               | noted        |                                                                            |
