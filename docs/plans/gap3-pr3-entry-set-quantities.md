# GAP-3 PR 3 — `entry_set_quantities`, and the end of the free-text load

> Backlog: [plan.md](../plan.md) row GAP-3. Branch: `db/gap3-pr3-entry-set-measures`.
> Supersedes the six-PR split in [gap3-typed-measurements.md §7.6a](./gap3-typed-measurements.md) —
> see "Scope, resized" below. **Revised after a five-lens adversarial panel; the log is at the end.**

## Goal

The census ([§§1-6](./gap3-typed-measurements.md)) found one free-text `load` column encoding three
different physical quantities — `20s` a duration, `30in` a height, `123 (50ft)` a mass **and** a
distance. This PR replaces it with a typed child table and **deletes the free-text columns in the same
migration**.

`quantity_slots` (a `(code, dimension)` vocabulary) + `entry_set_quantities` (the typed child of
`entry_sets`) + `is_bodyweight`/`is_band` on `entry_sets`, and **`weight_num`, `weight_label` and
`seconds` are dropped**. Every reader and writer moves to the new model. **No markup changes** — the
form still renders the same fields and the same two chips; only where their values LAND changes. The
markup rewrite (numeric keypad, multi-slot fields) is the next PR, and that seam is what keeps this
one reviewable.

> **Corrected during implementation.** This plan first said "no `.tsx` file changes". Two `.tsx` files
> did change — `editable-set.tsx` and `page.tsx` — but only as DTO consumers: `set.weight` became the
> primary quantity's value, and `formatSetLine` lost its `unit` argument (the unit now travels on the
> row). No element, class or layout changed, so there is no UX panel and no screenshot round; the
> rendered strings for every pre-existing shape are byte-identical.

## Scope, resized — five PRs became two

§7.6a sized a six-PR arc around one fact: _"the contract deploy now drops `weight_num` — a column with
live data in every logged set"_ (§7.2b item 3). **Ray confirmed prod's `entry_sets` is empty or
near-empty.** No athlete has logged a day ([status.md](../status.md)). So:

