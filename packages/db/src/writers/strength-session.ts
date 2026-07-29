import { newId } from '@mat-plan/shared';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
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

/** The three graph tables that share the `client_id` + `deleted_at` idempotency shape. */
type GraphTable = typeof schema.sessions | typeof schema.supersets | typeof schema.entries;

/**
 * Re-select a live row by its `client_id` after an ON-CONFLICT no-op (a replay). The **`deleted_at
 * IS NULL` guard is load-bearing** — the partial UNIQUE lets a soft-deleted row share the client_id,
 * so an unguarded re-select could return the dead row and attach children to it. Extracted so the
 * three graph-row inserts can't drift on this (verify.ts's `upsertReturningId` dropped the guard —
 * that shortcut must NOT reach production). A SELECT over the table union needs no `as never`.
 */
async function reselectLiveByClientId(
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
 * A session movement with its catalog `movementId` already resolved (the caller owns
 * `findOrCreateMovementId`). Named distinctly from `@mat-plan/shared`'s `SessionMovementInput`
 * (the pre-resolution wire shape, no `movementId`) so importing both never collides.
 * `supersetClientId` is deliberately the UN-resolved wire key (unlike `movementId`): the `supersets`
 * row doesn't exist until the tx, so `writeStrengthSession` resolves it to a `superset_id` in-tx.
 */
export type ResolvedSessionMovement = {
  movementName: string;
  unit: string;
  movementId: number;
  clientId: string; // per-movement entry idempotency key
  sets: readonly { reps: number; weight: number }[];
  supersetClientId?: string;
  supersetOrder?: number;
};

/**
 * Insert the parent `sessions` row, idempotent by `client_id` (partial UNIQUE). On conflict the
 * row already exists (a replay) → re-select its id/public_id so members attach to it. `status` is
 * omitted → the column default ('done'); `sessionType` is the caller's (a sourced const, never a
 * re-typed literal). NOT exported — reached only via the transactional `writeStrengthSession` wrapper,
 * so the whole graph stays all-or-nothing.
 */
async function insertStrengthSessionRow(
  exec: Executor,
  args: { profileId: number; day: string; sessionType: string; clientId: string; feel?: string },
): Promise<{ id: number; publicId: string }> {
  const [row] = await exec
    .insert(schema.sessions)
    .values({
      publicId: newId(),
      clientId: args.clientId,
      profileId: args.profileId,
      activityDate: args.day,
      sessionType: args.sessionType,
      feel: args.feel ?? null, // write-once at creation (onConflictDoNothing → replay never updates it)
    })
    .onConflictDoNothing({
      target: schema.sessions.clientId,
      where: isNull(schema.sessions.deletedAt),
    })
    .returning({ id: schema.sessions.id, publicId: schema.sessions.publicId });
  // On conflict (a replay) re-select the LIVE row (the deleted_at-guarded helper).
  return row ?? reselectLiveByClientId(exec, schema.sessions, args.clientId);
}

/**
 * Insert a `supersets` grouping row, idempotent by `client_id` (the `insertStrengthSessionRow` twin).
 * NOT exported — reached only via `writeStrengthSession`'s tx. On a replay, re-selects the live row.
 */
async function insertSupersetRow(
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

/**
 * Write ONE session movement: its `entry` + N `entry_set` rows. Idempotent by the entry's
 * `client_id` — a replay finds the existing entry and returns it WITHOUT re-inserting sets (so a
 * retry never doubles them). The member is written in the DECOUPLED forward shape (`kind` NULL +
 * `movement_name` + `movement_id`, `metric_key` unset) — it passes `entries_shape_check` (branch 2
 * is NULL, whole CHECK NULL → passes) and the at-most-one `entries_value_source_check`, and stops
 * feeding the V1-1d `kind` drop (panel R5/F2). `activity_type_id` is set (NOT-NULL CHECK).
 * `superset_id`/`superset_order` are passed by `writeStrengthSession`'s superset branch (V1-8-3c) —
 * the same writer, not a fork. NOT exported — reached only via `writeStrengthSession`'s tx.
 */
async function writeSessionStrengthEntry(
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

  // Idempotent replay: the entry already exists — return it, don't re-add sets (the deleted_at-guarded
  // re-select, so a soft-deleted row sharing this client_id is never returned).
  if (!entry) {
    return {
      ...(await reselectLiveByClientId(exec, schema.entries, args.clientId)),
      created: false,
    };
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
    feel?: string;
    supersets?: readonly { clientId: string; label?: string }[];
    movements: readonly ResolvedSessionMovement[];
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
      feel: args.feel,
    });

    // Create the supersets FIRST (before the members) so the client_id → superset_id map holds real ids
    // to stamp onto members. Scoped to THIS session's supersets → no cross-session leak (ADR-0003 R2).
    const supersetIdByClientId = new Map<string, number>();
    for (const s of args.supersets ?? []) {
      const superset = await insertSupersetRow(tx, {
        sessionId: session.id,
        clientId: s.clientId,
        label: s.label,
      });
      supersetIdByClientId.set(s.clientId, superset.id);
    }

    for (const m of args.movements) {
      let supersetId: number | null = null;
      if (m.supersetClientId != null) {
        const resolved = supersetIdByClientId.get(m.supersetClientId);
        // A dangling superset ref reaches here only via a schema-less caller (verify.ts / future) — the
        // app boundary's `membership` superRefine catches it. Throw so it's a clear error, not a
        // silent superset_id=null + superset_order set → a raw entries_superset_order_check violation.
        if (resolved === undefined) {
          throw new Error(`superset not found for clientId ${m.supersetClientId}`);
        }
        supersetId = resolved;
      }
      // Pairing guard: `superset_id` and `superset_order` must be both-set or both-null, or the entry
      // violates `entries_superset_order_check`. The app boundary's pairing superRefine enforces this,
      // but a schema-less caller (verify.ts / future) bypasses zod — throw a clear error, not a raw 500.
      if ((supersetId != null) !== (m.supersetOrder != null)) {
        throw new Error('a superset member needs both a superset id and an order');
      }
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
        supersetId,
        supersetOrder: m.supersetOrder ?? null,
      });
    }

    return { sessionId: session.publicId };
  });
}

