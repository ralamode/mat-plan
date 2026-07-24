import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDb, createDbPool, schema, SEED_PROFILE_PUBLIC_ID } from '@mat-plan/db';
import { ACTIVITY_TYPE_KEYS, ENTRY_STATUS, METRIC_KEYS, newId } from '@mat-plan/shared';
import { eq, isNull } from 'drizzle-orm';

import { DEFAULT_TIME_ZONE } from '../lib/constants';
import { localDayIso } from '../lib/date';
import { captureScreenshot, routeSlug } from './capture';
import {
  freePort,
  isLocalDbUrl,
  migrateAndSeed,
  runScript,
  startEmbeddedPostgres,
  stopChildProcess,
} from './embedded-pg';

/**
 * The DURABLE FIX for the screenshot flow (chore/screenshot-ephemeral-db).
 *
 * The old `screenshot` script boots a prod server that reads `apps/web/.env.local`
 * → the LIVE Neon DB, so capturing a data-dependent state (e.g. an "already-logged"
 * check-in) writes real rows into the kids' log. This wrapper makes the DEFAULT
 * screenshot path target a THROWAWAY embedded Postgres, so it never touches Neon and
 * data-dependent states can be captured by seeding the throwaway DB.
 *
 * Flow (default, self-contained):
 *   1. start an `embedded-postgres` instance on a free port + temp data dir (real
 *      TCP Postgres, no Docker, no creds — the app connects via pg over TCP);
 *   2. migrate + seed it by invoking the EXISTING `packages/db` scripts;
 *   3. optionally seed fixture rows for a named `--state` (e.g. `already-logged`);
 *   4. boot the prod Next server (`next start`) with the embedded DB in its env;
 *   5. capture the route via the shared Playwright/gate-login path;
 *   6. tear EVERYTHING down in `finally` (server + embedded PG + temp dir).
 *
 * Next 16 env precedence (verified against node_modules/@next/env `processEnv`): a
 * value already in `process.env` WINS over `.env.local` — `.env.local` keys are only
 * applied when the key is undefined in the initial env snapshot. So injecting the
 * embedded connection string into the server's environment reliably overrides any
 * `.env.local` DATABASE_URL; no `.env.screenshot` / temp-cwd trick is needed.
 *
 * Safety guard (the actual durable fix): the default uses the ephemeral DB;
 * targeting a NON-LOCAL DATABASE_URL (live Neon) requires an explicit opt-in
 * (`--use-live-db` or `SCREENSHOT_ALLOW_LIVE_DB=1`), else it refuses.
 *
 * Usage:
 *   pnpm --filter web screenshot:ephemeral /                     # empty home
 *   pnpm --filter web screenshot:ephemeral /p --state already-logged   # seeded Today
 *   pnpm --filter web screenshot:ephemeral / --use-live-db       # old behavior (opt-in)
 *
 * tsx/CJS caveat (docs/lessons.md): apps/web has no `"type":"module"`, so the body is
 * wrapped in `async function main()` rather than top-level await.
 */

// Throwaway-DB password (name + user come from the shared embedded-pg helper).
const EPHEMERAL_DB_PASSWORD = 'screenshot';
// The access-gate code for the throwaway server. We own BOTH sides (server env +
// gateLogin), so a fixed value ≥8 chars satisfies env.ts and needs no real secret.
const SCREENSHOT_GATE_PASSWORD = 'screenshot-ephemeral';
// Bare `/p` (no id) → the seeded profile's Today page (where the check-ins form lives).
const SEED_PROFILE_ROUTE = `/p/${SEED_PROFILE_PUBLIC_ID}`;

/** Fixture seeders, keyed by `--state`. `empty` needs none (catalog seed is enough). */
const STATES = {
  empty: null,
  'already-logged': seedAlreadyLogged,
  // V1-6a: several calisthenics bouts today, so the "Calisthenics today" totals card renders.
  calisthenics: seedCalisthenics,
} as const;
type StateName = keyof typeof STATES;

/**
 * The teeth of the durable fix: refuse a non-local DB target unless explicitly
 * opted in. Local (embedded) targets always pass; live Neon needs `--use-live-db`.
 * (Screenshot-specific: the shared helper's `assertLocalDbUrl` has no opt-in; this
 * flow keeps its `--use-live-db` escape hatch.)
 */
function assertDbTargetAllowed(url: string, allowLive: boolean): void {
  if (isLocalDbUrl(url)) return;
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '<unparseable>';
    }
  })();
  if (allowLive) {
    console.warn(
      `⚠️  --use-live-db: screenshotting against a NON-LOCAL database (${host}). ` +
        `Data-dependent captures write REAL rows. This is the deliberate exception.`,
    );
    return;
  }
  throw new Error(
    `Refusing to screenshot against a non-local database (${host}). The screenshot flow ` +
      `uses a throwaway embedded Postgres by default; to target a live DB deliberately, ` +
      `pass --use-live-db or set SCREENSHOT_ALLOW_LIVE_DB=1.`,
  );
}

