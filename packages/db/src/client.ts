import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema';

/**
 * Pure Drizzle client factory — no env reads, no `server-only`, no singleton — so
 * it's importable by the app DAL (which owns the singleton + Vercel Fluid pool
 * attach), by migration/seed scripts, and by the PGlite verify harness. Runtime
 * uses the pooled Neon string over `pg` on the Node runtime (see AGENTS.md).
 */
export { schema };
export type Schema = typeof schema;

export function createDbPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}

export function createDb(pool: Pool) {
  return drizzle(pool, { schema, casing: 'snake_case' });
}

export type Database = ReturnType<typeof createDb>;
