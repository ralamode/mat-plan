import assert from 'node:assert/strict';

import {
  ACTIVITY_TYPE_KEYS,
  addDays,
  type DayPlan,
  type DayWorkout,
  ENTRY_KIND,
  ENTRY_STATUS,
  newId,
  PROFILE_KIND,
  PROGRAM_BLOCK_KIND,
  ROW_REFUSAL,
  type RowResult,
  type RowValues,
  SEED_ACTIVITY_TYPE_KEYS,
  SEED_METRIC_KEYS,
  SESSION_TYPE,
  UNIT_DIMENSION_BY_CODE,
  WEEKDAYS,
} from '@mat-plan/shared';
import {
  DAY_PLAN_FIXTURE_SOURCES,
  DAY_PLAN_FIXTURES,
  FIXTURE_TODAY,
  fixtureIds,
  type FixtureItemKey,
  type World,
  workoutDraft,
} from '@mat-plan/shared/program/fixtures';
import { and, eq, inArray, ne } from 'drizzle-orm';

import { schema } from '../../src/client';
import { resolveDayPlan, type ResolvedDayPlan } from '../../src/queries/day/day-plan';
import type { HouseholdScope } from '../../src/scope';
import { logRow, untickRow } from '../../src/writers/day/log-row';
import { hideEntries } from '../../src/writers/hide';
import { householdScopeForScript } from '../../src/writers/household-scope-script';
import { insertEntrySetRows } from '../../src/writers/session-rows';
import { asDb, asTx, rolledBack, type VerifyTx } from './harness';

/**
 * `db:verify` proofs for **the day resolver** (FAM-1 step 12a-i; plan
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
 *   first day OFF; `active_to` is the inclusive last day, so `to − 1`. The direct inserts fold into
 *   lane P's `seedProgramFixtures` at 6c (`docs/tech-debt.md`).
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
 * 12a-i proves the fixtures whose `before` is `null`, chosen by that test, not by a list. The four
 * with a `before` are 12a-ii's: they need the program edits replayed after logging.
 */
export async function verifyDayPlan(): Promise<void> {
  await verifyFixtures();
  await verifyRules();
}

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────

/** Thrown by {@link inSavepoint} to undo its body. Private. */
class Undo extends Error {}

/** Run `fn` in a savepoint that is always rolled back, so proofs on one seeded state stay apart. */
async function inSavepoint(tx: VerifyTx, fn: (sp: VerifyTx) => Promise<void>): Promise<void> {
  try {
    await tx.transaction(async (sp) => {
      await fn(sp);
      throw new Undo();
    });
  } catch (e) {
    if (!(e instanceof Undo)) throw e;
  }
}

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

async function workoutItemTypeId(tx: VerifyTx): Promise<number> {
  const [row] = await tx
    .select({ id: schema.activityTypes.id })
    .from(schema.activityTypes)
    .where(eq(schema.activityTypes.key, ACTIVITY_TYPE_KEYS.workout_item));
  assert.ok(row, 'FAM-1 12a: the workout_item activity type is seeded');
  return row.id;
}

function expectOk(r: RowResult, title: string): Extract<RowResult, { ok: true }> {
  assert.ok(r.ok, `${title} — got ${JSON.stringify(r)}`);
  return r as Extract<RowResult, { ok: true }>;
}

// ── The seeder ────────────────────────────────────────────────────────────────────────────────────

type Seeded = Awaited<ReturnType<typeof seedWorld>>;

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
    const [row] = await tx
      .insert(schema.movements)
      .values({
        publicId: newId(),
        slug: `verify-12a-${label}-${key}`,
        name: world.catalog[key].name,
        householdId: household.id,
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
    const [block] = await tx
      .insert(schema.programBlocks)
      .values({
        publicId: newId(),
        householdId: household.id,
        slug: `verify-12a-${label}-${program.id}`,
        name: program.name,
        kind: PROGRAM_BLOCK_KIND.template,
        clientId: newId(),
      })
      .returning({ id: schema.programBlocks.id, publicId: schema.programBlocks.publicId });
    blocks.set(program.id, block.id);
    ids.set(fixtureIds.program(program.id), block.publicId);

    for (const workout of [...program.workouts].reverse()) {
      const draft = workoutDraft(world, program.id, workout.wid);
      const [w] = await tx
        .insert(schema.workouts)
        .values({
          publicId: newId(),
          clientId: newId(),
          blockId: block.id,
          name: draft.name,
          description: draft.description,
        })
        .returning({ id: schema.workouts.id, publicId: schema.workouts.publicId });
      workouts.set(workout.wid, w.id);
      ids.set(fixtureIds.workout(workout.wid), w.publicId);

      for (const [idx, item] of [...draft.items.entries()].reverse()) {
        const key = workout.items[idx]!.iid;
        const [p] = await tx
          .insert(schema.prescriptions)
          .values({
            publicId: newId(),
            blockId: block.id,
            workoutId: w.id,
            clientId: newId(),
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

  return {
    scope: SEEDED_SCOPE,
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
  });
  assert.ok(plan, `FAM-1 12a: ${athlete} resolves on ${day}`);
  return asJson(plan);
}

// ── The fixtures ──────────────────────────────────────────────────────────────────────────────────

type FixtureName = keyof typeof DAY_PLAN_FIXTURE_SOURCES;

async function verifyFixtures(): Promise<void> {
  // 12a-i's set: the fixtures with no `before`, by that test.
  const names = (Object.keys(DAY_PLAN_FIXTURE_SOURCES) as FixtureName[]).filter(
    (name) => DAY_PLAN_FIXTURE_SOURCES[name].before === null,
  );
  assert.ok(
    names.includes('closed-day-logged-only'),
    'FAM-1 12a: closed-day-logged-only is in 12a-i',
  );
  assert.ok(names.length >= 10, `FAM-1 12a: 12a-i proves ${names.length} fixtures`);

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
        const { world, athlete, day } = DAY_PLAN_FIXTURE_SOURCES[name];
        const actual = await resolve(tx, seeded, athlete, day, world.today);
        const { athletes: _athletes, ...fixture } = DAY_PLAN_FIXTURES[name] as DayPlan;
        assert.deepStrictEqual(
          actual,
          asJson(translate(fixture, seeded.ids, name)),
          `FAM-1 12a: the resolver, on the seeded state, deep-equals ${name}`,
        );
        if (actual.writable && actual.workouts.length > 0) {
          await roundTrip(tx, seeded, name, actual, activityTypeId);
          roundTrips += 1;
        }
        console.log(`✓ FAM-1 12a: the resolver deep-equals ${name}, ids mapped exactly`);
      }
    });
  }
  assert.ok(roundTrips >= 4, `FAM-1 12a: ${roundTrips} writable fixtures round-tripped`);
}

