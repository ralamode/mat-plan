import assert from 'node:assert/strict';

import {
  ACTIVITY_TYPE_KEYS,
  addDays,
  ENTRY_KIND,
  ENTRY_STATUS,
  hasSetRows,
  MASS_QUANTITY_CEILING,
  newId,
  PROFILE_KIND,
  QUANTITY_SLOT,
  ROW_REFUSAL,
  type RowRefusal,
  type RowResult,
  type RowValues,
  type RowWrite,
  SEED_ACTIVITY_TYPE_KEYS,
  SEED_METRIC_KEYS,
  SESSION_TYPE,
  TRACKING_TYPE,
  type TrackingType,
  type Unit,
  UNIT_DIMENSION_BY_CODE,
} from '@mat-plan/shared';
import { prescribedText } from '@mat-plan/shared/program/prescribed-text';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';

import { schema } from '../../src/client';
import { readRowValues } from '../../src/queries/day/stored-row-values';
import { logRow, retickRow, rowWorkout, untickRow } from '../../src/writers/day/log-row';
import { hideEntries } from '../../src/writers/hide';
import { householdScopeForScript } from '../../src/writers/household-scope-script';
import { insertWorkoutOwnedBy } from '../../src/writers/ownership';
import { asDb, asTx, rolledBack, type VerifyContext, type VerifyTx } from './harness';
import {
  entriesOnAnotherWorkoutsPrescriptions,
  entriesOnForeignPrescriptions,
  mkTemplateBlock,
  sessionsOnForeignWorkouts,
  workoutSessionsOfAnotherType,
  workoutSessionsWithADayRole,
} from './schema';

/**
 * `db:verify` proofs for the DAY writers and reads.
 *
 * **Owner: lane E** (`docs/plans/fam-1-family-program.md` §5 → "Lane E · day data"). Only lane E
 * edits this file. Its steps add the proofs here:
 *
 * - step 11a: none of its own (the existing strength proofs in `verify.ts` must pass unchanged);
 * - **step 11b (below)**: the row writer, its un-tick and its re-tick, proof by proof as
 *   `docs/plans/fam-1-11b-row-writer.md` → § Test plan numbers them, each with the mutation patch
 *   that turns it red (`scripts/mutations/README.md`, 110–119, 121–129 and 170–181; 120 is unused, see there);
 * - step 12a: seeds the state each `DayPlan` fixture describes and deep-equals it, with
 *   hand-written timestamps;
 * - step 11c: amend each type; a non-number is refused; an older day is refused;
 * - step 14: template rows of each type in the export.
 *
 * What a module can rely on when it runs, and the helpers to import, are in `./harness` →
 * `VerifyContext`. Step 12a's fixture comparisons go through `./normalize-fixture`, on both sides;
 * the worked example is in `./program.ts`'s header. A row result's `hiddenAt` is a timestamp: name it
 * in `timestampFields`.
 *
 * ## How the 11b proofs are built
 *
 * Every proof runs in its OWN rolled-back transaction on a fresh fixture (`fixture` below): two
 * households of this module's own, H and F (the plan's "B"), so nothing `verify.ts` left in household
 * A or B can satisfy or break an assertion. After every proof the runbook's pre-flight (f) and (g)
 * detectors and the mismatched-pair detector must read nothing.
 *
 * ⚠️ **Order matters, because `db:verify` is fail-fast and each patch's `.expect` names the FIRST
 * assertion that fails.** 3b runs before 3 for that reason: mutation 125 reddens both, and 3b is its
 * proof. A writer that throws is caught (`settle`) and asserted on, so a patch that makes it throw
 * still fails on a named assertion.
 */
export async function verifyDay(_ctx: VerifyContext): Promise<void> {
  await verifyRowWriter();
}

// ── FAM-1 11b — the row writer ──────────────────────────────────────────────────────────────────────

/** The proof day, a Monday, and the athlete's today. */
const DAY = '2026-11-16';
const YESTERDAY = addDays(DAY, -1);
const MONDAY = 1;
const SUNDAY = 0;
const TUESDAY = 2;

/** A writer's answer, or what it threw, so a patch that makes it throw fails on a named assertion. */
type Settled = RowResult | { threw: string };
async function settle(run: Promise<RowResult>): Promise<Settled> {
  try {
    return await run;
  } catch (error) {
    return { threw: error instanceof Error ? error.message : String(error) };
  }
}

function expectOk(r: Settled, title: string): Extract<RowResult, { ok: true }> {
  assert.ok('ok' in r && r.ok, `${title} — got ${JSON.stringify(r)}`);
  return r as Extract<RowResult, { ok: true }>;
}

