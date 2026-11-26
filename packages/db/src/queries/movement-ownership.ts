import { getTableName, type SQL, sql } from 'drizzle-orm';

import * as schema from '../schema';
import type { IdIn } from '../erasure/graph';
import { rowsOf, type Executor, type Reads } from '../writers/executor';

/**
 * ## ONE definition of "a movement is REFERENCED", and one census of who references it
 *
 * `movements` is referenced from exactly **two** places, and both FKs are **unscoped**:
 * `entries.movement_id` (whose household comes from `entries → profiles`) and
 * `prescriptions.movement_id` (whose household comes from `prescriptions → program_blocks`).
 * Nothing in the schema stops either from crossing households.
 *
 * ⚠️ **`CAT-3` A1 added two more FKs into `movements`**: `movement_equipment` and `movement_muscles`.
 * They describe the movement itself, not a household's use of it, so they are not "references" in
 * this census's sense and are not counted here. But they are `NO ACTION`: a consumer that deletes a
 * movement this census calls unreferenced must delete its join rows first, or it fails `23503`.
 *
 * ⚠️ **Extracted at its SECOND consumer, not speculatively** (`writers/ownership.ts`'s rule). The
 * counts below existed **twice** before TEN-2c — hand-written in `db:verify`'s TEN-2b price proof
 * (which covered `entries` only, one direction) and in prose SQL in
 * [`docs/runbooks.md`](../../../../docs/runbooks.md) pre-flight (d) (which covered both tables and
 * both directions). `db:verify` converts to a caller here in the same PR, and
 * [`plan.md`](../../../../docs/plan.md) → `TEN-2b-2` requires that this definition of _referenced_
 * be the one its orphan correction and `TEN-2c-1`'s split both use. A second copy of this join is a
 * defect, not a style nit: the two copies already disagreed about `prescriptions`.
 *
 * ⚠️ **Amended at `PRIV-3` PR 2a:** one household-relative view, `movementRefsIntoHousehold`, the
 * erasure's pre-flight (d). It still takes no scope: the caller passes the set of movements
 * (`IdIn`, built by the erasure graph from its own predicate), so the census joins stay unscoped.
 *
 * ⚠️ **Amended at `CAT-3` R1:** the fresh start's step 5 deletes global movements, and a census
 * written by hand cannot promise it has seen every table that would hold one. So the deletion reads
 * every foreign key into `movements` from the catalog (`foreignKeysIntoMovements`) and counts each
 * (`movementReferenceCounts`). `db:verify` asserts that the catalog's set is exactly
 * `CENSUS_REFERENCE_TABLES` plus `MOVEMENT_JOIN_TABLES`, so a new FK turns this module's hand list
 * and the deletion's reader red together.
 *
 * ## Why these are UNSCOPED, stated so the next reader does not "fix" it
 *
 * A **cross-tenant census cannot ride a `HouseholdScope`** — the question is precisely _"does any
 * row cross a household boundary"_, and a scoped query can only ever answer it for one side. So
 * these take an `Executor` and no scope, which is the same reason
 * `queries/household-scope.ts` → `liveHouseholdIds` takes none. Adding a scope here would not make
 * it safer; it would blind it. Both are **counts and internal ids only** — no `slug`, no `name`, no
 * `public_id` — because `movements.name` is household free text and a reporter's output is pasted
 * into a public PR.
 *
 * ## `deleted_at` is deliberately NOT a conjunct
 *
 * A **soft-deleted** `entries` row still holds its FK, so it still blocks
 * `DELETE FROM movements WHERE household_id = H` (`23503`) and still strands the row it points at —
 * TEN-2b measured exactly that shape. A census that filtered tombstones would report zero for a
 * procedure that aborts. The same reasoning as `movements`' own indexes, which carry no
 * `deleted_at IS NULL` either (see `schema.ts` → the `movements` docblock).
 */

/**
 * The two tables this module's census joins by hand (`entryMovementRefs`, `prescriptionMovementRefs`):
 * a household's USE of a movement. Named so `db:verify` can compare them with the catalog.
 */
export const CENSUS_REFERENCE_TABLES: readonly string[] = [
  getTableName(schema.entries),
  getTableName(schema.prescriptions),
];

/**
 * The two tables whose FK into `movements` describes the movement itself (`CAT-3` A1). Not a
 * reference in the census's sense: a consumer deleting a movement deletes these rows first.
 */
export const MOVEMENT_JOIN_TABLES: readonly string[] = [
  getTableName(schema.movementEquipment),
  getTableName(schema.movementMuscles),
];

