import assert from 'node:assert/strict';

import {
  ACTIVITY_TYPE_KEYS,
  addDays,
  type DayItem,
  type DayPlan,
  dayPlanSchema,
  type DayWorkout,
  ENTRY_KIND,
  ENTRY_STATUS,
  ENTRY_UNIT_WITHOUT_QUANTITY,
  TRACKING_TYPE,
  localWeekday,
  newId,
  ON_PROGRAM,
  PROFILE_KIND,
  PROGRAM_BLOCK_KIND,
  type ProgramResult,
  QUANTITY_SLOT,
  ROW_REFUSAL,
  type RowValues,
  SEED_ACTIVITY_TYPE_KEYS,
  SEED_METRIC_KEYS,
  SESSION_TYPE,
  UNIT_DIMENSION_BY_CODE,
  WEEKDAYS,
  type WorkoutDraftItem,
} from '@mat-plan/shared';
import {
  DAY_PLAN_FIXTURE_SOURCES,
  DAY_PLAN_FIXTURES,
  FIXTURE_TODAY,
  fixtureIds,
  type FixtureItemKey,
  programOf,
  programView,
  type World,
  workoutDraft,
  workoutOf as protoWorkoutOf,
} from '@mat-plan/shared/program/fixtures';
import type { CatalogMovement } from '@mat-plan/shared';
import { CATALOG_FIXTURE } from '@mat-plan/shared/catalog/fixture';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';

import { schema } from '../../src/client';
import {
  currentPrograms,
  resolveDayPlan,
  type ResolvedDayPlan,
} from '../../src/queries/day/day-plan';
import { prescriptionLiveIn } from '../../src/queries/day/prescription-live-in';
import type { HouseholdScope } from '../../src/scope';
import { logRow, untickRow } from '../../src/writers/day/log-row';
import { hideEntries } from '../../src/writers/hide';
import { householdScopeForScript } from '../../src/writers/household-scope-script';
import {
  insertProgramBlockOwnedBy,
  insertWorkoutOwnedBy,
  programBlockByClientId,
} from '../../src/writers/ownership';
import { reorderPrograms, saveWeek, saveWorkout } from '../../src/writers/program';
import { insertEntrySetRows } from '../../src/writers/session-rows';
import { activityTypeIdOf, entriesInAnotherProfilesSession, expectOk, inSavepoint } from './day';
import { asDb, asTx, rolledBack, type VerifyTx } from './harness';
import {
  ARCHIVE_ONLY_FIXTURES,
  FIXED_WORLD_FIXTURE_COUNT,
  FIXED_WORLD_FIXTURES,
  REPLAY_FIXTURE_COUNT,
  REPLAY_FIXTURES,
} from './fixture-groups';
import { entriesOnForeignPrescriptions, sessionsOnForeignWorkouts } from './schema';

/**
 * `db:verify` proofs for **the day resolver** (FAM-1 steps 12a-i and 12a-ii; plan
 * `docs/plans/fam-1-12a-day-resolver.md` → § Test plan). Owner: lane E. Called from `./day.ts`,
 * after the row writer's proofs, so a mutation patch of 11b still fails on its own assertion first.
 *
 * ## The seeder
 *
 * A fixture's source world (`DAY_PLAN_FIXTURE_SOURCES`, C17) is written into a household of its own:
 *
 * - **Programs, workouts, the week, prescriptions, quantities and assignments by direct insert, in
 *   REVERSE order**, so no internal id matches an `idx` and an order taken from ids goes red. Each
 *   assignment gets its seven weekday rows, as a put-on writes them. ⚠️ A world's `assign.to` is the
 *   first day OFF; `active_to` is the inclusive last day, so `to − 1`. The inserts stay direct
 *   because ids must run opposite to `idx`, which `saveWorkout` cannot write; 12a-ii's calibration
 *   save keeps them honest (`docs/tech-debt.md`).
 * - **Entries through the real row writer**, `logRow`, in DESCENDING entry order `n` (so ids run
 *   opposite to `n`), each with `today` set to its own day so the window lets it through. Then each
 *   `created_at` is set to a hand-written stamp that RISES with `n`: "first logged" is `n` in a
 *   world, and a tie-break decided by id instead of `created_at` goes red.
 * - It returns fixture id → the `public_id` each insert RETURNED (the writer's answer, for an entry).
 *
 * ## The comparison
 *
 * The fixture is translated through that map, **throwing on any UUID the map does not hold**, and
 * compared with `assert.deepStrictEqual` after a JSON round trip. Never through `normalizeFixture`,
 * which relabels every UUID and would let a returned `client_id` pass (plan C1). Then a round trip:
 * an unlogged row ticks through `logRow` with the returned ids, a logged set answers `slot_taken`,
 * and a returned `entryPublicId` un-ticks through `untickRow`.
 *
 * 12a-i proves the twelve fixtures whose `before` is `null`, and in `verifyRules` the two whose only
 * change is an archive. **12a-ii** replays the other six (`verifyReplays`): `before` seeded and
 * logged, a calibration save, the change made with lane P's writers, then the same comparison; and
 * `verifyReplayRules` proves what only a replay reaches (plan § 12a-ii). The groups are
 * `./fixture-groups.ts`'s, derived from the sources.
 */
export async function verifyDayPlan(): Promise<void> {
  await verifyFixtures();
  // 12a-ii's replays, after 12a-i's fixtures and before its rules (plan § 12a-ii, the harness).
  await verifyReplays();
  await verifyReplayRules();
  await verifyRules();
}

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────

/** A hand-written `created_at` for entry `n`: one second apart, rising with `n`. */
const loggedAt = (n: number) => new Date(Date.UTC(2026, 10, 1, 12) + n * 1000);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The fixture with every UUID mapped to the public id its seeder returned; an unknown one throws. */
function translate<T>(value: T, ids: ReadonlyMap<string, string>, name: string): T {
  return JSON.parse(JSON.stringify(value), (_key, v: unknown) => {
    if (typeof v !== 'string' || !UUID.test(v)) return v;
    const mapped = ids.get(v);
    if (mapped === undefined)
      throw new Error(`FAM-1 12a ${name}: the seeder returned no id for ${v}`);
    return mapped;
  }) as T;
}

/** A JSON round trip: what a page would receive. */
const asJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const workoutItemTypeId = (tx: VerifyTx) => activityTypeIdOf(tx, ACTIVITY_TYPE_KEYS.workout_item);

// ── The seeder ────────────────────────────────────────────────────────────────────────────────────

type Seeded = Awaited<ReturnType<typeof seedWorld>>;

/** C32: a library movement's slug in one seeded world (proof-only, so no seeded library row collides). */
function proofSlug(label: string, slug: string): string {
  return `verify-12a-${label}-${slug}`;
}

/** C32: the test library, re-slugged as `seedWorld` slugs its global rows, for the resolver. */
function proofCatalog(label: string): readonly CatalogMovement[] {
  return CATALOG_FIXTURE.map((e) => ({ ...e, slug: proofSlug(label, e.slug) }));
}

/** Write `world` into a new household (see the module header). */
async function seedWorld(tx: VerifyTx, world: World, label: string, activityTypeId: number) {
  const ids = new Map<string, string>();
  const [household] = await tx
    .insert(schema.households)
    .values({ publicId: newId(), name: `Verify 12a ${label}` })
    .returning({ id: schema.households.id, publicId: schema.households.publicId });
  const SEEDED_SCOPE = householdScopeForScript(household.id);

  const profiles = new Map<string, { id: number; publicId: string }>();
  for (const athlete of [...world.athletes].reverse()) {
    const [row] = await tx
      .insert(schema.profiles)
      .values({
        publicId: newId(),
        name: athlete.name,
        kind: PROFILE_KIND.kid,
        householdId: household.id,
      })
      .returning({ id: schema.profiles.id, publicId: schema.profiles.publicId });
    profiles.set(athlete.id, row);
    ids.set(fixtureIds.athlete(athlete.id), row.publicId);
  }

  const movements = new Map<FixtureItemKey, number>();
  for (const key of (Object.keys(world.catalog) as FixtureItemKey[]).reverse()) {
    // C32: an item the world marks `library` is a GLOBAL row (no household) named for the test
    // library's entry, under a proof-only slug (`proofSlug`), so it can never collide with a seeded
    // library row; the resolver is handed the test library re-slugged the same way (`proofCatalog`).
    const library = world.catalog[key].library;
    const entry =
      library === undefined ? undefined : CATALOG_FIXTURE.find((e) => e.slug === library);
    assert.ok(library === undefined || entry, `FAM-1 C32: ${library} is in the test library`);
    const [row] = await tx
      .insert(schema.movements)
      .values({
        publicId: newId(),
        slug: entry ? proofSlug(label, entry.slug) : `verify-12a-${label}-${key}`,
        name: world.catalog[key].name,
        householdId: entry ? null : household.id,
        // A global row needs its library pattern and modality (`movements_global_classified_check`).
        pattern: entry?.pattern ?? null,
        modality: entry?.modality ?? null,
        trackingType: world.catalog[key].type,
      })
      .returning({ id: schema.movements.id, publicId: schema.movements.publicId });
    movements.set(key, row.id);
    ids.set(fixtureIds.item(key), row.publicId);
  }

  const blocks = new Map<string, number>();
  const workouts = new Map<string, number>();
  const prescriptions = new Map<string, number>();
  for (const program of [...world.programs].reverse()) {
    const blockClientId = newId();
    await insertProgramBlockOwnedBy(asTx(tx), SEEDED_SCOPE, {
      clientId: blockClientId,
      slug: `verify-12a-${label}-${program.id}`,
      name: program.name,
      notes: null,
    });
    const block = (await programBlockByClientId(asTx(tx), SEEDED_SCOPE, blockClientId))!;
    blocks.set(program.id, block.id);
    ids.set(fixtureIds.program(program.id), block.publicId);

    for (const workout of [...program.workouts].reverse()) {
      const draft = workoutDraft(world, program.id, workout.wid);
      // 12a-ii: the `client_id`s a `workoutDraft` names, so a replay's draft translates (plan § 12a-ii,
      // step 1). Values are fresh ids, never the fixture's own: those are the map's KEYS.
      const workoutClientId = newId();
      ids.set(fixtureIds.workoutClient(workout.wid), workoutClientId);
      const w = (await insertWorkoutOwnedBy(asTx(tx), SEEDED_SCOPE, {
        blockId: block.id,
        clientId: workoutClientId,
        name: draft.name,
        description: draft.description,
      }))!;
      workouts.set(workout.wid, w.id);
      ids.set(fixtureIds.workout(workout.wid), w.publicId);

      for (const [idx, item] of [...draft.items.entries()].reverse()) {
        const key = workout.items[idx]!.iid;
        const prescriptionClientId = newId();
        ids.set(fixtureIds.prescriptionClient(workout.wid, key), prescriptionClientId);
        const [p] = await tx
          .insert(schema.prescriptions)
          .values({
            publicId: newId(),
            blockId: block.id,
            workoutId: w.id,
            clientId: prescriptionClientId,
            movementId: movements.get(key)!,
            idx,
            sets: item.sets,
            targetReps: item.targetReps,
            notes: item.notes,
            restAfter: item.restAfter,
            supersetLabel: item.superset?.group ?? null,
            supersetOrder: item.superset?.order ?? null,
          })
          .returning({ id: schema.prescriptions.id, publicId: schema.prescriptions.publicId });
        prescriptions.set(`${workout.wid}:${key}`, p.id);
        ids.set(fixtureIds.prescription(workout.wid, key), p.publicId);
        for (const q of [...item.quantities].reverse()) {
          await tx.insert(schema.prescriptionQuantities).values({
            prescriptionId: p.id,
            slot: q.slot,
            dimension: UNIT_DIMENSION_BY_CODE[q.unit],
            unit: q.unit,
            valueMin: q.value === null ? null : String(q.value),
          });
        }
      }
    }

    for (const weekday of [...WEEKDAYS].reverse()) {
      for (const [idx, slot] of [...program.week[weekday].entries()].reverse()) {
        await tx.insert(schema.blockDayWorkouts).values({
          blockId: block.id,
          weekday,
          idx,
          workoutId: workouts.get(slot.wid)!,
          label: slot.label || null,
        });
      }
    }
  }

  for (const [athlete, list] of Object.entries(world.assign).reverse()) {
    for (const [idx, a] of [...list.entries()].reverse()) {
      await assignTo(tx, {
        profileId: profiles.get(athlete)!.id,
        blockId: blocks.get(a.prog)!,
        idx,
        activeFrom: a.from,
        activeTo: a.to ? addDays(a.to, -1) : null,
      });
    }
  }

  const entries = new Map<number, string>();
  for (const entry of [...world.entries].sort((x, y) => y.n - x.n)) {
    const stamp = world.stamps[entry.n];
    assert.ok(stamp, `FAM-1 12a ${label}: e${entry.n} has a stamp`);
    const r = expectOk(
      await logRow(asDb(tx), {
        scope: SEEDED_SCOPE,
        today: entry.day,
        activityTypeId,
        write: {
          clientId: newId(),
          profilePublicId: profiles.get(entry.ath)!.publicId,
          day: entry.day,
          workoutPublicId: ids.get(fixtureIds.workout(entry.wid))!,
          prescriptionPublicId: ids.get(fixtureIds.prescription(entry.wid, entry.iid))!,
          set: entry.set,
          values: stamp.values,
        },
      }),
      `FAM-1 12a ${label}: the seeder logs e${entry.n}`,
    );
    entries.set(entry.n, r.entryPublicId);
    ids.set(fixtureIds.entry(entry.n), r.entryPublicId);
  }
  for (const [n, publicId] of entries) {
    await tx
      .update(schema.entries)
      .set({ createdAt: loggedAt(n) })
      .where(eq(schema.entries.publicId, publicId));
  }
  // Lane A's pre-flight (f) and (g) detectors read nothing on a seeded world: the planted rows below
  // are the only foreign pointers any proof sees.
  assert.deepEqual(
    { f: await sessionsOnForeignWorkouts(tx), g: await entriesOnForeignPrescriptions(tx) },
    { f: [], g: [] },
    `FAM-1 12a ${label}: the seeded world has no foreign session or entry`,
  );

  return {
    scope: SEEDED_SCOPE,
    catalog: proofCatalog(label),
    householdId: household.id,
    ids,
    profiles,
    movements,
    blocks,
    workouts,
    prescriptions,
    entries,
  };
}