| §7.6a                                       | Now                                                                         |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| 1 CI gates                                  | ✅ shipped (#133, #135)                                                     |
| 2 `units.dimension`                         | ✅ shipped (#137)                                                           |
| 3 expand only                               | **this PR** — expand **and** contract, one migration                        |
| 4 backfill script, bounded batches          | **deleted.** A batched idempotent backfill over ~zero rows is ceremony.     |
| 5 form/parse rewrite                        | **next PR** — the UI half only, with the full UX panel it has always needed |
| 6 contract drop + zero-unmigrated-rows gate | **deleted.** Folded here; the gate guards a count that is already zero.     |

Expand→contract exists to protect data across deploys. There is no data and there is no intervening
deploy, so the discipline has nothing to buy here — and rehearsing it costs three PRs that keep the
athlete-facing rewrite at arm's length. **If prod turns out to hold rows after all, this decision
inverts and §7.6a's arc is the correct one** — the count is the whole argument, so it gets asserted,
not assumed (see "Pre-flight" below).

## The design, after the panel

Two blocking findings turned out to have **one shared fix**.

**Architecture found `primary` cannot be pinned to `mass`.** Two movements already in the seeded
catalog break it: `broad_jump` ([catalog-movements.ts:247](../../packages/shared/src/catalog-movements.ts))
measures a **length**, `hollow-body_hold` (:271) measures a **duration**. Filing a broad jump's result
under `slot='distance'` puts it in the same slot that on `sled_push` holds the _auxiliary_ half of
`123 (50ft)` — one slot, two roles, no discriminator. The enum was mixing **role** with **dimension**.

**Correctness and DB-safety independently found the migration aborts** — verified by running it:

```
transformFkeyCheckAttrs — there is no unique constraint matching given keys
for referenced table "quantity_slots"
```

drizzle emits `CREATE TABLE` → `ADD CONSTRAINT … FOREIGN KEY` → `CREATE INDEX`, so a `uniqueIndex`
FK target is created _after_ the FK that references it, inside one transaction.

**Making `quantity_slots` PK `(code, dimension)` fixes both.** `primary` legitimately exists at three
dimensions, and the composite FK now targets the PK — which drizzle inlines into `CREATE TABLE`, so
the ordering hazard disappears instead of being hand-patched.

The vocabulary collapses onto **one axis — role**:

| Movement               | Rows                                            |
| ---------------------- | ----------------------------------------------- |
| back squat 185 lb      | `('primary','mass')` 185 lb                     |
| broad jump 7 ft        | `('primary','length')` 7 ft                     |
| hollow-body hold 30 s  | `('primary','time')` 30 sec                     |
| box jump 30 in         | `('primary','length')` 30 in                    |
| sled push `123 (50ft)` | `('primary','mass')` + `('distance','length')`  |
| push-up `BW+8 (vest)`  | `is_bodyweight = true` + `('vest','mass')` 8 lb |

**The `height` slot is dropped.** A box jump's height _is_ its primary quantity; a separate `height`
slot would mean two slots could hold the same fact, which is the ambiguity this design exists to
remove. **`entry_sets.seconds` is dropped too** — it is superseded by `('primary','time')`, and it is
free to remove precisely now: it has **zero readers and zero writers** (only docblock mentions, in
`set-display.ts:21` and `strength-session.ts:328-329`), so there is nothing to migrate.

```
quantity_slots                    entry_set_quantities
──────────────                    ────────────────────
code       text  ┐                id            bigint identity PK
dimension  text  ┴ PK             client_id     uuid NOT NULL, UNIQUE partial (deleted_at IS NULL)
created_at                        entry_set_id  bigint NOT NULL → entry_sets(id) ON DELETE CASCADE
                                  slot          text NOT NULL   ┐
  primary   mass                  dimension     text NOT NULL   ├ FK → quantity_slots(code, dimension)
  primary   length                unit          text NOT NULL   ┘ FK → units(code, dimension)
  primary   time                  value_num     numeric(8,3) NOT NULL
  vest      mass                  created_at / updated_at / deleted_at
  ankle     mass
  wrist     mass                  UNIQUE (entry_set_id, slot) WHERE deleted_at IS NULL
  distance  length                CHECK value_num >= 0
```

**`dimension` is stored on the row on purpose.** It is the shared column of two composite FKs, and
that is the whole guard: `('height','length','lb')` fails the `units` FK, `('height','mass','lb')`
fails the `quantity_slots` FK. Correctness tried to find a defeating spelling and could not — both
parents' target columns are PKs and all three child columns are NOT NULL, so MATCH SIMPLE never
short-circuits. PR 2 shipped `uq_units_code_dimension` for exactly this; this PR redeems it.

**`client_id`, and no `public_id`.** My first draft had this backwards. DB-safety _proved_ the bug:
without `client_id`, a replayed batch straddling a soft-delete resurrects a duplicate
(`vest_rows: 2`), because the partial unique index does not see the soft-deleted row. And the
`prescription_targets` precedent I cited is not analogous — it is seed-only config
([seed.ts:322](../../packages/db/src/seed.ts)); the like-for-like table is `entry_sets`, which carries
`clientId` ([schema.ts:210](../../packages/db/src/schema.ts)) because it is client-written. AGENTS.md
is explicit for this class of row. `public_id` is dropped instead: nothing addresses a quantity
directly — a set's `public_id` plus its slot is the address.

**`ON CONFLICT` must repeat the predicate.** `ON CONFLICT (entry_set_id, slot) DO UPDATE` is a syntax
error against a partial index (verified: _"there is no unique or exclusion constraint matching the ON
CONFLICT specification"_). It is `ON CONFLICT (entry_set_id, slot) WHERE deleted_at IS NULL DO UPDATE`
— drizzle's `targetWhere`. The repo already knows this
([entries.ts:381-384](../../apps/web/lib/dal/entries.ts)); my draft stated the broken form.

**`numeric(8,3)`**, matching `entries.value_num` — it holds masses, lengths and durations now, and
`(7,3)` caps at 9999.999. Ceiling worth stating: `(8,3)` caps at 99999.999 and Postgres **errors**
rather than truncating, so a 1500 m interval expressed in cm is unstorable. Acceptable; cm is not a
unit anyone logs a 1500 in.

## Acceptance

Backlog criterion (GAP-3, verbatim): _"No free-text load is representable; a weighted box jump needs
no special case."_ **This PR delivers it** — `weight_label` is gone, so no free-text load has anywhere
to live, and a weighted box jump is `('primary','length')` + `('vest','mass')` with no special case.

Done when:

- `weight_num`, `weight_label` and `seconds` no longer exist on `entry_sets`.
- `db:verify` **proves the guard by running it**: `slot='height', unit='lb'` is rejected by the
  database. (Asserted, not claimed — my first draft listed proofs it could not give.)
- One set carries `vest` + `ankle` + `wrist` at once; a second `vest` row on the same set is rejected.
- One set carries two dimensions at once (`primary` lb + `distance` ft — the sled row).
- `pnpm verify` green; `pnpm e2e:local` green; `drizzle-kit generate` leaves a clean tree; Squawk
  reports 0 issues on `0011` **after** the two `SET` statements are prepended.
- **No markup change.** Two `.tsx` files change as DTO consumers only (see the correction above);
  `git diff` shows no element, class or layout edits.

## Pre-flight (before the migration lands)

The entire scope decision rests on one number. Run against prod's unpooled string and paste the
result into the PR description:

```sql
SELECT count(*) AS sets, count(*) FILTER (WHERE weight_label IS NOT NULL) AS labeled,
       count(*) FILTER (WHERE weight_num IS NOT NULL) AS numeric_loads
FROM entry_sets WHERE deleted_at IS NULL;
```

**If `sets` is not ~0, stop and revert to §7.6a's six-PR arc.** Also cut a Neon RESTORE branch before
merge regardless — it costs nothing and this PR drops three columns.

## File-by-file changes

| Path                                                              | Change | What & why                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/shared/src/quantity-slots.ts`                           | NEW    | `QUANTITY_SLOT_CODES` + `QUANTITY_SLOT` (`keyBySelf`) + `QUANTITY_SLOT_DIMENSIONS_BY_CODE` + `QUANTITY_SLOT_ROWS`. Names parallel `units.ts` exactly.                                                        |
| `packages/shared/src/index.ts`                                    | EDIT   | Re-export.                                                                                                                                                                                                   |
| `packages/shared/src/strength.ts`                                 | EDIT   | `parseLoad` stops returning a `weightLabel`; `'BW'` → `isBodyweight`, `'band'` → `isBand`, a number → a `primary` quantity. `CANONICAL_LOAD_LABELS` STAYS — it is the chip vocabulary the form still writes. |
| `packages/db/src/schema.ts`                                       | EDIT   | `quantitySlots` + `entrySetQuantities`; `isBodyweight`/`isBand` on `entrySets`; **drop** `weightNum`, `weightLabel`, `seconds`.                                                                              |
| `packages/db/migrations/0011_*.sql`                               | NEW    | Two `SET` statements prepended; otherwise generator output (see below — the reordering hazard is designed out, not hand-patched).                                                                            |
| `packages/db/migrations/meta/0011_snapshot.json`, `_journal.json` | GEN    | The drift-guard artifact.                                                                                                                                                                                    |
| `packages/db/src/seed.ts`                                         | EDIT   | Seed `quantity_slots` from `QUANTITY_SLOT_ROWS`, `onConflictDoNothing` — see the risk row on dimension immutability.                                                                                         |
| `packages/db/src/writers/strength-session.ts`                     | EDIT   | `writeStrengthSession` writes quantity rows; `updateStrengthSetById`'s `isNull(weightLabel)` guard and its single-statement ownership proof both move.                                                       |
| `apps/web/lib/dal/entries.ts`                                     | EDIT   | `SetDTO` loses `weight`/`weightLabel`, gains `isBodyweight`/`isBand`/`quantities`. Reads join through a live parent (see m9).                                                                                |
| `apps/web/app/p/[profileId]/set-display.ts`                       | EDIT   | `formatSetLine` folds over quantities + the two booleans; `isEditableSet` gates on them instead of `weightLabel === null`.                                                                                   |
| `packages/db/scripts/verify.ts`                                   | EDIT   | The proofs, plus `assertRefTableMatches` extracted and the `units` block (verify.ts:120-142) refactored onto it.                                                                                             |
| `*.test.ts` (4 files)                                             | EDIT   | `set-display.test.ts`, `strength-set-schema.test.ts`, `activity-totals.test.ts`, and the writer's tests, via `QUANTITY_SLOT.primary` — not re-typed literals (AGENTS.md).                                    |
| `docs/lessons.md`                                                 | EDIT   | The composite-FK ordering trap. Symptom → cause → fix, per AGENTS.md's same-PR rule.                                                                                                                         |
| `docs/spec.md`, `docs/architecture.md`                            | EDIT   | **Both ERDs** describe `entry_set` with `weight_num`/`weight_label` (spec.md:99,137-143; architecture.md:172-188). AGENTS.md names these as the data-model and diagram homes; my draft omitted both.         |
| `docs/decisions/0004-typed-measurements.md`                       | EDIT   | Supersede §4 (`is_bodyweight` "varies per set? No" — overturned) and §5 (fixed columns → the child table).                                                                                                   |
| `docs/plans/gap3-typed-measurements.md`                           | EDIT   | §7.2b: slot + table named. §7.3: height/distance columns superseded. §7.6/§7.6a: closed and resized. §7.7 → points here.                                                                                     |
| `docs/plan.md`, `docs/status.md`                                  | EDIT   | Backlog link + the status pointer, same PR as the change.                                                                                                                                                    |

### `packages/shared/src/quantity-slots.ts`

```ts
export const QUANTITY_SLOT_CODES = ['primary', 'vest', 'ankle', 'wrist', 'distance'] as const;
export type QuantitySlot = (typeof QUANTITY_SLOT_CODES)[number];
export const quantitySlotSchema = z.enum(QUANTITY_SLOT_CODES);
export const QUANTITY_SLOT = keyBySelf(QUANTITY_SLOT_CODES); // branch on QUANTITY_SLOT.vest

/**
 * A slot may be legal at MORE THAN ONE dimension — `primary` is whatever the movement measures.
 * A `Record<QuantitySlot, readonly UnitDimension[]>`: adding a slot without declaring its
 * dimensions is a COMPILE error, before the seed, before the FK, before a row exists.
 */
export const QUANTITY_SLOT_DIMENSIONS_BY_CODE: Record<QuantitySlot, readonly UnitDimension[]> = {
  primary: ['mass', 'length', 'time'],
  vest: ['mass'],
  ankle: ['mass'],
  wrist: ['mass'],
  distance: ['length'],
};

/** Rows for the `quantity_slots` seed — one per (code, dimension) pair, which is the PK. */
export const QUANTITY_SLOT_ROWS = QUANTITY_SLOT_CODES.flatMap((code) =>
  QUANTITY_SLOT_DIMENSIONS_BY_CODE[code].map((dimension) => ({ code, dimension })),
);
```

No `label`, no `sort_order`. Labels belong to the form (next PR) and come from `shared`; `sort_order`
was the array index of an already-ordered const, and §7.2c decided field order comes from the
**movement's** declared slot list, not a global one. No `measure-slots.test.ts`: `pnpm test` is
`pnpm --filter web test`, the only vitest config roots at `apps/web`, and `packages/` contains zero
`*.test.ts` files — the file would have shipped green without ever executing. Its one real assertion
folds into `db:verify`.

### The migration

Declared as `primaryKey({ columns: [t.code, t.dimension] })`, so drizzle emits the target inline with
`CREATE TABLE` and the FK ordering hazard cannot occur. Hand-edits are then only:

- `SET lock_timeout = '5s'` + `SET statement_timeout = '60s'`, each with its own
  `--> statement-breakpoint`.

**Verified expectations, corrected after building it.** `adding-required-field` and
`constraint-missing-not-valid` do **not** fire — Squawk exempts tables created in the same file, and
`.default(false)` covers the booleans. But the panel tested an **expand-only** draft, so the plan's
claim that "no `squawk-ignore` is needed" was wrong: the three `DROP COLUMN`s fire `ban-drop-column`,
which is the gate doing its job. Each carries an ignore on the line **directly above** it, with the
justification above that — the escape hatch AGENTS.md prescribes, on two grounds: the verified
zero-row count, and the fact that every reader moves in this same PR so no deployed revision sees the
column missing while expecting it. Result: `Found 0 issues in 1 file 🎉`. One migration file is correct: both tables are created
empty in-file, so there is no validating scan and the `NOT VALID`/`VALIDATE` split rule does not apply.

**Two predictions in my first draft were simply wrong** and are removed: drizzle does _not_ emit
`ADD COLUMN … NOT NULL` without a default here (`.default(false)` is declared, and it emits
`DEFAULT false NOT NULL` correctly — `lessons.md:17` describes 0010's _schema-declares-no-default_
case, which does not apply); and the forward-only guard has no exposure, but it also does not read
migration SQL content, so it validates nothing about the hand-edit.

## Test plan

`packages/db/scripts/verify.ts` on PGlite, via `pnpm verify`. Plus `pnpm e2e:local` (~35s) because the
write path changes.

**Rejection proofs — verified by the panel against a real draft, including which constraint fires:**

| Insert                                                                                                                 | Fires                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `('height','length','lb')`                                                                                             | `entry_set_quantities_unit_dimension_fkey`                                                   |
| `('height','mass','lb')`                                                                                               | `entry_set_quantities_slot_dimension_fkey`                                                   |
| `('torso','mass','lb')`                                                                                                | `entry_set_quantities_slot_dimension_fkey`                                                   |
| `('primary','count','count')`                                                                                          | `entry_set_quantities_slot_dimension_fkey` — a slot is legal only at its declared dimensions |
| `value_num = -1`                                                                                                       | `entry_set_quantities_value_num_check`                                                       |
| second `vest` row on one set                                                                                           | `uq_entry_set_quantities_set_slot`                                                           |
| `('primary','mass','kg')`, `('primary','time','sec')`, `('primary','length','in')`, vest+ankle+wrist, primary+distance | accepted                                                                                     |

`cause.constraint` is populated in every case, so `expectRejectedBy` (verify.ts:79) works unmodified.

**Shape + lifecycle**

- Hard-delete the parent set → quantities cascade (proven working).
- **Soft-delete the parent set → its quantities stay live.** Real, and the app only ever soft-deletes,
  so every reader must join through a live `entry_sets`. Proven here and enforced in the DAL.
- Soft-delete a quantity → a new row for the same `(entry_set_id, slot)` inserts.
- `ON CONFLICT … WHERE deleted_at IS NULL DO UPDATE` replays to one row.
- `columnsOf('entry_sets')` no longer contains `weight_num`, `weight_label`, `seconds`.

**Parity** — `quantity_slots` == `QUANTITY_SLOT_ROWS` both directions via the extracted
`assertRefTableMatches`; seed twice → 7 rows, not 14.

**Not proven here:** PGlite cannot prove lock behaviour or `VALIDATE` timing. Two empty tables and two
defaulted booleans, so there is nothing lock-sensitive — but the general gap survives
([tech-debt.md](../tech-debt.md)). My first draft also claimed a proof that _"existing `entry_sets`
rows read `is_bodyweight = false` after the migration"_ — structurally impossible, since `verify.ts`
constructs a fresh PGlite and migrates before any row exists. Removed.

## Risks / rollback

| Risk                                                                                                                                                                                                                                               | Mitigation                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Prod is not actually empty** and this PR drops three populated columns.                                                                                                                                                                          | The pre-flight query, pasted in the PR description, plus a Neon RESTORE branch. If it is non-zero the scope decision inverts and §7.6a's arc returns.                                                                                                                                                            |
| **A slot's `dimension` set is immutable once a quantity row exists** — and `db:seed` runs on every push to main, so a changed dimension turns the **prod migrate job** red, not just the PR.                                                       | Verified by the panel. The seed uses `onConflictDoNothing` (not `DoUpdate`) so it cannot attempt the failing update. Adding a slot or a dimension is cheap; _removing_ one is an expand→contract.                                                                                                                |
| **Missing-row ambiguity** — no `vest` row means both "logged, no vest" and "not logged". This is the exact ambiguity §7.2 used to _reject_ the metric model, and it is re-created here.                                                            | **Stated, not solved.** The movement-declared slot set (§7.2c, V1-22) is what makes absence meaningful: if the movement declares `vest` and no row exists, that is "no vest". Until V1-22 the distinction is deferred, and the YDP progression rule cannot yet be read from the data. Recorded on the V1-22 row. |
| `entries.unit` becomes a second, conflicting home for the unit — a `primary` row in `lb` can sit under an entry declaring `kg`.                                                                                                                    | The rule, named now so the next PR does not invent one: **the quantity's unit wins**; `entries.unit` is vestigial for strength entries and is dropped when `parseLoad`'s last caller goes.                                                                                                                       |
| **Three-level descendant** — `profiles → entries → entry_sets → entry_set_quantities` — breaks `updateStrengthSetById`'s single-statement ownership proof, whose docblock stakes correctness on _"NO `db.transaction`"_ (strength-session.ts:335). | Real and novel; §7.2a's "third instance of an established pattern" was false on this axis. The writer becomes a transaction, and that is called out as the PR's highest-risk code change rather than inherited silently.                                                                                         |
| **This PR is large** — ~18 files.                                                                                                                                                                                                                  | Held to one concern by the UI seam: **no `.tsx` changes**. The form keeps writing `'BW'`/`'band'` chips; only where they _land_ changes. The markup rewrite is the next PR, with its UX panel.                                                                                                                   |
| Per-set grain denormalizes a height across a 3-set box jump.                                                                                                                                                                                       | Accepted — the set genuinely is where it varies. V1-13's "collapse a uniform slash-list to a scalar" rule now applies to lengths too, not just `load`/`reps`.                                                                                                                                                    |

**Rollback:** fix-forward, with the Neon RESTORE branch as the real net since this drops columns.

## Out-of-scope / deferred

- **The form rewrite** — numeric keypad, chips → boolean toggles, multi-slot fields. **Next PR, and it
  needs the full UX panel** (AGENTS.md: required on every UI PR). It is also gated on V1-22, which is
  where a coach declares a movement's slot set; **a movement declaring no slots renders exactly today's
  single field**, which is that PR's default and the escape hatch from the deadlock.
- **`prescriptions`** gains nothing here; `target_reps` stays verbatim TEXT (§7.4).
- **`movements.is_bodyweight` is not dropped** — it becomes the _default_ source once a picker exists.
- **`entries.raw_load`** — a second verbatim column, out of scope until V1-13's exporter.
- **The per-set slash lists** (`65/65/65`) — a row-shape problem for V1-13, not a column-design one.
- **Where `BW (unassisted)`, `BW (modified)`, `30 (2x 15 DB)` land** (§7.6 Q5) — with no backfill, this
  stops being a migration question and becomes a V1-9a notes question.

## Open questions

None blocking. Carried: whether a household magnitude preference exists or the next PR creates it
(§7.6 Q3) — `unit` is NOT NULL on every quantity row, so the form needs a deterministic resolution.

## Review-response log (adversarial panel)

Five lenses, run 2026-09-23 **before implementation**, per [README.md](./README.md): correctness &
data integrity · DB safety/migration (the dedicated reviewer a migration plan requires) · simplicity &
scope · architecture & consistency · code reuse/DRY. No UX panel — this PR touches no UI, which is
itself a scoping decision the panel forced. Three reviewers ran the draft migration against PGlite and
Squawk rather than reading it; that is why the two blocking findings are facts, not opinions.

### Blocking — all accepted

| Finding                                                                                                                                                                    | Response                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Arch:** `MEASURE_SLOT_DIMENSION` pins `primary` to mass and breaks `broad_jump` + `hollow-body_hold`, already in the seeded catalog; the enum mixes role with dimension. | **Accepted.** PK `(code, dimension)`; `primary` is legal at mass/length/time. Dropped the `height` slot as now-redundant, and `entry_sets.seconds` with it.                  |
| **Correctness + DB-safety:** the migration aborts — drizzle emits the composite FK before the `uniqueIndex` it targets. Reproduced against PGlite.                         | **Accepted.** Designed out rather than hand-patched: the FK target is the PK, which drizzle inlines into `CREATE TABLE`. `lessons.md` entry added.                           |
| **Simplicity:** the expand→backfill→contract arc protects data that does not exist; three of six PRs are ceremony.                                                         | **Accepted** — and Ray confirmed prod is empty. PRs 4 and 6 deleted; the drop folds in here. Guarded by a pre-flight count, because the whole decision rests on that number. |

### Major — accepted

- **`client_id` restored** (correctness + DB-safety). My "no `client_id`" argument cited
  `prescription_targets`, a seed-only config table; the analogous one is `entry_sets`, which has it.
  DB-safety proved the replay bug: a batch straddling a soft-delete resurrects a duplicate.
- **`ON CONFLICT` needs `WHERE deleted_at IS NULL`** — the form I specified is a syntax error against a
  partial index. Corrected, and it was the _entire_ justification for dropping `client_id`.
- **Soft-deleted parents leave live children** — the cascade proof I wrote tests a path the app never
  takes. Both proofs now, plus the DAL join rule.
- **`entries.unit` conflict** (arch M7 + correctness m10) — no PR owned it. Rule named.
- **Three-level descendant breaks the writer's single-statement ownership proof** (arch M3). "Third
  instance of an established pattern" was false where it costs; stated plainly.
- **`spec.md` + `architecture.md` ERDs** (arch M5) — both describe the dropped columns; both were
  missing from my file list. AGENTS.md names them as the homes.
- **`measure` collides with `metric_definitions` and the `'measurement'` activity category** (arch M4).
  Renamed to `entry_set_quantities` / `quantity_slots`. Ray's call, taken.
- **`measure-slots.test.ts` would never run** (reuse B1) — no runner covers `packages/`. Deleted.
- **`assertRefTableMatches` extracted** and the `units` parity block refactored onto it (reuse M2) —
  two copies of a bidirectional parity loop is the drift the constants rule targets.
- **Naming parallel to `units.ts`** and a `keyBySelf` member const (reuse M7/M8, arch M11). Taken;
  tests branch on `QUANTITY_SLOT.primary`, not `'primary'`.
- **`sort_order` dropped** (three lenses independently) — it was the array index of an ordered const,
  and §7.2c puts field order on the movement.
- **`public_id` dropped** (simplicity + reuse) — nothing addresses a quantity directly.
- **Dimension immutability breaks `db:seed` on prod** (DB-safety M4) — seed switched to
  `onConflictDoNothing`; risk row added distinguishing add-a-slot from change-a-dimension.

### Rejected, with reasons

- **Simplicity 2: drop `quantity_slots` for `text` + a paired CHECK.** Rejected. A CHECK cannot be a
  composite-FK target, and the composite FK is the guard. The cost objection is answered instead by
  stripping the table to `(code, dimension, created_at)` — no `label`, no `sort_order` — which removes
  most of what simplicity was actually pricing.
- **Simplicity 7: move the booleans to the next PR.** Rejected — `weight_label` is dropped _here_, so
  `'BW'`/`'band'` need their destination in this PR or the chips have nowhere to land.
- **Correctness M4: booleans nullable, `NOT NULL` later.** Rejected _given the empty table_. The
  argument was resumability for a batched backfill; there is no backfill. `NOT NULL DEFAULT false` is
  correct when there are no rows to mislabel. **This reverses if the pre-flight count is non-zero.**
- **Reuse 6: extract a shared `refRows()` builder.** Rejected for now — three near-identical builders
  whose bodies differ by a field, and AGENTS.md warns against ceremony. `QUANTITY_SLOT_ROWS` is a
  `flatMap` over pairs, not the same shape. Noted: do not add a fourth without extracting.
- **Simplicity 8: documentation is ~40% of the diff.** Partially rejected. `spec.md`/`architecture.md`
  are load-bearing (their ERDs go stale otherwise) and AGENTS.md mandates `plan.md`/`status.md`. The
  ADR edit is kept because §4 is _overturned_ by this PR, not merely advanced by it.
