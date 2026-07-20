import 'server-only';

import { schema } from '@mat-plan/db';
import type { EntryKind, EntryStatus, Unit } from '@mat-plan/shared';
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