/** One assignment row and its seven weekday rows, as a put-on writes them. */
async function assignTo(
  tx: VerifyTx,
  a: {
    profileId: number;
    blockId: number;
    idx: number;
    activeFrom: string;
    activeTo: string | null;
  },
): Promise<number> {
  const [row] = await tx
    .insert(schema.programAssignments)
    .values({ publicId: newId(), ...a })
    .returning({ id: schema.programAssignments.id });
  await tx
    .insert(schema.programAssignmentWeekdays)
    .values(WEEKDAYS.map((weekday) => ({ assignmentId: row.id, weekday })));
  return row.id;
}

/** The resolver on a seeded world: `resolveDayPlan`, with the athlete's public id. */
async function resolve(
  tx: VerifyTx,
  seeded: Seeded,
  athlete: string,
  day: string,
  today = FIXTURE_TODAY,
): Promise<ResolvedDayPlan> {
  const plan = await resolveDayPlan(asTx(tx), {
    scope: seeded.scope,
    profilePublicId: seeded.profiles.get(athlete)!.publicId,
    day,
    today,
    catalog: seeded.catalog,
  });
  assert.ok(plan, `FAM-1 12a: ${athlete} resolves on ${day}`);
  // The contract's own schema, so a field the fixtures never reach is still the right shape.
  const parsed = asJson(dayPlanSchema.omit({ athletes: true }).parse(plan));
  // A SCHEDULED workout's program is one of the day's programs. (A logged workout that is not
  // scheduled may name a live program no assignment covers that day, C24.)
  const programs = new Set(parsed.programs.map((p) => p.programPublicId));
  assert.deepEqual(
    parsed.workouts.filter(
      (w) => w.scheduled && (w.programPublicId === null || !programs.has(w.programPublicId)),
    ),
    [],
    'FAM-1 12a: every scheduled workout’s programPublicId names one of the day’s programs',
  );
  return parsed;
}

// ── The fixtures ──────────────────────────────────────────────────────────────────────────────────

type FixtureName = keyof typeof DAY_PLAN_FIXTURE_SOURCES;

async function verifyFixtures(): Promise<void> {
  // 12a-i's set: the fixtures with no `before` (`fixture-groups.ts`). The three groups cover every
  // source exactly once.
  const names = FIXED_WORLD_FIXTURES;
  assert.deepEqual(
    [...FIXED_WORLD_FIXTURES, ...ARCHIVE_ONLY_FIXTURES, ...REPLAY_FIXTURES].sort(),
    Object.keys(DAY_PLAN_FIXTURE_SOURCES).sort(),
    'FAM-1 12a: every fixture is in exactly one group (fixed world, archive-only, replay)',
  );
  assert.ok(
    names.includes('closed-day-logged-only'),
    'FAM-1 12a: closed-day-logged-only is in 12a-i',
  );
  assert.equal(
    names.length,
    FIXED_WORLD_FIXTURE_COUNT,
    `FAM-1 12a: 12a-i proves exactly ${FIXED_WORLD_FIXTURE_COUNT} fixed-world fixtures`,
  );

  // Fixtures built from the same world share one seed (each one's writes are in a savepoint).
  const worldKey = (name: FixtureName) => {
    const { world } = DAY_PLAN_FIXTURE_SOURCES[name];
    return JSON.stringify([
      world.athletes,
      world.catalog,
      world.programs,
      world.assign,
      world.entries,
    ]);
  };
  const groups = new Map<string, FixtureName[]>();
  for (const name of names)
    groups.set(worldKey(name), [...(groups.get(worldKey(name)) ?? []), name]);

  let roundTrips = 0;
  for (const group of groups.values()) {
    await rolledBack(async (tx) => {
      const activityTypeId = await workoutItemTypeId(tx);
      const seeded = await seedWorld(
        tx,
        DAY_PLAN_FIXTURE_SOURCES[group[0]!].world as World,
        group[0]!,
        activityTypeId,
      );
      for (const name of group) {
        if (
          await proveFixture(
            tx,
            seeded,
            name,
            activityTypeId,
            'FAM-1 12a: the resolver, on the seeded state',
          )
        ) {
          roundTrips += 1;
        }
        console.log(`✓ FAM-1 12a: the resolver deep-equals ${name}, ids mapped exactly`);
      }
    });
  }
  assert.ok(roundTrips >= 4, `FAM-1 12a: ${roundTrips} writable fixtures round-tripped`);
}

/**
 * One fixture on a seeded state: resolve it, deep-equal the translated fixture under `title`, and,
 * on a writable day with workouts, run C1's round trip. Answers whether it round-tripped. Shared by
 * 12a-i's fixtures and 12a-ii's replays; `title` keeps each assertion's text (the `.expect` lines).
 */
async function proveFixture(
  tx: VerifyTx,
  seeded: Seeded,
  name: FixtureName,
  activityTypeId: number,
  title: string,
): Promise<boolean> {
  const { world, athlete, day } = DAY_PLAN_FIXTURE_SOURCES[name];
  const actual = await resolve(tx, seeded, athlete, day, world.today);
  const { athletes: _athletes, ...fixture } = DAY_PLAN_FIXTURES[name] as DayPlan;
  assert.deepStrictEqual(
    actual,
    asJson(translate(fixture, seeded.ids, name)),
    `${title}, deep-equals ${name}`,
  );
  if (!actual.writable || actual.workouts.length === 0) return false;
  await roundTrip(tx, seeded, name, actual, activityTypeId);
  return true;
}

/**
 * C1's round trip: the ids the resolver returned are the writers' ids. An unlogged row ticks through
 * `logRow` (`ok`), a logged set answers `slot_taken`, and a returned `entryPublicId` un-ticks. On a
 * day whose scheduled rows are all logged (12a-ii's `workout-left-the-week`), a returned scheduled
 * entry un-ticks, and each returned entry of a workout that left the week answers `not_scheduled`,
 * not `not_found`: its ids are the writer's own (`untickRow` finds the entry before the schedule).
 */
async function roundTrip(
  tx: VerifyTx,
  seeded: Seeded,
  name: string,
  plan: ResolvedDayPlan,
  activityTypeId: number,
): Promise<void> {
  const scheduled = plan.workouts.filter((w) => w.scheduled && w.workoutPublicId !== null);
  const rowsOf = (w: DayWorkout) =>
    w.items.flatMap((item) =>
      item.prescriptionPublicId === null ? [] : item.rows.map((row) => ({ workout: w, item, row })),
    );
  const all = scheduled.flatMap(rowsOf);
  const unlogged = all.find((r) => r.row.logged === null);
  const logged = all.find((r) => r.row.logged !== null);
  if (!unlogged) {
    await allLoggedRoundTrip(tx, seeded, name, plan, logged?.row.logged?.entryPublicId);
    return;
  }
  await inSavepoint(tx, async (sp) => {
    const tick = (r: NonNullable<typeof unlogged>) =>
      logRow(asDb(sp), {
        scope: seeded.scope,
        today: plan.today,
        activityTypeId,
        write: {
          clientId: newId(),
          profilePublicId: plan.profilePublicId,
          day: plan.day,
          workoutPublicId: r.workout.workoutPublicId!,
          prescriptionPublicId: r.item.prescriptionPublicId!,
          set: r.row.set,
          values: { quantities: [] },
        },
      });
    expectOk(
      await tick(unlogged),
      `FAM-1 12a ${name}: an unlogged row ticks with the returned ids`,
    );
    if (!logged) return;
    assert.deepEqual(
      await tick(logged),
      { ok: false, reason: ROW_REFUSAL.slot_taken },
      `FAM-1 12a ${name}: a logged set answers slot_taken with the returned ids`,
    );
    expectOk(
      await untickRow(asDb(sp), {
        scope: seeded.scope,
        today: plan.today,
        input: {
          profilePublicId: plan.profilePublicId,
          day: plan.day,
          entryPublicId: logged.row.logged!.entryPublicId,
        },
      }),
      `FAM-1 12a ${name}: a returned entryPublicId un-ticks`,
    );
  });
}

// ── The rules no fixture exercises ────────────────────────────────────────────────────────────────

const YESTERDAY = addDays(FIXTURE_TODAY, -1);

/** Every string in a value, for "no id or text of H appears here". */
function stringsOf(value: unknown): string[] {
  const out: string[] = [];
  JSON.stringify(value, (_k, v: unknown) => {
    if (typeof v === 'string') out.push(v);
    return v;
  });
  return out;
}

/** A program row planted by hand, for the cases no writer makes (runbook (f), (g); E4). */
async function plantRow(
  tx: VerifyTx,
  row: {
    profileId: number;
    day: string;
    sessionId: number | null;
    movementId: number | null;
    movementName: string | null;
    prescriptionId?: number | null;
    set: number;
    snapshot: string;
    unit: string;
    activityTypeId: number;
    supersetId?: number | null;
    values?: RowValues;
  },
): Promise<{ id: number; publicId: string }> {
  const [entry] = await tx
    .insert(schema.entries)
    .values({
      publicId: newId(),
      clientId: newId(),
      profileId: row.profileId,
      activityDate: row.day,
      unit: row.unit,
      movementName: row.movementName,
      activityTypeId: row.activityTypeId,
      movementId: row.movementId,
      sessionId: row.sessionId,
      supersetId: row.supersetId ?? null,
      supersetOrder: row.supersetId ? 1 : null,
      prescriptionId: row.prescriptionId ?? null,
      prescriptionSet: row.set,
      prescribedSnapshot: row.snapshot,
    })
    .returning({ id: schema.entries.id, publicId: schema.entries.publicId });
  await insertEntrySetRows(asTx(tx), {
    entryId: entry.id,
    sets: [row.values ?? { quantities: [] }],
  });
  return entry;
}

