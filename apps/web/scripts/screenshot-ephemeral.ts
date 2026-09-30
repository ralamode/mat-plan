import { type ChildProcess, spawn } from 'node:child_process';

import type { Page } from '@playwright/test';
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
  DEFAULT_BODYWEIGHT_UNIT,
  DEFAULT_SESSION_TYPE,
  ENTRY_STATUS,
  METRIC_KEYS,
  newId,
  SEED_ACTIVITY_TYPE_KEYS,
  SEED_METRIC_KEYS,
} from '@mat-plan/shared';
import { eq, isNull } from 'drizzle-orm';

import { DEFAULT_TIME_ZONE } from '../lib/constants';
import { addDays, isIanaTimeZone, localDayIso, localWeekStartIso } from '../lib/date';
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

/**
 * GAP-1 P1-1c: a logged session that exercises BOTH status badges — a SKIPPED movement (zero sets)
 * and a movement whose last set is `sub_failure`. Written through the SHIPPED writer, so the capture
 * shows exactly what the app produces rather than a hand-built fixture. This is the read side, which
 * no amount of form interaction can reach.
 */
async function seedStatusBadges(dbUrl: string): Promise<void> {
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
      .limit(2);
    if (movementRows.length < 2) throw new Error('seeded movements not found — did db:seed run?');

    await writeStrengthSession(db, {
      profilePublicId: SEED_PROFILE_PUBLIC_ID,
      day: localDayIso(DEFAULT_TIME_ZONE),
      sessionType: DEFAULT_SESSION_TYPE,
      sessionClientId: newId(),
      activityTypeId: scLift.id,
      movements: [
        {
          // The realistic sub-failure shape: the LAST set failed, the earlier ones didn't — which is
          // precisely what entry-level storage could never express.
          movementName: movementRows[0].name,
          unit: 'lb',
          movementId: movementRows[0].id,
          clientId: newId(),
          sets: [
            { reps: 5, weight: 60 },
            { reps: 5, weight: 60 },
            {
              reps: 2,
              weight: 60,
              status: ENTRY_STATUS.sub_failure,
            },
          ],
        },
        {
          // A skipped movement: zero sets, `drop-if-yellow`.
          movementName: movementRows[1].name,
          unit: 'lb',
          movementId: movementRows[1].id,
          clientId: newId(),
          status: ENTRY_STATUS.skipped,
          sets: [],
        },
      ],
    });
  } finally {
    await pool.end();
  }
}

/**
 * V1-24 PR 1a — write bodyweight rows for the seeded profile, `daysAgo` before today (app zone).
 * Direct inserts, not the Server Action: the duplicate shape is exactly what the UI no longer
 * produces, and a closed day is outside the action's ±1 window by definition.
 */
async function seedWeighIns(
  dbUrl: string,
  rows: readonly { daysAgo: number; value: string }[],
  opts: { backdateProfileDays?: number } = {},
): Promise<void> {
  const pool = createDbPool(dbUrl);
  const db = createDb(pool);
  try {
    const [profile] = await db
      .select({ id: schema.profiles.id })
      .from(schema.profiles)
      .where(eq(schema.profiles.publicId, SEED_PROFILE_PUBLIC_ID))
      .limit(1);
    if (!profile) throw new Error('seeded profile not found — did db:seed run?');
    const [weighIn] = await db
      .select({ id: schema.activityTypes.id })
      .from(schema.activityTypes)
      .where(eq(schema.activityTypes.key, ACTIVITY_TYPE_KEYS.weigh_in))
      .limit(1);

    // A CLOSED day needs a profile older than the ±1 write window: `resolveViewedDay` floors `?d=`
    // at `created_at`, and the seed creates the profile today (the e2e limit day-navigation.spec
    // documents). Throwaway DB only, so moving `created_at` back is safe here.
    if (opts.backdateProfileDays) {
      await db
        .update(schema.profiles)
        .set({ createdAt: new Date(Date.now() - opts.backdateProfileDays * 86_400_000) })
        .where(eq(schema.profiles.id, profile.id));
    }

    const today = localDayIso(DEFAULT_TIME_ZONE);
    if (rows.length > 0) {
      await db.insert(schema.entries).values(
        rows.map((r) => ({
          publicId: newId(),
          clientId: newId(),
          profileId: profile.id,
          activityDate: addDays(today, -r.daysAgo),
          unit: DEFAULT_BODYWEIGHT_UNIT,
          valueNum: r.value,
          activityTypeId: weighIn.id,
          metricKey: SEED_METRIC_KEYS.bodyweight,
          status: ENTRY_STATUS.done,
        })),
      );
    }
    console.log(`✓ seeded ${rows.length} weigh-in(s)`);
  } finally {
    await pool.end();
  }
}