/** Seed the "already-logged" check-in state: one habit + one brush-teeth metric today. */
async function seedAlreadyLogged(dbUrl: string): Promise<void> {
  const pool = createDbPool(dbUrl);
  const db = createDb(pool);
  try {
    const [profile] = await db
      .select({ id: schema.profiles.id })
      .from(schema.profiles)
      .where(eq(schema.profiles.publicId, SEED_PROFILE_PUBLIC_ID))
      .limit(1);
    if (!profile) throw new Error('seeded profile not found — did db:seed run?');

    // Resolve catalog rows from the seeded DB (same DB-truth resolution logCheckinEntries
    // does) so the written `unit`/`activity_type_id` come from reference data, not literals.
    const [habit] = await db
      .select({ id: schema.activityTypes.id, defaultUnit: schema.activityTypes.defaultUnit })
      .from(schema.activityTypes)
      .where(eq(schema.activityTypes.key, ACTIVITY_TYPE_KEYS.rice_bucket))
      .limit(1);
    const [brush] = await db
      .select({ id: schema.activityTypes.id })
      .from(schema.activityTypes)
      .where(eq(schema.activityTypes.key, ACTIVITY_TYPE_KEYS.brush_teeth))
      .limit(1);
    const [stance] = await db
      .select({ key: schema.metricDefinitions.key, unit: schema.metricDefinitions.unit })
      .from(schema.metricDefinitions)
      .where(eq(schema.metricDefinitions.key, METRIC_KEYS.stance))
      .limit(1);

    const day = localDayIso(DEFAULT_TIME_ZONE);
    // Mirrors logCheckinEntries' shape exactly: ALWAYS value_num='1', NEVER movement_name,
    // metric_key NULL for a bare habit (the entries_shape_check trap — see the DAL note).
    await db
      .insert(schema.entries)
      .values([
        {
          publicId: newId(),
          clientId: newId(),
          profileId: profile.id,
          activityDate: day,
          unit: habit.defaultUnit ?? 'bool',
          valueNum: '1',
          activityTypeId: habit.id,
          metricKey: null,
          status: ENTRY_STATUS.done,
        },
        {
          publicId: newId(),
          clientId: newId(),
          profileId: profile.id,
          activityDate: day,
          unit: stance.unit,
          valueNum: '1',
          activityTypeId: brush.id,
          metricKey: stance.key,
          status: ENTRY_STATUS.done,
        },
      ])
      .onConflictDoNothing({
        target: schema.entries.clientId,
        where: isNull(schema.entries.deletedAt),
      });
    console.log('✓ seeded already-logged fixture (rice_bucket habit + brush_teeth:stance)');
  } finally {
    await pool.end();
  }
}

/**
 * Seed a realistic V1-6a day — the "fixed" state (contrast the duplicated-data bug). A couple
 * of log-once habits (each ONE row, no re-submit dupes) + several calisthenics bouts (push-ups
 * in TWO bouts → grouped into ONE row: "20, 30 · 2 sets"; pull-ups once). Same row shape as
 * `logCheckinEntries`: kind NULL, value_num set, unit from the DB catalog row.
 */
async function seedCalisthenics(dbUrl: string): Promise<void> {
  const pool = createDbPool(dbUrl);
  const db = createDb(pool);
  try {
    const [profile] = await db
      .select({ id: schema.profiles.id })
      .from(schema.profiles)
      .where(eq(schema.profiles.publicId, SEED_PROFILE_PUBLIC_ID))
      .limit(1);
    if (!profile) throw new Error('seeded profile not found — did db:seed run?');

    const activityId = async (key: string) => {
      const [row] = await db
        .select({ id: schema.activityTypes.id, defaultUnit: schema.activityTypes.defaultUnit })
        .from(schema.activityTypes)
        .where(eq(schema.activityTypes.key, key))
        .limit(1);
      return row;
    };
    const metric = async (key: string) => {
      const [row] = await db
        .select({ key: schema.metricDefinitions.key, unit: schema.metricDefinitions.unit })
        .from(schema.metricDefinitions)
        .where(eq(schema.metricDefinitions.key, key))
        .limit(1);
      return row;
    };
    const calisthenics = await activityId(ACTIVITY_TYPE_KEYS.calisthenics);
    const riceBucket = await activityId(ACTIVITY_TYPE_KEYS.rice_bucket);
    const splits = await activityId(ACTIVITY_TYPE_KEYS.splits);
    const pushups = await metric(METRIC_KEYS.pushups);
    const pullups = await metric(METRIC_KEYS.pullups);

    const day = localDayIso(DEFAULT_TIME_ZONE);
    const base = () => ({
      publicId: newId(),
      clientId: newId(),
      profileId: profile.id,
      activityDate: day,
      valueNum: '1',
      status: ENTRY_STATUS.done,
    });
    const bout = (m: { key: string; unit: string }, value: string) => ({
      ...base(),
      unit: m.unit,
      valueNum: value,
      activityTypeId: calisthenics.id,
      metricKey: m.key,
    });
    const habit = (a: { id: number; defaultUnit: string | null }) => ({
      ...base(),
      unit: a.defaultUnit ?? 'bool',
      activityTypeId: a.id,
      metricKey: null,
    });
    // Two habits (ONE row each) + two push-up bouts (grouped) + one pull-up set.
    await db
      .insert(schema.entries)
      .values([
        habit(riceBucket),
        habit(splits),
        bout(pushups, '20'),
        bout(pushups, '30'),
        bout(pullups, '12'),
      ])
      .onConflictDoNothing({
        target: schema.entries.clientId,
        where: isNull(schema.entries.deletedAt),
      });
    console.log(
      '✓ seeded calisthenics fixture (rice_bucket + splits habits; push-ups 20+30, pull-ups 12)',
    );
  } finally {
    await pool.end();
  }
}

