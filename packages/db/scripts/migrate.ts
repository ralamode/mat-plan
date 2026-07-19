import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDb, createDbPool } from '../src/client';

// Applies pending migrations against the DIRECT/unpooled Neon string. Run by
// GitHub Actions on merge to main — never in the Vercel build.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL_UNPOOLED (or DATABASE_URL) to run migrations.');

const pool = createDbPool(url);
await migrate(createDb(pool), {
  migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
});
await pool.end();
console.log('✓ migrations applied');
