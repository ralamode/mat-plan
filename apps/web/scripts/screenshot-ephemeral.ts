import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createDb,
  createDbPool,
  schema,
  SEED_PROFILE_PUBLIC_ID,
  writeStrengthSession,
} from '@mat-plan/db';
import {
  ACTIVITY_TYPE_KEYS,
  DEFAULT_SESSION_TYPE,
  ENTRY_STATUS,
  METRIC_KEYS,
  newId,
  SEED_ACTIVITY_TYPE_KEYS,
} from '@mat-plan/shared';
import { eq, isNull } from 'drizzle-orm';

import { DEFAULT_TIME_ZONE } from '../lib/constants';
import { isIanaTimeZone, localDayIso, localWeekStartIso } from '../lib/date';
import { SEED_PROFILE_ROUTE } from '../e2e/steps';
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
// Bare `/p` (no id) → the seeded profile's Today page (where the check-ins form lives). The route is
// single-sourced in `e2e/steps.ts` (V1-12) — the a11y spec and the smoke need the same one.

/** Fixture seeders, keyed by `--state`. `empty` needs none (catalog seed is enough). */
const STATES = {
  empty: null,
  'already-logged': seedAlreadyLogged,
  // V1-6a: several calisthenics bouts today, so the "Calisthenics today" totals card renders.
  calisthenics: seedCalisthenics,
  // V1-8-2: a logged flat multi-movement strength session (via the shipped write core).
  'strength-session': seedStrengthSession,
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

    // V1-6b-2: a ramp target per logged metric for THIS ISO week, so the "This week" <progress>
    // bars render (the shipped schedule is empty). Targets above the seeded actuals (push-ups 50,
    // pull-ups 12) → partially-filled bars.
    const weekStart = localWeekStartIso(day);
    await db
      .insert(schema.rampTargets)
      .values([
        {
          publicId: newId(),
          profileId: profile.id,
          metricKey: pushups.key,
          weekStart,
          targetValue: '60',
        },
        {
          publicId: newId(),
          profileId: profile.id,
          metricKey: pullups.key,
          weekStart,
          targetValue: '15',
        },
      ])
      .onConflictDoNothing({
        target: [
          schema.rampTargets.profileId,
          schema.rampTargets.metricKey,
          schema.rampTargets.weekStart,
        ],
        where: isNull(schema.rampTargets.deletedAt),
      });
    console.log(
      '✓ seeded calisthenics fixture (habits; push-ups 20+30, pull-ups 12; ramp targets 60/15)',
    );
  } finally {
    await pool.end();
  }
}

/**
 * V1-8-2: a logged multi-movement strength SESSION today, seeded THROUGH the shipped write core
 * (`writeStrengthSession`) — so the screenshot shows the real flat-session rows, and the fixture
 * dogfoods the same path the app + `db:verify` use. Two movements (2 sets + 1 set) render flat in
 * the "Logged entries" list (session grouping is V1-8-3).
 */
async function seedStrengthSession(dbUrl: string): Promise<void> {
  const pool = createDbPool(dbUrl);
  const db = createDb(pool);
  try {
    const [scLift] = await db
      .select({ id: schema.activityTypes.id })
      .from(schema.activityTypes)
      .where(eq(schema.activityTypes.key, SEED_ACTIVITY_TYPE_KEYS.scLift))
      .limit(1);
    if (!scLift) throw new Error('sc_lift activity type not seeded — did db:seed run?');
    const movementRows = await db
      .select({ id: schema.movements.id, name: schema.movements.name })
      .from(schema.movements)
      .limit(3);
    if (movementRows.length < 3) throw new Error('seeded movements not found — did db:seed run?');

    // V1-8-3d: one standalone movement + a 2-movement SUPERSET, so the screenshot shows the bracket.
    const supersetClientId = newId();
    await writeStrengthSession(db, {
      profilePublicId: SEED_PROFILE_PUBLIC_ID,
      day: localDayIso(DEFAULT_TIME_ZONE),
      sessionType: DEFAULT_SESSION_TYPE,
      sessionClientId: newId(),
      activityTypeId: scLift.id,
      feel: 'strong, easy warmup', // V1-8-3b: session feel shows in the block header
      supersets: [{ clientId: supersetClientId }],
      movements: [
        {
          movementName: movementRows[0].name,
          unit: 'lb',
          movementId: movementRows[0].id,
          clientId: newId(),
          sets: [
            { reps: 5, weight: 135 },
            { reps: 5, weight: 155 },
          ],
        },
        {
          movementName: movementRows[1].name,
          unit: 'lb',
          movementId: movementRows[1].id,
          clientId: newId(),
          sets: [{ reps: 8, weight: 95 }],
          supersetClientId,
          supersetOrder: 1,
        },
        {
          movementName: movementRows[2].name,
          unit: 'lb',
          movementId: movementRows[2].id,
          clientId: newId(),
          sets: [{ reps: 10, weight: 30 }],
          supersetClientId,
          supersetOrder: 2,
        },
      ],
    });
    console.log(
      `✓ seeded strength-session fixture (${movementRows[0].name} standalone + ${movementRows[1].name}/${movementRows[2].name} superset)`,
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

async function runEphemeral(
  route: string,
  state: StateName,
  name: string,
  timeZone?: string,
): Promise<void> {
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
    await captureScreenshot({ route, baseUrl, name, timeZone });
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

  // `--tz <IANA>` emulates the browser's zone, so a weekday-conditional screen (V1-10's Mon/Wed/Fri
  // program card) can be captured on any host day — the app derives "today" from the DEVICE zone
  // (V1-6c). E.g. `--tz Pacific/Kiritimati` (UTC+14) renders tomorrow's local day.
  const tzFlagIdx = argv.indexOf('--tz');
  const timeZone = tzFlagIdx >= 0 ? argv[tzFlagIdx + 1] : undefined;
  // Validated with the SAME helper the app uses on the `tz` cookie — so `--tz --state calisthenics`
  // (value swallowed by the next flag) fails here with a clear message instead of deep inside Playwright.
  if (tzFlagIdx >= 0 && !isIanaTimeZone(timeZone)) {
    throw new Error(
      `--tz requires a valid IANA zone (e.g. America/New_York), got: ${timeZone ?? ''}`,
    );
  }

  // First non-flag token is the route (skip the values consumed by --state / --tz).
  const consumed = new Set([stateFlagIdx + 1, tzFlagIdx + 1].filter((i) => i > 0));
  const positionals = argv.filter((a, i) => !a.startsWith('-') && !consumed.has(i));
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
    await captureScreenshot({ route, baseUrl, name, timeZone });
    return;
  }

  await runEphemeral(route, state, name, timeZone);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
