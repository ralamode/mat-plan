import { and, inArray, not, type SQL, sql } from 'drizzle-orm';
import { getTableConfig, type PgColumn, type PgTable } from 'drizzle-orm/pg-core';

import { isLiveMembership } from '../queries/household-membership';
import * as schema from '../schema';
import type { OwnerScope } from '../scope';
import { type Executor, rowsOf, setLocalTimeouts } from '../writers/executor';
import { graphTableName, HOUSEHOLD_GRAPH, householdIdsOf, householdRowsOf } from './graph';
import { countOf, householdPreflights, PREFLIGHT_CHECKS, type PreflightCheck } from './preflight';

/**
 * 🔴 **The household erasure core** (`PRIV-3` PR 2a; `docs/plans/priv-3-guarded-deletion.md` D3;
 * the guide is `docs/features/erasure.md`). Removes every row of one household, hidden rows
 * included, in `HOUSEHOLD_GRAPH` order, or refuses and changes nothing.
 *
 * ```text
 * eraseHousehold(exec, scope, { apply })
 *   dry run (apply: false): count every graph table, run the pre-flights, read the memberships.
 *                           Writes nothing, takes no lock, opens no transaction.
 *   apply:  exec.transaction(tx =>
 *             setLocalTimeouts(tx, '60s')                       (lock 5s, statement 60s)
 *             now(), pg_current_wal_lsn()                       (the restore point, reported)
 *             SELECT … FOR UPDATE on every PARENT_TABLES row of H, in LOCK_ORDER, id order
 *             the household row exists, or ErasureTargetNotFound
 *             pre-flights (a)–(h), each zero, or ErasurePreflightRefused { check }
 *             count every graph table (count()::int)
 *             DELETE … RETURNING in graph order: each length = its count (ErasureCountMismatch),
 *             and every returned household_id is H's (ErasureForeignRow))
 * ```
 *
 * **It runs inside a caller's transaction, and never commits one.** It opens its work with
 * `exec.transaction(…)`. Given a database handle that is a transaction of its own, committed when the
 * core returns. Given an open transaction (`CAT-3` R0 passes its `tx`), drizzle makes it a
 * **SAVEPOINT**: the core's work is released into the caller's transaction and commits only when the
 * caller's does, so a caller that compares the returned `total` with an expected one and throws
 * rolls the whole erasure back. A refusal inside the core rolls back to the savepoint and rethrows;
 * the caller's transaction is left usable. ⚠️ The timeouts are `SET LOCAL`: they outlive the
 * savepoint and last until the CALLER's transaction ends.
 *
 * **What it returns:** the per-table counts in graph order (rows that would be erased on a dry run,
 * rows erased under `apply`), their total, the pre-flight counts, and the household's Clerk user ids,
 * each marked `liveElsewhere` when that account holds a live membership in another household (that
 * account must NOT be deleted at Clerk: PR 2b's checklist). 🔴 The report holds Clerk ids; a caller
 * that prints it decides what is safe to print (R0 prints counts only).
 *
 * 🔴 **Errors: only the core's own are safe to print.** Its three typed errors carry fixed text, a
 * check letter, a table name and counts. Anything else is a database error, a `DrizzleQueryError`
 * whose MESSAGE holds the bound parameters, the household's id among them. So every caller catches
 * and redacts (`scripts/corrections/redact.ts`) and prints only `cause.code` and `cause.constraint`.
 *
 * 🔴 **The lock order: never against the program writers.** `LOCK_ORDER` takes H's `program_blocks`
 * rows FIRST, then H's `profiles`, the order of the assignment writers (`writers/program/assign.ts`
 * `lockProgram` then `lockAthletes`, lane guide invariant 12), so the core cannot deadlock with
 * `putOn`, `takeOff` or `reorderPrograms`. Then the household row; then `program_blocks` and
 * `profiles` ONCE MORE, to hold any inserted before the household row was locked (no new one can be
 * inserted after it); then the other parents, parent before child. Every table in id order.
 * ⚠️ **It CAN deadlock with a log write.** The row writer takes `KEY SHARE` on a session (inserting a
 * superset) before a profile (inserting the entry); the core locks the profile before the session.
 * Postgres aborts one side (`40P01`); if that is the erasure, re-run from the dry run. So can a
 * `lock_timeout`. `db:verify` pins the order and the mode from this file's source: PGlite has one
 * connection, so no proof can show a wait.
 *
 * **Why `FOR UPDATE`, not `FOR NO KEY UPDATE`.** An insert of a child row takes `FOR KEY SHARE` on the
 * parent it references; only `FOR UPDATE` conflicts with it. So once a parent row is locked, no new
 * row can reference it until the transaction ends. After the second pass over blocks and profiles,
 * the set of H's parent rows is closed, so a straddling row cannot be written between the pre-flights
 * and the deletes.
 *
 * **Never a `deleted_at` filter**, here or in the graph: a hidden household, profile or row is erased
 * like a live one (`scripts/corrections/README.md`, the deletion rules).
 *
 * **Household grain only.** The `athlete` option (one profile, `ATHLETE_GRAPH`) arrives with `PRIV-3`
 * PR 3. Not re-exported from `src/index.ts`: nothing in the app erases a household.
 */