/**
 * C1's round trip: the ids the resolver returned are the writers' ids. An unlogged row ticks through
 * `logRow` (`ok`), a logged set answers `slot_taken`, and a returned `entryPublicId` un-ticks.
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
  assert.ok(unlogged, `FAM-1 12a ${name}: a writable fixture has an unlogged row`);
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
  s: { profileId: number; day: string; workoutId: number; workoutName: string },
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
  await rolledBack(async (tx) => {
    const activityTypeId = await workoutItemTypeId(tx);
    // H: the prototype's household (the seeded world). F: another household, on the every-type
    // program (its athlete `a1` is F's own, logged today in w900, nothing on any other day).
    const H = await seedWorld(
      tx,
      DAY_PLAN_FIXTURE_SOURCES['today-two-programs'].world as World,
      'h',
      activityTypeId,
    );
    const F = await seedWorld(
      tx,
      DAY_PLAN_FIXTURE_SOURCES['every-type-once'].world as World,
      'f',
      activityTypeId,
    );
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
      return plantRow(sp, {
        profileId: fAthlete.id,
        day: YESTERDAY,
        sessionId,
        movementId: fMove,
        movementName: 'Grip: rice bucket',
        set: 1,
        snapshot: '',
        unit: 'bool',
        activityTypeId,
      });
    };
    await inSavepoint(tx, async (sp) => {
      const own = await plantF(sp, F.workouts.get('w900')!, 'One of each');
      const plan = await resolve(sp, F, 'a1', YESTERDAY);
      assert.ok(
        stringsOf(plan).includes(own.publicId),
        'FAM-1 12a (f): the same session on F’s own workout IS shown (non-vacuity)',
      );
    });
    await inSavepoint(tx, async (sp) => {
      const planted = await plantF(sp, H.workouts.get('w2')!, 'Heavy A');
      const plan = await resolve(sp, F, 'a1', YESTERDAY);
      const strings = stringsOf(plan);
      assert.ok(
        !strings.includes(planted.publicId) && plan.workouts.every((w) => w.name !== 'Heavy A'),
        'FAM-1 12a (f): a session naming another household’s workout is not shown',
      );
      assert.deepEqual(
        strings.filter((s) => hStrings.includes(s) || s === 'Heavy A'),
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
        workoutName: 'One of each',
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
        movementName: 'DB bench press',
        prescriptionId,
        set: 1,
        snapshot,
        unit: 'lb',
        activityTypeId,
        supersetId: superset.id,
        values: { reps: 6, quantities: [{ slot: 'primary', unit: 'lb', value: 20 }] },
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
        'yes',
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
        ['never', [], [], [], false],
        'FAM-1 12a (h): an assignment to another household’s program puts the athlete on nothing',
      );
      assert.deepEqual(
        stringsOf(plan).filter((s) => hStrings.includes(s) || s === 'Family program'),
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
        movementName: 'Push-ups',
        set: 1,
        snapshot: '3 × 15',
        unit: 'count',
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
        { quantities: [{ slot: 'primary', unit: 'min', value: 4 }] },
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
          movementName: 'Push press',
          movementId: H.movements.get('pushpress')!,
          activityTypeId,
        })
        .returning({ id: schema.entries.id });
      await insertEntrySetRows(asTx(sp), {
        entryId: strength.id,
        sets: [{ reps: 1, quantities: [{ slot: 'primary', unit: 'lb', value: 99 }] }],
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
        { reps: 6, quantities: [{ slot: 'primary', unit: 'lb', value: 20 }] },
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
            eq(schema.blockDayWorkouts.weekday, 5),
          ),
        );
      const heavyA = async () => workoutOf(await resolve(sp, H, 'a1', YESTERDAY), H, 'w2');
      const left = await heavyA();
      assert.ok(
        left && !left.scheduled && left.label === null,
        'FAM-1 12a hidden: a workout that left the week still shows its logged rows (non-vacuity)',
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
        ['yes', 1, true],
        'FAM-1 12a hidden block: a live block is a program (non-vacuity)',
      );
      await sp
        .update(schema.programBlocks)
        .set({ deletedAt: new Date() })
        .where(eq(schema.programBlocks.id, block.id));
      const hidden = await resolve(sp, H, 'hidden-block', FIXTURE_TODAY);
      assert.deepEqual(
        [hidden.onProgram, hidden.currentPrograms, hidden.programs, hidden.canGoForward],
        ['never', [], [], false],
        'FAM-1 12a hidden block: a hidden block is no program, now or ahead',
      );
    });
    console.log('✓ FAM-1 12a hidden block: never, no current programs, no look-ahead');

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
  });
}
