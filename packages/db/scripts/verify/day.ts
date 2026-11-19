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
  METRIC_KEYS,
  PRACTICE_UNIT,
  SEED_METRIC_KEYS,
  SESSION_TYPE,
  TRACKING_TYPE,
  type TrackingType,
  type QuantitySlot,
  type Unit,
  UNIT_DIMENSION_BY_CODE,
} from '@mat-plan/shared';
import { buildStrengthLog, STRENGTH_LOG_HEADER } from '@mat-plan/shared/csv';
import { prescribedText } from '@mat-plan/shared/program/prescribed-text';
import { and, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';

import { schema } from '../../src/client';
import {
  bodyweightMonthRows,
  checkinMonthRows,
  foldStrengthMonth,
  strengthMonthRows,
} from '../../src/queries/export-month';
import { resolvePrescribed } from '../../src/queries/export-prescribed';
import { readRowValues } from '../../src/queries/day/stored-row-values';
import { amendRow } from '../../src/writers/day/amend-row';
import { logRow, retickRow, rowWorkout, untickRow } from '../../src/writers/day/log-row';
import { clearDay, hideEntries } from '../../src/writers/hide';
import { householdScopeForScript } from '../../src/writers/household-scope-script';
import { insertWorkoutOwnedBy } from '../../src/writers/ownership';
import { verifyDayPlan } from './day-plan';
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
 * - **step 12a-i**: the day resolver and PREVIOUS, in `./day-plan.ts` (`verifyDayPlan`, called at
 *   the end of `verifyDay`): it seeds the state each `DayPlan` fixture with no `before` describes,
 *   with hand-written timestamps (eleven, plus the two whose only change is an archive), and
 *   deep-equals it with ids mapped exactly; 12a-ii adds the other four of the six with a `before`;
 * - **step 11c-i (`verifyAmend`, after 11b's)**: Change, `amendRow`, as
 *   `docs/plans/fam-1-11c-change-and-revive.md` → § Test plan lists it, with mutations 348–356 and 358–363. A
 *   non-number is the contract's schema test (`rowAmendSchema`), since the action parses (plan S4);
 * - **step 11c-ii (`verifyRevive`, after 11b's)**: the D35 revive, R1–R9, with mutations 341–347
 *   and 357; it rewrites 11b's 3b, 10 (10f carries mutation 122 now) and the row race;
 * - step 14: template rows of each type in the export.
 *
 * What a module can rely on when it runs, and the helpers to import, are in `./harness` →
 * `VerifyContext`. Step 12a compares fixtures with ids mapped exactly, never through
 * `./normalize-fixture` (its plan's C1; `./day-plan.ts`).
 *
 * ## How the 11b proofs are built
 *
 * Every proof runs in its OWN rolled-back transaction on a fresh fixture (`fixture` below): two
 * households of this module's own, H and F (the plan's "B"), so nothing `verify.ts` left in household
 * A or B can satisfy or break an assertion. After every proof the runbook's pre-flight (f) and (g)
 * detectors and the mismatched-pair detector must read nothing.
 *
 * ⚠️ **Order matters, because `db:verify` is fail-fast and each patch's `.expect` names the FIRST
 * assertion that fails.** Since 11c-ii, mutation 125 no longer reddens 3b (a replay of a replaced
 * clientId answers `slot_taken` either way) and its proof is 3, the Clear-day replay. A writer that throws is caught (`settle`) and asserted on, so a patch that makes it throw
 * still fails on a named assertion.
 */
export async function verifyDay(_ctx: VerifyContext): Promise<void> {
  await verifyRowWriter();
  // 11c-ii's revive, after 11b's proofs, so an 11b patch still fails on its own assertion first.
  await verifyRevive();
  // 11c-i's proofs run after 11b's: the steps they share live in `row-steps.ts`, so an 11b patch
  // there must still fail on its own 11b assertion first (plan 11c, § Test plan, Order).
  await verifyAmend();
  // 14a's export proof runs before 12a's: mutation 366 changes the item key the resolver shares, and
  // must fail on the export's own assertion first.
  await verifyExport();
  await verifyRowRace();
  // 12a-i's proofs run after 11b's, so an 11b patch still fails on its own assertion first.
  await verifyDayPlan();
}

// ── FAM-1 11b — the row writer ──────────────────────────────────────────────────────────────────────

/** The proof day, a Monday, and the athlete's today. */
const DAY = '2026-11-16';
/** W1's name when its rows are logged; 14a's proof renames it after, and the file keeps this one. */
const W1_NAME = 'Push day';
const YESTERDAY = addDays(DAY, -1);
const MONDAY = 1;
const SUNDAY = 0;
const TUESDAY = 2;

// ── Shared by lane E's proof modules (`./day-plan.ts` imports these) ───────────────────────────────

/** A writer's answer, or what it threw, so a patch that makes it throw fails on a named assertion. */
export type Settled = RowResult | { threw: string };
export async function settle(run: Promise<RowResult>): Promise<Settled> {
  try {
    return await run;
  } catch (error) {
    return { threw: error instanceof Error ? error.message : String(error) };
  }
}

export function expectOk(r: Settled, title: string): Extract<RowResult, { ok: true }> {
  assert.ok('ok' in r && r.ok, `${title} — got ${JSON.stringify(r)}`);
  return r as Extract<RowResult, { ok: true }>;
}

function expectRefused(r: Settled, reason: RowRefusal, title: string): void {
  assert.deepEqual(r, { ok: false, reason }, `${title} — got ${JSON.stringify(r)}`);
}

/** A seeded activity type's id, by its key (`workout_item` for a program row, `weigh_in`). */
export async function activityTypeIdOf(tx: VerifyTx, key: string): Promise<number> {
  const [row] = await tx
    .select({ id: schema.activityTypes.id })
    .from(schema.activityTypes)
    .where(eq(schema.activityTypes.key, key));
  assert.ok(row, `FAM-1 lane E: the ${key} activity type is seeded`);
  return row.id;
}

/** Thrown by {@link inSavepoint} to undo its body. Private. */
class Undo extends Error {}

/**
 * Run `fn` in a savepoint that is always rolled back, inside a `rolledBack` transaction, so several
 * proofs share one seeded state and stay apart.
 */
export async function inSavepoint(
  tx: VerifyTx,
  fn: (sp: VerifyTx) => Promise<void>,
): Promise<void> {
  try {
    await tx.transaction(async (sp) => {
      await fn(sp);
      throw new Undo();
    });
  } catch (e) {
    if (!(e instanceof Undo)) throw e;
  }
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

/**
 * The row writer's fixture, for ANOTHER lane's proofs that need a real program row: lane S's B2-0
 * (`verify/single-values.ts`) ticks, un-ticks and re-ticks through `logRow` / `untickRow` / `retickRow`
 * with it. Build it inside the caller's own `rolledBack` transaction. It is lane E's; the shape may
 * grow, but the existing members keep their meaning. Lane E's own proofs keep using `fixture`.
 */
export type ProgramRowFixture = Fixture;
export const programRowFixture = (tx: VerifyTx): Promise<ProgramRowFixture> => fixture(tx);
/**
 * The day the fixture's rows are built for (a Monday), so a caller ticks on the same day instead of
 * re-typing the date. Its yesterday is `addDays(PROGRAM_ROW_FIXTURE_DAY, -1)`.
 */
export const PROGRAM_ROW_FIXTURE_DAY = DAY;

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
  const startsToday = await profile(h.id, 'Verify 11b Starts Today');

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
  const w1 = await mkWorkout(H_SCOPE, block, W1_NAME);
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
  // YESTERDAY and DAY are both on it. 6d's first three athletes are not on H's block on DAY; startsToday is on it from DAY, so not on YESTERDAY.
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
  await assign(startsToday.id, block, DAY, null); // put on today: not on it yesterday

  const activity = { id: await activityTypeIdOf(tx, ACTIVITY_TYPE_KEYS.workout_item) };

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
  /** Change in H's scope, with sensible defaults: the athlete, today being the proof day. */
  const amend = (
    entryPublicId: string,
    values: RowValues,
    over: { profilePublicId?: string; today?: string } = {},
  ) =>
    settle(
      amendRow(asDb(tx), {
        scope: H_SCOPE,
        today: over.today ?? DAY,
        input: { profilePublicId: over.profilePublicId ?? athlete.publicId, entryPublicId, values },
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
          prescriptionId: schema.entries.prescriptionId,
        })
        .from(schema.entries)
        .where(eq(schema.entries.publicId, publicId))
    )[0];
  /**
   * A HIDDEN set row under an entry, carrying a LIVE 99 lb quantity in the primary slot: a read or a
   * write that keeps the hidden set sees two live sets (proof 10, mutation 172), or writes its
   * quantity (Change 8, mutation 356).
   */
  const plantHiddenSet = async (entryPublicId: string) => {
    const [hiddenSet] = await tx
      .insert(schema.entrySets)
      .values({
        publicId: newId(),
        clientId: newId(),
        entryId: (await entryRow(entryPublicId)).id,
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
    return hiddenSet;
  };
  const weighIn = async (hidden: boolean) => {
    const type = { id: await activityTypeIdOf(tx, SEED_ACTIVITY_TYPE_KEYS.weighIn) };
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
    startsToday,
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
    amend,
    countEntries,
    countSessions,
    entryRow,
    plantHiddenSet,
    weighIn,
  };
}

// ── FAM-1 14a — the export carries the program ──────────────────────────────────────────────────

/**
 * FAM-1 14a (plan `fam-1-14-export.md`): rows `logRow` wrote, read by the export's own query, folded by
 * its own fold and built into the file's bytes. One proof, so each of mutations 364–366 fails on it.
 */
async function verifyExport(): Promise<void> {
  await proof(
    '14a: the strength log carries the program',
    async (f, tx) => {
      const tick = async (p: { publicId: string }, set = 1, values?: RowValues) =>
        expectOk(
          await f.tick({ prescriptionPublicId: p.publicId, set, ...(values ? { values } : {}) }),
          `FAM-1 14a: the ✓ on set ${set}`,
        );
      // Every tracking type. The weighted item's set 2 is ticked BEFORE set 1, so the file's set
      // order and its `prescribed` come from the set number, not from when it was ticked.
      await tick(f.p.check);
      await tick(f.p.count);
      await tick(f.p.reps, 1);
      await tick(f.p.reps, 2);
      await tick(f.p.weightReps, 2, {
        reps: 8,
        quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'lb', value: 30 }],
      });
      const bench1 = await tick(f.p.weightReps, 1);
      await tick(f.p.duration);
      await tick(f.p.timeSets);
      await tick(f.p.distance);
      // Two sets of one item, moved into the SIBLING's session, one of them dated the day before:
      // the export keeps the athlete's rows but takes nothing from that session, and the date in the
      // fold key keeps the two apart (the (i) plant, undone before the sweep).
      const sib = await (async () =>
        expectOk(
          await f.tick({
            prescriptionPublicId: f.p.check.publicId,
            profilePublicId: f.sibling.publicId,
          }),
          'FAM-1 14a: the sibling’s session',
        ))();
      const sibSession = (await f.entryRow(sib.entryPublicId)).sessionId!;
      // `repsText`'s target is a range, so its reps are typed.
      const typed = { reps: 9, quantities: [] };
      const moved = [await tick(f.p.repsText, 1, typed), await tick(f.p.repsText, 2, typed)];
      const ownSession = (await f.entryRow(moved[0].entryPublicId)).sessionId!;
      await tx
        .update(schema.entries)
        .set({ sessionId: sibSession })
        .where(eq(schema.entries.publicId, moved[0].entryPublicId));
      await tx
        .update(schema.entries)
        .set({ sessionId: sibSession, activityDate: YESTERDAY })
        .where(eq(schema.entries.publicId, moved[1].entryPublicId));
      // A hidden set with a live 99 lb quantity under a logged row: it never reaches the file.
      await f.plantHiddenSet(bench1.entryPublicId);
      // The workout is renamed after the ✓s: the file keeps the name each row was logged under.
      await tx
        .update(schema.workouts)
        .set({ name: 'Renamed day' })
        .where(eq(schema.workouts.id, f.w1.id));
      // Two prescriptions of DIFFERENT movements purged: their rows are left as an ADR 0008 purge's
      // `ON DELETE SET NULL` leaves them, the set kept and the id cleared. Each stays its own row,
      // under its own movement.
      await tx
        .update(schema.entries)
        .set({ prescriptionId: null })
        .where(inArray(schema.entries.prescriptionId, [f.p.duration.id, f.p.distance.id]));

      const rows = await strengthMonthRows(asDb(tx), {
        profilePublicId: f.athlete.publicId,
        month: DAY.slice(0, 7),
        scope: f.H_SCOPE,
      });
      const file = buildStrengthLog(
        // `prescribed` through the DAL's own resolution. Every program row carries its snapshot, so the
        // live fallback is never reached here, and this cannot tell `??` from `||` (the resolver's
        // unit test pins that); it keeps the proof on the same function the DAL calls.
        foldStrengthMonth(rows).map((r) => ({ ...r, prescribed: resolvePrescribed(r, null) })),
      );
      assert.equal(
        file,
        [
          STRENGTH_LOG_HEADER.join(','),
          // The day before: the moved set 2, kept apart from set 1 by the date in the key, and with
          // nothing from the sibling's session.
          `${YESTERDAY},,verify-11b-reps,1,9,,3 × 8-12,,`,
          `${DAY},workout,verify-11b-check,1,,,,,${W1_NAME}`,
          // A Count in `count`: its number in `reps`, `load` empty.
          `${DAY},workout,verify-11b-count,1,20,,20,,${W1_NAME}`,
          `${DAY},workout,verify-11b-reps,2,10,,3 × 10,,${W1_NAME}`,
          // Sets in set order (set 2 was ticked first), and no hidden 99 lb set.
          `${DAY},workout,verify-11b-weight-reps,2,8,25/30,3 × 8 @ 25 lb,,${W1_NAME}`,
          // Purged: each its own row, under its own movement.
          `${DAY},workout,verify-11b-duration,1,,5min,5 min,,${W1_NAME}`,
          `${DAY},workout,verify-11b-time-sets,1,,30s,3 × 30 s,,${W1_NAME}`,
          `${DAY},workout,verify-11b-distance,1,,(40yd),6 × 40 yd,,${W1_NAME}`,
          `${DAY},,verify-11b-reps,1,9,,3 × 8-12,,`,
          '',
        ].join('\n'),
        'FAM-1 14a: the strength log carries the program, one row per item, with its frozen name',
      );

      // The (i) plant goes before the sweep.
      for (const m of moved) {
        await tx
          .update(schema.entries)
          .set({ sessionId: ownSession, activityDate: DAY })
          .where(eq(schema.entries.publicId, m.entryPublicId));
      }
    },
    '14a',
  );

  await proof(
    '14b: every live entry of a month lands in exactly one file',
    async (f, tx) => {
      const typeId = (key: string) => activityTypeIdOf(tx, key);
      const checkin = async (o: {
        activity: string;
        metric?: string | null;
        unit: string;
        value: string;
        day?: string;
        kind?: string | null;
      }) => {
        const [row] = await tx
          .insert(schema.entries)
          .values({
            publicId: newId(),
            clientId: newId(),
            profileId: f.athlete.id,
            activityDate: o.day ?? DAY,
            kind: o.kind ?? null,
            unit: o.unit,
            valueNum: o.value,
            activityTypeId: await typeId(o.activity),
            metricKey: o.metric ?? null,
            status: ENTRY_STATUS.done,
          })
          .returning({ id: schema.entries.id, publicId: schema.entries.publicId });
        return row;
      };
      // A weigh-in; a practice; a calisthenics day with two metrics; an old check-in metric; a bare
      // habit (no metric); a program row.
      const weighIn = await f.weighIn(false);
      await checkin({
        activity: ACTIVITY_TYPE_KEYS.wrestling_practice,
        metric: METRIC_KEYS.practice_minutes,
        unit: PRACTICE_UNIT,
        value: '90',
      });
      await checkin({
        activity: ACTIVITY_TYPE_KEYS.calisthenics,
        metric: METRIC_KEYS.pushups,
        unit: 'count',
        value: '25',
      });
      await checkin({
        activity: ACTIVITY_TYPE_KEYS.calisthenics,
        metric: METRIC_KEYS.pullups,
        unit: 'count',
        value: '6',
      });
      await checkin({
        activity: ACTIVITY_TYPE_KEYS.brush_teeth,
        metric: METRIC_KEYS.stance,
        unit: 'min',
        value: '3',
      });
      await checkin({ activity: ACTIVITY_TYPE_KEYS.rice_bucket, unit: 'bool', value: '1' });
      expectOk(
        await f.tick({ prescriptionPublicId: f.p.check.publicId }),
        'FAM-1 14b: a program row',
      );
      // Planted: a hidden check-in, and a bodyweight METRIC under another activity (in lb, on another
      // day than the weigh-in, so the bodyweight file and its one-per-day index accept it).
      const hidden = await checkin({
        activity: ACTIVITY_TYPE_KEYS.rice_bucket,
        unit: 'bool',
        value: '1',
        day: YESTERDAY,
      });
      await tx
        .update(schema.entries)
        .set({ deletedAt: new Date() })
        .where(eq(schema.entries.id, hidden.id));
      const planted = await checkin({
        activity: ACTIVITY_TYPE_KEYS.calisthenics,
        metric: SEED_METRIC_KEYS.bodyweight,
        unit: 'lb',
        value: '81',
        day: YESTERDAY,
        kind: ENTRY_KIND.bodyweight,
      });
      // Planted: a weigh-in naming a movement and no metric, which the schema's at-most-one check
      // allows. The strength log's join takes it, so the bodyweight file must not.
      await tx.insert(schema.entries).values({
        publicId: newId(),
        clientId: newId(),
        profileId: f.athlete.id,
        activityDate: YESTERDAY,
        unit: 'lb',
        valueNum: '81',
        activityTypeId: await typeId(SEED_ACTIVITY_TYPE_KEYS.weighIn),
        movementId: f.moves.reps,
        status: ENTRY_STATUS.done,
      });

      // Planted at both edges of the month, so a dropped month bound copies one into the file.
      const month = DAY.slice(0, 7);
      assert.equal(month, '2026-11', 'FAM-1 14b: the edge plants assume DAY is in November 2026');
      const edges = [
        await checkin({
          activity: ACTIVITY_TYPE_KEYS.rice_bucket,
          unit: 'bool',
          value: '1',
          day: '2026-10-31',
        }),
        await checkin({
          activity: ACTIVITY_TYPE_KEYS.rice_bucket,
          unit: 'bool',
          value: '1',
          day: '2026-12-01',
        }),
      ];
      const args = { profilePublicId: f.athlete.publicId, month, scope: f.H_SCOPE };
      const strength = new Set((await strengthMonthRows(asDb(tx), args)).map((r) => r.entryId));
      const bodyweight = await bodyweightMonthRows(asDb(tx), args);
      const checkins = await checkinMonthRows(asDb(tx), args);
      const live = await tx
        .select({ id: schema.entries.id })
        .from(schema.entries)
        .where(
          and(
            eq(schema.entries.profileId, f.athlete.id),
            isNull(schema.entries.deletedAt),
            gte(schema.entries.activityDate, `${month}-01`),
            lt(schema.entries.activityDate, '2026-12-01'),
          ),
        );
      const files = (id: number) =>
        [
          strength.has(id),
          bodyweight.some((r) => r.entryId === id),
          checkins.some((r) => r.entryId === id),
        ].filter(Boolean).length;
      assert.deepEqual(
        live.filter((r) => files(r.id) !== 1).map((r) => r.id),
        [],
        'FAM-1 14b: every live entry of a month lands in exactly one file',
      );
      const weighInId = (await f.entryRow(weighIn.publicId)).id;
      assert.deepEqual(
        [
          bodyweight.map((r) => r.entryId).sort(),
          checkins.some((r) => r.metric === SEED_METRIC_KEYS.bodyweight),
          [strength, bodyweight, checkins].some((rows) =>
            [...(rows instanceof Set ? rows : rows.map((r) => r.entryId))].includes(hidden.id),
          ),
        ],
        [[weighInId, planted.id].sort(), false, false],
        'FAM-1 14b: both bodyweight rows are in its file, none in check-ins, and a hidden one in none',
      );
      assert.deepEqual(
        checkins.filter((r) => edges.some((e) => e.id === r.entryId)).map((r) => r.date),
        [],
        'FAM-1 14b: a check-in from the month before or after is not in this month’s file',
      );
    },
    '14b',
  );
}

// ── The ✓ that races an un-tick (lane S's #578 review, defaulted to fix) ─────────────────────────────

/**
 * A ✓ on a set another phone un-ticks in the same instant. The insert skips (the set is held), and the
 * holder is hidden before the re-reads, so they find no insert, no holder and no taken set. Staged on
 * one connection as #578 does: a statement-level `AFTER INSERT` trigger hides the one named holder
 * INSIDE the skipped insert. Before the retry `logRow` threw ("neither inserted nor held") to
 * `error.tsx`; now the same ✓ inserts on its second try. Mutation 372 removes the retry.
 */
async function verifyRowRace(): Promise<void> {
  await proof(
    'the ✓ that races an un-tick saves',
    async (f, tx) => {
      const holder = expectOk(
        await f.tick({ prescriptionPublicId: f.p.reps.publicId }),
        'FAM-1 11b race: the holder ✓',
      );
      await tx.execute(sql`create temp table race_target (public_id uuid not null)`);
      await tx.execute(sql`insert into race_target values (${holder.entryPublicId}::uuid)`);
      await tx.execute(sql`create function verify_row_race_hide() returns trigger language plpgsql as $$
        begin
          update entries set deleted_at = now()
            where public_id in (select public_id from race_target) and deleted_at is null;
          return null;
        end $$`);
      await tx.execute(
        sql`create trigger row_race_hide after insert on entries for each statement execute function verify_row_race_hide()`,
      );
      // Different numbers from the holder's, so "revived with the ✓'s numbers" can fail.
      const second = await f.tick({
        prescriptionPublicId: f.p.reps.publicId,
        values: { reps: 7, quantities: [] },
      });
      await tx.execute(sql`drop trigger row_race_hide on entries`);
      await tx.execute(sql`drop function verify_row_race_hide()`);
      const saved = expectOk(second, 'FAM-1 11b race: a ✓ on a set un-ticked mid-insert saves');
      // 11c-ii: the retry goes back through the revive, so the un-ticked entry is brought back
      // (plan 11c, § Proofs 11b's rewrite; it was a new entry under 11b).
      const live = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.entries)
        .where(
          and(
            eq(schema.entries.prescriptionId, f.p.reps.id),
            eq(schema.entries.prescriptionSet, 1),
            isNull(schema.entries.deletedAt),
          ),
        );
      assert.deepEqual(
        [
          saved.entryPublicId !== holder.entryPublicId,
          (await f.entryRow(holder.entryPublicId)).deletedAt !== null,
          live[0].n,
          saved.values.reps,
          holder.values.reps,
        ],
        [false, false, 1, 7, 10],
        'FAM-1 11b race: and it is the un-ticked entry, revived with the ✓’s numbers (11c-ii)',
      );
    },
    '11b',
  );
}

/**
 * Runbook pre-flight (i): the ids of entries in a session of ANOTHER profile. 12a's resolver drops
 * such a row (mutation 242), and 11c-i's Change refuses it; no writer may make one. One query for
 * the end-of-proof sweep here and `./day-plan.ts`'s (i) proof.
 */
export async function entriesInAnotherProfilesSession(tx: VerifyTx): Promise<number[]> {
  const rows = await tx
    .select({ id: schema.entries.id })
    .from(schema.entries)
    .innerJoin(schema.sessions, eq(schema.sessions.id, schema.entries.sessionId))
    .where(ne(schema.sessions.profileId, schema.entries.profileId));
  return rows.map((r) => r.id);
}

/** One proof: a fresh fixture, the body, then the detector sweep, all rolled back. */
async function proof(
  name: string,
  body: (f: Fixture, tx: VerifyTx) => Promise<void>,
  step = '11b',
) {
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
        i: await entriesInAnotherProfilesSession(tx),
      },
      { f: [], g: [], pair: [], sessionType: [], dayRole: [], i: [] },
      `FAM-1 ${step} ${name}: lane A's (f), (g), mismatched-pair and workout-session detectors, and (i), read nothing`,
    );
  });
  console.log(`✓ FAM-1 ${step} ${name}`);
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
    // 11c-ii: c2 REVIVED c1's entry and took its clientId, so c1 is a free id on a taken set (it was
    // `own_hidden` under 11b). Mutation 125's proof is now 3's.
    expectRefused(
      await f.tick({ clientId: c1, prescriptionPublicId: f.p.reps.publicId }),
      ROW_REFUSAL.slot_taken,
      'FAM-1 11b 3b: replaying c1 after c2 revived the entry is slot_taken',
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
      await rowWorkout(f.exec, f.athlete.id, f.H_SCOPE, { publicId: f.w1.publicId }),
      'FAM-1 11b 4d: the athlete’s own workout is found (non-vacuity)',
    );
    assert.equal(
      await rowWorkout(f.exec, f.foreigner.id, f.H_SCOPE, { publicId: f.w1.publicId }),
      null,
      'FAM-1 11b 4d: F’s profile under H’s scope never reaches H’s workout',
    );
    assert.equal(
      await rowWorkout(f.exec, f.foreigner.id, f.H_SCOPE, { publicId: f.fw.publicId }),
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
    // The check asks about the ROW's day, never today: an athlete whose last day was yesterday can
    // still log yesterday (the range is inclusive), and one put on today cannot log yesterday.
    expectOk(
      await f.tick({
        profilePublicId: f.takenOff.publicId,
        day: YESTERDAY,
        prescriptionPublicId: f.p.check.publicId,
      }),
      'FAM-1 11b 6d: an athlete taken off yesterday can still log yesterday',
    );
    expectRefused(
      await f.tick({
        profilePublicId: f.startsToday.publicId,
        day: YESTERDAY,
        prescriptionPublicId: f.p.check.publicId,
      }),
      ROW_REFUSAL.program_changed,
      'FAM-1 11b 6d: an athlete put on today cannot log yesterday',
    );
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
    const hiddenSet = await f.plantHiddenSet(first.entryPublicId);
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
    const newer: RowValues = {
      reps: 6,
      quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'lb', value: 35 }],
    };
    const revived = expectOk(
      await f.tick({ prescriptionPublicId: f.p.weightReps.publicId, values: newer }),
      'FAM-1 11b 10: a new ✓ on the same set',
    );
    // 11c-ii (R7): the new ✓ REVIVED the entry, so re-ticking it answers it as it is now. Under 11b
    // this was `slot_taken`; mutation 122 now reddens 10f below.
    assert.deepEqual(
      [revived.entryPublicId, revived.values, await f.retick(first.entryPublicId, again.hiddenAt!)],
      [first.entryPublicId, newer, revived],
      'FAM-1 11b 10: a re-tick of a revived entry answers ok with its current values',
    );
  });

  // ── 10f · a re-tick onto a set another live entry holds → slot_taken (P15, 122) ──────────────────
  // A state 11b could leave and the revive no longer makes: a live L and a hidden H on one set. The
  // re-tick of H hits the row arbiter inside restoreHidden's savepoint, answered by
  // `RESTORE_SLOT_INDEXES`; mutation 122 drops it there.
  await proof('10f: a re-tick onto a taken set', async (f, tx) => {
    const first = expectOk(
      await f.tick({ prescriptionPublicId: f.p.weightReps.publicId }),
      'FAM-1 11b 10f: the tick',
    );
    const hidden = expectOk(await f.untick(first.entryPublicId), 'FAM-1 11b 10f: un-tick');
    const [src] = await tx
      .select()
      .from(schema.entries)
      .where(eq(schema.entries.publicId, first.entryPublicId));
    const { id: _id, ...rest } = src;
    const [live] = await tx
      .insert(schema.entries)
      .values({ ...rest, publicId: newId(), clientId: newId(), deletedAt: null, hideReason: null })
      .returning({ id: schema.entries.id });
    const answer = await f.retick(first.entryPublicId, hidden.hiddenAt!);
    const stillHidden = (await f.entryRow(first.entryPublicId)).deletedAt !== null;
    await tx.delete(schema.entries).where(eq(schema.entries.id, live.id));
    assert.deepEqual(
      [answer, stillHidden],
      [{ ok: false, reason: ROW_REFUSAL.slot_taken }, true],
      'FAM-1 11b 10f: a re-tick onto a set another live entry holds is slot_taken',
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

// ── FAM-1 11c-ii — the revive (D35; plan 11c R1–R8, mutations 341–347 and 357) ──────────────────────

/**
 * A ✓ under a new `clientId` on a slot whose latest entry is the athlete's own hidden one brings that
 * entry back with this ✓'s numbers. Each proof is its own fixture; each plant is deleted before the
 * end-of-proof sweep.
 */
async function verifyRevive(): Promise<void> {
  /** This step's proofs, labelled `11c-ii` in the sweep. */
  const reviveProof = (name: string, body: (f: Fixture, tx: VerifyTx) => Promise<void>) =>
    proof(name, body, '11c-ii');
  const wr = (reps: number, value: number): RowValues => ({
    reps,
    quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'lb', value }],
  });

  /** The entries on (prescription, set 1): every one, and the live ones. */
  const onSlot = async (tx: VerifyTx, prescriptionId: number) => {
    const rows = await tx
      .select({
        publicId: schema.entries.publicId,
        clientId: schema.entries.clientId,
        deletedAt: schema.entries.deletedAt,
        hideReason: schema.entries.hideReason,
      })
      .from(schema.entries)
      .where(
        and(
          eq(schema.entries.prescriptionId, prescriptionId),
          eq(schema.entries.prescriptionSet, 1),
        ),
      );
    return { all: rows, live: rows.filter((r) => r.deletedAt === null) };
  };

  /** A copy of an entry, planted on its slot as `profileId`'s, hidden at `deletedAt` or live. */
  const plantOnSlot = async (
    tx: VerifyTx,
    from: string,
    over: { profileId: number; deletedAt: Date | null },
  ) => {
    const [src] = await tx.select().from(schema.entries).where(eq(schema.entries.publicId, from));
    const { id: _id, ...rest } = src;
    const [row] = await tx
      .insert(schema.entries)
      .values({
        ...rest,
        publicId: newId(),
        clientId: newId(),
        profileId: over.profileId,
        deletedAt: over.deletedAt,
        hideReason: null,
      })
      .returning({ id: schema.entries.id, publicId: schema.entries.publicId });
    return row;
  };
  const unplant = (tx: VerifyTx, ids: number[]) =>
    tx.delete(schema.entries).where(inArray(schema.entries.id, ids));

  // R3 (341): after an un-tick, the same entry comes back, with the new numbers and the new clientId.
  await reviveProof('R1: a ✓ after an un-tick revives the entry', async (f, tx) => {
    const c2 = newId();
    const first = expectOk(
      await f.tick({ prescriptionPublicId: f.p.weightReps.publicId, values: wr(8, 30) }),
      'FAM-1 11c-ii R1: the first ✓',
    );
    expectOk(await f.untick(first.entryPublicId), 'FAM-1 11c-ii R1: the un-tick');
    const again = expectOk(
      await f.tick({
        clientId: c2,
        prescriptionPublicId: f.p.weightReps.publicId,
        values: wr(6, 35),
      }),
      'FAM-1 11c-ii R1: the second ✓',
    );
    const slot = await onSlot(tx, f.p.weightReps.id);
    assert.deepEqual(
      [again.entryPublicId, again.values, slot.all.length, slot.live[0]?.clientId],
      [first.entryPublicId, wr(6, 35), 1, c2],
      'FAM-1 11c-ii R1: after an un-tick, one entry on the slot, revived with the new numbers',
    );
  });

  // R4 (UNHIDE): after Clear day, the revive clears `hide_reason` too, so it leaves the cleared count.
  await reviveProof(
    'R2: a ✓ after Clear day revives the entry and clears its reason',
    async (f, tx) => {
      const first = expectOk(
        await f.tick({ prescriptionPublicId: f.p.check.publicId }),
        'FAM-1 11c-ii R2: the ✓',
      );
      const cleared = await clearDay(f.exec, {
        profilePublicId: f.athlete.publicId,
        scope: f.H_SCOPE,
        day: DAY,
      });
      assert.ok('hiddenAt' in cleared, 'FAM-1 11c-ii R2: Clear day hid the row');
      const again = expectOk(
        await f.tick({ prescriptionPublicId: f.p.check.publicId }),
        'FAM-1 11c-ii R2: a ✓ after Clear day',
      );
      const slot = await onSlot(tx, f.p.check.id);
      assert.deepEqual(
        [again.entryPublicId, slot.all.length, slot.live.length, slot.live[0]?.hideReason],
        [first.entryPublicId, 1, 1, null],
        'FAM-1 11c-ii R2: after Clear day, the entry is revived and its hide_reason cleared',
      );
    },
  );

  // An empty ✓ revives with the prescription's numbers; five rounds leave one entry.
  await reviveProof('R3: an empty ✓, and five rounds', async (f, tx) => {
    const first = expectOk(
      await f.tick({ prescriptionPublicId: f.p.weightReps.publicId, values: wr(8, 30) }),
      'FAM-1 11c-ii R3: the first ✓',
    );
    expectOk(await f.untick(first.entryPublicId), 'FAM-1 11c-ii R3: the un-tick');
    const empty = expectOk(
      await f.tick({ prescriptionPublicId: f.p.weightReps.publicId }),
      'FAM-1 11c-ii R3: an empty ✓',
    );
    assert.deepEqual(
      [empty.entryPublicId, empty.values],
      [first.entryPublicId, wr(8, 25)],
      'FAM-1 11c-ii R3: an empty ✓ revives with the prescription’s numbers',
    );
    for (let round = 1; round <= 5; round += 1) {
      expectOk(await f.untick(first.entryPublicId), `FAM-1 11c-ii R3: un-tick ${round}`);
      expectOk(
        await f.tick({ prescriptionPublicId: f.p.weightReps.publicId, values: wr(round, 30) }),
        `FAM-1 11c-ii R3: ✓ ${round}`,
      );
    }
    const slot = await onSlot(tx, f.p.weightReps.id);
    assert.deepEqual(
      [
        slot.all.length,
        await f.tick({
          clientId: slot.live[0].clientId,
          prescriptionPublicId: f.p.weightReps.publicId,
        }),
      ],
      [1, { ok: true, entryPublicId: first.entryPublicId, values: wr(5, 30) }],
      'FAM-1 11c-ii R3: five rounds leave one entry, with the last numbers',
    );
  });

  // R3 (343): with several hidden entries on the slot, the most recently hidden is revived, even on
  // the LOWER id.
  await reviveProof('R4: several hidden entries', async (f, tx) => {
    const first = expectOk(
      await f.tick({ prescriptionPublicId: f.p.reps.publicId }),
      'FAM-1 11c-ii R4: the first ✓',
    );
    expectOk(await f.untick(first.entryPublicId), 'FAM-1 11c-ii R4: the un-tick');
    const older = await plantOnSlot(tx, first.entryPublicId, {
      profileId: f.athlete.id,
      deletedAt: new Date('2026-01-01T00:00:00Z'),
    });
    // The athlete's own entry, on the lower id, is hidden LATER than the planted one.
    await tx
      .update(schema.entries)
      .set({ deletedAt: new Date('2026-06-01T00:00:00Z') })
      .where(eq(schema.entries.publicId, first.entryPublicId));
    const again = expectOk(
      await f.tick({ prescriptionPublicId: f.p.reps.publicId }),
      'FAM-1 11c-ii R4: the ✓',
    );
    const plantedStill = (await f.entryRow(older.publicId)).deletedAt !== null;
    await unplant(tx, [older.id]);
    assert.deepEqual(
      [again.entryPublicId, plantedStill],
      [first.entryPublicId, true],
      'FAM-1 11c-ii R4: several hidden entries: the most recently hidden is revived, the other stays hidden',
    );
  });

  // R2 (342): another athlete's hidden entry, planted in this athlete's session and hidden more
  // recently, is never revived.
  await reviveProof('R5: another athlete’s hidden entry is never revived', async (f, tx) => {
    const first = expectOk(
      await f.tick({ prescriptionPublicId: f.p.reps.publicId }),
      'FAM-1 11c-ii R5: the ✓',
    );
    expectOk(await f.untick(first.entryPublicId), 'FAM-1 11c-ii R5: the un-tick');
    await tx
      .update(schema.entries)
      .set({ deletedAt: new Date('2026-01-01T00:00:00Z') })
      .where(eq(schema.entries.publicId, first.entryPublicId));
    const plants = [
      await plantOnSlot(tx, first.entryPublicId, {
        profileId: f.sibling.id,
        deletedAt: new Date('2026-06-01T00:00:00Z'),
      }),
      await plantOnSlot(tx, first.entryPublicId, {
        profileId: f.foreigner.id,
        deletedAt: new Date('2026-06-02T00:00:00Z'),
      }),
    ];
    const again = expectOk(
      await f.tick({ prescriptionPublicId: f.p.reps.publicId }),
      'FAM-1 11c-ii R5: the ✓ again',
    );
    const plantsHidden = await Promise.all(
      plants.map(async (p) => (await f.entryRow(p.publicId)).deletedAt !== null),
    );
    const slot = await onSlot(tx, f.p.reps.id);
    await unplant(
      tx,
      plants.map((p) => p.id),
    );
    assert.deepEqual(
      [again.entryPublicId, plantsHidden, slot.live.length],
      [first.entryPublicId, [true, true], 1],
      'FAM-1 11c-ii R5: another athlete’s hidden entry is never revived; this athlete’s own is',
    );
  });

  // R4 (357): the revive's UPDATE hits the row arbiter (a sibling's LIVE entry planted on the set, in
  // this athlete's session: state (i)). The savepoint absorbs the 23505 and the insert answers.
  await reviveProof('R6: the row arbiter arm', async (f, tx) => {
    const first = expectOk(
      await f.tick({ prescriptionPublicId: f.p.reps.publicId }),
      'FAM-1 11c-ii R6: the ✓',
    );
    expectOk(await f.untick(first.entryPublicId), 'FAM-1 11c-ii R6: the un-tick');
    const live = await plantOnSlot(tx, first.entryPublicId, {
      profileId: f.sibling.id,
      deletedAt: null,
    });
    const answer = await f.tick({ prescriptionPublicId: f.p.reps.publicId });
    const stillHidden = (await f.entryRow(first.entryPublicId)).deletedAt !== null;
    await unplant(tx, [live.id]);
    assert.deepEqual(
      [answer, stillHidden],
      [{ ok: false, reason: ROW_REFUSAL.slot_taken }, true],
      'FAM-1 11c-ii R6: the row arbiter arm: the revive rolls back and the ✓ answers slot_taken',
    );
  });

  // A refused ✓ never reaches the revive (R1). No proof of its own: every refusal throws inside the
  // writer's transaction, which rolls back, so "the hidden entry is untouched" would hold even if a
  // revive ran first. R6's `stillHidden` is the case that can fail: a revive attempted, then refused.

  // R4 / S2 (345–347): the revive freezes the CURRENT prescription: its text, its unit and its group.
  await reviveProof('R8: frozen again', async (f, tx) => {
    const first = expectOk(
      await f.tick({ prescriptionPublicId: f.p.weightReps.publicId }),
      'FAM-1 11c-ii R8: the Weight × Reps ✓',
    );
    expectOk(await f.untick(first.entryPublicId), 'FAM-1 11c-ii R8: its un-tick');
    await tx
      .update(schema.prescriptions)
      .set({ targetReps: '6' })
      .where(eq(schema.prescriptions.id, f.p.weightReps.id));
    await tx
      .update(schema.prescriptionQuantities)
      .set({ unit: 'kg' })
      .where(eq(schema.prescriptionQuantities.prescriptionId, f.p.weightReps.id));
    const again = expectOk(
      await f.tick({ prescriptionPublicId: f.p.weightReps.publicId }),
      'FAM-1 11c-ii R8: the ✓ after the edit',
    );
    const row = await f.entryRow(first.entryPublicId);
    const text = prescribedText({
      trackingType: TRACKING_TYPE.weight_reps,
      sets: 3,
      targetReps: '6',
      quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'kg', value: 25 }],
    });
    assert.equal(row.snapshot, text, 'FAM-1 11c-ii R8: frozen again: text');
    const [quantity] = await tx
      .select({ unit: schema.entrySetQuantities.unit })
      .from(schema.entrySetQuantities)
      .innerJoin(schema.entrySets, eq(schema.entrySets.id, schema.entrySetQuantities.entrySetId))
      .where(and(eq(schema.entrySets.entryId, row.id), isNull(schema.entrySets.deletedAt)));
    assert.deepEqual(
      [row.unit, quantity?.unit, again.values.quantities[0]?.unit],
      ['kg', 'kg', 'kg'],
      'FAM-1 11c-ii R8: frozen again: the unit',
    );

    const a = expectOk(
      await f.tick({ prescriptionPublicId: f.p.supA.publicId }),
      'FAM-1 11c-ii R8: the superset member’s ✓',
    );
    expectOk(await f.untick(a.entryPublicId), 'FAM-1 11c-ii R8: its un-tick');
    await tx
      .update(schema.prescriptions)
      .set({ supersetLabel: 'z' })
      .where(eq(schema.prescriptions.id, f.p.supA.id));
    expectOk(
      await f.tick({ prescriptionPublicId: f.p.supA.publicId }),
      'FAM-1 11c-ii R8: the member’s ✓ after the regroup',
    );
    const member = await f.entryRow(a.entryPublicId);
    const [group] = await tx
      .select({ group: schema.supersets.prescriptionGroup })
      .from(schema.supersets)
      .where(eq(schema.supersets.id, member.supersetId!));
    assert.equal(group?.group, 'z', 'FAM-1 11c-ii R8: frozen again: the group');
  });

  // R4: the revive's UPDATE hits `entries.client_id` (this ✓'s id landed on another row meanwhile).
  // Staged on one connection with a statement trigger on `sessions` (lane S's #578 rig): step 11's
  // session upsert fires it after the replay check and before the revive, and it plants a hidden row
  // holding this ✓'s clientId on another prescription. The savepoint absorbs the 23505 and the
  // classifier answers: a holder on another slot is `not_found`. Mutation 611 drops the arm.
  await reviveProof('R10: the clientId arm', async (f, tx) => {
    const target = newId();
    const holder = expectOk(
      await f.tick({ prescriptionPublicId: f.p.check.publicId }),
      'FAM-1 11c-ii R10: a row to copy',
    );
    const hidden = expectOk(
      await f.tick({ prescriptionPublicId: f.p.reps.publicId }),
      'FAM-1 11c-ii R10: the ✓ to revive',
    );
    expectOk(await f.untick(hidden.entryPublicId), 'FAM-1 11c-ii R10: its un-tick');
    await tx.execute(
      sql`create temp table revive_target (client_id uuid not null, src uuid not null)`,
    );
    await tx.execute(
      sql`insert into revive_target values (${target}::uuid, ${holder.entryPublicId}::uuid)`,
    );
    await tx.execute(sql`create function verify_revive_client_id() returns trigger language plpgsql as $$
      begin
        insert into entries (public_id, client_id, profile_id, activity_date, unit, movement_name,
            activity_type_id, movement_id, session_id, prescription_id, prescription_set,
            prescribed_snapshot, status, deleted_at)
          select gen_random_uuid(), t.client_id, e.profile_id, e.activity_date, e.unit, e.movement_name,
            e.activity_type_id, e.movement_id, e.session_id, e.prescription_id, e.prescription_set,
            e.prescribed_snapshot, e.status, now()
          from entries e join revive_target t on e.public_id = t.src
          where not exists (select 1 from entries x where x.client_id = t.client_id);
        return null;
      end $$`);
    await tx.execute(
      sql`create trigger revive_client_id after insert on sessions for each statement execute function verify_revive_client_id()`,
    );
    const answer = await f.tick({ clientId: target, prescriptionPublicId: f.p.reps.publicId });
    await tx.execute(sql`drop trigger revive_client_id on sessions`);
    await tx.execute(sql`drop function verify_revive_client_id()`);
    await tx.execute(sql`drop table revive_target`);
    assert.deepEqual(
      [answer, (await f.entryRow(hidden.entryPublicId)).deletedAt !== null],
      [{ ok: false, reason: ROW_REFUSAL.not_found }, true],
      'FAM-1 11c-ii R10: the clientId arm: a clientId another row took meanwhile is not_found, the entry stays hidden',
    );
  });

  // R5 (344), and D35's accepted limit, pinned.
  await reviveProof('R9: replays, and the limit', async (f) => {
    const [c1, c2] = [newId(), newId()];
    const first = expectOk(
      await f.tick({
        clientId: c1,
        prescriptionPublicId: f.p.weightReps.publicId,
        values: wr(8, 30),
      }),
      'FAM-1 11c-ii R9: ✓ c1',
    );
    expectOk(await f.untick(first.entryPublicId), 'FAM-1 11c-ii R9: un-tick');
    const revived = expectOk(
      await f.tick({
        clientId: c2,
        prescriptionPublicId: f.p.weightReps.publicId,
        values: wr(6, 35),
      }),
      'FAM-1 11c-ii R9: ✓ c2 revives',
    );
    expectRefused(
      await f.tick({
        clientId: c1,
        prescriptionPublicId: f.p.weightReps.publicId,
        values: wr(8, 30),
      }),
      ROW_REFUSAL.slot_taken,
      'FAM-1 11c-ii R9: replays: the old clientId, while the revived entry is live, is slot_taken',
    );
    assert.deepEqual(
      await f.tick({
        clientId: c2,
        prescriptionPublicId: f.p.weightReps.publicId,
        values: wr(6, 35),
      }),
      revived,
      'FAM-1 11c-ii R9: replays: the new clientId answers as the revive did',
    );
    expectOk(await f.untick(first.entryPublicId), 'FAM-1 11c-ii R9: un-tick again');
    expectRefused(
      await f.tick({
        clientId: c2,
        prescriptionPublicId: f.p.weightReps.publicId,
        values: wr(6, 35),
      }),
      ROW_REFUSAL.own_hidden,
      'FAM-1 11c-ii R9: replays: the hidden entry’s own clientId is own_hidden, with no revive',
    );
    // D35's accepted limit: the replaced clientId, replayed now, is a new ✓ and revives with ITS numbers.
    assert.deepEqual(
      await f.tick({
        clientId: c1,
        prescriptionPublicId: f.p.weightReps.publicId,
        values: wr(8, 30),
      }),
      { ok: true, entryPublicId: first.entryPublicId, values: wr(8, 30) },
      'FAM-1 11c-ii R9: the limit: the replaced clientId revives with its old numbers',
    );
  });
}

