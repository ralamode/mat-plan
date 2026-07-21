# V1-2 — seed the full catalog + coverage test

> Backlog: [plan.md](../plan.md) row V1-2. Branch: `db/v1-2-seed-catalogs`. Grounds in
> [spec.md](../spec.md) §4/§4a.

## Goal

Fill the V1-1a catalog tables with their real reference data — the full `activity_types`,
`metric_definitions`, and `movements` sets — and prove, in the PGlite harness, that the generalized
tagged-union model (spec.md §4a) actually covers every real activity with **zero bespoke per-activity
columns**. This is **reference-data only**: no `schema.ts` change and no migration. The catalog is the
single source in `packages/shared`; the seed and the coverage test both consume it, so app, DB, and
test can't drift.

## Acceptance

- **plan.md V1-2 criterion:** "Idempotent seed; test asserts every activity maps, no bespoke column."
- Done when: `db:generate` leaves a clean tree (no drift — reference data, no DDL); `db:seed`/`db:verify`
  seed the full catalog twice → identical counts (idempotent, `ON CONFLICT DO NOTHING` on each natural
  key); the coverage block asserts every `ACTIVITY_METRIC_MAP` key resolves, exactly one canonical
  `shot`, `pullup_max` aggregation=max, every movement `slug === movementSlug(name)`, every
  MOVEMENT_PATTERN covered, one round-tripped entry per `input_shape`, and no json/jsonb or
  per-activity column on `entries`; typecheck · lint · test · `next build` · `prettier --check` green.

## Real-data validation

The catalog is validated against **two real training days**, not one:

- **2026-07-20 (Strength A)** — the kids' S&C block (`sc_lift` → the Strength-A movements).
- **2026-07-21 (Conditioning)** — a real conditioning session, added as an 11th `conditioning`
  activity_type + the `sprint_reps` (alactic) and `aerobic_minutes` (Zone-2) metrics.

Ray's Push/Pull/Legs movements are now his **real program** (source: job-search-context
`docs/movement-templates.md`), not a placeholder slice. "Squats" and "Pull-ups/Chin-ups" reuse the
kids' `back_squat` / `pull-up` rows (deduped). The PPL set is still refinable later — new movements
are pure data (spec.md §4b), no deploy.

## File-by-file changes

| Path                                            | Change | What & why                                                                                                                                                   |
| ----------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/shared/src/catalog-seed.ts`           | EDIT   | Add `SEED_PUBLIC_ID_PREFIX` + `seedPublicId()` (single-source UUIDv7 namespace helper); the 3 existing constants now derive from it. No value change.        |
| `packages/shared/src/catalog-activity-types.ts` | NEW    | `ACTIVITY_TYPE_SEED_ROWS` (11) + `ACTIVITY_TYPE_KEYS` + zod row schema + type. Spreads V1-1b's `weigh_in`/`sc_lift` (one definition, fixed `…020`/`…021`).   |
| `packages/shared/src/catalog-metrics.ts`        | NEW    | `METRIC_DEFINITION_SEED_ROWS` (16) + `METRIC_KEYS` + zod + type. Spreads V1-1b's `bodyweight` (`…030`). Canonical `shot`; first-class `pullup_max` (max).    |
| `packages/shared/src/catalog-movements.ts`      | NEW    | `MOVEMENT_SEED_ROWS` (21 = 7 Strength-A + 14 PPL) + zod + type + `movementSlugMatchesName`. `slug === movementSlug(name)`; every MOVEMENT_PATTERN covered.   |
| `packages/shared/src/activity-metric-map.ts`    | NEW    | `ACTIVITY_METRIC_MAP` typed `Record<ActivityTypeKey, readonly MetricKey[]>` — a typo in either key set fails typecheck.                                      |
| `packages/shared/src/index.ts`                  | EDIT   | Barrel-export the 4 new modules.                                                                                                                             |
| `packages/db/src/seed.ts`                       | EDIT   | Seed the FULL arrays (activity_types, metric_definitions, movements) `ON CONFLICT (natural key) DO NOTHING`, after the FK parents (units, categories).       |
| `packages/db/scripts/verify.ts`                 | EDIT   | Count asserts → full lengths (11/16/21); add the V1-2 coverage block; extend the CHECK↔const parity to the movement pattern + metric value_type/aggregation. |
| `docs/plan.md` · `docs/status.md`               | EDIT   | Link this plan; status where-we-are + changelog row.                                                                                                         |

## Modeling choices (defaulted; refinable later)

- **`as const satisfies` the shared enums** on every catalog row — a bad category / shape / unit /
  pattern / value_type / aggregation fails **typecheck**, not just at runtime.
- **public_ids** follow the shared `019826b4-0000-7000-8000-0000000000XX` UUIDv7 seed namespace via
  the single `seedPublicId()` helper: activity types `020–02a`, metrics `030–03f`, movements `050–064`.
- **Reused rows are spread, never redefined** — V1-1b's 3 minimal rows keep one definition and their
  fixed public_ids; the full-catalog seed's `ON CONFLICT DO NOTHING` makes re-declaring them a no-op.
- **`brush_teeth` uses `footwork`** (not spec §4a's `ladder`) as the second checkin metric; **boolean/
  timing activities and `sc_lift` map to `[]`** in `ACTIVITY_METRIC_MAP` (they record a movement or a
  bare unit=bool/timing, not a metric — the at-most-one CHECK allows neither source column).

## Test plan

PGlite harness (`pnpm db:verify`, in CI's `quality` job) — no Docker. After migrating + seeding twice
it asserts: full-catalog counts (11/16/21), zod pre-flight parse of each array, reused rows keep fixed
public_ids, every `ACTIVITY_METRIC_MAP` activity + metric key resolves and the map covers every
activity, exactly one `shot`, `pullup_max`=max, slug↔name parity, every MOVEMENT_PATTERN covered, one
round-tripped entry per `input_shape` (set_list→movement_id, single_metric→metric_key+value_num,
boolean→neither+unit=bool, timing→neither+event_at) all satisfying the at-most-one CHECK, no
json/jsonb or per-activity column on `entries`, and the CHECK↔const parity for input_shape + movement
pattern + metric value_type/aggregation. Local: `pnpm db:verify`. CI re-runs it plus the drift guard.

## Risks / rollback

- **Seed non-idempotency** → mitigated: every insert is `ON CONFLICT (natural key) DO NOTHING`; the
  harness seeds twice and asserts identical counts.
- **Catalog ↔ CHECK drift** (a shared enum member the DB CHECK omits) → the extended parity asserts
  fail fast. **Reused-row public_id drift** → pinned by the fixed-public_id asserts.
- **Rollback:** reference data only — fix-forward by re-seeding (idempotent); nothing destructive.

## Out-of-scope / deferred

No `schema.ts` change, no migration, no DAL/UI change (V1-3+ consume the catalog). The remaining Ray
PPL refinements, program/prescription/ladder catalogs, and the Squawk + Neon-branch CI wiring stay
deferred.

## Open questions

None.
