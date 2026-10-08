# V1-18 — Engineering plan (Phase 4 panel synthesis)

Locked UX: [ux-decision](./v1-18-ux-decision.md). Three eng lenses (data & API · UI/rendering · scope/delivery)
converged on the build below.

## The rendering mechanism (the open question — RESOLVED)

**Option (b)-refined: per-activity data shape + contiguous-run collapse at render.** Store the full namespaced
per-activity key vocabulary now (no future migration), but the renderer **collapses a contiguous run of
`checkin:*` keys back into ONE existing `CheckinForm(fields=run)`**. This:

- touches `CheckinForm` **zero** (called as today with its existing `fields` prop);
- keeps the batch submit + idempotency + clear-on-success (per-field would be N hydration islands + kill the
  batch — a ships-dark regression forever);
- keeps `DEFAULT_ROUTINE` at **exactly one CheckinForm island = today's hydration cost**;
- honors Ray's interleave at run boundaries (a non-check-in placed _between_ two check-ins → two batch forms,
  the honest self-chosen consequence);
- true per-habit interleave later flips only the renderer — **no migration** (data shape is final).
  Rejected: (a) per-field CheckinForm (island blow-up + batch loss); (c) refactor CheckinForm (net-new machinery
  the plan says to avoid).

## Data & contract (PR1a)

- **`packages/shared/src/routine.ts`** (barrel-exported): `routineConfigSchema` = a **versioned object**
  `{ version: 1, order: [{ key, conditional?: true }] }` (`.strict()`) — object not bare array so the slice-3
  allowlist is additive. `key` = namespaced: `checkin:<CHECKIN_FIELDS key>` (1:1 map — strip prefix = the
  registry key), `strength` (singleton, carries the cosmetic `conditional`), `life:<LIFE_ACTIVITY_KEYS>`,
  `finisher:*` (reserved, validates, not rendered in slice 1). Zod **refinement rejects `bodyweight`** in
  `order` (weigh-in pinned by construction). `DEFAULT_ROUTINE` in the same file reproduces today's exact page.