async function plantSession(
  tx: VerifyTx,
  s: { profileId: number; day: string; workoutId: number | null; workoutName: string },
): Promise<number> {
  const [row] = await tx
    .insert(schema.sessions)
    .values({
      publicId: newId(),
      clientId: newId(),
      profileId: s.profileId,
      activityDate: s.day,
      sessionType: SESSION_TYPE.workout,
      workoutId: s.workoutId,
      workoutName: s.workoutName,
    })
    .returning({ id: schema.sessions.id });
  return row.id;
}

async function verifyRules(): Promise<void> {
  // R7, ADR 0007 Amendment 5 (the maintainer, 2026-11-18): the programs that stay come first, in
  // their own `idx` order, then the ones ending today. A put-on compacts the OPEN rows' `idx`
  // (`writers/program/assign.ts`) and leaves a row closing today where it was; the order must not move
  // under an unrelated put-on, whatever the ids. The rows are the states assign.ts writes.
  {
    const row = (id: number, blockId: number, idx: number, activeTo: string | null) => ({
      id,
      blockId,
      programPublicId: `program-${blockId}`,
      programName: `Program ${blockId}`,
      idx,
      activeFrom: '2026-11-01',
      activeTo,
      current: true,
    });
    const order = (rows: ReturnType<typeof row>[]) =>
      currentPrograms(rows, FIXTURE_TODAY).map((p) => p.blockId);
    // Put on A (10) then B (11); take A off today; then put on C (12): B compacts onto A's 0.
    assert.deepEqual(
      [
        order([row(1, 10, 0, FIXTURE_TODAY), row(2, 11, 1, null)]),
        order([row(1, 10, 0, FIXTURE_TODAY), row(2, 11, 0, null), row(3, 12, 1, null)]),
      ],
      [
        [11, 10],
        [11, 12, 10],
      ],
      'FAM-1 12a R7: a program ending today goes after the ones that stay, before and after a put-on',
    );
    // The ids run against the order: X (20, row 8, the OLDER row) has been moved after Y (21, row 9)
    // by a reorder; Y is then taken off today and Z (22, row 10, the newest) put on, so X compacts
    // onto Y's 0. (Under D41 a Put on reopens a row at its old place, so a reorder is what makes it.)
    assert.deepEqual(
      [
        order([row(9, 21, 0, FIXTURE_TODAY), row(8, 20, 1, null)]),
        order([row(9, 21, 0, FIXTURE_TODAY), row(8, 20, 0, null), row(10, 22, 1, null)]),
      ],
      [
        [20, 21],
        [20, 22, 21],
      ],
      'FAM-1 12a R7: the order holds when the ids run against it (a reopen)',
    );
    // The PLACING row's days ride with each program (lane P's program view reads them): one program
    // with a row ending today at 0 and an upcoming row at 2 is placed by the upcoming one.
    assert.deepEqual(
      currentPrograms(
        [
          row(1, 10, 0, FIXTURE_TODAY),
          { ...row(2, 10, 2, null), activeFrom: addDays(FIXTURE_TODAY, 1) },
        ],
        FIXTURE_TODAY,
      ).map((p) => [p.activeFrom, p.activeTo]),
      [[addDays(FIXTURE_TODAY, 1), null]],
      'FAM-1 12a R7: each current program carries its placing row’s days',
    );
  }
  await rolledBack(async (tx) => {
    const activityTypeId = await workoutItemTypeId(tx);
    // H: the prototype's household (the seeded world). F: another household, on the every-type
    // program (its athlete `a1` is F's own, logged today in w900, nothing on any other day).
    const H_WORLD = DAY_PLAN_FIXTURE_SOURCES['today-two-programs'].world as World;
    const F_WORLD = DAY_PLAN_FIXTURE_SOURCES['every-type-once'].world as World;
    const H = await seedWorld(tx, H_WORLD, 'h', activityTypeId);
    const F = await seedWorld(tx, F_WORLD, 'f', activityTypeId);
    // H's real names, as a planted row would carry them (the runbook's defect).
    const FAMILY_PROGRAM = programOf(H_WORLD, 'p1').name;
    const HEAVY_A = protoWorkoutOf(programOf(H_WORLD, 'p1'), 'w2').name;
    const MORNING_HABITS = protoWorkoutOf(programOf(H_WORLD, 'p1'), 'w1').name;
    const ONE_OF_EACH = protoWorkoutOf(programOf(F_WORLD, 'p900'), 'w900').name;
    const H_SCOPE = H.scope;
    const F_SCOPE = F.scope;
    const hStrings = [...H.ids.values()];
    const fAthlete = F.profiles.get('a1')!;

    /** A new athlete of a seeded household, with no assignments. */
    const newAthlete = async (seeded: Seeded, sp: VerifyTx, key: string) => {
      const [row] = await sp
        .insert(schema.profiles)
        .values({
          publicId: newId(),
          name: `Verify 12a ${key}`,
          kind: PROFILE_KIND.kid,
          householdId: seeded.householdId,
        })
        .returning({ id: schema.profiles.id, publicId: schema.profiles.publicId });
      seeded.profiles.set(key, row);
      return row;
    };
    const tickIn = (
      sp: VerifyTx,
      seeded: Seeded,
      w: {
        athlete: string;
        day: string;
        today?: string;
        wid: string;
        iid: FixtureItemKey;
        set: number;
        values?: RowValues;
      },
    ) =>
      logRow(asDb(sp), {
        scope: seeded.scope,
        today: w.today ?? w.day,
        activityTypeId,
        write: {
          clientId: newId(),
          profilePublicId: seeded.profiles.get(w.athlete)!.publicId,
          day: w.day,
          workoutPublicId: seeded.ids.get(fixtureIds.workout(w.wid))!,
          prescriptionPublicId: seeded.ids.get(fixtureIds.prescription(w.wid, w.iid))!,
          set: w.set,
          values: w.values ?? { quantities: [] },
        },
      });
    const workoutOf = (plan: ResolvedDayPlan, seeded: Seeded, wid: string) =>
      plan.workouts.find((w) => w.workoutPublicId === seeded.ids.get(fixtureIds.workout(wid)));
    const itemOf = (w: DayWorkout | undefined, seeded: Seeded, iid: FixtureItemKey) =>
      w?.items.find((it) => it.itemPublicId === seeded.ids.get(fixtureIds.item(iid)));

    // ── Ownership: a profile of another household is null, as a missing one is (E1) ────────────
    assert.equal(
      await resolveDayPlan(asTx(tx), {
        scope: H_SCOPE,
        profilePublicId: fAthlete.publicId,
        day: FIXTURE_TODAY,
        today: FIXTURE_TODAY,
        catalog: CATALOG_FIXTURE,
      }),
      null,
      'FAM-1 12a ownership: a profile of another household under H’s scope resolves to null',
    );
    assert.equal(
      await resolveDayPlan(asTx(tx), {
        scope: H_SCOPE,
        profilePublicId: newId(),
        day: FIXTURE_TODAY,
        today: FIXTURE_TODAY,
        catalog: CATALOG_FIXTURE,
      }),
      null,
      'FAM-1 12a ownership: a missing profile resolves to null, the same answer',
    );
    console.log('✓ FAM-1 12a ownership: another household’s profile is null, as a missing one');

    // ── (f): F's session naming H's workout, with H's workout name (E1) ─────────────────────────
    // On F's yesterday, where F's own w900 is scheduled and nothing is logged. The planted entry is
    // live, has a set and a movement F may use, and no prescription: only E1's workout clause drops it.
    const fMove = F.movements.get('grip')!;
    const plantF = async (sp: VerifyTx, workoutId: number, workoutName: string) => {
      const sessionId = await plantSession(sp, {
        profileId: fAthlete.id,
        day: YESTERDAY,
        workoutId,
        workoutName,
      });
      const entry = await plantRow(sp, {
        profileId: fAthlete.id,
        day: YESTERDAY,
        sessionId,
        movementId: fMove,
        movementName: F_WORLD.catalog.grip.name,
        set: 1,
        snapshot: '',
        unit: ENTRY_UNIT_WITHOUT_QUANTITY.check,
        activityTypeId,
      });
      return { ...entry, sessionId };
    };
    await inSavepoint(tx, async (sp) => {
      const own = await plantF(sp, F.workouts.get('w900')!, ONE_OF_EACH);
      const plan = await resolve(sp, F, 'a1', YESTERDAY);
      assert.ok(
        stringsOf(plan).includes(own.publicId),
        'FAM-1 12a (f): the same session on F’s own workout IS shown (non-vacuity)',
      );
    });
    await inSavepoint(tx, async (sp) => {
      const planted = await plantF(sp, H.workouts.get('w2')!, HEAVY_A);
      assert.ok(
        (await sessionsOnForeignWorkouts(sp)).includes(planted.sessionId),
        'FAM-1 12a (f): lane A’s pre-flight (f) detector sees the planted session',
      );
      const plan = await resolve(sp, F, 'a1', YESTERDAY);
      const strings = stringsOf(plan);
      assert.ok(
        !strings.includes(planted.publicId) && plan.workouts.every((w) => w.name !== HEAVY_A),
        'FAM-1 12a (f): a session naming another household’s workout is not shown',
      );
      assert.deepEqual(
        strings.filter((s) => hStrings.includes(s) || s === HEAVY_A),
        [],
        'FAM-1 12a (f): no id or name of H reaches F’s day',
      );
    });
    console.log('✓ FAM-1 12a (f): a session on a foreign workout is dropped, with its rows');

    // ── (g): F's entry naming H's prescription, with H's rendering and superset label (E1) ──────
    const plantG = async (sp: VerifyTx, prescriptionId: number, snapshot: string) => {
      const sessionId = await plantSession(sp, {
        profileId: fAthlete.id,
        day: YESTERDAY,
        workoutId: F.workouts.get('w900')!,
        workoutName: ONE_OF_EACH,
      });
      const [superset] = await sp
        .insert(schema.supersets)
        .values({ publicId: newId(), clientId: newId(), sessionId, prescriptionGroup: 'a' })
        .returning({ id: schema.supersets.id });
      return plantRow(sp, {
        profileId: fAthlete.id,
        day: YESTERDAY,
        sessionId,
        movementId: F.movements.get('dbbench')!,
        movementName: F_WORLD.catalog.dbbench.name,
        prescriptionId,
        set: 1,
        snapshot,
        unit: 'lb',
        activityTypeId,
        supersetId: superset.id,
        values: { reps: 6, quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'lb', value: 20 }] },
      });
    };
    const H_PUSH_PRESS_TEXT = '4 × 6 @ 20 lb';
    await inSavepoint(tx, async (sp) => {
      const own = await plantG(sp, F.prescriptions.get('w900:dbbench')!, '4 × 8 @ 25 lb');
      const plan = await resolve(sp, F, 'a1', YESTERDAY);
      assert.ok(
        stringsOf(plan).includes(own.publicId),
        'FAM-1 12a (g): the same entry on F’s own prescription IS shown (non-vacuity)',
      );
    });
    await inSavepoint(tx, async (sp) => {
      const planted = await plantG(sp, H.prescriptions.get('w3:pushpress')!, H_PUSH_PRESS_TEXT);
      assert.ok(
        (await entriesOnForeignPrescriptions(sp)).includes(planted.id),
        'FAM-1 12a (g): lane A’s pre-flight (g) detector sees the planted entry',
      );
      const plan = await resolve(sp, F, 'a1', YESTERDAY);
      const strings = stringsOf(plan);
      const w900 = workoutOf(plan, F, 'w900');
      assert.ok(
        !strings.includes(planted.publicId) && w900?.progress.done === 0,
        'FAM-1 12a (g): an entry naming another household’s prescription is in no row and no progress',
      );
      assert.deepEqual(
        strings.filter((s) => hStrings.includes(s) || s === H_PUSH_PRESS_TEXT),
        [],
        'FAM-1 12a (g): no id or text of H reaches F’s day',
      );
    });
    console.log('✓ FAM-1 12a (g): an entry on a foreign prescription is dropped');

    // ── (h): an F athlete assigned to H's program (E1's live anchor) ─────────────────────────────
    await inSavepoint(tx, async (sp) => {
      const athlete = await newAthlete(F, sp, 'h-own');
      await assignTo(sp, {
        profileId: athlete.id,
        blockId: F.blocks.get('p900')!,
        idx: 0,
        activeFrom: '2026-11-01',
        activeTo: null,
      });
      const plan = await resolve(sp, F, 'h-own', FIXTURE_TODAY);
      assert.equal(
        plan.onProgram,
        ON_PROGRAM.yes,
        'FAM-1 12a (h): the same assignment on F’s own program IS on it (non-vacuity)',
      );
    });
    await inSavepoint(tx, async (sp) => {
      const athlete = await newAthlete(F, sp, 'h-planted');
      await assignTo(sp, {
        profileId: athlete.id,
        blockId: H.blocks.get('p1')!,
        idx: 0,
        activeFrom: '2026-11-01',
        activeTo: null,
      });
      const plan = await resolve(sp, F, 'h-planted', FIXTURE_TODAY);
      assert.deepEqual(
        [plan.onProgram, plan.currentPrograms, plan.programs, plan.workouts, plan.canGoForward],
        [ON_PROGRAM.never, [], [], [], false],
        'FAM-1 12a (h): an assignment to another household’s program puts the athlete on nothing',
      );
      assert.deepEqual(
        stringsOf(plan).filter((s) => hStrings.includes(s) || s === FAMILY_PROGRAM),
        [],
        'FAM-1 12a (h): no id or name of H reaches F’s day',
      );
    });
    console.log('✓ FAM-1 12a (h): an assignment to a foreign program is on nothing');

    // ── E2: an item whose movement the household may not use is absent ──────────────────────────
    const plantItem = async (sp: VerifyTx, movementId: number) => {
      const [p] = await sp
        .insert(schema.prescriptions)
        .values({
          publicId: newId(),
          blockId: H.blocks.get('p1')!,
          workoutId: H.workouts.get('w1')!,
          clientId: newId(),
          movementId,
          idx: 6,
        })
        .returning({ publicId: schema.prescriptions.publicId });
      const plan = await resolve(sp, H, 'a1', FIXTURE_TODAY);
      return workoutOf(plan, H, 'w1')!.items.some((it) => it.prescriptionPublicId === p.publicId);
    };
    await inSavepoint(tx, async (sp) => {
      assert.ok(
        await plantItem(sp, H.movements.get('stance')!),
        'FAM-1 12a E2: an item on H’s own movement IS shown (non-vacuity)',
      );
    });
    await inSavepoint(tx, async (sp) => {
      assert.equal(
        await plantItem(sp, F.movements.get('stance')!),
        false,
        'FAM-1 12a E2: an item whose movement belongs to another household is absent',
      );
    });
    console.log('✓ FAM-1 12a E2: an item on another household’s movement is absent');

    // ── C32: the coach label is read for a GLOBAL movement only ─────────────────────────────────
    // Two movements under ONE proof slug the (re-slugged) test library labels `coach`: a global row
    // and H's own. Only the global row's item carries `supervision`; H's own never does, whatever
    // its slug. The new fixture's deep-equal proves the label itself; this proves the household rule.
    await inSavepoint(tx, async (sp) => {
      const slug = proofSlug('h', 'hang_power_clean');
      const plant = async (householdId: number | null) => {
        const [m] = await sp
          .insert(schema.movements)
          .values({
            publicId: newId(),
            slug,
            name: 'Planted clean',
            householdId,
            pattern: householdId === null ? 'hinge' : null,
            modality: householdId === null ? 'strength' : null,
            trackingType: TRACKING_TYPE.check,
          })
          .returning({ id: schema.movements.id });
        const [p] = await sp
          .insert(schema.prescriptions)
          .values({
            publicId: newId(),
            blockId: H.blocks.get('p1')!,
            workoutId: H.workouts.get('w1')!,
            clientId: newId(),
            movementId: m.id,
            idx: householdId === null ? 7 : 8,
          })
          .returning({ publicId: schema.prescriptions.publicId });
        return p.publicId;
      };
      const globalItem = await plant(null);
      const ownItem = await plant(H.householdId);
      const items = workoutOf(await resolve(sp, H, 'a1', FIXTURE_TODAY), H, 'w1')!.items;
      const keyOf = (publicId: string) => {
        const it = items.find((i) => i.prescriptionPublicId === publicId)!;
        return 'supervision' in it ? it.supervision : 'absent';
      };
      assert.deepEqual(
        [keyOf(globalItem), keyOf(ownItem)],
        ['coach', 'absent'],
        'FAM-1 C32: a global movement carries the library’s label, a household’s own never does',
      );
    });
    console.log('✓ FAM-1 C32: the coach label is a global movement’s only');

    // ── PREVIOUS: never a sibling's or another household's row (S5) ─────────────────────────────
    await inSavepoint(tx, async (sp) => {
      // Athlete Two logs Push-ups set 1 yesterday; F's athlete has a row on H's Push-ups too. Both
      // are stamped before Athlete One's own row that day, so only the profile conjunct keeps them out.
      const sibling = expectOk(
        await tickIn(sp, H, {
          athlete: 'a2',
          day: YESTERDAY,
          wid: 'w1',
          iid: 'pushups',
          set: 1,
          values: { reps: 99, quantities: [] },
        }),
        'FAM-1 12a PREVIOUS: the sibling logs Push-ups',
      );
      const foreign = await plantRow(sp, {
        profileId: fAthlete.id,
        day: YESTERDAY,
        sessionId: null,
        movementId: H.movements.get('pushups')!,
        movementName: H_WORLD.catalog.pushups.name,
        set: 1,
        snapshot: '3 × 15',
        unit: ENTRY_UNIT_WITHOUT_QUANTITY.reps,
        activityTypeId,
        values: { reps: 98, quantities: [] },
      });
      await sp
        .update(schema.entries)
        .set({ createdAt: loggedAt(0) })
        .where(inArray(schema.entries.publicId, [sibling.entryPublicId, foreign.publicId]));
      const plan = await resolve(sp, H, 'a1', FIXTURE_TODAY);
      assert.deepEqual(
        itemOf(workoutOf(plan, H, 'w1'), H, 'pushups')?.rows[0]?.previous,
        { reps: 15, quantities: [] },
        'FAM-1 12a PREVIOUS: a sibling’s and another household’s row never answer for this athlete',
      );
    });
    console.log('✓ FAM-1 12a PREVIOUS: only this athlete’s rows');

    // ── PREVIOUS: equal created_at, decided by the lower id ─────────────────────────────────────
    await inSavepoint(tx, async (sp) => {
      // Splits stretch, yesterday, in Morning habits (5 min) and Evening stretch (4 min). The
      // seeder gave the evening row the LOWER id; equal stamps leave the id to decide.
      const yesterdays = await sp
        .select({ id: schema.entries.id, workoutId: schema.sessions.workoutId })
        .from(schema.entries)
        .innerJoin(schema.sessions, eq(schema.sessions.id, schema.entries.sessionId))
        .where(
          and(
            eq(schema.entries.profileId, H.profiles.get('a1')!.id),
            eq(schema.entries.activityDate, YESTERDAY),
            eq(schema.entries.movementId, H.movements.get('splits')!),
          ),
        );
      const [lower] = [...yesterdays].sort((x, y) => x.id - y.id);
      assert.deepEqual(
        [yesterdays.length, lower?.workoutId],
        [2, H.workouts.get('w5')],
        'FAM-1 12a PREVIOUS: Splits was logged twice yesterday, the evening row with the lower id',
      );
      await sp
        .update(schema.entries)
        .set({ createdAt: loggedAt(0) })
        .where(
          inArray(
            schema.entries.id,
            yesterdays.map((r) => r.id),
          ),
        );
      const plan = await resolve(sp, H, 'a1', FIXTURE_TODAY);
      assert.deepEqual(
        itemOf(workoutOf(plan, H, 'w1'), H, 'splits')?.rows[0]?.previous,
        { quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'min', value: 4 }] },
        'FAM-1 12a PREVIOUS: two rows logged at the same instant are decided by the lower id',
      );
    });
    console.log('✓ FAM-1 12a PREVIOUS: an equal created_at is decided by id');

    // ── PREVIOUS: only program rows; a hidden row is skipped ────────────────────────────────────
    await inSavepoint(tx, async (sp) => {
      // Push press was last logged on Nov 11. A strength entry on it and a weigh-in, both
      // yesterday, are not program rows.
      const [weighIn] = await sp
        .select({ id: schema.activityTypes.id })
        .from(schema.activityTypes)
        .where(eq(schema.activityTypes.key, SEED_ACTIVITY_TYPE_KEYS.weighIn));
      const [strength] = await sp
        .insert(schema.entries)
        .values({
          publicId: newId(),
          clientId: newId(),
          profileId: H.profiles.get('a1')!.id,
          activityDate: YESTERDAY,
          kind: ENTRY_KIND.strength,
          unit: 'lb',
          movementName: H_WORLD.catalog.pushpress.name,
          movementId: H.movements.get('pushpress')!,
          activityTypeId,
        })
        .returning({ id: schema.entries.id });
      await insertEntrySetRows(asTx(sp), {
        entryId: strength.id,
        sets: [{ reps: 1, quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'lb', value: 99 }] }],
      });
      await sp.insert(schema.entries).values({
        publicId: newId(),
        clientId: newId(),
        profileId: H.profiles.get('a1')!.id,
        activityDate: YESTERDAY,
        kind: ENTRY_KIND.bodyweight,
        unit: 'lb',
        valueNum: '80',
        activityTypeId: weighIn!.id,
        metricKey: SEED_METRIC_KEYS.bodyweight,
        status: ENTRY_STATUS.done,
      });
      const pushPress = async () =>
        itemOf(workoutOf(await resolve(sp, H, 'a1', FIXTURE_TODAY), H, 'w3'), H, 'pushpress')
          ?.rows[0]?.previous;
      assert.deepEqual(
        await pushPress(),
        { reps: 6, quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'lb', value: 20 }] },
        'FAM-1 12a PREVIOUS: a strength entry and a weigh-in are not program rows',
      );
      // Hide Nov 11's set 1: nothing else answers for set 1.
      const nov11 = '2026-11-11';
      const [row] = await sp
        .select({ publicId: schema.entries.publicId })
        .from(schema.entries)
        .where(
          and(
            eq(schema.entries.profileId, H.profiles.get('a1')!.id),
            eq(schema.entries.activityDate, nov11),
            eq(schema.entries.movementId, H.movements.get('pushpress')!),
            eq(schema.entries.prescriptionSet, 1),
          ),
        );
      await hideEntries(asTx(sp), {
        profilePublicId: H.profiles.get('a1')!.publicId,
        scope: H_SCOPE,
        day: nov11,
        entryPublicIds: [row!.publicId],
      });
      assert.equal(await pushPress(), null, 'FAM-1 12a PREVIOUS: a hidden row is skipped');
    });
    console.log('✓ FAM-1 12a PREVIOUS: program rows only; a hidden row is skipped');

    // ── Hidden: an un-tick lowers `done`; an un-ticked extra set's row goes (E3) ────────────────
    await inSavepoint(tx, async (sp) => {
      const morning = async () => workoutOf(await resolve(sp, H, 'a1', FIXTURE_TODAY), H, 'w1')!;
      const before = await morning();
      const grip = itemOf(before, H, 'grip')!.rows[0]!.logged!;
      const untick = (entryPublicId: string) =>
        untickRow(asDb(sp), {
          scope: H_SCOPE,
          today: FIXTURE_TODAY,
          input: {
            profilePublicId: H.profiles.get('a1')!.publicId,
            day: FIXTURE_TODAY,
            entryPublicId,
          },
        });
      expectOk(await untick(grip.entryPublicId), 'FAM-1 12a hidden: Grip un-ticks');
      const after = await morning();
      assert.deepEqual(
        [itemOf(after, H, 'grip')!.rows[0]!.logged, after.progress],
        [null, { done: before.progress.done - 1, total: before.progress.total }],
        'FAM-1 12a hidden: an un-ticked row is not logged, and lowers done',
      );
      const extra = expectOk(
        await tickIn(sp, H, {
          athlete: 'a1',
          day: FIXTURE_TODAY,
          wid: 'w1',
          iid: 'pushups',
          set: 4,
          values: { reps: 10, quantities: [] },
        }),
        'FAM-1 12a hidden: an extra Push-ups set ticks',
      );
      const withExtra = await morning();
      assert.deepEqual(
        [itemOf(withExtra, H, 'pushups')!.rows.map((r) => r.set), withExtra.progress.total],
        [[1, 2, 3, 4], before.progress.total + 1],
        'FAM-1 12a hidden: a logged extra set is a row and is counted',
      );
      expectOk(await untick(extra.entryPublicId), 'FAM-1 12a hidden: the extra set un-ticks');
      const without = await morning();
      assert.deepEqual(
        [itemOf(without, H, 'pushups')!.rows.map((r) => r.set), without.progress],
        [[1, 2, 3], after.progress],
        'FAM-1 12a hidden: an un-ticked extra set’s row goes, and is not counted',
      );
    });
    console.log('✓ FAM-1 12a hidden: an un-tick lowers done; an un-ticked extra set is gone');

    // ── Hidden: a workout that left the week, all its rows un-ticked, is absent ─────────────────
    await inSavepoint(tx, async (sp) => {
      // Heavy A was logged yesterday (a Friday). Take it off Fridays.
      await sp
        .update(schema.blockDayWorkouts)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(schema.blockDayWorkouts.blockId, H.blocks.get('p1')!),
            eq(schema.blockDayWorkouts.workoutId, H.workouts.get('w2')!),
            eq(schema.blockDayWorkouts.weekday, localWeekday(YESTERDAY)),
          ),
        );
      const heavyA = async () => workoutOf(await resolve(sp, H, 'a1', YESTERDAY), H, 'w2');
      const left = await heavyA();
      assert.ok(
        left && !left.scheduled && left.label === null,
        'FAM-1 12a hidden: a workout that left the week still shows its logged rows (non-vacuity)',
      );
      // C21: it is still live, unlike a hidden one: its description, its live items and its count.
      const heavyADraft = workoutDraft(H_WORLD, 'p1', 'w2');
      assert.deepEqual(
        [
          left.description,
          left.items.every((it) => it.prescriptionPublicId !== null),
          left.progress.total,
        ],
        [heavyADraft.description, true, 4 + 4 + 3 + 3 + 3],
        'FAM-1 12a C21: a workout that only left the week keeps its description, live items and count',
      );
      await hideEntries(asTx(sp), {
        profilePublicId: H.profiles.get('a1')!.publicId,
        scope: H_SCOPE,
        day: YESTERDAY,
        entryPublicIds: left.items.flatMap((it) => it.rows.map((r) => r.logged!.entryPublicId)),
      });
      assert.equal(
        await heavyA(),
        undefined,
        'FAM-1 12a hidden: a workout that left the week, all its rows un-ticked, is absent',
      );
    });
    console.log('✓ FAM-1 12a hidden: a left workout with every row un-ticked is gone');

    // ── Order: a superset by superset_order, against idx (E6) ───────────────────────────────────
    await inSavepoint(tx, async (sp) => {
      // Heavy A's group `a`: DB bench is idx 0, Pull-up idx 1. Reverse their places in the group.
      const set = (iid: FixtureItemKey, order: number, rest: string | null) =>
        sp
          .update(schema.prescriptions)
          .set({ supersetOrder: order, restAfter: rest })
          .where(eq(schema.prescriptions.id, H.prescriptions.get(`w2:${iid}`)!));
      await set('pullup', 1, null);
      await set('dbbench', 2, '90 s after each round');
      const plan = await resolve(sp, H, 'a2', YESTERDAY);
      const heavyA = workoutOf(plan, H, 'w2')!;
      assert.deepEqual(
        heavyA.items.slice(0, 2).map((it) => [it.name, it.superset]),
        [
          ['Pull-up', { group: 'a', order: 1 }],
          ['DB bench press', { group: 'a', order: 2 }],
        ],
        'FAM-1 12a E6: a superset is ordered by superset_order, not by idx',
      );
      assert.equal(
        heavyA.restAfter.a,
        '90 s after each round',
        'FAM-1 12a E6: the rest is the group’s last member’s',
      );
    });
    console.log('✓ FAM-1 12a E6: a superset is in superset_order');

    // ── Order: two current rows for one program (R7) ────────────────────────────────────────────
    await inSavepoint(tx, async (sp) => {
      // Stretching: a row closing today (idx 0) and one starting tomorrow (idx 2); the Family
      // program open between them (idx 1). Stretching is listed once, placed by its upcoming row.
      const athlete = await newAthlete(H, sp, 'two-rows');
      const p1 = H.blocks.get('p1')!;
      const p2 = H.blocks.get('p2')!;
      await assignTo(sp, {
        profileId: athlete.id,
        blockId: p2,
        idx: 0,
        activeFrom: '2026-11-01',
        activeTo: FIXTURE_TODAY,
      });
      await assignTo(sp, {
        profileId: athlete.id,
        blockId: p2,
        idx: 2,
        activeFrom: addDays(FIXTURE_TODAY, 1),
        activeTo: null,
      });
      await assignTo(sp, {
        profileId: athlete.id,
        blockId: p1,
        idx: 1,
        activeFrom: '2026-11-01',
        activeTo: null,
      });
      const plan = await resolve(sp, H, 'two-rows', FIXTURE_TODAY);
      const p1Id = H.ids.get(fixtureIds.program('p1'));
      const p2Id = H.ids.get(fixtureIds.program('p2'));
      assert.deepEqual(
        [
          plan.currentPrograms.map((p) => p.programPublicId),
          plan.programs.map((p) => [p.programPublicId, p.order]),
          plan.workouts.map((w) => w.workoutPublicId),
        ],
        [
          [p1Id, p2Id],
          [
            [p1Id, 0],
            [p2Id, 1],
          ],
          ['w1', 'w3', 'w4', 'w5'].map((wid) => H.ids.get(fixtureIds.workout(wid))),
        ],
        'FAM-1 12a R7: a program with two current rows is listed once, placed by its upcoming row',
      );
    });
    console.log('✓ FAM-1 12a R7: two current rows of one program list it once');

    // ── Order: a hidden block is no program (E1's live anchor) ──────────────────────────────────
    await inSavepoint(tx, async (sp) => {
      const athlete = await newAthlete(H, sp, 'hidden-block');
      const [block] = await sp
        .insert(schema.programBlocks)
        .values({
          publicId: newId(),
          householdId: H.householdId,
          slug: 'verify-12a-hidden-block',
          name: 'Old program',
          kind: PROGRAM_BLOCK_KIND.template,
          clientId: newId(),
        })
        .returning({ id: schema.programBlocks.id });
      await assignTo(sp, {
        profileId: athlete.id,
        blockId: block.id,
        idx: 0,
        activeFrom: '2026-11-01',
        activeTo: null,
      });
      const live = await resolve(sp, H, 'hidden-block', FIXTURE_TODAY);
      assert.deepEqual(
        [live.onProgram, live.currentPrograms.length, live.canGoForward],
        [ON_PROGRAM.yes, 1, true],
        'FAM-1 12a hidden block: a live block is a program (non-vacuity)',
      );
      await sp
        .update(schema.programBlocks)
        .set({ deletedAt: new Date() })
        .where(eq(schema.programBlocks.id, block.id));
      const hidden = await resolve(sp, H, 'hidden-block', FIXTURE_TODAY);
      assert.deepEqual(
        [hidden.onProgram, hidden.currentPrograms, hidden.programs, hidden.canGoForward],
        [ON_PROGRAM.never, [], [], false],
        'FAM-1 12a hidden block: a hidden block is no program, now or ahead',
      );
    });
    console.log('✓ FAM-1 12a hidden block: never, no current programs, no look-ahead');

    // ── R1: an archived athlete's FUTURE day keeps the normal preview (C19 dropped) ─────────────
    await inSavepoint(tx, async (sp) => {
      // The rule order: future first (preview, no rows); else writable only inside the window and
      // not archived; else logged rows only. `future-preview` is built from H's world.
      const { athlete, day, world } = DAY_PLAN_FIXTURE_SOURCES['future-preview'];
      await sp
        .update(schema.profiles)
        .set({ archivedAt: new Date() })
        .where(eq(schema.profiles.id, H.profiles.get(athlete)!.id));
      const { athletes: _athletes, ...fixture } = DAY_PLAN_FIXTURES['future-preview'] as DayPlan;
      assert.deepStrictEqual(
        await resolve(sp, H, athlete, day, world.today),
        asJson(translate(fixture, H.ids, 'future-preview')),
        'FAM-1 12a R1: an archived athlete’s future day deep-equals future-preview',
      );
    });
    console.log('✓ FAM-1 12a R1: an archived athlete’s future day is the normal preview');

    // ── R1: an archived athlete's TODAY reads like a closed day ─────────────────────────────────
    // Two fixtures whose `before` differs from `world` by the archive alone: the athletes the world
    // marks archived are archived here, then the day deep-equals the fixture.
    for (const name of ARCHIVE_ONLY_FIXTURES) {
      await inSavepoint(tx, async (sp) => {
        const { athlete, day, world } = DAY_PLAN_FIXTURE_SOURCES[name];
        const archived = world.athletes.filter((a) => a.archived).map((a) => a.id);
        assert.ok(archived.length > 0, `FAM-1 12a R1: ${name} archives someone`);
        for (const id of archived) {
          await sp
            .update(schema.profiles)
            .set({ archivedAt: new Date() })
            .where(eq(schema.profiles.id, H.profiles.get(id)!.id));
        }
        const { athletes: _athletes, ...fixture } = DAY_PLAN_FIXTURES[name] as DayPlan;
        assert.deepStrictEqual(
          await resolve(sp, H, athlete, day, world.today),
          asJson(translate(fixture, H.ids, name)),
          `FAM-1 12a R1: an archived athlete’s today deep-equals ${name}`,
        );
      });
    }
    console.log('✓ FAM-1 12a R1: an archived athlete’s today is read-only, logged rows only');

    // ── (i): an entry in ANOTHER profile's session never lends it a name ────────────────────────
    // H's Athlete One has a session yesterday with no workout (as a purge leaves it) and H's real
    // workout name; F's athlete's entry points at it. Only the session's profile conjunct drops it.
    const plantI = async (sp: VerifyTx, sessionProfileId: number, workoutName: string) => {
      const sessionId = await plantSession(sp, {
        profileId: sessionProfileId,
        day: YESTERDAY,
        workoutId: null,
        workoutName,
      });
      return plantRow(sp, {
        profileId: fAthlete.id,
        day: YESTERDAY,
        sessionId,
        movementId: fMove,
        movementName: F_WORLD.catalog.grip.name,
        set: 1,
        snapshot: '',
        unit: ENTRY_UNIT_WITHOUT_QUANTITY.check,
        activityTypeId,
      });
    };
    const PURGED_NAME = 'Old workout';
    await inSavepoint(tx, async (sp) => {
      // Non-vacuity, and the purged path: the same row in F's OWN session shows, with null ids and
      // the session's frozen name.
      const own = await plantI(sp, fAthlete.id, PURGED_NAME);
      const plan = await resolve(sp, F, 'a1', YESTERDAY);
      const purged = plan.workouts.find((w) => w.name === PURGED_NAME);
      assert.deepEqual(
        purged && {
          ids: [purged.programPublicId, purged.workoutPublicId, purged.label],
          scheduled: purged.scheduled,
          rows: purged.items.flatMap((it) => it.rows.map((r) => r.logged?.entryPublicId)),
        },
        { ids: [null, null, null], scheduled: false, rows: [own.publicId] },
        'FAM-1 12a purged: a row whose workout pointer is NULL shows, with null ids and its frozen name',
      );
    });
    await inSavepoint(tx, async (sp) => {
      const planted = await plantI(sp, H.profiles.get('a1')!.id, HEAVY_A);
      assert.ok(
        (await entriesInAnotherProfilesSession(sp)).includes(planted.id),
        'FAM-1 12a (i): the runbook’s pre-flight (i) query sees the planted entry',
      );
      const plan = await resolve(sp, F, 'a1', YESTERDAY);
      const strings = stringsOf(plan);
      assert.ok(
        !strings.includes(planted.publicId) && !strings.includes(HEAVY_A),
        'FAM-1 12a (i): an entry in another profile’s session is not shown, nor that session’s name',
      );
      assert.deepEqual(
        strings.filter((s) => hStrings.includes(s)),
        [],
        'FAM-1 12a (i): no id of H reaches F’s day',
      );
    });
    console.log(
      '✓ FAM-1 12a (i): an entry in another profile’s session is dropped; a purged one shows',
    );

    // ── A soft-deleted profile resolves to null ─────────────────────────────────────────────────
    await inSavepoint(tx, async (sp) => {
      const athlete = await newAthlete(H, sp, 'deleted');
      await sp
        .update(schema.profiles)
        .set({ deletedAt: new Date() })
        .where(eq(schema.profiles.id, athlete.id));
      assert.equal(
        await resolveDayPlan(asTx(sp), {
          scope: H_SCOPE,
          profilePublicId: athlete.publicId,
          day: FIXTURE_TODAY,
          today: FIXTURE_TODAY,
          catalog: CATALOG_FIXTURE,
        }),
        null,
        'FAM-1 12a ownership: a soft-deleted profile resolves to null',
      );
    });
    console.log('✓ FAM-1 12a ownership: a soft-deleted profile is null');

    // ── restAfter: only for a group with an item showing (D14) ──────────────────────────────────
    await inSavepoint(tx, async (sp) => {
      // Yesterday seen from the day after today: closed. Heavy A's group `a` was logged, `b` not.
      const plan = await resolve(sp, H, 'a1', YESTERDAY, addDays(FIXTURE_TODAY, 1));
      assert.deepEqual(
        Object.keys(workoutOf(plan, H, 'w2')?.restAfter ?? {}),
        ['a'],
        'FAM-1 12a D14: a closed day carries the rest of a shown group only',
      );
    });
    await inSavepoint(tx, async (sp) => {
      // Heavy A without Pull-up: group `a` has ONE live member, DB bench, and it carries the rest.
      await sp
        .update(schema.prescriptions)
        .set({ deletedAt: new Date() })
        .where(eq(schema.prescriptions.id, H.prescriptions.get('w2:pullup')!));
      await sp
        .update(schema.prescriptions)
        .set({ restAfter: '90 s after each round' })
        .where(eq(schema.prescriptions.id, H.prescriptions.get('w2:dbbench')!));
      const plan = await resolve(sp, H, 'a2', YESTERDAY);
      const heavyA = workoutOf(plan, H, 'w2');
      assert.ok(
        heavyA?.items.some((it) => it.superset?.group === 'a'),
        'FAM-1 12a D14: a group of one is still shown (non-vacuity)',
      );
      assert.deepEqual(
        Object.keys(heavyA!.restAfter),
        ['b'],
        'FAM-1 12a D14: a group of one carries no rest',
      );
    });
    console.log('✓ FAM-1 12a D14: no rest for a group that is not shown, or of one');

    // ── C21: a hidden program's or workout's logged rows carry no live id ───────────────────────
    const leftByName = (plan: ResolvedDayPlan, name: string) =>
      plan.workouts.find((w) => !w.scheduled && w.name === name);
    const fromEntriesAlone = (w: DayWorkout | undefined) =>
      w !== undefined &&
      w.label === null &&
      w.description === null &&
      w.progress.done === 0 &&
      w.progress.total === 0 &&
      w.items.length > 0 &&
      w.items.every(
        (it) => it.prescriptionPublicId === null && it.superset === null && it.notes === null,
      );
    await inSavepoint(tx, async (sp) => {
      await sp
        .update(schema.programBlocks)
        .set({ deletedAt: new Date() })
        .where(eq(schema.programBlocks.id, H.blocks.get('p1')!));
      const plan = await resolve(sp, H, 'a1', YESTERDAY);
      const heavyA = leftByName(plan, HEAVY_A);
      const morning = leftByName(plan, MORNING_HABITS);
      assert.ok(
        fromEntriesAlone(heavyA) && fromEntriesAlone(morning),
        'FAM-1 12a C21: a hidden program’s logged workouts show from their entries alone',
      );
      assert.deepEqual(
        [heavyA!.programPublicId, heavyA!.workoutPublicId, morning!.programPublicId],
        [null, null, null],
        'FAM-1 12a C21: a hidden program’s workout has neither a program nor a workout id',
      );
    });
    await inSavepoint(tx, async (sp) => {
      await sp
        .update(schema.workouts)
        .set({ deletedAt: new Date() })
        .where(eq(schema.workouts.id, H.workouts.get('w2')!));
      const plan = await resolve(sp, H, 'a1', YESTERDAY);
      const heavyA = leftByName(plan, HEAVY_A);
      assert.ok(
        fromEntriesAlone(heavyA),
        'FAM-1 12a C21: a hidden workout’s logged rows show from their entries alone',
      );
      assert.deepEqual(
        [heavyA!.programPublicId, heavyA!.workoutPublicId],
        [H.ids.get(fixtureIds.program('p1')), null],
        'FAM-1 12a C21: a hidden workout of a live program keeps the program id, not its own',
      );
    });
    console.log('✓ FAM-1 12a C21: a hidden program or workout carries no live id');

    // ── C24: a live workout logged on a day no assignment covers any more keeps its ids ─────────
    await inSavepoint(tx, async (sp) => {
      // Athlete One logged Heavy A and Morning habits yesterday; then their Family program
      // assignment is soft-deleted. Both are live, so both show as left the week, ids kept.
      await sp
        .update(schema.programAssignments)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(schema.programAssignments.profileId, H.profiles.get('a1')!.id),
            eq(schema.programAssignments.blockId, H.blocks.get('p1')!),
          ),
        );
      const plan = await resolve(sp, H, 'a1', YESTERDAY);
      const p1 = H.ids.get(fixtureIds.program('p1'));
      const heavyA = workoutOf(plan, H, 'w2');
      const heavyADraft = workoutDraft(H_WORLD, 'p1', 'w2');
      assert.deepEqual(
        heavyA && {
          ids: [heavyA.programPublicId, heavyA.workoutPublicId],
          shown: [heavyA.scheduled, heavyA.label, heavyA.name, heavyA.description],
          live: heavyA.items.every((it) => it.prescriptionPublicId !== null),
          total: heavyA.progress.total,
        },
        {
          ids: [p1, H.ids.get(fixtureIds.workout('w2'))],
          shown: [false, null, HEAVY_A, heavyADraft.description],
          live: true,
          total: 4 + 4 + 3 + 3 + 3,
        },
        'FAM-1 12a C24: a live workout on a day no assignment covers shows as left the week, ids kept',
      );
      assert.ok(
        !plan.programs.some((p) => p.programPublicId === p1),
        'FAM-1 12a C24: the program no assignment covers is not one of the day’s programs',
      );
    });
    await inSavepoint(tx, async (sp) => {
      // `onProgram` still follows the assignments: Athlete Two's only program is the Family program,
      // and their Nov 12 Morning habits stays listed after the assignment is soft-deleted.
      await sp
        .update(schema.programAssignments)
        .set({ deletedAt: new Date() })
        .where(eq(schema.programAssignments.profileId, H.profiles.get('a2')!.id));
      const nov12 = '2026-11-12';
      const plan = await resolve(sp, H, 'a2', nov12, addDays(nov12, 1));
      const morning = workoutOf(plan, H, 'w1');
      assert.deepEqual(
        [
          plan.onProgram,
          plan.programs,
          morning?.programPublicId,
          morning?.scheduled,
          morning?.label,
          morning?.items.map((it) => it.rows.length),
        ],
        [ON_PROGRAM.never, [], H.ids.get(fixtureIds.program('p1')), false, null, [1, 1, 3]],
        'FAM-1 12a C24: with no program left, the day is never on one and still lists the logged workout',
      );
    });
    console.log('✓ FAM-1 12a C24: a workout no assignment covers keeps its ids');

    // ── Look-ahead (canGoForward) ───────────────────────────────────────────────────────────────
    await inSavepoint(tx, async (sp) => {
      const athlete = await newAthlete(H, sp, 'ahead');
      const p1 = H.blocks.get('p1')!;
      await assignTo(sp, {
        profileId: athlete.id,
        blockId: p1,
        idx: 0,
        activeFrom: '2026-11-01',
        activeTo: '2026-11-10',
      });
      await assignTo(sp, {
        profileId: athlete.id,
        blockId: p1,
        idx: 1,
        activeFrom: '2026-11-12',
        activeTo: FIXTURE_TODAY,
      });
      const ahead = async (day: string) => (await resolve(sp, H, 'ahead', day)).canGoForward;
      assert.equal(
        await ahead(FIXTURE_TODAY),
        false,
        'FAM-1 12a look-ahead: false today when the program ends today',
      );
      assert.equal(await ahead(YESTERDAY), true, 'FAM-1 12a look-ahead: true on yesterday');
      assert.equal(
        await ahead('2026-11-10'),
        true,
        'FAM-1 12a look-ahead: true on a past day before a gap',
      );
    });
    console.log('✓ FAM-1 12a look-ahead: only while on a program the next day');

    // ── E4: a weigh-in, a practice and a check-in on the day are not in it ──────────────────────
    await inSavepoint(tx, async (sp) => {
      const a1 = H.profiles.get('a1')!;
      const before = await resolve(sp, H, 'a1', FIXTURE_TODAY);
      // The weigh-in carries a set AND today's live Morning habits session: only E4's
      // `movement_id IS NOT NULL` keeps it out.
      const [session] = await sp
        .select({ id: schema.sessions.id })
        .from(schema.sessions)
        .where(
          and(
            eq(schema.sessions.profileId, a1.id),
            eq(schema.sessions.activityDate, FIXTURE_TODAY),
            eq(schema.sessions.workoutId, H.workouts.get('w1')!),
          ),
        );
      const [weighInType] = await sp
        .select({ id: schema.activityTypes.id })
        .from(schema.activityTypes)
        .where(eq(schema.activityTypes.key, SEED_ACTIVITY_TYPE_KEYS.weighIn));
      const planted: string[] = [];
      const [weighIn] = await sp
        .insert(schema.entries)
        .values({
          publicId: newId(),
          clientId: newId(),
          profileId: a1.id,
          activityDate: FIXTURE_TODAY,
          kind: ENTRY_KIND.bodyweight,
          unit: 'lb',
          valueNum: '81',
          activityTypeId: weighInType!.id,
          metricKey: SEED_METRIC_KEYS.bodyweight,
          status: ENTRY_STATUS.done,
          sessionId: session!.id,
          prescriptionSet: 1,
        })
        .returning({ id: schema.entries.id, publicId: schema.entries.publicId });
      await insertEntrySetRows(asTx(sp), { entryId: weighIn.id, sets: [{ quantities: [] }] });
      planted.push(weighIn.publicId);
      const metrics = await sp
        .select({ key: schema.metricDefinitions.key, unit: schema.metricDefinitions.unit })
        .from(schema.metricDefinitions)
        .where(ne(schema.metricDefinitions.key, SEED_METRIC_KEYS.bodyweight));
      assert.ok(metrics.length >= 2, 'FAM-1 12a E4: a practice and a check-in metric are seeded');
      for (const metric of metrics.slice(0, 2)) {
        const [row] = await sp
          .insert(schema.entries)
          .values({
            publicId: newId(),
            clientId: newId(),
            profileId: a1.id,
            activityDate: FIXTURE_TODAY,
            unit: metric.unit,
            valueNum: '30',
            activityTypeId,
            metricKey: metric.key,
            status: ENTRY_STATUS.done,
          })
          .returning({ publicId: schema.entries.publicId });
        planted.push(row.publicId);
      }
      let after: ResolvedDayPlan | { threw: string };
      try {
        after = await resolve(sp, H, 'a1', FIXTURE_TODAY);
      } catch (error) {
        after = { threw: error instanceof Error ? error.message : String(error) };
      }
      assert.deepStrictEqual(
        after,
        before,
        'FAM-1 12a E4: a weigh-in (with a set and a session), a practice and a check-in are not in the day',
      );
      assert.deepEqual(
        stringsOf(after).filter((s) => planted.includes(s)),
        [],
        'FAM-1 12a E4: no planted id reaches the day',
      );
    });
    console.log('✓ FAM-1 12a E4: bodyweight, practice and check-in never enter a DayPlan');

    // ── prescriptionLiveIn: 12b's scope-miss read, the same `false` for every miss ──
    await inSavepoint(tx, async (sp) => {
      const pId = H.prescriptions.get('w2:dbbench')!;
      const publicId = H.ids.get(fixtureIds.prescription('w2', 'dbbench'))!;
      const blockId = H.blocks.get('p1')!;
      const isIn = (scope: HouseholdScope, id = publicId) =>
        prescriptionLiveIn(asTx(sp), scope, id);
      assert.equal(await isIn(H_SCOPE), true, 'FAM-1 12b: prescriptionLiveIn finds its own');
      assert.equal(
        await isIn(F_SCOPE),
        false,
        "FAM-1 12b: prescriptionLiveIn: F does not find H's prescription",
      );
      // The id is compared by value, so a later text or JS-side comparison fails here (C25).
      assert.equal(
        await isIn(H_SCOPE, publicId.toUpperCase()),
        true,
        'FAM-1 12b: prescriptionLiveIn: an upper-case spelling of its own id is found',
      );
      assert.equal(
        await isIn(H_SCOPE, 'not-a-uuid'),
        false,
        'FAM-1 12b: prescriptionLiveIn: a malformed id is false',
      );
      assert.equal(
        await isIn(H_SCOPE, newId()),
        false,
        'FAM-1 12b: prescriptionLiveIn: an unknown id is false',
      );
      // A live prescription of a LIVE legacy block of H's own: not a program the day page logs to.
      const [legacy] = await sp
        .insert(schema.programBlocks)
        .values({
          publicId: newId(),
          householdId: H.householdId,
          slug: 'verify-12b-legacy',
          name: 'Legacy program',
          kind: PROGRAM_BLOCK_KIND.legacy,
        })
        .returning({ id: schema.programBlocks.id });
      const [legacyRx] = await sp
        .insert(schema.prescriptions)
        .values({
          publicId: newId(),
          blockId: legacy.id,
          dayRole: 'strength',
          movementId: H.movements.get('dbbench')!,
          idx: 0,
          sets: 3,
        })
        .returning({ publicId: schema.prescriptions.publicId });
      assert.equal(
        await isIn(H_SCOPE, legacyRx.publicId),
        false,
        'FAM-1 12b: prescriptionLiveIn: a prescription of a legacy program is false',
      );
      await sp
        .update(schema.prescriptions)
        .set({ deletedAt: new Date() })
        .where(eq(schema.prescriptions.id, pId));
      assert.equal(
        await isIn(H_SCOPE),
        false,
        'FAM-1 12b: prescriptionLiveIn: a hidden prescription is false',
      );
      await sp
        .update(schema.prescriptions)
        .set({ deletedAt: null })
        .where(eq(schema.prescriptions.id, pId));
      await sp
        .update(schema.programBlocks)
        .set({ deletedAt: new Date() })
        .where(eq(schema.programBlocks.id, blockId));
      assert.equal(
        await isIn(H_SCOPE),
        false,
        'FAM-1 12b: prescriptionLiveIn: a prescription of a hidden program is false',
      );
    });
    console.log(
      '✓ FAM-1 12b: prescriptionLiveIn (own, other household, malformed, legacy, hidden, hidden program)',
    );
  });
}