// ── FAM-1 11c-i — Change (`amendRow`) ─────────────────────────────────────────────────────────────────

/**
 * Change, as `docs/plans/fam-1-11c-change-and-revive.md` → § Test plan → Change lists it. Each
 * mutation (348–356 and 358–363, `scripts/mutations/README.md`) names the assertion here that it turns red.
 */
async function verifyAmend(): Promise<void> {
  const primary = QUANTITY_SLOT.primary;
  const q = (unit: Unit, value: number, slot: QuantitySlot = primary) => ({ slot, unit, value });
  /** The stored row's numbers and the columns Change must leave alone. */
  const rowState = async (tx: VerifyTx, publicId: string) => {
    const [row] = await tx
      .select({
        id: schema.entries.id,
        clientId: schema.entries.clientId,
        snapshot: schema.entries.prescribedSnapshot,
        createdAt: schema.entries.createdAt,
        updatedAt: schema.entries.updatedAt,
        deletedAt: schema.entries.deletedAt,
      })
      .from(schema.entries)
      .where(eq(schema.entries.publicId, publicId));
    const values = (await readRowValues(asTx(tx), [row.id])).get(row.id) ?? null;
    return { ...row, values };
  };
  const PAST = new Date('2000-01-01T00:00:00Z');

  // ── 1 · every tracking type is changed in place (owed line 1) ──────────────────────────────────
  await proof(
    'Change 1: every tracking type, in place',
    async (f, tx) => {
      const cases: { name: string; prescriptionPublicId: string; changed: RowValues }[] = [
        {
          name: 'count',
          prescriptionPublicId: f.p.count.publicId,
          changed: { quantities: [q('count', 25)] },
        },
        {
          name: 'reps',
          prescriptionPublicId: f.p.reps.publicId,
          changed: { reps: 12, quantities: [] },
        },
        {
          name: 'weight_reps',
          prescriptionPublicId: f.p.weightReps.publicId,
          changed: { reps: 6, quantities: [q('lb', 30)] },
        },
        {
          name: 'duration',
          prescriptionPublicId: f.p.duration.publicId,
          changed: { quantities: [q('min', 7)] },
        },
        {
          name: 'time_sets',
          prescriptionPublicId: f.p.timeSets.publicId,
          changed: { quantities: [q('sec', 45)] },
        },
        {
          name: 'distance',
          prescriptionPublicId: f.p.distance.publicId,
          changed: { quantities: [q('yd', 50, QUANTITY_SLOT.distance)] },
        },
        // Last: a Check has no numbers, so a set UPDATE with nothing to set would throw before the
        // `updated_at` assertions could name what is missing.
        { name: 'check', prescriptionPublicId: f.p.check.publicId, changed: { quantities: [] } },
      ];
      for (const c of cases) {
        const logged = expectOk(
          await f.tick({ prescriptionPublicId: c.prescriptionPublicId }),
          `FAM-1 11c-i Change 1: a ${c.name} row is logged`,
        );
        // Wind every `updated_at` of the row back, so the amend's `now()` is told apart in one
        // transaction: the entry, its live set and the set's quantities. `created_at` too, so a
        // re-stamp to `now()` would show.
        const entryId = (await f.entryRow(logged.entryPublicId)).id;
        await tx
          .update(schema.entries)
          .set({ updatedAt: PAST, createdAt: PAST })
          .where(eq(schema.entries.id, entryId));
        const [set] = await tx
          .update(schema.entrySets)
          .set({ updatedAt: PAST })
          .where(eq(schema.entrySets.entryId, entryId))
          .returning({ id: schema.entrySets.id });
        await tx
          .update(schema.entrySetQuantities)
          .set({ updatedAt: PAST })
          .where(eq(schema.entrySetQuantities.entrySetId, set!.id));
        const before = await rowState(tx, logged.entryPublicId);
        const r = expectOk(
          await f.amend(logged.entryPublicId, c.changed),
          `FAM-1 11c-i Change 1: a ${c.name} row is changed`,
        );
        const after = await rowState(tx, logged.entryPublicId);
        assert.deepEqual(
          [r.entryPublicId, r.values, after.values],
          [logged.entryPublicId, c.changed, c.changed],
          `FAM-1 11c-i Change 1: a ${c.name} row holds and answers the new numbers`,
        );
        assert.deepEqual(
          [after.id, after.clientId, after.snapshot, after.createdAt.getTime(), after.deletedAt],
          [before.id, before.clientId, before.snapshot, before.createdAt.getTime(), null],
          `FAM-1 11c-i Change 1: a ${c.name} row keeps its id, client_id, text and created_at`,
        );
        assert.ok(
          after.updatedAt.getTime() > PAST.getTime(),
          `FAM-1 11c-i Change 1: a ${c.name} row's updated_at advances`,
        );
        const [setStamp] = await tx
          .select({ at: schema.entrySets.updatedAt })
          .from(schema.entrySets)
          .where(eq(schema.entrySets.id, set!.id));
        assert.ok(
          setStamp!.at.getTime() > PAST.getTime(),
          `FAM-1 11c-i Change 1: a ${c.name} row's set updated_at advances`,
        );
        const quantityStamps = await tx
          .select({ at: schema.entrySetQuantities.updatedAt })
          .from(schema.entrySetQuantities)
          .where(eq(schema.entrySetQuantities.entrySetId, set!.id));
        assert.ok(
          quantityStamps.every((x) => x.at.getTime() > PAST.getTime()),
          `FAM-1 11c-i Change 1: a ${c.name} row's quantities' updated_at advance`,
        );
      }
    },
    '11c-i',
  );

  // ── 2 · bad_value: a blank, another unit, a field the type does not have (owed line 2) ──────────
  await proof(
    'Change 2: bad_value keeps the number that is there',
    async (f, tx) => {
      const logged = expectOk(
        await f.tick({ prescriptionPublicId: f.p.weightReps.publicId }),
        'FAM-1 11c-i Change 2: the row',
      );
      const before = await rowState(tx, logged.entryPublicId);
      for (const [title, values] of [
        ['a blank weight', { reps: 6, quantities: [] }],
        ['a blank reps', { quantities: [q('lb', 30)] }],
        ['another unit', { reps: 6, quantities: [q('kg', 30)] }],
        ['another slot', { reps: 6, quantities: [q('lb', 30, QUANTITY_SLOT.distance)] }],
      ] as [string, RowValues][]) {
        expectRefused(
          await f.amend(logged.entryPublicId, values),
          ROW_REFUSAL.bad_value,
          `FAM-1 11c-i Change 2: ${title} is bad_value`,
        );
      }
      const count = expectOk(
        await f.tick({ prescriptionPublicId: f.p.count.publicId }),
        'FAM-1 11c-i Change 2: a Count row',
      );
      expectRefused(
        await f.amend(count.entryPublicId, { reps: 3, quantities: [q('count', 25)] }),
        ROW_REFUSAL.bad_value,
        'FAM-1 11c-i Change 2: reps on a Count is bad_value',
      );
      assert.deepEqual(
        (await rowState(tx, logged.entryPublicId)).values,
        before.values,
        'FAM-1 11c-i Change 2: the stored numbers are unchanged',
      );
    },
    '11c-i',
  );

  // ── 3 · the unit the row was logged in (A5, C28) ───────────────────────────────────────────────
  await proof(
    'Change 3: checked in the unit the row was logged in',
    async (f, tx) => {
      const logged = expectOk(
        await f.tick({ prescriptionPublicId: f.p.weightReps.publicId }),
        'FAM-1 11c-i Change 3: a row logged in lb',
      );
      const loggedText = (await rowState(tx, logged.entryPublicId)).snapshot;
      // The program is edited since: the prescription is now in kg.
      await tx
        .update(schema.prescriptionQuantities)
        .set({ unit: 'kg', dimension: UNIT_DIMENSION_BY_CODE.kg })
        .where(eq(schema.prescriptionQuantities.prescriptionId, f.p.weightReps.id));
      expectRefused(
        await f.amend(logged.entryPublicId, { reps: 6, quantities: [q('kg', 14)] }),
        ROW_REFUSAL.bad_value,
        'FAM-1 11c-i Change 3: a number in the new unit is bad_value',
      );
      const r = expectOk(
        await f.amend(logged.entryPublicId, { reps: 6, quantities: [q('lb', 30)] }),
        'FAM-1 11c-i Change 3: a number in the unit it was logged in is ok',
      );
      assert.deepEqual(
        r.values,
        { reps: 6, quantities: [q('lb', 30)] },
        'FAM-1 11c-i Change 3: and it is stored in lb',
      );
      // A7: the text is the one the row was logged against, not the kg program's (re-frozen, it
      // would read the new unit).
      assert.equal(
        (await rowState(tx, logged.entryPublicId)).snapshot,
        loggedText,
        'FAM-1 11c-i Change 3: and it keeps the text it was logged against',
      );
    },
    '11c-i',
  );

  // ── 4 · closed_day: the day before yesterday, and an archived athlete ──────────────────────────
  await proof(
    'Change 4: closed_day',
    async (f, tx) => {
      // A week back: a Monday, so W1 is on the week that day (two days back is a Saturday).
      const twoBack = addDays(DAY, -7);
      const old = expectOk(
        await f.tick({ prescriptionPublicId: f.p.reps.publicId, day: twoBack }, twoBack),
        'FAM-1 11c-i Change 4: a row logged on its own day',
      );
      expectRefused(
        await f.amend(old.entryPublicId, { reps: 12, quantities: [] }),
        ROW_REFUSAL.closed_day,
        'FAM-1 11c-i Change 4: a week back is closed_day',
      );
      const yesterday = expectOk(
        await f.tick({ prescriptionPublicId: f.p.reps.publicId, day: YESTERDAY }),
        'FAM-1 11c-i Change 4: a row logged yesterday',
      );
      expectOk(
        await f.amend(yesterday.entryPublicId, { reps: 12, quantities: [] }),
        'FAM-1 11c-i Change 4: yesterday is open (non-vacuity)',
      );
      await tx
        .update(schema.profiles)
        .set({ archivedAt: new Date() })
        .where(eq(schema.profiles.id, f.athlete.id));
      expectRefused(
        await f.amend(yesterday.entryPublicId, { reps: 9, quantities: [] }),
        ROW_REFUSAL.closed_day,
        'FAM-1 11c-i Change 4: an archived athlete’s row is closed_day',
      );
    },
    '11c-i',
  );

  // ── 5 · not_found: whose row it is, and what kind ──────────────────────────────────────────────
  await proof(
    'Change 5: not_found',
    async (f, tx) => {
      const mine = expectOk(
        await f.tick({ prescriptionPublicId: f.p.reps.publicId }),
        'FAM-1 11c-i Change 5: the athlete’s row',
      );
      const theirs = expectOk(
        await f.tick({
          prescriptionPublicId: f.p.reps.publicId,
          profilePublicId: f.sibling.publicId,
        }),
        'FAM-1 11c-i Change 5: the sibling’s row',
      );
      const foreign = expectOk(
        await f.tickIn(
          f.F_SCOPE,
          {
            profilePublicId: f.foreigner.publicId,
            workoutPublicId: f.fw.publicId,
            prescriptionPublicId: f.fp.publicId,
          },
          DAY,
        ),
        'FAM-1 11c-i Change 5: another household’s row',
      );
      const changed = { reps: 12, quantities: [] };
      const theirsBefore = await rowState(tx, theirs.entryPublicId);
      expectRefused(
        await f.amend(theirs.entryPublicId, changed),
        ROW_REFUSAL.not_found,
        'FAM-1 11c-i Change 5: the sibling’s row under the athlete’s id is not_found',
      );
      assert.deepEqual(
        (await rowState(tx, theirs.entryPublicId)).values,
        theirsBefore.values,
        'FAM-1 11c-i Change 5: and the sibling’s row is not written',
      );
      // Not a program row: the athlete's own entry, in their own workout session, with no
      // prescription and no set (a CHECK pairs them), the shape of an old strength entry. Only
      // `programRow()` refuses it with `not_found`; without it the purged-prescription check would
      // answer `program_changed`.
      const strength = expectOk(
        await f.tick({ prescriptionPublicId: f.p.reps.publicId, set: 2 }),
        'FAM-1 11c-i Change 5: a row to make into a non-program row',
      );
      const own = (await f.entryRow(strength.entryPublicId)).prescriptionId!;
      const unset = (prescriptionId: number | null, prescriptionSet: number | null) =>
        tx
          .update(schema.entries)
          .set({ prescriptionId, prescriptionSet })
          .where(eq(schema.entries.publicId, strength.entryPublicId));
      await unset(null, null);
      expectRefused(
        await f.amend(strength.entryPublicId, changed),
        ROW_REFUSAL.not_found,
        'FAM-1 11c-i Change 5: an entry that is not a program row is not_found',
      );
      await unset(own, 2); // the plant goes before the sweep
      expectRefused(
        await f.amend(foreign.entryPublicId, { quantities: [] }),
        ROW_REFUSAL.not_found,
        'FAM-1 11c-i Change 5: another household’s row is not_found',
      );
      // Another household's PROFILE under H's scope, naming its own row, and an unknown profile.
      // `openProfile` refuses both; `rowWorkout`'s scope would too, so this is a second guard with no
      // patch of its own (no patch can redden it through Change).
      // A Check has no numbers to compare, so the row's `updated_at` is wound back and read: any
      // write stamps it (`updateEntrySetRows`).
      await tx
        .update(schema.entries)
        .set({ updatedAt: PAST })
        .where(eq(schema.entries.publicId, foreign.entryPublicId));
      for (const [title, profilePublicId] of [
        ['another household’s profile', f.foreigner.publicId],
        ['an unknown profile', newId()],
      ] as const) {
        expectRefused(
          await f.amend(foreign.entryPublicId, { quantities: [] }, { profilePublicId }),
          ROW_REFUSAL.not_found,
          `FAM-1 11c-i Change 5: ${title} is not_found`,
        );
      }
      assert.equal(
        (await rowState(tx, foreign.entryPublicId)).updatedAt.getTime(),
        PAST.getTime(),
        'FAM-1 11c-i Change 5: and another household’s row is not written',
      );
      const weighIn = await f.weighIn(false);
      expectRefused(
        await f.amend(weighIn.publicId, { quantities: [q('lb', 81)] }),
        ROW_REFUSAL.not_found,
        'FAM-1 11c-i Change 5: a weigh-in is not_found',
      );
      expectOk(await f.untick(mine.entryPublicId), 'FAM-1 11c-i Change 5: the un-tick');
      expectRefused(
        await f.amend(mine.entryPublicId, changed),
        ROW_REFUSAL.not_found,
        'FAM-1 11c-i Change 5: a hidden row is not_found',
      );
      void tx;
    },
    '11c-i',
  );

  // ── 6 · the planted states: (i), and (f′) on the athlete's own row ────────────────────────────
  await proof(
    'Change 6: a row in another athlete’s session, and on a foreign workout',
    async (f, tx) => {
      const changed = { reps: 12, quantities: [] };
      // (i): the athlete's row moved into the SIBLING's session of the same, scheduled workout.
      const sib = expectOk(
        await f.tick({
          prescriptionPublicId: f.p.check.publicId,
          profilePublicId: f.sibling.publicId,
        }),
        'FAM-1 11c-i Change 6: the sibling’s session',
      );
      const mine = expectOk(
        await f.tick({ prescriptionPublicId: f.p.reps.publicId }),
        'FAM-1 11c-i Change 6: the athlete’s row',
      );
      const ownSession = (await f.entryRow(mine.entryPublicId)).sessionId!;
      const sibSession = (await f.entryRow(sib.entryPublicId)).sessionId!;
      const moveTo = (sessionId: number) =>
        tx
          .update(schema.entries)
          .set({ sessionId })
          .where(eq(schema.entries.publicId, mine.entryPublicId));
      await moveTo(sibSession);
      expectRefused(
        await f.amend(mine.entryPublicId, changed),
        ROW_REFUSAL.not_found,
        'FAM-1 11c-i Change 6: a row in another athlete’s session is not_found',
      );
      await moveTo(ownSession); // the (i) plant goes before the sweep
      expectOk(
        await f.amend(mine.entryPublicId, changed),
        'FAM-1 11c-i Change 6: back in its own session it is ok (non-vacuity)',
      );

      // (f′): the athlete's own row pointed at ANOTHER household's workout AND a prescription of it on
      // a GLOBAL movement, so the pin to the workout and the movement's household both pass: only
      // the workout's own scope (`rowWorkout`'s `athleteTemplateBlockIn`) refuses it.
      // A seeded global movement (household NULL), so it is available to every household.
      const [globalMove] = await tx
        .select({ id: schema.movements.id })
        .from(schema.movements)
        .where(
          and(
            isNull(schema.movements.householdId),
            eq(schema.movements.trackingType, TRACKING_TYPE.reps),
          ),
        )
        .limit(1);
      assert.ok(globalMove, 'FAM-1 11c-i Change 6: a global Reps movement is seeded');
      const [theirRx] = await tx
        .insert(schema.prescriptions)
        .values({
          publicId: newId(),
          blockId: f.fw.blockId,
          workoutId: f.fw.id,
          clientId: newId(),
          movementId: globalMove.id,
          idx: 9,
          sets: 3,
          targetReps: '10',
        })
        .returning({ id: schema.prescriptions.id });
      const ownRx = (await f.entryRow(mine.entryPublicId)).prescriptionId!;
      const point = async (workoutId: number, prescriptionId: number) => {
        await tx
          .update(schema.sessions)
          .set({ workoutId })
          .where(eq(schema.sessions.id, ownSession));
        await tx
          .update(schema.entries)
          .set({ prescriptionId })
          .where(eq(schema.entries.publicId, mine.entryPublicId));
      };
      await point(f.fw.id, theirRx.id);
      expectRefused(
        await f.amend(mine.entryPublicId, { reps: 9, quantities: [] }),
        ROW_REFUSAL.not_found,
        'FAM-1 11c-i Change 6: a row on another household’s workout is not_found',
      );
      await point(f.w1.id, ownRx); // the (f) and (g) plants go before the sweep
    },
    '11c-i',
  );

  // ── 7 · the program: off the week, hidden, purged ──────────────────────────────────────────────
  await proof(
    'Change 7: not_scheduled and program_changed',
    async (f, tx) => {
      const changed = { reps: 12, quantities: [] };
      const row = async () =>
        expectOk(
          await f.tick({ prescriptionPublicId: f.p.reps.publicId }),
          'FAM-1 11c-i Change 7: a row',
        );
      const fresh = async (
        title: string,
        change: () => Promise<unknown>,
        undo: () => Promise<unknown>,
        reason: RowRefusal,
      ) => {
        const r = await row();
        await change();
        expectRefused(
          await f.amend(r.entryPublicId, changed),
          reason,
          `FAM-1 11c-i Change 7: ${title}`,
        );
        await undo();
        // Clear the slot for the next case.
        expectOk(
          await f.untick(r.entryPublicId),
          `FAM-1 11c-i Change 7: ${title}, un-ticked after`,
        );
      };
      const slot = and(
        eq(schema.blockDayWorkouts.workoutId, f.w1.id),
        eq(schema.blockDayWorkouts.weekday, MONDAY),
      );
      await fresh(
        'a workout that left the week is not_scheduled',
        () => tx.update(schema.blockDayWorkouts).set({ deletedAt: new Date() }).where(slot),
        () => tx.update(schema.blockDayWorkouts).set({ deletedAt: null }).where(slot),
        ROW_REFUSAL.not_scheduled,
      );
      await fresh(
        'a hidden workout is program_changed',
        () =>
          tx
            .update(schema.workouts)
            .set({ deletedAt: new Date() })
            .where(eq(schema.workouts.id, f.w1.id)),
        () =>
          tx
            .update(schema.workouts)
            .set({ deletedAt: null })
            .where(eq(schema.workouts.id, f.w1.id)),
        ROW_REFUSAL.program_changed,
      );
      await fresh(
        'a hidden block is program_changed',
        () =>
          tx
            .update(schema.programBlocks)
            .set({ deletedAt: new Date() })
            .where(eq(schema.programBlocks.id, f.w1.blockId)),
        () =>
          tx
            .update(schema.programBlocks)
            .set({ deletedAt: null })
            .where(eq(schema.programBlocks.id, f.w1.blockId)),
        ROW_REFUSAL.program_changed,
      );
      await fresh(
        'a hidden prescription is program_changed',
        () =>
          tx
            .update(schema.prescriptions)
            .set({ deletedAt: new Date() })
            .where(eq(schema.prescriptions.id, f.p.reps.id)),
        () =>
          tx
            .update(schema.prescriptions)
            .set({ deletedAt: null })
            .where(eq(schema.prescriptions.id, f.p.reps.id)),
        ROW_REFUSAL.program_changed,
      );
      // A purged prescription (`ON DELETE SET NULL`): the set stays, so it is still a program row.
      const purged = await row();
      await tx
        .update(schema.entries)
        .set({ prescriptionId: null })
        .where(eq(schema.entries.publicId, purged.entryPublicId));
      expectRefused(
        await f.amend(purged.entryPublicId, changed),
        ROW_REFUSAL.program_changed,
        'FAM-1 11c-i Change 7: a purged prescription is program_changed',
      );
      // A purged workout (`sessions.workout_id` SET NULL): off the week, as `untickRow` has it.
      const purgedWorkout = await f.tick({
        workoutPublicId: f.w2.publicId,
        prescriptionPublicId: f.p.w2.publicId,
      });
      const pw = expectOk(purgedWorkout, 'FAM-1 11c-i Change 7: a W2 row');
      await tx
        .update(schema.sessions)
        .set({ workoutId: null })
        .where(eq(schema.sessions.id, (await f.entryRow(pw.entryPublicId)).sessionId!));
      expectRefused(
        await f.amend(pw.entryPublicId, { quantities: [] }),
        ROW_REFUSAL.not_scheduled,
        'FAM-1 11c-i Change 7: a purged workout is not_scheduled',
      );
      // A workout session with no workout is a detector's state: put it back before the sweep.
      await tx
        .update(schema.sessions)
        .set({ workoutId: f.w2.id })
        .where(eq(schema.sessions.id, (await f.entryRow(pw.entryPublicId)).sessionId!));
    },
    '11c-i',
  );

  // ── 8 · a replay, and the live set ─────────────────────────────────────────────────────────────
  await proof(
    'Change 8: a replay, and only the live set is written',
    async (f, tx) => {
      const logged = expectOk(
        await f.tick({ prescriptionPublicId: f.p.weightReps.publicId }),
        'FAM-1 11c-i Change 8: the row',
      );
      // A HIDDEN set under the entry, carrying a LIVE 99 lb quantity in the same slot (as proof 10).
      const hiddenSet = await f.plantHiddenSet(logged.entryPublicId);
      const changed = { reps: 6, quantities: [q('lb', 30)] };
      const first = await f.amend(logged.entryPublicId, changed);
      const second = await f.amend(logged.entryPublicId, changed);
      assert.deepEqual(
        [first, second],
        [
          { ok: true, entryPublicId: logged.entryPublicId, values: changed },
          { ok: true, entryPublicId: logged.entryPublicId, values: changed },
        ],
        'FAM-1 11c-i Change 8: the same amend twice answers the same, and writes only the live set',
      );
      const liveSets = await tx
        .select({ id: schema.entrySets.id })
        .from(schema.entrySets)
        .where(
          and(
            eq(schema.entrySets.entryId, (await f.entryRow(logged.entryPublicId)).id),
            isNull(schema.entrySets.deletedAt),
          ),
        );
      assert.equal(liveSets.length, 1, 'FAM-1 11c-i Change 8: still one live set, nothing added');
      const [hiddenQuantity] = await tx
        .select({ value: schema.entrySetQuantities.valueNum })
        .from(schema.entrySetQuantities)
        .where(eq(schema.entrySetQuantities.entrySetId, hiddenSet.id));
      assert.equal(
        Number(hiddenQuantity.value),
        99,
        'FAM-1 11c-i Change 8: the hidden set’s quantity is untouched',
      );
    },
    '11c-i',
  );
}
