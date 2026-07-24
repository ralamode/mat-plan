import { type ChildProcess, spawn } from 'node:child_process';
import { join } from 'node:path';

import {
  assertLocalDbUrl,
  assertPortFree,
  migrateAndSeed,
  startEmbeddedPostgres,
  stopChildProcess,
} from './embedded-pg';
import { LOCAL_DB_DIR, LOCAL_DB_PASSWORD, LOCAL_DB_PORT } from './local-db';

/**
 * The SAFE-DEFAULT local dev launcher (chore/local-dev-db).
 *
 * `pnpm dev` used to run `next dev`, which reads `apps/web/.env.local` → the LIVE Neon
 * DB — so playing with the product locally wrote real rows into the kids' prod log
 * (where the duplicate test rows came from). This launcher makes the default `pnpm dev`
 * target a PERSISTENT local embedded Postgres instead: Ray can play freely, his
 * play-data survives restarts (persistent data dir), and Neon is never touched. The
 * old live-Neon behavior is the deliberate opt-in `pnpm dev:prod`.
 *
 * Flow (in order):
 *   1. assert the fixed local port is free (fail clearly if a dev server is already up);
 *   2. start a PERSISTENT `embedded-postgres` on that port with a fixed, gitignored data
 *      dir (real TCP Postgres, no Docker/creds) — first run initialises the cluster,
 *      later runs reuse the on-disk data (that's the point: data persists);
 *   3. migrate + seed it via the EXISTING `packages/db` scripts (both idempotent);
 *   4. spawn `next dev` with `DATABASE_URL`/`DATABASE_URL_UNPOOLED` set to the LOCAL
 *      connection string in the child env — these WIN over `.env.local` per the Next
 *      env-precedence fact (docs/lessons.md). `ACCESS_GATE_PASSWORD` is deliberately
 *      NOT overridden, so `next dev` reads it from `.env.local` and Ray's gate login
 *      keeps working;
 *   5. on SIGINT/SIGTERM/child-exit, stop the PG process cleanly — the DATA dir
 *      persists on disk for the next `pnpm dev`.
 *
 * The mirror of the screenshot flow's philosophy: local isolation is the default; prod
 * is the deliberate exception. Wipe the sandbox with `pnpm db:local:reset`.
 *
 * tsx/CJS caveat (docs/lessons.md): `apps/web` has no `"type":"module"`, so the body is
 * wrapped in `async function main()` rather than top-level await.
 */

function printBanner(freshCluster: boolean): void {
  const state = freshCluster ? 'fresh cluster initialised' : 'reusing persisted data';
  console.log(
    '\n' +
      `▸ dev on LOCAL embedded Postgres (data: ${LOCAL_DB_DIR}, ${state}) — prod Neon untouched.\n` +
      '  Your play-data survives restarts. Use `pnpm dev:prod` for live Neon data, ' +
      '`pnpm db:local:reset` to wipe.\n',
  );
}

async function main(): Promise<void> {
  await assertPortFree(LOCAL_DB_PORT, 'embedded Postgres');

  console.log(`▸ starting persistent embedded Postgres on 127.0.0.1:${LOCAL_DB_PORT}…`);
  const { pg, url, freshCluster } = await startEmbeddedPostgres({
    databaseDir: LOCAL_DB_DIR,
    port: LOCAL_DB_PORT,
    password: LOCAL_DB_PASSWORD,
    persistent: true,
  });
  // Belt-and-braces: never migrate/seed/connect a non-local DB (the embedded URL is
  // always local, so this can only fire on a wiring bug).
  assertLocalDbUrl(url, 'dev-local');

  let next: ChildProcess | undefined;
  let tornDown = false;
  const teardown = async (): Promise<void> => {
    if (tornDown) return;
    tornDown = true;
    if (next) await stopChildProcess(next);
    // persistent: true → stop() leaves the data dir in place for the next `pnpm dev`.
    await pg.stop().catch(() => {});
    console.log('\n▸ stopped embedded Postgres (data preserved on disk). bye.');
  };

  process.on('SIGINT', () => void teardown().then(() => process.exit(0)));
  process.on('SIGTERM', () => void teardown().then(() => process.exit(0)));

  try {
    // Idempotent every start — safe against the persisted DB (forward-only migrations,
    // ON CONFLICT seed) so it never duplicates Ray's play-data.
    await migrateAndSeed(url);

    // Inject the local DB into `next dev`'s env (wins over .env.local). Deliberately do
    // NOT set ACCESS_GATE_PASSWORD — let next dev read it from .env.local so the gate
    // login keeps working. `...process.env` only carries a gate password if the shell
    // already exported one; we never inject the local override.
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: url,
      DATABASE_URL_UNPOOLED: url,
    };

    printBanner(freshCluster);
    next = spawn(join(process.cwd(), 'node_modules', '.bin', 'next'), ['dev'], {
      stdio: 'inherit',
      env: childEnv,
      detached: true, // own process group → clean group teardown on Ctrl-C
    });
    next.on('exit', (code) => void teardown().then(() => process.exit(code ?? 0)));
  } catch (err) {
    await teardown();
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