/** A pre-flight read non-zero inside the transaction: nothing was erased. Fixed text, no id. */
export class ErasurePreflightRefused extends Error {
  constructor(
    readonly check: PreflightCheck,
    readonly count: number,
  ) {
    super(`erasure refused: pre-flight (${check}) found ${count} row(s); nothing was erased`);
    this.name = 'ErasurePreflightRefused';
  }
}

/** No household row matches the scope (already erased, or never there). Fixed text, no id. */
export class ErasureTargetNotFound extends Error {
  constructor() {
    super('erasure target not found: no household row matches; nothing was erased');
    this.name = 'ErasureTargetNotFound';
  }
}

/** A `DELETE`'s `RETURNING` length differed from its pre-delete count. */
export class ErasureCountMismatch extends Error {
  constructor(
    readonly table: string,
    readonly expected: number,
    readonly actual: number,
  ) {
    super(
      `erasure aborted: ${table} expected ${expected} row(s), got ${actual}; nothing was erased`,
    );
    this.name = 'ErasureCountMismatch';
  }
}

/** A `DELETE` returned a row whose `household_id` is not the erased household's. */
export class ErasureForeignRow extends Error {
  constructor(readonly table: string) {
    super(`erasure aborted: a deleted ${table} row was not the household's; nothing was erased`);
    this.name = 'ErasureForeignRow';
  }
}

export type ErasureReport = {
  readonly applied: boolean;
  /** Graph order. Rows that would be erased (dry run) or that were (apply). */
  readonly counts: readonly { readonly table: string; readonly rows: number }[];
  readonly total: number;
  readonly preflights: Readonly<Record<PreflightCheck, number>>;
  /**
   * 🔴 Personal identifiers (Clerk user ids): for PR 2b's privileged heading only. `liveElsewhere`
   * is as of the transaction, not a lock; 2b re-reads it immediately before any Clerk deletion.
   */
  readonly members: readonly { readonly clerkUserId: string; readonly liveElsewhere: boolean }[];
  /**
   * Under `apply`: `now()`, which is the start of the ENCLOSING transaction (the caller's, inside
   * one), and the WAL position read at the core's first statement. Either is a valid restore point:
   * nothing of the erasure is written before them.
   */
  readonly restorePoint: { readonly at: string; readonly walLsn: string } | null;
};

type GraphTable = PgTable & { id: PgColumn };

/**
 * Every graph table that is the parent of a foreign key, from drizzle's own FK config (so it is
 * derived, never a hand list). `db:verify` holds it against `pg_constraint`.
 */
export const PARENT_TABLES: readonly GraphTable[] = HOUSEHOLD_GRAPH.map((g) => g.table).filter(
  (t) =>
    HOUSEHOLD_GRAPH.some((child) =>
      getTableConfig(child.table).foreignKeys.some((fk) => fk.reference().foreignTable === t),
    ),
);

const FIRST: readonly GraphTable[] = [schema.programBlocks, schema.profiles];

/**
 * 🔴 The order the core locks in (see the module doc): `program_blocks`, `profiles`, the household
 * row, `program_blocks` and `profiles` again, then every other parent, parent before child.
 */
export const LOCK_ORDER: readonly GraphTable[] = [
  ...FIRST,
  schema.households,
  ...FIRST,
  ...[...PARENT_TABLES].reverse().filter((t) => !FIRST.includes(t) && t !== schema.households),
];

async function countRows(exec: Executor, t: GraphTable, where: SQL): Promise<number> {
  return countOf(exec, sql`SELECT 1 FROM ${t} WHERE ${where}`);
}

/** Whether the household row is there. Hidden or live: a hidden household is still erased. */
async function householdExists(exec: Executor, scope: OwnerScope): Promise<boolean> {
  return (await countRows(exec, schema.households, householdRowsOf(schema.households, scope))) > 0;
}

/**
 * The household's memberships, hidden ones too, and whether each account holds a LIVE membership
 * (`isLiveMembership`: member row and household both live, the resolver's own rule) elsewhere.
 */
