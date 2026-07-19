import { UNITS } from '@mat-plan/shared';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from './schema';

/**
 * Idempotent seed (AGENTS.md: seed reference data ON CONFLICT DO NOTHING; runs
 * twice → identical result). v0 seeds the `units` reference table + one profile.
 * The profile uses a fixed UUIDv7 so re-runs conflict on public_id instead of
 * inserting duplicates.
 */

// A fixed UUIDv7 for the single v0 seed profile (stable identity for idempotency).
export const SEED_PROFILE_PUBLIC_ID = '019826b4-0000-7000-8000-000000000001';

export async function seed(db: NodePgDatabase<typeof schema>): Promise<void> {
  await db.insert(schema.units).values(UNITS).onConflictDoNothing({ target: schema.units.code });

  await db
    .insert(schema.profiles)
    .values({ publicId: SEED_PROFILE_PUBLIC_ID, name: 'Athlete One', kind: 'kid' })
    .onConflictDoNothing({ target: schema.profiles.publicId });
}
