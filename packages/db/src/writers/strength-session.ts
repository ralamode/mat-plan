import { newId } from '@mat-plan/shared';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { and, eq, isNull } from 'drizzle-orm';
import type { NodePgDatabase, NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgTransaction } from 'drizzle-orm/pg-core';

import { schema } from '../client';

/**
 * The strength-session write core (V1-8-2), single-sourced HERE in `packages/db` — NOT in the
 * app-side `server-only` DAL — so the app DAL and the `db:verify` proof run the IDENTICAL insert
 * path (the panel B2 fix: a writer in `apps/web/lib/dal` can't be imported by `verify.ts` across
 * the app→packages edge, so it would fork a second writer — the drift this single-sourcing exists
 * to prevent). This is the `weeklyAdherenceRows` "one unit, two consumers" pattern applied to a
 * WRITER: pure Drizzle over the schema, parameterized over a `db | tx` executor, taking
 * PRE-RESOLVED catalog ids (the caller owns `findOrCreateMovementId` / `getActivityTypeIdByKey`,
 * which live app-side). No `server-only`, no app imports.
 */

/** A db handle or an open transaction — both satisfy the query-builder surface the helpers use. */
type Executor =
  | NodePgDatabase<typeof schema>
  | PgTransaction<NodePgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;

export type SessionMovementInput = {
  movementName: string;
  unit: string;
  movementId: number; // resolved by the caller (findOrCreateMovementId)
  clientId: string; // per-movement entry idempotency key
  sets: readonly { reps: number; weight: number }[];
};

/**
 * Insert the parent `sessions` row, idempotent by `client_id` (partial UNIQUE). On conflict the
 * row already exists (a replay) → re-select its id/public_id so members attach to it. `status` is
 * omitted → the column default ('done'); `sessionType` is the caller's (a sourced const, never a
 * re-typed literal).
 */
export async function insertStrengthSessionRow(
  exec: Executor,
  args: { profileId: number; day: string; sessionType: string; clientId: string },
): Promise<{ id: number; publicId: string }> {
  const [row] = await exec
    .insert(schema.sessions)
    .values({
      publicId: newId(),
      clientId: args.clientId,
      profileId: args.profileId,
      activityDate: args.day,
      sessionType: args.sessionType,
    })
    .onConflictDoNothing({
      target: schema.sessions.clientId,
      where: isNull(schema.sessions.deletedAt),
    })
    .returning({ id: schema.sessions.id, publicId: schema.sessions.publicId });
  if (row) return row;

  const [existing] = await exec
    .select({ id: schema.sessions.id, publicId: schema.sessions.publicId })
    .from(schema.sessions)
    .where(eq(schema.sessions.clientId, args.clientId))
    .limit(1);
  return existing;
}

/**
 * Write ONE session movement: its `entry` + N `entry_set` rows. Idempotent by the entry's
 * `client_id` — a replay finds the existing entry and returns it WITHOUT re-inserting sets (so a
 * retry never doubles them). The member is written in the DECOUPLED forward shape (`kind` NULL +
 * `movement_name` + `movement_id`, `metric_key` unset) — it passes `entries_shape_check` (branch 2
 * is NULL, whole CHECK NULL → passes) and the at-most-one `entries_value_source_check`, and stops
 * feeding the V1-1d `kind` drop (panel R5/F2). `activity_type_id` is set (NOT-NULL CHECK).
 * `superset_id`/`superset_order` default NULL here; V1-8-3 passes them for the superset branch —
 * the same writer, not a fork.
 */
export async function writeSessionStrengthEntry(
  exec: Executor,
  args: {
    profileId: number;
    sessionId: number;
    movementId: number;
    movementName: string;
    unit: string;
    activityTypeId: number;
    day: string;
    clientId: string;
    sets: readonly { reps: number; weight: number }[];
    supersetId?: number | null;
    supersetOrder?: number | null;
  },
): Promise<{ id: number; publicId: string; created: boolean }> {
  const [entry] = await exec
    .insert(schema.entries)
    .values({
      publicId: newId(),
      clientId: args.clientId,
      profileId: args.profileId,
      activityDate: args.day,
      // kind omitted (NULL) — the decoupled forward shape; movement_name carries the label.
      unit: args.unit,
      movementName: args.movementName,
      activityTypeId: args.activityTypeId,
      movementId: args.movementId,
      sessionId: args.sessionId,
      supersetId: args.supersetId ?? null,
      supersetOrder: args.supersetOrder ?? null,
    })
    .onConflictDoNothing({
      target: schema.entries.clientId,
      where: isNull(schema.entries.deletedAt),
    })
    .returning({ id: schema.entries.id, publicId: schema.entries.publicId });

  // Idempotent replay: the entry already exists — return it, don't re-add sets.
  if (!entry) {
    const [existing] = await exec
      .select({ id: schema.entries.id, publicId: schema.entries.publicId })
      .from(schema.entries)
      .where(eq(schema.entries.clientId, args.clientId))
      .limit(1);
    return { ...existing, created: false };
  }

  if (args.sets.length > 0) {
    await exec.insert(schema.entrySets).values(
      args.sets.map((s, i) => ({
        publicId: newId(),
        clientId: newId(),
        entryId: entry.id,
        idx: i + 1, // 1-based
        reps: s.reps,
        weightNum: String(s.weight), // numeric column takes a string (precision-safe)
      })),
    );
  }

  return { ...entry, created: true };
}

/**
 * Write a whole flat strength session graph in ONE transaction (V1-8-2): the `sessions` row + N
 * movement entries + their sets, per-row `ON CONFLICT DO NOTHING` at EVERY level (no parent
 * short-circuit — a crash after the session commit would otherwise orphan it; master R7). A full
 * replay dedupes row-by-row; a replay that adds a NEW movement attaches it to the RE-SELECTED
 * session id. The profile is resolved by `public_id` inside the tx (the F7 seam — never a raw
 * internal id from the request). Catalog ids (`activityTypeId`, each `movementId`) are resolved by
 * the caller and passed in. Returns the session's `public_id`.
 */
export async function writeStrengthSession(
  db: NodePgDatabase<typeof schema>,
  args: {
    profilePublicId: string;
    day: string;
    sessionType: string;
    sessionClientId: string;
    activityTypeId: number;
    movements: readonly SessionMovementInput[];
  },
): Promise<{ sessionId: string }> {
  return db.transaction(async (tx) => {
    const [profile] = await tx
      .select({ id: schema.profiles.id })
      .from(schema.profiles)
      .where(
        and(eq(schema.profiles.publicId, args.profilePublicId), isNull(schema.profiles.deletedAt)),
      )
      .limit(1);
    if (!profile) throw new Error('Profile not found');

    const session = await insertStrengthSessionRow(tx, {
      profileId: profile.id,
      day: args.day,
      sessionType: args.sessionType,
      clientId: args.sessionClientId,
    });

    for (const m of args.movements) {
      await writeSessionStrengthEntry(tx, {
        profileId: profile.id,
        sessionId: session.id,
        movementId: m.movementId,
        movementName: m.movementName,
        unit: m.unit,
        activityTypeId: args.activityTypeId,
        day: args.day,
        clientId: m.clientId,
        sets: m.sets,
      });
    }

    return { sessionId: session.publicId };
  });
}
