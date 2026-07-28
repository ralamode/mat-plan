# V1-8-3c — Superset write core (schema + writer + db:verify) — Staff plan

> Backlog: [plan.md](../plan.md) **V1-8-3c**, part of the V1-8-3 remainder
> ([v1-8-3-remainder-feel-and-supersets.md](./v1-8-3-remainder-feel-and-supersets.md), Part B). Builds on
> 3b (feel). This slice adds the **superset write path** — the shared-schema fields, their validation, and
> the writer branch that creates `supersets` rows and stamps member entries — **proven by `db:verify`, with
> NO app UI**. The group-as-superset form + read bracketing are **V1-8-3d**. Branch:
> `feat/v1-8-3c-superset-write` (off the 3b branch until 3b merges).

## Goal

Let a session's movements be tagged into a **superset** (spec.md §4) at the write layer: the shared
`logStrengthSessionSchema` accepts optional per-movement `supersetClientId`/`supersetOrder` + a top-level
`supersets[]`; `writeStrengthSession` creates the `supersets` rows and stamps `superset_id`/`superset_order`
onto members via the **existing** `writeSessionStrengthEntry` (its params were pre-wired in 8-2 — no fork).
The `supersets` table + `entries.superset_id`/`superset_order` + CHECKs already exist (migration `0005`) —
**no migration**. `db:verify` proves a 2- and 3-movement superset round-trip through the real writer.

## Why packages-only (no app change)