async function members(exec: Executor, scope: OwnerScope): Promise<ErasureReport['members']> {
  const hm = schema.householdMembers;
  const theirs = householdIdsOf(hm, scope)(sql`${hm.id}`);
  const rows = await exec
    .select({ clerkUserId: hm.clerkUserId })
    .from(hm)
    .where(theirs)
    .orderBy(hm.id);
  if (rows.length === 0) return [];
  const elsewhere = new Set(
    (
      await exec
        .select({ clerkUserId: hm.clerkUserId })
        .from(hm)
        .innerJoin(schema.households, sql`${schema.households.id} = ${hm.householdId}`)
        .where(
          and(
            inArray(
              hm.clerkUserId,
              rows.map((r) => r.clerkUserId),
            ),
            isLiveMembership(),
            not(theirs),
          ),
        )
    ).map((r) => r.clerkUserId),
  );
  return rows.map((r) => ({
    clerkUserId: r.clerkUserId,
    liveElsewhere: elsewhere.has(r.clerkUserId),
  }));
}

async function measure(exec: Executor, scope: OwnerScope) {
  const counts: { table: string; rows: number }[] = [];
  for (const g of HOUSEHOLD_GRAPH) {
    counts.push({
      table: graphTableName(g.table),
      rows: await countRows(exec, g.table, g.householdRows(scope)),
    });
  }
  return {
    counts,
    preflights: await householdPreflights(exec, scope),
    members: await members(exec, scope),
  };
}

const totalOf = (counts: readonly { rows: number }[]) => counts.reduce((n, c) => n + c.rows, 0);

/** The column that names a row's household, where the table has one (the household row: its id). */
function householdColumn(t: GraphTable): PgColumn | null {
  if (t === schema.households) return schema.households.id;
  return 'householdId' in t ? (t.householdId as PgColumn) : null;
}

/** Erase one household (or, with `apply: false`, report what would be erased). See the module doc. */
export async function eraseHousehold(
  exec: Executor,
  scope: OwnerScope,
  { apply }: { apply: boolean },
): Promise<ErasureReport> {
  if (!apply) {
    if (!(await householdExists(exec, scope))) throw new ErasureTargetNotFound();
    const m = await measure(exec, scope);
    return { applied: false, ...m, total: totalOf(m.counts), restorePoint: null };
  }

  return exec.transaction(async (tx) => {
    await setLocalTimeouts(tx, '60s');
    const [point] = rowsOf<{ at: string; lsn: string }>(
      await tx.execute(sql`SELECT now()::text AS at, pg_current_wal_lsn()::text AS lsn`),
    );

    // 1 · Lock every parent row of H, in LOCK_ORDER, each table in id order.
    for (const t of LOCK_ORDER) {
      await tx.execute(
        sql`SELECT ${t.id} FROM ${t} WHERE ${householdRowsOf(t, scope)} ORDER BY ${t.id} FOR UPDATE`,
      );
    }
    if (!(await householdExists(tx, scope))) throw new ErasureTargetNotFound();
    const [{ id: householdId }] = rowsOf<{ id: number }>(
      await tx.execute(
        sql`SELECT ${schema.households.id} AS id FROM ${schema.households} WHERE ${householdRowsOf(schema.households, scope)}`,
      ),
    );

    // 2 · The pre-flights, under the locks, and the counts the deletes must match.
    const m = await measure(tx, scope);
    for (const check of PREFLIGHT_CHECKS) {
      if (m.preflights[check] !== 0) throw new ErasurePreflightRefused(check, m.preflights[check]);
    }

    // 3 · Delete in graph order. Each RETURNING length must equal its count, and every returned row
    // that names a household must name H (a widened predicate would otherwise erase another
    // family's row, or a global movement, and report it as H's).
    const deleted: { table: string; rows: number }[] = [];
    for (const [i, g] of HOUSEHOLD_GRAPH.entries()) {
      const owner = householdColumn(g.table);
      const gone = rowsOf<{ id: number; hh: number | string | null }>(
        await tx.execute(
          sql`DELETE FROM ${g.table} WHERE ${g.householdRows(scope)} RETURNING ${g.table.id} AS id, ${owner ?? sql`NULL`} AS hh`,
        ),
      );
      if (owner && gone.some((r) => Number(r.hh) !== Number(householdId))) {
        throw new ErasureForeignRow(m.counts[i].table);
      }
      if (gone.length !== m.counts[i].rows) {
        throw new ErasureCountMismatch(m.counts[i].table, m.counts[i].rows, gone.length);
      }
      deleted.push({ table: m.counts[i].table, rows: gone.length });
    }

    return {
      applied: true,
      counts: deleted,
      total: totalOf(deleted),
      preflights: m.preflights,
      members: m.members,
      restorePoint: { at: point.at, walLsn: point.lsn },
    };
  });
}
