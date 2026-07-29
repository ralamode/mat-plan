import 'server-only';

import { schema, writeStrengthSession } from '@mat-plan/db';
import {
  ENTRY_KIND,
  ENTRY_STATUS,
  newId,
  SEED_ACTIVITY_TYPE_KEYS,
  SEED_METRIC_KEYS,
  type BodyweightUnit,
  type EntryKind,
  type EntryStatus,
  type SessionMovementInput,
  type SessionType,
  type Unit,
} from '@mat-plan/shared';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';

import {
  assertMetricKeyExists,
  findOrCreateMovementId,
  getActivityTypeByKey,
  getActivityTypeIdByKey,
  getMetricDefinition,
} from './catalog';
import { db } from './db';

/**
 * Entry reads for the Today view (V0-7). Scoped by the profile's `public_id`
 * (never a raw internal id from the request) and filtered to a single declared
 * day. Returns DTOs — never raw rows. Ownership/household scoping plugs in here
 * once Clerk lands (V1-1/v1.5).
 */
export type SetDTO = {
  idx: number;
  reps: number | null;
  weight: number | null;
  weightLabel: string | null;
};

export type EntryDTO = {
  id: string; // public_id (UUIDv7)
  // NULLABLE since V1-1c: a check-in carries no legacy `kind` (V1-5 is the first
  // writer to insert NULL). The pre-V1-5 `as EntryKind` cast here was a lie.
  kind: EntryKind | null;
  unit: Unit;
  movementName: string | null;
  value: number | null; // bodyweight value_num; null for strength (values live in sets)
  status: EntryStatus;
  notes: string | null;
  // V1-4 generalized-metric read fields (additive, nullable). Populated via a LEFT
  // JOIN on the entry's metric_definition; NULL on legacy strength / pre-generalized
  // rows. `entryLabel` (lib/entries/entry-label.ts) dispatches on `metricKey`/`valueType`.
  metricKey: string | null;
  metricLabel: string | null;
  valueType: string | null;
  // V1-6a: the metric's rollup rule, carried on the DTO (like `valueType`) so the totals
  // fold dispatches on the model discriminant instead of reaching back into the seed catalog.
  aggregation: string | null;
  // V1-5: the entry's activity, for labelling a "neither-source" check-in (a bare
  // habit has no metric AND no movement, so only the activity names it).
  activityKey: string | null;
  activityLabel: string | null;
  // V1-8-3a: the grouping session (a strength session groups N movement entries). `sessionId` is the
  // session's PUBLIC id (never the internal id — anti-IDOR), NULL for non-session entries; `sessionType`
  // is the raw enum (rendered via SESSION_TYPE_LABELS at the view). `supersetId`/`supersetOrder` are
  // added in V1-8-3b with their bracketing reader — no dead DTO fields here.
  sessionId: string | null;
  // The session's type from a CHECK-constrained column, so it's the SessionType union (not bare
  // string) — the view indexes SESSION_TYPE_LABELS with no cast, and a stray value fails the build.
  sessionType: SessionType | null;
  // V1-8-3b: the optional session "how did it feel?" note, shown in the session-block header. NULL when
  // no feel was logged (the schema normalizes a blank input to NULL) or for non-session entries.
  sessionFeel: string | null;
  sets: SetDTO[]; // strength sets, ordered by idx; empty for bodyweight
};

