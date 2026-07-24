import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';

import EmbeddedPostgres from 'embedded-postgres';

/**
 * Shared `embedded-postgres` plumbing — the genuinely reusable core extracted from
 * the ephemeral-screenshot flow (PR #43) so BOTH callers ride the same helper
 * instead of copy-pasting a fragile lifecycle:
 *
 *   - `screenshot-ephemeral.ts` → a THROWAWAY DB (temp dir, `persistent: false`, torn
 *     down each run) for data-dependent screenshots that must never touch Neon;
 *   - `dev-local.ts` → a PERSISTENT local sandbox DB (fixed dir, `persistent: true`,
 *     data survives restarts) so `pnpm dev` never writes to prod.
 *
 * Both target a real TCP Postgres (no Docker, no creds) and both migrate + seed via
 * the EXISTING `packages/db` scripts. The one inviolable rule this module enforces:
 * **never migrate/seed/connect against a non-local database** (`assertLocalDbUrl`).
 *
 * Next 16 env precedence (verified against `@next/env` `processEnv`, docs/lessons.md):
 * a value already in `process.env` WINS over `.env.local` — so injecting the embedded
 * connection string into the child server's env reliably overrides `.env.local`'s
 * `DATABASE_URL`; no `.env.*` / temp-cwd trick is needed.
 *
 * tsx/CJS caveat (docs/lessons.md): `apps/web` has no `"type":"module"`, so callers
 * wrap their body in `async function main()` rather than using top-level await.
 */

// Shared embedded-Postgres identity. Both flows use the same DB name + superuser;
// each caller supplies its own password + data dir + persistence (constants, not
// re-typed literals — single source per AGENTS.md).
export const EMBEDDED_DB_NAME = 'mat_plan';
export const EMBEDDED_DB_USER = 'postgres';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

export function isLocalDbUrl(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '<unparseable>';
  }
}

/**
 * The hard invariant behind both flows: refuse to migrate/seed/connect against a
 * NON-local database. The embedded target is always local, so this can never fire in
 * normal operation — it's a tripwire against a wiring mistake pointing tooling at Neon.
 */
export function assertLocalDbUrl(url: string, context: string): void {
  if (isLocalDbUrl(url)) return;
  throw new Error(
    `${context}: refusing to target a non-local database (${hostOf(url)}). ` +
      `This flow only ever touches an embedded local Postgres.`,
  );
}

/** Ask the OS for a free ephemeral TCP port (for the screenshot flow's random ports). */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Assert a FIXED port is free, failing with a clear message if it's taken (the dev
 * flow pins its port so the connection string is stable across restarts).
 */
export function assertPortFree(port: number, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `port ${port} is already in use — is another \`pnpm dev\` (or ${label}) already ` +
              `running? Stop it first, or free the port.`,
          ),
        );
      } else {
        reject(err);
      }
    });
    srv.once('listening', () => srv.close(() => resolve()));
    srv.listen(port, '127.0.0.1');
  });
}

export function buildLocalDbUrl(
  port: number,
  opts: { password: string; user?: string; database?: string },
): string {
  const user = opts.user ?? EMBEDDED_DB_USER;
  const database = opts.database ?? EMBEDDED_DB_NAME;
  return `postgresql://${user}:${opts.password}@127.0.0.1:${port}/${database}`;
}

/** Run a workspace script to completion, failing on a non-zero exit. */
export function runScript(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited ${code}`)),
    );
  });
}

/**
 * Migrate + seed the target DB via the EXISTING `packages/db` scripts (do NOT
 * hand-roll). Both are idempotent (migrations are forward-only; the seed uses ON
 * CONFLICT), so this is safe to run on every start. Against embedded PG (no PgBouncer)
 * pooled == unpooled == the same local string. Guards the target is local first.
 */
export async function migrateAndSeed(
  dbUrl: string,
  log: (msg: string) => void = console.log,
): Promise<void> {
  assertLocalDbUrl(dbUrl, 'migrateAndSeed');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: dbUrl,
    DATABASE_URL_UNPOOLED: dbUrl,
  };
  log('▸ migrating…');
  await runScript('pnpm', ['--filter', '@mat-plan/db', 'db:migrate'], env);
  log('▸ seeding catalogs…');
  await runScript('pnpm', ['--filter', '@mat-plan/db', 'db:seed'], env);
}

export interface StartEmbeddedOptions {
  /** Data directory. For a persistent DB this is a fixed, gitignored path. */
  databaseDir: string;
  /** TCP port. Fixed for the persistent dev DB; a free port for screenshots. */
  port: number;
  /** Superuser password — baked into the cluster at initdb time, so it must stay
   *  STABLE for a persistent dir (a changed password can't reconnect). */
  password: string;
  /** `false` → data deleted on stop (throwaway); `true` → data survives (sandbox). */
  persistent: boolean;
  user?: string;
  database?: string;
}

export interface EmbeddedHandle {
  pg: EmbeddedPostgres;
  url: string;
  /** True when the data dir was empty and we initialised a fresh cluster this run. */
  freshCluster: boolean;
}

/**
 * Start an `embedded-postgres` cluster and return its handle + connection URL.
 *
 * First-run detection: an initialised cluster leaves a `PG_VERSION` marker in its data
 * dir. On a persistent dir that already has one we must NOT re-`initialise()` (it
 * repopulates the dir) and must NOT re-`createDatabase()` (it already exists) — we just
 * `start()`. A fresh/empty dir gets the full initialise → start → createDatabase.
 */
export async function startEmbeddedPostgres(opts: StartEmbeddedOptions): Promise<EmbeddedHandle> {
  const user = opts.user ?? EMBEDDED_DB_USER;
  const database = opts.database ?? EMBEDDED_DB_NAME;
  const freshCluster = !existsSync(join(opts.databaseDir, 'PG_VERSION'));
  const pg = new EmbeddedPostgres({
    databaseDir: opts.databaseDir,
    user,
    password: opts.password,
    port: opts.port,
    persistent: opts.persistent,
  });
  if (freshCluster) await pg.initialise();
  await pg.start();
  if (freshCluster) await pg.createDatabase(database);
  const url = buildLocalDbUrl(opts.port, { user, password: opts.password, database });
  assertLocalDbUrl(url, 'startEmbeddedPostgres'); // invariant: the embedded target is local
  return { pg, url, freshCluster };
}

/**
 * Tear down a long-running child process (a `next` server) cleanly. Kills the whole
 * process group (children are spawned `detached`) so no `next` worker is orphaned;
 * SIGKILL fallback after a grace period.
 */
export async function stopChildProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.pid === undefined) return;
  await new Promise<void>((resolve) => {
    child.on('exit', () => resolve());
    try {
      process.kill(-child.pid!, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
    setTimeout(() => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        /* already gone */
      }
      resolve();
    }, 5_000);
  });
}
