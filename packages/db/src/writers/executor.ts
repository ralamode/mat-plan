import { type ExtractTablesWithRelations, type SQL, sql } from 'drizzle-orm';
import type { NodePgDatabase, NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgTransaction } from 'drizzle-orm/pg-core';

import type { Schema } from '../client';

/**
 * A db handle or an open transaction — both satisfy the query-builder surface the writers use.
 *
 * Lifted out of `strength-session.ts` (V1-24 PR 1b) when `ownership.ts` needed it: a shared
 * *ownership* helper importing from the *strength* writer would invert the dependency, since
 * ownership is the lower-level concern. Type-only, so it adds no runtime edge.
 */
export type Executor =
  | NodePgDatabase<Schema>
  | PgTransaction<NodePgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

/**
 * Anything that can run a raw query: a db handle, a transaction, or `db:verify`'s PGlite transaction
 * (whose `PgTransaction` is not an `Executor`, see `scripts/verify/harness.ts` → `asTx`). For the
 * read-only helpers that take raw SQL and need nothing else (`src/erasure/`, `queries/movement-ownership.ts`).
 */
export type Reads = { execute: (query: SQL) => Promise<unknown> };

/** The rows of a raw `execute` result, typed by the caller (the cast lives here once). */
export function rowsOf<T>(res: unknown): T[] {
  return (res as { rows: T[] }).rows;
}

/** The `id` column of a raw `execute` result, as numbers. */
export function idsOf(res: unknown): number[] {
  return rowsOf<{ id: number | string }>(res).map((r) => Number(r.id));
}

/**
 * The transaction timeouts every guarded write sets first (a correction, the erasure core): without
 * them a blocked row lock waits forever, since `createDbPool` sets only a connection timeout.
 * `set_config(…, true)` is `SET LOCAL` with a bound value: it lasts until the END of the enclosing
 * transaction, so inside a caller's transaction (a savepoint) it outlives the savepoint.
 */
export const LOCK_TIMEOUT = '5s';
export async function setLocalTimeouts(tx: Reads, statementTimeout: '30s' | '60s'): Promise<void> {
  await tx.execute(
    sql`SELECT set_config('lock_timeout', ${LOCK_TIMEOUT}, true), set_config('statement_timeout', ${statementTimeout}, true)`,
  );
}
