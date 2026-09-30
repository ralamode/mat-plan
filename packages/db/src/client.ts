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

/**
 * Upgrade a connection string to **full TLS verification**.
 *
 * Neon's strings ship `sslmode=require`, which encrypts but does **not verify the server
 * certificate** — so it is protected against passive eavesdropping and NOT against an active
 * machine-in-the-middle. `verify-full` checks the chain *and* the hostname.
 *
 * `pg@8.23` warns that `require` will BECOME an alias for `verify-full` in a future major:
 *
 * > SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca' are treated as aliases for
 * > 'verify-full'. To prepare for this change … explicitly use 'sslmode=verify-full'.
 *
 * Two ways to answer that warning, and they are opposites: `uselibpqcompat=true` pins the WEAKER
 * behaviour, or this — take the stronger one now, deliberately, rather than inheriting it on a
 * dependency bump where a connection failure would surface as a broken deploy.
 *
 * **Verified against the live Neon host before shipping**: `verify-full` connects, so this is an
 * upgrade rather than a gamble. Neon serves a publicly-trusted certificate; no custom CA is needed.
 *
 * An explicit `sslmode` already in the string is **left alone** — a local Postgres with no TLS at all
 * (`sslmode=disable`, which `pnpm dev` and the e2e harness use) must keep working.
 */
export function withVerifiedTls(connectionString: string): string {
  if (/[?&]sslmode=/.test(connectionString)) {
    // Present but weak → upgrade. Absent → left alone (see below); explicit `disable`/`verify-*` → kept.
    return connectionString.replace(/([?&]sslmode=)(require|prefer|verify-ca)\b/, '$1verify-full');
  }
  // No sslmode at all: do NOT invent one. A bare localhost string has no TLS, and forcing
  // verify-full there would break every local run to fix a hosted-only concern.
  return connectionString;
}

export function createDbPool(connectionString: string): Pool {
  // Bound the connect wait so an unreachable DB fails fast into the error
  // boundary (V0-10) instead of hanging the request.
  return new Pool({
    connectionString: withVerifiedTls(connectionString),
    connectionTimeoutMillis: 10_000,
  });
}

export function createDb(pool: Pool) {
  return drizzle(pool, { schema, casing: 'snake_case' });
}

export type Database = ReturnType<typeof createDb>;