// ── 12a-ii — the replays: seed `before`, log, make the change with the real writers ─────────────────

/** A program writer's answer must be `ok`; a refusal fails with the writer's own reason. */
function expectProgramOk(r: ProgramResult<object>, title: string): void {
  assert.ok(r.ok, `${title} — the writer refused: ${JSON.stringify(r)}`);
}

/**
 * C1's round trip where every scheduled row is logged (see `roundTrip`): a returned scheduled entry
 * un-ticks, and each returned entry of a workout that left the week answers `not_scheduled`.
 */
async function allLoggedRoundTrip(
  tx: VerifyTx,
  seeded: Seeded,
  name: string,
  plan: ResolvedDayPlan,
  scheduledEntry: string | undefined,
): Promise<void> {
  const untick = (x: VerifyTx, entryPublicId: string) =>
    untickRow(asDb(x), {
      scope: seeded.scope,
      today: plan.today,
      input: { profilePublicId: plan.profilePublicId, day: plan.day, entryPublicId },
    });
  assert.ok(scheduledEntry, `FAM-1 12a ${name}: a writable fixture has a scheduled row`);
  await inSavepoint(tx, async (sp) => {
    expectOk(
      await untick(sp, scheduledEntry),
      `FAM-1 12a ${name}: a returned scheduled entryPublicId un-ticks`,
    );
  });
  const left = plan.workouts
    .filter((w) => !w.scheduled)
    .flatMap((w) => w.items.flatMap((item) => (item.prescriptionPublicId ? item.rows : [])))
    .filter((row) => row.logged !== null);
  assert.ok(left.length > 0, `FAM-1 12a ${name}: a workout that left the week has logged rows`);
  for (const row of left) {
    assert.deepEqual(
      await untick(tx, row.logged!.entryPublicId),
      { ok: false, reason: ROW_REFUSAL.not_scheduled },
      `FAM-1 12a ${name}: a returned entry of a workout that left the week is not_scheduled`,
    );
  }
}

