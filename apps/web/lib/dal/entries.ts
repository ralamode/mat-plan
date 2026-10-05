import 'server-only';

import {
  findAmendableBodyweight,
  insertBodyweightEntry,
  isLiveProfile,
  schema,
  updateBodyweightEntryById,
  updateStrengthSetById,
  writeStrengthSession,
} from '@mat-plan/db';
import {
  ENTRY_KIND,
  ENTRY_STATUS,
  newId,
  SEED_ACTIVITY_TYPE_KEYS,
  SEED_METRIC_KEYS,
  type BodyweightUnit,
  type DayRole,
  type EntryKind,
  type EntryStatus,
  type QuantitySlot,
  type SessionMovementInput,
  type SessionType,
  type Unit,
  type UnitDimension,
} from '@mat-plan/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

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
/** One measured quantity of a set — the typed replacement for the free-text load (GAP-3). */
export type SetQuantityDTO = {
  slot: QuantitySlot;
  dimension: UnitDimension;
  unit: Unit;
  value: number;
};

export type SetDTO = {
  publicId: string; // entry_sets.public_id (UUIDv7) — the stable, non-enumerable id the V1-9 edit addresses
  idx: number;
  reps: number | null;
  // GAP-3: `weight`/`weightLabel` are gone. Every magnitude is a quantity row; the two MODES are
  // booleans. A set with no quantities and no flag is a partially-logged set, which reads as `?`.
  isBodyweight: boolean;
  isBand: boolean;
  quantities: SetQuantityDTO[];
  // GAP-1 P1-1b. Carried so the read seam can tell a `sub_failure` set from a `done` one — WITHOUT it
  // per-set status is unrenderable and `isEditableSet` can't refuse to edit one. Typed as the full
  // `EntryStatus` (not the narrower SetStatus) because this is a READ of whatever the column holds,
  // including a value written before the boundary narrowed; the write path is where the subset applies.
  status: EntryStatus;
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
  // is the raw enum (rendered via SESSION_TYPE_LABELS at the view).
  sessionId: string | null;
  // The session's type from a CHECK-constrained column, so it's the SessionType union (not bare
  // string) — the view indexes SESSION_TYPE_LABELS with no cast, and a stray value fails the build.
  sessionType: SessionType | null;
  // GAP-1 P0-1: WHICH programmed day the athlete asserted this session was, or NULL. Surfaced on the
  // read path deliberately — a persisted role that nothing displays is a value nobody can discover is
  // wrong until an export months later, which is exactly what makes storing it risky.
  sessionDayRole: DayRole | null;
  // V1-8-3b: the optional session "how did it feel?" note, shown in the session-block header. NULL when
  // no feel was logged (the schema normalizes a blank input to NULL) or for non-session entries.
  sessionFeel: string | null;
  // V1-8-3d: the superset this movement belongs to. `supersetId` is the superset's PUBLIC id (anti-IDOR),
  // NULL for a standalone movement or a soft-deleted superset (the join misses → renders standalone);
  // `supersetOrder` is its 1-based position within the superset (for the alternating read order). No
  // superset label field — v1 supersets carry no user label (the bracket shows DEFAULT_SUPERSET_LABEL).
  supersetId: string | null;
  supersetOrder: number | null;
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
      sessionDayRole: schema.sessions.dayRole,
      sessionFeel: schema.sessions.feel,
      // V1-8-3d: the superset's PUBLIC id (anti-IDOR) + the member's order within it. Same PK-join idiom.
      supersetId: schema.supersets.publicId,
      supersetOrder: schema.entries.supersetOrder,
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
    // V1-8-3d: same idiom for the superset — `deleted_at` in the ON so a soft-deleted superset degrades
    // its members to standalone (supersetId NULL) rather than dropping them.
    .leftJoin(
      schema.supersets,
      and(eq(schema.entries.supersetId, schema.supersets.id), isNull(schema.supersets.deletedAt)),
    )
    .where(
      and(
        // DAL-1: THE live-profile predicate (writers/ownership.ts), not a re-typed `publicId =` — this
        // read was one of two ownership sites that skipped `profiles.deleted_at IS NULL`.
        isLiveProfile(profilePublicId),
        eq(schema.entries.activityDate, day),
        isNull(schema.entries.deletedAt),
      ),
    )
    // V1-17: OLDEST-FIRST (asc created_at), so the day's "Logged entries" list reads top-down in the
    // order things were performed — wake → bodyweight → rice bucket — the way the kids log down their
    // routine. (`created_at` is the performed-order proxy; `event_at` is set only on wake, logged
    // near-real-time at session start, so plain created_at already reads correctly. A per-entry
    // performed-time input + a user-flippable sort are a fast-follow.) `id` (bigint identity, insertion
    // order) breaks created_at ties deterministically — rows in one batch share one `now()` (the tx
    // timestamp), so a V1-8 session's N movements (one tx) still read Squat, Bench, Row in insertion
    // order, and the asc(id) tiebreak is unchanged from before.
    .orderBy(asc(schema.entries.createdAt), asc(schema.entries.id));

  // Fetch sets for the set-bearing (strength) entries in one query, then group by entry. Dispatch on
  // `movement_id !== null` (not `kind === 'strength'`): V1-8 session members are written kind=NULL, so
  // the old dispatch would fetch zero sets for them. Only sc_lift entries carry a movement_id (metric
  // rows have it NULL by the at-most-one CHECK), so this catches new session members AND legacy strength.
  const strengthIds = rows.filter((r) => r.movementId !== null).map((r) => r.id);
  const setRows = strengthIds.length
    ? await db
        .select({
          entryId: schema.entrySets.entryId,
          publicId: schema.entrySets.publicId,
          idx: schema.entrySets.idx,
          reps: schema.entrySets.reps,
          isBodyweight: schema.entrySets.isBodyweight,
          isBand: schema.entrySets.isBand,
          status: schema.entrySets.status,
          id: schema.entrySets.id,
        })
        .from(schema.entrySets)
        .where(
          and(inArray(schema.entrySets.entryId, strengthIds), isNull(schema.entrySets.deletedAt)),
        )
        .orderBy(asc(schema.entrySets.idx))
    : [];

  // GAP-3: the quantities, in a second query keyed on the set ids we just proved live. ⚠️ The parent
  // filter is LOAD-BEARING — `ON DELETE CASCADE` on entry_set_quantities is HARD-delete only, and this
  // app only ever SOFT-deletes, so quantities whose set is soft-deleted are still `deleted_at IS NULL`.
  // Selecting by these ids (rather than scanning the child table) is what keeps them out.
  const setIds = setRows.map((s) => s.id);
  const quantityRows = setIds.length
    ? await db
        .select({
          entrySetId: schema.entrySetQuantities.entrySetId,
          slot: schema.entrySetQuantities.slot,
          dimension: schema.entrySetQuantities.dimension,
          unit: schema.entrySetQuantities.unit,
          valueNum: schema.entrySetQuantities.valueNum,
        })
        .from(schema.entrySetQuantities)
        .where(
          and(
            inArray(schema.entrySetQuantities.entrySetId, setIds),
            isNull(schema.entrySetQuantities.deletedAt),
          ),
        )
    : [];

  const quantitiesBySet = new Map<number, SetQuantityDTO[]>();
  for (const q of quantityRows) {
    const list = quantitiesBySet.get(q.entrySetId) ?? [];
    list.push({
      slot: q.slot as QuantitySlot,
      dimension: q.dimension as UnitDimension,
      unit: q.unit as Unit,
      value: Number(q.valueNum),
    });
    quantitiesBySet.set(q.entrySetId, list);
  }

  const setsByEntry = new Map<number, SetDTO[]>();
  for (const s of setRows) {
    const list = setsByEntry.get(s.entryId) ?? [];
    list.push({
      publicId: s.publicId,
      idx: s.idx,
      reps: s.reps,
      isBodyweight: s.isBodyweight,
      isBand: s.isBand,
      quantities: quantitiesBySet.get(s.id) ?? [],
      status: s.status as EntryStatus,
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
    sessionDayRole: r.sessionDayRole as DayRole | null,
    sessionFeel: r.sessionFeel,
    supersetId: r.supersetId,
    supersetOrder: r.supersetOrder,
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
 * Writes a bodyweight entry (V0-8): resolves the LIVE profile, then hands the insert to
 * `insertBodyweightEntry` in `packages/db` (V1-24 1e), which `db:verify` proves directly.
 *
 * `{ id }` on a write or a replay of this submit; `{ dayTaken: true }` when the day's slot already holds
 * another submit's weigh-in — an EXPECTED outcome, so a typed result, not a throw (AGENTS.md → Errors).
 * Throws if the profile is unknown (the caller re-checks ownership first).
 */
export type LogBodyweightResult = { id: string } | { dayTaken: true };

export async function logBodyweight(args: LogBodyweightArgs): Promise<LogBodyweightResult> {
  const [profile] = await db
    .select({ id: schema.profiles.id })
    .from(schema.profiles)
    .where(isLiveProfile(args.profilePublicId))
    .limit(1);
  if (!profile) throw new Error('Profile not found');

  // A weigh-in is a single_metric activity carrying the `bodyweight` metric (no movement), so the
  // writer sets metric_key and leaves movement_id NULL (the at-most-one CHECK). Asserted here so a
  // missing seed fails loudly rather than as an FK error mid-insert.
  const activityTypeId = await getActivityTypeIdByKey(SEED_ACTIVITY_TYPE_KEYS.weighIn);
  await assertMetricKeyExists(SEED_METRIC_KEYS.bodyweight);

  return insertBodyweightEntry(db, {
    profileId: profile.id,
    publicId: newId(),
    clientId: args.clientId,
    day: args.day,
    unit: args.unit,
    value: args.value,
    notes: args.notes ?? null,
    activityTypeId,
    kind: ENTRY_KIND.bodyweight,
  });
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
  dayRole?: string; // GAP-1 P0-1: the programmed day the athlete asserted (never derived)
  // V1-8-3d: the supersets to create; each movement references one via `supersetClientId` (on the
  // SessionMovementInput). No catalog resolution needed — a pass-through, like `feel`.
  supersets?: readonly { clientId: string; label?: string }[];
  movements: readonly SessionMovementInput[]; // { movementName, unit, clientId, sets, superset tags }
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
    dayRole: args.dayRole,
    activityTypeId,
    feel: args.feel,
    supersets: args.supersets,
    movements,
  });
}

/**
 * Amend ONE logged bodyweight's value (V1-24 PR 1b). Thin, exactly like `editStrengthSet`: the
 * single-sourced `updateBodyweightEntryById` core owns the guard, so no ownership check leaks out
 * here and `db:verify` proves the same code the app runs.
 *
 * `null` means the guarded WHERE matched nothing — wrong owner, stale/deleted id, wrong shape, or a
 * `seenValue` that no longer matches. **The action must tell those apart** (a stale value is
 * recoverable and the parent should see the latest; a wrong owner must stay indistinguishable from
 * not-found), so it re-selects under the same ownership scope before choosing its message.
 */
export async function editBodyweight(args: {
  profilePublicId: string;
  entryId: string;
  value: number;
  unit: string;
  seenValue: number;
}): Promise<{ entryId: string } | null> {
  const updated = await updateBodyweightEntryById(db, args);
  return updated ? { entryId: updated.publicId } : null;
}

/**
 * Re-read ONE amendable bodyweight the profile owns, for the action's three-way branch after a refused
 * amend (V1-24 PR 1b). Thin: the single-sourced `findAmendableBodyweight` shares the UPDATE's shape
 * predicate and ownership scope, so `null` covers a wrong owner and a wrong shape alike.
 */
export async function ownedBodyweightValue(args: {
  profilePublicId: string;
  entryId: string;
}): Promise<{ value: number; unit: string } | null> {
  return findAmendableBodyweight(db, args);
}

/**
 * Edit ONE logged strength set's reps/weight (V1-9). Thin: hands off to the single-sourced
 * `updateStrengthSetById` core (which `db:verify` also runs), whose guarded UPDATE proves the set
 * belongs to the live `profilePublicId` — so no ownership check leaks out here. Returns the edited
 * set's public id, or `null` when nothing matched (wrong owner / stale-or-deleted set) — the action
 * maps `null` to a typed error, never a throw.
 */
export async function editStrengthSet(args: {
  profilePublicId: string;
  setId: string;
  reps: number;
  weight: number;
}): Promise<{ setId: string } | null> {
  const updated = await updateStrengthSetById(db, args);
  return updated ? { setId: updated.publicId } : null;
}
