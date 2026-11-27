import { type ExtractTablesWithRelations, type SQL, sql } from 'drizzle-orm';
import type { NodePgDatabase, NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgTransaction } from 'drizzle-orm/pg-core';

import type { Schema } from '../client';

/**
 * A db handle or an open transaction — both satisfy the query-builder surface the writers use.
 *
 * Lifted out of the legacy strength writer (V1-24 PR 1b; deleted since, LEGACY-1) when
 * `ownership.ts` needed it: an *ownership* helper importing from a writer would invert the
 * dependency, since ownership is the lower-level concern. Type-only, so it adds no runtime edge.
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
 * transaction, so inside a caller's transaction (a savepoint) it outlives a RELEASED savepoint (a
 * rolled-back one reverts it). ⚠️ Outside a transaction `set_config(…, true)` is a silent no-op, so
 * the helper reads the setting back in a second statement and throws if it did not hold: a guarded
 * write that forgot `db.transaction` fails loudly instead of running with no timeouts.
 */
export const LOCK_TIMEOUT = '5s';
export async function setLocalTimeouts(tx: Reads, statementTimeout: '30s' | '60s'): Promise<void> {
  await tx.execute(
    sql`SELECT set_config('lock_timeout', ${LOCK_TIMEOUT}, true), set_config('statement_timeout', ${statementTimeout}, true)`,
  );
  // Compared as intervals: Postgres displays '60s' as '1min'.
  const [held] = rowsOf<{ ok: boolean }>(
    await tx.execute(
      sql`SELECT current_setting('lock_timeout')::interval = ${LOCK_TIMEOUT}::interval
          AND current_setting('statement_timeout')::interval = ${statementTimeout}::interval AS ok`,
    ),
  );
  if (held?.ok !== true) {
    throw new Error('setLocalTimeouts: the timeouts did not hold; call it inside a transaction');
  }
}

/**
 * `lock_timeout` alone, for a request write that waits on an advisory lock (`ADVISORY_LOCK`) before
 * it counts: `newItem` and `createProfile`; and for `clearDay`, which waits on a row lock (the
 * profile `FOR SHARE`, then the day's entries). Without it a second request queued behind a lock that is
 * never released (a stuck transaction) waits until the platform kills the function; with it, the
 * wait ends after `LOCK_TIMEOUT` as a thrown 55P03, which reaches `error.tsx` like any other throw.
 * ⚠️ It bounds every LATER lock wait in the same transaction too, not only the advisory lock: the
 * insert's foreign-key `KEY SHARE` on `households` now waits at most `LOCK_TIMEOUT` behind an
 * erasure's `FOR UPDATE`. Both callers read the household row `FOR KEY SHARE` first, so an add during an
 * erasure waits at that read and answers `not_found` (`newItem`) or `refused` (`createProfile`), or
 * 55P03 past `LOCK_TIMEOUT`.
 * Inside a caller's own transaction it lasts to that transaction's end (no real caller passes one).
 *
 * No read-back, unlike `setLocalTimeouts`: every caller runs it as the first statement of their own
 * `exec.transaction`, which the lock right after it needs anyway. The order is pinned from the
 * emitted SQL (`apps/web/lib/dal/profiles.test.ts`, `program/new-item-lock.test.ts`), and
 * `db:verify` checks that each writer sets it (`lockTimeoutSetBy`, mutations 447, 448 and 427).
 */
export async function setLocalLockTimeout(tx: Reads): Promise<void> {
  await tx.execute(sql`SELECT set_config('lock_timeout', ${LOCK_TIMEOUT}, true)`);
}