/** Poll the running server until the gate route responds (or time out). */
async function waitForServer(baseUrl: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/gate`);
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not become ready at ${baseUrl} within ${timeoutMs}ms`);
}

async function runEphemeral(route: string, state: StateName, name: string): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), 'mat-plan-screenshot-pg-'));
  const pgPort = await freePort();
  let server: ChildProcess | undefined;
  // Throwaway cluster: temp dir + persistent:false → the helper initialises a fresh
  // cluster now and stop() DELETES the data in `finally`.
  const { pg, url: dbUrl } = await startEmbeddedPostgres({
    databaseDir: dataDir,
    port: pgPort,
    password: EPHEMERAL_DB_PASSWORD,
    persistent: false,
  });
  try {
    console.log(`▸ started embedded Postgres on 127.0.0.1:${pgPort} (data: ${dataDir})`);
    assertDbTargetAllowed(dbUrl, false); // invariant: the embedded target is always local

    // Migrate + seed via the EXISTING packages/db scripts (shared helper; do NOT
    // hand-roll). Against embedded PG (no PgBouncer) pooled == unpooled == same string.
    await migrateAndSeed(dbUrl);

    const seedFixture = STATES[state];
    if (seedFixture) await seedFixture(dbUrl);

    // Ensure a prod build exists (reuse `.next` when present; `--build` forces a rebuild).
    const serverEnv: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: dbUrl,
      DATABASE_URL_UNPOOLED: dbUrl,
      ACCESS_GATE_PASSWORD: SCREENSHOT_GATE_PASSWORD,
    };
    const forceBuild = process.argv.includes('--build');
    if (forceBuild || !existsSync(join(process.cwd(), '.next', 'BUILD_ID'))) {
      console.log('▸ building (next build)…');
      await runScript('pnpm', ['--filter', 'web', 'build'], serverEnv);
    }

    // Boot the prod server on a free port with the embedded DB in its env (wins over
    // .env.local per the precedence note above). Detached → clean process-group teardown.
    const appPort = await freePort();
    const baseUrl = `http://localhost:${appPort}`;
    console.log(`▸ starting next server on ${baseUrl}…`);
    server = spawn(
      join(process.cwd(), 'node_modules', '.bin', 'next'),
      ['start', '-p', String(appPort)],
      { stdio: 'inherit', env: serverEnv, detached: true },
    );
    await waitForServer(baseUrl);

    // gateLogin reads ACCESS_GATE_PASSWORD from our env — match the server's gate code.
    process.env.ACCESS_GATE_PASSWORD = SCREENSHOT_GATE_PASSWORD;
    await captureScreenshot({ route, baseUrl, name });
  } finally {
    if (server) await stopChildProcess(server);
    await pg.stop().catch(() => {});
    await rm(dataDir, { recursive: true, force: true });
    console.log('▸ torn down embedded Postgres + temp dir');
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const stateFlagIdx = argv.indexOf('--state');
  const rawState = stateFlagIdx >= 0 ? argv[stateFlagIdx + 1] : 'empty';
  if (!rawState || !(rawState in STATES)) {
    throw new Error(
      `unknown --state "${rawState}". known states: ${Object.keys(STATES).join(', ')}`,
    );
  }
  const state = rawState as StateName;
  const allowLive = argv.includes('--use-live-db') || process.env.SCREENSHOT_ALLOW_LIVE_DB === '1';

  // First non-flag token is the route (skip the value consumed by --state).
  const positionals = argv.filter((a, i) => !a.startsWith('-') && i !== stateFlagIdx + 1);
  let route = positionals[0] ?? '/';
  if (route === '/p') route = SEED_PROFILE_ROUTE; // shorthand → seeded profile's Today page
  const base = route === SEED_PROFILE_ROUTE ? 'today' : routeSlug(route);
  const name = state === 'empty' ? base : `${base}-${state}`;

  if (allowLive) {
    // OPT-IN: the OLD behavior — capture against a server the caller has already started
    // (it reads its own env, possibly live Neon). This path is the deliberate exception.
    const baseUrl = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:3996';
    assertDbTargetAllowed(process.env.DATABASE_URL ?? 'postgresql://x@localhost/x', true);
    console.warn(
      '⚠️  --use-live-db: capturing against the already-running server (no embedded DB).',
    );
    await captureScreenshot({ route, baseUrl, name });
    return;
  }

  await runEphemeral(route, state, name);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
