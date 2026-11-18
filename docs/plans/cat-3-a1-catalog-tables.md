# CAT-3 A1 — the movement library's tables

> Backlog: [plan.md](../plan.md) row `CAT-3`. Spec:
> [cat-3-movement-library](../specs/cat-3-movement-library.md), § "Schema (lane A)" S1–S6 and the A1
> row of "Chunks, in order". Branch: `db/cat-3-a1-catalog-tables`. Migration `0032`. Mutations
> `310`–`329`.

## Where this sits

- **Pillar:** the movement library, which is shared reference data and has no pillar in
  roadmap.md's table.
- **Milestone:** [Beta 0](../milestones/beta-1.md), `CAT-3`'s node in its step chart (the PR embeds
  that chart with the node styled).
- **This PR:** chunk A1, the schema only. The tables arrive with no catalog rows, and nothing in
  `apps/` reads them (S6).
- **Before it:** C0a (#531), whose vocabularies the CHECKs and reference tables mirror.
- **After it:** A2 (the catalog seed, after `OPS-2` PR 1's `seedReference`), the data batches (lane N),
  then P11's option read.
- _Roadmap alignment (2026-11-17): advances `CAT-3` (chunk A1); the muscle list it stores is the one
  `ID-1` keep-open item 5 holds stable for a later body map (answered in the log below); checked
  against the private roadmap, nothing to add here._

## Goal

Give `movements` somewhere to hold what a person filters by:

- a required equipment set;
- one optional primary muscle and any number of secondaries;
- a `modality`.

Equipment and muscles are reference tables seeded from the C0a consts, never `pgEnum`. A global row
with no lift pattern becomes legal for a non-strength catalog row and stays illegal for every other
global row. This is one migration, so A2 seeds against a fixed shape.

**Size:** about 1,000 hand-written lines, plus drizzle's generated snapshot. That is over the
400-line target. The spec makes S1–S6 one migration, and AGENTS.md allows one migration per PR, so
the schema core cannot split. Precedents: 0022's PR was about 800 lines, 0027's about 2,100. The
panel's cuts (log: R3, S2, N5) are what keep it near 1,000.

## Acceptance

From the spec (S1–S6):

- **S1.** `equipment` and `muscles` are reference tables of codes only, equal to `EQUIPMENT` and
  `MUSCLES` after a seed, and listed in `REFERENCE_TABLES`.
- **S2.** `movement_equipment` and `movement_muscles` reference `movements` with `NO ACTION`. Each
  foreign key has a covering index. Both are in `HOUSEHOLD_GRAPH` ahead of `movements`, and their
  `householdRows` select only rows of a movement the household owns. A global movement's rows are
  matched by no household.
- **S3.** A second `primary` row for one movement is refused.
- **S4.** A household row given a `modality` is refused. A household row that has an equipment or
  muscle row is held by proof only.
- **S5.** The `modality` CHECK covers `MODALITIES` exactly. `movements_global_row_has_pattern`
  becomes `household_id IS NOT NULL OR pattern IS NOT NULL OR (modality IS NOT NULL AND modality <>
'strength')`, proved on the migration's own constraint. The `verify.ts` V1-1b simulation re-adds the
  same exported fragment and is compared with the migration's.
- **S6.** No module in `apps/` reads the new tables. The migration carries a deploy-window header.

Done when:

- [ ] `0032` applies on PGlite (`db:verify`) and on the e2e job's empty Postgres. `drizzle-kit
generate` leaves a clean tree.
- [ ] Every proof below is green, and each mutation `310`–`323` turns `db:verify` red on its
      `.expect`, which is the first failure.
- [ ] `git apply --check` passes for every existing patch. 263 and 264 are regenerated (R9).
- [ ] **Merge condition:** the head SHA of the latest `migrate.yml` run contains every earlier
      migration (AGENTS.md "Queue"), and nobody is logging (the window that `0022` names). If another
      lane's migration lands first, `0032` is regenerated on top of it.

## Decisions (as reshaped by the panel)

- **D1. Each join table gets a `bigint` identity `id`** plus a named unique index `(movement_id,
<code>)`.
  - **Why the `id`:** `HouseholdGraphTable` requires `{ id: PgColumn }`
    (`packages/db/src/erasure/graph.ts:50-54`), and P7 selects `g.table.id`
    (`packages/db/scripts/verify/erasure.ts:162-166`).
  - **No `public_id`:** the rows never leave the server. CAT-4 addresses a row by (movement
    `public_id`, code).
  - **No `household_id`:** ownership is derived through `movement_id`. That is what lets a
    household's own taxonomy later travel with its movement (log: `ID-1` item 4).
  - **`created_at` only**, not `...timestamps`: A3 writes these rows by difference and hard-deletes
    them, and `/api/sync` never reaches them, so `updated_at` and `deleted_at` would have no reader.
- **D2. A muscle's role is a `role text` column**, with `movement_muscles_role_check IN
('primary','secondary')` and the partial unique index `uq_movement_muscles_one_primary ON
(movement_id) WHERE role = 'primary'` (S3).
  - **The const is `MUSCLE_ROLES`** in `packages/shared/src/enums.ts`, with `muscleRoleSchema`,
    `MuscleRole` and `MUSCLE_ROLE = keyBySelf(…)`. This follows `HOUSEHOLD_ROLES` (`enums.ts:63`),
    which is also a value only storage uses today and lives in shared "so the zod/TS/DB triple stays
    whole".
  - **Not a contract file.** `enums.ts` is not in program-contract's `owns:`, so A1 waits on no
    contract chunk. No enum const exists anywhere in `packages/db/src` (log: R1).
  - **The CHECK and the index write the literals out,** because a CHECK cannot import a const.
    `assertCheckCoversConst` binds the CHECK to `MUSCLE_ROLES`. S3's proof inserts with
    `MUSCLE_ROLE.primary`, which is what pins the index's literal.
  - **Rejected alternative:** `movements.primary_muscle` plus a join table of secondaries only. It
    contradicts the spec's two join tables and gives A3 two write paths instead of one by-difference
    diff.
  - **Trap, for the guide:** a partial unique index cannot be deferred. So a role swap (X primary to
    secondary, Y the reverse) demotes first and then promotes, in one transaction. This binds A3's
    diff and any CAT-4 writer.
- **D3. The global-row predicate becomes one exported fragment**, `movementGlobalRowHasPattern(t)`
  in `schema.ts`, used by the `check()` and by the V1-1b re-add. Today the predicate is written three
  times (`schema.ts:850`, `verify.ts:908`, and as JS at `corrections/registry.ts:666`).
  - **The probe already answered it:** drizzle renders the fragment table-qualified with `params:
[]`, so the `'strength'` literal stays a literal. `0017:73` shows Postgres accepting the qualified
    form in `ALTER TABLE … CHECK`. The fallback is dropped.
  - **Docblock exception:** `schema.ts`'s "the predicates stay SQL literals" docblock (:698-702) gains
    one line naming this predicate as the exception, because `verify.ts` re-adds it at runtime.
  - **No parity assertion on `MODALITY.strength`:** the strength-row refusal (`311`) inserts
    `MODALITY.strength`, so a rename goes red there.
- **D4. One `ACCESS EXCLUSIVE` lock on `movements`, taken first** (as at `0022:39`).
  - **Why this lock level:** `ADD COLUMN`, `DROP CONSTRAINT` and `ADD CONSTRAINT … CHECK` each take
    it, and the new FKs into `movements` need `SHARE ROW EXCLUSIVE`. Taking the strongest lock first
    avoids an upgrade partway through.
  - **The LOCKS paragraph says what it blocks:** for the transaction's life, every read of
    `movements` and every `entries` FK check into it, which means all strength logging. A queue builds
    behind the `LOCK` while it waits up to 5 s (`0018`'s caveat). PGlite cannot prove lock behaviour
    (`0027`'s caveat).
  - **The swap validates in place.** The new predicate is strictly weaker than the one `0018`
    validated, and the two `modality` CHECKs are added while every row is NULL. Each statement gets a
    bare `-- squawk-ignore constraint-missing-not-valid` line, with its reason on the line above
    (lessons, the `0010` entry).
- **D5. `equipment` and `muscles` are seeded in `seed()` beside `activity_type_categories`**
  (`packages/db/src/seed.ts:221-224`), with `onConflictDoNothing({ target: code })`.
  - `seedReference` does not exist yet (`OPS-2` PR 1). When it lands, these two inserts move with
    the others.
  - **Adding a word reaches production through the seed alone. Removing or renaming one needs a
    migration**, because join rows reference it. `vocabulary.ts:10-12` and CAT-4's item 4 say every
    change is a migration. The correct wording goes to the roadmap thread (log: `ID-1` item 5),
    because lanes never edit contract files.
- **D6. `modality` is `text NULL`**, with `movements_modality_check` (IN `MODALITIES`) and
  `movements_household_row_has_no_modality` (`household_id IS NULL OR modality IS NULL`). It has no
  default, and nothing writes it in A1. As a side effect, a row with a modality can never be moved
  into a household without clearing it first.
- **D7. Every constraint and index name a proof matches is an exported const** beside the existing
  ones (`schema.ts:713-740`), declared with `uniqueIndex('uq_…')` as the siblings are.

## File-by-file changes

| Path                                                         | Change   | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/shared/src/enums.ts`                               | EDIT     | `MUSCLE_ROLES` and its triple (D2). The board confirms the file is free.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `packages/db/src/schema.ts`                                  | EDIT     | **New tables:** `equipment` and `muscles` (code PK, `created_at`); `movementEquipment` and `movementMuscles` (D1, D2). **`movements`:** `modality` and its two CHECKs (D6); the fragment (D3) and its docblock exception; the name consts (D7). **Stale prose** that A1 makes false: the old predicate written out at :754; "a global row must carry a pattern" at :841-844; "VALIDATE is TEN-2d" at :727 and :845. The constraint's name stays `…_has_pattern`, and its docblock says why: a rename is a contract change that 263 and three proofs cite.                                                                      |
| `packages/db/migrations/0032_cat3_a1_catalog_tables.sql`     | NEW      | `drizzle-kit generate --name cat3_a1_catalog_tables` (`0022` shows it emits a CHECK change as a drop and an add), then hardened by hand (below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `packages/db/src/seed.ts`                                    | EDIT     | D5's two inserts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `packages/db/src/erasure/graph.ts`                           | EDIT     | **`HOUSEHOLD_GRAPH`:** the two join tables between `programBlocks` and `movements`, matching the runbook's new steps 10a and 10b (R9). **A `movementsOf(s)` helper** beside `blocksOf` (:110-122), built on `movementInHousehold` with no `deleted_at` filter, as `blocksOf` is: a hidden movement's join rows are still the household's. **`REFERENCE_TABLES`:** `equipment` and `muscles` between `units` and `quantitySlots`, outside 268's context. **Docblocks:** the "The 19 tables" docblock drops its number, since P1 prints the length; the restore docblock adds "…and those movements' equipment and muscle rows". |
| `packages/db/scripts/verify/catalog.ts`                      | NEW      | Two exports. `verifyCatalogMigrationFacts()` takes no `ctx`, because none exists yet at that point. It runs right after `migrate()` and before `seed()`, so it depends on no seeded row. It runs the S5 refusals in a `rolledBack` and **returns** `constraintDef(global CHECK)`, which V1-1b compares against as a local. `verifyCatalogTables(ctx)` runs with the other modules: every other proof below. The name avoids erasure P2's existing `verifyCatalog` (`erasure.ts:104`).                                                                                                                                          |
| `packages/db/scripts/verify.ts`                              | EDIT     | **Early call:** `verifyCatalogMigrationFacts` inside the TEN-2c block (:174-208). **Late call:** `verifyCatalogTables` after `verifyErasure`. **V1-1b:** the re-add (:907-909) uses D3's fragment, and the def comparison follows it (`after.replace(/ NOT VALID$/, '') === before`). **Messages that A1 makes false:** the TEN-2c `convalidated` message and rationale (:160-165, :186-190) now name 0032; the stale "exists NOT VALID" log at :206; the 0018 note at :6064 is re-read.                                                                                                                                       |
| `packages/db/scripts/verify/harness.ts`                      | EDIT     | Its "What a proof module can rely on" (:235-241) names the early function as the one exception that runs before the seed. "Five modules" becomes six in its order list (:235-236).                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `packages/db/src/scope.test.ts`                              | EDIT     | Its list of proof modules (:438-441) gains `catalog`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `packages/db/scripts/verify/erasure.ts`                      | EDIT     | `populateEveryGraphTable` plants one row in each join table on B's movement, inside its `rolledBack`. The guard at :368-372 requires it. The muscle row uses `MUSCLES.at(-1)` (log: C-S4).                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `packages/db/src/queries/movement-ownership.ts`              | EDIT     | Its docblock's "referenced from exactly two places" becomes four, with the join tables named.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `packages/db/scripts/mutations/310…323` and 263, 264, README | NEW/EDIT | § Test plan. 263 and 264 get their context regenerated, and must still be RED on their own `.expect`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/web/test/program-tables-stay-dark.test.ts`             | EDIT     | **A separate catalog `describe`, not `NEW_TABLES`.** A bare `equipment` would match `token-sets.ts:95` today and lane B's `option.equipment` tomorrow. **It matches** `schema\.(?:equipment\|muscles\|movementEquipment\|movementMuscles)`, the bare join-table names in camel and snake case, and SQL-context `(?:from\|join\|into\|update)\s+"?(?:equipment\|muscles)\b`. **Allowlist:** `schema.ts`, `seed.ts`, `erasure/graph.ts`. A non-vacuity case is included. A2 and P11-ii are named as the chunks that relax it. `modality` is held by the header only.                                                             |
| `docs/runbooks.md`                                           | EDIT     | **"Delete a household":** steps 10a and 10b (scoped by `movement_id` in H's movements, before step 11), their step-3 count lines, and "rows 1–19" becomes 21. **"A pending migration wedges prod":** a `0032` line. It says every insert into `movements` fails `42703` while reads are unaffected. The recovery is to re-dispatch `migrate.yml`, and rolling Vercel back is safe. A failed insert's params carry `movements.name`. A seam: the board orders it.                                                                                                                                                               |
| `docs/privacy/data-inventory.md`                             | EDIT     | **§1 counts:** 28 tables, twenty-one household-reachable, seven reference, at :304 and :317-318. **§1a's two rows** read: "personal only on a household's own movement, and no writer makes one; every row the catalog seed writes (A2) is on a global movement, matched by no household's `householdRows`, and reference data that survives a deletion". **`movements.modality`:** ⚠️, refused on a household row. **§1b:** the two new tables. **Re-review trigger 3:** a household-side writer of the join tables, a relaxed modality CHECK, or "my equipment" as a new category. A dated header line.                      |
| `docs/features/movement-catalog.md`                          | NEW      | About 40 lines. `owns: packages/db/scripts/verify/catalog.ts`. **Invariants:** a join row has no `household_id`, and ownership is through its movement; a join row is read only through a movement the caller may already see, never selected by code alone; demote first, then promote; a household row carries no taxonomy in Beta 0. **A2's obligations:** it fills these tables and owns its seed rules, and it must class the join tables with `movements` in `OPS-2`'s Proof A.                                                                                                                                          |
| `docs/features/erasure.md`                                   | EDIT     | The two graph entries and the two reference tables. "P1–P8 run last" now notes that `verifyCatalogTables` runs after them. The `OPS-3` restore trap adds the join rows.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `docs/features/write-path.md`                                | EDIT     | Owns `seed.ts`: the two reference inserts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `docs/architecture.md`                                       | EDIT     | The ERD gains the four tables. The PR embeds it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `docs/plan.md`, changelog fragment                           | EDIT/NEW | Link this plan from the `CAT-3` row. The fragment is `2026-11-17-db-cat-3-a1-catalog-tables.md`, or dated by the merge. `status.md` changes only if its pointer moves. No roadmap item moves.                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### The migration, in order

```sql
-- WHAT THIS ADDS · ORDER ON A FRESH DATABASE · LOCKS (D4) · DEPLOY WINDOW · MERGE CONDITION · IF IT FAILS
SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
LOCK TABLE "movements" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
CREATE TABLE "equipment" ("code" text PRIMARY KEY NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);--> statement-breakpoint
CREATE TABLE "muscles" (… the same …);--> statement-breakpoint
ALTER TABLE "movements" ADD COLUMN "modality" text;--> statement-breakpoint
-- every row's modality is NULL here, so the scan finds nothing
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "movements" ADD CONSTRAINT "movements_modality_check" CHECK (…);--> statement-breakpoint
-- (the same pair for movements_household_row_has_no_modality)
ALTER TABLE "movements" DROP CONSTRAINT "movements_global_row_has_pattern";--> statement-breakpoint
-- strictly weaker than the predicate 0018 validated: every row that passed it passes this
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "movements" ADD CONSTRAINT "movements_global_row_has_pattern" CHECK (…);--> statement-breakpoint
CREATE TABLE "movement_equipment" ("id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, "movement_id" bigint NOT NULL, "equipment_code" text NOT NULL, "created_at" …);--> statement-breakpoint
CREATE TABLE "movement_muscles" (…, "muscle_code" text NOT NULL, "role" text NOT NULL, CONSTRAINT "movement_muscles_role_check" CHECK (…));--> statement-breakpoint
-- four FKs ON DELETE no action, as 0027:59-61; then the indexes:
CREATE UNIQUE INDEX "uq_movement_equipment_pair" ON "movement_equipment" ("movement_id","equipment_code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_movement_muscles_pair" ON "movement_muscles" ("movement_id","muscle_code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_movement_muscles_one_primary" ON "movement_muscles" ("movement_id") WHERE "role" = 'primary';--> statement-breakpoint
CREATE INDEX "idx_movement_equipment_equipment_code" …;--> statement-breakpoint
CREATE INDEX "idx_movement_muscles_muscle_code" …;
```

- **No `CONCURRENTLY` and no `IF NOT EXISTS`**, as in `0027:14-17` and `0022:8-10`. The indexes are on
  new, empty tables, and everything runs inside drizzle's one transaction.
- **Deploy window:** if the new app deploys before `0032` applies, any `movements` insert, bare
  `select()` or column-less `.returning()` fails `42703`, because Drizzle names every column
  ([lessons](../lessons.md) :33-38). An insert is the live case: no app read selects whole rows. The
  order is migrate first.
- **The PR's own preview:** the preview database is migrated only on push to main, so adding an item
  on the preview fails until merge. The PR body says so.

## Test plan

**Where the proofs run:**

- `verifyCatalogMigrationFacts` runs right after `migrate()`, so it sees the migration's constraint.
- `verifyCatalogTables` runs after `verifyErasure`.
- Every planted row is inside a `rolledBack`.
- **Order inside `verifyCatalogTables`, fixed so each `.expect` is the first failure (re-review):** S1's `assertRefTableMatches` runs first, and every muscle row the module plants uses `MUSCLES.at(-1)` (`321`). S4's refusal uses a modality other than `skill` (`313`). S3's two primaries use different muscle codes, so under `314` the second insert is not refused by the pair-unique instead. The exact set of four FKs is asserted before the unknown-code refusal (`323`). The `db:mutations` run checks `313`, `321` and `323` against their `.expect`.

Each row is a proof, and its mutation's `.expect` is that proof's message, which is the first
failure.

| Proof                                                                                                                                                                                         | Mutation                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| _Early._ S5: a global row with no pattern and no modality is refused by the migration's constraint                                                                                            | `310`: `0032`'s CHECK loses `modality IS NOT NULL`                                                                                                           |
| _Early._ S5: a global row with `MODALITY.strength` and no pattern is refused; a global row with `MODALITY.mobility` and no pattern is accepted                                                | `311`: `0032` loses `modality <> 'strength'`                                                                                                                 |
| _Early → V1-1b._ The simulation's re-added def equals the captured one, minus `NOT VALID`                                                                                                     | `322`: D3's fragment drifts by one term                                                                                                                      |
| S4: a household row given a `modality` is refused                                                                                                                                             | `312`: `0032` drops `movements_household_row_has_no_modality`                                                                                                |
| S5: `assertCheckCoversConst('movements_modality_check', MODALITIES)`                                                                                                                          | `313`: `0032`'s IN-list drops `'skill'`                                                                                                                      |
| S3: a second `MUSCLE_ROLE.primary` row on one movement is refused by `uq_movement_muscles_one_primary`; a second secondary is accepted                                                        | `314`: drops the partial index                                                                                                                               |
| The same muscle twice on one movement is refused by `uq_movement_muscles_pair`                                                                                                                | `315`: drops it                                                                                                                                              |
| The same equipment twice on one movement is refused by `uq_movement_equipment_pair`                                                                                                           | `316`: drops it                                                                                                                                              |
| `assertCheckCoversConst('movement_muscles_role_check', MUSCLE_ROLES)`                                                                                                                         | `320`: the CHECK gains a third value                                                                                                                         |
| S2: the four FKs out of the join tables are exactly the expected (child column → parent) set, and each is led by a non-partial covering index (`indpred IS NULL`); an unknown code is refused | `317`: drops `idx_movement_muscles_muscle_code`; `323`: drops the `movement_muscles → muscles` FK                                                            |
| S2: a join row on a **global** movement is matched by no household's `householdRows` (A's or B's)                                                                                             | `318` and `319`: each join table's subquery widened `OR household_id IS NULL`. P7 cannot see this, because none of its fixture rows are on a global movement |
| S1: `assertRefTableMatches` for both tables against `EQUIPMENT` and `MUSCLES`                                                                                                                 | `321`: the seed inserts `MUSCLES.slice(1)` (the fixture uses `.at(-1)`)                                                                                      |
| S4: the seeded database has no join row on a household movement. A planted household row is found, and a planted global row is not                                                            | none: the planted pair is the red half                                                                                                                       |

**Covered elsewhere, not repeated:**

- The FK delete rule is erasure P2 (mutation 262's class).
- Table classification is P1 (260).
- B's planted row being matched by B only is P7(b).
- Column shapes are the drift guard's.

`324`–`329` are held for review findings.

**Commands:**

- **Local:** `pnpm --filter @mat-plan/db db:verify`, then `db:mutations` once on a board slot.
- **Before pushing:** `pnpm db:generate` gives a clean tree; `npx squawk-cli@2.66.0 -c .squawk.toml`
  passes on `0032`; `git apply --check` passes for every patch.
- **CI:** the drift guard, forward-only, Squawk, `db:verify`, and the e2e migrate and seed.

## Risks / rollback

- **A window with no CHECK.** None: the drop and the add are one transaction under D4's lock.
- **Lock wait.** `lock_timeout = '5s'` fails the migration rather than queueing writers behind it.
  **It is not "re-run on the next push":** the new app is live, and every new item name fails
  `42703` until someone re-dispatches `migrate.yml`. The runbook gets that line (above). Rolling
  Vercel back is safe, because old code runs on either schema.
- **A household movement acquires taxonomy.** No writer can do it. S4's proof holds it, and the
  inventory's trigger 3 names the change that would make it live.
- **The deletion runbook goes stale silently.** Only "Erase one athlete" is parsed
  (`verify/schema.ts:2231-2241`). Steps 10a and 10b ship in this PR. Without them, a household
  movement with a join row would abort step 11 with `23503`.
- **Patch contexts.** Twelve patches touch `graph.ts`. 263 (programBlocks → movements) and 264 (the
  "19" line) are regenerated; the rest are placed around. `git apply --check` sweeps all of them.
- **The ownership report (`registry.ts:666`) restates the old predicate.** It stays correct in A1,
  because no global row lacks a pattern. **A2 owes** switching it to D3's predicate before it seeds a
  non-strength row, and the guide records that.
- **Rollback:** reversible by omission. Nothing writes the tables or the column until A2. A bad
  `0032` is fixed forward.

## Out-of-scope / deferred

- **A2:** the catalog seed, `movementIsCatalog()`, the TEN-2 discriminators, and the ownership
  report's predicate.
- **A3:** the upsert.
- **P11-ii:** any `apps/` read.
- **Not in CAT-3 at all:** labels (they stay in shared); "my equipment" and "either" equipment;
  CAT-4's curator role and word changes.
- **The erasure executor:** none exists yet. S2's "a deletion leaves a global movement's rows" is
  proved on `householdRows`, which is what P7 proves for every table, and what `PRIV-3`'s core will
  delete.
- **`owed.test.ts`:** its six A1 `it.todo` lines are the contract owner's to delete. The PR tells the
  roadmap thread, since lanes never edit that file.

## Open questions

None. **The board answered on 2026-11-17:**

- `docs/runbooks.md` is free.
- `packages/shared/src/enums.ts` is also in #546, so A1 merges main after #546. The conflict is append-style at most.
- 263 and 264 may be regenerated, and each must still go RED on its own unchanged `.expect`. Both are listed in the PR body.
- D5's wording and `owed.test.ts` were relayed to the roadmap thread.

## Review-response log (adversarial panel)

**Approved** _(maintainer, orchestrator's chat, 2026-11-17)_: "Approve (Recommended)". Implementation starts from this text.

> Panel cost: correctness 128k · 7m48s, db-safety 148k · 7m24s, architecture 158k · 7m10s,
> reuse 121k · 6m08s, scope 95k · 4m31s, privacy 117k · 3m43s.
> Models: high-stakes schema and migration · every lens: opus (the Fable cap runs until 2026-11-19).
> Re-review (correctness, effort medium) 96k · 3m16s.

### Engineering panel (round 1)

| #     | Lens                             | Critique (short)                                                                                                                                                                                                                                                     | Verdict               | Resolution                                                                                                                                             |
| ----- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1    | All five that read the tests     | **BLOCKING.** The S5 proofs ran after the V1-1b simulation had replaced the constraint, so `310` and `311` could not go red, and `322` had no "before" value                                                                                                         | **accepted**          | `verifyCatalogMigrationFacts()` runs right after `migrate()` and returns the def, and the comparison follows the V1-1b re-add (shape corrected in RR1) |
| R2    | Reuse, architecture              | The role const belongs in shared. `HOUSEHOLD_ROLES` in non-contract `enums.ts` is the precedent                                                                                                                                                                      | **accepted**          | D2. Architecture argued `packages/db` was defensible; the precedent and AGENTS.md's "every enum" outweigh it                                           |
| R3    | Scope, reuse, correctness        | `316`/`318`/`319`/`320` were caught first by P1, P2 and P7, so their `.expect` would be wrong                                                                                                                                                                        | **accepted**          | NO ACTION and table classification are cited, not repeated. `318`/`319` widen with `OR household_id IS NULL`. `316` and `320` are re-aimed             |
| R4    | Reuse, db-safety                 | No proof for the role CHECK, the equipment pair-unique, or a missing FK                                                                                                                                                                                              | **accepted**          | Three proofs plus `316`, `320` and `323`                                                                                                               |
| R5    | Correctness                      | The FK proof was vacuous when a key was missing, and a partial index could count as covering                                                                                                                                                                         | **accepted**          | It asserts the exact set of four FKs and requires `indpred IS NULL`                                                                                    |
| R6    | Architecture                     | `NEW_TABLES` with a bare `equipment` breaks today on `token-sets.ts` and later on lane B. `seed.ts` was not allowlisted                                                                                                                                              | **accepted**          | A separate, narrow catalog `describe`                                                                                                                  |
| R7    | Privacy, db-safety, architecture | The deletion runbook would go stale, and a `0032` recovery line was missing                                                                                                                                                                                          | **accepted**          | `runbooks.md` row; graph placement matches 10a/10b                                                                                                     |
| R8    | Privacy                          | §1a's wording would be false from A2. Mark `modality` ⚠️. Trigger 3 names nothing                                                                                                                                                                                    | **accepted**          | The inventory row as written above                                                                                                                     |
| R9    | Correctness, db-safety, reuse    | Changing "19" to 21 breaks `264`, which the plan did not name                                                                                                                                                                                                        | **accepted**          | The number is dropped from the docblock, and `263`/`264` are regenerated with board sign-off                                                           |
| R10   | Db-safety, reuse, architecture   | `registry.ts:666` and `movement-ownership.ts` restate the old rule or the old FK count                                                                                                                                                                               | **partly**            | The docblock is fixed now. The report predicate is A2's, because it stays correct until a non-strength global row exists                               |
| R11   | Db-safety                        | The merge condition was missing, and "re-run on the next push" was wrong                                                                                                                                                                                             | **accepted**          | Done-when, the header, and Risks                                                                                                                       |
| R12   | Architecture                     | D2's index cannot be deferred, so a swap needs a write order. Its rejection reason contradicted D6                                                                                                                                                                   | **accepted**          | The trap goes in the guide. The reason is restated                                                                                                     |
| R13   | Scope                            | About 1,100 lines with no size line                                                                                                                                                                                                                                  | **accepted**          | A size line in Goal, and the cuts in R3 and N5                                                                                                         |
| R14   | Scope                            | Move the new guide to A2                                                                                                                                                                                                                                             | **rejected, in part** | It stays at about 40 lines. The demote-first trap and the no-`household_id` invariant are A1's, and nothing else holds them between files              |
| R15   | Scope, reuse, architecture       | The stale prose that A1 makes false (:727, :754, :841-845, the TEN-2c message, harness, scope.test)                                                                                                                                                                  | **accepted**          | Each is in the file table                                                                                                                              |
| N1–N5 | Several                          | The probe was already answered; the parity check was tautological; the column-shape row was dropped; `movementsOf`; `MUSCLES.at(-1)`; squawk-ignore alone on its line; name consts; the D4 wording; the milestone link; `verifyCatalog` name clash; the preview note | **accepted**          | Each is in the text                                                                                                                                    |

### `ID-1`'s six keep-open items (architecture lens)

`ID-1` binds auth chunks and A1 is not one, but A1 touches the catalog that CAT-4 cites against
item 5.

| Item                                                        | Verdict                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. The principal is a login, never a profile                | Not touched: A1 adds no person, profile or login column.                                                                                                                                                                                                                             |
| 2. Every access decision goes through `getHouseholdScope()` | No read is added. For later chunks, the guide records the rule: a join row is read only through a movement the scope may already see (`movementIsAvailableTo`), never selected by code alone. Otherwise a `muscle_code` filter would cross households once households have taxonomy. |
| 3. One household per person is a Beta 0 invariant only      | Not touched.                                                                                                                                                                                                                                                                         |
| 4. Nothing pins an athlete to a household                   | Nothing per-athlete is added. The join tables also carry no `household_id`: ownership comes through `movement_id`, so a household's own taxonomy would travel with its movement. That is pinned as a guide invariant.                                                                |
| 5. No age-based permission logic (and the body map)         | No age, birthday or per-athlete value is added. A1 stores `MUSCLES`, the list item 5 holds stable for a later body map. Its stability is `vocabulary.ts`'s contract review, not A1's. Adding a word needs no migration (D5), and the corrected wording goes to the roadmap thread.   |
| 6. Household roles stay a shared const plus a CHECK         | Not touched. `MUSCLE_ROLES` follows the same pattern (D2), and is a muscle's role on a movement, not a household role.                                                                                                                                                               |

### Re-review (correctness, after the reshape)

R1 is resolved. Every mutation from `310` to `323` reaches its own proof first. The graph placement, P7's fixture and the patch contexts are sound.

| #   | Critique (short)                                                                                         | Verdict      | Resolution                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| RR1 | The captured def cannot go "into `ctx`": `VerifyContext` is built at `verify.ts:9866`, after V1-1b       | **accepted** | The early function takes no `ctx` and returns the def. The `VerifyContext` field is dropped; harness's docblock names the exception |
| RR2 | Proof order inside `verifyCatalogTables` decides which `.expect` fires for `313`, `321` and `323`        | **accepted** | The order is fixed in § Test plan                                                                                                   |
| —   | The `packages/db/scripts/` allowlist entry is dead: the scan reads only `apps/web` and `packages/db/src` | **accepted** | Dropped                                                                                                                             |

### As built (deviations from the text above)

- **`315` and `316` turn each pair-unique into a plain index**, rather than dropping it. The pair-unique
  is also the covering index for the movement FK, so dropping it would fail the covering-index proof
  first, and the pair refusal would never be the first failure.
- **The S4 refusal sets a modality with an `UPDATE`** on B's own movement, which is made through
  `insertMovementOwnedBy`. A proof module may not read `scope.householdId` (`scope.test.ts`: the scope
  stays a capability), so it cannot insert a household row directly.
- **The S2 proof plants its global-movement rows in `verify/catalog.ts`**, not in P7's fixture, as the
  test plan says. P7's fixture plants only on B's movement.