export async function listEntriesForDay(profilePublicId: string, day: string): Promise<EntryDTO[]> {
  const rows = await db
    .select({
      id: schema.entries.id, // internal — used only to join sets, never returned
      publicId: schema.entries.publicId,
      kind: schema.entries.kind,
      unit: schema.entries.unit,
      movementName: schema.entries.movementName,
      // internal — the set-fetch discriminant (never returned): a set-bearing sc_lift entry is the
      // only row with movement_id. Replaces the `kind === 'strength'` dispatch so V1-8 session
      // members (kind NULL) also fetch their sets, decoupling reads from the V1-1d `kind` drop.
      movementId: schema.entries.movementId,
      valueNum: schema.entries.valueNum,
      status: schema.entries.status,
      notes: schema.entries.notes,
      // V1-4: the joined metric's identity/display. LEFT JOIN so legacy rows with
      // metric_key IS NULL survive; metric_definitions.key is UNIQUE → no fan-out.
      metricKey: schema.entries.metricKey,
      metricLabel: schema.metricDefinitions.label,
      valueType: schema.metricDefinitions.valueType,
      aggregation: schema.metricDefinitions.aggregation,
      // V1-5: joined on the PK → at most one match, so no fan-out; LEFT so any row
      // without an activity_type survives (none today — 0003 CHECKs it NOT NULL).
      activityKey: schema.activityTypes.key,
      activityLabel: schema.activityTypes.label,
      // V1-8-3a: the grouping session's PUBLIC id + type (raw enum). PK join → ≤1 match, no fan-out.
      sessionId: schema.sessions.publicId,
      sessionType: schema.sessions.sessionType,
      sessionFeel: schema.sessions.feel,
    })
    .from(schema.entries)
    .innerJoin(schema.profiles, eq(schema.entries.profileId, schema.profiles.id))
    .leftJoin(schema.metricDefinitions, eq(schema.entries.metricKey, schema.metricDefinitions.key))
    .leftJoin(schema.activityTypes, eq(schema.entries.activityTypeId, schema.activityTypes.id))
    // V1-8-3a: the `deleted_at IS NULL` guard is in the ON (NOT the WHERE) — in the WHERE it would drop
    // the live member entries of a soft-deleted session (matched row → whole entry vanishes = data loss);
    // in the ON a deleted session just fails to match, so its members still render (as flat rows).
    .leftJoin(
      schema.sessions,
      and(eq(schema.entries.sessionId, schema.sessions.id), isNull(schema.sessions.deletedAt)),
    )
    .where(
      and(
        eq(schema.profiles.publicId, profilePublicId),
        eq(schema.entries.activityDate, day),
        isNull(schema.entries.deletedAt),
      ),
    )
    // `id` (bigint identity) breaks created_at ties deterministically: rows written in one batch
    // share one `now()` (Postgres now() is the transaction timestamp), so without this their order
    // is unspecified. The tiebreak is ASC so a batched insert reads in INSERTION order — a V1-8
    // strength session's N movements (one tx, one created_at) show Squat, Bench, Row, not reversed.
    // Across different created_at, desc(createdAt) still lists the day newest-first; calisthenics
    // bouts are separate submits (distinct created_at), so `calisthenicsTotals`' oldest-first
    // reverse is unaffected.
    .orderBy(desc(schema.entries.createdAt), asc(schema.entries.id));

  // Fetch sets for the set-bearing (strength) entries in one query, then group by entry. Dispatch on
  // `movement_id !== null` (not `kind === 'strength'`): V1-8 session members are written kind=NULL, so
  // the old dispatch would fetch zero sets for them. Only sc_lift entries carry a movement_id (metric
  // rows have it NULL by the at-most-one CHECK), so this catches new session members AND legacy strength.
  const strengthIds = rows.filter((r) => r.movementId !== null).map((r) => r.id);
  const setRows = strengthIds.length
    ? await db
        .select({
          entryId: schema.entrySets.entryId,
          idx: schema.entrySets.idx,
          reps: schema.entrySets.reps,
          weightNum: schema.entrySets.weightNum,
          weightLabel: schema.entrySets.weightLabel,
        })
        .from(schema.entrySets)
        .where(
          and(inArray(schema.entrySets.entryId, strengthIds), isNull(schema.entrySets.deletedAt)),
        )
        .orderBy(asc(schema.entrySets.idx))
    : [];

  const setsByEntry = new Map<number, SetDTO[]>();
  for (const s of setRows) {
    const list = setsByEntry.get(s.entryId) ?? [];
    list.push({
      idx: s.idx,
      reps: s.reps,
      weight: s.weightNum === null ? null : Number(s.weightNum),
      weightLabel: s.weightLabel,
    });
    setsByEntry.set(s.entryId, list);
  }

  return rows.map((r) => ({
    id: r.publicId,
    kind: r.kind as EntryKind | null,
    unit: r.unit as Unit,
    movementName: r.movementName,
    // numeric comes back as a string from pg; coerce to number for the DTO.
    value: r.valueNum === null ? null : Number(r.valueNum),
    status: r.status as EntryStatus,
    notes: r.notes,
    metricKey: r.metricKey,
    metricLabel: r.metricLabel,
    valueType: r.valueType,
    aggregation: r.aggregation,
    activityKey: r.activityKey,
    activityLabel: r.activityLabel,
    sessionId: r.sessionId,
    // The sessions_session_type_check column only holds SessionType values (or NULL).
    sessionType: r.sessionType as SessionType | null,
    sessionFeel: r.sessionFeel,
    sets: setsByEntry.get(r.id) ?? [],
  }));
}

export type LogBodyweightArgs = {
  profilePublicId: string;
  value: number;
  unit: BodyweightUnit;
  clientId: string; // client-stamped UUIDv7
  day: string; // YYYY-MM-DD (declared date)
  notes?: string | null;
};

