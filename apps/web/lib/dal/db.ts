import 'server-only';

import { createDb, createDbPool, type Database } from '@mat-plan/db';
import { attachDatabasePool } from '@vercel/functions';

import { env } from '@/lib/env';

/**
 * The one place the app constructs the DB client (server-only). Uses the pooled
 * Neon string over `pg` on the Node runtime; a module singleton is reused across
 * serverless invocations / hot reloads, and the pool is registered with Vercel
 * Fluid so it drains on instance suspension (`attachDatabasePool`).
 *
 * Every route/handler that imports the DAL must run on the Node runtime
 * (`export const runtime = 'nodejs'`) — `pg` is not Edge-compatible.
 */
const globalForDb = globalThis as unknown as {
  __mpPool?: ReturnType<typeof createDbPool>;
  __mpDb?: Database;
};

const pool = globalForDb.__mpPool ?? createDbPool(env.DATABASE_URL);
if (!globalForDb.__mpPool) {
  globalForDb.__mpPool = pool;
  try {
    // Registers a pool 'release' listener so Vercel Fluid drains idle connections
    // on suspend. Off Vercel it's a safe no-op (guarded on VERCEL_URL internally),
    // so reaching the catch means a genuinely unexpected failure — warn, don't
    // swallow. (Folds into Sentry once observability lands.)
    attachDatabasePool(pool);
  } catch (err) {
    console.warn('[dal/db] attachDatabasePool failed; pool may not drain on suspend', err);
  }
}

export const db: Database = globalForDb.__mpDb ?? createDb(pool);
globalForDb.__mpDb = db;