/** What changed between a fixture's `before` and its `world`, in the three kinds a replay makes. */
type Change =
  | { kind: 'workout'; prog: string; wid: string }
  | { kind: 'week'; prog: string }
  | { kind: 'order'; athlete: string };

/**
 * Plan § 12a-ii, step 4: **classify the change.** A difference the harness cannot replay with a
 * writer throws, naming it: the athletes, the catalog, the entries, today, a program's shell (its
 * name, its workouts, each workout's `from` and rests), or an assignment's dates. A workout's own
 * fields are compared through its `workoutDraft`, and a week through `programView`.
 */
function classify(before: World, world: World, name: string): Change[] {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const unreplayable = (what: string): never => {
    throw new Error(`FAM-1 12a-ii ${name}: unreplayable change: ${what}`);
  };
  if (before.today !== world.today) unreplayable('today');
  if (!same(before.athletes, world.athletes)) unreplayable('athletes');
  if (!same(before.catalog, world.catalog)) unreplayable('catalog');
  if (!same(before.entries, world.entries) || !same(before.stamps, world.stamps)) {
    unreplayable('entries'); // C17: `world`'s entries are `before`'s, stamps included
  }
  const shell = (w: World) =>
    w.programs.map((p) => ({
      id: p.id,
      name: p.name,
      workouts: p.workouts.map((x) => ({ wid: x.wid, from: x.from, rests: x.rests })),
    }));
  if (!same(shell(before), shell(world))) unreplayable('programs or their workouts');

  const changes: Change[] = [];
  for (const program of world.programs) {
    for (const { wid } of program.workouts) {
      if (!same(workoutDraft(before, program.id, wid), workoutDraft(world, program.id, wid))) {
        changes.push({ kind: 'workout', prog: program.id, wid });
      }
    }
    if (!same(programView(before, program.id).week, programView(world, program.id).week)) {
      changes.push({ kind: 'week', prog: program.id });
    }
  }
  const athletes = new Set([...Object.keys(before.assign), ...Object.keys(world.assign)]);
  for (const athlete of athletes) {
    const was = before.assign[athlete] ?? [];
    const now = world.assign[athlete] ?? [];
    if (same(was, now)) continue;
    const sorted = (list: typeof was) => [...list].map((a) => JSON.stringify(a)).sort();
    if (!same(sorted(was), sorted(now))) unreplayable(`${athlete}'s assignments`);
    changes.push({ kind: 'order', athlete });
  }
  return changes;
}

