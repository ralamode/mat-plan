# V1-6b-2 — calisthenics ramp: read DAL + `<progress>` "this week" adherence UI

> Backlog: [plan.md](../plan.md) row V1-6b. Branch: `feat/v1-6b-2-adherence-ui`.
> Follow-up to V1-6b-1 (#48). Closes the "Adherence computed vs weekly targets" clause.

## 1. Scope decision (read first)

This is the **thin, mechanical follow-up** that V1-6b-1's plan already specified verbatim
(`docs/plans/v1-6b-calisthenics-ramp.md` §"Out-of-scope / deferred → V1-6b-2", lines 158–179). b-1
shipped the `ramp_targets` table, migration `0004`, the empty seed mechanism, and the `db:verify` proof
that the weekly SUM/MAX SQL rollup equals the `foldAggregation` golden vectors. **b-2 surfaces it and
nothing more.**

- **No migration.** `ramp_targets` (`packages/db/src/schema.ts:353`) and its types
  (`packages/db/src/types.ts` — `RampTargetRow`/`NewRampTarget`) already exist. No schema change, no `0005`.
- **This is the PR that flips `plan.md` V1-6b to done** (b-1 explicitly did not — see the plan's
  "Acceptance accounting", lines 18–20).
- **Depends on V1-6c (#50, merged).** "Today" is now the active-tz local calendar date
  (`localDayIso(timeZone)` in `app/p/[profileId]/page.tsx`). The ISO-week boundary the DAL keys on
  **must** derive from that local today, not UTC. V1-6c deferred the `localWeekStartIso(day)` helper to
  this PR.
- **Do not redesign the scope.** The three reuse obligations (profile-scoping, aggregate-selection,
  DTO/mapper) are pre-specified; §7 audits them (the panel strengthened #2 into single-sourcing the whole
  query — see R1/R4).
- Size: small PR, **~300–380 changed lines** across ~10 files (well under the 400-line one-concern
  target), the bulk being the DAL fn, the two pure helpers + their test matrices, and the UI component.

## 2. Acceptance

**plan.md criterion (verbatim):** _"Adherence computed vs weekly targets."_ — closes here.

Done when:

- A `server-only` read DAL fn returns, per (profile public id, ISO-week Monday), a minimal DTO array
  `{ metricKey, label, actual, target }` — actual = the weekly SQL SUM/MAX of `done`, non-deleted,
  in-week calisthenics `entries`; target = the `ramp_targets.target_value` for that profile/metric/week.
- **Graceful empty state:** the schedule ships `[]` (`packages/shared/src/ramp-schedule.ts`), so there
  are zero `ramp_targets` today → the DAL returns `[]` → the page renders **no adherence section**
  (mirrors the `calisTotals.length > 0 ?` guard in `page.tsx`). No crash, no empty card.
- **Profile-scoped** by `public_id` through the existing `entries`→`profiles` join seam
  (`lib/dal/entries.ts`), never a raw internal id; household scope explicitly deferred to v1.5 exactly as
  `entries.ts` does. No third hand-rolled scoping path.
- **Timezone-correct week boundary:** `weekStart = localWeekStartIso(day)` where
  `day = localDayIso(timeZone)`; `localWeekStartIso` computes the **Monday-based** ISO-week start via the
  safe `…T00:00:00Z` parse (never `new Date("YYYY-MM-DD")`), covered by a DST/month/year-boundary unit
  matrix.
- **Per-metric `<progress value={actual} max={target}>`** on `/p/[profileId]`: semantic, with a real
  `<label>`/accessible text stating the metric and the actual-vs-target numbers; renders only metrics
  that have a target for the week; ≥44px-friendly, adaptive at mobile ~390 / tablet ~820 / desktop ~1280.
- **Numeric-string coercion:** pg returns `numeric`/aggregate results as strings; every value is
  `Number()`-coerced in the mapper before it reaches the DTO (the `entries.ts` convention). A missing
  actual (LEFT JOIN null) coerces to `0`.
- **The adherence query is single-sourced** in `packages/db` (`weeklyAdherenceRows`) and run by both the
  DAL and the `db:verify` proof, so the join shape + predicate set can't drift; the `{sum,max}` membership
  lives once in `assertRollupAggregation` (`packages/shared`).
- Tri-viewport screenshots of the populated "This week" state attached (mobile + desktop min), captured
  via the ephemeral-DB flow with a seeded `ramp_targets` row.
- All gates green: typecheck · lint · prettier · `pnpm --filter web test` · `db:verify` · `next build`.

## 3. Design decisions

### 3a. `localWeekStartIso` — home, algorithm, safety (`apps/web/lib/date.ts`)

Lives in `lib/date.ts` alongside `localDayIso`/`isoDayDiff`/`formatDayLong` — the pure, injectable
date-helper module V1-6c established. Signature: `localWeekStartIso(day: string): string`, `day` and
return both `YYYY-MM-DD`.

Algorithm (UTC-anchored integer-day math — the same idiom as `isoDayDiff`):

1. `const t = Date.parse(`${day}T00:00:00Z`)` — the **safe** parse the module mandates; **never**
   `new Date(day)` (the exact trap `date.ts` warns against).
2. `const dow = new Date(t).getUTCDay()` (0=Sun…6=Sat). Monday-based offset back to Monday:
   `const backToMonday = (dow + 6) % 7`.
3. `new Date(t - backToMonday * 86_400_000).toISOString().slice(0, 10)`.

**Why this is DST/tz-safe:** the input is _already_ the active-tz local calendar date (the caller passes
`localDayIso(timeZone)`), so there is no zone left to reinterpret — this is pure calendar arithmetic on a
bare date. Anchoring at UTC-midnight and subtracting whole `86_400_000`ms days never crosses a DST
discontinuity (no local offset is ever applied), so a week spanning a spring-forward/fall-back weekend
still lands on the correct Monday. This mirrors why `formatDayLong` deliberately formats in UTC.
**Monday-based**, matching `ramp_targets.week_start` ("ISO-week Monday (UTC)", `schema.ts:364`, and the
b-1 fixture `2026-01-05` = a Monday) — explicitly **not** Sunday-based.

### 3b. The single-sourced query + `assertRollupAggregation` (panel R1/R3/R4)

**The query is single-sourced in `packages/db`, not restated in the DAL.** The panel falsified the plan's
original "the DAL reads the shape `db:verify` pins" claim: the pinned proof is a _different_ join
(`INNER JOIN entries`, no `profiles`/`metric_definitions`, `sum`-only), so the DAL's real LEFT-JOIN paths
would ship untested and the predicate set would be a third copy (R1). Fix:

```ts
// packages/db/src/queries/weekly-adherence.ts  (drizzle lives in packages/db; both consumers import it)
export type WeeklyAdherenceRow = {
  metricKey: string;
  label: string;
  aggregation: MetricAggregation;
  target: string;
  actualSum: string | null;
  actualMax: string | null;
};
export function weeklyAdherenceRows(
  db: MatPlanDb, // the drizzle db (app pool singleton OR the verify PGlite db)
  args: {
    profilePublicId: string;
    weekStart: string;
    activityTypeId: number;
    metricKeys: readonly string[];
  },
): Promise<WeeklyAdherenceRow[]>;
```

Query (one place, run by both the DAL and the `db:verify` proof — so the proof exercises the DAL's exact SQL):

- `FROM ramp_targets`
- `INNER JOIN profiles ON ramp_targets.profile_id = profiles.id AND profiles.public_id = $profilePublicId`
  — the existing ownership seam (`entries.ts` `publicId` join), no internal id from the request.
- `INNER JOIN metric_definitions ON ramp_targets.metric_key = metric_definitions.key` — for `label` **and**
  `aggregation`.
- `LEFT JOIN entries ON entries.profile_id = ramp_targets.profile_id AND entries.metric_key =
ramp_targets.metric_key AND entries.activity_type_id = $activityTypeId AND entries.status = 'done' AND
entries.deleted_at IS NULL AND entries.activity_date >= ramp_targets.week_start AND
entries.activity_date < ramp_targets.week_start + WEEK_LENGTH_DAYS` — **LEFT** so a zero-bout target still
  renders (`actual 0`); all four entry filters sit in the **`ON`**, never the `WHERE` (moving any to `WHERE`
  would silently inner-join and drop zero-bout rows — R12).
- `WHERE ramp_targets.week_start = $weekStart AND ramp_targets.deleted_at IS NULL AND
ramp_targets.metric_key IN $metricKeys` — the last clause filters targets to `CALISTHENICS_METRIC_KEYS`
  so a stray non-calisthenics target **degrades (excluded)** rather than crashing the read (R2), and makes
  the calisthenics scope explicit.
- `GROUP BY ramp_targets.metric_key, metric_definitions.label, metric_definitions.aggregation,
ramp_targets.target_value`, selecting **typed** `sum(value_num) AS actualSum` + `max(value_num) AS
actualMax` (typed columns, not a `row[token]` lookup — R3).

**`assertRollupAggregation`** (R4) — a small guard **co-located in `packages/shared/src/aggregation.ts`**
(next to `foldAggregation`, drizzle-free):

```ts
export function assertRollupAggregation(aggregation: MetricAggregation): 'sum' | 'max';
```

Returns `'sum'`/`'max'`, **throws** on `avg`/`last`. It single-sources only the `{sum,max}` **membership**
— reused by the DAL mapper's switch **and** `verify.ts`'s existing membership guard. It is _not_ framed as
a "SQL kernel twin" (the column aliases already equal the tokens); it's a domain guard.

### 3c. The read DAL (`apps/web/lib/dal/adherence.ts`, NEW)

New file next to `entries.ts`/`profiles.ts`, headed `import 'server-only'`, using the shared `db`
singleton (`lib/dal/db.ts`). It calls the shared query, then maps rows → DTO (DTO shaping stays in the
DAL; the drizzle query stays in `packages/db`):

```ts
export type AdherenceDTO = { metricKey: string; label: string; actual: number; target: number };
export async function getWeeklyAdherence(
  profilePublicId: string,
  weekStart: string,
): Promise<AdherenceDTO[]>;
```

- Resolves the calisthenics activity id via the cached `getActivityTypeIdByKey(ACTIVITY_TYPE_KEYS.calisthenics)`
  (`lib/dal/catalog.ts`, the `entries.ts` precedent), then
  `weeklyAdherenceRows(db, { profilePublicId, weekStart, activityTypeId, metricKeys: CALISTHENICS_METRIC_KEYS })`.
- **`toAdherence` mapper** (exported, pure, unit-tested): picks the actual with a **typed switch** on the
  guarded aggregation — `assertRollupAggregation(row.aggregation) === 'sum' ? row.actualSum : row.actualMax`
  — then `Number(… ?? 0)` (null-actual→0 for un-logged targets) and `Number(row.target)`, reusing the
  `entries.ts` numeric-string idiom. `label` reuses the joined `metric_definitions.label` (not a re-map).
  Orders by `ACTIVITY_METRIC_MAP.calisthenics` (the display order `activity-totals.ts` uses) so the bars
  match the totals-card ordering.
- Graceful empty: no targets for the week → the query returns no rows → `[]` → the page hides the section.

### 3d. The `<progress>` UI (`app/p/[profileId]/weekly-adherence.tsx`, NEW) + page wiring

A server component (no `'use client'` — RSC-first), rendered from the page only when
`adherence.length > 0`. Shape, mirroring the "Calisthenics today" card for visual consistency:

- `<section aria-labelledby="ramp-week-heading">` with an `<h2 id="ramp-week-heading">This week</h2>`
  (adult-restraint copy; sits near the totals card).
- `<ul>`/`<li>` per metric; each `<li>` contains a `<label htmlFor={`ramp-${metricKey}`}>` naming the
  metric and a visible `{actual} / {target}` (tabular-nums), then
  `<progress id={`ramp-${metricKey}`} value={actual} max={target}>{actual} of {target}</progress>`. The
  `<label>` + child text give the accessible name/fallback; `value`/`max` give the native semantics — no
  ARIA needed, no `div`-soup.
- Adaptive: Tailwind fluid widths (`w-full` progress, `flex`/`justify-between` label row that
  stacks/wraps at narrow widths), no fixed pixel widths — the mobile-first rule.
- **Edge:** guard `max={target}` for `target > 0` (b-1's CHECK allows `>= 0`; a `0` target would make
  `<progress>` indeterminate) — clamp/skip a zero-target row defensively.

Page wiring (`page.tsx`): after `const day = localDayIso(timeZone)`, add
`const weekStart = localWeekStartIso(day)`, then fetch the two independent reads **in parallel** (R5):
`const [entries, adherence] = await Promise.all([listEntriesForDay(profile.id, day), getWeeklyAdherence(profile.id, weekStart)])`
(recall `profile.id` is the **public id** — `ProfileDTO.id` is `publicId`). Render
`<WeeklyAdherence rows={adherence} />` guarded by `adherence.length > 0`, positioned next to the totals
`<section>`.

The card shell (`<section aria-labelledby><h2>…<ul>`) is visually the same as the inline "Calisthenics
today" totals card, but the **rows differ** (totals: `span`+`span`; adherence: `label`+`<progress>`) and
the totals card is inline. Per AGENTS.md "don't over-abstract", the shell is **not** extracted now
(R10) — accept the ~2-line similarity; extract a shared card on the third occurrence (rule of three).

### 3e. Screenshots need a seeded target (`scripts/screenshot-ephemeral.ts`, EDIT)

Because the schedule is `[]`, the section renders nothing on seeded data alone — so add a fixture.
**Extend the existing `calisthenics` state** (`seedCalisthenics`) — it already seeds the exact bouts the
ramp bars want as their actuals (R9) — with one `schema.rampTargets` row per calisthenics metric for the
**current** ISO week: `weekStart = localWeekStartIso(localDayIso(DEFAULT_TIME_ZONE))` (same helpers the
page uses). Targets slightly above the logged actuals (e.g. pushups target 60 vs actual 50) so the bars
render partially filled. `targetValue: String(n)` (numeric column takes a string), `publicId: newId()`,
`onConflictDoNothing` on the natural key. Then `pnpm --filter web screenshot:ephemeral /p --state calisthenics`
emits the tri-viewport PNGs (one richer capture: totals card + "This week" bars).

## 4. File-by-file changes

| Path                                              | Change | What & why                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/queries/weekly-adherence.ts`     | NEW    | `weeklyAdherenceRows(db, args)` + `WeeklyAdherenceRow` — the single-sourced LEFT-JOIN query (drizzle lives in `packages/db`), run by **both** the app DAL and the `db:verify` proof (R1). Filters targets to `metricKeys` (R2); typed `actualSum`/`actualMax` (R3); `WEEK_LENGTH_DAYS`.                       |
| `packages/shared/src/aggregation.ts`              | EDIT   | Add `assertRollupAggregation(agg)→'sum'\|'max'` (throws on avg/last) next to `foldAggregation` (R4). Single-sources the `{sum,max}` membership.                                                                                                                                                               |
| `packages/shared/src/index.ts`                    | EDIT   | Add `WEEK_LENGTH_DAYS = 7` (domain const, R8); re-export the new `aggregation` symbol if not already barrelled.                                                                                                                                                                                               |
| `apps/web/lib/entries/adherence-mapper.test.ts`   | NEW    | Pure unit for `assertRollupAggregation` + `toAdherence` (colocated with the `fold-aggregation` test precedent for exercising `shared`/DAL logic from web's vitest).                                                                                                                                           |
| `apps/web/lib/date.ts`                            | EDIT   | Add `localWeekStartIso(day)` — Monday-based ISO-week start via the safe `…T00:00:00Z` parse + integer-day UTC math. JSDoc claims it as **the** week-boundary seam for V1-15/dashboard (R6).                                                                                                                   |
| `apps/web/lib/date.test.ts`                       | EDIT   | Add the `localWeekStartIso` matrix (month/year/DST boundaries; Monday-vs-Sunday).                                                                                                                                                                                                                             |
| `apps/web/lib/dal/adherence.ts`                   | NEW    | `getWeeklyAdherence(profilePublicId, weekStart)` + `AdherenceDTO` + pure `toAdherence` mapper. `server-only`; resolves the cached calisthenics id + calls `weeklyAdherenceRows`; typed sum/max switch; DTO shaping.                                                                                           |
| `apps/web/app/p/[profileId]/weekly-adherence.tsx` | NEW    | Server component: semantic `<section>`/`<ul>`/`<label>` + `<progress value max>` per metric; adaptive/a11y. Card shell mirrors the totals card (accepted, not extracted — R10).                                                                                                                               |
| `apps/web/app/p/[profileId]/page.tsx`             | EDIT   | Import `localWeekStartIso` + `getWeeklyAdherence`; compute `weekStart`; **`Promise.all([listEntriesForDay, getWeeklyAdherence])`** (R5); render `<WeeklyAdherence>` guarded by non-empty.                                                                                                                     |
| `apps/web/scripts/screenshot-ephemeral.ts`        | EDIT   | Extend the existing `calisthenics` state (`seedCalisthenics`) with `ramp_targets` rows for the current ISO week (targets above the seeded actuals) so the `<progress>` state is capturable (R9).                                                                                                              |
| `packages/db/scripts/verify.ts`                   | EDIT   | Call `weeklyAdherenceRows` for the adherence assertions (proof runs the DAL's exact query); add a **zero-bout target** (assert `actual=0`) + a **cross-profile target** (assert isolation) fixture; route its membership guard through `assertRollupAggregation`. Keep the hardcoded golden literals (R1/R4). |
| `docs/plan.md`                                    | EDIT   | Flip the V1-6b row to done; the "closes at V1-6b-2" clause satisfied.                                                                                                                                                                                                                                         |
| `docs/status.md`                                  | EDIT   | Move V1-6b-2 from "Next up" to "Merged & live"; changelog + pointer bump (status rides with the work).                                                                                                                                                                                                        |
| `docs/plans/v1-6b-2-adherence-ui.md`              | NEW    | This plan.                                                                                                                                                                                                                                                                                                    |

## 5. Test plan

- **`localWeekStartIso` (pure unit, `date.test.ts`):** Monday input → itself; Sunday → the _prior_ Monday
  (pins Monday-based, not Sunday); mid-week → that week's Monday. Boundary weeks: crossing a **month** end
  (e.g. `2026-01-01`→`2025-12-29`), a **year** end, and **DST** weekends (spring-forward `2026-03-08`,
  fall-back `2026-11-01` — assert the arithmetic is unaffected because it's UTC-anchored). Reuse the
  existing suite's DST anchor dates.
- **`assertRollupAggregation` (pure unit):** `sum→'sum'`, `max→'max'`; `avg`/`last` throw. Assert against
  `METRIC_AGGREGATION.*` consts (not literals), per the constants rule. A guard test that walks
  `CALISTHENICS_METRIC_KEYS` × their seeded `aggregation` and asserts each is accepted (the runtime twin of
  the b-1 static guard — and `verify.ts`'s membership guard now calls the same helper, so the `{sum,max}`
  domain lives in one place).
- **`toAdherence` mapper (pure unit):** given a fake `WeeklyAdherenceRow`
  `{ metricKey, label, aggregation, target:'45', actualSum:'50', actualMax:'5' }`, a `sum` metric yields
  `actual:50`, a `max` metric yields `actual:5`; a null-actual row (`actualSum:null` — un-logged target)
  yields `actual:0`; strings are `Number()`-coerced. The typed switch (not `row[token]`) means a wrong
  aggregation never silently reads the wrong column. This is the extracted, sync, testable core.
- **DAL query — the proof now runs the DAL's EXACT query (R1).** The original "already proven" claim was
  false (the pinned join was `INNER`, `sum`-only, no profile/label joins). Because the query is
  single-sourced in `packages/db` (`weeklyAdherenceRows`), `verify.ts` calls **that same function** against
  its PGlite fixtures — so the LEFT-JOIN + profiles + metric_definitions + `Number(null ?? 0)` paths are
  genuinely exercised on real SQL. New fixtures/assertions in `verify.ts`: (a) the existing populated week
  still returns `actual 50 / target 45`; (b) a **zero-bout target** (a `ramp_targets` row with no matching
  entries that week) asserts `actual === 0` (the LEFT-JOIN `sum(NULL)` path); (c) a **second profile's
  target** asserts profile A's call never returns B's rows (scoping). The existing golden assertions stay
  **hardcoded** — `SUM(pushups)=50=foldAggregation('sum',[20,30])`, `MAX(vsit_skill_step)=5`, decoys
  excluded — as the independent anchor (not routed through `assertRollupAggregation` — R4). `getWeeklyAdherence`
  itself stays `server-only` (app `db` singleton, can't import into `packages/db`); its DTO mapping is the
  pure `toAdherence` unit test, and the real read path is also covered by the `e2e` smoke + screenshots.
- **e2e / screenshots:** the `e2e` smoke covers the real read path through Playwright. Capture the
  populated "This week" state at three widths via `screenshot:ephemeral` with the seeded ramp target
  (§3e); attach mobile + desktop to the PR description.
- **Local gate:**
  `pnpm typecheck && pnpm lint && pnpm --filter web test && npx prettier --check . && pnpm --filter @mat-plan/db db:verify && pnpm build`.

## 6. Risks / rollback

| Risk                                                                                                       | Mitigation                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Empty-schedule reality** — nothing renders in prod until the coach numbers land.                         | Intended (b-1 decision): DAL returns `[]`, page hides the section. b-2 delivers the _mechanism_; the data-only PR lights it up. Screenshots use a seeded fixture (§3e) to prove the populated state.                                               |
| **Tz week-boundary edge** — off-by-one Monday, Sunday-vs-Monday, or the `new Date("YYYY-MM-DD")` UTC trap. | `localWeekStartIso` uses the mandated `…T00:00:00Z` parse + pure integer-UTC-day math; the unit matrix pins month/year/DST boundaries and Monday-based semantics. Key derives from `localDayIso(timeZone)` (V1-6c correctness).                    |
| **SQL ↔ `foldAggregation` drift.**                                                                         | Already gated by `db:verify` (b-1); its golden SUM/MAX assertions stay hardcoded as the independent anchor.                                                                                                                                        |
| **DAL ↔ proof query drift** (the R1 blind spot the panel caught).                                          | The query is single-sourced in `packages/db` (`weeklyAdherenceRows`) and run by **both** the DAL and `db:verify`; there is no second copy to drift. New zero-bout + cross-profile fixtures exercise the DAL's LEFT-JOIN/scoping paths on real SQL. |
| **No migration** — schema assumptions stale.                                                               | None: table + types + covering indexes + partial UNIQUE already merged (`schema.ts:353`). b-2 is read-only app code.                                                                                                                               |
| **`<progress>` with `target=0`** renders indeterminate.                                                    | Defensive clamp/skip of zero-target rows in the component; b-1 CHECK only enforces `>= 0`.                                                                                                                                                         |

**Rollback:** revert the PR — pure additive app code + two pure helpers + a doc/status flip; no
migration, no data change, reversible by omission.

## 7. Reuse obligations audit

1. **Profile-scoping — reuse, not a third path (SATISFIED).** `getWeeklyAdherence` scopes by `public_id`
   through the same `INNER JOIN profiles ON …public_id = $id` seam `listEntriesForDay` uses
   (`apps/web/lib/dal/entries.ts`) and that `getProfileByPublicId` documents as the ownership seam
   (`apps/web/lib/dal/profiles.ts`). Household scope is **explicitly deferred to v1.5**, identically to
   `entries.ts`. No new scoping mechanism.
2. **Aggregate selection + the query itself — genuinely single-sourced (SATISFIED, strengthened by the
   panel).** The `{sum,max}` **membership** lives once in `assertRollupAggregation`
   (`packages/shared/src/aggregation.ts`), reused by the DAL mapper and `verify.ts`'s membership guard. More
   importantly, the whole **adherence query** (join shape + predicate set + `WEEK_LENGTH_DAYS`) is single-
   sourced in `packages/db` (`weeklyAdherenceRows`) and run by both the DAL and the `db:verify` proof — so
   the predicate set is no longer copy-pasted (the R1 fix), and `verify.ts`'s golden **assertions** stay
   hardcoded as the independent anchor (not routed through the guard — R4).
3. **DTO / `toAdherence` mapper (SATISFIED).** `AdherenceDTO { metricKey, label, actual, target }` with an
   extracted, unit-tested `toAdherence` row→DTO mapper; `label` reuses the joined `metric_definitions.label`
   (the source `activity-totals.ts` already reads), numeric coercion reuses the `entries.ts` `Number()`
   idiom.

## 8. Review-response log (adversarial panel)

Four lenses (correctness/data-integrity · simplicity/scope · architecture/consistency · code-reuse). No
blocking defect, but three lenses **independently** falsified the plan's central testing claim (the DAL
query ≠ the query `db:verify` pins), which reshapes the design toward genuine single-sourcing. The
correctness lens recomputed the `localWeekStartIso` matrix and the LEFT-JOIN fan-out and confirmed both
correct. Every should-fix is incorporated below.

| #   | Lens                                              | Critique                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | correctness + architecture + code-reuse (all 3)   | **The plan's "already proven by `db:verify`" claim is false.** The pinned proof is `FROM ramp_targets INNER JOIN entries`, grouped by `(metricKey, targetValue)`, no `profiles`/`metric_definitions` joins, `sum` only. The DAL ships `LEFT JOIN entries` + INNER `profiles` + INNER `metric_definitions`. So the DAL's unique risk paths — **un-logged-target→`actual 0`** (LEFT `sum(NULL)`), **profile scoping**, the **label join** — ship with **zero** automated coverage while the plan claims the opposite. And the entry-filter predicate set is now copy-pasted a **third** time (two in `verify.ts`, one in the DAL) with no drift guard. | **Incorporated — single-source the query, converge the proof.** New `packages/db/src/queries/weekly-adherence.ts`: `weeklyAdherenceRows(db, { profilePublicId, weekStart, activityTypeId, metricKeys })` returns the raw LEFT-JOIN rows (`{ metricKey, label, aggregation, target, actualSum, actualMax }`). **Both** the app DAL and `verify.ts` call it (the DAL passes the app `db` singleton + resolved calisthenics id; `verify.ts` passes its PGlite `db`) → the proof runs the DAL's **exact** SQL. `verify.ts` gains two fixtures: a **zero-bout target** (assert `actual === 0`) and a **second profile's target** (assert cross-profile isolation). Predicate set + join shape + week length now live in one place. Closes correctness #1, architecture #1, code-reuse A/B. |
| R2  | correctness (should-fix)                          | **A non-`{sum,max}` ramp target crashes the whole read** (page → error.tsx). Nothing constrains `ramp_targets.metric_key` to calisthenics — the FK is to any `metric_definitions.key`. A coach authoring a `bodyweight` target (aggregation `last`) surfaces as a row (the `activity_type=calisthenics` filter is only on the entries side) → the mapper's aggregation guard throws → `getWeeklyAdherence` rejects → 500.                                                                                                                                                                                                                            | **Incorporated.** The shared query filters targets to `metric_key IN CALISTHENICS_METRIC_KEYS` (reusing the shared const), so a stray non-calisthenics target is **excluded** (degrades) rather than crashing — and it makes the calisthenics scope explicit at the query. The mapper's aggregation guard stays as defense-in-depth.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| R3  | correctness + architecture                        | **Alias-as-token coupling.** `row[pickAggregate(agg)]` requires the SELECT to alias columns exactly `'sum'`/`'max'`; a rename on either side silently yields `undefined ?? 0 = 0` (all bars read 0), untyped, no compile error. `verify.ts` even uses different aliases (`actualSum`/`actualMax`).                                                                                                                                                                                                                                                                                                                                                   | **Incorporated.** The shared query returns **typed** `actualSum`/`actualMax` columns; the mapper picks with a **typed switch** on the guarded aggregation (`sum → row.actualSum`, `max → row.actualMax`), never a dynamic `row[token]`. A rename now fails typecheck, not silently at runtime.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| R4  | simplicity + architecture + code-reuse            | **`pickAggregate` is an identity function wearing a kernel's costume** (the column aliases equal the aggregation tokens, so `row[pickAggregate(agg)]` ≡ `row[agg]`); calling it "the SQL-side twin of `foldAggregation`" oversells it, and routing `verify.ts`'s **assertions** through it would make the proof partly self-referential (it must keep hardcoding `SUM(pushups)===50` / `MAX(vsit)===5` as the independent anchor). But the `{sum,max}` **membership** is defined in 3 places.                                                                                                                                                        | **Incorporated — reframe + narrow.** Replace the standalone `pick-aggregate.ts` with a small **`assertRollupAggregation(agg): 'sum'                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 'max'`** guard **co-located in `packages/shared/src/aggregation.ts`** (next to `foldAggregation`; drizzle-free token). It single-sources only the `{sum,max}`**membership** — reused by the DAL mapper's switch **and**`verify.ts`'s existing membership guard. `verify.ts`'s **golden assertions stay hardcoded** (literal 50/5 + explicit `foldAggregation('sum'/'max', …)`) as the independent anchor — not DRY'd away (noted in §7). The "route verify's selection through the helper" idea is **dropped**. Resolves OQ1 (token, in `aggregation.ts`). |
| R5  | architecture (should-fix)                         | `getWeeklyAdherence` is added as a **sequential** third awaited DB read after `listEntriesForDay`, though independent of it — an extra serial round-trip on the hot page (INP/LCP is a first-class rule).                                                                                                                                                                                                                                                                                                                                                                                                                                            | **Incorporated.** `page.tsx` computes `day`/`weekStart` (sync), then `const [entries, adherence] = await Promise.all([listEntriesForDay(...), getWeeklyAdherence(...)])`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| R6  | architecture + code-reuse                         | `localWeekStartIso` is the **first "week" primitive** in the repo; to guarantee V1-15 (day-nav) / the dashboard reuse it rather than hand-roll a parallel week helper, it should explicitly claim the seam.                                                                                                                                                                                                                                                                                                                                                                                                                                          | **Incorporated.** `localWeekStartIso` JSDoc declares it **the** ISO-week-boundary seam (V1-15 / dashboard bucket here).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| R7  | architecture + correctness                        | The DAL hard-filters `entries.activity_type_id = calisthenics`, so the whole feature is implicitly **calisthenics-only**; a future non-calisthenics ramp would silently read `actual 0`. Also confirm no foreclosure of ADR-0002 `target_load`.                                                                                                                                                                                                                                                                                                                                                                                                      | **Incorporated (documented constraint).** The calisthenics-only assumption is noted at the query join (greppable, deliberate) and in §7. Confirmed additive-safe for `target_load`: `AdherenceDTO` + `<progress>` grow a load field/second bar without rework; the fixture seeds `ramp_targets` directly (no collision with the later `CALISTHENICS_RAMP_SCHEDULE` data-only PR).                                                                                                                                                                                                                                                                                                                                                                                                     |
| R8  | code-reuse (should-fix)                           | Week length **`7`** is an unnamed literal in ≥2 (soon ≥4) places (`verify.ts:795/810`, the DAL).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **Incorporated.** `WEEK_LENGTH_DAYS = 7` named in `packages/shared` (domain const), imported by the shared query; the `week_start + N` add uses it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| R9  | simplicity + correctness                          | OQ2: extend the existing `calisthenics` screenshot state vs a new `ramp` state. The `calisthenics` state already seeds the exact bouts the ramp bars want as actuals; a new state duplicates them.                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **Resolved — extend `calisthenics`.** Seed the `ramp_targets` rows (targets slightly above the seeded actuals) into `seedCalisthenics`; one richer combined capture (totals card + "This week" bars), less code.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| R10 | code-reuse (should-fix) **— partially overruled** | The `<progress>` card's `<section aria-labelledby><h2>…<ul>` shell duplicates the inline "Calisthenics today" totals card; "two occurrences is the trigger, lean extract."                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **Overruled with reason (accept + note).** The genuinely-identical part is ~2 lines of Tailwind on the `<section>`/`<h2>` wrapper; the **rows differ** (totals: `span`+`span`; adherence: `label`+`<progress>`), and the totals card is inline, not a component. Extracting a generic card shell (and adopting it in the working totals card) expands a "thin" PR and edges into the shadcn-`Card`-vs-raw-section question — the kind of single-purpose-shell indirection AGENTS.md's "don't over-abstract" clause covers. **Accept the shell similarity, note it; extract on the third occurrence (rule of three).** `WeeklyAdherence` stays its own colocated component (consistent with the route's `*-form.tsx` files).                                                           |
| R11 | code-reuse (nit)                                  | The b-1 obligation also offered "extract a shared profile-scoping helper"; the plan re-types the `eq(profiles.publicId, id)` + join idiom a 5th time.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | **Accepted as-is (defer).** `entries.ts` already inlines this idiom 4×; matching it is consistent, not a regression. A `scopeToProfile()` where-fragment is a separate cleanup, not this PR. Noted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| R12 | correctness (confirmations)                       | Recomputed: `localWeekStartIso` is off-by-one-free (Mon→itself, Sun→**prior** Mon, 2026-01-01 Thu→2025-12-29, DST weekends unaffected because UTC-epoch integer-day math applies no offset); the LEFT JOIN + GROUP BY **does not fan out** (PK/UNIQUE joins, filters correctly in the `ON` not the `WHERE`); numeric coercion + profile scope + week filter `< week_start + 7` all correct.                                                                                                                                                                                                                                                          | **Kept as-is.** These are the load-bearing correctness properties; unchanged by the above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

**Net change from the panel:** (1) the SQL is single-sourced in `packages/db` (`weeklyAdherenceRows`) and the `db:verify` proof **converges onto the DAL's exact LEFT-JOIN query** with new zero-bout + cross-profile fixtures (R1) — this replaces the false "already proven" claim with a real one. (2) `pickAggregate` shrinks to `assertRollupAggregation` in `aggregation.ts` (R4); the DAL uses a typed switch (R3). (3) targets filtered to `CALISTHENICS_METRIC_KEYS` (R2). (4) `Promise.all` the two reads (R5); `WEEK_LENGTH_DAYS` named (R8); `localWeekStartIso` claims the week seam (R6); calisthenics-only scope documented (R7). (5) extend the `calisthenics` screenshot state (R9); card-shell accepted with reason (R10). Still a small PR — the added coverage **replaces** duplication rather than adding it.

## Open questions — resolved by the panel

- **Aggregation-selector shape/home (was OQ1) — Resolved (R4).** No `pickAggregate` "SQL kernel twin";
  instead a drizzle-free `assertRollupAggregation(agg)→'sum'|'max'` guard co-located in
  `packages/shared/src/aggregation.ts`, and the _query itself_ is single-sourced in `packages/db`
  (`weeklyAdherenceRows`) — that's where drizzle belongs, and it's what makes the `db:verify` proof cover
  the DAL's real query. Token, not a Drizzle builder (keeps `shared` ORM-free).
- **Screenshot fixture placement (was OQ2) — Resolved: extend `calisthenics` (R9).** The `seedCalisthenics`
  state already seeds the exact bouts the ramp bars want as actuals; add the `ramp_targets` rows there for
  one richer combined capture, less code.

## Implementation note (small risk, not blocking)

`weeklyAdherenceRows(db, …)` must accept **both** the app's node-postgres drizzle db and the `db:verify`
PGlite db. Drizzle's query-builder API is driver-generic, so a permissively-typed `db` parameter (the
shared `MatPlanDb` type both `createDb` variants satisfy) works; if the two driver types don't unify
cleanly, fall back to a generic type param on the function. Verified pattern — `verify.ts` already builds
drizzle queries against PGlite using the same `packages/db` schema the app uses.
