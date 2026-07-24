import 'server-only';

import { schema } from '@mat-plan/db';
import {
  ENTRY_KIND,
  ENTRY_STATUS,
  newId,
  SEED_ACTIVITY_TYPE_KEYS,
  SEED_METRIC_KEYS,
  type BodyweightUnit,
  type EntryKind,
  type EntryStatus,
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
    })
    .from(schema.entries)
    .innerJoin(schema.profiles, eq(schema.entries.profileId, schema.profiles.id))
    .leftJoin(schema.metricDefinitions, eq(schema.entries.metricKey, schema.metricDefinitions.key))
    .leftJoin(schema.activityTypes, eq(schema.entries.activityTypeId, schema.activityTypes.id))
    .where(
      and(
        eq(schema.profiles.publicId, profilePublicId),
        eq(schema.entries.activityDate, day),
        isNull(schema.entries.deletedAt),
      ),
    )
    // `id` (bigint identity) breaks created_at ties deterministically: rows written in one
    // batch (e.g. several calisthenics bouts) share `now()`, so without this their order is
    // unspecified and the grouped bout display ("20, 30") would flip run to run.
    .orderBy(desc(schema.entries.createdAt), desc(schema.entries.id));

  // Fetch sets for the strength entries in one query, then group by entry.
  const strengthIds = rows.filter((r) => r.kind === ENTRY_KIND.strength).map((r) => r.id);
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
 * No transaction: a single multi-row INSERT is already atomic. `logStrengthEntry` uses one
 * because it spans two tables.
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

export type LogStrengthArgs = {
  profilePublicId: string;
  movementName: string;
  unit: BodyweightUnit; // lb/kg
  sets: { reps: number; weight: number }[];
  clientId: string; // client-stamped UUIDv7 (parent entry)
  day: string;
};

/**
 * Writes a strength entry + its sets in ONE transaction (V0-9): either the entry
 * and all N `entry_set` rows land, or none do. Idempotent by the entry's
 * `client_id` — a replay finds the existing entry and skips re-inserting sets
 * (so it never doubles the sets). Set ids are generated server-side.
 */
export async function logStrengthEntry(args: LogStrengthArgs): Promise<{ id: string }> {
  // V1-1b dual-write: resolve the generalized columns BEFORE the transaction. An S&C
  // lift is a set_list activity referencing a movement (no metric) — so movement_id is
  // set and metric_key stays NULL (satisfies the at-most-one CHECK). find-or-create is
  // idempotent by slug, so resolving it outside the tx is safe (a replay reuses the row).
  const activityTypeId = await getActivityTypeIdByKey(SEED_ACTIVITY_TYPE_KEYS.scLift);
  const movementId = await findOrCreateMovementId(args.movementName);

  return db.transaction(async (tx) => {
    const [profile] = await tx
      .select({ id: schema.profiles.id })
      .from(schema.profiles)
      .where(
        and(eq(schema.profiles.publicId, args.profilePublicId), isNull(schema.profiles.deletedAt)),
      )
      .limit(1);
    if (!profile) throw new Error('Profile not found');

    const [entry] = await tx
      .insert(schema.entries)
      .values({
        publicId: newId(),
        clientId: args.clientId,
        profileId: profile.id,
        activityDate: args.day,
        kind: ENTRY_KIND.strength,
        unit: args.unit,
        movementName: args.movementName,
        activityTypeId,
        movementId,
        status: ENTRY_STATUS.done,
      })
      .onConflictDoNothing({
        target: schema.entries.clientId,
        where: isNull(schema.entries.deletedAt),
      })
      .returning({ id: schema.entries.id, publicId: schema.entries.publicId });

    // Idempotent replay: the entry already exists — return it, don't re-add sets.
    if (!entry) {
      const [existing] = await tx
        .select({ publicId: schema.entries.publicId })
        .from(schema.entries)
        .where(eq(schema.entries.clientId, args.clientId))
        .limit(1);
      return { id: existing.publicId };
    }

    await tx.insert(schema.entrySets).values(
      args.sets.map((s, i) => ({
        publicId: newId(),
        clientId: newId(),
        entryId: entry.id,
        idx: i + 1, // 1-based
        reps: s.reps,
        weightNum: String(s.weight),
        status: ENTRY_STATUS.done,
      })),
    );

    return { id: entry.publicId };
  });
}