/** The closed days the `bodyweight-closed*` states capture: one with a weight, one without. */
const CLOSED_DAY_WITH_WEIGHT = 5;
const CLOSED_DAY_EMPTY = 4;
const seedClosedDays = (dbUrl: string) =>
  seedWeighIns(dbUrl, [{ daysAgo: CLOSED_DAY_WITH_WEIGHT, value: '84.5' }], {
    backdateProfileDays: 10,
  });

/** Navigate the loaded Today to `?d=<n days ago>` — a closed day, once the profile is backdated. */
const gotoDaysAgo = (n: number) => async (page: Page) => {
  const url = new URL(page.url());
  url.searchParams.set('d', addDays(localDayIso(DEFAULT_TIME_ZONE), -n));
  await page.goto(url.toString(), { waitUntil: 'networkidle' });
};

/** Fixture seeders, keyed by `--state`. `empty` needs none (catalog seed is enough). */
const STATES = {
  empty: null,
  'already-logged': seedAlreadyLogged,
  // V1-6a: several calisthenics bouts today, so the "Calisthenics today" totals card renders.
  calisthenics: seedCalisthenics,
  // V1-8-2: a logged flat multi-movement strength session (via the shipped write core).
  'strength-session': seedStrengthSession,
  // GAP-1 P1-1c — interaction-only states (no fixtures; see INTERACTIONS below).
  'form-skipped': null,
  'form-sub-failure': null,
  // GAP-1 P1-1c — the READ side: a skipped entry badge + a sub-failure set badge.
  'status-badges': seedStatusBadges,
  // V1-19 — the scaffolded form. Interaction-only; needs a PROGRAMMED day, so pair it with
  // `--tz` on a non-strength weekday (e.g. `--tz Pacific/Kiritimati` renders tomorrow).
  'form-scaffolded': null,
  // V1-23 PR 3 — "Today's program" shut. Interaction-only (see INTERACTIONS below).
  'program-collapsed': null,
  // V1-26 PR-A — the BW-tap warning on a catalog-declared-loaded movement. Interaction-only, and
  // like `form-scaffolded` it needs a PROGRAMMED day — pair it with `--tz` if today has none.
  'form-bw-warning': null,
  // V1-24 PR 1b — the weigh-in's OPEN editor. Interaction-only on top of the already-logged
  // fixture: the open state is transient client state no seeder can produce.
  'bodyweight-editing': seedAlreadyLogged,
  // V1-24 PR 1a — the bodyweight receipt's other states (today's single value is `already-logged`).
  // Two rows on today: the pre-1c prod duplicate (or a two-phone race) — `2 weights logged: …`.
  'bodyweight-duplicates': (dbUrl: string) =>
    seedWeighIns(dbUrl, [
      { daysAgo: 0, value: '84.5' },
      { daysAgo: 0, value: '845' },
    ]),
  // A closed day WITH a weight (the receipt, recovery line, no form) and one WITHOUT
  // (`No weight logged.`). Both backdate the profile, then navigate (see INTERACTIONS).
  'bodyweight-closed': seedClosedDays,
  'bodyweight-closed-empty': seedClosedDays,
  // Round 3 on #180 — a save the plausibility bound REJECTS: the alert under the field, the typed value
  // and the chosen unit still there (React 19's form reset used to wipe both). Interaction-only.
  'bodyweight-rejected': null,
} as const;
type StateName = keyof typeof STATES;