function expectRefused(r: Settled, reason: RowRefusal, title: string): void {
  assert.deepEqual(r, { ok: false, reason }, `${title} — got ${JSON.stringify(r)}`);
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

/**
 * The plan's fixture (§ Test plan), built fresh for every proof. Household H: a template block whose
 * workouts W1 and W2 are both on Monday's week; one prescription of each tracking type in W1; a
 * superset pair; the bad-value prescriptions; a hidden prescription, workout and block. Household F:
 * its own fully valid template block on Monday, and a hidden workout.
 */
async function fixture(tx: VerifyTx) {
  const exec = asTx(tx);
  const [h, f] = await tx
    .insert(schema.households)
    .values([
      { publicId: newId(), name: 'Verify 11b H' },
      { publicId: newId(), name: 'Verify 11b F' },
    ])
    .returning({ id: schema.households.id });
  const H_SCOPE = householdScopeForScript(h.id);
  const F_SCOPE = householdScopeForScript(f.id);

  const profile = async (householdId: number, name: string, archived = false) => {
    const publicId = newId();
    const [row] = await tx
      .insert(schema.profiles)
      .values({
        publicId,
        name,
        kind: PROFILE_KIND.kid,
        householdId,
        archivedAt: archived ? new Date() : null,
      })
      .returning({ id: schema.profiles.id });
    return { id: row.id, publicId };
  };
  const athlete = await profile(h.id, 'Verify 11b Athlete');
  const sibling = await profile(h.id, 'Verify 11b Sibling');
  const archived = await profile(h.id, 'Verify 11b Archived', true);
  const foreigner = await profile(f.id, 'Verify 11b Foreigner');
  // 6d: athletes of H who are NOT on the block on the proof day.
  const unassigned = await profile(h.id, 'Verify 11b Unassigned');
  const takenOff = await profile(h.id, 'Verify 11b Taken Off');
  const elsewhere = await profile(h.id, 'Verify 11b Elsewhere');

  const movement = async (householdId: number, trackingType: TrackingType, slug: string) => {
    const [row] = await tx
      .insert(schema.movements)
      .values({ publicId: newId(), slug, name: slug, householdId, trackingType })
      .returning({ id: schema.movements.id });
    return row.id;
  };
  const moves = {} as Record<TrackingType, number>;
  for (const type of Object.values(TRACKING_TYPE)) {
    moves[type] = await movement(h.id, type, `verify-11b-${type}`);
  }
  const foreignMove = await movement(f.id, TRACKING_TYPE.check, 'verify-11b-foreign');

  // TODO(lane A request): import mkWorkout from verify/schema.ts once one with this shape exists.
  const mkWorkout = async (scope: typeof H_SCOPE, blockId: number, name: string) => {
    const w = (await insertWorkoutOwnedBy(exec, scope, {
      blockId,
      clientId: newId(),
      name,
      description: null,
    }))!;
    return { id: w.id, publicId: w.publicId, blockId };
  };
  type W = Awaited<ReturnType<typeof mkWorkout>>;
  const schedule = (w: W, weekday: number, idx: number) =>
    tx
      .insert(schema.blockDayWorkouts)
      .values({ blockId: w.blockId, weekday, idx, workoutId: w.id });
  const idxOf = new Map<number, number>();
  // TODO(lane A request): import the template prescription builder from verify/schema.ts.
  const prescription = async (
    w: W,
    movementId: number,
    over: Partial<typeof schema.prescriptions.$inferInsert> = {},
    quantities: {
      slot: string;
      unit: Unit;
      valueMin: string | null;
      valueMax?: string | null;
      hidden?: boolean;
    }[] = [],
  ) => {
    const idx = idxOf.get(w.id) ?? 0;
    idxOf.set(w.id, idx + 1);
    const publicId = newId();
    const [row] = await tx
      .insert(schema.prescriptions)
      .values({
        publicId,
        blockId: w.blockId,
        workoutId: w.id,
        clientId: newId(),
        movementId,
        idx,
        ...over,
      })
      .returning({ id: schema.prescriptions.id });
    for (const q of quantities) {
      await tx.insert(schema.prescriptionQuantities).values({
        prescriptionId: row.id,
        slot: q.slot,
        dimension: UNIT_DIMENSION_BY_CODE[q.unit],
        unit: q.unit,
        valueMin: q.valueMin,
        valueMax: q.valueMax ?? null,
        deletedAt: q.hidden ? new Date() : null,
      });
    }
    return { id: row.id, publicId };
  };
  const primary = QUANTITY_SLOT.primary;

  const block = await mkTemplateBlock(exec, H_SCOPE, 'verify-11b-h');
  const w1 = await mkWorkout(H_SCOPE, block, 'Push day');
  const w2 = await mkWorkout(H_SCOPE, block, 'Pull day');
  const wOff = await mkWorkout(H_SCOPE, block, 'Tuesday day');
  const wHidden = await mkWorkout(H_SCOPE, block, 'Hidden day');
  await schedule(w1, MONDAY, 0);
  await schedule(w2, MONDAY, 1);
  await schedule(wHidden, MONDAY, 2);
  await schedule(w1, SUNDAY, 0);
  await schedule(wOff, TUESDAY, 0);
  const hiddenBlock = await mkTemplateBlock(exec, H_SCOPE, 'verify-11b-h-hidden');
  const wHiddenBlock = await mkWorkout(H_SCOPE, hiddenBlock, 'Old day');
  await schedule(wHiddenBlock, MONDAY, 0);

  const p = {
    check: await prescription(w1, moves.check),
    count: await prescription(w1, moves.count, {}, [
      { slot: primary, unit: 'count', valueMin: '20' },
    ]),
    reps: await prescription(w1, moves.reps, { sets: 3, targetReps: '10' }),
    weightReps: await prescription(w1, moves.weight_reps, { sets: 3, targetReps: '8' }, [
      { slot: primary, unit: 'lb', valueMin: '25' },
    ]),
    duration: await prescription(w1, moves.duration, {}, [
      { slot: primary, unit: 'min', valueMin: '5' },
    ]),
    timeSets: await prescription(w1, moves.time_sets, { sets: 3 }, [
      { slot: primary, unit: 'sec', valueMin: '30' },
    ]),
    distance: await prescription(w1, moves.distance, { sets: 6 }, [
      { slot: QUANTITY_SLOT.distance, unit: 'yd', valueMin: '40' },
    ]),
    repsText: await prescription(w1, moves.reps, { sets: 3, targetReps: '8-12' }),
    noTarget: await prescription(w1, moves.weight_reps, { sets: 3, targetReps: '5' }, [
      { slot: primary, unit: 'lb', valueMin: null },
    ]),
    range: await prescription(w1, moves.weight_reps, { sets: 3, targetReps: '5' }, [
      { slot: primary, unit: 'lb', valueMin: '20', valueMax: '30' },
    ]),
    malformed: await prescription(w1, moves.duration, {}, [
      { slot: primary, unit: 'lb', valueMin: '10' },
    ]),
    // A type with no fixed unit, prescribed in another dimension's unit: only step 10's re-check
    // refuses it, since `itemUnit` takes the row's unit and `fillRowValues` then agrees with it.
    malformedWeight: await prescription(w1, moves.weight_reps, { sets: 3, targetReps: '8' }, [
      { slot: primary, unit: 'sec', valueMin: '30' },
    ]),
    hiddenQuantity: await prescription(w1, moves.weight_reps, { sets: 3, targetReps: '5' }, [
      { slot: primary, unit: 'lb', valueMin: '99', hidden: true },
      { slot: primary, unit: 'lb', valueMin: '50' },
    ]),
    supA: await prescription(w1, moves.reps, {
      targetReps: '10',
      supersetLabel: 'a',
      supersetOrder: 1,
    }),
    supB: await prescription(w1, moves.reps, {
      targetReps: '10',
      supersetLabel: 'a',
      supersetOrder: 2,
    }),
    hidden: await prescription(w1, moves.check, { deletedAt: new Date() }),
    foreignMove: await prescription(w1, foreignMove),
    w2: await prescription(w2, moves.check),
    off: await prescription(wOff, moves.check),
    inHiddenWorkout: await prescription(wHidden, moves.check),
    inHiddenBlock: await prescription(wHiddenBlock, moves.check),
  };
  await tx
    .update(schema.workouts)
    .set({ deletedAt: new Date() })
    .where(eq(schema.workouts.id, wHidden.id));
  await tx
    .update(schema.programBlocks)
    .set({ deletedAt: new Date() })
    .where(eq(schema.programBlocks.id, hiddenBlock));

  // Household F: a fully valid block of its own on Monday, and a hidden workout.
  const fBlock = await mkTemplateBlock(exec, F_SCOPE, 'verify-11b-f');
  const fw = await mkWorkout(F_SCOPE, fBlock, 'Their day');
  const fwHidden = await mkWorkout(F_SCOPE, fBlock, 'Their old day');
  await schedule(fw, MONDAY, 0);
  await schedule(fwHidden, MONDAY, 1);
  const fp = await prescription(fw, foreignMove);
  const fpHidden = await prescription(fwHidden, foreignMove);
  await tx
    .update(schema.workouts)
    .set({ deletedAt: new Date() })
    .where(eq(schema.workouts.id, fwHidden.id));

  // Step 5: who is on which program. Every athlete that ticks is assigned (the athlete and the
  // sibling to H's block, the foreigner to F's), from well before the proof day and still open, so
  // YESTERDAY and DAY are both on it. 6d's three athletes are not on H's block on DAY.
  let assignIdx = 0;
  const assign = (
    profileId: number,
    blockId: number,
    activeFrom: string,
    activeTo: string | null,
  ) =>
    tx.insert(schema.programAssignments).values({
      publicId: newId(),
      profileId,
      blockId,
      idx: assignIdx++,
      activeFrom,
      activeTo,
    });
  const LONG_AGO = addDays(DAY, -30);
  await assign(athlete.id, block, LONG_AGO, null);
  await assign(athlete.id, hiddenBlock, LONG_AGO, null);
  await assign(sibling.id, block, LONG_AGO, null);
  await assign(archived.id, block, LONG_AGO, null);
  await assign(foreigner.id, fBlock, LONG_AGO, null);
  await assign(takenOff.id, block, LONG_AGO, YESTERDAY); // its last day was yesterday
  const otherBlock = await mkTemplateBlock(exec, H_SCOPE, 'verify-11b-h-other');
  await assign(elsewhere.id, otherBlock, LONG_AGO, null); // on a program, but not this one

  const [activity] = await tx
    .select({ id: schema.activityTypes.id })
    .from(schema.activityTypes)
    .where(eq(schema.activityTypes.key, ACTIVITY_TYPE_KEYS.workout_item));
  assert.ok(activity, 'FAM-1 11b: the workout_item activity type is seeded');

  /**
   * A ✓ with sensible defaults (the athlete, W1, set 1, nothing typed) in the scope given, which is
   * positional and required (`scope.test.ts`: no defaulted scope). `tick` is H's.
   */
  const tickIn = (
    scope: typeof H_SCOPE,
    write: Partial<RowWrite> & Pick<RowWrite, 'prescriptionPublicId'>,
    today: string,
  ) =>
    settle(
      logRow(asDb(tx), {
        scope,
        today,
        activityTypeId: activity.id,
        write: {
          clientId: newId(),
          profilePublicId: athlete.publicId,
          day: DAY,
          workoutPublicId: w1.publicId,
          set: 1,
          values: { quantities: [] },
          ...write,
        },
      }),
    );
  const tick = (write: Partial<RowWrite> & Pick<RowWrite, 'prescriptionPublicId'>, today = DAY) =>
    tickIn(H_SCOPE, write, today);
  const untick = (entryPublicId: string, profilePublicId = athlete.publicId) =>
    settle(
      untickRow(asDb(tx), {
        scope: H_SCOPE,
        today: DAY,
        input: { profilePublicId, day: DAY, entryPublicId },
      }),
    );
  const retick = (entryPublicId: string, hiddenAt: string) =>
    settle(
      retickRow(asDb(tx), {
        scope: H_SCOPE,
        today: DAY,
        input: { profilePublicId: athlete.publicId, day: DAY, entryPublicId, hiddenAt },
      }),
    );
  const countEntries = async (profileId: number) =>
    (
      await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.entries)
        .where(eq(schema.entries.profileId, profileId))
    )[0].n;
  const countSessions = async (profileId: number) =>
    (
      await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.sessions)
        .where(eq(schema.sessions.profileId, profileId))
    )[0].n;
  const entryRow = async (publicId: string) =>
    (
      await tx
        .select({
          id: schema.entries.id,
          unit: schema.entries.unit,
          sessionId: schema.entries.sessionId,
          supersetId: schema.entries.supersetId,
          supersetOrder: schema.entries.supersetOrder,
          snapshot: schema.entries.prescribedSnapshot,
          deletedAt: schema.entries.deletedAt,
        })
        .from(schema.entries)
        .where(eq(schema.entries.publicId, publicId))
    )[0];
  const weighIn = async (hidden: boolean) => {
    const [type] = await tx
      .select({ id: schema.activityTypes.id })
      .from(schema.activityTypes)
      .where(eq(schema.activityTypes.key, SEED_ACTIVITY_TYPE_KEYS.weighIn));
    const publicId = newId();
    await tx.insert(schema.entries).values({
      publicId,
      clientId: newId(),
      profileId: athlete.id,
      activityDate: DAY,
      kind: ENTRY_KIND.bodyweight,
      unit: 'lb',
      valueNum: '80',
      activityTypeId: type.id,
      metricKey: SEED_METRIC_KEYS.bodyweight,
      status: ENTRY_STATUS.done,
    });
    const hiddenAt = hidden
      ? await hideEntries(exec, {
          profilePublicId: athlete.publicId,
          scope: H_SCOPE,
          day: DAY,
          entryPublicIds: [publicId],
        })
      : null;
    return {
      publicId,
      hiddenAt: hiddenAt && 'hiddenAt' in hiddenAt ? hiddenAt.hiddenAt : null,
    };
  };

  return {
    exec,
    H_SCOPE,
    F_SCOPE,
    athlete,
    sibling,
    archived,
    foreigner,
    unassigned,
    takenOff,
    elsewhere,
    moves,
    w1,
    w2,
    wOff,
    wHidden,
    fw,
    p,
    fp,
    fpHidden,
    fwHidden,
    activityTypeId: activity.id,
    tickIn,
    tick,
    untick,
    retick,
    countEntries,
    countSessions,
    entryRow,
    weighIn,
  };
}

