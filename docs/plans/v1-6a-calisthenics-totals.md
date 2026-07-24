# V1-6a — calisthenics inputs + daily totals

> Backlog: [plan.md](../plan.md) row V1-6 (split → V1-6a / V1-6b). Branch: `feat/v1-6a-calisthenics-totals`.

> **Scope decision up front (read this first).** V1-6 as written bundles three concerns:
> (a) render + log the four `calisthenics` metrics, (b) **daily totals** via `aggregation`
> rollups (sum / max), (c) **weekly ramp targets + adherence**. (c) requires a **new table +
> migration** (spec §4: "modeled as **target rows** so adherence is computable in SQL") — there
> is no table today that holds per-profile, per-week targets. Dragging DDL + Squawk + the
> Neon-branch gate into a UI feature is exactly the anti-pattern V1-5 called out. So V1-6 is
> **split at a clean seam**, matching the V1-1 a/b/c/d precedent and the AGENTS.md <400-line /
> one-concern target:
>
> - **V1-6a (THIS plan):** calisthenics inputs + daily totals. **No migration.** Reuses the
>   V1-5 kind-NULL `count` write path wholesale. Satisfies the first half of the criterion,
>   "Log push/pull/v-sit totals."
> - **V1-6b (own plan, `v1-6b-calisthenics-ramp.md`, written next):** the ramp-target table +
>   migration + seed + SQL adherence + UI. A **significant migration PR** — full DB-safety panel.
>   Satisfies "adherence computed." Sketched in [V1-6b preview](#v1-6b-preview-not-this-pr).
>
> `docs/plan.md` splits row V1-6 → V1-6a / V1-6b, both linking here / there.

> **Product decision — ACCUMULATE, confirmed by ground truth (2026-07-23).** The kids currently
> track calisthenics on a **physical paper tally**, adding sets+reps **each time they do the
> exercise**. So the day is a sum of many bouts, not one number. The adversarial panel's simplicity
> lens argued to strip this PR to **log-once** (enter one daily total, field goes inert like a V1-5
> habit); that is **rejected** — log-once would regress their real workflow into end-of-day mental
> math. V1-6a keeps the **accumulate** model (each submit = one bout; the "today" card sums them =
> the digital tally sheet), and the panel's job became "build accumulate _correctly_": the two real
> defects it found in the accumulate machinery (an input-loss race, a double-counting e2e retry) are
> **fixed** here, not used as a reason to cut the feature. Scoped to **calisthenics only** — V1-5's
> shipped `shot` is left exactly as-is (see review-response #2). Per-set _structure_ (3×10 vs a rep
> total) is **V1-8** (the `entry_set` model); V1-6a captures the accumulated **rep total**, which is
> the number ramp/adherence (V1-6b) needs.

## Goal

The check-ins form can log the four seeded `calisthenics` metrics (`pushups`, `pullups`,
`vsit_crunch`, `vsit_skill_step`), and the Today page shows the **day's total per metric** rolled
up by each metric's `aggregation` (sum for the three counters, **max** for the skill step). This is
the first feature to make `metric_definition.aggregation` do observable work, and it does so with
**no new write path and no migration**: `calisthenics` metrics are `value_type: count` / `unit:
count`, byte-identical in shape to the `shot` field V1-5 already renders and logs, so V1-6a is a
**render-scope extension of the V1-5 registry** plus one pure rollup helper. Ramp targets and
adherence — which genuinely need a new table — are deliberately deferred to V1-6b.

## Acceptance

- **Backlog criterion (plan.md V1-6), verbatim:** _"Log push/pull/v-sit totals; adherence computed"_
  - **V1-6a delivers:** _"Log push/pull/v-sit totals."_ (The "adherence computed" half is V1-6b.)
- Done when:
  - `/p/[profileId]` renders a **Calisthenics** fieldset inside the existing Check-ins form,
    **derived from seed data** (`ACTIVITY_METRIC_MAP.calisthenics`): four numeric inputs
    (Push-ups, Pull-ups, V-sit crunches, V-sit skill step). **No metric key appears in JSX.**
  - Submitting writes one `entries` row per filled field via the **existing** `logCheckinEntries`:
    `kind = NULL`, `activity_type_id` = calisthenics, `metric_key` set, `unit` = `count` **resolved
    from the DB catalog row**, `value_num` = the entered count, `status = 'done'`, client UUIDv7.
  - Because `sum`/`max` metrics **accumulate**, a calisthenics field stays **editable after logging**
    (unlike a V1-5 `last`/habit field, which goes inert) — a second submit adds a second reading.
    The entered number is **cleared on a successful submit** so the prior value is never silently
    re-sent.
  - A **Calisthenics today** summary renders the per-metric rollup from the day's already-fetched
    entries: `sum(value_num)` for the counters, `max(value_num)` for `vsit_skill_step`, labelled and
    ordered from the seed catalog, shown only for metrics with ≥1 reading today.
  - Today's entry list labels each reading from the model discriminant (`count` branch), e.g.
    `Push-ups — 20` (the placeholder `count` unit is dropped from the label — see
    [entry-label polish](#entry-label-count-unit-polish)).
  - Mandatory boundary tests ship in this PR (calisthenics happy path; out-of-range / overflow /
    negative / `'abc'` → zod-reject with no DAL call; unknown POST key ignored) — riding the V1-5
    action harness.
  - All gates green (typecheck · lint · prettier · vitest · `db:verify` · `next build` · e2e).

## Migration: **NOT needed (V1-6a)**

No `schema.ts` change, no migration file. Everything V1-6a writes already exists and is constrained:
`entries.kind` NULLABLE (0003/V1-1c), `activity_type_id` NOT NULL CHECK (0003), `metric_key` FK +
`entries_value_source_check` at-most-one (0002), `value_num numeric(8,3)` (0000), `units` FK incl.
`count` (0000+seed), `metric_definitions_aggregation_check` covering `sum|last|max|avg` (0000),
`uq_entries_client_id` partial UNIQUE (0000). The four `calisthenics` metric rows and the
`calisthenics` activity row are **already seeded** (V1-2; `catalog-metrics.ts`,
`catalog-activity-types.ts`) with the correct `aggregation` values — V1-6a adds **no seed
rows** either. Opening DDL here would drag Squawk + the Neon-branch gate into a read/UI PR for zero
benefit. **V1-6b needs a migration; V1-6a does not.** (Justification for V1-6b's table:
[preview](#v1-6b-preview-not-this-pr).)

## What is reused vs. what changes (design Q4)

**Reused unchanged** — proven by V1-5's `shot` field, which is `value_type: count` / `unit: count`,
`aggregation: sum`, structurally identical to every calisthenics metric:

- `valueSchemaFor` `count` branch (`actions.ts`) — `z.coerce.number().int().min(0).max(VALUE_NUM_MAX)`.
- `logCheckinsAction`'s registry walk, per-field error accumulation, day bounding, per-item results.
- `logCheckinEntries` (`entries.ts`) — resolves `unit` from the DB catalog row, ON CONFLICT,
  per-item `created` flags. **No DAL change.**
- `getMetricDefinition` / `getActivityTypeByKey` (`catalog.ts`). **No change.**
- The number-input control in `checkin-form.tsx`. `entries_shape_check` compliance: calisthenics
  writes a real `value_num` (the count) and never `movement_name` — the same safe subset V1-5 pins.

**Changes** (all additive, ~one concern each): the registry render allow-list (+calisthenics, +an
`aggregation` field + `isAccumulating`), a new pure rollup helper, the page (totals block +
exclude accumulating fields from the inert set), the form (clear number inputs on success), a small
`entry-label` `count`-unit polish, and tests.

## File-by-file changes

| Path                                               | Change           | What & why                                                                                                                                                                                                                                                             |
| -------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/metrics.ts`                   | EDIT (~1 line)   | Export `METRIC_AGGREGATION = keyBySelf(METRIC_AGGREGATIONS)` (mirrors `METRIC_VALUE_TYPE`) so app code branches on `METRIC_AGGREGATION.sum`, not a bare string (constants rule). The only `packages/shared` touch.                                                     |
| `apps/web/lib/checkins/checkin-fields.ts`          | EDIT             | Append `ACTIVITY_METRIC_MAP.calisthenics` to `CHECKIN_FIELDS`; add `aggregation` to `CheckinField`; add `isAccumulating(f)`; rewrite the "only brush_teeth is rendered" scope comment (now brush_teeth **+ calisthenics**).                                            |
| `apps/web/lib/checkins/checkin-fields.test.ts`     | EDIT             | Assert the 4 calisthenics fields derive from the seed (count inputs, `aggregation` = sum×3/max×1, min 0/max `VALUE_NUM_MAX`); `isAccumulating` true for sum/max, false for last/habit.                                                                                 |
| `apps/web/lib/entries/activity-totals.ts`          | NEW (~45 lines)  | Pure `rollupMetricTotals(entries, activityKey)` folding by each metric's `aggregation`. No `server-only`; type-only `EntryDTO` import (mirrors `entry-label.ts`). Aggregation sourced from `METRIC_DEFINITION_SEED_ROWS`.                                              |
| `apps/web/lib/entries/activity-totals.test.ts`     | NEW (~55 lines)  | sum folds N readings; max picks the best; last takes most-recent (desc order); avg; empty → `[]`; null values skipped; only metrics with ≥1 reading returned; catalog order preserved.                                                                                 |
| `apps/web/lib/entries/entry-label.ts`              | EDIT (~4 lines)  | `count`/`number` branch: when `unit === 'count'`, omit the placeholder unit → `Push-ups — 20`. Also cleans the just-shipped `Shot — 5 count`. Severable; see note.                                                                                                     |
| `apps/web/lib/entries/entry-label.test.ts`         | EDIT             | Add `count` cases (`Push-ups — 20`, `Shot — 5`).                                                                                                                                                                                                                       |
| `apps/web/app/p/[profileId]/checkin-form.tsx`      | EDIT (~20 lines) | Make **non-logged number inputs controlled** with a `values` state map, cleared on a successful submit (same "adjust-state-during-render" reset that already clears `checked`). Prevents an accumulating field silently re-sending its prior value on the next submit. |
| `apps/web/app/p/[profileId]/page.tsx`              | EDIT (~22 lines) | Exclude `isAccumulating` fields from `loggedFieldKeys` (so calisthenics/shot stay editable); render a `<section>` summary "Calisthenics today" from `rollupMetricTotals(entries, 'calisthenics')`, only if non-empty.                                                  |
| `apps/web/app/p/[profileId]/actions.test.ts`       | EDIT             | Calisthenics happy path (2–3 filled counters → `logCheckinEntries` with those items, each `clientId` threaded); boundary: `-1` / `100000.5` (overflow) / `'abc'` → per-field reject, no DAL call; blank ignored.                                                       |
| `apps/web/e2e/steps.ts` · `log-bodyweight.spec.ts` | EDIT (~10 lines) | Extend the warm smoke: type a pushups count, submit, assert the reading **and** the "Calisthenics today" total render (scoped to their regions). Keep the V1-5 inert assertion on a **`last`** field (`Pressure`) — unaffected.                                        |
| `packages/db/scripts/verify.ts`                    | **no change**    | The kind-NULL `count` metric round-trip is already pinned by V1-5 (`stance`); calisthenics reuses that exact shape. No new DB fact → no new assertion. (Stated so a reviewer doesn't expect one.)                                                                      |
| `docs/architecture.md`                             | **no change**    | The write path (batch multi-row, kind-NULL) is unchanged from V1-5's §2c diagram; V1-6a adds a read-side rollup only. No pivotal-flow change → no diagram.                                                                                                             |
| `docs/plan.md` · `docs/status.md`                  | EDIT             | Split row V1-6 → V1-6a (this) / V1-6b (ramp); link this plan; backlog pointer + changelog.                                                                                                                                                                             |
| `docs/plans/v1-6a-calisthenics-totals.md`          | NEW              | This plan.                                                                                                                                                                                                                                                             |

**Deliberately NOT in V1-6a** (→ V1-6b): any `schema.ts` / migration / seed change; a `ramp_target`
table; SQL adherence; adherence UI; the `packages/engine`.

---

### `apps/web/lib/checkins/checkin-fields.ts`

Add `aggregation` to the descriptor (sourced from the same `METRIC_BY_KEY` map `metricField`
already uses), append the calisthenics source, and expose the accumulate predicate:

```ts
export type CheckinField = {
  // …existing fields…
  /** How repeated same-day readings roll up. `null` for a bare habit. Drives the
   *  "stays editable / accumulates" behavior and the totals rollup. */
  aggregation: MetricAggregation | null;
};

// metricField(): add `aggregation: metric.aggregation` to the returned object.
// habitField():  add `aggregation: null`.

export const CHECKIN_FIELDS: readonly CheckinField[] = [
  ...ACTIVITY_TYPE_SEED_ROWS.filter((a) => a.inputShape === ACTIVITY_INPUT_SHAPE.boolean).map(
    habitField,
  ),
  ...ACTIVITY_METRIC_MAP[ACTIVITY_TYPE_KEYS.brush_teeth].map((m) =>
    metricField(ACTIVITY_TYPE_KEYS.brush_teeth, m),
  ),
  // V1-6a: calisthenics — 4 `count` metrics, same render path as brush_teeth's `shot`.
  ...ACTIVITY_METRIC_MAP[ACTIVITY_TYPE_KEYS.calisthenics].map((m) =>
    metricField(ACTIVITY_TYPE_KEYS.calisthenics, m),
  ),
];

/** A field whose repeated readings accumulate (sum) or take a running best (max):
 *  it must stay editable after logging so a second reading can be added, and it is
 *  excluded from the page's already-logged (inert) set. `last`/habit fields stay log-once. */
export function isAccumulating(f: CheckinField): boolean {
  return f.aggregation === METRIC_AGGREGATION.sum || f.aggregation === METRIC_AGGREGATION.max;
}
```

`metricField` already sets `{ min: 0, max: VALUE_NUM_MAX }` for `count`, so calisthenics inputs
inherit the correct bounds with no extra code. Rendered order stays catalog-seed order (stable DOM
for e2e/screenshots).

### `apps/web/lib/entries/activity-totals.ts` (NEW)

Pure, route-agnostic, like `entry-label.ts`. `aggregation` is **static catalog data** compiled into
`@mat-plan/shared` — so it is looked up here rather than widening `EntryDTO`/adding a DB column.

```ts
import {
  METRIC_AGGREGATION,
  METRIC_DEFINITION_SEED_ROWS,
  type MetricAggregation,
} from '@mat-plan/shared';
import type { EntryDTO } from '@/lib/dal/entries';

export type MetricTotal = {
  metricKey: string;
  label: string;
  unit: string;
  aggregation: MetricAggregation;
  total: number;
  readings: number; // fold count → UI can say "best of 3" / hide when 0
};

/**
 * Per-metric daily rollup for one activity, folded by each metric's `aggregation`.
 * `entries` are ordered desc(createdAt) by the DAL, so `last` = the first match.
 * Pure + in-memory: it rolls up the day's rows the page already fetched — no query,
 * no engine. (Weekly SQL adherence is V1-6b, where fetching a week into memory is wrong.)
 */
export function rollupMetricTotals(
  entries: readonly EntryDTO[],
  activityKey: string,
): MetricTotal[] {
  const groups = new Map<string, EntryDTO[]>();
  for (const e of entries) {
    if (e.activityKey !== activityKey || e.metricKey === null || e.value === null) continue;
    const list = groups.get(e.metricKey) ?? [];
    list.push(e);
    groups.set(e.metricKey, list);
  }
  const out: MetricTotal[] = [];
  for (const m of METRIC_DEFINITION_SEED_ROWS) {
    // catalog order → stable render
    const rows = groups.get(m.key);
    if (!rows?.length) continue;
    const vals = rows.map((r) => r.value as number);
    const total =
      m.aggregation === METRIC_AGGREGATION.sum
        ? vals.reduce((a, b) => a + b, 0)
        : m.aggregation === METRIC_AGGREGATION.max
          ? Math.max(...vals)
          : m.aggregation === METRIC_AGGREGATION.avg
            ? vals.reduce((a, b) => a + b, 0) / vals.length
            : vals[0]; // 'last' — rows are desc(createdAt)
    out.push({
      metricKey: m.key,
      label: rows[0].metricLabel ?? m.label,
      unit: rows[0].unit,
      aggregation: m.aggregation,
      total,
      readings: rows.length,
    });
  }
  return out;
}
```

`EntryDTO` already carries `activityKey`, `metricKey`, `metricLabel`, `unit`, `value` (V1-4/V1-5) —
no DTO change. The DAL's `desc(createdAt)` ordering is the load-bearing invariant for `last`; a test
pins it, and it also closes the V1-5 note ("`aggregation: 'last'` is only well-defined if it folds
over `desc(created_at)`").

### `apps/web/app/p/[profileId]/page.tsx`

```ts
// Only NON-accumulating fields go inert once logged; sum/max fields stay editable so
// a second reading can be added. Keyed on the field registry (already imported).
const accumulatingKeys = new Set(CHECKIN_FIELDS.filter(isAccumulating).map((f) => f.key));
const loggedFieldKeys = entries
  .filter((e) => e.activityKey !== null)
  .map((e) => (e.metricKey === null ? e.activityKey! : `${e.activityKey}:${e.metricKey}`))
  .filter((k) => !accumulatingKeys.has(k));

const calisthenicsTotals = rollupMetricTotals(entries, ACTIVITY_TYPE_KEYS.calisthenics);
```

Render (only when non-empty), a landmark `<section aria-labelledby>` with `<h2>` + a `<ul>`:
`Push-ups — 50 · Pull-ups — 12 · V-sit crunches — 30 · V-sit skill step — 4 (best)`. The
`(best)` qualifier appears only for `max`; `sum` shows the plain total. Placed above the entries
list so the aggregate reads before the individual readings.

### `apps/web/app/p/[profileId]/checkin-form.tsx`

Non-logged number inputs become **controlled** via a `numberValues: Record<string,string>` state,
cleared on a successful submit alongside the existing `setChecked({})` in the
adjust-state-during-render block. Without this, an accumulating input keeps its typed value after
submit and the next submit silently re-logs it under a fresh `client_id` (a double-count footgun
unique to accumulating fields — V1-5's `last`/habit inputs went `readOnly`, so they never hit this).
`logged` (inert) fields keep the existing `readOnly` presentation; accumulating fields are never in
`loggedFieldKeys`, so they render editable.

### entry-label count-unit polish

`count`/`number` branch becomes: `unit === 'count' ? `${label} — ${value}`:`${label} — ${value} ${unit}``.
Rationale: `count` is a storage placeholder, not a display unit — `Push-ups — 20 count` reads
badly. **Severable:** this also changes V1-5's just-shipped `Shot — 5 count` → `Shot — 5`; its test
and the screenshots update. Included because it lands with the first metrics that make the count
branch prominent. If the panel prefers zero churn on a V1-5 label, it can be dropped without
affecting the rest of V1-6a.

## Test plan

All Vitest under `apps/web` (required `pnpm --filter web test`); e2e in the `e2e` job.

- **Unit — `checkin-fields.test.ts`.** `CHECKIN_FIELDS` now includes exactly
  `ACTIVITY_METRIC_MAP.calisthenics.length` calisthenics fields, each `valueType: 'count'`,
  `groupLabel: 'Calisthenics'`, `{min:0, max: VALUE_NUM_MAX}`, `aggregation` matching the seed
  (`sum` ×3, `max` for `vsit_skill_step`) — asserted against the seed arrays, no synthetic fixture.
  `isAccumulating`: true for the counters + skill step + `shot`, false for `stance`/`pressure`/habits.
- **Unit — `activity-totals.test.ts`.** sum folds `[20,30]→50`; max `[3,5,4]→5`; last takes index 0
  of a desc list; avg; `[]→[]`; `value:null` rows skipped; a non-calisthenics activity is ignored;
  output order equals catalog order; `readings` counts folds.
- **Unit — `entry-label.test.ts`.** `Push-ups — 20`, `Shot — 5` (count unit dropped); an unchanged
  metric-carrying `Bodyweight — 72.5 lb`; scale_10 `Pressure — 7/10`.
- **Integration — `actions.test.ts`** (DAL + `next/cache` mocked, real `FormData`). Calisthenics
  happy path → one `logCheckinEntries` call with the filled counters, `value` numeric, each
  `clientId` threaded, `revalidatePath`. Boundary: `-1` / `100000.5` / `'abc'` → `fieldErrors[key]`,
  `logCheckinEntries` never called; blank field ignored; unknown `v:evil` inert. (Rides the V1-5
  harness — no new mocks.)
- **DB — `pnpm db:verify`.** Unchanged; the kind-NULL count round-trip is already pinned (V1-5).
- **E2E** — ~10 lines on the warm smoke: type a pushups value in the `Check-ins` region, submit,
  synchronize on the submit button leaving its `Logging…` label (lessons.md), then assert (a) the
  `Push-ups — N` reading in the **Logged entries** region and (b) the total in the **Calisthenics
  today** region. Locators `exact: true`, region-scoped (lessons.md: form/list share vocabulary).
  Retry-safe: guard the fill with `isEditable()` (a retry reuses the ephemeral DB).
- **Screenshots** (AGENTS.md UI rule): empty, filled, and post-log-with-total states — in the PR
  description. (Captured via the new ephemeral-DB screenshot flow if landed, else a Neon branch.)
- **Local:** `pnpm typecheck && pnpm lint && pnpm test && pnpm format:check && pnpm --filter @mat-plan/db db:verify && pnpm build`.

## UI notes (a11y)

- The Calisthenics fieldset inherits the V1-5 form's `<fieldset>/<legend>`, `<label htmlFor>`,
  ≥44px padded rows, `inputMode="numeric"`, `focus-visible` ring on the row.
- Totals render as a labelled `<section>` + `<h2 id>` + `<ul>/<li>`, `tabular-nums`, `text-sm`.
- Accumulating inputs are **editable** (not `readOnly`), so no `aria-disabled` on them; the totals
  block + `aria-live="polite"` "Check-ins logged." give the "it landed" feedback in place of the
  V1-5 inert state.

## Risks / rollback

| Risk                                                                                  | Mitigation                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accumulating fields double-count on an accidental double submit                       | Number inputs are **cleared on success**; per-submit `client_id` rotation means a same-render double-tap is one ON-CONFLICT no-op. Cross-submit accumulation is the intended feature. Edit/undo is V1-9.              |
| Changing `shot`/calisthenics from log-once → accumulate alters V1-5's just-shipped UX | Principled, aggregation-driven (not a calisthenics special-case): `shot` **is** a `sum` metric, so log-once was the V1-5 inconsistency. Documented; V1-5 e2e's inert assertion is on `Pressure` (`last`), unaffected. |
| `last`/`max` rollup depends on `desc(createdAt)` ordering                             | The DAL already orders `desc(createdAt)`; a unit test pins the fold and the invariant is documented in the helper.                                                                                                    |
| `count`-unit label change ripples to `Shot` + screenshots                             | Test + screenshots updated in the same PR; the change is severable if the panel objects.                                                                                                                              |
| Numeric overflow (`value_num numeric(8,3)`)                                           | Reused `count` schema clamps to `VALUE_NUM_MAX`; boundary test at the limit. (Same guard as V1-5.)                                                                                                                    |
| Inherited gaps: no authN/authZ household scoping, no rate limiting, no Sentry wrap    | Pre-existing since V1-3/V0-8, **not worsened** (same action, same DAL). Close at v1.5 (Clerk) / V1-14 (rate limit + Sentry). Stated, not papered over.                                                                |

**Rollback:** revert the PR. No migration, no DDL, no data transform.

## Out-of-scope / deferred

- **V1-6b** — the ramp-target table + migration + seed + SQL adherence + adherence UI. See preview.
- **V1-7** — `timing` activities (`wake`, `wrestling_practice`): still not a one-line registry seam
  (`wake` has an empty `ACTIVITY_METRIC_MAP` entry; `wrestling_practice` needs `event_at` + a
  non-numeric shape). Unchanged by V1-6a.
- **V1-8** — sessions/supersets; calisthenics check-ins write `session_id = NULL` (spec §4 allows).
- **V1-9** — edit/uncheck/undo + LWW + the natural-key UNIQUE. **V1-6a raises the stakes:** with
  accumulating fields, a mis-entered count is uneditable in-app until V1-9, and V1-9's dedupe
  pre-check must account for **intentional** duplicate calisthenics rows (they are not dupes to
  collapse — the natural key must include a per-reading discriminator, or exclude accumulating
  metrics). Documented debt, inherited from V1-5.
- **V1-13** — CSV export "pivot 4→1" for calisthenics (spec §4a) consumes exactly the sum/max rollup
  V1-6a builds; V1-13 should reuse `rollupMetricTotals` rather than re-deriving it.
- No `packages/engine` (a display sum is not progression math), no Clerk, no offline, no i18n.

### V1-6b preview (NOT this PR)

Documented so the seam is visible and the reviewer can confirm V1-6a doesn't paint it into a corner.

- **New table `ramp_target`** (or reuse the spec's `goal` name): `(id bigint identity PK, public_id
uuid, profile_id FK, metric_key FK → metric_definitions, week_start date, target_value
numeric(8,3), …timestamps)`, UNIQUE `(profile_id, metric_key, week_start) WHERE deleted_at IS
NULL`, covering indexes on each FK. This is what spec §4's "modeled as **target rows** so adherence
  is computable in SQL" names — no existing table holds per-profile/per-week targets.
- **Migration:** expand-only `CREATE TABLE IF NOT EXISTS` + FKs as `NOT VALID → VALIDATE` + indexes
  `CONCURRENTLY` (isolated file per the AGENTS.md transaction gotcha) + `SET lock_timeout`. Squawk-
  clean (no destructive op). One migration/PR. Seed the weekly ramp schedule idempotently.
- **Adherence (SQL, not in-memory):** per ISO week, `SUM(value_num)` (sum metrics) / `MAX` (max
  metric) of actual `entries` vs `ramp_target.target_value`, in a DAL read (a Route Handler if it
  grows batch/period params). A week of rows should stay in SQL, not be pulled into memory — the
  deliberate contrast with V1-6a's daily in-memory rollup.
- **Significant PR:** full adversarial panel **+ a dedicated DB-safety reviewer** (per plans/README).

## Open questions

1. **`count` unit label polish** — ship in V1-6a (cleans `Shot` too) or leave `Shot — 5 count`
   untouched? (Recommendation: ship; it's ~4 lines and the count branch first becomes prominent
   here. Severable.)
2. **Totals placement** — a dedicated "Calisthenics today" section vs. an inline summary under the
   fieldset. (Recommendation: dedicated section above the entries list; strongest a11y landmark.)
3. **V1-6b table name** — `goal` (spec's word, broader) vs. a purpose-named `ramp_target`. Decide in
   the V1-6b plan, not here.

## Review-response log (adversarial panel)

Per critique: reviewer/lens → **accepted** (what changed) or **rejected** (why). Blocking concerns
must be resolved before implementation.

Three lenses (correctness · simplicity · architecture), single pass — scaled to V1-6a's risk (no
migration, reuses V1-5's write path). The **accumulate vs log-once** fork was resolved by product
ground truth (paper tally → accumulate), so the simplicity lens's central proposal is rejected while
its and the others' concrete defect-findings are incorporated.

| #   | Lens                                     | Critique                                                                                                                                                                                                                                                      | Resolution                                                                                                                                                                                                                                                                                             |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Simplicity (BLOCKING)                    | Cut the accumulate model entirely — it's scope the criterion doesn't demand and it invents the double-count risk it then mitigates.                                                                                                                           | **Rejected (product ground truth).** The kids accumulate a paper tally each set; log-once would regress that into end-of-day mental math. Accumulate stays. Its findings on _how_ accumulate was built (below) are accepted.                                                                           |
| 2   | Correctness; Architecture                | Flipping V1-5's shipped `shot` (a `sum` metric) to accumulate, with no `shot` total rendered, makes it accumulate invisibly — incoherent.                                                                                                                     | **Accepted.** V1-6a scopes accumulate + totals to **calisthenics only**; `shot` is left exactly as V1-5 shipped it. `shot` genuinely wants accumulation too (10K-shots goal) but that rides with the `shots`/goal work.                                                                                |
| 3   | Correctness (MAJOR-2)                    | Clear-on-success clobbers a value typed during the (slow) pending window → silent input loss on the fields designed for repeated entry.                                                                                                                       | **Accepted.** The accumulating number input is **disabled while `pending`** (matching the submit button), so nothing can be typed into the race window; it clears on success, then re-enables empty for the next bout.                                                                                 |
| 4   | Correctness (MAJOR-1)                    | The e2e's `isEditable()` retry guard is a no-op for accumulating fields (they never go inert) → a Playwright retry re-submits and double-counts, and the exact-text locator matches 2 rows.                                                                   | **Accepted.** The calisthenics e2e asserts **end state without re-filling** (guards on the total already being present), so a retry on the reused ephemeral DB neither re-submits nor trips strict-mode.                                                                                               |
| 5   | Correctness (MAJOR-3)                    | "Make non-logged number inputs controlled" invites a controlled↔uncontrolled flip on `pressure`/`reaction` (which do go inert) → React warns + the field blanks post-log.                                                                                     | **Accepted.** Controlled `value` is applied to the **calisthenics** inputs only (always controlled); V1-5's `scale_10` inputs are untouched, so no controlled/uncontrolled transition is introduced.                                                                                                   |
| 6   | Architecture (M3)                        | The sum/max fold is domain math that V1-6b (SQL adherence) and V1-13 (CSV pivot) will re-derive; leaving it app-local means every consumer re-implements it with no shared contract.                                                                          | **Accepted.** Extract a pure `foldAggregation(aggregation, values[])` into **`packages/shared`** with **golden-vector tests** (covers sum/max/last/avg). That is the artifact the SQL paths + a future Python/MCP port pin against. The app rollup calls it.                                           |
| 7   | Architecture (M4)                        | Sourcing `aggregation` from `METRIC_DEFINITION_SEED_ROWS` inside the pure helper re-introduces a catalog dependency the DTO pattern avoids, diverging from `entry-label`'s DTO dispatch.                                                                      | **Accepted.** Add `aggregation` to the existing `metric_definitions` LEFT JOIN + to `EntryDTO`; the rollup becomes a pure DTO fold with no `@mat-plan/shared` catalog import, matching `entry-label.ts`.                                                                                               |
| 8   | Architecture (M1)                        | `isAccumulating` (sum\|max) and the rollup (folds avg too) disagree — a latent shared-const drift born in one PR.                                                                                                                                             | **Accepted.** One axis: `foldAggregation` is the single fold; the "stays editable" behavior is scoped to the **calisthenics activity** in V1-6a (not a blanket sum/max predicate), so there is no second, drifting classifier.                                                                         |
| 9   | Simplicity (M1); Architecture (m6)       | `rollupMetricTotals`'s generic `activityKey` param + `avg`/`last` branches are speculative — no V1-6a caller exercises them; `last` also silently depends on DAL sort order.                                                                                  | **Partially accepted.** The _app_ rollup is calisthenics-focused (order from `ACTIVITY_METRIC_MAP.calisthenics`, m7). The general fold lives in the shared `foldAggregation` kernel (justified by #6, not "a future caller") with `last` ordering an explicit precondition documented + golden-tested. |
| 10  | Simplicity (M2)                          | The `entry-label` `count`-unit polish (`Shot — 5 count` → `Shot — 5`) is out-of-scope churn on a just-shipped V1-5 label + its screenshots.                                                                                                                   | **Accepted (deferred).** Not in V1-6a. Calisthenics readings render `Push-ups — 20 count` in the entries list for now (the totals _card_ omits the placeholder unit — I control it fully). The label polish is its own trivial PR.                                                                     |
| 11  | Simplicity (m1)                          | `readings` count + "(best of N)" qualifier are unrequested polish.                                                                                                                                                                                            | **Rejected for `readings`; accepted for the qualifier.** The paper tracks **sets** — `readings` = bouts logged today is now meaningful (a set count), so it stays. The "(best of N)" prose qualifier is dropped; `max` just shows the value.                                                           |
| 12  | Architecture (m5)                        | The plan mis-cites the V1-1 precedent (V1-1 kept ONE plan file for a/b/c/d) and uses a filename matching no backlog id until `plan.md` is split.                                                                                                              | **Accepted.** Deviation stated plainly: V1-6a/V1-6b are **separate PRs with separate plans** (unlike V1-1's single-plan phases) because 6b is a significant migration PR warranting its own DB-safety panel. `plan.md` splits the row in this PR.                                                      |
| 13  | Correctness (MINOR-4); Architecture (m9) | Totals sum every non-deleted reading regardless of `status`; once V1-9 adds `skipped`, a skipped reading would be summed. And shipping intentional duplicate rows pre-V1-9 boxes its dedupe design.                                                           | **Accepted (documented debt).** V1-6a writes only `status='done'`, so no divergence today; the rollup will filter `status='done'` defensively. The V1-9 backlog row gets an explicit note that accumulating metrics are append-only (no natural-key collapse).                                         |
| 14  | Correctness                              | Verified sound with no fix needed: the write path, idempotency, bounds, the shared-`shot`-across-activities case (filtered by `activityKey` before keying), within-render double-submit (button `disabled={pending}` + same `client_id` → ON CONFLICT no-op). | **No change** — recorded so the reviewer knows these were checked and cleared.                                                                                                                                                                                                                         |