/** The number of rows that cross a household boundary, per referencing table. */
export type CrossHouseholdMovementRefs = {
  /** `entries` of one household pointing at a movement OWNED by a different household. */
  entries: number;
  /** `prescriptions` of one household pointing at a movement OWNED by a different household. */
  prescriptions: number;
  /** The sum — the number `runbooks.md` pre-flight (d) must read as zero before a deletion. */
  total: number;
};

/**
 * The pre-flight (d) census: references that cross a household boundary, from **both** tables.
 *
 * ⚠️ **`m.household_id IS NOT NULL` is load-bearing.** A **global** movement (`household_id IS NULL`)
 * is reference data every household may point at, so it is not a crossing — excluding it is what
 * makes the count mean "a row one family needs is owned by another family". And unscoped, the two
 * directions `runbooks.md` enumerates (H's row → ¬H's movement, and ¬H's row → H's movement) are the
 * **same row set** seen from two sides, so one predicate covers both; a household-relative view is
 * what splits them, and only the runbook needs that.
 */
export async function crossHouseholdMovementRefs(
  exec: Executor,
): Promise<CrossHouseholdMovementRefs> {
  const rows = (
    (await exec.execute(sql`
      select (${entryMovementRefs(sql`true`)}) as entry_refs,
             (${prescriptionMovementRefs(sql`true`)}) as prescription_refs
    `)) as unknown as { rows: { entry_refs: number; prescription_refs: number }[] }
  ).rows[0];
  return {
    entries: rows.entry_refs,
    prescriptions: rows.prescription_refs,
    total: rows.entry_refs + rows.prescription_refs,
  };
}

// The two joins, written once. `about` narrows them by the referenced movement (`m.id`).
const entryMovementRefs = (about: SQL) => sql`
  select count(*)::int from entries e
    join profiles p on p.id = e.profile_id
    join movements m on m.id = e.movement_id
   where m.household_id is not null and m.household_id <> p.household_id and ${about}`;
const prescriptionMovementRefs = (about: SQL) => sql`
  select count(*)::int from prescriptions pr
    join program_blocks b on b.id = pr.block_id
    join movements m on m.id = pr.movement_id
   where m.household_id is not null and m.household_id <> b.household_id and ${about}`;

/**
 * Pre-flight (d), household-relative (`PRIV-3` PR 2a, `src/erasure/preflight.ts`): the `entries` and
 * `prescriptions` of ANOTHER household that point at one of `movements` (the erased household's, as
 * `householdIdsOf(schema.movements, scope)` in the graph builds it). Deleting those movements would
 * abort `23503` on them. The census's own joins, narrowed, so this is not a second copy of the join.
 *
 * The other direction (the household's row on another household's movement) is not counted: the
 * row is deleted with the household, and nothing aborts.
 */
export async function movementRefsIntoHousehold(exec: Reads, movements: IdIn): Promise<number> {
  const about = movements(sql`m.id`);
  const row = (
    (await exec.execute(
      sql`select (${entryMovementRefs(about)}) + (${prescriptionMovementRefs(about)}) as n`,
    )) as { rows: { n: number }[] }
  ).rows[0];
  return row.n;
}

/** One `movements` row, with how many distinct households reference it. Ids only, never text. */
export type SharedMovementRow = {
  /** The internal id. A caller that must NAME the row resolves its `public_id` itself. */
  movementId: number;
  /** Distinct households referencing it through `entries` or `prescriptions`. `0` = unreferenced. */
  householdRefs: number;
};

/**
 * Every movement in the **global** namespace (`household_id IS NULL`) with the number of distinct
 * households that reference it — the input both deferred rows need, from one definition:
 *
 * - **`TEN-2c-1`** (the split backfill) wants the rows with `householdRefs >= 1`: each needs an
 *   original (the household with the earliest referencing row) plus a clone per other household.
 *   `householdRefs > 1` is the expensive case the row's clone rules exist for.
 * - **`TEN-2b-2`** (the orphan correction) wants `householdRefs === 0`: a global row nothing
 *   references at all, which can simply go.
 *
 * Seeded catalog rows come back too and are **not** a defect — they are reference data, shared by
 * design. Discriminating them is the **caller's** filter, and an exact one: a legacy seed row is a
 * member of `MOVEMENT_SEED_PUBLIC_IDS` (`@mat-plan/shared`); since CAT-3 A2-ii a library row is a
 * global row with a modality AND a slug of the library in effect (its `public_id` is generated, so
 * there is no id set to test). This query must not grow a second, weaker discriminator: a slug test
 * alone, a modality test alone, or a `public_id` prefix test (`db:verify` → the authorship
 * discriminator records why).
 */
