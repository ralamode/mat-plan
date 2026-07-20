import 'server-only';

import { schema } from '@mat-plan/db';
import {
  ENTRY_KIND,
  ENTRY_STATUS,
  newId,
  type BodyweightUnit,
  type EntryKind,
  type EntryStatus,
  type Unit,
} from '@mat-plan/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { db } from './db';

/**
 * Entry reads for the Today view (V0-7). Scoped by the profile's `public_id`
 * (never a raw internal id from the request) and filtered to a single declared
 * day. Returns DTOs — never raw rows. Ownership/household scoping plugs in here
 * once Clerk lands (V1-1/v1.5).
 */
export type EntryDTO = {
  id: string; // public_id (UUIDv7)
  kind: EntryKind;
  unit: Unit;
  movementName: string | null;
  value: number | null; // bodyweight value_num; null for strength (values live in entry_sets)
  status: EntryStatus;
  notes: string | null;
};

export async function listEntriesForDay(profilePublicId: string, day: string): Promise<EntryDTO[]> {
  const rows = await db
    .select({
      publicId: schema.entries.publicId,
      kind: schema.entries.kind,
      unit: schema.entries.unit,
      movementName: schema.entries.movementName,
      valueNum: schema.entries.valueNum,
      status: schema.entries.status,
      notes: schema.entries.notes,
    })
    .from(schema.entries)
    .innerJoin(schema.profiles, eq(schema.entries.profileId, schema.profiles.id))
    .where(
      and(
        eq(schema.profiles.publicId, profilePublicId),
        eq(schema.entries.activityDate, day),
        isNull(schema.entries.deletedAt),
      ),
    )
    .orderBy(desc(schema.entries.createdAt));

  return rows.map((r) => ({
    id: r.publicId,
    kind: r.kind as EntryKind,
    unit: r.unit as Unit,
    movementName: r.movementName,
    // numeric comes back as a string from pg; coerce to number for the DTO.
    value: r.valueNum === null ? null : Number(r.valueNum),
    status: r.status as EntryStatus,
    notes: r.notes,
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
