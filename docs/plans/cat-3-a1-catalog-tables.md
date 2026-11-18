# CAT-3 A1 — the movement library's tables

> Backlog: [plan.md](../plan.md) row `CAT-3`. Spec:
> [cat-3-movement-library](../specs/cat-3-movement-library.md), § "Schema (lane A)" S1–S6 and the A1
> row of "Chunks, in order". Branch: `db/cat-3-a1-catalog-tables`. Migration `0032`. Mutations
> `310`–`329`.

## Where this sits

- **Pillar:** the movement library (shared reference data; no pillar in roadmap.md's table). **Spec:**
  `CAT-3`, in Beta 0. **This PR:** chunk A1, the schema only. The tables arrive empty of catalog rows,
  and nothing in `apps/` reads them (S6).
- **Before it:** C0a (#531), whose vocabularies the CHECKs and reference tables mirror. **After it:**
  A2 (the catalog seed, after `OPS-2` PR 1's `seedReference`), then the data batches (lane N) and
  P11's option read.
- _Roadmap alignment (2026-11-17): advances `CAT-3` (chunk A1); the muscle list it stores is the one
  `ID-1` keep-open item 5 holds stable for a later body map; checked against the private roadmap,
  nothing to add here._

## Goal

Give `movements` somewhere to hold what a person filters by: a required equipment set, one optional
primary muscle and any secondaries, and a `modality`. All of it arrives as reference tables seeded
from the C0a consts, never `pgEnum`. A global row with no lift pattern becomes legal for a
non-strength catalog row and stays illegal for every other global row. It is one migration so A2 can
seed against a fixed shape.

## Acceptance

From the spec, verbatim in substance (S1–S6):

- **S1.** `equipment` and `muscles` are reference tables of codes only, equal to `EQUIPMENT` and
  `MUSCLES` after a seed (`assertRefTableMatches`), and listed in `REFERENCE_TABLES`.
- **S2.** `movement_equipment` and `movement_muscles` reference `movements` with `NO ACTION`. Each
  foreign key has a covering index. Both are in `HOUSEHOLD_GRAPH` ahead of `movements`, with
  `householdRows` that select only the rows of a movement the household owns. A global movement's
  rows are matched by no household.
- **S3.** A second `primary` row for one movement is refused.
- **S4.** A household row given a `modality` is refused. A household row with an equipment or muscle
  row is held by proof only.
- **S5.** The `modality` CHECK covers `MODALITIES` exactly. `movements_global_row_has_pattern`
  becomes `household_id IS NOT NULL OR pattern IS NOT NULL OR (modality IS NOT NULL AND modality <>
'strength')`, with a proof that a global row with neither pattern nor modality is refused. The
  `verify.ts` V1-1b simulation re-adds the same predicate and is compared with the migration's.
- **S6.** No module in `apps/` reads the new tables. The migration carries a deploy-window header.

Done when:

- [ ] `0032` applies on PGlite (`db:verify`) and on the e2e job's empty Postgres. `drizzle-kit
  generate` leaves a clean tree.
- [ ] Every proof below is green, and each mutation `310`–`322` turns `db:verify` red with its
      `.expect`.
- [ ] `git apply --check` of every existing patch still succeeds after this PR's edits.

## Decisions this plan makes (the panel should attack these first)

- **D1. The join tables get a `bigint` identity `id`** plus a `UNIQUE (movement_id, <code>)`. The
  alternative is a composite primary key. Rejected: `HouseholdGraphTable` requires `{ id: PgColumn }`
  (`packages/db/src/erasure/graph.ts:50-54`), and P7 selects `g.table.id`
  (`packages/db/scripts/verify/erasure.ts:162-166`). The id is also AGENTS.md's PK rule. No
  `public_id`: neither table leaves the server (AGENTS.md "Keys" applies to rows that do).
- **D2. Role is a `role text` column with a CHECK `IN ('primary','secondary')`**, plus a partial unique
  index `ON movement_muscles (movement_id) WHERE role = 'primary'` (S3).
  - **Rejected alternative:** a `movements.primary_muscle` column with the join table holding
    secondaries only. It is one table fewer, but it would put a catalog-only column on every
    household row and contradicts the spec's "the two join tables … S3's index".
  - **The const:** no `MUSCLE_ROLES` exists in shared. C0a's entry models roles as `primaryMuscle`
    and `secondaryMuscles` (`packages/shared/src/catalog/entry.ts:122-123`), so a role is a storage
    detail no app or shared code sees. **Proposed:** `MOVEMENT_MUSCLE_ROLES` as an `as const` in
    `packages/db/src/schema.ts`, used by the CHECK, the proofs and A2's seed. It is one definition in
    one package. See Open question 1.
- **D3. The CHECK's predicate becomes one exported fragment.** Today the predicate is typed twice,
  inline at `schema.ts:850` and again at `verify.ts:908`. The spec assumed a fragment existed (fact
  sheet, "claimed but not wired"). This plan adds:

  ```ts
  export const movementGlobalRowHasPattern = (t: {
    householdId: PgColumn;
    pattern: PgColumn;
    modality: PgColumn;
  }) =>
    sql`${t.householdId} is not null or ${t.pattern} is not null or (${t.modality} is not null and ${t.modality} <> 'strength')`;
  ```

  ⚠️ `'strength'` is a literal in the template, not an interpolated value: in a runtime query an
  interpolated value becomes a bind parameter, which DDL cannot take, and AGENTS.md forbids
  `sql.raw`. A const-parity proof keeps the literal honest: `MODALITY.strength === 'strength'` is
  asserted in `verify/catalog.ts`, the contract-test pattern AGENTS.md allows. The simulation in `verify.ts` calls the fragment with
  `schema.movements`' columns. **Unverified:** whether drizzle renders those column references
  table-qualified (`"movements"."household_id"`) in a runtime `ALTER TABLE … CHECK`, and whether
  Postgres accepts that there. **Probe (first implementation step, light):** a 20-line throwaway
  PGlite script in the scratchpad. **If either fails,** the simulation keeps its hand-typed predicate,
  and the proof compares `pg_get_constraintdef` after the simulation's re-add with the def read
  before its drop (minus `NOT VALID`). That catches drift just as well, and either way a mutation
  (`322`) proves the comparison can fail.

- **D4. One `ACCESS EXCLUSIVE` lock on `movements`, taken first**, as `0022` does (`0022:39`). `ADD
COLUMN`, `DROP/ADD CONSTRAINT` and the new FKs into `movements` all need at least `SHARE ROW
EXCLUSIVE`, so taking the strongest one first avoids a lock upgrade mid-transaction.
  - **The re-added CHECK is validated in place,** not NOT VALID then VALIDATE. Every existing global
    row has a pattern (`0018` validated the old predicate, and the new one is weaker), and the table
    is small. `-- squawk-ignore constraint-missing-not-valid` goes directly above it with that
    reason, as `0022:47-49`. The same applies to the two new CHECKs on `modality`, a column that is
    NULL on every row when they are added.
- **D5. `equipment` and `muscles` are seeded in `seed()` beside `activity_type_categories`**
  (`packages/db/src/seed.ts:221-224`), with `onConflictDoNothing({ target: code })`.
  - **Why here:** `seedReference` does not exist yet (`OPS-2` PR 1), and S1 needs the rows after a
    seed. When `OPS-2` PR 1 lands, these two inserts move with the others.
  - **Why `DoNothing`:** a code is referenced by join rows, so an update could never change the key
    anyway. Removing a word is CAT-4's migration question.
- **D6. `modality` is `text NULL`** with `movements_modality_check` (IN `MODALITIES`) and
  `movements_household_row_has_no_modality` (`household_id IS NULL OR modality IS NULL`). No
  default, and no writer sets it in A1.

## File-by-file changes

| Path                                                                  | Change   | What & why                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/schema.ts`                                           | EDIT     | `equipment`, `muscles` (code PK, `created_at`); `movementEquipment`, `movementMuscles` (D1, D2); `movements.modality` + its two CHECKs (D6); the CHECK swap via the exported fragment (D3); constraint/index name consts beside the existing ones (`schema.ts:713-740`); `MOVEMENT_MUSCLE_ROLES` (D2). Fix the stale "VALIDATE is TEN-2d" comments (:727, :845). |
| `packages/db/migrations/0032_cat3_a1_catalog_tables.sql` + meta       | NEW      | `drizzle-kit generate --name cat3_a1_catalog_tables`, then hardened by hand (below).                                                                                                                                                                                                                                                                             |
| `packages/db/src/seed.ts`                                             | EDIT     | D5's two inserts.                                                                                                                                                                                                                                                                                                                                                |
| `packages/db/src/erasure/graph.ts`                                    | EDIT     | The two join tables in `HOUSEHOLD_GRAPH` ahead of `movements`; `householdRows: movement_id IN (SELECT id FROM movements WHERE movementInHousehold(s))`. `equipment`, `muscles` in `REFERENCE_TABLES`. "The 19 tables" → 21. **Placement:** outside the context lines of patches 263 and 268 (fact sheet §12), checked with `git apply --check`.                  |
| `packages/db/scripts/verify/catalog.ts`                               | NEW      | `verifyCatalog(ctx)`, the proofs in § Test plan. Lane A owns this file alone (spec § Lanes).                                                                                                                                                                                                                                                                     |
| `packages/db/scripts/verify.ts`                                       | EDIT     | Import and call `verifyCatalog` after `verifyErasure` (:9867-9871). The V1-1b re-add (:907-909) uses D3's fragment, or the fallback. The stale "exists NOT VALID" log (:206) is fixed.                                                                                                                                                                           |
| `packages/db/scripts/verify/harness.ts`                               | EDIT     | Its docblock's "five modules" → six (:235).                                                                                                                                                                                                                                                                                                                      |
| `packages/db/scripts/verify/erasure.ts`                               | EDIT     | `populateEveryGraphTable` plants one row in each join table on B's household movement, inside its existing `rolledBack` (the guard at :368-372 requires it).                                                                                                                                                                                                     |
| `packages/db/scripts/mutations/310…322-*.patch/.expect`               | NEW      | § Test plan; README table rows.                                                                                                                                                                                                                                                                                                                                  |
| `apps/web/test/program-tables-stay-dark.test.ts`                      | EDIT     | Add the four tables (camelCase and snake_case) to `NEW_TABLES` (:36-37). `modality` cannot be held dark by this test (fact sheet §7): the deploy-window header covers it.                                                                                                                                                                                        |
| `docs/privacy/data-inventory.md`                                      | EDIT     | §1: 24 → 28 tables, nineteen → twenty-one household-reachable, five → seven reference. §1a: two rows, "codes only; no personal columns; written by no writer in Beta 0". `movements` row: `modality`. §1b: the two new reference tables.                                                                                                                         |
| `docs/features/movement-catalog.md`                                   | NEW      | Lane A's guide (spec § Lanes), `owns: packages/db/scripts/verify/catalog.ts`. The tables, S3/S4/S5's invariants, "a household row has no taxonomy in Beta 0", and that A2 adds the seed's rules.                                                                                                                                                                 |
| `docs/features/erasure.md`                                            | EDIT     | Owns `graph.ts` and `erasure.ts`: the two new graph entries and the new reference tables.                                                                                                                                                                                                                                                                        |
| `docs/features/write-path.md`                                         | EDIT     | Owns `seed.ts`: the two reference inserts.                                                                                                                                                                                                                                                                                                                       |
| `docs/architecture.md`                                                | EDIT     | The ERD gains the four tables and their edges; the PR embeds the same diagram.                                                                                                                                                                                                                                                                                   |
| `docs/plan.md`, `docs/changelog/<date>-db-cat-3-a1-catalog-tables.md` | EDIT/NEW | Link this plan from the `CAT-3` row; the fragment. `status.md` only if the pointer moves. Roadmap: no item moves.                                                                                                                                                                                                                                                |

### The migration, in order

```sql
-- WHAT THIS ADDS · ORDER ON A FRESH DATABASE · LOCKS · DEPLOY WINDOW (0022's header shape)
SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
LOCK TABLE "movements" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
CREATE TABLE "equipment" ("code" text PRIMARY KEY, "created_at" timestamptz DEFAULT now() NOT NULL);--> statement-breakpoint
CREATE TABLE "muscles" (… same …);--> statement-breakpoint
ALTER TABLE "movements" ADD COLUMN "modality" text;--> statement-breakpoint
-- squawk-ignore constraint-missing-not-valid   (reason above it: every row NULL)
ALTER TABLE "movements" ADD CONSTRAINT "movements_modality_check" CHECK (…);--> statement-breakpoint
-- squawk-ignore …
ALTER TABLE "movements" ADD CONSTRAINT "movements_household_row_has_no_modality" CHECK (…);--> statement-breakpoint
ALTER TABLE "movements" DROP CONSTRAINT "movements_global_row_has_pattern";--> statement-breakpoint
-- squawk-ignore …   (reason: every global row has a pattern; the new predicate is weaker)
ALTER TABLE "movements" ADD CONSTRAINT "movements_global_row_has_pattern" CHECK (…);--> statement-breakpoint
CREATE TABLE "movement_equipment" (id identity PK, movement_id bigint NOT NULL, equipment_code text NOT NULL, created_at, CONSTRAINT uq_… UNIQUE (movement_id, equipment_code));--> statement-breakpoint
CREATE TABLE "movement_muscles" (…, role text NOT NULL, CONSTRAINT …_role_check CHECK (role IN ('primary','secondary')), UNIQUE (movement_id, muscle_code));--> statement-breakpoint
ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY … REFERENCES "movements"("id") ON DELETE no action;  (×4, as 0027:59-61)
CREATE INDEX "idx_movement_equipment_equipment_code" …;  CREATE INDEX "idx_movement_muscles_muscle_code" …;
CREATE UNIQUE INDEX "uq_movement_muscles_one_primary" ON "movement_muscles" ("movement_id") WHERE "role" = 'primary';
```

- **No `CONCURRENTLY`:** the indexes are on empty new tables, inside drizzle's single transaction (as
  `0027:14-17`).
- **No `IF NOT EXISTS`:** as `0022:8-10`. A re-run is prevented by drizzle's journal, and a half-run
  cannot exist in one transaction.
- **Covering indexes:** the `(movement_id, code)` unique covers `movement_id`. Each code column gets
  its own index.
- **Deploy window:** the header says that the new app deployed before `migrate.yml` applies `0032`
  fails `42703` on any `movements` insert, because Drizzle names every column ([lessons](../lessons.md)
  :33-38). The order is migrate first, as for `0022`.
- **Unverified:** that `drizzle-kit generate` emits the CHECK change as a drop and add, not a no-op.
  Read the generated SQL, and the drift guard re-checks.

## Test plan

All proofs live in `verify/catalog.ts` unless noted, and run on PGlite in `db:verify`. Each row names
its mutation.

| Proof                                                                                                                                                                                | Mutation (`.expect` = the proof's message)                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| S5: a planted global row with no pattern and no modality is refused by `movements_global_row_has_pattern`                                                                            | `310` the migration's CHECK loses `modality IS NOT NULL`                                                         |
| S5: a global `strength` row with no pattern is refused; a global `mobility` row with no pattern is accepted (rolled back)                                                            | `311` loses `modality <> 'strength'`                                                                             |
| S4: a household row given a `modality` is refused                                                                                                                                    | `312` drops `movements_household_row_has_no_modality` from the migration                                         |
| S5: `assertCheckCoversConst('movements_modality_check', MODALITIES)`                                                                                                                 | `313` drops `'skill'` from the migration's IN-list                                                               |
| S3: a second `primary` row for one movement is refused by `uq_movement_muscles_one_primary`; a second `secondary` is accepted                                                        | `314` drops the partial index                                                                                    |
| The same muscle twice on one movement is refused (`UNIQUE (movement_id, muscle_code)`)                                                                                               | `315` drops it                                                                                                   |
| S2: every FK out of the join tables is `NO ACTION` (`pg_constraint.confdeltype = 'a'`) and has a covering index                                                                      | `316` makes `movement_equipment → movements` `ON DELETE CASCADE`; `317` drops `idx_movement_muscles_muscle_code` |
| S2: a join row on a **global** movement, planted in a rolled-back transaction, is matched by neither household A's nor B's `householdRows`; one on B's movement is matched by B only | `318` widens `movementEquipment`'s `householdRows` to `true`; `319` the same for `movementMuscles`               |
| S1: `equipment` and `muscles` are in `REFERENCE_TABLES` (existing P1 covers any table in neither list)                                                                               | `320` removes `equipment` from `REFERENCE_TABLES`                                                                |
| S1: `assertRefTableMatches` for both tables against `EQUIPMENT` and `MUSCLES`                                                                                                        | `321` the seed inserts `MUSCLES.slice(1)`                                                                        |
| S5: the V1-1b simulation's re-added def equals the migration's, minus `NOT VALID`                                                                                                    | `322` the exported fragment (D3) or the hand copy drifts by one term                                             |
| S4: on the seeded database no join row belongs to a household movement. Self-check: the same query on a planted row, rolled back, finds it                                           | none needed: the self-check is the red half                                                                      |
| Column shapes of the four tables and `movements.modality` (`columnsOf`)                                                                                                              | none: shape, not behaviour                                                                                       |

**Patches `323`–`329` stay unused,** held for review findings. **Local runs:** the probe (D3), `pnpm
--filter @mat-plan/db db:verify`, then `db:mutations` once, on a board slot. Before pushing,
`pnpm db:generate` must give a clean tree, `npx squawk-cli@2.66.0 -c .squawk.toml` must pass on
`0032`, and `git apply --check` must pass for every patch. **CI** runs the drift guard, forward-only,
Squawk, `db:verify` and the e2e job's migrate and seed on an empty Postgres.

## Risks / rollback

- **The CHECK swap leaves a window with no CHECK?** No. The drop and add are one transaction under
  the `ACCESS EXCLUSIVE` lock (D4).
- **Lock wait on a busy `movements`:** `lock_timeout = '5s'` fails the migration rather than queueing
  writers behind it. `migrate.yml` re-runs on the next push, as for `0022`.
- **The new app before the migration:** the deploy-window header (S6). This is the same exposure as
  `0022`, and covered the same way.
- **A household's own movement acquires taxonomy by accident:** no writer exists. The S4 proof and
  its self-check hold it.
- **Patch contexts:** graph.ts edits could stop patches 263 and 268 applying. Mitigated by placement
  and the `git apply --check` sweep. A patch that stops applying fails `db:mutations` loudly ("does
  not apply"), never silently.
- **Rollback:** reversible by omission. Nothing writes the new tables or column until A2. A bad
  `0032` is fixed forward with `0033`, and nothing to back up exists.

## Out-of-scope / deferred

- The catalog seed, `movementIsCatalog()` and the TEN-2 discriminators: **A2**. The upsert: **A3**.
- Any read of the tables in `apps/`: **P11-ii**.
- Labels for equipment and muscles: they stay in shared (S1).
- "My equipment", and "either" equipment (spec rule 8).
- A curator role, and adding or removing a word: **`CAT-4`**.
- The erasure executor: no deletion core exists in `packages/db/src/erasure/` yet. S2's "a
  household deletion leaves every global movement's rows" is therefore proved where erasure gets its
  rows, `householdRows`. That is what P7 proves for every other table. When `PRIV-3`'s core lands,
  it deletes exactly those rows.

## Open questions

1. **Where does the role const live?** The recommendation is `packages/db/src/schema.ts` (D2): it is
   a storage detail the shared entry never names. The alternative is a `MUSCLE_ROLES` const in
   `packages/shared/src/catalog/vocabulary.ts`, a contract file that only the roadmap thread edits,
   which would make A1 wait on a contract chunk. For the panel, then the board.

## Review-response log (adversarial panel)

_(pending)_
