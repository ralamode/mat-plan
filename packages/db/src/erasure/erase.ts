import { type SQL, sql } from 'drizzle-orm';
import { getTableConfig, type PgColumn, type PgTable } from 'drizzle-orm/pg-core';

import * as schema from '../schema';
import type { OwnerScope } from '../scope';
import type { Executor } from '../writers/executor';
import { movementIsGlobal } from '../writers/ownership';
import { graphTableName, HOUSEHOLD_GRAPH } from './graph';
import { householdPreflights, PREFLIGHT_CHECKS, type PreflightCheck } from './preflight';

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
 *             SET LOCAL lock_timeout '5s'; SET LOCAL statement_timeout '60s'
 *             now(), pg_current_wal_lsn()                       (the restore point, reported)
 *             SELECT … FOR UPDATE on every PARENT_TABLES row of H, in LOCK_ORDER, id order
 *             the household row exists, or ErasureTargetNotFound
 *             pre-flights (a)–(h), each zero, or ErasurePreflightRefused { check }
 *             count every graph table (count()::int)
 *             DELETE … RETURNING id in graph order; each RETURNING length = its count
 *             the global movements' count is unchanged)
 * ```
 *
 * **It runs inside a caller's transaction, and never commits one.** It opens its work with
 * `exec.transaction(…)`. Given a database handle that is a transaction of its own, committed when the
 * core returns. Given an open transaction (`CAT-3` R0 passes its `tx`), drizzle makes it a
 * **SAVEPOINT**: the core's work is released into the caller's transaction and commits only when the
 * caller's does, so a caller that compares the returned `total` with an expected one and throws
 * rolls the whole erasure back. A refusal inside the core rolls back to the savepoint and rethrows;
 * the caller's transaction is left usable. ⚠️ The `SET LOCAL` timeouts then last until the CALLER's
 * transaction ends, not only the core's work.
 *
 * **What it returns:** the per-table counts in graph order (rows that would be erased on a dry run,
 * rows erased under `apply`), their total, the pre-flight counts, and the household's Clerk user ids,
 * each marked `liveElsewhere` when that account holds a live membership in another household (that
 * account must NOT be deleted at Clerk: PR 2b's checklist). 🔴 The report holds Clerk ids; a caller
 * that prints it decides what is safe to print (R0 prints counts only).
 *
 * 🔴 **The lock order, which is what keeps it from deadlocking against the program writers.** The
 * assignment writers (`writers/program/assign.ts`, lane guide invariant 12) lock the program first
 * (`program_blocks`, `FOR NO KEY UPDATE`), then the athletes (`profiles`, in id order). A core that
 * took the athletes first could hold a profile one of them waits on while waiting on its block:
 * `40P01`. So `LOCK_ORDER` is H's `program_blocks` rows FIRST, then H's `profiles`, then the other
 * `PARENT_TABLES` parent before child; every table's rows in id order. `db:verify` pins the order and
 * the mode from this file's source (PGlite has one connection, so no proof can show a wait).
 *
 * **Why `FOR UPDATE`, not `FOR NO KEY UPDATE`.** An insert of a child row takes `FOR KEY SHARE` on the
 * parent it references; only `FOR UPDATE` conflicts with it. So once the parents are locked, no new
 * row can come to reference H's rows (a straddling row written after the pre-flights would otherwise
 * be deleted, nulled or aborted on) until the transaction ends. A deadlock or `lock_timeout` aborts
 * the whole erasure; the operator re-runs the dry run.
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

/** A `DELETE`'s `RETURNING` length differed from its count, or a global movement changed. */
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

export type ErasureReport = {
  readonly applied: boolean;
  /** Graph order. Rows that would be erased (dry run) or that were (apply). */
  readonly counts: readonly { readonly table: string; readonly rows: number }[];
  readonly total: number;
  readonly preflights: Readonly<Record<PreflightCheck, number>>;
  /** 🔴 Personal identifiers (Clerk user ids): for PR 2b's privileged heading only. */
  readonly members: readonly { readonly clerkUserId: string; readonly liveElsewhere: boolean }[];
  /** Under `apply`: the database's clock and WAL position when the transaction began. */
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

/**
 * 🔴 The order the core locks in: `program_blocks`, then `profiles` (the program writers' order),
 * then every other parent, parent before child (reverse graph order).
 */
export const LOCK_ORDER: readonly GraphTable[] = [
  schema.programBlocks,
  schema.profiles,
  ...[...PARENT_TABLES]
    .reverse()
    .filter((t) => t !== schema.programBlocks && t !== schema.profiles),
];

const rowsOf = <T>(res: unknown) => (res as { rows: T[] }).rows;

function householdRowsOf(t: PgTable, scope: OwnerScope): SQL {
  return HOUSEHOLD_GRAPH.find((g) => g.table === t)!.householdRows(scope);
}

async function countRows(exec: Executor, t: GraphTable, where: SQL): Promise<number> {
  return rowsOf<{ n: number }>(
    await exec.execute(sql`SELECT count(*)::int AS n FROM ${t} WHERE ${where}`),
  )[0].n;
}

/** Whether the household row is there. Hidden or live: a hidden household is still erased. */
async function householdExists(exec: Executor, scope: OwnerScope): Promise<boolean> {
  return (await countRows(exec, schema.households, householdRowsOf(schema.households, scope))) > 0;
}

async function globalMovements(exec: Executor): Promise<number> {
  return countRows(exec, schema.movements, movementIsGlobal());
}

/** The household's memberships, hidden ones too, and whether each account is live elsewhere. */
async function members(exec: Executor, scope: OwnerScope): Promise<ErasureReport['members']> {
  const hm = schema.householdMembers;
  const theirs = sql`(SELECT ${hm.id} FROM ${hm} WHERE ${householdRowsOf(hm, scope)})`;
  return rowsOf<{ clerk: string; elsewhere: boolean }>(
    await exec.execute(sql`
      SELECT m.clerk_user_id AS clerk,
             EXISTS (SELECT 1 FROM household_members o
                      WHERE o.clerk_user_id = m.clerk_user_id AND o.deleted_at IS NULL
                        AND o.id NOT IN ${theirs}) AS elsewhere
        FROM household_members m
       WHERE m.id IN ${theirs}
       ORDER BY m.id`),
  ).map((r) => ({ clerkUserId: r.clerk, liveElsewhere: r.elsewhere }));
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
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    await tx.execute(sql`SET LOCAL statement_timeout = '60s'`);
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

    // 2 · The pre-flights, under the locks, and the counts the deletes must match.
    const m = await measure(tx, scope);
    for (const check of PREFLIGHT_CHECKS) {
      if (m.preflights[check] !== 0) throw new ErasurePreflightRefused(check, m.preflights[check]);
    }
    const globalBefore = await globalMovements(tx);

    // 3 · Delete in graph order; each RETURNING length must equal its count.
    const deleted: { table: string; rows: number }[] = [];
    for (const [i, g] of HOUSEHOLD_GRAPH.entries()) {
      const where = g.householdRows(scope);
      const gone = rowsOf<{ id: number }>(
        await tx.execute(sql`DELETE FROM ${g.table} WHERE ${where} RETURNING ${g.table.id}`),
      ).length;
      if (gone !== m.counts[i].rows) {
        throw new ErasureCountMismatch(m.counts[i].table, m.counts[i].rows, gone);
      }
      deleted.push({ table: m.counts[i].table, rows: gone });
    }
    const globalAfter = await globalMovements(tx);
    if (globalAfter !== globalBefore) {
      throw new ErasureCountMismatch('movements (global)', globalBefore, globalAfter);
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
