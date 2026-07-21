# V1-4 — Bodyweight/measurement entries on the generalized model (read path)

> Backlog: [plan.md](../plan.md) row V1-4. Branch: `feat/v1-4-weigh-ins`.

> This plan was authored at Staff-SWE level and then **slimmed ~3×** by the adversarial panel
> (see the review-response log): the original spanned the write path, a shared `measurements.ts`
> descriptor registry, a `MeasurementForm`, and a hidden `metric` field. The reconciled scope is
> **read-path only** — the write path, forms, and descriptor registry are deferred to V1-5.

## Goal

The Today view already _persists_ a weigh-in on the generalized model (V1-1b dual-write: a bodyweight
log is a `weigh_in` activity carrying the `bodyweight` `metric_definition`, `metric_key` set /
`movement_id` NULL). But the **read** path still labels entries from the legacy `kind`/`movement_name`
discriminant. V1-4 generalizes the read: `listEntriesForDay` joins the metric definition, and a new
pure `entryLabel` dispatches on the **model discriminant** (`metricKey` → `valueType`), not a
per-kind ladder — so V1-5/V1-6 add new metric types by extending one `switch`, not editing the page.
Rendered output stays **byte-identical** (`Bodyweight — 72.5 lb`); the e2e smoke is untouched.

## Acceptance

- Backlog criterion (plan.md V1-4): _"Log a weigh-in via generalized entry."_ The weigh-in already
  writes generalized columns (V1-1b); this PR makes the **read/label** path consume them.
- Done when:
  - `listEntriesForDay` LEFT JOINs `metric_definitions` and returns nullable `metricKey` /
    `metricLabel` / `valueType` on `EntryDTO` (legacy `metric_key IS NULL` rows survive; UNIQUE key →
    no fan-out; row count + `desc(createdAt)` order unchanged).
  - A pure, route-agnostic `entryLabel(e)` (`lib/entries/entry-label.ts`) dispatches on the metric
    discriminant, with an explicit extensible `valueType` switch (only `number`/`count` implemented).
  - `page.tsx` imports `entryLabel` (inline copy removed); no visual change.
  - Vitest covers the label branches; a **required** contract test pins the seeded `bodyweight` label.
  - All gates green; e2e (`Bodyweight — 72.5 lb`) untouched and passing.

## File-by-file changes

| Path                                       | Change | What & why                                                                                                                                                                                                                              |
| ------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib/dal/entries.ts`              | EDIT   | `listEntriesForDay` only: LEFT JOIN `metric_definitions ON entries.metric_key = metric_definitions.key`; select `label`/`value_type`; extend `EntryDTO` with nullable `metricKey`/`metricLabel`/`valueType`. Write functions untouched. |
| `apps/web/lib/entries/entry-label.ts`      | NEW    | Pure, route-agnostic `entryLabel(e: EntryDTO)` — no `server-only` so history/CSV reuse it. Dispatches on the model discriminant.                                                                                                        |
| `apps/web/app/p/[profileId]/page.tsx`      | EDIT   | Remove inline `entryLabel`; import from `@/lib/entries/entry-label`. No other change.                                                                                                                                                   |
| `apps/web/lib/entries/entry-label.test.ts` | NEW    | Vitest (node): label branches (generalized bodyweight w/ + w/o value, legacy fallback, strength, null-movement) + the required seed-label contract test.                                                                                |
| `docs/plans/v1-4-weigh-ins.md`             | NEW    | This plan (with the review-response log).                                                                                                                                                                                               |
| `docs/plan.md`, `docs/status.md`           | EDIT   | Link the plan; backlog row + changelog + pointer.                                                                                                                                                                                       |

### `entryLabel` dispatch (the seam)

```
1. e.metricKey !== null  → generalized metric entry; switch (e.valueType):
     'number' | 'count' | default → value === null ? metricLabel! : `${metricLabel} — ${value} ${unit}`
     // EXTENSIBLE: V1-5 adds 'bool'/'scale_10'; V1-6 folds in aggregation. Not built yet.
