import {
  ENTRY_STATUS,
  newId,
  type MovementStatus,
  QUANTITY_SLOT,
  type StrengthSetInput,
  type Unit,
  UNIT_DIMENSION,
  UNIT_DIMENSION_BY_CODE,
} from '@mat-plan/shared';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { Schema } from '../client';
import { schema } from '../client';
import type { Executor } from './executor';
import type { HouseholdScope } from '../scope';
import { isLiveProfile, ownedEntryIds } from './ownership';

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
  // GAP-3: narrowed from `string`. The unit is now written onto every PRIMARY quantity row and must
  // resolve to a dimension, so an unknown code has to fail at compile time, not at the FK.
  unit: Unit;
  movementId: number;
  clientId: string; // per-movement entry idempotency key
  sets: readonly StrengthSetInput[];
  // GAP-1 P1-1a. Optional so every existing caller (and `db:verify`'s bare fixtures) keeps compiling
  // and keeps taking the column default — see `writeSessionStrengthEntry` for why that matters.
  status?: MovementStatus;
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
  args: {
    profileId: number;
    day: string;
    sessionType: string;
    clientId: string;
    feel?: string;
    dayRole?: string;
  },
): Promise<{ id: number; publicId: string }> {
  const [row] = await exec
    .insert(schema.sessions)
    .values({
      publicId: newId(),
      clientId: args.clientId,
      profileId: args.profileId,
      activityDate: args.day,
      sessionType: args.sessionType,
      // Write-once at creation, exactly like `feel`: the ON CONFLICT below no-ops on replay, so a
      // corrected role resubmitted under the same client_id is silently ignored (GAP-1 P0-1).
      dayRole: args.dayRole ?? null,
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
    unit: Unit; // GAP-3: narrowed from `string` — it now indexes UNIT_DIMENSION_BY_CODE
    activityTypeId: number;
    day: string;
    clientId: string;
    // `weight` is optional here though the schema always emits it — direct callers omit it.
    sets: readonly (Omit<StrengthSetInput, 'weight'> & { weight?: number | null })[];
    status?: MovementStatus;
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
      // GAP-1 P1-1a. SPREAD, not `status: args.status ?? 'done'` — when the caller says nothing the
      // column is OMITTED from the INSERT and Postgres applies its own `.notNull().default('done')`.
      // That keeps the `done` path byte-identical (one default, in the DB, not forked into the writer)
      // and means every pre-existing caller writes exactly the row it wrote before.
      ...(args.status !== undefined ? { status: args.status } : {}),
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
    // GAP-3: the SET row now carries only reps, status and the two qualitative booleans; every
    // measured quantity is a child row written below. `weight_num`/`weight_label` are gone.
    const setRows = await exec
      .insert(schema.entrySets)
      .values(
        args.sets.map((s, i) => ({
          publicId: newId(),
          clientId: newId(),
          entryId: entry.id,
          idx: i + 1, // 1-based
          reps: s.reps,
          // `bodyweight`/`band` are MODES, not quantities (GAP-3 §7.2b) — booleans, and omitted when
          // false so Postgres applies its own default and the row stays byte-minimal.
          ...(s.isBodyweight ? { isBodyweight: true } : {}),
          ...(s.isBand ? { isBand: true } : {}),
          // GAP-1 P1-1b — same omitted-takes-the-DB-default idiom as the entry's status. A `done` set
          // omits the column entirely, so every pre-existing caller writes a byte-identical row.
          ...('status' in s && s.status !== undefined ? { status: s.status } : {}),
        })),
      )
      .returning({ id: schema.entrySets.id });

    // One PRIMARY quantity per set that carries a magnitude.
    //
    // The unit comes from the MOVEMENT, and the dimension is derived from that unit rather than
    // assumed: since PR 4a the movement may be logged in `in` (a box jump) or `sec` (a hold), not only
    // `lb`/`kg`. Deriving keeps the pair consistent with `units(code, dimension)`, which the composite
    // FK checks — a hard-coded `'mass'` here would be an FK violation surfacing as a 500 on a gym
    // floor. Census §4.6 is why the unit is not on the value: "weight units are never written", so a
    // bare `185` means 185 of whatever this movement is logged in.
    //
    // A set with no magnitude (pure bodyweight, or a band) writes NO quantity row — a mode is not a
    // measurement, and a row with a NULL value would be the EAV smell the child table avoids.
    const quantityRows: (typeof schema.entrySetQuantities.$inferInsert)[] = [];
    args.sets.forEach((s, i) => {
      // `=== null` is not enough: the SCHEMA always emits `weight: null`, but the relaxed inner
      // signature above lets a direct caller (a future importer) omit the key entirely, so handle
      // both. Until DX-7 this was the ONLY thing standing between an omission and
      // `numeric: "undefined"` from Postgres, because `packages/db` was typechecked by nothing; the
      // package now has its own `tsconfig.json` in `pnpm typecheck`, so an omission through the
      // public `writeStrengthSession` is a compile error. This stays as the inner guard.
      if (s.weight === null || s.weight === undefined) return;
      quantityRows.push({
        clientId: newId(),
        entrySetId: setRows[i].id,
        slot: QUANTITY_SLOT.primary,
        dimension: UNIT_DIMENSION_BY_CODE[args.unit],
        unit: args.unit,
        valueNum: String(s.weight), // numeric column takes a string (precision-safe)
      });
    });

    if (quantityRows.length > 0) {
      await exec.insert(schema.entrySetQuantities).values(quantityRows);
    }
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
 *
 * **TEN-1 1c: that in-transaction resolve is household-scoped.** It now runs the single-sourced
 * `isLiveProfile(publicId, scope)` rather than its own `and(eq(publicId, …), isNull(deletedAt))`
 * copy, so a profile outside `scope` resolves to nothing and the whole transaction throws
 * `Profile not found` — the same shape a soft-deleted or unknown profile already got, with nothing
 * written. The scope is **required**: an unconverted caller is a compile error, which is the only
 * mechanism that makes a sweep this wide safe (the plan's §Design 1). `db:verify`'s TEN-1 write
 * matrix proves the refusal in both directions and asserts the rollback left no session row.
 */
export async function writeStrengthSession(
  db: NodePgDatabase<Schema>,
  args: {
    profilePublicId: string;
    /** TEN-1: the household this request is authorized for. The third conjunct of `isLiveProfile`. */
    scope: HouseholdScope;
    day: string;
    sessionType: string;
    sessionClientId: string;
    activityTypeId: number;
    feel?: string;
    /** GAP-1 P0-1: the programmed day the athlete ASSERTED (never derived here). */
    dayRole?: string;
    supersets?: readonly { clientId: string; label?: string }[];
    movements: readonly ResolvedSessionMovement[];
  },
): Promise<{ sessionId: string }> {
  return db.transaction(async (tx) => {
    const [profile] = await tx
      .select({ id: schema.profiles.id })
      .from(schema.profiles)
      .where(isLiveProfile(args.profilePublicId, args.scope))
      .limit(1);
    if (!profile) throw new Error('Profile not found');

    const session = await insertStrengthSessionRow(tx, {
      profileId: profile.id,
      day: args.day,
      sessionType: args.sessionType,
      clientId: args.sessionClientId,
      feel: args.feel,
      dayRole: args.dayRole,
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
        status: m.status,
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
 * The WHERE also enforces, server-side, the SAME "numeric AND done set only" invariant the client's
 * `isEditableSet` uses — never trusting the client. Without the numeric half a crafted POST could set a
 * weight on a bodyweight/band or duration set, producing a bogus read line. Without the **status** half
 * (GAP-1 P1-1b) it could edit a `sub_failure` set's reps and leave the status behind, so the row would
 * export as `sub-failure` while claiming reps it never achieved. Such a set matches no row → `null` →
 * typed error, exactly like a wrong-owner id. **Keep these guards identical to `isEditableSet`'s** —
 * that is the whole contract; the client half is advisory, this one is the boundary.
 *
 * ⚠️ **GAP-3 made this a TRANSACTION, and that is a real change to this function's contract.** It was
 * "a single atomic UPDATE — NO `db.transaction`", which was true while the weight lived in a column on
 * the row being guarded. The weight is now a CHILD row, so reps and weight are two statements and only
 * a transaction keeps them atomic — without one, a crash between them leaves a set whose reps were
 * corrected and whose weight was not. The ownership proof also grew a level
 * (`profiles → entries → entry_sets → entry_set_quantities`), which is why the child UPDATE is keyed on
 * the id RETURNED by the guarded parent UPDATE rather than re-deriving ownership itself.
 *
 * Returns the edited set's `public_id`, or `null` when the guarded WHERE matched no row (wrong owner, a
 * stale/deleted set id, or a non-numeric set) — an EXPECTED outcome the caller maps to a typed error.
 *
 * LWW: `updated_at` advances to the DB `now()` (the transaction clock). The offline path's
 * client-supplied-timestamp compare (`setWhere incoming >= stored`) lands at v1.5 — see docs/tech-debt.md.
 */
export async function updateStrengthSetById(
  exec: Executor,
  args: {
    profilePublicId: string;
    setId: string;
    reps: number;
    weight: number;
    /** TEN-1: the household this request is authorized for. Rides into `ownedEntryIds`. */
    scope: HouseholdScope;
  },
): Promise<{ publicId: string } | null> {
  // The internal ids of entries owned by this live profile. Drizzle `update()` can't JOIN, so the
  // parent-ownership proof rides in the WHERE via `inArray(entry_id, <this select>)` (no sql.raw).
  // V1-24 PR 1b lifted this into `ownership.ts` when the bodyweight amend needed the identical
  // subselect — a security predicate with two callers is exactly what must not be copy-pasted.
  const owned = ownedEntryIds(exec, args.profilePublicId, args.scope);

  // GAP-3: the editable shape is "carries exactly one live PRIMARY MASS quantity". This replaces the
  // old `weight_num IS NOT NULL` guard — a set whose primary quantity is a LENGTH (a box jump) or a
  // TIME (a hold) is not numerically editable by this endpoint, exactly as a labeled set wasn't.
  const numericallyLoadedSetIds = exec
    .select({ id: schema.entrySetQuantities.entrySetId })
    .from(schema.entrySetQuantities)
    .where(
      and(
        eq(schema.entrySetQuantities.slot, QUANTITY_SLOT.primary),
        eq(schema.entrySetQuantities.dimension, UNIT_DIMENSION.mass),
        isNull(schema.entrySetQuantities.deletedAt),
      ),
    );

  return exec.transaction(async (tx) => {
    const rows = await tx
      .update(schema.entrySets)
      .set({
        reps: args.reps,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(schema.entrySets.publicId, args.setId),
          isNull(schema.entrySets.deletedAt),
          // Server-side "numeric set only" guard — mirrors the client's isEditableSet, so a
          // bodyweight/band or non-mass set can't be edited into an inconsistent shape by a crafted POST.
          eq(schema.entrySets.isBodyweight, false),
          eq(schema.entrySets.isBand, false),
          isNotNull(schema.entrySets.reps),
          inArray(schema.entrySets.id, numericallyLoadedSetIds),
          // GAP-1 P1-1b (BUG-2a) — and "done only". A `sub_failure` set is NUMERIC, so every guard above
          // passes it: editing its reps 3 → 5 would silently leave `status = 'sub_failure'` behind, and
          // the row would still export as `sub-failure` while claiming reps it no longer had. Correcting
          // a sub-failure set means changing its STATUS, which this endpoint cannot do — so it refuses
          // the row rather than half-editing it. Mirrors `isEditableSet`; the client guard is advisory
          // (a crafted POST is the real threat), which is why both halves exist and must stay identical.
          eq(schema.entrySets.status, ENTRY_STATUS.done),
          inArray(schema.entrySets.entryId, owned),
        ),
      )
      .returning({ id: schema.entrySets.id, publicId: schema.entrySets.publicId });

    const row = rows[0];
    // zero rows = the ownership/live/shape guard tripped → caller returns a typed error. Returning
    // BEFORE the child write is what makes the guard cover the weight too: the quantity UPDATE below
    // is reachable only through a parent row that already passed every ownership and shape check.
    if (!row) return null;

    await tx
      .update(schema.entrySetQuantities)
      .set({ valueNum: String(args.weight), updatedAt: sql`now()` }) // precision-safe string
      .where(
        and(
          eq(schema.entrySetQuantities.entrySetId, row.id),
          eq(schema.entrySetQuantities.slot, QUANTITY_SLOT.primary),
          eq(schema.entrySetQuantities.dimension, UNIT_DIMENSION.mass),
          isNull(schema.entrySetQuantities.deletedAt),
        ),
      );

    return { publicId: row.publicId };
  });
}
