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

import { assertMetricKeyExists, findOrCreateMovementId, getActivityTypeIdByKey } from './catalog';
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
  kind: EntryKind;
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
    })
    .from(schema.entries)
    .innerJoin(schema.profiles, eq(schema.entries.profileId, schema.profiles.id))
    .leftJoin(schema.metricDefinitions, eq(schema.entries.metricKey, schema.metricDefinitions.key))
    .where(
      and(
        eq(schema.profiles.publicId, profilePublicId),
        eq(schema.entries.activityDate, day),
        isNull(schema.entries.deletedAt),
      ),
    )
    .orderBy(desc(schema.entries.createdAt));

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
    kind: r.kind as EntryKind,
    unit: r.unit as Unit,
    movementName: r.movementName,
    // numeric comes back as a string from pg; coerce to number for the DTO.
    value: r.valueNum === null ? null : Number(r.valueNum),
    status: r.status as EntryStatus,
    notes: r.notes,
    metricKey: r.metricKey,
    metricLabel: r.metricLabel,
    valueType: r.valueType,
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
