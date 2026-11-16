import { assertMigrationTarget } from '@mat-plan/shared';

import { createDb, createDbPool } from '../src/client';
import {
  assertFixturesTargetAllowed,
  seed,
  SEED_FIXTURES_ENV,
  seedFixturesRequested,
} from '../src/seed';

// Runs the idempotent seed against DATABASE_URL[_UNPOOLED].
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL_UNPOOLED (or DATABASE_URL) to run the seed.');

// OPS-1: same guard as db:migrate. The seed is `ON CONFLICT DO NOTHING`, so seeding the WRONG
// database is the silent failure — hence a refusal before connecting rather than after.
assertMigrationTarget(process.env.EXPECTED_DB_ENV, url, 'db:seed');

// FAM-1 D10: program fixtures only on request, and only where the URL proves it is not production.
const fixtures = seedFixturesRequested(process.env[SEED_FIXTURES_ENV]);
if (fixtures) assertFixturesTargetAllowed(url);

const pool = createDbPool(url);
await seed(createDb(pool), { fixtures });
await pool.end();
// Fixed text only: this lands in world-readable Actions logs.
console.log(
  fixtures ? '✓ seed complete (with program fixtures)' : '✓ seed complete (no program fixtures)',
);
