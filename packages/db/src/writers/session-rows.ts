import { newId } from '@mat-plan/shared';
import { and, eq, isNull } from 'drizzle-orm';

import { schema } from '../client';
import type { Executor } from './executor';

/**
 * Session-graph row helpers shared by more than one writer (FAM-1 step 11a).
 *
 * Moved verbatim out of `strength-session.ts` so the FAM-1 row writer (11b, `writers/day/log-row.ts`)
 * can reuse them instead of writing a second copy. Nothing here changed behaviour in the move; the
 * strength proofs in `db:verify` are the evidence.
 *
 * ⚠️ Not re-exported from `src/index.ts`. Each helper is a piece of a transaction, and a caller
 * outside `writers/` would be writing half a graph.
 */

/** The three graph tables that share the `client_id` + `deleted_at` idempotency shape. */
export type GraphTable = typeof schema.sessions | typeof schema.supersets | typeof schema.entries;

/**
 * Re-select a live row by its `client_id` after an ON-CONFLICT no-op (a replay). The **`deleted_at
 * IS NULL` guard is load-bearing**, and since **V1-9b B0** it is load-bearing for the opposite
 * reason to the one originally written here.
 *
 * It used to read: *"the partial UNIQUE lets a soft-deleted row share the client_id, so an unguarded
 * re-select could return the dead row"*. B0 made these arbiters non-partial, so a hidden row no
 * longer shares the id — it **holds** it. The guard now matters because a conflict can be with a
 * HIDDEN row, and an unguarded re-select would return that row's id and attach children to a dead
 * parent. Either way the guard stays, which is why B0 changes no code here.
 *
 * ⚠️ The throw is the behaviour `db:verify`'s B0 case asserts: replaying a hidden write is a
 * REFUSAL, not a twin. `B1-2` owns turning it into a typed envelope; today it reaches `error.tsx`.
 * Extracted so the three graph-row inserts can't drift on this. A SELECT over the table union needs
 * no `as never`.
 */
export async function reselectLiveByClientId(
  exec: Executor,
  table: GraphTable,
  clientId: string,
): Promise<{ id: number; publicId: string }> {
  const [row] = await exec
    .select({ id: table.id, publicId: table.publicId })
    .from(table)
    .where(and(eq(table.clientId, clientId), isNull(table.deletedAt)))
    .limit(1);
  // The re-select follows an ON-CONFLICT no-op, so a live row should exist. If it doesn't (e.g. the row
  // was soft-deleted between the conflict and this SELECT), fail with a clear error rather than let a
  // caller crash on `.id` of undefined — keeps the non-null return contract honest.
  if (!row) throw new Error(`no live row for client_id ${clientId}`);
  return row;
}

/**
 * Insert a `supersets` grouping row, idempotent by `client_id` (the `insertStrengthSessionRow` twin).
 * Exported to this directory only (never from the package index): `writeStrengthSession` calls it
 * inside its transaction, and FAM-1 11b's row writer is the second intended caller. On a replay,
 * re-selects the live row.
 */
export async function insertSupersetRow(
  exec: Executor,
  args: { sessionId: number; clientId: string; label?: string },
): Promise<{ id: number }> {
  const [row] = await exec
    .insert(schema.supersets)
    .values({
      publicId: newId(),
      clientId: args.clientId,
      sessionId: args.sessionId,
      label: args.label ?? null,
    })
    .onConflictDoNothing({
      target: schema.supersets.clientId,
      where: isNull(schema.supersets.deletedAt),
    })
    .returning({ id: schema.supersets.id });
  return row ?? reselectLiveByClientId(exec, schema.supersets, args.clientId);
}
