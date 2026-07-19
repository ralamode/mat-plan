import { createDb, createDbPool } from '../src/client';
import { seed } from '../src/seed';

// Runs the idempotent seed against DATABASE_URL[_UNPOOLED].
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL_UNPOOLED (or DATABASE_URL) to run the seed.');

const pool = createDbPool(url);
await seed(createDb(pool));
await pool.end();
console.log('✓ seed complete');