/**
 * Plan § 12a-ii, step 5: **replay each change with its writer**, under the seeded scope. A workout's
 * save is read back: its name is the world's, so a rename that did not land fails here, not only where
 * a later read happens to show it. An edit to its items is caught by the deep-equal.
 */
async function replay(tx: VerifyTx, seeded: Seeded, world: World, changes: Change[], name: string) {
  for (const change of changes) {
    if (change.kind === 'workout') {
      expectProgramOk(
        await saveWorkout(
          asTx(tx),
          seeded.scope,
          translate(workoutDraft(world, change.prog, change.wid), seeded.ids, name),
        ),
        `FAM-1 12a-ii ${name}: saveWorkout replays ${change.wid}`,
      );
      const [saved] = await tx
        .select({ name: schema.workouts.name })
        .from(schema.workouts)
        .where(eq(schema.workouts.id, seeded.workouts.get(change.wid)!));
      assert.equal(
        saved?.name,
        protoWorkoutOf(programOf(world, change.prog), change.wid).name,
        `FAM-1 12a-ii ${name}: ${change.wid} is saved as the world has it`,
      );
    } else if (change.kind === 'week') {
      expectProgramOk(
        await saveWeek(asTx(tx), seeded.scope, {
          programPublicId: seeded.ids.get(fixtureIds.program(change.prog))!,
          days: translate(programView(world, change.prog).week, seeded.ids, name),
        }),
        `FAM-1 12a-ii ${name}: saveWeek replays ${change.prog}'s week`,
      );
    } else {
      await reorder(tx, seeded, world, change.athlete, name);
    }
  }
}

