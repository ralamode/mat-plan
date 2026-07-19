import 'server-only';

import { schema } from '@mat-plan/db';
import type { ProfileKind } from '@mat-plan/shared';
import { isNull } from 'drizzle-orm';

import { db } from './db';

/**
 * DAL skeleton (V0-5). Every DAL function returns a minimal DTO — never a raw
 * row — and keeps DB access here (server-only). Ownership scoping (Clerk
 * `getCurrentUser()` + `household_id`) lands with auth at V1-1/v1.5; this is the
 * seam it plugs into. `public_id` (UUIDv7) is the id the UI/URLs ever see.
 */
export type ProfileDTO = {
  id: string;
  name: string;
  kind: ProfileKind;
};

export async function listProfiles(): Promise<ProfileDTO[]> {
  const rows = await db
    .select({
      publicId: schema.profiles.publicId,
      name: schema.profiles.name,
      kind: schema.profiles.kind,
    })
    .from(schema.profiles)
    .where(isNull(schema.profiles.deletedAt));

  return rows.map((r) => ({ id: r.publicId, name: r.name, kind: r.kind as ProfileKind }));
}