export async function sharedMovementRows(exec: Executor): Promise<SharedMovementRow[]> {
  return (
    (await exec.execute(sql`
      select m.id::int as movement_id, count(distinct r.household_id)::int as household_refs
        from movements m
        left join (
          select e.movement_id, p.household_id
            from entries e join profiles p on p.id = e.profile_id
           where e.movement_id is not null
          union all
          select pr.movement_id, b.household_id
            from prescriptions pr join program_blocks b on b.id = pr.block_id
        ) r on r.movement_id = m.id
       where m.household_id is null
       group by m.id
       order by m.id
    `)) as unknown as { rows: { movement_id: number; household_refs: number }[] }
  ).rows.map((r) => ({ movementId: r.movement_id, householdRefs: r.household_refs }));
}

/** A foreign key into `movements`, as the catalog has it. Names only: no row is read. */
export type MovementForeignKey = {
  /** `pg_constraint.conname`. */
  readonly name: string;
  readonly schemaName: string;
  readonly table: string;
  /** The referencing columns, in key order. One, for every key a count can be built for. */
  readonly columns: readonly string[];
  /** The `movements` columns the key points at, in key order. `['id']` for every key today. */
  readonly referencedColumns: readonly string[];
  /** `confdeltype`: `a` NO ACTION, `r` RESTRICT, `c` CASCADE, `n` SET NULL, `d` SET DEFAULT. */
  readonly deleteRule: string;
};

/**
 * Every foreign key into `public.movements`, read from `pg_constraint` (`CAT-3` R1, plan D2), the
 * join tables included. The caller decides what a key it cannot count means: the fresh start's
 * deletion refuses a multi-column key, a key onto another column and one that does not abort.
 */
export async function foreignKeysIntoMovements(exec: Reads): Promise<MovementForeignKey[]> {
  const rows = rowsOf<{
    name: string;
    nsp: string;
    rel: string;
    cols: string[] | string;
    refcols: string[] | string;
    rule: string;
  }>(
    await exec.execute(sql`
      SELECT c.conname::text AS name, n.nspname::text AS nsp, r.relname::text AS rel,
             c.confdeltype::text AS rule,
             (SELECT coalesce(json_agg(a.attname::text ORDER BY k.ord), '[]'::json)
                FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS cols,
             (SELECT coalesce(json_agg(a.attname::text ORDER BY k.ord), '[]'::json)
                FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
                JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum) AS refcols
        FROM pg_constraint c
        JOIN pg_class r ON r.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE c.contype = 'f' AND c.confrelid = 'public.movements'::regclass
       ORDER BY n.nspname, r.relname, c.conname`),
  );
  const list = (v: string[] | string): string[] => (typeof v === 'string' ? JSON.parse(v) : v);
  return rows.map((r) => ({
    name: r.name,
    schemaName: r.nsp,
    table: r.rel,
    columns: list(r.cols),
    referencedColumns: list(r.refcols),
    deleteRule: r.rule,
  }));
}

/** A key a count can be built for: one column, onto `movements.id`. */
export function isCountableMovementFk(fk: MovementForeignKey): boolean {
  return (
    fk.columns.length === 1 && fk.referencedColumns.length === 1 && fk.referencedColumns[0] === 'id'
  );
}

/** How a key's table is named in a line: bare in `public`, qualified elsewhere. */
export function movementFkTable(fk: MovementForeignKey): string {
  return fk.schemaName === 'public' ? fk.table : `${fk.schemaName}.${fk.table}`;
}

/** The rows of one referencing column that point at a selected movement. */
export type MovementReferenceCount = {
  readonly table: string;
  readonly column: string;
  readonly rows: number;
};

/**
 * For each countable key outside `MOVEMENT_JOIN_TABLES`, the rows pointing at a movement `movements`
 * selects. Built with `sql.identifier`, never `sql.raw`: the names come from the catalog.
 *
 * 🔴 **No `deleted_at` conjunct**, as this module's census: a hidden row still holds its FK, so it
 * still aborts the delete. A key this cannot count is not counted here; the caller refuses it.
 */
export async function movementReferenceCounts(
  exec: Reads,
  fks: readonly MovementForeignKey[],
  movements: IdIn,
): Promise<MovementReferenceCount[]> {
  const out: MovementReferenceCount[] = [];
  for (const fk of fks) {
    if (fk.schemaName === 'public' && MOVEMENT_JOIN_TABLES.includes(fk.table)) continue;
    if (!isCountableMovementFk(fk)) continue;
    const column = fk.columns[0]!;
    const [row] = rowsOf<{ n: number }>(
      await exec.execute(sql`
        SELECT count(*)::int AS n FROM ${sql.identifier(fk.schemaName)}.${sql.identifier(fk.table)}
         WHERE ${movements(sql`${sql.identifier(column)}`)}`),
    );
    out.push({ table: movementFkTable(fk), column, rows: row?.n ?? 0 });
  }
  return out;
}
