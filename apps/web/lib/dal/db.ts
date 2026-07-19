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
    attachDatabasePool(pool);
  } catch {
    // No-op off Vercel Fluid (local/CI) — nothing to attach to.
  }
}

export const db: Database = globalForDb.__mpDb ?? createDb(pool);
globalForDb.__mpDb = db;
