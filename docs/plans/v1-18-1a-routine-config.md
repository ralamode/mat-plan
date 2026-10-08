# V1-18 PR 1a — routine config (data + seed) — plan & panel log

> The **data half** of V1-18 slice 1 (per-kid routine builder). Migration + shared contract + DAL + seed
>
> - `db:verify` — **zero `page.tsx`**, so it has no dependency on the render half (PR 1b) and lands in
>   parallel. Grounding: [ux-decision](./v1-18-ux-decision.md) · [eng-plan](./v1-18-eng-plan.md). Base: `main`
>   (V1-9 #60 in; V1-17 is #62, independent of this PR). **This is a migration PR** → committed plan +
>   adversarial panel (incl. DB-safety) before code.

## Goal (PR 1a only)

Ship the storage + contract for a per-kid routine, **dark**: a nullable `profiles.routine_config` JSONB,
a single-sourced zod schema + `DEFAULT_ROUTINE` in `@mat-plan/shared`, forgiving validate-on-read, the DAL
carrying a fully-resolved `routine` on the profile DTO, and two seed kids with **different** routines to
prove A≠B on a fresh DB. Nothing renders it yet (that's PR 1b) — so `null → DEFAULT_ROUTINE` is a no-op.

## Design decisions

**D1 — Shape: a versioned OBJECT, per-activity keys, in `packages/shared/src/routine.ts`.**

```
routineItemSchema   = z.object({ key: routineKeySchema, conditional: z.literal(true).optional() }).strict()
routineConfigSchema = z.object({ version: z.literal(1), order: z.array(routineItemSchema) }).strict()
                        .refine(order has no `bodyweight` key)   // weigh-in pinned by construction
```

Object (not bare array) so PR 3's `checkinAllowlist` and any later field are additive with no shape bump.
`conditional` is the **cosmetic, opaque** V1-10 down-payment — stored, never read by V1-18. `RoutineConfig`
= `z.infer`. Exported from the barrel `packages/shared/src/index.ts` (the `readiness.ts`/`activity-shapes.ts`
idiom: `as const` + `z.infer` + schema).

**D2 — Key grammar (the load-bearing contract), namespaced onto EXISTING catalog identities.** Keys are
`namespace:catalogKey` (or bare `strength`): `checkin:<CHECKIN_FIELDS key>` (strip prefix → the exact
registry key, incl. the `activityKey:metricKey` form), `strength` (singleton, carries `conditional`),
`life:<LIFE_ACTIVITY_KEYS>`, `finisher:*` (reserved — validates, not rendered until later). **`bodyweight`
is NOT a legal `order` member** (weigh-in is structurally pinned in PR 1b). `routineKeySchema` validates the
**grammar** (namespace prefix + non-empty tail) in `shared`; **catalog-membership** (does this key exist in
the live catalog?) is checked in `resolveRoutine` with the app-side catalog passed in — because
`CHECKIN_FIELDS`/`LIFE_ACTIVITIES` live in `apps/web/lib` (React-adjacent), not `shared` (matches how
`life-activities.ts` keeps its trust-set app-side). Mild AGENTS.md "domain values in shared" tension — noted;
grammar goes to shared, the concrete allowlist stays derived app-side.

**D3 — `DEFAULT_ROUTINE` reproduces today's exact page** (in `routine.ts`): `strength`, then the check-in keys
in `CHECKIN_FIELDS` order, then the life keys — the order PR 1b renders when `routine_config` is `null`. This
is the ships-dark target; PR 1b asserts it's a visual no-op.

**D4 — `resolveRoutine(raw: unknown, catalog): RoutineConfig`** (pure, in `shared`): `safeParse`; on failure
OR `null` → `DEFAULT_ROUTINE`; then `.filter` `order` to catalog-known keys (**drop-unknowns**, forgiving —
a key removed by a later catalog change never 500s a kid's Today). Pure + unit-tested; the DAL calls it.

**D5 — Migration `0006` (drizzle-generated):** `ADD COLUMN routine_config jsonb` on `profiles` — **nullable,
no default, no backfill, NO index**. Squawk-green (metadata-only, no rewrite, no NOT NULL, no rename). Standard
`SET lock_timeout`/`statement_timeout` header + `IF NOT EXISTS`. `.$type<RoutineConfig>()` in `schema.ts` is a
compile cast only → **always zod-parse the read** (D4). No index — nothing queries INTO the JSONB (the whole
storage rationale); an index would be the smell that says "promote to a table".

**D6 — DAL: extend `getProfileByPublicId`, widen the DTO. No second read.** Add `routineConfig` to the existing
`.select`, resolve via `resolveRoutine`, and widen `ProfileDTO` with `routine: RoutineConfig` (**always
resolved — never null, never raw JSON**). `listProfiles` stays unchanged (tiles don't need the routine — don't
widen the hot picker query). Keeps the Today read one round-trip.

**D7 — Seed two kids differently** (additive edit to the existing Athlete One/Athlete Two insert): Athlete One → `routineConfig`
omitted/`null` (exercises the ships-dark `DEFAULT_ROUTINE` path); Athlete Two → an explicit reordered
`RoutineConfig` (a `checkin:*` key before `strength`, `conditional:true` on the strength item). `as const
satisfies RoutineConfig` so a bad seed fails typecheck. Caveat: the insert is `onConflictDoNothing(publicId)`
→ a re-seed of an EXISTING db won't update routines; A≠B proves on **fresh DBs** (db:verify PGlite + CI Docker
PG + Neon branch) — which is exactly where the success test runs. Prod differentiation is PR 2 (Ray). Stated.

**D8 — `db:verify` + unit tests.** verify: the column is `jsonb`; the two seeds carry **distinct**
`routine_config`; a `null` config resolves to `DEFAULT_ROUTINE`; seed-twice idempotent. Unit (`shared`):
`DEFAULT_ROUTINE` parses; a valid ordered list parses; **unknown keys dropped**; **`bodyweight` rejected** in
`order`; the cosmetic `conditional` is **accepted-and-ignored**.

**D9 — tech-debt entry (this PR):** the JSONB-vs-typed-columns knowing exception + the explicit promotion
trigger (→ a `routine_items` table the first time V1-10 needs to query/join/schedule the routine).

## File-by-file (PR 1a)

| Path                                                                  | Change                                                                                                                                                                                              |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/routine.ts` **(new)**                            | `routineKeySchema` (grammar) · `routineItemSchema` · `routineConfigSchema` (versioned object, `bodyweight` refinement) · `RoutineConfig` type · `DEFAULT_ROUTINE` · `resolveRoutine(raw, catalog)`. |
| `packages/shared/src/index.ts`                                        | Export `./routine` from the barrel.                                                                                                                                                                 |
| `packages/shared/src/routine.test.ts` **(new)**                       | D8 unit cases.                                                                                                                                                                                      |
| `packages/db/src/schema.ts`                                           | `routineConfig: jsonb('routine_config').$type<RoutineConfig>()` on `profiles` (nullable).                                                                                                           |
| `packages/db/migrations/0006_*.sql` **(generated)**                   | `ADD COLUMN routine_config jsonb` (D5).                                                                                                                                                             |
| `packages/db/src/seed.ts`                                             | Two kids' `routineConfig` (D7).                                                                                                                                                                     |
| `packages/db/scripts/verify.ts`                                       | Routine assertions (D8).                                                                                                                                                                            |
| `apps/web/lib/dal/profiles.ts`                                        | Extend `getProfileByPublicId` select + `ProfileDTO.routine` (D6); build the app-side catalog set to pass to `resolveRoutine`.                                                                       |
| `docs/tech-debt.md`                                                   | D9 entry.                                                                                                                                                                                           |
| `docs/plan.md`, `docs/status.md`                                      | V1-18 reframe (backlog row) + status.                                                                                                                                                               |
| the V1-18 design docs (brief/options/review/decision/eng-plan + this) | committed with this PR (the planning trail).                                                                                                                                                        |

## Out of scope (PR 1a)

No `page.tsx`, no render, no config UI, no `day_mask`, no allowlist enforcement, no new Server Action.
Weigh-in-pinned rendering, the `order.map`, and screenshots are **PR 1b**.

---

## Adversarial panel review log

_(Migration PR → the DB-safety lens is required. Simplicity + architecture were exhaustively settled across the
4-phase design→eng investigation; this panel focuses the three lenses that scrutinize the concrete
migration/contract/seed: **DB-safety/migration · correctness/data-integrity · code-reuse/DRY**.)_

### The two structural revisions (adopted)

**R-A — Move the DAL reader (D6) to PR 1b; PR 1a reads the column NOWHERE.** [DB-safety #3 + correctness N2]
The plan had `getProfileByPublicId` select + resolve the column in PR 1a — but that makes the app hard-depend
on the column at deploy, so if Vercel promotes before the GHA migration applies, every profile load 500s
(expand-contract, AGENTS.md). Fix: PR 1a is **purely** migration + shared contract + seed + verify + docs —
**no app code reads `routine_config`**, so there is no deploy-order window and no `ProfileDTO` change (so the
`actions.test.ts` mock is untouched). The DAL widening + `ProfileDTO.routine` + the app-side catalog + the
`DEFAULT_ROUTINE` derivation all move to **PR 1b**, where the render consumes them.

**R-B — No static `DEFAULT_ROUTINE` in `shared`; `shared` owns only pure builders fed the app catalog.**
[code-reuse B1/B2 + correctness S2] `shared` can't import `CHECKIN_FIELDS`/`LIFE_ACTIVITY_KEYS` (app-side,
and themselves derived), so a hard-coded default drifts and the drop-unknowns filter masks it. Fix:
`routine.ts` exports `buildDefaultRoutine(orderedCatalogKeys)` + `resolveRoutine(raw, catalogKeys)` (pure,
catalog-agnostic); the **concrete ordered catalog + `DEFAULT_ROUTINE` derivation live app-side (PR 1b)** so
`DEFAULT ⊆ catalog` by construction. PR 1a's shared unit tests exercise both with a **fixture catalog**.

### Findings & dispositions

**BLOCKING — accepted:**

- **[correctness B1] The `checkin:` prefix + existing `activityKey:metricKey` colon.** `checkin:brush_teeth:stance`
  has two colons. `routineKeySchema` tail = **`.+` (colon-permitting)**; parse by the **FIRST** colon
  (`namespace = before`, `catalogKey = after`) — NEVER `split(':')` + destructure. Round-trip unit test for a
  two-colon metric key. (code-reuse S3: hoist the `NAMESPACES` prefixes to one `as const`; grammar via that.)
- **[code-reuse B1] `DEFAULT_ROUTINE` drift** → resolved by R-B (derived app-side from the live catalog).

**SHOULD-FIX — accepted:**

- **[correctness S1] Item-by-item resolution.** `resolveRoutine` parses the outer object (version + array), then
  validates each `order` item's grammar + catalog-membership and **drops only invalid items**; whole-config →
  `buildDefaultRoutine(catalog)` ONLY when raw is null / non-object / wrong `version`. One bad key never nukes a
  kid's whole routine.
- **[correctness S3 + S4] Seed proven at the RIGHT layer.** `verify.ts` asserts each seed **parses**
  (`routineConfigSchema.safeParse().success`) — so a bad key fails loudly at CI, not silently on read — plus the
  two raw configs distinct + idempotent. The **resolved-distinct** semantics (a valid config ≠
  `buildDefaultRoutine(fixtureCatalog)`) live in the shared unit test (verify can't reach the app catalog).
- **[correctness S5] Drop the dead `bodyweight` refine; document the structural exclusion.** A bare `bodyweight`
  can't satisfy the grammar, and the only reachable form (`checkin:weigh_in:*`) is moot (`weigh_in ∉
CHECKIN_FIELDS` → catalog-filtered). Weigh-in is pinned by being rendered separately in PR 1b, never in `order`
  — document that; no refine needed.
- **[DB-safety #2] Strike "Neon branch" from the A≠B proof (D7).** The Neon branch is prod-shaped (Athlete One/Athlete Two
  exist → `onConflictDoNothing` leaves them NULL); A≠B proves on **empty** targets only (PGlite verify + Docker
  PG). The Neon branch proves apply + idempotency.
- **[DB-safety #4] Migration is generated THEN hand-headered.** `drizzle-kit generate` emits a bare `ALTER TABLE
… ADD COLUMN routine_config jsonb;` — hand-add the `SET lock_timeout/statement_timeout` header + `IF NOT
EXISTS` (like 0004/0005), and add `jsonb` to the `schema.ts` pg-core import (`.$type` won't compile without it).

**NIT / noted:**

- **[correctness N1] `finisher:*` is grammar-valid but catalog-filtered on read until a finisher catalog exists
  (V1-10)** — document accurately (not "preserved through resolveRoutine").
- **[DB-safety #5] `verify.ts`'s "no-jsonb" guard is `entries`-scoped** → `profiles.routine_config` doesn't trip
  it; note it's deliberately entries-only so no one broadens it into a repo-wide check.
- **[DB-safety #1] JSONB is a knowing, documented exception** (tech-debt D9 + promotion trigger); the 4-phase
  investigation + this plan ratify it. Flagged to Ray for explicit sign-off.

### Net effect

PR 1a = `packages/shared/src/routine.ts` (NAMESPACES const · grammar · `routineConfigSchema` · `RoutineConfig`
· `buildDefaultRoutine(catalog)` · `resolveRoutine(raw, catalog)` — item-by-item, colon-safe) + its unit tests
(fixture catalog, two-colon round-trip) + the `0006` migration (generated + hand-headered) + the `schema.ts`
column (+`jsonb` import) + the seed (Athlete One null / Athlete Two explicit) + `verify.ts` (parse + distinct +
idempotent) + tech-debt + docs. **No app code, no DAL, no `ProfileDTO` change** — all of that is PR 1b.
