import { join } from 'node:path';

/**
 * Identity of the PERSISTENT local-dev sandbox DB (chore/local-dev-db) — the single
 * source shared by the launcher (`dev-local.ts`) and the reset script
 * (`db-local-reset.ts`) so the port/password/data-dir can't drift between them.
 *
 * Fixed values so the connection string is stable and the cluster (Ray's play-data)
 * survives across `pnpm dev` restarts. The password is baked into the cluster at
 * initdb time, so it MUST stay stable — a changed password can't reconnect to an
 * existing `.local-db` (run `pnpm db:local:reset` if you ever must change it).
 */
export const LOCAL_DB_PORT = 54329;
export const LOCAL_DB_PASSWORD = 'local-dev';

// Colocated with the app it serves (next to apps/web/.env.local). Gitignored. Both
// scripts run in apps/web (pnpm --filter web), so cwd is the app root.
export const LOCAL_DB_DIR = join(process.cwd(), '.local-db');