/**
 * The reorder, through lane P's own writer, `reorderPrograms` (6d-ii), in the order the world lists the
 * athlete's assignments. Q6's stand-in (a direct `idx` update, the board, 2026-11-17) is gone with the
 * writer's arrival. Then the board's condition 1, kept as a check on the writer: the athlete's OPEN
 * assignments, the rows the order index covers, have dense `idx` values from 0.
 */
async function reorder(tx: VerifyTx, seeded: Seeded, world: World, athlete: string, name: string) {
  const profile = seeded.profiles.get(athlete)!;
  const programPublicIds = [
    ...new Set(
      (world.assign[athlete] ?? []).map((a) => seeded.ids.get(fixtureIds.program(a.prog))!),
    ),
  ];
  expectProgramOk(
    await reorderPrograms(
      asTx(tx),
      seeded.scope,
      { profilePublicId: profile.publicId, programPublicIds },
      FIXTURE_TODAY,
    ),
    `FAM-1 12a-ii ${name}: reorderPrograms replays ${athlete}'s order`,
  );
  const live = and(
    eq(schema.programAssignments.profileId, profile.id),
    isNull(schema.programAssignments.deletedAt),
  );
  const open = await tx
    .select({ idx: schema.programAssignments.idx })
    .from(schema.programAssignments)
    .where(and(live, isNull(schema.programAssignments.activeTo)))
    .orderBy(schema.programAssignments.idx);
  assert.deepEqual(
    open.map((r) => r.idx),
    open.map((_, i) => i),
    `FAM-1 12a-ii ${name}: the reorder leaves dense idx from 0 on the open assignments`,
  );
}

/**
 * Plan § 12a-ii, step 2: **calibrate.** Save every workout of `before` through `saveWorkout`,
 * unchanged, and the resolved day must not move: the seeder's direct inserts and the writer's rows
 * agree, so a later difference is the edit's. (After the entries are logged, since `seedWorld` logs
 * them; the check is the same.)
 */
async function calibrate(tx: VerifyTx, seeded: Seeded, before: World, name: string, at: Seat) {
  const was = await resolve(tx, seeded, at.athlete, at.day, at.today);
  for (const program of before.programs) {
    for (const { wid } of program.workouts) {
      expectProgramOk(
        await saveWorkout(
          asTx(tx),
          seeded.scope,
          translate(workoutDraft(before, program.id, wid), seeded.ids, name),
        ),
        `FAM-1 12a-ii ${name}: calibration saves ${wid} unchanged`,
      );
    }
  }
  assert.deepStrictEqual(
    await resolve(tx, seeded, at.athlete, at.day, at.today),
    was,
    `FAM-1 12a-ii ${name}: an unchanged save through saveWorkout leaves the day as seeded`,
  );
}

