import { assertMigrationTarget } from '@mat-plan/shared';

import { createDb, createDbPool } from '../src/client';
import { seed } from '../src/seed';

// Runs the idempotent seed against DATABASE_URL[_UNPOOLED].
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL_UNPOOLED (or DATABASE_URL) to run the seed.');

// OPS-1: same guard as db:migrate. The seed is `ON CONFLICT DO NOTHING`, so seeding the WRONG
// database is the silent failure — hence a refusal before connecting rather than after.
assertMigrationTarget(process.env.EXPECTED_DB_ENV, url, 'db:seed');

const pool = createDbPool(url);
await seed(createDb(pool));
await pool.end();
console.log('✓ seed complete');
