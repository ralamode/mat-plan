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
  SEED_PROFILE_3_PUBLIC_ID,
  SEED_PROFILE_PUBLIC_ID,
} from '@mat-plan/db';
import {
  ACTIVITY_TYPE_KEYS,
  addDays,
  CLEAR_DAY_CONFIRM_WORD,
  DEFAULT_BODYWEIGHT_UNIT,
  E2E_SESSION_BYPASS_USER,
  ENTRY_STATUS,
  MAX_HOUSEHOLD_ATHLETES,
  METRIC_KEYS,
  newId,
  PROFILE_KIND,
  PROFILE_KIND_LABELS,
  type ProfileKind,
  SEED_METRIC_KEYS,
  SEED_PROFILE_3_NAME,
  SEED_PROFILE_NAME,
} from '@mat-plan/shared';
import { eq, isNull, sql } from 'drizzle-orm';

import {
  APP_HOME_PATH,
  ATHLETE_FORM_COPY,
  BODYWEIGHT_COPY,
  CLEAR_DAY_COPY,
  RESTORE_ALL_ID,
  DEFAULT_TIME_ZONE,
  LIFE_COPY,
  PRACTICE_COPY,
  NAV_RAIL_COPY,
  SETTINGS_PATH,
} from '../lib/constants';
import { isIanaTimeZone, localDayIso } from '../lib/date';
import {
  bodyweightSection,
  changePrefix,
  logPractice,
  openIfCollapsed,
  PRACTICE_MINUTES,
  SEED_PROFILE_ROUTE,
} from '../e2e/steps';
import { captureScreenshot, routeSlug } from './capture';
import { DAY_COPY, PROGRAM_COPY } from '../components/day/day-copy';
import {
  BUILDER_COPY,
  EDITOR_COPY,
  PUT_ON_COPY,
  ITEM_PICKER_COPY,
} from '../components/program-builder/builder-text';
import { MOVEMENT_PICKER_COPY as PICKER_COPY } from '../lib/movements/movement-picker-copy';
import { MODALITY_LABELS, MOVEMENT_FAMILY_LABELS, MUSCLE, MUSCLE_LABELS } from '@mat-plan/shared';
import {
  freePort,
  isLocalDbUrl,
  linkFixtureMember,
  migrateAndSeed,
  runScript,
  startEmbeddedPostgres,
  stopChildProcess,
} from './embedded-pg';
import { runUnderSlot } from '../../../.github/scripts/heavy-slot.mjs';

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
 *   5. capture the route via the shared Playwright/login path;
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
 *   pnpm --filter web screenshot:ephemeral /design/tokens --theme dark # the dark half (UI-4)
 *   pnpm --filter web screenshot:ephemeral / --use-live-db       # old behavior (opt-in)
 *
 * tsx/CJS caveat (docs/lessons.md): apps/web has no `"type":"module"`, so the body is
 * wrapped in `async function main()` rather than top-level await.
 */

// Throwaway-DB password (name + user come from the shared embedded-pg helper).
const EPHEMERAL_DB_PASSWORD = 'screenshot';
// Bare `/p` (no id) → the seeded profile's Today page (where the check-ins form lives). The route is
// single-sourced in `e2e/steps.ts` (V1-12) — the a11y spec and the smoke need the same one.

/**
 * ONB-0 — the picker with NO athletes, i.e. the explained first-run empty state.
 *
 * This is the one state in the app that NOTHING could render before: `embedded-pg.ts` seeds
 * unconditionally for both the e2e and this harness, and every other `--state` only ever seeds MORE
 * rows. So the screen ONB-0 is about could not be screenshotted, which would have meant a reviewer
 * approving an all-copy change nobody had seen rendered.
 *
 * SOFT delete, not `DELETE FROM profiles`: `listProfiles` filters on `deleted_at`
 * (`lib/dal/profiles.ts`), so hiding the rows is enough — and a hard delete would hit the FKs from
 * `entries` and `ramp_targets` that the seed has already written.
 *
 * ⚠️ Do NOT copy this into an e2e spec. `playwright.config.ts` is `fullyParallel: true` and the
 * `a11y` and `chromium` projects share one database, so emptying `profiles` mid-run breaks
 * `selectProfile` in every other spec. The axe/360px coverage for this block comes from the
 * `/design/tokens` inventory cell instead.
 */
/**
 * AUTH-1 1c-2 — soft-delete the HOUSEHOLD, so the picker renders `NoHouseholdState`.
 *
 * It runs after `migrateAndSeed` and `linkFixtureMember` (which resolves the live household through
 * the correction's `requireLiveHouseholdScope`), as the only `STATES[state]` seeder, so nothing reads
 * the live household after this hides it.
 *
 * This is the only way to see this screen outside the design-token harness: the Playwright suite runs
 * `fullyParallel` against one shared seeded database, and a hidden household breaks `selectProfile`
 * in every other spec.
 */
async function seedNoHousehold(dbUrl: string): Promise<void> {
  const pool = createDbPool(dbUrl);
  const db = createDb(pool);
  try {
    const hidden = await db
      .update(schema.households)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(isNull(schema.households.deletedAt))
      .returning({ publicId: schema.households.publicId });
    console.log(`✓ hid ${hidden.length} household(s) → the picker renders its no-household state`);
  } finally {
    await pool.end();
  }
}

