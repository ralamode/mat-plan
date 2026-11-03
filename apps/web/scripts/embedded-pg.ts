import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';

import EmbeddedPostgres from 'embedded-postgres';

import { E2E_SESSION_BYPASS_USER, isLocalDbHost, SEED_HOUSEHOLD_PUBLIC_ID } from '@mat-plan/shared';

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

/**
 * 🔴 **The shared predicate, not a second copy.** This file carried its own `LOCAL_HOSTS` set, which
 * had neither the `?host=` override check nor `[::1]` (the WHATWG parser brackets IPv6 hostnames, as
 * `db-environment.ts` documents). Both injectors cite *this* function as the proof that the bypass
 * may arm — so "two independent proofs of locality" was really one hardened proof plus a copy that
 * had drifted. AGENTS.md → Constants: a derivation used in two places becomes one exported helper.
 *
 * The duplication was cosmetic while this only chose a database. AUTH-1 1c-3a made it decide whether
 * **authentication is on**, which is when it stopped being cosmetic.
 */
export const isLocalDbUrl = isLocalDbHost;

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

/**
 * 🔴 **Give the harness's bypass principal a MEMBERSHIP row — `AUTH-1` 1c-4a.**
 *
 * From `1c-4` the household scope is derived from the principal, not from "the one live household".
 * The harnesses already inject `E2E_SESSION_BYPASS_USER` as the principal (`e2e-local.ts`,
 * `screenshot-ephemeral.ts`, CI's smoke step), but **the seed writes no `household_members` row and
 * `db:verify` asserts that it writes none** — `migrate.yml` seeds PRODUCTION, and this is the one
 * row that must never exist there. Without this step every gated spec would land on an empty picker
 * the moment the resolver changes.
 *
 * ⚠️ **It reuses the committed `household-claim-2026-10-25` correction rather than a new writer**,
 * and the reasons are not stylistic:
 *
 *  - `insertHouseholdMember` is deliberately **not** idempotent (`writers/ownership.ts` says so in
 *    capitals: a collision there is an operator error, not a replay). The correction is, by
 *    read-then-branch — already bound here is a no-op, bound elsewhere is a refusal.
 *  - `verify.ts`'s assertion reads _"the seed writes NO household_members row — **the claim
 *    correction is the only writer**"_. A second writer would make its second clause false while
 *    keeping its first one true, which is the kind of half-true a gate should never be reduced to.
 *  - The correction is dry-run by default and prints the target host, so a mis-run is visible.
 *
 * 🔴 **NOT folded into `migrateAndSeed`, and this is load-bearing.** That function has THREE callers
 * and the third is `dev-local.ts` — `pnpm dev`, against the **persistent** cluster. Two reasons, both
 * about the sandbox rather than about failure: binding a committed fixture principal into a
 * developer's long-lived database is wrong on its own, and `dev-local.ts` injects **no** bypass
 * principal, so the row would be dead weight that a real dev-instance Clerk id can never use. The
 * developer needs `runbooks.md`'s step instead — the same correction with **their** id.
 *
 * ⚠️ **It would NOT crash, and an earlier version of this docblock said it would** — "the second
 * `pnpm dev` would die before `next dev` ever started". False, and self-contradicting four lines
 * above, where the same block argues the correction was chosen *because* it is idempotent. A second
 * identical bind returns `already claimed by this Clerk account — no change` and exits 0, which
 * `verify.ts` asserts by name: _"a re-run is an idempotent no-op, not a duplicate-key crash"_.
 *
 * 📌 **`pnpm dev` is not covered and needs its own answer** (`runbooks.md`): a developer signing in
 * with a real dev-instance account has no membership there either, and the fix is the same
 * correction with THEIR Clerk id — not this one.
 */
export async function linkFixtureMember(
  dbUrl: string,
  log: (msg: string) => void = console.log,
): Promise<void> {
  // Belt: the url we were handed must be local. Braces: the correction itself refuses to bind this
  // principal to a non-local target, resolving it through the same expression the runner connects
  // with (`corrections/target-url.ts`), which covers the path where this function is bypassed.
  //
  // ⚠️ **They are not independent.** Both call `isLocalDbHost`, so an SSH tunnel or an `/etc/hosts`
  // entry pointing `localhost` at a remote address defeats both — it is one proof read twice, not
  // two proofs. Accepted: it needs a deliberate act by the most privileged actor in SECURITY.md's
  // threat model, and there is no cheap second discriminator (production's database is also named
  // `mat_plan`, and its household is also the zero-entropy seed id).
  assertLocalDbUrl(dbUrl, 'linkFixtureMember');
  log('\u25b8 linking the fixture membership\u2026');
  await runScript(
    'pnpm',
    ['--filter', '@mat-plan/db', 'db:correct', 'household-claim-2026-10-25', '--apply'],
    {
      ...process.env,
      // Both, explicitly, so an ambient `DATABASE_URL_UNPOOLED` cannot win the `?? ` in the runner.
      DATABASE_URL: dbUrl,
      DATABASE_URL_UNPOOLED: dbUrl,
      HOUSEHOLD_PUBLIC_ID: SEED_HOUSEHOLD_PUBLIC_ID,
      CLERK_USER_ID: E2E_SESSION_BYPASS_USER,
    },
  );
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