/**
 * Writes a bodyweight entry (V0-8). Idempotent by `client_id`: a retry with the
 * same id is a no-op and returns the existing row (partial UNIQUE + ON CONFLICT
 * DO NOTHING). Server generates the `public_id`. Returns the entry's public id.
 * Throws if the profile is unknown (the caller re-checks ownership first).
 */
export async function logBodyweight(args: LogBodyweightArgs): Promise<{ id: string }> {
  const [profile] = await db
    .select({ id: schema.profiles.id })
    .from(schema.profiles)
    .where(
      and(eq(schema.profiles.publicId, args.profilePublicId), isNull(schema.profiles.deletedAt)),
    )
    .limit(1);
  if (!profile) throw new Error('Profile not found');

  // V1-1b dual-write: also populate the generalized columns. A weigh-in is a
  // single_metric activity carrying the `bodyweight` metric (no movement) — so
  // metric_key is set and movement_id stays NULL (satisfies the at-most-one CHECK).
  const activityTypeId = await getActivityTypeIdByKey(SEED_ACTIVITY_TYPE_KEYS.weighIn);
  const metricKey = await assertMetricKeyExists(SEED_METRIC_KEYS.bodyweight);

  const [inserted] = await db
    .insert(schema.entries)
    .values({
      publicId: newId(),
      clientId: args.clientId,
      profileId: profile.id,
      activityDate: args.day,
      kind: ENTRY_KIND.bodyweight,
      unit: args.unit,
      valueNum: String(args.value), // numeric column takes a string (precision-safe)
      activityTypeId,
      metricKey,
      status: ENTRY_STATUS.done,
      notes: args.notes ?? null,
    })
    // client_id UNIQUE is a PARTIAL index (WHERE deleted_at IS NULL), so the
    // ON CONFLICT arbiter must repeat that predicate to match it.
    .onConflictDoNothing({
      target: schema.entries.clientId,
      where: isNull(schema.entries.deletedAt),
    })
    .returning({ publicId: schema.entries.publicId });

  if (inserted) return { id: inserted.publicId };

  // Conflict → the entry already exists for this client_id; return it.
  const [existing] = await db
    .select({ publicId: schema.entries.publicId })
    .from(schema.entries)
    .where(eq(schema.entries.clientId, args.clientId))
    .limit(1);
  return { id: existing.publicId };
}

export type CheckinItemInput = {
  activityKey: string;
  metricKey: string | null; // null → a bare habit (NEITHER source column set)
  value: number; // always numeric; a checked box is 1 (see the shape-CHECK note)
  clientId: string; // client-stamped UUIDv7, per item
  // V1-7: a point-in-time for timing activities (wake). Optional — the check-in/habit callers
  // omit it (→ NULL). This makes logCheckinEntries the de-facto shared entry writer; RENAME to
  // `logEntries` / `EntryItemInput` when the 2nd non-checkin caller lands (or at V1-1d).
  eventAt?: Date;
};

export type CheckinResult = {
  clientId: string;
  id: string | null; // public_id of the row this item wrote; null if it conflicted
  created: boolean;
};

/**
 * Writes N check-in entries in one multi-row INSERT (V1-5). Returns PER-ITEM results
 * (AGENTS.md: "client UUIDv7 per item + DB UNIQUE + ON CONFLICT; per-item results") —
 * a bare count can't tell a full replay from a partial conflict, and v1.5's /api/sync
 * is specified around per-item results.
 *
 * ⚠️ THE SHAPE-CHECK TRAP. `entries_shape_check` (0000, retained until V1-1d) reads:
 *     (kind='bodyweight' AND value_num IS NOT NULL AND movement_name IS NULL)
 *  OR (kind='strength'   AND movement_name IS NOT NULL)
 * With `kind` NULL both branches go NULL, and Postgres passes a CHECK that evaluates to
 * NULL — but only while no sub-predicate is FALSE. So a kind-less row passes iff
 * `value_num IS NOT NULL OR movement_name IS NOT NULL`. We therefore ALWAYS write
 * `value_num` (a checked box is `1`) and NEVER write `movement_name`. Encoding a bool as
 * a NULL-valued "presence" row would be rejected in prod. `db:verify` pins both directions.
 * (The 1/0 encoding is also what V1-6's sum/last aggregation and V1-13's CSV pivot want.)
 *
 * No transaction: a single multi-row INSERT is already atomic. `logStrengthSession` uses one
 * because it spans the sessions / entries / entry_sets tables.
 */
