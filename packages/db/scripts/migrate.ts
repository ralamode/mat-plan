import { fileURLToPath } from 'node:url';

import { assertMigrationTarget } from '@mat-plan/shared';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDb, createDbPool } from '../src/client';

// Applies pending migrations against the DIRECT/unpooled Neon string. Run by
// GitHub Actions on merge to main — never in the Vercel build.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL_UNPOOLED (or DATABASE_URL) to run migrations.');

// OPS-1: refuse a target that disagrees with the estate the caller declared. There are now TWO
// migrator secrets (production and preview), so a mis-paste is live in both directions — and the
// quiet one is worse: the preview string in `DATABASE_URL_UNPOOLED` leaves this job GREEN while
// production stops being migrated and drifts. `EXPECTED_DB_ENV` unset => no check, so local runs,
// CI and `db:verify` are untouched. Rule: packages/shared/src/db-environment.ts.
assertMigrationTarget(process.env.EXPECTED_DB_ENV, url, 'db:migrate');

const pool = createDbPool(url);
await migrate(createDb(pool), {
  migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
});
await pool.end();
console.log('✓ migrations applied');