- **Key validation, single-sourced:** validate the **grammar** (namespace enum/regex) in `shared`; do the
  **catalog-membership drop-unknowns** check in a pure `resolveRoutine(raw, catalog)` helper the DAL calls with
  the app-side catalog (`CHECKIN_FIELDS`/`LIFE_ACTIVITIES` stay app-side — mild AGENTS.md "domain values in
  shared" tension, noted; matches how `life-activities.ts` keeps its trust-set app-side).
- **Migration (`0006`, drizzle-generated):** `ADD COLUMN routine_config jsonb` on `profiles` — **nullable, no
  default, no backfill, NO index** (nothing queries INTO it — that's the JSONB bet). `.$type<RoutineConfig>()`
  is a cast → always zod-parse on read. Squawk-green (metadata-only, no rewrite); standard lock/statement
  timeouts + `IF NOT EXISTS`.
- **DAL:** extend `getProfileByPublicId` — add `routineConfig` to the existing select, resolve via the helper,
  widen `ProfileDTO` with `routine: RoutineConfig` (**always resolved, never null/raw**). One read, no second
  query (hot Today path). `listProfiles` unchanged.
- **Seed:** two kids **different** — Athlete One `null` (exercises ships-dark `DEFAULT_ROUTINE`), Athlete Two an explicit
  reordered config (a check-in key before `strength`, `conditional:true` on strength). `as const satisfies
RoutineConfig`. Caveat: `onConflictDoNothing` → re-seed won't update existing rows; A≠B proves on **fresh
  DBs** (db:verify PGlite + CI Docker PG + Neon branch), which is where the success test runs. Prod
  differentiation is PR2 (Ray). State this in the plan.

## Render (PR1b)

- **`page.tsx`:** replace ONLY the hard-coded 4-section region (lines ~96–128) with: `BodyweightForm` pinned
  **unconditionally above** the map, then `profile.routine.order.map(→ switch on namespace)` →
  `strength`→`<StrengthForm>` · `checkin:*` contiguous run→`<CheckinForm fields={run} loggedFieldKeys={…}>`
  (empty run renders nothing — mirrors current `CHECKIN_FIELDS.length>0`) · `life:*`→a life button ·
  `finisher:*`→not emitted. **No new `'use client'`; no new status layer.**
- **Flat rows:** one `<ol>`, each `<li>` a compact muted `<h2>` (the `text-sm font-medium text-muted-foreground`
  style) + the form — drop the four `text-lg` billboards so a 7-item routine stays scannable; single `<h1>`
  preserved, no skipped heading level, list landmarks.
- **State composition holds:** every form owns self-contained per-instance state; reorder/split just mints
  independent trees + disjoint idempotency keys. Order-independent derivations (`loggedFieldKeys`,
  `loggedLifeKeys`, `calisTotals`, `rows`) computed once, unchanged; the tally + logged-entries list + adherence
  render **below** the map, byte-stable → disjoint from #60 (`EditableSet`, lines ~279–299) and #61 (oldest-first,
  in `todayRows`/DAL). Minimizes rebase conflict.
- **The ONE real form-touch:** `LifeForm` maps `LIFE_ACTIVITIES` internally and takes no subset → `life:wake` as
  its own item needs one **additive** `activityKeys` prop (or expose `LifeButton`). Keep it additive, not a
  refactor. (Alt: collapse `life:*` as a run too, deferring per-life interleave.)

## Scope, sequencing, tests

- **PR split (revised): PR1a (data) + PR1b (render), then deferred PR2/PR3.**
  - **PR1a `db/v1-18-routine-config`** (~150 lines) — migration + shared schema + `DEFAULT_ROUTINE` +
    `resolveRoutine` + seed + `db:verify` + tech-debt (a). **Zero `page.tsx` → no #60/#61 dependency → cut off
    fresh `main` NOW, in parallel.** It's a **migration PR** → committed plan + **5-lens adversarial panel (incl.
    DB-safety)** + the DB CI gate matrix (Squawk · drizzle drift clean · applies on Docker PG + Neon branch ·
    seed idempotent twice).
  - **PR1b `feat/v1-18-render-from-config`** (~60 net + screenshots) — the `page.tsx` reshape. **Cut from fresh
    `main` AFTER #60 + #61 merge** (same page region). Tri-viewport screenshots required (visible layout change)
    - one minimal ordering smoke.
  - **PR2** (coach config UI: checklist + ▲▼ + **copy-from-kid**) and **PR3** (per-kid check-in allowlist) —
    fully deferred; not needed for the success test (seed proves "settable").
- **Success test** (Kid A ≠ Kid B, in stored order, weigh-in first, ships dark) is met by **PR1a + PR1b alone**.
- **Tests:** shared unit (DEFAULT parses · drop-unknowns · `bodyweight` illegal · cosmetic `conditional`
  accepted-ignored); `db:verify` (column is jsonb · two seeds distinct · `NULL→DEFAULT` round-trip · idempotent);
  PR1b Playwright tri-viewport + one ordering smoke. No new Server Action in slice 1 → no boundary tests.
- **Tech-debt:** (a) JSONB-vs-typed-columns + the **promotion trigger** (→ `routine_items` table when V1-10 needs
  to query/join/schedule) lands in **PR1a**; (b) the config-route **auth gap** (access-gate is UX-not-security;
  closes at Clerk v1.5) lands in **PR2**.

## The V1-10 seam (held firm)

V1-18 stores **what + in what order** (+ an opaque `conditional` marker it never reads). V1-10 owns **when +
from-which-template** (real day/block scheduling → flips `conditional` functional; block-template generation;
rest-day render; runtime DB catalog for net-new types; JSONB→table promotion). V1-18 encodes **no**
schedule/weekday/block — no front-running.