/** One proof: a fresh fixture, the body, then the detector sweep, all rolled back. */
async function proof(name: string, body: (f: Fixture, tx: VerifyTx) => Promise<void>) {
  await rolledBack(async (tx) => {
    const f = await fixture(tx);
    await body(f, tx);
    assert.deepEqual(
      {
        f: await sessionsOnForeignWorkouts(tx),
        g: await entriesOnForeignPrescriptions(tx),
        pair: await entriesOnAnotherWorkoutsPrescriptions(tx),
        sessionType: await workoutSessionsOfAnotherType(tx),
        dayRole: await workoutSessionsWithADayRole(tx),
      },
      { f: [], g: [], pair: [], sessionType: [], dayRole: [] },
      `FAM-1 11b ${name}: lane A's (f), (g), mismatched-pair and workout-session detectors read nothing`,
    );
  });
  console.log(`✓ FAM-1 11b ${name}`);
}

async function verifyRowWriter(): Promise<void> {
  // ── 1 · two workouts on one day are two sessions; a second tick reuses its session (P10, 117) ────
  await proof('1: one session per workout per day', async (f, tx) => {
    const a = expectOk(
      await f.tick({ prescriptionPublicId: f.p.check.publicId }),
      'FAM-1 11b 1: W1 tick',
    );
    const b = expectOk(
      await f.tick({ workoutPublicId: f.w2.publicId, prescriptionPublicId: f.p.w2.publicId }),
      'FAM-1 11b 1: a second workout ticked on the same day is ok',
    );
    const c = expectOk(
      await f.tick({ prescriptionPublicId: f.p.reps.publicId }),
      'FAM-1 11b 1: a second tick in W1 is ok',
    );
    const sessions = await tx
      .select({ id: schema.sessions.id, workoutId: schema.sessions.workoutId })
      .from(schema.sessions)
      .where(eq(schema.sessions.profileId, f.athlete.id));
    assert.deepEqual(
      sessions.map((s) => s.workoutId).sort(),
      [f.w1.id, f.w2.id].sort(),
      'FAM-1 11b 1: two workouts on one day are two sessions',
    );
    const [ea, eb, ec] = await Promise.all([a, b, c].map((r) => f.entryRow(r.entryPublicId)));
    assert.equal(ea.sessionId, ec.sessionId, 'FAM-1 11b 1: a second tick in W1 reuses its session');
    assert.notEqual(ea.sessionId, eb.sessionId, "FAM-1 11b 1: W2's entry is in W2's session");
  });

  // ── 2 · twin row: a second clientId on a logged set is slot_taken; a replay answers the first (P12, 119)
  await proof('2: twin row', async (f, tx) => {
    const first = expectOk(
      await f.tick({ prescriptionPublicId: f.p.reps.publicId }),
      'FAM-1 11b 2: the first tick',
    );
    expectRefused(
      await f.tick({
        prescriptionPublicId: f.p.reps.publicId,
        values: { reps: 12, quantities: [] },
      }),
      ROW_REFUSAL.slot_taken,
      'FAM-1 11b 2: a second clientId on a logged set is slot_taken',
    );
    const live = await tx
      .select({ id: schema.entries.id })
      .from(schema.entries)
      .where(
        and(
          eq(schema.entries.profileId, f.athlete.id),
          eq(schema.entries.prescriptionId, f.p.reps.id),
          isNull(schema.entries.deletedAt),
        ),
      );
    assert.equal(live.length, 1, 'FAM-1 11b 2: the twin wrote no second entry');
    const [{ clientId }] = await tx
      .select({ clientId: schema.entries.clientId })
      .from(schema.entries)
      .where(eq(schema.entries.publicId, first.entryPublicId));
    assert.deepEqual(
      await f.tick({ clientId, prescriptionPublicId: f.p.reps.publicId }),
      first,
      'FAM-1 11b 2: a replay of the first answers as the first did',
    );
  });

  // ── 2a · the first answer and a replay's are the same stored row (181) ──────────────────────────
  await proof('2a: every answer is the stored row', async (f) => {
    const clientId = newId();
    const typed = {
      quantities: [{ slot: QUANTITY_SLOT.distance, unit: 'yd' as Unit, value: 40.12345 }],
    };
    const first = expectOk(
      await f.tick({ clientId, prescriptionPublicId: f.p.distance.publicId, values: typed }),
      'FAM-1 11b 2a: a distance of 40.12345',
    );
    assert.deepEqual(
      await f.tick({ clientId, prescriptionPublicId: f.p.distance.publicId, values: typed }),
      first,
      'FAM-1 11b 2a: a replay answers exactly what the first call answered (numeric(8,3) rounds)',
    );
    assert.equal(
      first.values.quantities[0].value,
      40.123,
      'FAM-1 11b 2a: the answer is the stored 40.123',
    );
  });

  // ── 3b · ✓ c1, un-tick, ✓ c2 on the same set, replay c1 → own_hidden (P18, 125) ──────────────────
  // Before 3: mutation 125 reddens 3 as well, and this is its proof.
  await proof('3b: a replay of an un-ticked attempt after a new ✓', async (f) => {
    const c1 = newId();
    const first = expectOk(
      await f.tick({ clientId: c1, prescriptionPublicId: f.p.reps.publicId }),
      'FAM-1 11b 3b: ✓ c1',
    );
    expectOk(await f.untick(first.entryPublicId), 'FAM-1 11b 3b: un-tick c1');
    expectOk(
      await f.tick({ prescriptionPublicId: f.p.reps.publicId }),
      'FAM-1 11b 3b: ✓ c2 on the same set',
    );
    expectRefused(
      await f.tick({ clientId: c1, prescriptionPublicId: f.p.reps.publicId }),
      ROW_REFUSAL.own_hidden,
      'FAM-1 11b 3b: replaying c1 after c2 took the set is own_hidden',
    );
  });

  // ── 3 · replay after Clear day → own_hidden, nothing written (D18) ───────────────────────────────
  await proof('3: replay after Clear day', async (f) => {
    const c1 = newId();
    const first = expectOk(
      await f.tick({ clientId: c1, prescriptionPublicId: f.p.check.publicId }),
      'FAM-1 11b 3: the tick',
    );
    // Clear day hides every row of the day as one event, through the one hide writer.
    const cleared = await hideEntries(f.exec, {
      profilePublicId: f.athlete.publicId,
      scope: f.H_SCOPE,
      day: DAY,
      entryPublicIds: [first.entryPublicId],
    });
    assert.ok('hiddenAt' in cleared, 'FAM-1 11b 3: Clear day hid the row');
    const before = [await f.countEntries(f.athlete.id), await f.countSessions(f.athlete.id)];
    expectRefused(
      await f.tick({ clientId: c1, prescriptionPublicId: f.p.check.publicId }),
      ROW_REFUSAL.own_hidden,
      'FAM-1 11b 3: a replay after Clear day is own_hidden',
    );
    assert.deepEqual(
      [await f.countEntries(f.athlete.id), await f.countSessions(f.athlete.id)],
      before,
      'FAM-1 11b 3: the replay wrote nothing',
    );
  });

  // ── 3a · ✓, hide the prescription, replay → ok (P2, 110) ─────────────────────────────────────────
  await proof('3a: a replay answers before the program checks', async (f, tx) => {
    const c1 = newId();
    const first = expectOk(
      await f.tick({ clientId: c1, prescriptionPublicId: f.p.check.publicId }),
      'FAM-1 11b 3a: the tick',
    );
    await tx
      .update(schema.prescriptions)
      .set({ deletedAt: new Date() })
      .where(eq(schema.prescriptions.id, f.p.check.id));
    assert.deepEqual(
      await f.tick({ clientId: c1, prescriptionPublicId: f.p.check.publicId }),
      first,
      'FAM-1 11b 3a: a replay after the prescription is hidden answers ok',
    );
  });

  // ── 3c–3h · a reused clientId held by another row → not_found, nothing written ───────────────────
  const reused = async (
    f: Fixture,
    title: string,
    plant: (clientId: string) => Promise<void>,
    write: Partial<RowWrite> & Pick<RowWrite, 'prescriptionPublicId'>,
  ) => {
    const clientId = newId();
    await plant(clientId);
    const before = await f.countEntries(f.athlete.id);
    expectRefused(await f.tick({ clientId, ...write }), ROW_REFUSAL.not_found, title);
    assert.equal(await f.countEntries(f.athlete.id), before, `${title}: nothing written`);
  };
  await proof('3c: a clientId held by another profile’s row', (f) =>
    reused(
      f,
      'FAM-1 11b 3c: a clientId held by another profile’s program row is not_found',
      async (clientId) => {
        expectOk(
          await f.tick({
            clientId,
            profilePublicId: f.sibling.publicId,
            prescriptionPublicId: f.p.check.publicId,
          }),
          'FAM-1 11b 3c: the sibling’s tick',
        );
      },
      { prescriptionPublicId: f.p.check.publicId },
    ),
  );
  await proof('3d: a clientId held by a strength entry', (f, tx) =>
    reused(
      f,
      'FAM-1 11b 3d: a clientId held by this profile’s strength entry is not_found',
      async (clientId) => {
        await tx.insert(schema.entries).values({
          publicId: newId(),
          clientId,
          profileId: f.athlete.id,
          activityDate: DAY,
          unit: 'lb',
          movementName: 'verify-11b-check',
          movementId: f.moves.check,
          activityTypeId: f.activityTypeId,
        });
      },
      { prescriptionPublicId: f.p.check.publicId },
    ),
  );
  await proof('3e: a clientId held by a row on another day', (f) =>
    reused(
      f,
      'FAM-1 11b 3e: a clientId held by this profile’s row on another day is not_found',
      async (clientId) => {
        expectOk(
          await f.tick({ clientId, day: YESTERDAY, prescriptionPublicId: f.p.check.publicId }),
          'FAM-1 11b 3e: yesterday’s tick',
        );
      },
      { prescriptionPublicId: f.p.check.publicId },
    ),
  );
  await proof('3f: a clientId held by another set', (f) =>
    reused(
      f,
      'FAM-1 11b 3f: a clientId held by another set is not_found',
      async (clientId) => {
        expectOk(
          await f.tick({ clientId, prescriptionPublicId: f.p.reps.publicId }),
          'FAM-1 11b 3f: set 1',
        );
      },
      { prescriptionPublicId: f.p.reps.publicId, set: 2 },
    ),
  );
  await proof('3g: a clientId held by another prescription', (f) =>
    reused(
      f,
      'FAM-1 11b 3g: a clientId held by another prescription is not_found',
      async (clientId) => {
        expectOk(
          await f.tick({ clientId, prescriptionPublicId: f.p.check.publicId }),
          'FAM-1 11b 3g: the check’s tick',
        );
      },
      { prescriptionPublicId: f.p.count.publicId },
    ),
  );
  await proof('3h: a clientId held by another workout', (f) =>
    reused(
      f,
      'FAM-1 11b 3h: a clientId held under another workout is not_found',
      async (clientId) => {
        expectOk(
          await f.tick({ clientId, prescriptionPublicId: f.p.check.publicId }),
          'FAM-1 11b 3h: the W1 tick',
        );
      },
      { workoutPublicId: f.w2.publicId, prescriptionPublicId: f.p.check.publicId },
    ),
  );

  // ── 3i · a HIDDEN row of another household holding the clientId → not_found, never own_hidden (179)
  await proof('3i: another household’s hidden holder', async (f) => {
    const clientId = newId();
    const theirs = expectOk(
      await f.tickIn(
        f.F_SCOPE,
        {
          clientId,
          profilePublicId: f.foreigner.publicId,
          workoutPublicId: f.fw.publicId,
          prescriptionPublicId: f.fp.publicId,
        },
        DAY,
      ),
      'FAM-1 11b 3i: F’s tick',
    );
    const hidden = await hideEntries(f.exec, {
      profilePublicId: f.foreigner.publicId,
      scope: f.F_SCOPE,
      day: DAY,
      entryPublicIds: [theirs.entryPublicId],
    });
    assert.ok('hiddenAt' in hidden, 'FAM-1 11b 3i: F’s row is hidden');
    expectRefused(
      await f.tick({ clientId, prescriptionPublicId: f.p.check.publicId }),
      ROW_REFUSAL.not_found,
      'FAM-1 11b 3i: a clientId held by another household’s hidden row is not_found',
    );
  });

  // ── 4 · each tracking type, empty ✓ and typed, read back; the shape CHECK ───────────────────────
  // No patch of its own (plan P13): hard-coding the quantity's dimension reddens `verify.ts`'s GAP-3
  // hold proof first, as a raw FK error (`scripts/mutations/README.md`).
  await proof('4: every tracking type', async (f, tx) => {
    const lb = (value: number) => ({ slot: QUANTITY_SLOT.primary, unit: 'lb' as Unit, value });
    const cases: {
      type: TrackingType;
      prescriptionPublicId: string;
      unit: Unit;
      empty: RowValues;
      typed: RowValues;
    }[] = [
      {
        type: TRACKING_TYPE.check,
        prescriptionPublicId: f.p.check.publicId,
        unit: 'bool',
        empty: { quantities: [] },
        typed: { quantities: [] },
      },
      {
        type: TRACKING_TYPE.reps,
        prescriptionPublicId: f.p.reps.publicId,
        unit: 'count',
        empty: { reps: 10, quantities: [] },
        typed: { reps: 12, quantities: [] },
      },
      {
        type: TRACKING_TYPE.weight_reps,
        prescriptionPublicId: f.p.weightReps.publicId,
        unit: 'lb',
        empty: { reps: 8, quantities: [lb(25)] },
        typed: { reps: 6, quantities: [lb(30)] },
      },
      {
        type: TRACKING_TYPE.duration,
        prescriptionPublicId: f.p.duration.publicId,
        unit: 'min',
        empty: { quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'min', value: 5 }] },
        typed: { quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'min', value: 7 }] },
      },
      {
        type: TRACKING_TYPE.count,
        prescriptionPublicId: f.p.count.publicId,
        unit: 'count',
        empty: { quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'count', value: 20 }] },
        typed: { quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'count', value: 15 }] },
      },
      {
        type: TRACKING_TYPE.time_sets,
        prescriptionPublicId: f.p.timeSets.publicId,
        unit: 'sec',
        empty: { quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'sec', value: 30 }] },
        typed: { quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'sec', value: 45 }] },
      },
      {
        type: TRACKING_TYPE.distance,
        prescriptionPublicId: f.p.distance.publicId,
        unit: 'yd',
        empty: { quantities: [{ slot: QUANTITY_SLOT.distance, unit: 'yd', value: 40 }] },
        typed: { quantities: [{ slot: QUANTITY_SLOT.distance, unit: 'yd', value: 50 }] },
      },
    ];
    for (const c of cases) {
      // A type with set rows takes the typed ✓ on set 2; a one-row type, on yesterday (W1 is on
      // Sunday's week too).
      const oneRow = !hasSetRows(c.type);
      const runs: [string, RowValues, RowValues, Partial<RowWrite>][] = [
        ['empty ✓', { quantities: [] }, c.empty, {}],
        ['typed', c.typed, c.typed, oneRow ? { day: YESTERDAY } : { set: 2 }],
      ];
      for (const [how, typed, expected, over] of runs) {
        const title = `FAM-1 11b 4: a ${c.type} row, ${how}`;
        const r = expectOk(
          await f.tick({ prescriptionPublicId: c.prescriptionPublicId, values: typed, ...over }),
          `${title}, is ok`,
        );
        assert.deepEqual(r.values, expected, `${title}, answers what it stored`);
        const stored = await f.entryRow(r.entryPublicId);
        assert.equal(stored.unit, c.unit, `${title}, stores entries.unit ${c.unit}`);
        assert.deepEqual(
          (await readRowValues(f.exec, [stored.id])).get(stored.id),
          expected,
          `${title}, reads back as it answered`,
        );
      }
    }
    // A kind-NULL check-in still passes the shape CHECK beside the rows above.
    const [metric] = await tx
      .select({ key: schema.metricDefinitions.key, unit: schema.metricDefinitions.unit })
      .from(schema.metricDefinitions)
      .where(ne(schema.metricDefinitions.key, SEED_METRIC_KEYS.bodyweight))
      .limit(1);
    await tx.insert(schema.entries).values({
      publicId: newId(),
      clientId: newId(),
      profileId: f.athlete.id,
      activityDate: DAY,
      unit: metric.unit,
      valueNum: '1',
      activityTypeId: f.activityTypeId,
      metricKey: metric.key,
      status: ENTRY_STATUS.done,
    });
  });

  // ── 4d · 4e · rowWorkout where profile and scope disagree (P3 111) ───────────────────────────────
  // 4e is red under mutation 47 too, but shadowed: 4a-i's assertion in `verify/schema.ts` fails first.
  await proof('4d/4e: the workout lookup’s two household conjuncts', async (f) => {
    assert.ok(
      await rowWorkout(f.exec, f.athlete.id, f.H_SCOPE, f.w1.publicId),
      'FAM-1 11b 4d: the athlete’s own workout is found (non-vacuity)',
    );
    assert.equal(
      await rowWorkout(f.exec, f.foreigner.id, f.H_SCOPE, f.w1.publicId),
      null,
      'FAM-1 11b 4d: F’s profile under H’s scope never reaches H’s workout',
    );
    assert.equal(
      await rowWorkout(f.exec, f.foreigner.id, f.H_SCOPE, f.fw.publicId),
      null,
      'FAM-1 11b 4e: F’s profile under H’s scope never reaches F’s workout',
    );
  });

  // ── 5 · bad_value as the writer reaches the fill rule (C10's tests own the rule) ─────────────────
  await proof('5: bad_value', async (f) => {
    const bad = async (
      title: string,
      write: Partial<RowWrite> & Pick<RowWrite, 'prescriptionPublicId'>,
    ) =>
      expectRefused(
        await f.tick(write),
        ROW_REFUSAL.bad_value,
        `FAM-1 11b 5: ${title} is bad_value`,
      );
    await bad('an empty ✓ on reps of 8-12', { prescriptionPublicId: f.p.repsText.publicId });
    await bad('an empty ✓ with no target weight', { prescriptionPublicId: f.p.noTarget.publicId });
    await bad('an empty ✓ on a range', { prescriptionPublicId: f.p.range.publicId });
    await bad('a weight in another unit', {
      prescriptionPublicId: f.p.weightReps.publicId,
      values: { quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'kg', value: 30 }] },
    });
    await bad('a weight over the ceiling', {
      prescriptionPublicId: f.p.weightReps.publicId,
      values: {
        quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'lb', value: MASS_QUANTITY_CEILING + 1 }],
      },
    });
    expectOk(
      await f.tick({
        prescriptionPublicId: f.p.range.publicId,
        values: { quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'lb', value: 25 }] },
      }),
      'FAM-1 11b 5: a range with the weight typed is ok',
    );
  });

  // ── 5a · a hidden quantity under a live one is never copied (P6, 113) ────────────────────────────
  await proof('5a: hidden quantities', async (f) => {
    const r = expectOk(
      await f.tick({ prescriptionPublicId: f.p.hiddenQuantity.publicId }),
      'FAM-1 11b 5a: an empty ✓ beside a hidden quantity is ok',
    );
    assert.deepEqual(
      r.values,
      { reps: 5, quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'lb', value: 50 }] },
      'FAM-1 11b 5a: the live quantity is copied, never the hidden one',
    );
  });

  // ── 5b · a malformed prescription is bad_value (P21, 127) ────────────────────────────────────────
  await proof('5b: a malformed prescription', async (f) => {
    expectRefused(
      await f.tick({ prescriptionPublicId: f.p.malformedWeight.publicId }),
      ROW_REFUSAL.bad_value,
      'FAM-1 11b 5b: a Weight × reps prescribed in sec is bad_value',
    );
    // A Duration in lb is refused twice over (the re-check, and `fillRowValues` against its fixed `min`).
    expectRefused(
      await f.tick({ prescriptionPublicId: f.p.malformed.publicId }),
      ROW_REFUSAL.bad_value,
      'FAM-1 11b 5b: a Duration prescribed in lb is bad_value',
    );
  });

  // ── 6 · closed_day (P17 124, P16 123) ────────────────────────────────────────────────────────────
  await proof('6: closed_day', async (f) => {
    expectRefused(
      await f.tick({ day: addDays(DAY, -2), prescriptionPublicId: f.p.check.publicId }),
      ROW_REFUSAL.closed_day,
      'FAM-1 11b 6: two days back is closed_day',
    );
    expectRefused(
      await f.tick({ prescriptionPublicId: f.p.check.publicId }, YESTERDAY),
      ROW_REFUSAL.closed_day,
      'FAM-1 11b 6: tomorrow is closed_day (D32)',
    );
    expectRefused(
      await f.tick({
        profilePublicId: f.archived.publicId,
        prescriptionPublicId: f.p.check.publicId,
      }),
      ROW_REFUSAL.closed_day,
      'FAM-1 11b 6: an archived athlete’s tick is closed_day',
    );
  });

  // ── 6a · not_scheduled (P8, 115) ─────────────────────────────────────────────────────────────────
  await proof('6a: not_scheduled', async (f) => {
    expectRefused(
      await f.tick({ workoutPublicId: f.wOff.publicId, prescriptionPublicId: f.p.off.publicId }),
      ROW_REFUSAL.not_scheduled,
      'FAM-1 11b 6a: a workout on another weekday is not_scheduled',
    );
  });

  // ── 6b · program_changed (P19, 126) ──────────────────────────────────────────────────────────────
  await proof('6b: program_changed', async (f, tx) => {
    expectRefused(
      await f.tick({ prescriptionPublicId: f.p.hidden.publicId }),
      ROW_REFUSAL.program_changed,
      'FAM-1 11b 6b: a hidden prescription is program_changed',
    );
    expectRefused(
      await f.tick({
        workoutPublicId: f.wHidden.publicId,
        prescriptionPublicId: f.p.inHiddenWorkout.publicId,
      }),
      ROW_REFUSAL.program_changed,
      'FAM-1 11b 6b: a hidden workout is program_changed',
    );
    const [hb] = await tx
      .select({ publicId: schema.workouts.publicId })
      .from(schema.workouts)
      .innerJoin(schema.prescriptions, eq(schema.prescriptions.workoutId, schema.workouts.id))
      .where(eq(schema.prescriptions.id, f.p.inHiddenBlock.id));
    expectRefused(
      await f.tick({
        workoutPublicId: hb.publicId,
        prescriptionPublicId: f.p.inHiddenBlock.publicId,
      }),
      ROW_REFUSAL.program_changed,
      'FAM-1 11b 6b: a workout in a hidden block is program_changed',
    );
  });

  // ── 6c · not_found (P5 112, P7 114) ──────────────────────────────────────────────────────────────
  await proof('6c: not_found', async (f) => {
    const notFound = async (title: string, run: Promise<Settled>) =>
      expectRefused(await run, ROW_REFUSAL.not_found, `FAM-1 11b 6c: ${title} is not_found`);
    await notFound(
      'F’s profile under H’s scope',
      f.tick({ profilePublicId: f.foreigner.publicId, prescriptionPublicId: f.p.check.publicId }),
    );
    await notFound(
      'F’s fully valid workout',
      f.tick({ workoutPublicId: f.fw.publicId, prescriptionPublicId: f.fp.publicId }),
    );
    await notFound(
      'F’s hidden workout',
      f.tick({ workoutPublicId: f.fwHidden.publicId, prescriptionPublicId: f.fpHidden.publicId }),
    );
    await notFound(
      'a mismatched workout and prescription',
      f.tick({ workoutPublicId: f.w1.publicId, prescriptionPublicId: f.p.w2.publicId }),
    );
    await notFound(
      'a prescription naming another household’s movement',
      f.tick({ prescriptionPublicId: f.p.foreignMove.publicId }),
    );
  });

  // ── 6d · not on the program that day → program_changed (P20 182, 183) ──────────────────────────
  await proof('6d: an athlete not on the program that day', async (f) => {
    for (const [who, why] of [
      [f.unassigned, 'an athlete on no program'],
      [f.takenOff, 'an athlete taken off yesterday'],
      [f.elsewhere, 'an athlete on another program'],
    ] as const) {
      expectRefused(
        await f.tick({ profilePublicId: who.publicId, prescriptionPublicId: f.p.check.publicId }),
        ROW_REFUSAL.program_changed,
        `FAM-1 11b 6d: ${why} is program_changed`,
      );
      assert.equal(await f.countEntries(who.id), 0, `FAM-1 11b 6d: nothing was written for ${why}`);
    }
  });

  // ── (f) · F's profile under F's scope, naming H's workout → not_found, nothing written ───────────
  await proof('(f): another household’s profile naming this household’s workout', async (f, tx) => {
    expectRefused(
      await f.tickIn(
        f.F_SCOPE,
        { profilePublicId: f.foreigner.publicId, prescriptionPublicId: f.p.check.publicId },
        DAY,
      ),
      ROW_REFUSAL.not_found,
      'FAM-1 11b (f): F’s live profile under F’s scope, with H’s workout, is not_found',
    );
    const [supersets] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.supersets)
      .innerJoin(schema.sessions, eq(schema.sessions.id, schema.supersets.sessionId))
      .where(eq(schema.sessions.profileId, f.foreigner.id));
    assert.deepEqual(
      [await f.countSessions(f.foreigner.id), supersets.n, await f.countEntries(f.foreigner.id)],
      [0, 0, 0],
      'FAM-1 11b (f): no session, superset or entry was written for F',
    );
  });

  // ── (f′) · a planted F session naming H's workout; H's tick writes into H's own (P11, 118) ───────
  await proof('(f′): a planted foreign session', async (f, tx) => {
    const [planted] = await tx
      .insert(schema.sessions)
      .values({
        publicId: newId(),
        clientId: newId(),
        profileId: f.foreigner.id,
        activityDate: DAY,
        sessionType: SESSION_TYPE.workout,
        workoutId: f.w1.id,
        workoutName: 'Push day',
      })
      .returning({ id: schema.sessions.id });
    const r = expectOk(
      await f.tick({ prescriptionPublicId: f.p.check.publicId }),
      'FAM-1 11b (f′): H’s tick beside a planted F session is ok',
    );
    const [{ profileId }] = await tx
      .select({ profileId: schema.sessions.profileId })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, (await f.entryRow(r.entryPublicId)).sessionId!));
    assert.equal(profileId, f.athlete.id, 'FAM-1 11b (f′): the row is in H’s own session');
    // The planted row is pre-flight (f)'s defect by construction: remove it before the sweep.
    await tx.delete(schema.sessions).where(eq(schema.sessions.id, planted.id));
  });

  // ── 7 · set numbers (P9, 116) ────────────────────────────────────────────────────────────────────
  await proof('7: set numbers', async (f) => {
    expectOk(
      await f.tick({ prescriptionPublicId: f.p.weightReps.publicId, set: 5 }),
      'FAM-1 11b 7: set 5 on a 3-set Weight × Reps is ok',
    );
    expectRefused(
      await f.tick({ prescriptionPublicId: f.p.check.publicId, set: 2 }),
      ROW_REFUSAL.bad_value,
      'FAM-1 11b 7: set 2 on a Check is bad_value',
    );
  });

  // ── 8 · a superset pair → one supersets row with its group, both entries attached (P22, 128) ─────
  await proof('8: supersets', async (f, tx) => {
    const a = expectOk(
      await f.tick({ prescriptionPublicId: f.p.supA.publicId }),
      'FAM-1 11b 8: the first superset member is ok',
    );
    const b = expectOk(
      await f.tick({ prescriptionPublicId: f.p.supB.publicId }),
      'FAM-1 11b 8: the second superset member is ok',
    );
    const [ea, eb] = [await f.entryRow(a.entryPublicId), await f.entryRow(b.entryPublicId)];
    const groups = await tx
      .select({ id: schema.supersets.id, group: schema.supersets.prescriptionGroup })
      .from(schema.supersets)
      .where(eq(schema.supersets.sessionId, ea.sessionId!));
    assert.deepEqual(
      groups,
      [{ id: ea.supersetId, group: 'a' }],
      'FAM-1 11b 8: one supersets row, with the prescription’s group',
    );
    assert.deepEqual(
      [eb.supersetId, ea.supersetOrder, eb.supersetOrder],
      [ea.supersetId, 1, 2],
      'FAM-1 11b 8: both entries are attached, in the prescription’s order',
    );
  });

  // ── 8a · a refusal after the superset insert rolls it back (RowRefused, 178) ───────────────────────
  await proof('8a: a refusal after an insert leaves nothing behind', async (f, tx) => {
    const r = expectOk(
      await f.tick({ prescriptionPublicId: f.p.check.publicId }),
      'FAM-1 11b 8a: a tick makes the W1 session',
    );
    const sessionId = (await f.entryRow(r.entryPublicId)).sessionId!;
    // A live linked row on the superset member's set 1 with no superset (as if the item was grouped
    // after it was ticked). The next ✓ inserts a fresh superset, then meets the row arbiter.
    await tx.insert(schema.entries).values({
      publicId: newId(),
      clientId: newId(),
      profileId: f.athlete.id,
      activityDate: DAY,
      unit: 'count',
      movementName: 'verify-11b-reps',
      movementId: f.moves.reps,
      activityTypeId: f.activityTypeId,
      sessionId,
      prescriptionId: f.p.supA.id,
      prescriptionSet: 1,
    });
    expectRefused(
      await f.tick({ prescriptionPublicId: f.p.supA.publicId }),
      ROW_REFUSAL.slot_taken,
      'FAM-1 11b 8a: the member’s set is slot_taken',
    );
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.supersets)
      .where(eq(schema.supersets.sessionId, sessionId));
    assert.equal(n, 0, 'FAM-1 11b 8a: the refused tick left no superset row');
  });

  // ── 9 · prescribed_snapshot is prescribedText of the prescription; '' for a Check (P23, 129) ─────
  await proof('9: the frozen prescription', async (f) => {
    const wr = expectOk(
      await f.tick({ prescriptionPublicId: f.p.weightReps.publicId }),
      'FAM-1 11b 9: the Weight × Reps tick',
    );
    const expected = prescribedText({
      trackingType: TRACKING_TYPE.weight_reps,
      sets: 3,
      targetReps: '8',
      quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'lb', value: 25 }],
    });
    assert.notEqual(expected, '', 'FAM-1 11b 9: the expected text is not empty (non-vacuity)');
    assert.equal(
      (await f.entryRow(wr.entryPublicId)).snapshot,
      expected,
      'FAM-1 11b 9: prescribed_snapshot is prescribedText of the prescription',
    );
    const check = expectOk(
      await f.tick({ prescriptionPublicId: f.p.check.publicId }),
      'FAM-1 11b 9: the Check tick',
    );
    assert.equal(
      (await f.entryRow(check.entryPublicId)).snapshot,
      '',
      "FAM-1 11b 9: a Check's prescribed_snapshot is ''",
    );
    // A range freezes the target's text (`prescribedTarget`: no number), as the day page shows it,
    // never its low end.
    const range = expectOk(
      await f.tick({
        prescriptionPublicId: f.p.range.publicId,
        values: { quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'lb', value: 25 }] },
      }),
      'FAM-1 11b 9: the range tick',
    );
    const rangeText = prescribedText({
      trackingType: TRACKING_TYPE.weight_reps,
      sets: 3,
      targetReps: '5',
      quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'lb', value: null }],
    });
    assert.deepEqual(
      [(await f.entryRow(range.entryPublicId)).snapshot, rangeText.includes('20')],
      [rangeText, false],
      "FAM-1 11b 9: a range's prescribed_snapshot is the target's text, not its low end",
    );
  });

  // ── 10 · un-tick and re-tick (P26 172, P15 122) ──────────────────────────────────────────────────
  await proof('10: un-tick and re-tick', async (f, tx) => {
    const first = expectOk(
      await f.tick({ prescriptionPublicId: f.p.weightReps.publicId }),
      'FAM-1 11b 10: the tick',
    );
    const stored = {
      reps: 8,
      quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'lb', value: 25 }],
    };
    // A HIDDEN set row under the entry, carrying a LIVE 99 lb quantity. A read that keeps the hidden
    // set sees two live sets and throws (that is what reddens 172); the 99 lb would surface only if
    // that throw were removed as well.
    const [hiddenSet] = await tx
      .insert(schema.entrySets)
      .values({
        publicId: newId(),
        clientId: newId(),
        entryId: (await f.entryRow(first.entryPublicId)).id,
        idx: 1,
        reps: 99,
        deletedAt: new Date(),
      })
      .returning({ id: schema.entrySets.id });
    await tx.insert(schema.entrySetQuantities).values({
      clientId: newId(),
      entrySetId: hiddenSet.id,
      slot: QUANTITY_SLOT.primary,
      dimension: UNIT_DIMENSION_BY_CODE.lb,
      unit: 'lb',
      valueNum: '99',
    });
    const hidden = expectOk(await f.untick(first.entryPublicId), 'FAM-1 11b 10: un-tick is ok');
    assert.ok(hidden.hiddenAt, 'FAM-1 11b 10: un-tick answers a token');
    // ⚠️ This cannot tell two tokens apart: every hide in one transaction shares one `now()`, and
    // the whole proof is one transaction. It proves the replay answers `ok` with A token; 10e proves
    // a different token is refused.
    assert.deepEqual(
      await f.untick(first.entryPublicId),
      hidden,
      'FAM-1 11b 10: un-tick again answers the same token',
    );
    assert.deepEqual(
      await f.retick(first.entryPublicId, hidden.hiddenAt!),
      { ok: true, entryPublicId: first.entryPublicId, values: stored },
      'FAM-1 11b 10: re-tick answers ok with the row’s values',
    );
    const again = expectOk(await f.untick(first.entryPublicId), 'FAM-1 11b 10: un-tick it again');
    expectOk(
      await f.tick({ prescriptionPublicId: f.p.weightReps.publicId }),
      'FAM-1 11b 10: a new ✓ on the same set',
    );
    expectRefused(
      await f.retick(first.entryPublicId, again.hiddenAt!),
      ROW_REFUSAL.slot_taken,
      'FAM-1 11b 10: a re-tick after a new ✓ took the set is slot_taken',
    );
    assert.ok(
      (await f.entryRow(first.entryPublicId)).deletedAt !== null,
      'FAM-1 11b 10: the refused re-tick left the row hidden',
    );
  });

  // ── 10d · another household's program row is never un-ticked or re-ticked from here ─────────────
  // No patch of its own: `programRowOf`'s profile conjunct is the first guard (mutation 173 drops it,
  // and 3c fails first), and behind it `hideEntries` / `restoreHidden` re-resolve the profile inside
  // the scope (`isLiveProfile` joined to the entry), so dropping it alone leaves this green.
  await proof('10d: another household’s row', async (f, tx) => {
    const theirs = expectOk(
      await f.tickIn(
        f.F_SCOPE,
        {
          profilePublicId: f.foreigner.publicId,
          workoutPublicId: f.fw.publicId,
          prescriptionPublicId: f.fp.publicId,
        },
        DAY,
      ),
      'FAM-1 11b 10d: F’s tick',
    );
    const deletedAt = async () =>
      (
        await tx
          .select({ t: sql<string | null>`${schema.entries.deletedAt}::text` })
          .from(schema.entries)
          .where(eq(schema.entries.publicId, theirs.entryPublicId))
      )[0].t;
    expectRefused(
      await f.untick(theirs.entryPublicId),
      ROW_REFUSAL.not_found,
      'FAM-1 11b 10d: un-tick of F’s row from H is not_found',
    );
    assert.equal(await deletedAt(), null, 'FAM-1 11b 10d: F’s row is still live');
    const hidden = await hideEntries(f.exec, {
      profilePublicId: f.foreigner.publicId,
      scope: f.F_SCOPE,
      day: DAY,
      entryPublicIds: [theirs.entryPublicId],
    });
    assert.ok('hiddenAt' in hidden, 'FAM-1 11b 10d: F hides its row');
    const before = await deletedAt();
    expectRefused(
      await f.retick(theirs.entryPublicId, hidden.hiddenAt),
      ROW_REFUSAL.not_found,
      'FAM-1 11b 10d: re-tick of F’s row from H is not_found',
    );
    assert.equal(await deletedAt(), before, 'FAM-1 11b 10d: F’s deleted_at is unchanged');
  });

  // ── 10e · a re-tick with a stale token → not_found, the row still hidden (180) ──────────────────
  await proof('10e: a stale re-tick token', async (f, tx) => {
    const r = expectOk(
      await f.tick({ prescriptionPublicId: f.p.check.publicId }),
      'FAM-1 11b 10e: the tick',
    );
    const hidden = expectOk(await f.untick(r.entryPublicId), 'FAM-1 11b 10e: un-tick');
    // Another hide event since (a Clear day in another tab): the row's token is no longer this one.
    await tx
      .update(schema.entries)
      .set({ deletedAt: sql`${schema.entries.deletedAt} + interval '1 second'` })
      .where(eq(schema.entries.publicId, r.entryPublicId));
    expectRefused(
      await f.retick(r.entryPublicId, hidden.hiddenAt!),
      ROW_REFUSAL.not_found,
      'FAM-1 11b 10e: a re-tick with a stale token is not_found',
    );
    assert.ok(
      (await f.entryRow(r.entryPublicId)).deletedAt !== null,
      'FAM-1 11b 10e: the row is still hidden',
    );
  });

  // ── 10a · re-tick of a hidden weigh-in → not_found (P14, 121) ────────────────────────────────────
  await proof('10a: re-tick reaches program rows only', async (f) => {
    const w = await f.weighIn(true);
    expectRefused(
      await f.retick(w.publicId, w.hiddenAt!),
      ROW_REFUSAL.not_found,
      'FAM-1 11b 10a: re-tick of a hidden weigh-in is not_found',
    );
    assert.ok(
      (await f.entryRow(w.publicId)).deletedAt !== null,
      'FAM-1 11b 10a: the weigh-in is still hidden',
    );
  });

  // ── 10b · un-tick of a live weigh-in → not_found (P24, 170) ──────────────────────────────────────
  await proof('10b: un-tick reaches program rows only', async (f) => {
    const w = await f.weighIn(false);
    expectRefused(
      await f.untick(w.publicId),
      ROW_REFUSAL.not_found,
      'FAM-1 11b 10b: un-tick of a live weigh-in is not_found',
    );
    assert.equal(
      (await f.entryRow(w.publicId)).deletedAt,
      null,
      'FAM-1 11b 10b: the weigh-in is still live',
    );
  });

  // ── 10c · un-tick after the workout leaves the weekday → not_scheduled (P25, 171) ────────────────
  await proof('10c: un-tick off the week', async (f, tx) => {
    const r = expectOk(
      await f.tick({ workoutPublicId: f.w2.publicId, prescriptionPublicId: f.p.w2.publicId }),
      'FAM-1 11b 10c: the W2 tick',
    );
    await tx
      .update(schema.blockDayWorkouts)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(schema.blockDayWorkouts.workoutId, f.w2.id),
          eq(schema.blockDayWorkouts.weekday, MONDAY),
        ),
      );
    expectRefused(
      await f.untick(r.entryPublicId),
      ROW_REFUSAL.not_scheduled,
      'FAM-1 11b 10c: un-tick after the workout left the weekday is not_scheduled',
    );
  });
}
