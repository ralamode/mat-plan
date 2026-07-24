# ADR 0002 — Calisthenics ramp targets: `ramp_target`, not `goal`

**Status:** Accepted · **Date:** 2026-07-23 · **Scope:** V1-6b (the weekly-adherence data model)

## Context

V1-6 delivers "Log push/pull/v-sit totals; **adherence computed**." V1-6a shipped the logging + a
daily in-memory totals card. The "adherence computed" half needs a place to hold, **per profile and
per week**, the value the kids are ramping toward — so actual weekly performance can be compared
against a target. spec.md §4 names this: adherence is "modeled as **target rows** so it is computable
in SQL." No existing table holds a per-profile, per-week target: `entries` are actuals; the catalogs
(`metric_definitions`, `movements`) are reference data; `sessions`/`day_readiness` are per-day logs.

So V1-6b introduces a new table. The naming question — is this a `goal`, a `ramp_target`, a
`prescription_target`, or the spec's `ladder`/`rung` progression state? — determines what it can and
can't model, and whether it boxes in the V2 progression engine. This ADR settles it.

The domain (Ray's training-science framing): the kids follow a **coach-authored fixed weekly
calendar** — week N sets a rep target, the targets **ramp week over week toward a CAP**, and Ray
adjusts them by hand as the kids progress. It is a schedule, not a computation.

## Decision

**Name the table `ramp_target`.** One row = `(profile, metric, week_start) → target_value`. Idempotency
is the natural key `(profile_id, metric_key, week_start)` (partial-UNIQUE, `WHERE deleted_at IS NULL`),
mirroring `day_readiness`; no `client_id` (this is coach-authored config, not an offline-synced log).

### Why `ramp_target` and not the alternatives

- **Not `ladder` / `rung` / `progression_state`.** Those model **algorithmic, performance-gated
  advancement** — you clear a rung, the engine advances you to the next. The kids' ramp is the
  opposite: a **fixed calendar** authored by a coach, where week N's number is set in advance and
  ramps to a cap regardless of any single week's performance. Performance-gated advancement is real,
  but it is the **V2 progression engine's** job (`packages/engine`, pure `(state, inputs) => decision`,
  golden-vectored) — modelling it here would drag V2's state machine into a V1 read feature and
  conflate "the plan says do 45 this week" with "you earned the next rung." Keeping `ramp_target` a
  dumb calendar row leaves the ladder model free to arrive cleanly in V2.
- **Not `goal`.** A goal is **cumulative / lifetime** and carries **no temporal axis** — e.g. "10,000
  shots" is `SUM(value_num WHERE metric='shot')` with no week. A ramp target is inherently **weekly and
  transient** (`week_start` is part of its identity). Folding both into one `goal` table would force a
  nullable `week_start` and a "which kind of goal is this" discriminant — a tagged union we don't need.
  A lifetime-goal table can arrive later; it is a different shape.
- **Not `prescription_target(load, reps)`.** A prescription target is **prescription-bound** — it
  pairs a load with a rep count for a specific movement/session ("front squat 3×5 @ 135") and has **no
  standalone temporal axis** (it lives on a session/block, not a week). The ramp target is
  metric-scoped and week-scoped, with a single `target_value` — no load, no session binding. These are
  distinct concerns; `ramp_target` is deliberately the smaller one.

### The load axis is the additive future (not modeled now, not boxed out)

Ray's training-science framing: **rep progression caps out, then load/variation takes over.** Once a
kid ramps to the rep cap, the next progression is weighted calisthenics ("8 pull-ups **@ +10 lb**") or
max-strength work — which reuse the `entry_set` `reps + weight` shape. When that lands, `ramp_target`
can extend with a **nullable `target_load`** (rep-only rows keep it NULL; weighted rows set it),
exactly the way `entries` grew generalized columns additively. Choosing the narrow, metric-scoped
`ramp_target` now — rather than a broad `goal` or a prescription pairing — keeps that evolution a clean
expand, and does **not** commit us to a load model before the kids need one.

## Consequences

- V1-6b-1 ships the `ramp_targets` table + migration `0004` + the seed mechanism + a `db:verify` proof
  that weekly SQL adherence (SUM/MAX per metric) matches the shared `foldAggregation` golden vectors.
  No app code; the read DAL + `<progress>` UI are V1-6b-2.
- The V2 progression engine keeps a clean seam: `ramp_target` is a coach-authored calendar, the ladder
  is engine-computed state — they don't share a table.
- A future weighted-calisthenics / max-strength phase extends `ramp_target` with a nullable
  `target_load` (additive), rather than needing a new table or a rework.
- Lifetime goals (10K shots) remain a separate, later concern — not shoehorned into this weekly table.