async function seedNoProfiles(dbUrl: string): Promise<void> {
  const pool = createDbPool(dbUrl);
  const db = createDb(pool);
  try {
    const hidden = await db
      .update(schema.profiles)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(isNull(schema.profiles.deletedAt))
      .returning({ publicId: schema.profiles.publicId });
    console.log(`✓ hid ${hidden.length} seeded profile(s) → the picker renders its empty state`);
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

/**
 * PROF-1 a-g — the ADULT athlete, whose household DOES program. The only way to render the muted
 * "Programs are for children for now" line, because the seed writes two kids and nothing else
 * (`seed.ts`), so no live profile is an adult.
 *
 * ⚠️ Flips the SEEDED profile rather than inserting a new one: the day page is reached by the
 * seeded id every other state uses, and an extra profile would change the picker in every shot.
 */
async function seedAdultAthlete(dbUrl: string): Promise<void> {
  const pool = createDbPool(dbUrl);
  const db = createDb(pool);
  try {
    const flipped = await db
      .update(schema.profiles)
      .set({ kind: 'adult', updatedAt: sql`now()` })
      .where(eq(schema.profiles.publicId, SEED_PROFILE_PUBLIC_ID))
      .returning({ publicId: schema.profiles.publicId });
    if (flipped.length !== 1) {
      throw new Error(
        `screenshot --state adult-athlete: expected to flip exactly 1 seeded profile to adult, ` +
          `flipped ${flipped.length} — did db:seed run?`,
      );
    }
  } finally {
    await pool.end();
  }
}

/** Fixture seeders, keyed by `--state`. `empty` needs none (catalog seed is enough). */
const STATES = {
  empty: null,
  // ONB-0 — the explained first-run empty state. The ONLY way to render it (see `seedNoProfiles`).
  'no-profiles': seedNoProfiles,
  // AUTH-1 1c-2 — the "this account resolves no household" screen. The ONLY way to render it (see
  // `seedNoHousehold`): it needs zero live households, which breaks `selectProfile` in every spec.
  'no-household': seedNoHousehold,
  // PROF-1 a-g: an ADULT on the day page, with no day-role label (the form defaults this once
  // showed went with the old forms).
  'adult-athlete': seedAdultAthlete,
  // PROF-1 b: an ARCHIVED athlete, so Household settings renders BOTH sections and the athlete's own
  // day page renders its notice. The ONLY way to capture either: the seed produces no archived row,
  // and the harness loads a route rather than driving a form, so without this a reviewer would be
  // approving an empty Archived section.
  'archived-athlete': seedArchivedAthlete,
  'already-logged': seedAlreadyLogged,
  // V1-24 PR 1b — the weigh-in's OPEN editor. Interaction-only on top of the already-logged
  // fixture: the open state is transient client state no seeder can produce.
  'bodyweight-open': seedAlreadyLogged,
  'sections-folded': seedAlreadyLogged,
  'bodyweight-editing': seedAlreadyLogged,
  // V1-24 PR 1a — the bodyweight receipt's other states (today's single value is `already-logged`).
  // (`bodyweight-duplicates` was removed in PR 1d: two live weigh-ins on one day are now refused by
  // `uq_entries_profile_day_bodyweight`, so the seeder hit 23505. The multi-row receipt returns as a
  // real state with V1-32's slots — a seeder for it belongs in that PR, with a real slot value.)
  // A closed day WITH a weight (the receipt, recovery line, no form) and one WITHOUT
  // (`No weight logged.`). Both backdate the profile, then navigate (see INTERACTIONS).
  'bodyweight-closed': seedClosedDays,
  // V1-24 3b-bw — today's ✓ row under a "Last time" line: the closed-day fixture leaves an earlier
  // weigh-in and an empty today, so the line names its weekday or date.
  'bodyweight-last-time': seedClosedDays,
  // V1-24 3b-bw — the editor with its field emptied (the ✓ named Clear), and the row after the clear.
  // Interaction states on top of the already-logged fixture.
  'bodyweight-clear-armed': seedAlreadyLogged,
  'bodyweight-cleared': seedAlreadyLogged,
  // V1-24 3b-bw — the open editor under a value the bound refuses: the row drops its tint there.
  'bodyweight-editing-refused': seedAlreadyLogged,
  // V1-24 3b-bw — an empty ✓, refused in the browser. Interaction-only.
  'bodyweight-empty-tick': null,
  // V1-24 3b-life-a — the logged practice's open editor, its editor with Clear armed, and the row after
  // the clear (`practice-logged`, below, is the logged row). Interaction-only.
  'practice-editing': null,
  'practice-ready': null,
  'practice-hours': null,
  'practice-clear-armed': null,
  'practice-cleared': null,
  // V1-24 3b-page — a logged practice: the Life row with its minutes, after a real tap. Interaction-only.
  'practice-logged': null,
  'bodyweight-closed-empty': seedClosedDays,
  // FAM-1 12c — tomorrow while the athlete is on a program: "Coming up", the workouts, no ✓, no
  // Bodyweight or Life. Interaction-only: it is a `?d=` one day ahead.
  'day-look-ahead': null,
  // FAM-1 15c PR 1: the Program order dialog OPEN, on the preview route
  // (`/design/program?screen=day&fixture=today-three-programs-one-ending`): it exists only after a tap.
  'program-order-open': null,
  // FAM-1 12d — Change on a set row, typed over and not yet saved ("Not saved. Was …" and the ✕),
  // in today's superset. Interaction-only: the state exists only between typing and leaving the row.
  'day-change-typed-over': null,
  // Round 3 on #180 — a save the plausibility bound REJECTS: the alert under the field, the typed value
  // and the chosen unit still there (React 19's form reset used to wipe both). Interaction-only.
  'bodyweight-rejected': null,
  // PROF-1 a-r — the rename form's REFUSED state: the alert under the field, `aria-invalid` on the
  // input, and the typed value STILL THERE. Interaction-only, and it is the one state that shows the
  // reason the island is controlled at all (React 19 resets an uncontrolled field when an action
  // settles, refusals included, which would empty the box under its own "Enter a name." error).
  'rename-rejected': null,
  // U0 — the shared sheet, OPEN. Not reachable by route: it exists only after a tap, and a closed
  // cell shows two buttons and nothing of the component under review.
  // The focus ring (the tech-debt focus-ring fix): keyboard focus on a field, a button and a nav row.
  // Interaction-only: `:focus-visible` exists only after keyboard input, which no fixture can seed.
  'focus-field': null,
  'focus-button': null,
  'focus-nav-row': null,
  'focus-rail-row': null,
  'focus-group-row': null,
  'sheet-open': null,
  'sheet-dialog-open': null,
  // CAT-3 B2-ii — the movement picker's filters, on the preview's workout editor. Interaction-only:
  // each exists after opening the picker and the panel and ticking "Quads" (the e2e spec's steps).
  'picker-filter-panel': null,
  'picker-filter-browse': null,
  'picker-filter-search': null,
  'picker-filter-none': null,
  // CAT-3 B3 — the picker's browse tree with no filter, a kind and a family open (the e2e spec's step).
  'picker-browse-open': null,
  // PROF-1 a-1d-ren — the duplicate warning on RENAME. Not reachable by route: it exists only after
  // a submit the server answers with a match, so the capture drives the form (see INTERACTIONS).
  'rename-duplicate': null,
  // FAM-1 7b-i — a program's page. Its address is minted at seed time, so the capture starts on
  // `/programs` and taps the seeded program open (see INTERACTIONS).
  'program-open': null,
  // FAM-1 7b-ii — a program's workout pages, reached the same way (see INTERACTIONS).
  'workout-new': null,
  'workout-edit': null,
  // Muted text on the accent ground: a list row hovered, which only a pointer paints (Tailwind's
  // `hover:` is `@media (hover: hover)`), so it shows at the desktop width alone (see INTERACTIONS).
  'programs-row-hover': null,
  'workouts-row-hover': null,
  // FAM-1 15 — the Put on dialog with one athlete ticked (see INTERACTIONS).
  'put-on': null,
  // V1-9b B2-ii — Clear this day's dialog, armed, and the banner after a clear. Both exist only
  // after taps on today's page, so the capture logs a practice and drives them (see INTERACTIONS).
  'clear-day-dialog': null,
  'clear-day-banner': null,
  // PROF-1 a-1d — the duplicate-name WARNING, which no route renders: it exists only after a submit
  // that the server answers with a match. Three states, because the callout is three different
  // screens and the copy differs in each.
  //
  // `duplicate-live`: the seeded Athlete One, typed back exactly with the same kind — so it also
  // renders the "Both will show as" disambiguation line, which needs an identical spelling AND an
  // equal kind.
  'duplicate-live': null,
  // `duplicate-kinds-differ`: an ARCHIVED athlete met with the OTHER kind. The case this screen's own
  // recovery copy creates ("archive them and add them again"), where Restore would hand back the
  // wrong kind permanently — so neither choice is primary.
  'duplicate-kinds-differ': seedArchivedAthlete,
  // `duplicate-at-cap`: a FULL household still warned about a duplicate, with NO "Add another" (the
  // endpoint would refuse it) and the cap sentence saying why the choice is missing.
  'duplicate-at-cap': seedHouseholdAtCap,
} as const;
type StateName = keyof typeof STATES;

/**
 * Post-load interactions, keyed by `--state`. Some UI states only exist AFTER a tap and cannot be
 * seeded: an open editor, an armed Clear, a refused value. A reviewer approving those needs to see
 * them, so the capture performs the taps.
 * Runs per viewport against a fresh page → must be idempotent from a clean load.
 */
/**
 * PROF-1 a-1d — type a name the household already holds and submit, leaving the duplicate callout on
 * screen. One helper for all three duplicate states: they differ only in the name and the kind, and
 * a second copy of this would be the repetition rule's own example.
 */
const warnOnDuplicate = (name: string, kind: ProfileKind) => async (page: Page) => {
  // `PROFILE_KIND_LABELS`, not a `'Child' | 'Adult'` union re-typed here: the radio's label IS that
  // constant, so a copy would be a second place to update when the wording changes.
  await page.getByRole('radio', { name: new RegExp(`^${PROFILE_KIND_LABELS[kind]}`) }).check();
  await page.getByRole('textbox', { name: ATHLETE_FORM_COPY.nameLabel, exact: true }).fill(name);
  await page.getByRole('button', { name: ATHLETE_FORM_COPY.add, exact: true }).click();
  // The callout's focus target. Waiting on IT rather than on the text means the capture cannot race
  // the Server Action round trip.
  await page.getByRole('group').waitFor();
};

/** Every picker state's name starts with this: they are captured in its sheet, after `load`. */
const PICKER_STATE_PREFIX = 'picker-';

/** CAT-3 B2-ii: open the workout editor's item picker. */
async function openItemPicker(page: Page) {
  // Loaded, not idle (`waitUntil: 'load'`), so the first tap may land before hydration and do
  // nothing: tap until the sheet opens, a bounded number of times.
  const open = page.getByRole('button', { name: ITEM_PICKER_COPY.open, exact: true });
  for (let tries = 0; ; tries++) {
    // A sheet that opened late hides the button behind it: look before tapping again.
    if (await page.getByRole('dialog').isVisible()) break;
    await open.click();
    try {
      await page.getByRole('dialog').waitFor({ timeout: 2_000 });
      break;
    } catch (error) {
      if (tries >= 10) throw error;
    }
  }
}
/** CAT-3 B2-ii: open the workout editor's item picker, then its filter panel. */
async function openPickerFilters(page: Page) {
  await openItemPicker(page);
  await page.getByRole('button', { name: PICKER_COPY.filtersName(0), exact: true }).click();
  await page.getByRole('heading', { name: PICKER_COPY.filtersHeading, exact: true }).waitFor();
}
/** Tick "Quads" and go back to the list (the e2e spec's filter). */
async function quadsOnThenBack(page: Page) {
  const quads = MUSCLE_LABELS[MUSCLE.quadriceps];
  await page
    .getByRole('checkbox', { name: new RegExp(`^${quads}${PICKER_COPY.choiceJoin}`) })
    .check();
  await page.getByRole('button', { name: PICKER_COPY.filtersBack, exact: true }).click();
  // Not exact: the heading's name adds its count ("…, 3 movements"; CAT-3 B3-ii's tree). With
  // "Quads" on the tree holds three rows, so it has opened itself (K26) by the time it is drawn.
  await page.getByRole('heading', { level: 3, name: PICKER_COPY.fitHeading }).waitFor();
}

/**
 * Resolve once no FINITE transition or animation is running, so a capture is not mid-animation. An
 * infinite one (`animate-spin`, `animate-pulse`) never finishes, so it is not waited for.
 */
async function settleAnimations(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (a) => a.playState !== 'running' || a.effect?.getComputedTiming().endTime === Infinity,
      ),
  );
}

