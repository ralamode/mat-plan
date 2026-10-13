import { sql } from 'drizzle-orm';

import type { Executor } from '../writers/executor';

/**
 * ## ONE definition of "a movement is REFERENCED", and one census of who references it
 *
 * `movements` is referenced from exactly **two** places, and both FKs are **unscoped**:
 * `entries.movement_id` (whose household comes from `entries → profiles`) and
 * `prescriptions.movement_id` (whose household comes from `prescriptions → program_blocks`).
 * Nothing in the schema stops either from crossing households.
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
      select
        (select count(*)::int from entries e
           join profiles p on p.id = e.profile_id
           join movements m on m.id = e.movement_id
          where m.household_id is not null and m.household_id <> p.household_id) as entry_refs,
        (select count(*)::int from prescriptions pr
           join program_blocks b on b.id = pr.block_id
           join movements m on m.id = pr.movement_id
          where m.household_id is not null and m.household_id <> b.household_id) as prescription_refs
    `)) as unknown as { rows: { entry_refs: number; prescription_refs: number }[] }
  ).rows[0];
  return {
    entries: rows.entry_refs,
    prescriptions: rows.prescription_refs,
    total: rows.entry_refs + rows.prescription_refs,
  };
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
 * design. Discriminating them is exact membership in `MOVEMENT_SEED_PUBLIC_IDS`, which lives in
 * `@mat-plan/shared` and is the **caller's** filter: this query must not grow a second, weaker
 * discriminator (a slug test, or a `public_id` prefix test — both were tried and both were wrong;
 * `db:verify` → the authorship discriminator records why).
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
