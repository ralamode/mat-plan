import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertLocalDbUrl,
  freePort,
  migrateAndSeed,
  startEmbeddedPostgres,
  stopChildProcess,
} from './embedded-pg';

/**
 * Run the Playwright smoke LOCALLY against a throwaway database (`pnpm e2e:local`).
 *
 * The last local/CI parity gap (docs/tech-debt.md → "Local/CI parity gaps"): bare
 * `pnpm --filter web e2e` boots the prod app via `playwright.config.ts`'s `webServer`
 * but provisions **no database** — it inherits whatever `DATABASE_URL` is around
 * (`.env.local` → live Neon). So the smoke was CI-only, and a smoke failure surfaced
 * only after a push. This wrapper supplies the missing piece — the database — the same
 * way CI does (migrate + seed a disposable Postgres, then run `playwright test`),
 * except the Postgres is `embedded-postgres` rather than a Docker service container.
 *
 * It is deliberately the SAME shape as `screenshot-ephemeral.ts` (boot embedded PG →
 * migrate → seed → run Playwright, which builds/starts the prod server itself → tear
 * everything down in `finally`), and rides the shared `embedded-pg.ts` helper rather
 * than re-implementing the lifecycle.
 *
 * EPHEMERAL, never the `pnpm dev` sandbox: the smoke logs bodyweight and check-ins, so
 * pointing it at the persistent `.local-db` would silently pollute Ray's play-data (and
 * the "already logged today" specs would then fail on the second run — see
 * docs/lessons.md). Temp data dir + `persistent: false` → the cluster is deleted on exit.
 *
 * Injected env wins over `.env.local` for the `next start` child (Next 16 `@next/env`
 * precedence — docs/lessons.md), so the app under test always talks to the embedded DB:
 *   - `DATABASE_URL` / `DATABASE_URL_UNPOOLED` → the embedded cluster (no PgBouncer
 *     locally, so pooled == unpooled == the same string);
 *   - `ACCESS_GATE_PASSWORD` → a fixed local code, matching what `gateLogin` reads;
 *   - `E2E_PORT` → a free port, so the run can never collide with (or, via the config's
 *     `reuseExistingServer`, silently ATTACH to) a `pnpm dev` server already running.
 *
 * Usage:
 *   pnpm e2e:local                              # whole smoke (chromium + a11y)
 *   pnpm e2e:local --project=chromium           # extra args pass through to playwright
 *   pnpm e2e:local e2e/log-bodyweight.spec.ts   # …including a single spec
 *
 * tsx/CJS caveat (docs/lessons.md): `apps/web` has no `"type":"module"`, so the body is
 * wrapped in `async function main()` rather than using top-level await.
 */

// Throwaway-cluster password (DB name + superuser come from the shared helper).
const EPHEMERAL_DB_PASSWORD = 'e2e-local';
// The access-gate code for the throwaway server. We own BOTH sides (the server's env and
// `gateLogin`), so a fixed, obviously-fake value ≥8 chars satisfies `env.ts` and is not a
// secret. Low-entropy on purpose — a random-looking placeholder trips gitleaks (lessons.md).
const E2E_LOCAL_GATE_PASSWORD = 'e2e-local-placeholder';

async function main(): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), 'mat-plan-e2e-pg-'));
  const pgPort = await freePort();

  console.log(`▸ starting ephemeral embedded Postgres on 127.0.0.1:${pgPort} (data: ${dataDir})…`);
  const { pg, url: dbUrl } = await startEmbeddedPostgres({
    databaseDir: dataDir,
    port: pgPort,
    password: EPHEMERAL_DB_PASSWORD,
    persistent: false,
  });
  // Belt-and-braces: never migrate/seed/test against a non-local DB (the embedded URL is
  // always local, so this can only fire on a wiring bug).
  assertLocalDbUrl(dbUrl, 'e2e:local');

  let playwright: ChildProcess | undefined;
  let tornDown = false;
  const teardown = async (): Promise<void> => {
    if (tornDown) return;
    tornDown = true;
    if (playwright) await stopChildProcess(playwright);
    // persistent: false → stop() deletes the cluster; the temp dir goes with it.
    await pg.stop().catch(() => {});
    await rm(dataDir, { recursive: true, force: true });
    console.log('▸ torn down ephemeral Postgres + temp dir');
  };
  // Ctrl-C mid-run must not leave a stray postgres holding the temp dir.
  process.on('SIGINT', () => void teardown().then(() => process.exit(130)));
  process.on('SIGTERM', () => void teardown().then(() => process.exit(143)));

  try {
    // Migrate + seed via the EXISTING packages/db scripts — exactly what CI's e2e job
    // does before `pnpm --filter web e2e` (ci.yml), so local and CI start from the same
    // database state.
    await migrateAndSeed(dbUrl);

    const appPort = await freePort();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: dbUrl,
      DATABASE_URL_UNPOOLED: dbUrl,
      ACCESS_GATE_PASSWORD: E2E_LOCAL_GATE_PASSWORD,
      E2E_PORT: String(appPort),
    };

    console.log(`▸ running playwright (app on http://localhost:${appPort}; first run builds)…`);
    const args = ['test', ...process.argv.slice(2)];
    const exitCode = await new Promise<number>((resolve, reject) => {
      playwright = spawn(join(process.cwd(), 'node_modules', '.bin', 'playwright'), args, {
        stdio: 'inherit',
        env,
      });
      playwright.on('error', reject);
      playwright.on('exit', (code) => resolve(code ?? 1));
    });
    playwright = undefined; // already exited; nothing to kill in teardown
    await teardown();
    process.exit(exitCode);
  } catch (err) {
    await teardown();
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