export async function logCheckinEntries(args: {
  profilePublicId: string;
  day: string;
  items: readonly CheckinItemInput[];
}): Promise<CheckinResult[]> {
  const [profile] = await db
    .select({ id: schema.profiles.id })
    .from(schema.profiles)
    .where(
      and(eq(schema.profiles.publicId, args.profilePublicId), isNull(schema.profiles.deletedAt)),
    )
    .limit(1);
  if (!profile) throw new Error('Profile not found');

  // Resolve the catalog rows OUTSIDE the insert — cached reads of immutable reference
  // data. This is also the DB-truth guard: a key that exists in the shared const but not
  // in the seeded catalog throws here instead of writing a bad row. The written `unit`
  // comes from the resolved row, never from the request or a compiled const.
  const activityKeys = [...new Set(args.items.map((i) => i.activityKey))];
  const metricKeys = [...new Set(args.items.map((i) => i.metricKey).filter((k) => k !== null))];
  const activities = new Map(
    await Promise.all(activityKeys.map(async (k) => [k, await getActivityTypeByKey(k)] as const)),
  );
  const metrics = new Map(
    await Promise.all(metricKeys.map(async (k) => [k, await getMetricDefinition(k)] as const)),
  );

  const values = args.items.map((i) => {
    const activity = activities.get(i.activityKey)!;
    const metric = i.metricKey === null ? null : metrics.get(i.metricKey)!;
    const unit = metric?.unit ?? activity.defaultUnit;
    if (!unit) throw new Error(`no unit resolvable for check-in activity: ${i.activityKey}`);
    return {
      publicId: newId(),
      clientId: i.clientId,
      profileId: profile.id,
      activityDate: args.day,
      // no `kind` — V1-5 is the first kind-less writer (V1-1c relaxed it for exactly this)
      unit: unit as Unit,
      valueNum: String(i.value), // ALWAYS set — see the shape-CHECK trap above
      // movementName intentionally omitted — must stay NULL for the same CHECK
      activityTypeId: activity.id,
      metricKey: i.metricKey, // NULL for a bare habit → the "neither source" shape
      eventAt: i.eventAt, // V1-7 timing (wake); undefined → column omitted → NULL for check-ins
      status: ENTRY_STATUS.done,
    };
  });

  const inserted = await db
    .insert(schema.entries)
    .values(values)
    // client_id UNIQUE is PARTIAL (WHERE deleted_at IS NULL), so the arbiter repeats it.
    .onConflictDoNothing({
      target: schema.entries.clientId,
      where: isNull(schema.entries.deletedAt),
    })
    .returning({ publicId: schema.entries.publicId, clientId: schema.entries.clientId });

  const byClientId = new Map(inserted.map((r) => [r.clientId, r.publicId]));
  return args.items.map((i) => ({
    clientId: i.clientId,
    id: byClientId.get(i.clientId) ?? null,
    created: byClientId.has(i.clientId),
  }));
}

export type LogStrengthSessionArgs = {
  profilePublicId: string;
  sessionType: string;
  clientId: string; // client-stamped UUIDv7 (parent SESSION)
  day: string;
  feel?: string; // optional session feel note (V1-8-3b)
  movements: readonly SessionMovementInput[]; // { movementName, unit, clientId, sets }
};

/**
 * Writes a flat multi-movement strength SESSION (V1-8-2): one `sessions` row grouping N movement
 * `entry`s (each → its `entry_set`s) in ONE transaction, per-row idempotency at every level. This
 * is a THIN wrapper — it resolves the catalog ids the pure write core can't (the `sc_lift`
 * activity type + each movement's `movement_id`, both cached/idempotent-by-slug, so resolving them
 * OUTSIDE the tx is safe), then hands off to `writeStrengthSession` in `packages/db`, which the
 * `db:verify` proof runs too (single-sourced — no drift). Profile ownership is re-resolved inside
 * the core by `public_id` (the F7 seam). Returns the session's public id.
 */
export async function logStrengthSession(
  args: LogStrengthSessionArgs,
): Promise<{ sessionId: string }> {
  const activityTypeId = await getActivityTypeIdByKey(SEED_ACTIVITY_TYPE_KEYS.scLift);
  // Resolve each movement's id up front (find-or-create is idempotent by slug → safe outside the tx,
  // and independent → resolved in PARALLEL so a 12-movement session isn't 12 serial round trips).
  const movements = await Promise.all(
    args.movements.map(async (m) => ({
      ...m,
      movementId: await findOrCreateMovementId(m.movementName),
    })),
  );

  return writeStrengthSession(db, {
    profilePublicId: args.profilePublicId,
    day: args.day,
    sessionType: args.sessionType,
    sessionClientId: args.clientId,
    activityTypeId,
    feel: args.feel,
    movements,
  });
}