const INTERACTIONS: Partial<Record<StateName, (page: Page) => Promise<void>>> = {
  // PROF-1 a-r. Whitespace-only rather than empty: `required` stops a blank submit in the browser, so
  // an empty field would never reach the server's refusal — which is the state being captured.
  /**
   * PROF-1 a-1d-ren — type a name ANOTHER seeded athlete already holds and submit, leaving the
   * callout on screen. ⚠️ Athlete Three's name, not this athlete's own: renaming to a fold-equal
   * name is precisely the case the guard skips, so it would capture an ordinary save.
   */
  'rename-duplicate': async (page) => {
    await page
      .getByRole('textbox', { name: ATHLETE_FORM_COPY.nameLabel, exact: true })
      .fill(SEED_PROFILE_3_NAME);
    await page.getByRole('button', { name: ATHLETE_FORM_COPY.save, exact: true }).click();
    // The callout's focus target — waiting on it means the capture cannot race the round trip.
    await page.getByRole('group').waitFor();
  },
  /** FAM-1 7b-i — from `/programs`, open the seeded "Family program" (its link also names who is on it) and wait for its heading. */
  'program-open': async (page) => {
    await page.getByRole('link', { name: /^Family program/ }).click();
    await page.getByRole('heading', { level: 1, name: 'Family program' }).waitFor();
  },
  /** FAM-1 15 — the seeded program's Put on dialog, the first athlete not on it ticked. */
  'put-on': async (page) => {
    await page.getByRole('link', { name: /^Family program/ }).click();
    await page.getByRole('heading', { level: 1, name: 'Family program' }).waitFor();
    await page.getByRole('button', { name: PUT_ON_COPY.open }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByRole('checkbox', { checked: false, disabled: false }).first().check();
  },
  /** V1-9b B2-ii — log a practice, open Clear this day, type the word: the armed dialog. */
  'clear-day-dialog': async (page) => {
    await logPractice(page);
    await page.getByRole('button', { name: CLEAR_DAY_COPY.trigger, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByRole('textbox').fill(CLEAR_DAY_CONFIRM_WORD);
  },
  /** V1-9b B2-ii — the same, cleared: the banner with Restore all, focused. */
  'clear-day-banner': async (page) => {
    await logPractice(page);
    await page.getByRole('button', { name: CLEAR_DAY_COPY.trigger, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByRole('textbox').fill(CLEAR_DAY_CONFIRM_WORD);
    await dialog.getByRole('button', { name: CLEAR_DAY_COPY.action, exact: true }).click();
    // By id, not label: each width revisits the same day, so from the second capture an earlier clear
    // is there too and the button truthfully reads "Restore 1 entry" rather than "Restore all".
    await page.locator(`#${RESTORE_ALL_ID}`).waitFor();
  },
  /** FAM-1 7b-ii — the seeded program's "+ New workout", waiting for the editor's name field. */
  'workout-new': async (page) => {
    await page.getByRole('link', { name: /^Family program/ }).click();
    await page.getByRole('link', { name: BUILDER_COPY.newWorkout }).click();
    await page.waitForURL(/\/workouts\/new$/);
    await page.getByRole('textbox', { name: EDITOR_COPY.workoutName, exact: true }).waitFor();
  },
  /** `/programs` with the seeded program's row hovered: its athletes line sits on `hover:bg-accent`. */
  'programs-row-hover': async (page) => {
    await page.getByRole('link', { name: /^Family program/ }).hover();
  },
  /** The seeded program's workouts list with "Heavy A"'s row hovered: muted lines on the accent. */
  'workouts-row-hover': async (page) => {
    await page.getByRole('link', { name: /^Family program/ }).click();
    await page.getByRole('heading', { level: 1, name: 'Family program' }).waitFor();
    await page.getByRole('link', { name: /^Heavy A/ }).hover();
  },
  /** FAM-1 7b-ii — the seeded program's "Heavy A", opened from its row. */
  'workout-edit': async (page) => {
    await page.getByRole('link', { name: /^Family program/ }).click();
    await page.getByRole('link', { name: /^Heavy A/ }).click();
    await page.waitForURL(/\/workouts\/[0-9a-f-]+$/);
    await page.getByRole('textbox', { name: EDITOR_COPY.workoutName, exact: true }).waitFor();
  },
  'picker-filter-panel': async (page) => {
    await openPickerFilters(page);
  },
  'picker-filter-browse': async (page) => {
    await openPickerFilters(page);
    await quadsOnThenBack(page);
  },
  'picker-filter-search': async (page) => {
    await openPickerFilters(page);
    await quadsOnThenBack(page);
    await page.getByRole('searchbox').fill('squat');
    await page
      .getByRole('heading', { name: PICKER_COPY.householdNotFiltered, exact: true })
      .waitFor();
  },
  'picker-browse-open': async (page) => {
    await openItemPicker(page);
    // A group's name is "Strength, 17 movements" (`choiceName`); Chrome may space the two spans.
    const group = (label: string) =>
      page.getByRole('button', {
        name: new RegExp(`^${label}\\s*${PICKER_COPY.choiceJoin.trim()}`),
      });
    await group(MODALITY_LABELS.strength).click();
    await group(MOVEMENT_FAMILY_LABELS.vertical_pull).click();
    await page.getByRole('checkbox', { name: /^Chin-up\b/ }).waitFor();
  },
  'picker-filter-none': async (page) => {
    await openPickerFilters(page);
    await quadsOnThenBack(page);
    await page.getByRole('searchbox').fill('chin');
    await page.getByText(PICKER_COPY.outsideAll(4, 'chin'), { exact: true }).waitFor();
  },
  // A key press first, so the programmatic focus that follows counts as KEYBOARD focus and
  // `:focus-visible` (the ring under test) applies, as it does when a person tabs there.
  // Then wait out any running transition: `Button` has `transition-all`, and a capture taken
  // mid-animation shows a faint hairline instead of the ring (#614's review).
  'focus-field': async (page) => {
    await page.keyboard.press('Shift');
    await page.locator('input[name="name"]').first().focus();
    await settleAnimations(page);
  },
  'focus-button': async (page) => {
    await page.keyboard.press('Shift');
    await page.locator('form button[type="submit"]').first().focus();
    await settleAnimations(page);
  },
  'focus-nav-row': async (page) => {
    await page.keyboard.press('Shift');
    await page.locator(`a[href="${SETTINGS_PATH}"]`).first().focus();
    await settleAnimations(page);
  },
  // A row of the builder's grouped list (`group-list.tsx`), whose ring now comes inset from
  // `NAV_ROW_CLASS` alone. Route: the programs-list preview.
  'focus-group-row': async (page) => {
    await page.keyboard.press('Shift');
    await page.locator('main ul a').first().focus();
    await settleAnimations(page);
  },
  // A row INSIDE the nav rail's scrolling list, the case `NAV_ROW_CLASS`'s `ring-inset` exists for
  // (an outer ring would be clipped there). The rail renders from the tablet width up.
  'focus-rail-row': async (page) => {
    await page.keyboard.press('Shift');
    const row = page.locator(`nav[aria-label="${NAV_RAIL_COPY.label}"] ul a`).first();
    if ((await row.count()) === 0) return; // mobile: no rail, the capture shows the page as is
    await row.focus();
    await settleAnimations(page);
  },
  'sheet-open': async (page) => {
    await page.getByRole('button', { name: 'Open sheet' }).first().click();
    await page.getByRole('dialog').waitFor();
  },
  /** The capped confirm variant — a different layout, so it needs its own capture. */
  'sheet-dialog-open': async (page) => {
    await page.getByRole('button', { name: 'Open dialog' }).first().click();
    await page.getByRole('dialog').waitFor();
  },
  'rename-rejected': async (page) => {
    await page.getByRole('textbox', { name: ATHLETE_FORM_COPY.nameLabel, exact: true }).fill('   ');
    await page.getByRole('button', { name: ATHLETE_FORM_COPY.save, exact: true }).click();
    await page.getByRole('alert').waitFor();
  },
  // PROF-1 a-1d — the warning only exists after a submit the server answers with a match, so the
  // capture performs it. Each waits for the callout's own `role="group"`, which is the focus target
  // the form moves to — so the screenshot is taken after the state has actually settled, not after a
  // click was merely dispatched.
  'duplicate-live': warnOnDuplicate(SEED_PROFILE_NAME, PROFILE_KIND.kid),
  // The archived athlete is a Child (`seedArchivedAthlete` archives the third seeded profile), so
  // choosing Adult is what makes the kinds differ.
  'duplicate-kinds-differ': warnOnDuplicate(SEED_PROFILE_3_NAME, PROFILE_KIND.adult),
  'duplicate-at-cap': warnOnDuplicate(SEED_PROFILE_NAME, PROFILE_KIND.kid),
  'bodyweight-closed': gotoDaysAgo(CLOSED_DAY_WITH_WEIGHT),
  // Retry-safe: the three widths share one database, and only the first finds the button.
  'practice-logged': (page) => logPractice(page),
  'bodyweight-closed-empty': gotoDaysAgo(CLOSED_DAY_EMPTY),
  // The page's own Next arrow, not `gotoDaysAgo(-1)`: that counts from the app's default zone, which
  // can be a day behind the zone the page renders in, and then "tomorrow" is the page's today.
  'day-change-typed-over': async (page) => {
    const superset = page.getByRole('list', { name: DAY_COPY.superset('A'), exact: true }).first();
    if ((await superset.count()) === 0) {
      throw new Error(
        'day-change-typed-over: no superset today (Heavy A or B runs Mon, Wed, Fri and Sat); pass a ?d= that has one',
      );
    }
    const tick = superset.getByRole('button', { name: /^Log .* set 1$/ }).first();
    if ((await tick.getAttribute('aria-pressed')) !== 'true') {
      await tick.click();
      await page.waitForFunction(
        (el) => el?.getAttribute('aria-pressed') === 'true' && !el.getAttribute('aria-busy'),
        await tick.elementHandle(),
      );
    }
    const load = superset.getByRole('textbox', { name: /set 1, in (?!reps$)/ }).first();
    await load.fill(String(Number(await load.inputValue()) + 5));
    await superset.getByText(/^Not saved\. Was /).waitFor();
  },
  'program-order-open': async (page) => {
    await page.getByRole('button', { name: PROGRAM_COPY.order, exact: true }).click();
    await page.getByRole('dialog').waitFor();
  },
  'day-look-ahead': async (page) => {
    await page
      .getByRole('navigation', { name: 'Change day' })
      .getByRole('link', { name: /^Next day/ })
      .click();
    await page.getByText(/^Tomorrow ·/).waitFor();
  },
  'bodyweight-rejected': async (page) => {
    const section = page.getByRole('region', { name: 'Bodyweight' });
    await section.getByLabel('Unit').selectOption('kg');
    await section.getByLabel('Weight', { exact: true }).fill('845');
    await section.getByRole('button', { name: BODYWEIGHT_COPY.logLabel }).click();
    await section.getByRole('alert').waitFor();
  },
  /**
   * V1-24 PR 1b — the amend, open. The reviewable surface of the PR is a state two taps in: the
   * fixture logs a weight, then Change opens the editor beneath it. Worth a state of its own because
   * the LAYOUT is the thing under review (why: `single-value-amend.tsx`).
   */
  // 12c-iii PR 2: a logged Bodyweight arrives folded to one line; this is it opened, with Collapse.
  'bodyweight-open': async (page) => {
    await openBodyweight(page);
  },
  // Both sections as they arrive once logged: one line each (12c-iii PR 2). The practice is logged
  // here, so the reload is the arrival that folds it.
  'sections-folded': async (page) => {
    await logPracticeOnce(page);
    await page.reload();
    await practiceSection(page).getByRole('heading').getByRole('button').waitFor();
  },
  'bodyweight-editing': async (page) => {
    await openBodyweight(page);
    const change = page.getByRole('button', { name: changePrefix(BODYWEIGHT_COPY.changeSubject) });
    if ((await change.count()) === 0) {
      throw new Error(
        'no Change control — this state needs the already-logged fixture to have run',
      );
    }
    await change.click();
  },
  'bodyweight-clear-armed': async (page) => {
    await openBodyweight(page);
    await page.getByRole('button', { name: changePrefix(BODYWEIGHT_COPY.changeSubject) }).click();
    await page.getByLabel(/^Weight \(/).fill('');
    await page.getByRole('button', { name: BODYWEIGHT_COPY.clearLabel }).waitFor();
    // Shoot it settled, not mid-transition (`transition-all`).
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  },
  'bodyweight-cleared': async (page) => {
    // Retry-safe across the three widths: only the first finds a Change to clear.
    await openBodyweight(page);
    const change = page.getByRole('button', { name: changePrefix(BODYWEIGHT_COPY.changeSubject) });
    if ((await change.count()) > 0) {
      await change.click();
      await page.getByLabel(/^Weight \(/).fill('');
      await page.getByRole('button', { name: BODYWEIGHT_COPY.clearLabel }).click();
    }
    await page.getByLabel('Weight', { exact: true }).waitFor();
  },
  'bodyweight-editing-refused': async (page) => {
    const section = page.getByRole('region', { name: BODYWEIGHT_COPY.heading });
    await openBodyweight(page);
    await section
      .getByRole('button', { name: changePrefix(BODYWEIGHT_COPY.changeSubject) })
      .click();
    await section.getByLabel(/^Weight \(/).fill('845');
    await section.getByRole('button', { name: BODYWEIGHT_COPY.saveLabel, exact: true }).click();
    await section.getByRole('alert').waitFor();
  },
  'practice-editing': async (page) => {
    await logPracticeOnce(page);
    await practiceSection(page).getByRole('button', { name: PRACTICE_CHANGE }).click();
  },
  'practice-clear-armed': async (page) => {
    await logPracticeOnce(page);
    const life = practiceSection(page);
    await life.getByRole('button', { name: PRACTICE_CHANGE }).click();
    await life.getByLabel(PRACTICE_COPY.fieldLabel).fill('');
    await life.getByRole('button', { name: PRACTICE_COPY.clearLabel }).waitFor();
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  },
  'practice-cleared': async (page) => {
    // Retry-safe across the three widths: only the first finds a Change to clear.
    const life = practiceSection(page);
    const change = life.getByRole('button', { name: PRACTICE_CHANGE });
    if ((await change.count()) === 0 && (await life.getByRole('status').textContent()) === '') {
      await logPracticeOnce(page);
    }
    if ((await change.count()) > 0) {
      await change.click();
      await life.getByLabel(PRACTICE_COPY.fieldLabel).fill('');
      await life.getByRole('button', { name: PRACTICE_COPY.clearLabel }).click();
    }
    await life.getByLabel(PRACTICE_COPY.fieldLabel, { exact: true }).waitFor();
  },
  // V1-24 3b-life-b: the typed row, ready (a value waits: the ✓ fills), and an hours-shaped value
  // refused in the browser.
  'practice-ready': async (page) => {
    await practiceSection(page).getByLabel(PRACTICE_COPY.fieldLabel, { exact: true }).fill('45');
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  },
  'practice-hours': async (page) => {
    const life = practiceSection(page);
    await life.getByLabel(PRACTICE_COPY.fieldLabel, { exact: true }).fill('2');
    await life.getByRole('button', { name: PRACTICE_COPY.logLabel, exact: true }).click();
    await life.getByRole('alert').waitFor();
  },
  'bodyweight-empty-tick': async (page) => {
    // Scoped to the section: Next's route announcer is a page-level `role="alert"` too.
    const section = page.getByRole('region', { name: BODYWEIGHT_COPY.heading });
    await section.getByRole('button', { name: BODYWEIGHT_COPY.logLabel }).click();
    await section.getByRole('alert').waitFor();
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

/** Seed the "already-logged" state: one habit and one brush-teeth metric logged today. */
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
 * PROF-1 b — archive the third athlete (the one the archive specs own), so the two states that only
 * exist after an archive can be captured.
 *
 * ⚠️ **It does NOT reproduce the Undo line**, which is island state after a successful action and has
 * no server-rendered equivalent. The e2e covers that; a screenshot cannot.
 */
async function seedArchivedAthlete(dbUrl: string): Promise<void> {
  const pool = createDbPool(dbUrl);
  const db = createDb(pool);
  try {
    await db
      .update(schema.profiles)
      .set({ archivedAt: new Date() })
      .where(eq(schema.profiles.publicId, SEED_PROFILE_3_PUBLIC_ID));
  } finally {
    await pool.end();
  }
}

/**
 * PROF-1 a-1d — fill the household to `MAX_HOUSEHOLD_ATHLETES` so the duplicate warning renders in
 * its at-cap form. Written through the schema rather than `createProfile`, because `createProfile`
 * is the thing under test: it would refuse at 25 and the fixture could never reach the cap.
 *
 * ⚠️ `client_id` is left NULL, exactly as `db:seed` leaves it — which is also the population that
 * broke the first version of this feature (a non-null-safe exclusion dropped every keyless row), so
 * a capture against keyed fixtures only would hide that class of defect from a reviewer's eye too.
 */
async function seedHouseholdAtCap(dbUrl: string): Promise<void> {
  const pool = createDbPool(dbUrl);
  const db = createDb(pool);
  try {
    const [household] = await db
      .select({ id: schema.profiles.householdId })
      .from(schema.profiles)
      .where(eq(schema.profiles.publicId, SEED_PROFILE_PUBLIC_ID))
      .limit(1);
    // ⚠️ `profiles.household_id` is NULLABLE in the schema, so the selected value is
    // `number | null` and the guard is two conditions, not one. A bare `!household` would typecheck
    // and then insert 25 rows with a null household — invisible to the capture, which reads the
    // seeded household, so the cap would never be reached and the state would silently be wrong.
    if (!household?.id) throw new Error('seeded profile has no household — did db:seed run?');
    const householdId = household.id;

    const [{ count: live }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.profiles)
      .where(eq(schema.profiles.householdId, householdId));

    const toAdd = MAX_HOUSEHOLD_ATHLETES - Number(live);
    if (toAdd <= 0) return;
    await db.insert(schema.profiles).values(
      Array.from({ length: toAdd }, (_, i) => ({
        householdId,
        publicId: newId(),
        name: `Filler ${i + 1}`,
        kind: PROFILE_KIND.kid,
      })),
    );
  } finally {
    await pool.end();
  }
}

/** Poll the running server until the landing responds (or time out). */
async function waitForServer(baseUrl: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // ⚠️ `/` — the landing, which needs no session. It was `/gate`, which 404s after AUTH-1 1d:
      // `res.status < 500` accepts a 404, so this probe did not hang, it just stopped meaning
      // anything. Third copy of this route literal; `playwright.config.ts` has the other.
      const res = await fetch(`${baseUrl}/`);
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
  colorScheme?: 'light' | 'dark',
  allowConsole?: boolean,
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
    // AUTH-1 1c-4a: the bypass principal needs a MEMBERSHIP, not just an id — from 1c-4 the scope is
    // derived from it. Separate from `migrateAndSeed` on purpose; see its docblock.
    //
    // 🔴 **BEFORE the state seeder, and that order is load-bearing.** The correction resolves the
    // live household (`requireLiveHouseholdScope`), and `--state no-household` soft-deletes it —
    // so below the seeder this throws and the capture dies. The module docblock's "no
    // scope-derivation pass to order against" was true until this line existed.
    await linkFixtureMember(dbUrl);

    const seedFixture = STATES[state];
    if (seedFixture) await seedFixture(dbUrl);

    // Ensure a prod build exists (reuse `.next` when present; `--build` forces a rebuild).
    const serverEnv: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: dbUrl,
      DATABASE_URL_UNPOOLED: dbUrl,
      // AUTH-1 1c-3a — the session seam, so `/p` and the other gated routes stay capturable once
      // 1c-3b converts them. `assertDbTargetAllowed` above has already proved `dbUrl` is the
      // throwaway cluster, which is the same property `lib/env.ts` re-checks before arming.
      E2E_SESSION_BYPASS_USER_ID: E2E_SESSION_BYPASS_USER,
      // 🔴 **Blank the third-party credentials rather than inheriting them.** `...process.env` and
      // `next start`'s own `.env.local` load would otherwise carry whatever the developer has — and
      // `lib/env.ts` says plainly that from 1c `pnpm dev` starts needing dev Clerk keys there. That
      // would turn `e2e/theme.spec.ts`'s zero-Clerk-egress assertion red locally, and that assertion
      // is **one-way**: once a Clerk host is legitimately contacted it can never catch a regression
      // again. "No keys, no egress" must be a property of this harness, not of the machine running
      // it. Upstash and Sentry for the same reason — a smoke run should spend no real rate-limit
      // quota and file no real error events.
      // 🔴 **`''`, never `undefined`, and that is the whole mechanism.** `spawn` DROPS a key whose
      // value is `undefined`, and an absent key is exactly the condition under which
      // `@next/env`'s `processEnv` applies the `.env.local` value instead — so blanking with
      // `undefined` hands the win to the very file this is defending against. An empty string keeps
      // the key PRESENT, so dotenv leaves it alone; `''` is falsy for `clerkIsConfigured()` and
      // `emptyStringAsUndefined: true` makes zod see `undefined` anyway. Verified by spawning a
      // child and reading `'X' in process.env`.
      CLERK_SECRET_KEY: '',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: '',
      UPSTASH_REDIS_REST_URL: '',
      UPSTASH_REDIS_REST_TOKEN: '',
      SENTRY_DSN: '',
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

    // ⚠️ A live ASSIGNMENT used to sit here, setting `ACCESS_GATE_PASSWORD` in THIS process so
    // `gateLogin` matched the server's code. Both are gone at AUTH-1 1d: `capture.ts` performs no
    // login, and the server is already authenticated by `E2E_SESSION_BYPASS_USER_ID` above.
    await captureScreenshot({
      route,
      baseUrl,
      name,
      timeZone,
      colorScheme,
      interact: INTERACTIONS[state],
      allowConsole,
      // A modal is a fixed overlay: a full-page shot buries it in a 24,000px sliver. The picker's
      // filter states are in its sheet too.
      viewportOnly: state.startsWith('sheet-') || state.startsWith(PICKER_STATE_PREFIX),
      waitUntil: state.startsWith(PICKER_STATE_PREFIX) ? 'load' : undefined,
    });
  } finally {
    if (server) await stopChildProcess(server);
    await pg.stop().catch(() => {});
    await rm(dataDir, { recursive: true, force: true });
    console.log('▸ torn down embedded Postgres + temp dir');
  }
}

/**
 * Every flag this script accepts. ⚠️ **An unknown flag has to be fatal**, because the parser below
 * treats whatever it does not recognise as positional — so `--only sheet-open` silently became the
 * ROUTE `sheet-open`, which 404s, and the run still printed `✓ mobile/tablet/desktop` for three
 * screenshots of Next's not-found page. A capture that reports success while showing a 404 is worse
 * than a crash: it gets published into a PR as evidence of a UI that was never rendered.
 * _(maintainer, 2026-11-11)_
 */
const KNOWN_FLAGS = new Set([
  '--state',
  '--tz',
  '--theme',
  '--build',
  '--use-live-db',
  '--allow-console',
]);

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // A bare `--` is pnpm's argument separator and reaches us verbatim; it is not a flag.
  const unknown = argv.filter(
    (a) => a !== '--' && a.startsWith('--') && !KNOWN_FLAGS.has(a.split('=')[0]!),
  );
  if (unknown.length > 0) {
    throw new Error(
      `unknown flag(s): ${unknown.join(', ')}. known flags: ${[...KNOWN_FLAGS].join(', ')}\n` +
        'A route is passed as a POSITIONAL, e.g. `screenshot:ephemeral --state sheet-open /design/tokens`.',
    );
  }
  const stateFlagIdx = argv.indexOf('--state');
  const rawState = stateFlagIdx >= 0 ? argv[stateFlagIdx + 1] : 'empty';
  if (!rawState || !(rawState in STATES)) {
    throw new Error(
      `unknown --state "${rawState}". known states: ${Object.keys(STATES).join(', ')}`,
    );
  }
  const state = rawState as StateName;
  const allowLive = argv.includes('--use-live-db') || process.env.SCREENSHOT_ALLOW_LIVE_DB === '1';
  // DX-14 item 2: a console error or warning fails the capture unless this is passed.
  const allowConsole = argv.includes('--allow-console');

  // `--tz <IANA>` emulates the browser's zone, so a weekday-conditional screen (V1-10's Mon/Wed/Fri
  // program card) can be captured on any host day — the app derives "today" from the DEVICE zone
  // (V1-6c). E.g. `--tz Pacific/Kiritimati` (UTC+14) renders tomorrow's local day.
  const tzFlagIdx = argv.indexOf('--tz');
  const timeZone = tzFlagIdx >= 0 ? argv[tzFlagIdx + 1] : undefined;

  // `--theme light|dark` (UI-4) emulates `prefers-color-scheme`, which the app's default `system`
  // theme follows — so the dark capture needs no storage seeding and no toggle click. Required
  // because every UI PR now owes screenshots in BOTH themes, and a reskin candidate cannot be
  // reviewed in one.
  const themeFlagIdx = argv.indexOf('--theme');
  const rawTheme = themeFlagIdx >= 0 ? argv[themeFlagIdx + 1] : undefined;
  // Validated like `--tz`, and for the same reason: `--theme --state already-logged` swallows the value
  // into the next flag, and an unvalidated value would silently capture the wrong theme onto the
  // artifact a reviewer approves from.
  if (themeFlagIdx >= 0 && rawTheme !== 'light' && rawTheme !== 'dark') {
    throw new Error(`--theme requires light|dark, got: ${rawTheme ?? ''}`);
  }
  const colorScheme = rawTheme as 'light' | 'dark' | undefined;
  // Validated with the SAME helper the app uses on the `tz` cookie — so `--tz --state already-logged`
  // (value swallowed by the next flag) fails here with a clear message instead of deep inside Playwright.
  if (tzFlagIdx >= 0 && !isIanaTimeZone(timeZone)) {
    throw new Error(
      `--tz requires a valid IANA zone (e.g. America/New_York), got: ${timeZone ?? ''}`,
    );
  }

  // First non-flag token is the route (skip the values consumed by --state / --tz / --theme). Miss
  // one of these and `screenshot:ephemeral --theme dark /p` captures the route "dark".
  const consumed = new Set(
    [stateFlagIdx + 1, tzFlagIdx + 1, themeFlagIdx + 1].filter((i) => i > 0),
  );
  const positionals = argv.filter((a, i) => !a.startsWith('-') && !consumed.has(i));
  // No `/p` → Today shorthand any more (OSS-2): `/p` is the real picker route, and the shorthand would
  // silently capture the wrong screen. Pass `/` for the public landing.
  const route = positionals[0] ?? APP_HOME_PATH;
  const base = route === SEED_PROFILE_ROUTE ? 'today' : routeSlug(route);
  // The theme rides the STEM, not the viewport suffix `capture.ts` appends — so a pair of runs yields
  // `<name>-mobile.png` and `<name>-dark-mobile.png` side by side in `.screenshots/`.
  const stem = state === 'empty' ? base : `${base}-${state}`;
  const name = colorScheme === 'dark' ? `${stem}-dark` : stem;

  if (allowLive) {
    // OPT-IN: the OLD behavior — capture against a server the caller has already started
    // (it reads its own env, possibly live Neon). This path is the deliberate exception.
    const baseUrl = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:3996';
    assertDbTargetAllowed(process.env.DATABASE_URL ?? 'postgresql://x@localhost/x', true);
    // OPS-1 note: this path starts NO server, so `lib/env.ts`'s database-environment guard is
    // enforced by whatever the caller already started — `pnpm dev:prod` sets `ALLOW_LIVE_DB=1`
    // for exactly this case. Nothing to set here.

    console.warn(
      '⚠️  --use-live-db: capturing against the already-running server (no embedded DB).',
    );
    await captureScreenshot({ route, baseUrl, name, timeZone, colorScheme, allowConsole });
    return;
  }

  // One heavy local run machine-wide (DX-18 D3): the build and the throwaway database are the heavy
  // part, so only this path takes the slot. It re-runs itself under the slot wrapper, which holds the
  // slot until this run's whole process group has exited, and exits 2 while another run holds it.
  if (runUnderSlot('screenshot:ephemeral')) return;
  await runEphemeral(route, state, name, timeZone, colorScheme, allowConsole);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/** The logged practice's Change, whatever its value: `changeLabel`'s own prefix, never re-typed. */
const PRACTICE_CHANGE = changePrefix(PRACTICE_COPY.changeSubject);

/** The Life section, where the practice row lives (V1-24 3b-life-a). */
function practiceSection(page: Page) {
  return page.getByRole('region', { name: LIFE_COPY.heading, exact: true });
}

/** Type the practice minutes and tap ✓ unless the row is already logged (the three widths share one day). */
/** A logged Bodyweight arrives folded to one line (12c-iii PR 2): open it before acting on it. */
async function openBodyweight(page: Page): Promise<void> {
  await openIfCollapsed(bodyweightSection(page), BODYWEIGHT_COPY.heading);
}

async function logPracticeOnce(page: Page): Promise<void> {
  const life = practiceSection(page);
  // A practice logged at an earlier width arrives folded after the reload (12c-iii PR 2).
  await openIfCollapsed(life, LIFE_COPY.heading);
  const tick = life.getByRole('button', { name: PRACTICE_COPY.logLabel, exact: true });
  if ((await tick.count()) > 0) {
    await life.getByLabel(PRACTICE_COPY.fieldLabel, { exact: true }).fill(String(PRACTICE_MINUTES));
    await tick.click();
  }
  await life.getByRole('button', { name: PRACTICE_CHANGE }).waitFor();
}