/**
 * Post-load interactions, keyed by `--state`. Some UI states only exist AFTER a tap and cannot be
 * seeded: GAP-1 P1-1c's Skipped checkbox collapses the set rows, and the per-set sub-failure toggle
 * marks one attempt. A reviewer approving those needs to see them, so the capture performs the taps.
 * Runs per viewport against a fresh page → must be idempotent from a clean load.
 */
const INTERACTIONS: Partial<Record<StateName, (page: Page) => Promise<void>>> = {
  'bodyweight-closed': gotoDaysAgo(CLOSED_DAY_WITH_WEIGHT),
  'bodyweight-closed-empty': gotoDaysAgo(CLOSED_DAY_EMPTY),
  'bodyweight-rejected': async (page) => {
    const section = page.getByRole('region', { name: 'Bodyweight' });
    await section.getByLabel('Unit').selectOption('kg');
    await section.getByLabel('Weight', { exact: true }).fill('845');
    await section.getByRole('button', { name: 'Log weight' }).click();
    await section.getByRole('alert').waitFor();
  },
  // V1-19 — the whole point of the reviewed design is what the form looks like AFTER the tap:
  // collapsed cards with a per-movement done/total counter, because scaffolding 7 movements × 4 sets
  // renders ~6,600px of blank inputs at 360px otherwise. A reviewer cannot approve that from the
  // before-state, so the capture performs the tap.
  'form-scaffolded': async (page) => {
    const fill = page.getByRole('button', { name: /Fill in today.s movements/i });
    if ((await fill.count()) === 0) {
      throw new Error(
        'no "Fill in today\'s movements" button — this state needs a PROGRAMMED day; pass --tz (e.g. Pacific/Kiritimati) on a non-strength weekday',
      );
    }
    await fill.click();
  },
  // V1-23 PR 3 — the card ships OPEN, so the default capture already shows the expanded state; what a
  // reviewer cannot see there is the thing the PR is for: the form at the top of the screen once the
  // athlete has shut the card. The disclosure is a native `<summary>`, so a click is the whole state.
  'program-collapsed': async (page) => {
    const summary = page.getByRole('region', { name: /Today.s program/ }).locator('summary');
    if ((await summary.count()) === 0) {
      throw new Error(
        'no "Today\'s program" card — this state needs a day the seeded program prescribes movements for',
      );
    }
    await summary.click();
  },
  /**
   * V1-26 PR-A — the whole reviewable surface of the PR is a state that exists only after TWO taps:
   * scaffold the day, then tap BW on a movement the catalog declares loaded. No fixture can seed it,
   * because it is transient client state and was never written to the database.
   *
   * It finds the declared-loaded card by DRIVING THE UI rather than hardcoding a movement name — the
   * YDP rotates A/B on date parity, so which movements are on today's card depends on the day the
   * capture runs. It opens each collapsed card, taps BW, and stops at the first one that warns.
   */
  'form-bw-warning': async (page) => {
    const fill = page.getByRole('button', { name: /Fill in today.s movements/i });
    if ((await fill.count()) === 0) {
      throw new Error(
        'no "Fill in today\'s movements" button — this state needs a PROGRAMMED day; pass --tz (e.g. Pacific/Kiritimati)',
      );
    }
    await fill.click();

    const cards = page.getByRole('button', { name: /^\d+\.\s/ });
    // Card 1 opens by default; the rest are collapsed summaries.
    for (let i = 1; i <= (await cards.count()) + 1; i++) {
      if (i > 1) await page.getByRole('button', { name: new RegExp(`^${i}\\.\\s`) }).click();
      const chip = page.getByRole('checkbox', { name: `BW — Bodyweight — movement ${i} set 1` });
      if ((await chip.count()) === 0) continue;
      // `force`: the chip input is `sr-only` (clipped, so the LABEL can be the 44px tap target), and
      // Playwright's actionability check treats a clipped element as not visible. It is genuinely in
      // the a11y tree — which is why `getByRole` finds it — so the click is real, not a workaround.
      await chip.check({ force: true });
      if ((await page.getByText(/usually logged with a weight/).count()) > 0) return;
      await chip.uncheck({ force: true });
    }
    throw new Error(
      'no catalog-declared-loaded movement on this day — the warning cannot render; try another --tz',
    );
  },
  /**
   * V1-24 PR 1b — the amend, open. The reviewable surface of the PR is a state two taps in: the
   * fixture logs a weight, then Change opens the stacked editor. Worth a state of its own because
   * the LAYOUT is the thing under review — an inline editor would wrap into the gutter at 360px and
   * pass both CI gates while doing it.
   */
  'bodyweight-editing': async (page) => {
    const change = page.getByRole('button', { name: /^Change weight/ });
    if ((await change.count()) === 0) {
      throw new Error(
        'no Change control — this state needs the already-logged fixture to have run',
      );
    }
    await change.click();
  },
  'form-skipped': async (page) => {
    await page.getByLabel(/movement 1 skipped/i).check();
  },
  'form-sub-failure': async (page) => {
    // Build the CROWDED case the panel asked for: 3 sets, one sub-failure, one canonical chip
    // active — a 1-set card hides the width pressure the new control adds at 360px.
    // `exact: true` is LOAD-BEARING: getByLabel is substring + case-insensitive by default, so a
    // bare 'Movement' also matches "Select movement 1 for a superset" and "Movement 1 set 1 reps"
    // → strict-mode violation (docs/lessons.md has this exact trap).
    await page.getByLabel('Movement', { exact: true }).fill('Pull-up');
    await page.getByLabel(/movement 1 set 1 reps/i).fill('5');
    await page.getByLabel('Movement 1 set 1: BW').click(); // chips are `${ctx}: ${label}`
    await page.getByRole('button', { name: /add set/i }).click();
    await page.getByLabel(/movement 1 set 2 reps/i).fill('4');
    await page.getByLabel('Movement 1 set 2: band').click();
    await page.getByRole('button', { name: /add set/i }).click();
    await page.getByLabel(/movement 1 set 3 reps/i).fill('2');
    await page.getByLabel(/movement 1 set 3 weight or load/i).fill('BW');
    await page.getByLabel(/sub-failure — movement 1 set 3/i).check();
  },
};

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
    // V1-24 PR 1a — the weigh-in, so this fixture also renders the bodyweight RECEIPT. Added here
    // rather than as a second `--state`: "this day has stuff logged" is exactly what this fixture
    // already means, and the receipt is the same already-logged read state the check-in rows show.
    const [weighIn] = await db
      .select({ id: schema.activityTypes.id })
      .from(schema.activityTypes)
      .where(eq(schema.activityTypes.key, ACTIVITY_TYPE_KEYS.weigh_in))
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
        {
          publicId: newId(),
          clientId: newId(),
          profileId: profile.id,
          activityDate: day,
          unit: DEFAULT_BODYWEIGHT_UNIT,
          // A DECIMAL on purpose: the receipt must render `84.5 lb`, not `84.50` or `85` — the
          // value is a JS number at the DTO boundary and must not be re-formatted.
          valueNum: '84.5',
          activityTypeId: weighIn.id,
          metricKey: SEED_METRIC_KEYS.bodyweight,
          status: ENTRY_STATUS.done,
        },
      ])
      .onConflictDoNothing({
        target: schema.entries.clientId,
        where: isNull(schema.entries.deletedAt),
      });
    console.log(
      '✓ seeded already-logged fixture (rice_bucket habit + brush_teeth:stance + a weigh-in)',
    );
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
    await captureScreenshot({ route, baseUrl, name, timeZone, interact: INTERACTIONS[state] });
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