/**
 * Edit ONE already-logged strength set's `reps` + `weight` (V1-9 fix-a-set), single-sourced HERE so the
 * app DAL and `db:verify` prove the IDENTICAL ownership guard. The set is addressed by its `public_id`,
 * but the WHERE also proves the set's parent `entry` belongs to the LIVE profile named by `public_id` —
 * the BOLA/IDOR guard lives inside this writer (never trusting a raw internal id from the caller), the
 * same seam as `writeStrengthSession`'s in-tx profile resolve. `deleted_at IS NULL` at set + entry +
 * profile so a soft-deleted set/entry/profile (post-V1-9b) is never edited. Only `reps` + `weight_num`
 * change; `idx` (the `uq_entry_sets_entry_idx` slot) is untouched, so no unique/CHECK is disturbed.
 *
 * The WHERE also enforces, server-side, the SAME "numeric set only" invariant the client's `isEditableSet`
 * uses (`weight_label IS NULL AND reps/weight_num NOT NULL`) — never trusting the client. Without it a
 * crafted POST could set `weight_num` on a labeled ('BW'/'50ft') or timing (seconds-only) set, leaving
 * `weight_num` coexisting with `weight_label`/`seconds` — a masked or bogus read line. Such a set matches
 * no row → `null` → typed error, exactly like a wrong-owner id.
 *
 * A single atomic UPDATE — NO `db.transaction` (that wraps only the multi-row session graph). Returns the
 * edited set's `public_id`, or `null` when the guarded WHERE matched no row (wrong owner, a
 * stale/deleted set id, or a non-numeric set) — an EXPECTED outcome the caller maps to a typed error.
 *
 * LWW: `updated_at` advances to the DB `now()` (the transaction clock). The offline path's
 * client-supplied-timestamp compare (`setWhere incoming >= stored`) lands at v1.5 — see docs/tech-debt.md.
 */
export async function updateStrengthSetById(
  exec: Executor,
  args: { profilePublicId: string; setId: string; reps: number; weight: number },
): Promise<{ publicId: string } | null> {
  // Subquery: the internal ids of entries owned by this live profile. Drizzle `update()` can't JOIN, so
  // the parent-ownership proof rides in the WHERE via `inArray(entry_id, <this select>)` (no sql.raw).
  const ownedEntryIds = exec
    .select({ id: schema.entries.id })
    .from(schema.entries)
    .innerJoin(schema.profiles, eq(schema.entries.profileId, schema.profiles.id))
    .where(
      and(
        eq(schema.profiles.publicId, args.profilePublicId),
        isNull(schema.profiles.deletedAt),
        isNull(schema.entries.deletedAt),
      ),
    );

  const rows = await exec
    .update(schema.entrySets)
    .set({
      reps: args.reps,
      weightNum: String(args.weight), // numeric column takes a precision-safe string (never a JS number)
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(schema.entrySets.publicId, args.setId),
        isNull(schema.entrySets.deletedAt),
        // Server-side "numeric set only" guard — mirrors the client's isEditableSet, so a labeled or
        // timing set can't be edited into an inconsistent shape by a crafted POST.
        isNull(schema.entrySets.weightLabel),
        isNotNull(schema.entrySets.reps),
        isNotNull(schema.entrySets.weightNum),
        inArray(schema.entrySets.entryId, ownedEntryIds),
      ),
    )
    .returning({ publicId: schema.entrySets.publicId });

  return rows[0] ?? null; // zero rows = the ownership/live guard tripped → caller returns a typed error
}
