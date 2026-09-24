# Brainstorm — day navigation & progress dashboard (V1-15 / V1-16)

> Status: **brainstorm / not yet planned.** Synthesis of a 3-lens ideation panel (UX/product ·
> data-API-efficiency · viz/metrics), each grounded in the repo. This captures the shape and the
> staging so the eventual V1-15/V1-16 plans start from a decision, not a blank page. Backlog rows:
> [plan.md](../plan.md) V1-15 (day navigation) · V1-16 (progress dashboard).

## The ask (Ray)

> Ability to page back and forth through days to see previous workouts and upcoming workouts (if
> programmed) — calendar or prev/next arrows, up for debate. OR alternatively a dashboard showing a
> summary/overview of the last week/month/3mo/year with visualizations — select specific workouts and
> see progress/load over time. Keep it simple and engaging. "I do NOT want it to hammer the API
> unnecessarily." As a UX expert.

## The one reframe that organizes everything

This is **three distinct needs**, not one widget — and they want different UX:

- **N1 — verify / fix a recent day** ("did Scarlett log her weigh-in yesterday?", "I mistyped Tuesday's
  squat"). Short-range, backward, high-frequency. The real daily friction. → **a navigation problem.**
- **N2 — see what's coming** ("what's the plan today / this week?"). Forward-looking, but the data barely
  exists yet (`ramp_targets` is weekly + ships empty; day-grained programming is V1-10 / V2). → **a
  data-availability problem** — thin until later.
- **N3 — feel progress over time** ("am I getting stronger?", "did I hit my ramp this week?").
  Aggregated, motivational, mostly a Ray-reviewing + kid-reward surface. → **a summarization problem.**

N1 is the cheapest and highest-value; N3 is the flashy one but needs accumulated data to not look empty;
N2 is inert until programming data lands. **Don't force them into one screen.**

## Recommended direction & staging (all three lenses converged on this)

**Ship N1 first as a small, self-contained PR; layer the rest as the data to fill them arrives.**

### V1-15 — Day navigation (start here)

- **v1: prev/next day paging, past + today only, history read-only.** Turn the Today route's day from
  `localDayIso(activeTz)` into a URL param (`/p/[id]/d/[date]` or `?d=`), validate with `isoDaySchema`.
  **Factor the current Today `<main>` body into a shared server day-view** so Today and the dated route
  render the same thing (DRY — don't fork the view). Prev/next are two `<Link>`s computing `date ± 1` via
  the safe `…T00:00:00Z` add (reuse the `isoDayDiff` parse; **never `new Date("YYYY-MM-DD")`**). Reuses
  `listEntriesForDay`, `calisthenicsTotals`, `todayRows` **unchanged**.
- **Why read-only history:** it sidesteps the V1-6c ±1 write-bound collision entirely — paging to a day 3
  back with live forms would otherwise hit "that day is no longer open." Logging stays a "today" action;
  no reopening the correctness question the V1-6c panel closed. (Editing past days is V1-9's concern.)
- **v1.x:** a "this week" **7-dot strip** under the date — the cheapest motivation, no new screen.
- **v2 of the feature:** a **month calendar with logged-day dots** — one new DAL fn
  `listEntryDatesForMonth` = a single bounded `SELECT DISTINCT activity_date … WHERE profile_id = ? AND
activity_date >= :monthStart AND < :nextMonth AND deleted_at IS NULL` (index-covered by
  `idx_entries_profile_date`; ≤31 rows). Tapping a day routes into the dated view.

### V1-16 — Progress dashboard (after there's data worth charting)

- **The structural insight:** a progress series is just the existing **`foldAggregation` kernel applied
  per time-bucket** (`date_trunc('day'|'week', activity_date)`) instead of per single day — the same fold
  V1-6a does, coarser `GROUP BY`, dispatched on the `aggregation` field the DTO already carries. **One
  series generator, no per-metric special-casing.** (Code-reuse: the per-bucket query is the same reader
  V1-6b weekly adherence and V1-13 CSV pivot want — route it through one shared query builder so they
  can't drift on NULL-handling / which-readings-count.)
- **v1 tiles (all from data that already exists):**
  1. **Bodyweight trend** — line, month default, `aggregation: last`. **Parent/coach-gated** (SECURITY.md
     marks bodyweight privileged; non-judgmental, no goal band for kids).
  2. **Calisthenics volume + movement picker** — bars, `sum` per bucket (`pushups`/`pullups`/`vsit`). This
     _is_ the "select a movement → load over time" core; the engaging kid tile (watch the bars grow).
  3. _(stretch)_ **Max-progression** — line, `max` (`pullup_max`, `vsit_skill_step`). The home **V1-8a**
     was explicitly waiting for; slots the added-load axis in additively (mirror ADR-0002's nullable
     `target_load`).
- **Later tiles, gated on upstream data:** habit-adherence heatmap/streak (bool habits, `last`);
  **ramp-adherence %** weekly bullet bars (dark until `CALISTHENICS_RAMP_SCHEDULE` is seeded);
  strength load / volume / **est-1RM** per movement for Ray's PPL (`entry_sets`).
- **Restraint (design.md):** one series per chart on phone (the picker _swaps_, never overlays a
  rainbow); grayscale `chart-*`, one accent for today/target only; tap tooltips; ~5 x-ticks at 390px;
  ≲31 points → daily buckets, beyond → weekly. **No projection/forecast lines; est-1RM off by default and
  never surfaced as "lift this next"** (that would be prescription — the LLM-never-authors-loads rule; a
  deterministic rear-view stat of logged data is fine).

## New evidence since this brainstorm (2026-09-24)

Two things happened that change the case for V1-15, both worth recording before it gets planned.

**1. A dated route has a SECOND consumer, and it is the test suite.** The scaffolded-state a11y check
used to `test.skip()` whenever the seeded program had no movements for today — Mon/Wed/Fri only, so it
was silently dead 4 days in 7, and GAP-3 PR 4a shipped without it running once. The fix (#141) works,
but it works by **shifting the Playwright context's timezone** to drag the server-rendered local date
onto an adjacent programmed day, leaning on the accident that every unprogrammed day is adjacent to a
programmed one and that a timezone can move a date by exactly ±1.

That is a correct fix and an ugly one. **With V1-15's dated route the test becomes
`goto('/p/<id>?d=<a Monday>')`** — no timezone gymnastics, no adjacency argument, no ±1 ceiling. Any
future test that needs a specific day (a logged-history fixture, a seeded ramp week, V1-13's export)
gets the same. So V1-15 is not purely user-facing: it pays down test infrastructure that is otherwise
going to keep growing workarounds.

**Sequencing consequence:** when V1-15 lands, revisit `apps/web/e2e/a11y.spec.ts` and delete
`PROGRAMMED_TZ` in favour of the dated route. Noted here so the workaround does not outlive its cause.

**2. The read path this row promised to "reuse unchanged" has changed underneath it.** GAP-3 (#139,
#141) removed `entry_sets.weight_num`/`weight_label`/`seconds` and moved every magnitude into
`entry_set_quantities`. `listEntriesForDay` still works and is still the right reuse — but it now runs
a **second query** for the quantities and returns a wider `SetDTO`, so V1-15's "no new queries" claim
should be **re-verified, not inherited**. The per-navigation cost is two indexed seeks, not one.

Neither changes the recommended staging. Both belong in the V1-15 plan when it is written.

## Explicitly deferred

- **Forward navigation into unprogrammed days** — nothing to show until V1-10 prefill / a seeded ramp
  schedule. **Cap `›` at today in v1.** When forward opens up, a future day shows the _plan_ in a distinct
  "upcoming, not yet done" visual state — never styled like a logged day.
- **Editing past days inline** — that's V1-9; keep history read-only here.
- **Charts / Recharts** — wait for accumulated data + the V1-6b-2 adherence read path; an empty chart is
  worse than no chart.

## Efficiency guardrails ("don't hammer the API")

The route is `force-dynamic` (per-user CSP nonce + per-user data), so there's little data cache today —
"hammering" here means **DB queries per navigation**, and the lever is: keep each query a single indexed
seek, and **avoid speculative prefetch fan-out.**

- **Navigation = RSC-per-day, no speculative prefetch.** Each click = one indexed seek on
  `idx_entries_profile_date`, only on user action. (If tap latency ever bites, prefetch _only_ the
  immediate prev/next — a bounded 2-link prefetch, never a calendar-wide fan-out.) Reject adjacent-day
  client prefetch (2 extra queries per view even if the user never pages).
- **Dashboard = one range fetch per tab**, Recharts rendering the already-aggregated series — not one
  request per point. Read-mostly, so in-memory paging of the aggregate is fine here (it's the wrong model
  for day paging, which wants freshness).
- **No N+1 across days** — never loop `listEntriesForDay` to build a calendar/dashboard; one range query
  (`DISTINCT activity_date` for dots, `GROUP BY week` for rollups), fold in memory.
- **Clamp every date param** server-side: `isoDaySchema` + a max span (e.g. ≤366 days) + sane floor/ceil,
  calendar capped to the visible month — so a crafted URL can't become a full-table scan.
- **`revalidate` scope:** today's `revalidatePath('/p/'+id)` refreshes only the base Today route — a new
  log won't surface in a dated/calendar/dashboard view. Broaden to a subtree `revalidatePath`, or
  (forward-looking) a per-profile **`revalidateTag(profileTag(id))`** single-sourced in `lib/constants.ts`
  and called from all three actions.
- **Every new query keeps `deleted_at IS NULL`** (phantom dots / inflated sums otherwise) and coerces
  `value_num` / `SUM(value_num)` out of pg's numeric-as-string.

## Data-model verdict: no new tables, no new index

`idx_entries_profile_date` serves every read; `uq_ramp_targets_profile_metric_week` serves the adherence
join. At two-kids volume a year is a few hundred rows — on-the-fly aggregation is sub-ms. A materialized
weekly-summary table would add write-path burden + staleness for no benefit (record it in
[tech-debt.md](../tech-debt.md) only if a dashboard query ever goes hot at ~100× volume). "Upcoming
programmed workout" = render the week's `ramp_targets` for any day in that ISO week — no schema change,
inert until the schedule is seeded.

## Engagement without gimmick

Motivation from **honest data made legible**, not confetti (keep the adult-first restraint):

- **Ramp adherence %** ("this week: 78% of your push-up target") — coach-authored, self-evidently
  meaningful; already modeled (V1-6b-2 `<progress>`). Best kid-motivator, already on the roadmap.
- **PRs on `pullup_max`** — a quiet "new best: 9 pull-ups" when the max advances. Zero new schema.
- **The 7-dot week strip** — a streak proxy without the fragility of a streak counter.
- **Leave out:** badges/levels/XP, avatars, per-day encouragement copy. If a streak count is ever used,
  count **adherence-to-plan** (programmed rest days non-breaking), not raw consecutive days.

## Cross-cutting dependency

Day navigation is a forcing function for tz correctness — the "today" highlight, day-bucketing, and
"is this in the future" all inherit it. **V1-6c is the prerequisite:** compute prev/next, the calendar
"today", and range bounds from `localDayIso(activeTz)` / `getActiveLocalDay()`, and reuse b-2's
`localWeekStartIso` for ISO-week bucketing rather than re-encoding weekday math.

## Composition with existing backlog

- **V1-8a** (weighted calisthenics / max-strength) and V1-16 are **mutually enabling** — V1-8a's data is
  invisible until the dashboard exists; the max tile is thin until V1-8a feeds it. Raises the case for
  doing V1-8a around the same time; neither blocks the other.
- **V1-13** (CSV export) shares the `foldAggregation`-per-bucket reader — building either de-risks the
  other; the dashboard is a natural front door for an "Export CSV" button. Priority unchanged.