2. e.movementName !== null → strength lift → movementName
3. legacy fallback (metric_key IS NULL): kind === 'bodyweight'
     ? (value === null ? 'Bodyweight' : `Bodyweight — ${value} ${unit}`)
     : 'Strength'
```

The em-dash is U+2014 (`—`), copied from the pre-change inline `entryLabel`, so output is byte-identical.

## Test plan

- **Unit (`entry-label.test.ts`, node):** a minimal-`EntryDTO` factory; one case per branch —
  generalized bodyweight (`72.5 lb` → `Bodyweight — 72.5 lb`; `null` → `Bodyweight`), legacy
  `metric_key IS NULL` bodyweight (`80 kg`), strength (`Back squat`), null-movement strength
  (`Strength`). The bodyweight fixture's `metricLabel` is **derived from the shared seed const**
  (`CATALOG_METRIC_DEFINITION_SEED_ROWS`) so a seed rename flips the test.
- **Contract (same file):** `expect(BODYWEIGHT_SEED.label).toBe('Bodyweight')` — pins the canonical
  label. Placed under `apps/web` so the required root `test` job (`pnpm --filter web`) runs it (a
  `packages/shared` test would not).
- **Unchanged:** the V0-8/V0-9 action + boundary tests and the e2e smoke (`Bodyweight — 72.5 lb`).
- **Local:** `pnpm typecheck && pnpm lint && pnpm test && pnpm format:check &&
pnpm --filter @mat-plan/db db:verify && pnpm build`.

## Risks / rollback

- **LEFT JOIN changes rows/order.** Mitigated: LEFT (not INNER) preserves `metric_key IS NULL` rows;
  `metric_definitions.key` is UNIQUE → at most one match → no fan-out; ORDER BY `desc(createdAt)` kept.
  STOP-and-report tripwire if row count/order shifts.
- **e2e string invariant.** The label output is byte-identical (same em-dash, same template); the
  generalized bodyweight branch produces exactly what the old bodyweight branch did.
- **Rollback:** pure additive read change — revert the PR; no migration, no data change.

## Out-of-scope / deferred

- The **write path / forms / actions** — untouched (`bodyweight-form.tsx`, `actions.ts`,
  `logBodyweight`, `logBodyweightSchema`). Generalizing the write (a `MeasurementForm`, a shared
  measurement-descriptor registry, a hidden `metric` field) is **V1-5**.
- `bool` / `scale_10` / `duration` rendering and `aggregation`-driven totals — V1-5 / V1-6.

## Open questions

None (resolved in the panel).

## Review-response log (adversarial panel)

| #   | Reviewer / lens              | Critique                                                                                                              | Resolution                                                                                                                      |
| --- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Simplicity & scope           | Over-scoped: the draft touched the write path, forms, and actions in one PR (>400 lines, multi-concern).              | **Accepted** — cut to **read path only**. Write/form generalization moved to V1-5. Write files explicitly left unchanged.       |
| 2   | Architecture & consistency   | Labeling via a `metricLabel`/`kind` string ladder would fight the model and re-branch every new metric.               | **Accepted** — dispatch on the **`value_type`** discriminant via an extensible `switch`, not an if/kind ladder.                 |
| 3   | Simplicity & scope           | A shared `measurements.ts` descriptor registry, `MeasurementForm`, and hidden `metric` field were premature.          | **Accepted** — **deferred to V1-5**; no descriptor registry / form / hidden field created in V1-4.                              |
| 4   | Correctness & data integrity | Nothing guards the seeded `bodyweight` label the read path now depends on; a silent rename would break rendering.     | **Accepted** — added a **required** seed-label contract test under `apps/web` (runs in the root `test` job).                    |
| 5   | Architecture & consistency   | Draft proposed UI-copy + a duplicated enum living in `packages/shared`.                                               | **Moot / dropped** — that surface was cut with the write path (#1/#3); no copy or dup-enum added to shared.                     |
| 6   | Architecture & consistency   | `entryLabel` colocated in the route (`app/…/page.tsx`) can't be reused by history/CSV without importing a route file. | **Accepted** — extracted to `lib/entries/entry-label.ts`, pure and **route-agnostic** (no `server-only`), type-only DTO import. |