The new schema fields are **optional**; the app action/form don't populate them yet (3d), so every app-path
session is still flat (superset fields undefined → the writer's superset branch no-ops). The DAL's
`{...m, movementId}` spread carries the optional fields structurally into `ResolvedSessionMovement` with no
DAL edit. So 3c touches only `packages/shared` + `packages/db` + `db:verify` — the write path is exercised
by `db:verify` (calling `writeStrengthSession` directly with supersets), exactly the V1-8-1 "prove the
model, ship the UI next" shape. R11-safe: the writer branch's caller is `db:verify`, not a caller-less app
export.

## Design decisions

**D1 — Schema (shared): optional superset fields + a top-level `supersets[]`.** `sessionMovementSchema`
gains `supersetClientId?: uuidSchema` + `supersetOrder?: z.coerce.number().int().positive()` (1-based, like
`entry_sets.idx`). `logStrengthSessionSchema` gains a **top-level** (session-level, sibling to `movements`)
`supersets: z.array(z.object({ clientId: uuidSchema, label: freeTextNoteSchema })).max(6).optional()` (≤6 =
floor(12/2); `label` reuses the shared free-text shape — blank→undefined). Additive/optional → flat
sessions unaffected.

**D2 — `superRefine`: the 3 non-DB-redundant invariants (append, don't replace).** Keep the existing
distinct-movement-`clientId` check; ADD:

- **distinct `supersets[].clientId`** — else `insertSupersetRow`'s ON-CONFLICT silently merges two groups.
- **membership** — every `movement.supersetClientId` ∈ `supersets[].clientId` (a dangling ref → `undefined`
  in the writer map).
- **≥2 members** — **iterate `val.supersets`** and assert `movements.filter(m => m.supersetClientId ===
s.clientId).length >= 2`. The `supersets[]`-driven direction catches BOTH a 1-member and a **0-member**
  superset (a `movements`-grouped count would miss the 0-member orphan — panel correctness C1).
- **DROP** the pairing (`supersetClientId ⟺ supersetOrder`) and distinct-`supersetOrder`-per-superset
  checks — the DB `entries_superset_order_check` + `uq_entries_superset_order` already enforce them (a
  crafted body hitting the DB CHECK → a backstop; the form never emits these). State they're DB-enforced.

**D3 — Writer: `insertSupersetRow` (private) + the in-tx branch, reusing `writeSessionStrengthEntry`.**
Add module-private `insertSupersetRow(exec, { sessionId, clientId, label })` → `{ id, publicId }`, the
`insertStrengthSessionRow` twin: ON-CONFLICT by `client_id` + **`deleted_at`-guarded** re-select. In
`writeStrengthSession` (still ONE tx, after the session insert): insert each `args.supersets` row → build
`Map<supersetClientId, supersetId>`; in the movement loop, resolve each movement's `supersetId` from the map
and pass it + `supersetOrder` into the **existing** `writeSessionStrengthEntry`. **Throw** if
`m.supersetClientId != null` but the map lookup is `undefined` (belt-and-suspenders for the schema-less
`verify.ts`/future callers; mirrors `if (!profile) throw`). `writeStrengthSession` args gain `supersets?:
{ clientId; label?: string }[]`; `ResolvedSessionMovement` gains `supersetClientId?`/`supersetOrder?`
(**NOT** `supersetId` — the row doesn't exist until the tx; the writer owns the map). **Do NOT re-export**
`insertSupersetRow`/`insertStrengthSessionRow`/`writeSessionStrengthEntry` (the branch stays in-tx);
**correct the stale `V1-8-3 exports it` comments** on the two existing helpers (panel architecture A3).

**D4 — Member CHECK envelope (confirmed, preserve).** A superset member via `writeSessionStrengthEntry`
writes `kind=NULL` + `movement_name` + `movement_id` + `superset_id` + `superset_order`, `metric_key`
unset — passing all six CHECKs (`entries_superset_order_check` pair, `entries_superset_movement_check`
member-is-movement, `entries_value_source_check` at-most-one, `uq_entries_superset_order` distinct slot,
`entries_shape_check` 3-valued, at-most-one). No change to the entry writer.

**D5 — `db:verify`: prove via the real writer; keep the raw-SQL rejections.** Add a `writeStrengthSession`
call with a 2-movement superset + a standalone, and one with a 3-movement superset (no arity cap — the PPL
property), asserting members carry `superset_id` + `superset_order` (ordered) and an idempotent replay →
one graph. The existing V1-8-1 **raw-SQL rejection block stays** (order-pairing, dup-slot,
member-is-movement, 2 FKs, client_id UNIQUE — those can't be produced through the writer).

## File-by-file

| Path                                          | Change | What                                                                                                                                                                                                 |
| --------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/strength-session.ts`     | EDIT   | Superset fields on `sessionMovementSchema` + top-level `supersets[]`; the 3 `superRefine` invariants (D1/D2).                                                                                        |
| `packages/db/src/writers/strength-session.ts` | EDIT   | `insertSupersetRow` (private, guarded); the superset branch in `writeStrengthSession`; `ResolvedSessionMovement` + args gain superset fields; throw on dangling ref; fix stale export comments (D3). |
| `packages/db/scripts/verify.ts`               | EDIT   | 2- & 3-movement superset round-trip via `writeStrengthSession` + idempotent replay (D5); keep the raw-SQL rejections.                                                                                |
| tests                                         | EDIT   | Shared-schema `superRefine` rejections (dangling membership, <2 members, dup superset clientId) + valid superset.                                                                                    |
| `docs/plan.md`, `docs/status.md`              | EDIT   | 3b → merged; 3c in flight → done.                                                                                                                                                                    |

**Not touched:** `apps/web/*` (no action/form/read/DAL change — the fields are optional, unpopulated by the
app until 3d), migrations. **No migration, no app UI.**

## Test plan

- **Shared schema unit** (a `strength-session.test.ts` in `packages/shared`, or via the action test): a
  valid 2-movement superset passes; reject a dangling `supersetClientId`, a <2-member superset, duplicate
  `supersets[].clientId`. Flat sessions (no supersets) still pass (regression).
- **`db:verify`**: D5 — the superset round-trip through the real writer + idempotent replay; every existing
  assertion (incl. the V1-8-1 raw-SQL rejections + the 3b feel) still green.
- **No app/e2e/screenshot** (no app change) — the `e2e` job still runs (packages are code) and must stay
  green. Action-boundary + screenshots land with the UI in 3d.
- **Code review** — the standing round + code-reuse lens; iterate to no critical/blocking.

## Reuse obligations

- `insertSupersetRow` mirrors `insertStrengthSessionRow` (guarded re-select — NOT the `verify.ts`
  `upsertReturningId` shortcut). The superset branch reuses the **existing** `writeSessionStrengthEntry`
  (its `supersetId?`/`supersetOrder?` params) — no second entry writer.
- `supersets[].label` reuses `freeTextNoteSchema`; `supersetOrder` is 1-based (the `entry_sets.idx`
  convention) — no named const (a positional index).
- No re-export widening; helpers stay module-private (panel A3).

## Risks / rollback

- **R1 — the ≥2 check mis-directioned** → a 0-member orphan `supersets` row. Mitigated by iterating
  `supersets[]` (D2) + a schema unit test.
- **R2 — a member stamped into another session's superset.** Mitigated: the map is built from THIS session's
  `supersets` and `sessionId = session.id`; `db:verify` asserts a self-consistent, profile-scoped graph.
- **R3 — partial offline replay collides `superset_order` with a persisted member** → raw
  `uq_entries_superset_order` 500. Unreachable today (full-body replay); a recorded v1.5-sync limitation.
- **No migration / no app change** → fix-forward.

## Open questions (for the panel)

- **Q1 — `supersets[]` top-level vs per-movement?** Top-level session-level array (D1) — recommended.
- **Q2 — keep `label` in 3c's schema (unpopulated until 3d) or add it in 3d?** Keep it optional in the
  schema now (the writer accepts it; harmless), so 3d only wires the form — recommended.
- **Q3 — a dedicated `packages/shared` schema test file vs covering `superRefine` via the action test?**
  A shared unit is cleaner (no app dep); recommend it.

## 10. Review-response log (adversarial panel — 4 lens)

No blocking defect. Net: keep the **per-row pairing** superRefine (dropping only the cross-row distinct-order
check), **null-guard** the new refines, **extract a guarded `reselectLiveByClientId`** tail (the twins drift
otherwise), **hoist the movement/superset max consts**, and tighten framing (label borrow, db:verify delta,
the 3d-owned stale DAL comment).

| #   | Lens(es)                   | Critique                                                                                                                                                                                                                                           | Resolution                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | correctness                | Dropping the pairing check leaves an **app-reachable 500**: `supersetOrder` rides IN the `movements` JSON (forwarded by the action), so an order-without-clientId body passes the schema and violates `entries_superset_order_check` as a raw 500. | **Keep the per-row pairing check** (`supersetOrder set ⟺ supersetClientId set`) — one line, typed envelope. **Drop only** the cross-row distinct-order check (DB `uq_entries_superset_order`). + a boundary test.                                                                                                                                                                                              |
| C2  | correctness + architecture | The new refines as pseudocoded break every FLAT session: `val.supersets` is optional→undefined (iterating throws), and a naive membership check rejects `undefined` clientIds.                                                                     | **Null-guard:** iterate `(val.supersets ?? [])`; membership only over `movements.filter(m => m.supersetClientId != null)`.                                                                                                                                                                                                                                                                                     |
| R1  | code-reuse + architecture  | `insertSupersetRow` is a 3rd copy of the guarded ON-CONFLICT+re-select; `verify.ts:upsertReturningId` is the UNGUARDED shortcut — must not be the model.                                                                                           | **Extract `reselectLiveByClientId(exec, table, clientId)`** (the guarded tail, generic over the 3 graph tables — no `as never` for a SELECT) and route `insertStrengthSessionRow` + `writeSessionStrengthEntry`'s conflict path + `insertSupersetRow` through it. Kills the drift.                                                                                                                             |
| R6  | code-reuse                 | `supersets.max(6)` states "= floor(12/2)" but ships two magic numbers vs `movements.max(12)`.                                                                                                                                                      | **Hoist `MAX_SESSION_MOVEMENTS = 12` + `MAX_SESSION_SUPERSETS = Math.floor(MAX_SESSION_MOVEMENTS / 2)`**; refactor `movements.max()` to the const.                                                                                                                                                                                                                                                             |
| A2  | architecture               | A **third** stale comment (`apps/web/lib/dal/entries.ts:64-67`) mis-attributes the superset DTO fields to "V1-8-3b".                                                                                                                               | 3c is packages-only (can't touch `apps/web`) → **record as a 3d cleanup** (added to the 3d sketch).                                                                                                                                                                                                                                                                                                            |
| A5  | architecture + code-reuse  | `label` reusing `freeTextNoteSchema` classifies a title as a note (vs the 3b F2 "name ≠ note" line; the `supersets` table has both `label` and `note`).                                                                                            | **Keep the reuse** (both simplicity + code-reuse say don't add a parallel schema in 3c) but **document it borrows only the blank→undefined+cap normalization**, not "note" semantics; a tighter label cap can land in 3d.                                                                                                                                                                                      |
| S2  | simplicity                 | `label` framing: Q2 claims 3d wires it, but 3d (S3) leaves it NULL — it has no populator in v1-8.                                                                                                                                                  | Correct the framing: `db:verify` stamps `label`; the form leaves it NULL through v1-8; it's a future user-override, not 3d-wired.                                                                                                                                                                                                                                                                              |
| S5  | simplicity + code-reuse    | 3c's writer proof risks re-asserting mixed-order/profile-scoping already covered by the V1-8-1 raw block.                                                                                                                                          | **Lean the delta:** assert only what the WRITER adds — members carry `superset_id`+`superset_order` (ordered), 2- & 3-arity, idempotent replay. Keep the V1-8-1 raw rejection block (crafts bodies the writer can't emit).                                                                                                                                                                                     |
| —   | all (confirmations)        | —                                                                                                                                                                                                                                                  | **Confirmed:** the member CHECK envelope passes all six (traced); writer map/dangling-throw/session-scoping + one-tx idempotent replay; packages-only compiles+behaves (flat sessions unaffected); 1-based `supersetOrder` (no 0/1 trap); `writeSessionStrengthEntry` reuse (no fork); helpers stay un-exported; `ResolvedSessionMovement` gains the un-resolved `supersetClientId` wire key (docstring note). |

**Test note:** `packages/shared` has no test runner, so the `superRefine` cases are tested via a direct
`logStrengthSessionSchema.safeParse` unit in `apps/web` (runs in CI) + one action boundary test for the
app-reachable order-without-clientId case.