/** Who and when a fixture is read for. */
type Seat = { athlete: string; day: string; today: string };

/**
 * Classify `name`'s change FIRST (so an unreplayable fixture fails by name), then seed its `before`
 * (the seeder logs its entries), calibrate, and replay. Returns the seeded state, now `world`.
 */
async function seedAndReplay(tx: VerifyTx, name: FixtureName, activityTypeId: number) {
  const { world, before, athlete, day } = DAY_PLAN_FIXTURE_SOURCES[name];
  assert.ok(before, `FAM-1 12a-ii ${name}: a replay fixture has a before`);
  const changes = classify(before as World, world as World, name);
  assert.ok(changes.length > 0, `FAM-1 12a-ii ${name}: the replay makes a change`);
  const seeded = await seedWorld(tx, before as World, `${name}-ii`, activityTypeId);
  await calibrate(tx, seeded, before as World, name, { athlete, day, today: world.today });
  await replay(tx, seeded, world as World, changes, name);
  return seeded;
}

async function verifyReplays(): Promise<void> {
  assert.equal(
    REPLAY_FIXTURES.length,
    REPLAY_FIXTURE_COUNT,
    `FAM-1 12a-ii: ${REPLAY_FIXTURE_COUNT} fixtures are replayed`,
  );
  // The classifier's refusal is reachable: an archive is not a program edit.
  assert.throws(
    () => {
      const { before, world } = DAY_PLAN_FIXTURE_SOURCES['archived-athlete-today'];
      classify(before as World, world as World, 'archived-athlete-today');
    },
    /unreplayable change: athletes/,
    'FAM-1 12a-ii: a change no writer replays (an archive) throws by name',
  );
  for (const name of REPLAY_FIXTURES) {
    await rolledBack(async (tx) => {
      const activityTypeId = await workoutItemTypeId(tx);
      const seeded = await seedAndReplay(tx, name, activityTypeId);
      await proveFixture(
        tx,
        seeded,
        name,
        activityTypeId,
        'FAM-1 12a-ii: the resolver, on the replayed state',
      );
    });
    console.log(`✓ FAM-1 12a-ii: the replayed state deep-equals ${name}, ids mapped exactly`);
  }
}

// The rules only a replay reaches use these, on a seeded state, with the executor they are given
// (a savepoint's own `sp`, so a refusal inside one rolls back with it).

/** The day's workout `wid`, by the id the seeder returned. */
function workoutOnDay(plan: ResolvedDayPlan, seeded: Seeded, wid: string): DayWorkout {
  const id = seeded.ids.get(fixtureIds.workout(wid));
  const w = plan.workouts.find((x) => x.workoutPublicId === id);
  assert.ok(w, `FAM-1 12a-ii: ${wid} is on the day`);
  return w;
}

/** A workout's items of movement `key`, live and removed. */
const itemsOf = (w: DayWorkout, seeded: Seeded, key: FixtureItemKey) =>
  w.items.filter((item) => item.itemPublicId === seeded.ids.get(fixtureIds.item(key)));

/**
 * The rules only a replay reaches (plan § 12a-ii, the proofs table), each with its own mutation
 * (`scripts/mutations/README.md`, 255–259 and 340).
 */
async function verifyReplayRules(): Promise<void> {
  // ── R2, writable half: a writable day shows the live name after a rename ────────────────────────
  await rolledBack(async (tx) => {
    const name = 'closed-day-program-since-left';
    const seeded = await seedAndReplay(tx, name, await workoutItemTypeId(tx));
    const { world } = DAY_PLAN_FIXTURE_SOURCES[name];
    const renamed = protoWorkoutOf(programOf(world as World, 'p1'), 'w1').name;
    // a1 logged Morning on yesterday, which is writable.
    const plan = await resolve(tx, seeded, 'a1', YESTERDAY, world.today);
    assert.ok(plan.writable, 'FAM-1 12a-ii R2: yesterday is writable (non-vacuity)');
    assert.equal(
      workoutOnDay(plan, seeded, 'w1').name,
      renamed,
      'FAM-1 12a-ii R2: a writable day shows the live name after a rename',
    );
  });
  console.log('✓ FAM-1 12a-ii R2: the live name on a writable day, the frozen one on a closed day');

  // ── the closed-day heading, and R4, on ONE replayed `yesterday-edited-after-logging` ───────────
  await rolledBack(async (tx) => {
    const name = 'yesterday-edited-after-logging';
    const activityTypeId = await workoutItemTypeId(tx);
    const seeded = await seedAndReplay(tx, name, activityTypeId);
    const { world, before } = DAY_PLAN_FIXTURE_SOURCES[name];

    // The closed-day heading: the first-logged row's snapshot, not the live text.
    const closed = await resolve(tx, seeded, 'a1', YESTERDAY, addDays(FIXTURE_TODAY, 1));
    assert.equal(closed.writable, false, 'FAM-1 12a-ii heading: two days back is closed');
    const [bench] = itemsOf(workoutOnDay(closed, seeded, 'w2'), seeded, 'dbbench');
    assert.ok(bench, 'FAM-1 12a-ii heading: the bench press was logged that day');
    // The text before the edit is what the seeded day showed for it (`yesterday-half-done`).
    const textOf = (fixture: FixtureName) => {
      const plan = DAY_PLAN_FIXTURES[fixture] as DayPlan;
      const heavyA = plan.workouts.find((w) => w.workoutPublicId === fixtureIds.workout('w2'))!;
      return heavyA.items.find(
        (item) => item.itemPublicId === fixtureIds.item('dbbench') && item.prescriptionPublicId,
      )!.prescribedText;
    };
    const logged = textOf('yesterday-half-done');
    const live = textOf('yesterday-edited-after-logging');
    assert.notEqual(logged, live, 'FAM-1 12a-ii heading: the edit changed the text (non-vacuity)');
    assert.equal(
      bench.prescribedText,
      logged,
      'FAM-1 12a-ii heading: where only logged rows show, the heading is what the row was logged against',
    );
    assert.deepEqual(
      bench.rows.map((row) => row.logged?.prescribedText),
      bench.rows.map(() => logged),
      'FAM-1 12a-ii heading: each row keeps its own logged text',
    );
    console.log(
      '✓ FAM-1 12a-ii heading: a closed day heads an item with what it was logged against',
    );

    const heavyA = (w: World) => translate(workoutDraft(w, 'p1', 'w2'), seeded.ids, name);
    /** A card of `key` as `from` had it, under a NEW client id: a card added back, or a second one. */
    const newCard = (from: World, key: FixtureItemKey, over: Partial<WorkoutDraftItem> = {}) => {
      const card = heavyA(from).items.find(
        (i) => i.itemPublicId === seeded.ids.get(fixtureIds.item(key)),
      )!;
      return { ...card, prescriptionClientId: newId(), superset: null, restAfter: null, ...over };
    };
    const save = async (x: VerifyTx, items: WorkoutDraftItem[], title: string) =>
      expectProgramOk(
        await saveWorkout(asTx(x), seeded.scope, { ...heavyA(world as World), items }),
        `FAM-1 12a-ii R4: ${title}`,
      );
    const read = (x: VerifyTx) => resolve(x, seeded, 'a1', YESTERDAY, world.today);
    const tick = async (x: VerifyTx, prescriptionPublicId: string, set: number) =>
      expectOk(
        await logRow(asDb(x), {
          scope: seeded.scope,
          today: world.today,
          activityTypeId,
          write: {
            clientId: newId(),
            profilePublicId: seeded.profiles.get('a1')!.publicId,
            day: YESTERDAY,
            workoutPublicId: seeded.ids.get(fixtureIds.workout('w2'))!,
            prescriptionPublicId,
            set,
            values: { quantities: [] },
          },
        }),
        `FAM-1 12a-ii R4: set ${set} ticks`,
      );
    const edited = heavyA(world as World).items;
    const loggedIds = (item: DayItem) =>
      item.rows.flatMap((r) => (r.logged ? [r.logged.entryPublicId] : [])).sort();

    await inSavepoint(tx, async (sp) => {
      // The pull-up, removed by the edit, added back as a new card.
      await save(sp, [...edited, newCard(before as World, 'pullup')], 'the pull-up is added back');
      const pulls = itemsOf(workoutOnDay(await read(sp), seeded, 'w2'), seeded, 'pullup');
      const live = pulls.filter((i) => i.prescriptionPublicId !== null);
      const removed = pulls.filter((i) => i.prescriptionPublicId === null);
      assert.deepEqual(
        [
          live.length,
          live[0]?.rows.every((r) => r.logged === null),
          removed.length,
          removed[0]?.rows.every((r) => r.logged !== null),
        ],
        [1, true, 1, true],
        'FAM-1 12a-ii R4: a removed prescription’s rows stay their own item when its movement is back',
      );

      // R4's key: a set logged on the new card, then that card removed too: two removed items.
      await tick(sp, live[0]!.prescriptionPublicId!, 1);
      await save(sp, edited, 'the added-back card is removed again');
      const again = itemsOf(workoutOnDay(await read(sp), seeded, 'w2'), seeded, 'pullup');
      assert.equal(
        again.filter((i) => i.prescriptionPublicId === null).length,
        2,
        'FAM-1 12a-ii R4: two removed prescriptions of one movement are two items',
      );
    });

    await inSavepoint(tx, async (sp) => {
      // One movement twice: a second bench card beside the first.
      const second = newCard(world as World, 'dbbench');
      await save(sp, [...edited, second], 'a second card of one movement');
      const benches = itemsOf(workoutOnDay(await read(sp), seeded, 'w2'), seeded, 'dbbench');
      assert.equal(benches.length, 2, 'FAM-1 12a-ii twice: both cards are items');
      const [first, other] = benches;
      const firstIds = loggedIds(first!);
      for (const row of other!.rows) {
        const twin = first!.rows.find((r) => r.set === row.set);
        if (twin) {
          assert.deepEqual(
            row.previous,
            twin.previous,
            `FAM-1 12a-ii twice: the two cards share PREVIOUS for set ${row.set} (rule 5)`,
          );
        }
      }

      // R4's text: set 2 logged, the card's load changed in place, set 1 logged, the card removed.
      const id = other!.prescriptionPublicId!;
      const two = await tick(sp, id, 2);
      const heavier = {
        ...second,
        quantities: second.quantities.map((q) => ({ ...q, value: 40 })),
      };
      await save(sp, [...edited, heavier], 'the second card is re-saved at 40');
      const one = await tick(sp, id, 1);
      const both = itemsOf(workoutOnDay(await read(sp), seeded, 'w2'), seeded, 'dbbench');
      const mine = both.find((i) => i.prescriptionPublicId === id)!;
      const theirs = both.find((i) => i.prescriptionPublicId !== id)!;
      assert.deepEqual(
        [loggedIds(mine), loggedIds(theirs)],
        [[one.entryPublicId, two.entryPublicId].sort(), firstIds],
        'FAM-1 12a-ii twice: each card has its own rows',
      );
      await save(sp, edited, 'the second card is removed');
      const [gone] = itemsOf(workoutOnDay(await read(sp), seeded, 'w2'), seeded, 'dbbench').filter(
        (i) => i.prescriptionPublicId === null,
      );
      assert.ok(gone, 'FAM-1 12a-ii R4: the removed card is an item');
      const textAt = (set: number) => gone.rows.find((r) => r.set === set)!.logged!.prescribedText;
      assert.notEqual(textAt(1), textAt(2), 'FAM-1 12a-ii R4: the two sets differ (non-vacuity)');
      assert.equal(
        gone.prescribedText,
        textAt(1),
        'FAM-1 12a-ii R4: a removed item’s text is its lowest set’s, not its first logged',
      );
    });
  });
  console.log(
    '✓ FAM-1 12a-ii R4: a removed prescription is its own item, by prescription, headed by its lowest set; one movement twice',
  );
}
