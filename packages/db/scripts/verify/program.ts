import assert from 'node:assert/strict';

import {
  addDays,
  DEFAULT_TRACKING_TYPE,
  MAX_DAY_SLOTS,
  MAX_HOUSEHOLD_ITEMS,
  MAX_PROGRAM_WORKOUTS,
  foldMovementQuery,
  COPY_NAME_SUFFIX,
  copyName,
  MAX_REPS_PER_SET,
  MOVEMENT_PATTERNS,
  MOVEMENT_PICKER_ENTRIES,
  MOVEMENT_SEED_ROWS,
  movementSlug,
  newId,
  PROFILE_KIND,
  PROGRAM_BLOCK_KIND,
  PROGRAM_NAME_MAX,
  PROGRAM_REFUSAL,
  PROGRAM_SEED,
  QUANTITY_SLOT,
  SLOT_LABEL_MAX,
  TRACKING_TYPE,
  WORKOUT_NAME_MAX,
  emptyWeek,
  WEEKDAYS,
  weekDaysSchema,
} from '@mat-plan/shared';
import {
  DAY_PLAN_FIXTURE_SOURCES,
  fixtureIds,
  heavyADraft,
  programView,
  workoutDraft,
} from '@mat-plan/shared/program/fixtures';
import type { TrackingType, WeekDraft, WorkoutDraft } from '@mat-plan/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { schema } from '../../src/client';
import { householdScopeForScript } from '../../src/writers/household-scope-script';
import { ADVISORY_LOCK } from '../../src/writers/locks';
import type { HouseholdScope } from '../../src/scope';
import {
  insertMovementOwnedBy,
  insertProfileOwnedBy,
  profileByClientId,
  insertProgramBlockOwnedBy,
  movementInHousehold,
  programBlockByClientId,
  programBlockInHousehold,
  programBlockIsLegacy,
} from '../../src/writers/ownership';
import { putOn } from '../../src/writers/program/assign';
import {
  SEED_FIXTURE_ATHLETES,
  SEED_FIXTURE_COUNTS,
  SEED_FIXTURE_PROGRAM_CLIENT_IDS,
  seedFixtureProgramClientId,
  seedProgramFixtures,
} from '../../src/writers/program/seed-fixtures';
import { createProgram } from '../../src/writers/program/create-program';
import { copyWorkout } from '../../src/writers/program/copy-workout';
import { newItem } from '../../src/writers/program/new-item';
import { lostSlugRace } from '../../src/writers/program/program-name';
import { renameProgram } from '../../src/writers/program/rename-program';
import {
  movementOptions,
  programIn,
  readWeek,
  readWorkoutDraft,
  workoutIn,
  workoutInHousehold,
} from '../../src/queries/program';
import { saveWeek } from '../../src/writers/program/save-week';
import { saveWorkout } from '../../src/writers/program/save-workout';
import { SHIFT_BAND } from '../../src/writers/program/shift-band';
import { asTx, orFail, rolledBack, type VerifyContext, type VerifyTx } from './harness';
import { normalizeFixture } from './normalize-fixture';

/**
 * `db:verify` proofs for the PROGRAM writers and reads.
 *
 * **Owner: lane P** (`docs/plans/fam-1-family-program.md` §5 → "Lane P · program writers"). Only
 * lane P edits this file. Its steps add the proofs here:
 *
 * - step 6a-i: `createProgram` and `renameProgram` (below);
 * - step 6a-ii: a replayed save adds nothing; a reorder keeps logged rows attached; refusals are
 *   typed results; the `workout` read deep-equals the `heavy-a-draft` fixture;
 * - step 6a-iii: a replayed copy adds nothing; the item picker's options;
 * - step 6b: once per weekday; a removed slot frees its place;
 * - step 6c: assignments; `program-view` deep-equals `family-program`; the seeded programs equal the
 *   contract fixtures;
 * - step 6d: logged days keep their rows; two open assignments at one `idx` are refused.
 *
 * Every proof that writes runs inside `rolledBack`, so this module leaves nothing behind. What a
 * module can rely on when it runs, and the helpers to import, are in `./harness` → `VerifyContext`.
 *
 * ## Comparing a read with a contract fixture
 *
 * The both-sides rule (`docs/parallel-work.md` → "Once lanes run", 3): seed the state a named
 * fixture describes, in a household of this module's own, run the query, and assert the result
 * deep-equals the fixture. The database mints its own ids and timestamps, so pass BOTH sides through
 * `normalizeFixture` (`./normalize-fixture`), with the same options. Seed the fixture's own calendar
 * days: the normalizer leaves days alone.
 */
export async function verifyProgram(ctx: VerifyContext): Promise<void> {
  await verifyCreateProgram(ctx);
  await verifyRenameProgram(ctx);
  await verifySlugRace(ctx);
  await verifySaveWorkout(ctx);
  await verifySaveWeek(ctx);
  await verifyWorkoutInHousehold(ctx);
  await verifyMovementOptionsAndNewItem(ctx);
  await verifyCopyWorkout(ctx);
  await verifyPutOn(ctx);
  await verifySeedFixtures(ctx);
  await verifyCaps();
}

/** A program block, by public id, as the proofs compare it. */
async function blockRow(tx: VerifyTx, publicId: string) {
  const [row] = await tx
    .select({
      householdId: schema.programBlocks.householdId,
      kind: schema.programBlocks.kind,
      slug: schema.programBlocks.slug,
      name: schema.programBlocks.name,
    })
    .from(schema.programBlocks)
    .where(eq(schema.programBlocks.publicId, publicId));
  return row;
}

/** The two columns a rename writes. */
async function nameAndSlug(tx: VerifyTx, publicId: string) {
  const row = await blockRow(tx, publicId);
  return { name: row?.name, slug: row?.slug };
}

/** How many blocks `scope`'s household holds, hidden ones included. */
async function blocksIn(tx: VerifyTx, scope: HouseholdScope): Promise<number> {
  const rows = await tx
    .select({ id: schema.programBlocks.id })
    .from(schema.programBlocks)
    .where(programBlockInHousehold(scope));
  return rows.length;
}

/**
 * THE seeded block of `scope`'s household: `PROGRAM_SEED`'s, live, picked by its slug. Never "the
 * first legacy row": `verify.ts` adds legacy fixture blocks of its own, whose slugs are not their
 * names', and an unordered pick made the slug proof pass on one of those.
 */
async function seededBlock(tx: VerifyTx, scope: HouseholdScope) {
  const seed = PROGRAM_SEED[0]!;
  const [row] = await tx
    .select({ publicId: schema.programBlocks.publicId, name: schema.programBlocks.name })
    .from(schema.programBlocks)
    .where(
      and(
        programBlockInHousehold(scope),
        programBlockIsLegacy(),
        isNull(schema.programBlocks.deletedAt),
        eq(schema.programBlocks.slug, seed.slug),
      ),
    );
  assert.ok(row, 'FAM-1 6a-i: household A has the seeded block (the proofs need it)');
  assert.equal(movementSlug(row.name), seed.slug, 'the seeded slug is its name’s movementSlug');
  return { ...row, slug: seed.slug };
}

/** Create a program that must succeed, and return its public id. */
async function mustCreate(tx: VerifyTx, scope: HouseholdScope, name: string, clientId = newId()) {
  const made = await createProgram(asTx(tx), scope, { clientId, name });
  assert.ok(made.ok, `FAM-1 6a-i: creating "${name}" succeeds`);
  return made.programPublicId;
}

async function hide(tx: VerifyTx, publicId: string) {
  await tx
    .update(schema.programBlocks)
    .set({ deletedAt: sql`now()` })
    .where(eq(schema.programBlocks.publicId, publicId));
}

const TOO_LONG = 'x'.repeat(PROGRAM_NAME_MAX + 1);

async function verifyCreateProgram({ A_SCOPE, B_SCOPE }: VerifyContext): Promise<void> {
  await rolledBack(async (tx) => {
    const exec = asTx(tx);

    // ── a program is a TEMPLATE block of the caller's household, slugged from its name ──
    const clientId = newId();
    const heavy = await mustCreate(tx, A_SCOPE, 'Heavy A', clientId);
    const row = await blockRow(tx, heavy);
    assert.equal(row?.kind, PROGRAM_BLOCK_KIND.template, 'FAM-1 6a-i: a program is a template');
    assert.equal(row?.name, 'Heavy A', 'FAM-1 6a-i: the name is stored as typed');
    assert.equal(row?.slug, movementSlug('Heavy A'), 'FAM-1 6a-i: the slug is movementSlug(name)');
    const [aOwn] = await tx
      .select({ id: schema.programBlocks.id })
      .from(schema.programBlocks)
      .where(and(eq(schema.programBlocks.publicId, heavy), programBlockInHousehold(A_SCOPE)));
    assert.ok(aOwn, "FAM-1 6a-i: the program is the caller's household's");

    // ── a replay answers the first call's program, and adds nothing ──
    // "Other" is ANOTHER program's name: a replay under it must still be a replay, which only holds
    // if the replay is looked up before the name (a same-name replay is excluded from the name
    // check by its own client id, so it cannot show the order).
    await mustCreate(tx, A_SCOPE, 'Other');
    const before = await blocksIn(tx, A_SCOPE);
    for (const name of ['Heavy A', 'Something else', 'Other']) {
      const replay = await createProgram(exec, A_SCOPE, { clientId, name });
      assert.deepEqual(
        replay,
        { ok: true, programPublicId: heavy },
        `FAM-1 6a-i: a replayed createProgram (named "${name}") answers the first call's program`,
      );
    }
    assert.equal(await blocksIn(tx, A_SCOPE), before, 'FAM-1 6a-i: a replayed create adds nothing');
    assert.equal(
      (await blockRow(tx, heavy))?.name,
      'Heavy A',
      'FAM-1 6a-i: a replay renames nothing',
    );

    // ── a name the household already has, folded, is name_taken ──
    for (const name of ['Heavy A', 'heavy a', 'HEAVY  A', 'Héavy A']) {
      assert.deepEqual(
        await createProgram(exec, A_SCOPE, { clientId: newId(), name }),
        { ok: false, reason: PROGRAM_REFUSAL.name_taken },
        `FAM-1 6a-i: "${name}" is name_taken beside "Heavy A"`,
      );
    }
    assert.equal(await blocksIn(tx, A_SCOPE), before, 'FAM-1 6a-i: a taken name writes nothing');

    // ── a bad input is invalid, never thrown ──
    for (const input of [
      { clientId: newId(), name: '' },
      { clientId: newId(), name: '   ' },
      { clientId: newId(), name: TOO_LONG },
      { clientId: 'not-a-uuid', name: 'Fine' },
      null,
    ]) {
      assert.deepEqual(
        await createProgram(exec, A_SCOPE, input),
        { ok: false, reason: PROGRAM_REFUSAL.invalid },
        `FAM-1 6a-i: createProgram(${JSON.stringify(input)}) is invalid`,
      );
    }
    assert.equal(
      await blocksIn(tx, A_SCOPE),
      before,
      'FAM-1 6a-i: an invalid create writes nothing',
    );

    // ── slugs: suffixed past a template's AND the seeded block's (D9); names: templates only ──
    const underscored = await mustCreate(tx, A_SCOPE, 'Heavy_A');
    assert.equal(
      (await blockRow(tx, underscored))?.slug,
      `${movementSlug('Heavy A')}-2`,
      'FAM-1 6a-i: a second program with the same slug gets -2',
    );
    const seeded = await seededBlock(tx, A_SCOPE);
    // Its name is not a program's, so it is not taken; its slug is (the slug index spans kinds).
    const sameAsSeeded = await mustCreate(tx, A_SCOPE, seeded.name);
    assert.equal(
      (await blockRow(tx, sameAsSeeded))?.slug,
      `${seeded.slug}-2`,
      "FAM-1 6a-i: the seeded block's name is not taken, and its slug is suffixed past",
    );

    // ── another household: its own names, its own slugs, its own client ids ──
    const bHeavy = await mustCreate(tx, B_SCOPE, 'Heavy A', clientId);
    assert.notEqual(bHeavy, heavy, "FAM-1 6a-i: the same client id in B is B's own program");
    const bRow = await blockRow(tx, bHeavy);
    assert.notEqual(bRow?.householdId, row?.householdId, "FAM-1 6a-i: B's program is B's");
    assert.equal(
      bRow?.slug,
      movementSlug('Heavy A'),
      "FAM-1 6a-i: B's slug ignores A's (the slug read is household-scoped)",
    );

    // ── a removed program: its replay is not_found; its name and slug are free again ──
    await hide(tx, heavy);
    assert.deepEqual(
      await createProgram(exec, A_SCOPE, { clientId, name: 'Heavy A' }),
      { ok: false, reason: PROGRAM_REFUSAL.not_found },
      'FAM-1 6a-i: replaying the create of a removed program is not_found, not a second program',
    );
    await hide(tx, underscored);
    const again = await mustCreate(tx, A_SCOPE, 'Heavy A');
    assert.equal(
      (await blockRow(tx, again))?.slug,
      movementSlug('Heavy A'),
      "FAM-1 6a-i: a removed program's name and slug are free again",
    );
  });
  console.log('✓ FAM-1 6a-i: createProgram (replay, name_taken, invalid, slugs, households)');
}

async function verifyRenameProgram({ A_SCOPE, B_SCOPE }: VerifyContext): Promise<void> {
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    const heavy = await mustCreate(tx, A_SCOPE, 'Heavy A');
    const light = await mustCreate(tx, A_SCOPE, 'Light A');
    const theirs = await mustCreate(tx, B_SCOPE, 'Theirs');

    assert.deepEqual(
      await renameProgram(exec, A_SCOPE, { programPublicId: heavy, name: 'Heavy B' }),
      { ok: true },
      'FAM-1 6a-i: a rename succeeds',
    );
    assert.deepEqual(
      await nameAndSlug(tx, heavy),
      { name: 'Heavy B', slug: movementSlug('Heavy B') },
      'FAM-1 6a-i: a rename stores the name and re-slugs: the old name is kept nowhere',
    );
    assert.deepEqual(
      await renameProgram(exec, A_SCOPE, { programPublicId: heavy, name: 'heavy b' }),
      { ok: true },
      "FAM-1 6a-i: a program's own name, re-spelt, is not taken",
    );
    assert.equal(
      (await blockRow(tx, heavy))?.slug,
      movementSlug('Heavy B'),
      'FAM-1 6a-i: a re-spelling keeps its own slug (not -2 past itself)',
    );
    // A name of its own whose slug another program holds: renamed, and suffixed past it.
    assert.deepEqual(
      await renameProgram(exec, A_SCOPE, { programPublicId: heavy, name: 'Light_A' }),
      { ok: true },
      'FAM-1 6a-i: a name that only shares a slug is not taken',
    );
    assert.equal(
      (await blockRow(tx, heavy))?.slug,
      `${movementSlug('Light A')}-2`,
      "FAM-1 6a-i: a rename is suffixed past another program's slug",
    );

    for (const name of ['Light A', 'light  a']) {
      assert.deepEqual(
        await renameProgram(exec, A_SCOPE, { programPublicId: heavy, name }),
        { ok: false, reason: PROGRAM_REFUSAL.name_taken },
        `FAM-1 6a-i: renaming to "${name}", another program's name, is name_taken`,
      );
    }
    for (const name of ['', '  ', TOO_LONG]) {
      assert.deepEqual(
        await renameProgram(exec, A_SCOPE, { programPublicId: heavy, name }),
        { ok: false, reason: PROGRAM_REFUSAL.invalid },
        `FAM-1 6a-i: renaming to ${JSON.stringify(name)} is invalid`,
      );
    }
    assert.equal(
      (await blockRow(tx, heavy))?.name,
      'Light_A',
      'FAM-1 6a-i: a refusal writes nothing',
    );

    // ── not_found, the same answer for each: another household's, the seeded block, removed, unknown ──
    const seeded = await seededBlock(tx, A_SCOPE);
    await hide(tx, light);
    const cases: Array<[string, string]> = [
      ["another household's program", theirs],
      ['the seeded (legacy) block', seeded.publicId],
      ['a removed program', light],
      ['an unknown id', newId()],
    ];
    for (const [what, programPublicId] of cases) {
      assert.deepEqual(
        await renameProgram(exec, A_SCOPE, { programPublicId, name: 'Taken over' }),
        { ok: false, reason: PROGRAM_REFUSAL.not_found },
        `FAM-1 6a-i: renaming ${what} is not_found`,
      );
    }
    assert.equal((await blockRow(tx, theirs))?.name, 'Theirs', "FAM-1 6a-i: B's is unchanged");
    assert.deepEqual(
      await nameAndSlug(tx, seeded.publicId),
      { name: seeded.name, slug: seeded.slug },
      'FAM-1 6a-i: the seeded block is unchanged',
    );
    assert.equal(
      (await blockRow(tx, light))?.name,
      'Light A',
      'FAM-1 6a-i: a removed one is unchanged',
    );
  });
  console.log('✓ FAM-1 6a-i: renameProgram (re-slugs, name_taken, invalid, not_found)');
}

/**
 * The slug race, on PGlite's one connection: `lostSlugRace` alone (a forced collision pins its
 * constraint name to the schema's), then both writers losing it, staged by writing the colliding row
 * as the writer opens its savepoint. Each answers `retry`, and a lost rename writes nothing.
 */
async function verifySlugRace({ A_SCOPE }: VerifyContext): Promise<void> {
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    const seeded = await seededBlock(tx, A_SCOPE);
    const collide = (e: typeof exec) =>
      insertProgramBlockOwnedBy(e, A_SCOPE, {
        clientId: newId(),
        slug: seeded.slug,
        name: 'Collides',
        notes: null,
      });
    assert.equal(
      await lostSlugRace(exec, collide),
      true,
      'FAM-1 6a-i: a write on a live slug is a lost slug race',
    );
    // Only the savepoint rolled back: the enclosing transaction still answers.
    assert.ok(await blocksIn(tx, A_SCOPE), 'FAM-1 6a-i: the caller’s transaction survives');
    assert.equal(
      await lostSlugRace(exec, async () => undefined),
      false,
      'FAM-1 6a-i: a write that succeeds lost no race',
    );
    await assert.rejects(
      lostSlugRace(exec, async () => {
        throw new Error('something else');
      }),
      /something else/,
      'FAM-1 6a-i: any other error is thrown unchanged',
    );

    // ── the writers' own lost-race branch: the race staged on one connection ──
    // A throw becomes a value, so a writer that lets the race escape fails the assertion by name.
    const threw = (e: unknown) => ({ threw: String(e) });
    // `stealing(slug)` is `exec`, except that a program holding `slug` is written just as the writer
    // opens its savepoint: after it read the slug as free, before its write. That is the other
    // device winning the race.
    const stealing = (slug: string): typeof exec =>
      new Proxy(exec, {
        get(target, prop, receiver) {
          if (prop !== 'transaction') return Reflect.get(target, prop, receiver);
          return async (fn: Parameters<typeof exec.transaction>[0]) => {
            await insertProgramBlockOwnedBy(target, A_SCOPE, {
              clientId: newId(),
              slug,
              name: `Thief ${slug}`,
              notes: null,
            });
            return target.transaction(fn);
          };
        },
      });
    assert.deepEqual(
      await createProgram(stealing(movementSlug('Race A')), A_SCOPE, {
        clientId: newId(),
        name: 'Race A',
      }).catch(threw),
      { ok: false, reason: PROGRAM_REFUSAL.retry },
      'FAM-1 6a-i: a create that loses its slug race answers retry, never throws',
    );
    const racer = await mustCreate(tx, A_SCOPE, 'Race B');
    assert.deepEqual(
      await renameProgram(stealing(movementSlug('Race C')), A_SCOPE, {
        programPublicId: racer,
        name: 'Race C',
      }).catch(threw),
      { ok: false, reason: PROGRAM_REFUSAL.retry },
      'FAM-1 6a-i: a rename that loses its slug race answers retry, never throws',
    );
    assert.equal(
      (await blockRow(tx, racer))?.name,
      'Race B',
      'FAM-1 6a-i: a lost rename writes nothing',
    );
  });
  console.log('✓ FAM-1 6a-i: the slug race (lostSlugRace; both writers answer retry)');
}

/**
 * `heavy-a-draft` re-keyed onto rows of `scope`'s household: a program, and one item per fixture item
 * (made as the household's own, named and typed as the fixture says). The draft keeps the fixture's
 * own client ids, so the saved workout can deep-equal the fixture.
 */
async function seedHeavyA(tx: VerifyTx, scope: HouseholdScope) {
  const exec = asTx(tx);
  const programPublicId = await mustCreate(tx, scope, 'Kids program');
  const itemIds = new Map<string, string>();
  for (const item of heavyADraft.items) {
    if (itemIds.has(item.itemPublicId)) continue;
    const publicId = newId();
    await insertMovementOwnedBy(exec, scope, {
      publicId,
      slug: `fam-1-6a-ii-${movementSlug(item.itemName)}`,
      name: item.itemName,
      isBodyweight: false,
      trackingType: item.trackingType,
    });
    itemIds.set(item.itemPublicId, publicId);
  }
  const draft: WorkoutDraft = {
    ...heavyADraft,
    programPublicId,
    workoutPublicId: null,
    items: heavyADraft.items.map((item) => ({
      ...item,
      itemPublicId: itemIds.get(item.itemPublicId)!,
    })),
  };
  return { programPublicId, draft, itemIds };
}

/** The workout's prescription rows, live and hidden, by client id. */
async function rowsOf(tx: VerifyTx, workoutPublicId: string) {
  const rows = await tx
    .select({
      id: schema.prescriptions.id,
      clientId: schema.prescriptions.clientId,
      idx: schema.prescriptions.idx,
      deletedAt: schema.prescriptions.deletedAt,
    })
    .from(schema.prescriptions)
    .innerJoin(schema.workouts, eq(schema.workouts.id, schema.prescriptions.workoutId))
    .where(eq(schema.workouts.publicId, workoutPublicId));
  return new Map(rows.map((r) => [r.clientId!, r]));
}

async function quantityRows(tx: VerifyTx, workoutPublicId: string) {
  const rows = await tx
    .select({
      id: schema.prescriptionQuantities.id,
      deletedAt: schema.prescriptionQuantities.deletedAt,
    })
    .from(schema.prescriptionQuantities)
    .innerJoin(
      schema.prescriptions,
      eq(schema.prescriptions.id, schema.prescriptionQuantities.prescriptionId),
    )
    .innerJoin(schema.workouts, eq(schema.workouts.id, schema.prescriptions.workoutId))
    .where(eq(schema.workouts.publicId, workoutPublicId));
  return { all: rows.length, live: rows.filter((r) => r.deletedAt === null).length };
}

/** Every program row the proofs can write, with its place, hide, update stamp and `ctid` (a rewrite shows as a new tuple): "nothing changed". */
async function snapshot(tx: VerifyTx) {
  const prescriptions = await tx
    .select({
      id: schema.prescriptions.id,
      idx: schema.prescriptions.idx,
      deletedAt: schema.prescriptions.deletedAt,
      updatedAt: schema.prescriptions.updatedAt,
      ctid: sql<string>`${schema.prescriptions}.ctid::text`,
    })
    .from(schema.prescriptions)
    .orderBy(schema.prescriptions.id);
  const quantities = await tx
    .select({
      id: schema.prescriptionQuantities.id,
      deletedAt: schema.prescriptionQuantities.deletedAt,
      updatedAt: schema.prescriptionQuantities.updatedAt,
      ctid: sql<string>`${schema.prescriptionQuantities}.ctid::text`,
    })
    .from(schema.prescriptionQuantities)
    .orderBy(schema.prescriptionQuantities.id);
  const workouts = await tx
    .select({
      id: schema.workouts.id,
      name: schema.workouts.name,
      updatedAt: schema.workouts.updatedAt,
      ctid: sql<string>`${schema.workouts}.ctid::text`,
    })
    .from(schema.workouts)
    .orderBy(schema.workouts.id);
  return { prescriptions, quantities, workouts };
}

async function verifySaveWorkout({ A_SCOPE, B_SCOPE }: VerifyContext): Promise<void> {
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    const { programPublicId, draft } = await seedHeavyA(tx, A_SCOPE);

    // ── a new workout saves, and the read deep-equals the contract's fixture ──
    const saved = await saveWorkout(exec, A_SCOPE, draft);
    assert.ok(saved.ok, 'FAM-1 6a-ii: saving heavy-a-draft succeeds');
    const workoutPublicId = saved.workoutPublicId;
    const read = await readWorkoutDraft(exec, A_SCOPE, { programPublicId, workoutPublicId });
    assert.deepEqual(
      normalizeFixture(read),
      normalizeFixture(heavyADraft),
      'FAM-1 6a-ii: the workout read deep-equals the heavy-a-draft fixture',
    );

    // ── a replay (the same new-workout draft) answers the same workout and adds nothing ──
    const before = {
      rows: (await rowsOf(tx, workoutPublicId)).size,
      q: await quantityRows(tx, workoutPublicId),
    };
    for (const replay of [draft, { ...draft, workoutPublicId }]) {
      assert.deepEqual(
        await saveWorkout(exec, A_SCOPE, replay),
        { ok: true, workoutPublicId },
        'FAM-1 6a-ii: a replayed saveWorkout answers the same workout',
      );
    }
    assert.equal(
      (await rowsOf(tx, workoutPublicId)).size,
      before.rows,
      'FAM-1 6a-ii: a replayed saveWorkout adds no prescription',
    );
    assert.deepEqual(
      await quantityRows(tx, workoutPublicId),
      before.q,
      'FAM-1 6a-ii: a replayed saveWorkout adds no quantity, hidden ones included',
    );

    // ── a reorder keeps every row (and so the entries logged against it); only places change ──
    const original = await rowsOf(tx, workoutPublicId);
    const items = draft.items;
    // B-group first, then A, then the lone item: every place but the last changes, and pairs swap.
    const reordered = {
      ...draft,
      workoutPublicId,
      items: [items[2]!, items[3]!, items[0]!, items[1]!, items[4]!],
    };
    assert.deepEqual(
      await saveWorkout(exec, A_SCOPE, reordered).catch((e: unknown) => ({ threw: String(e) })),
      { ok: true, workoutPublicId },
      'FAM-1 6a-ii: a reorder that swaps places saves (through the band)',
    );
    const after = await rowsOf(tx, workoutPublicId);
    for (const [index, item] of reordered.items.entries()) {
      const row = after.get(item.prescriptionClientId)!;
      assert.equal(
        row.id,
        original.get(item.prescriptionClientId)!.id,
        'FAM-1 6a-ii: a reorder keeps logged rows attached (the same prescription row)',
      );
      assert.equal(row.idx, index, 'FAM-1 6a-ii: each row takes its new place');
    }
    assert.ok(
      [...after.values()].every((r) => r.idx < SHIFT_BAND),
      'FAM-1 6a-ii: no row is left in the band',
    );
    const readBack = await readWorkoutDraft(exec, A_SCOPE, { programPublicId, workoutPublicId });
    assert.deepEqual(
      readBack?.items.map((i) => i.prescriptionClientId),
      reordered.items.map((i) => i.prescriptionClientId),
      'FAM-1 6a-ii: the read returns the new order',
    );

    // ── changing a card's item replaces its row; the editor minted a new client id ──
    const [swapFrom, swapTo] = [reordered.items[4]!, reordered.items[3]!];
    const swapped = {
      ...reordered,
      items: [
        ...reordered.items.slice(0, 4),
        {
          ...swapFrom,
          prescriptionClientId: newId(),
          itemPublicId: swapTo.itemPublicId,
          itemName: swapTo.itemName,
          trackingType: swapTo.trackingType,
          sets: 3,
          targetReps: '10',
          quantities: [],
        },
      ],
    };
    assert.ok((await saveWorkout(exec, A_SCOPE, swapped)).ok, 'FAM-1 6a-ii: a swapped item saves');
    const swappedRows = await rowsOf(tx, workoutPublicId);
    assert.ok(
      swappedRows.get(swapFrom.prescriptionClientId)?.deletedAt,
      "FAM-1 6a-ii: changing an item hides the old card's row",
    );
    assert.ok(
      swappedRows.get(swapped.items[4]!.prescriptionClientId)?.deletedAt === null,
      'FAM-1 6a-ii: changing an item writes a new row under the new client id',
    );
    const hiddenQuantities = await tx
      .select({ id: schema.prescriptionQuantities.id })
      .from(schema.prescriptionQuantities)
      .where(
        and(
          eq(
            schema.prescriptionQuantities.prescriptionId,
            swappedRows.get(swapFrom.prescriptionClientId)!.id,
          ),
          isNull(schema.prescriptionQuantities.deletedAt),
        ),
      );
    assert.equal(
      hiddenQuantities.length,
      0,
      "FAM-1 6a-ii: a removed card's quantities are hidden too",
    );
    assert.deepEqual(
      (await readWorkoutDraft(exec, A_SCOPE, { programPublicId, workoutPublicId }))?.items.map(
        (i) => i.prescriptionClientId,
      ),
      swapped.items.map((i) => i.prescriptionClientId),
      'FAM-1 6a-ii: the read leaves out a hidden card',
    );

    // ── editing a kept card persists every field; a kept card's removed target is hidden ──
    const timed = { ...swapFrom, prescriptionClientId: newId(), superset: null, restAfter: null };
    const edited = {
      ...swapped,
      items: [
        // The B pair leaves its group (superset and rest cleared on the update path).
        { ...swapped.items[0]!, superset: null, restAfter: null },
        { ...swapped.items[1]!, superset: null, restAfter: null },
        {
          ...swapped.items[2]!,
          sets: 5,
          targetReps: '6',
          notes: 'New note',
          quantities: [{ ...swapped.items[2]!.quantities[0]!, value: 35 }],
        },
        // The A pair's last item takes a new rest.
        { ...swapped.items[3]!, restAfter: 'Two minutes after each round' },
        swapped.items[4]!,
        timed,
      ],
    };
    assert.ok((await saveWorkout(exec, A_SCOPE, edited)).ok, 'FAM-1 6a-ii: an edit saves');
    assert.deepEqual(
      (await readWorkoutDraft(exec, A_SCOPE, { programPublicId, workoutPublicId }))?.items,
      edited.items,
      "FAM-1 6a-ii: an edited card's sets, reps, notes, target, superset and rest persist",
    );
    const beforeClear = await quantityRows(tx, workoutPublicId);
    const cleared = {
      ...edited,
      items: [...edited.items.slice(0, -1), { ...timed, quantities: [] }],
    };
    assert.ok(
      (await saveWorkout(exec, A_SCOPE, cleared)).ok,
      'FAM-1 6a-ii: a cleared target saves',
    );
    assert.deepEqual(
      await quantityRows(tx, workoutPublicId),
      { all: beforeClear.all, live: beforeClear.live - 1 },
      "FAM-1 6a-ii: a kept card's removed target is hidden, not deleted",
    );
    assert.deepEqual(
      (await readWorkoutDraft(exec, A_SCOPE, { programPublicId, workoutPublicId }))?.items.at(-1)
        ?.quantities,
      [],
      'FAM-1 6a-ii: the read leaves out a hidden quantity',
    );

    // ── refusals are typed results, never thrown, and write nothing ──
    const live = cleared;
    // An id in upper case is the same id (Postgres compares uuids in any case): the save is the same
    // save, and adds no row.
    const upperCase = {
      ...live,
      workoutPublicId: workoutPublicId.toUpperCase(),
      items: live.items.map((item) => ({
        ...item,
        prescriptionClientId: item.prescriptionClientId.toUpperCase(),
        itemPublicId: item.itemPublicId.toUpperCase(),
      })),
    };
    const beforeUpper = await snapshot(tx);

    assert.deepEqual(
      await saveWorkout(exec, A_SCOPE, upperCase).catch((e: unknown) => ({ threw: String(e) })),
      { ok: true, workoutPublicId },
      'FAM-1 6a-ii: ids in upper case are the same ids',
    );
    assert.deepEqual(
      (await snapshot(tx)).prescriptions.map((r) => [r.id, r.deletedAt]),
      beforeUpper.prescriptions.map((r) => [r.id, r.deletedAt]),
      'FAM-1 6a-ii: an upper-case save hides and adds no row',
    );
    const beforeReplay = await snapshot(tx);
    // A new workout's replay is found by its client id: in upper case it is still the replay.
    assert.deepEqual(
      await saveWorkout(exec, A_SCOPE, {
        ...draft,
        workoutClientId: draft.workoutClientId.toUpperCase(),
        workoutPublicId: null,
        name: live.name,
        items: live.items, // its current state: a replay changes nothing
      }).catch((e: unknown) => ({ threw: String(e) })),
      { ok: true, workoutPublicId },
      "FAM-1 6a-ii: a new workout's replay with an upper-case client id is the replay",
    );
    // ...and changes nothing. (updated_at is not compared: now() is one value in this transaction.)
    const kept = (x: Awaited<ReturnType<typeof snapshot>>) => ({
      prescriptions: x.prescriptions.map((r) => [r.id, r.idx, r.deletedAt]),
      quantities: x.quantities.map((r) => [r.id, r.deletedAt]),
    });
    assert.deepEqual(
      kept(await snapshot(tx)),
      kept(beforeReplay),
      "FAM-1 6a-ii: a new workout's upper-case replay hides, moves and adds nothing",
    );
    const other = await saveWorkout(exec, A_SCOPE, {
      ...draft,
      workoutClientId: newId(),
      name: 'Light A',
      items: [],
    });
    assert.ok(other.ok, 'FAM-1 6a-ii: a second workout saves');
    const bProgram = await mustCreate(tx, B_SCOPE, 'Theirs');
    const bWorkout = await saveWorkout(exec, B_SCOPE, {
      ...draft,
      programPublicId: bProgram,
      workoutClientId: newId(),
      name: 'Their workout',
      items: [],
    });
    assert.ok(bWorkout.ok, "FAM-1 6a-ii: household B's own workout saves");
    const aOther = await mustCreate(tx, A_SCOPE, 'Other A program');
    const aOtherWorkout = await saveWorkout(exec, A_SCOPE, {
      ...draft,
      programPublicId: aOther,
      workoutClientId: newId(),
      name: 'Other workout',
      items: [],
    });
    assert.ok(aOtherWorkout.ok, "FAM-1 6a-ii: a workout of A's other program saves");
    const plank = newId();
    await insertMovementOwnedBy(exec, A_SCOPE, {
      publicId: plank,
      slug: 'fam-1-6a-ii-plank',
      name: 'Plank hold',
      isBodyweight: false,
      trackingType: TRACKING_TYPE.duration,
    });
    const bItem = newId();
    await insertMovementOwnedBy(exec, B_SCOPE, {
      publicId: bItem,
      slug: 'fam-1-6a-ii-theirs',
      name: 'Their item',
      isBodyweight: false,
      trackingType: live.items[4]!.trackingType,
    });
    // Single items with no superset, so each case is refused for its own reason and no other.
    const solo = <T extends (typeof live.items)[number]>(item: T) => ({
      ...item,
      superset: null,
      restAfter: null,
    });
    const weighted = solo(live.items[2]!); // dbbench: Weight × reps, a known card
    const reps = solo(live.items[4]!); // the swapped-in Reps item, a known card
    const timedCard = solo(live.items[5]!); // Time per set, a known card
    const duration = {
      ...reps,
      prescriptionClientId: newId(),
      itemPublicId: plank,
      itemName: 'Plank hold',
      trackingType: TRACKING_TYPE.duration,
      sets: null,
      targetReps: null,
    };
    const only = (...its: unknown[]) => ({ ...live, items: its });
    const cases: Array<[string, unknown, string]> = [
      ['an empty name', { ...live, name: '' }, PROGRAM_REFUSAL.invalid],
      [
        'two cards whose ids differ only in case',
        only(reps, { ...reps, prescriptionClientId: reps.prescriptionClientId.toUpperCase() }),
        PROGRAM_REFUSAL.invalid,
      ],
      ['a set-based item with no sets', only({ ...reps, sets: null }), PROGRAM_REFUSAL.invalid],
      [
        'reps that are not a whole number',
        only({ ...reps, targetReps: '8-12' }),
        PROGRAM_REFUSAL.invalid,
      ],
      [
        'reps over the cap',
        only({ ...reps, targetReps: String(MAX_REPS_PER_SET + 1) }),
        PROGRAM_REFUSAL.invalid,
      ],
      [
        'a quantity on a type with none',
        only({ ...reps, quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'lb', value: 5 }] }),
        PROGRAM_REFUSAL.invalid,
      ],
      [
        'a quantity in the wrong unit',
        only({ ...weighted, quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'sec', value: 5 }] }),
        PROGRAM_REFUSAL.invalid,
      ],
      [
        'a superset of one',
        only({ ...reps, superset: { group: 'z', order: 1 } }),
        PROGRAM_REFUSAL.invalid,
      ],
      [
        'a split superset (two runs under one key)',
        only(
          live.items[2]!,
          live.items[3]!,
          reps,
          { ...live.items[0]!, superset: { group: live.items[2]!.superset!.group, order: 1 } },
          { ...live.items[1]!, superset: { group: live.items[2]!.superset!.group, order: 2 } },
        ),
        PROGRAM_REFUSAL.invalid,
      ],
      [
        'a misnumbered superset',
        only(
          { ...live.items[2]!, superset: { ...live.items[2]!.superset!, order: 2 } },
          { ...live.items[3]!, superset: { ...live.items[3]!.superset!, order: 1 } },
        ),
        PROGRAM_REFUSAL.invalid,
      ],
      [
        'a Duration prescribed in seconds',
        only({
          ...duration,
          quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'sec', value: 30 }],
        }),
        PROGRAM_REFUSAL.invalid,
      ],
      [
        'a Time per set prescribed in minutes',
        only({
          ...timedCard,
          quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'min', value: 1 }],
        }),
        PROGRAM_REFUSAL.invalid,
      ],
      [
        "a target over its unit's ceiling",
        only({ ...weighted, quantities: [{ ...weighted.quantities[0]!, value: 99_999 }] }),
        PROGRAM_REFUSAL.invalid,
      ],
      [
        'a rest on a non-last item',
        only({ ...live.items[2]!, restAfter: 'Rest' }, live.items[3]!),
        PROGRAM_REFUSAL.invalid,
      ],
      [
        "a type that is not the item's own",
        only({ ...weighted, trackingType: TRACKING_TYPE.reps, quantities: [] }),
        PROGRAM_REFUSAL.invalid,
      ],
      [
        'a known client id under another item',
        only({
          ...weighted,
          itemPublicId: reps.itemPublicId,
          itemName: reps.itemName,
          trackingType: reps.trackingType,
          quantities: [],
        }),
        PROGRAM_REFUSAL.invalid,
      ],
      ["a removed card's client id", only(reps, solo(swapFrom)), PROGRAM_REFUSAL.invalid],
      [
        "another household's program",
        { ...live, programPublicId: bProgram },
        PROGRAM_REFUSAL.not_found,
      ],
      ['an unknown workout', { ...live, workoutPublicId: newId() }, PROGRAM_REFUSAL.not_found],
      [
        "another household's workout, in A's program",
        { ...live, workoutPublicId: bWorkout.ok ? bWorkout.workoutPublicId : '' },
        PROGRAM_REFUSAL.not_found,
      ],
      [
        "a workout of A's other program",
        { ...live, workoutPublicId: aOtherWorkout.ok ? aOtherWorkout.workoutPublicId : '' },
        PROGRAM_REFUSAL.not_found,
      ],
      [
        'an unknown item',
        only({ ...reps, prescriptionClientId: newId(), itemPublicId: newId() }),
        PROGRAM_REFUSAL.not_found,
      ],
      [
        "another household's item",
        only({
          ...reps,
          prescriptionClientId: newId(),
          itemPublicId: bItem,
          itemName: 'Their item',
        }),
        PROGRAM_REFUSAL.not_found,
      ],
      ["another workout's name, folded", { ...live, name: 'light  A' }, PROGRAM_REFUSAL.name_taken],
    ];
    const settled = await snapshot(tx);
    for (const [what, input, reason] of cases) {
      assert.deepEqual(
        await saveWorkout(exec, A_SCOPE, input).catch((e: unknown) => ({ threw: String(e) })),
        { ok: false, reason },
        `FAM-1 6a-ii: saving ${what} is ${reason}`,
      );
    }
    assert.deepEqual(
      await snapshot(tx),
      settled,
      'FAM-1 6a-ii: a refused save writes nothing (every row, place and tuple as it was)',
    );

    // ── another household: B cannot save into A's workout, nor read it ──
    assert.deepEqual(
      await saveWorkout(exec, B_SCOPE, live),
      { ok: false, reason: PROGRAM_REFUSAL.not_found },
      "FAM-1 6a-ii: household B saving A's workout is not_found",
    );
    assert.equal(
      await readWorkoutDraft(exec, B_SCOPE, { programPublicId, workoutPublicId }),
      null,
      "FAM-1 6a-ii: household B reads nothing of A's workout",
    );

    // ── removing every card hides every row; the workout stays, empty ──
    assert.ok(
      (await saveWorkout(exec, A_SCOPE, { ...live, items: [] })).ok,
      'FAM-1 6a-ii: an empty save',
    );
    assert.ok(
      [...(await rowsOf(tx, workoutPublicId)).values()].every((r) => r.deletedAt !== null),
      'FAM-1 6a-ii: removed cards are hidden, never deleted',
    );
    assert.equal(
      (await quantityRows(tx, workoutPublicId)).live,
      0,
      'FAM-1 6a-ii: and so are their quantities',
    );
    assert.deepEqual(
      (await readWorkoutDraft(exec, A_SCOPE, { programPublicId, workoutPublicId }))?.items,
      [],
      'FAM-1 6a-ii: an emptied workout reads back with no items',
    );

    // ── programIn / workoutIn: scoped existence, the same `false` for every miss ──
    assert.equal(
      await programIn(exec, A_SCOPE, programPublicId),
      true,
      'FAM-1 6a-ii: programIn finds its own program',
    );
    assert.equal(
      await programIn(exec, B_SCOPE, programPublicId),
      false,
      "FAM-1 6a-ii: programIn: B does not find A's program",
    );
    assert.equal(
      await programIn(exec, A_SCOPE, 'not-a-uuid'),
      false,
      'FAM-1 6a-ii: programIn: a malformed id is false',
    );
    assert.equal(
      await workoutIn(exec, A_SCOPE, programPublicId, workoutPublicId),
      true,
      'FAM-1 6a-ii: workoutIn finds its own workout',
    );
    assert.equal(
      await workoutIn(exec, B_SCOPE, programPublicId, workoutPublicId),
      false,
      "FAM-1 6a-ii: workoutIn: B does not find A's workout",
    );
    assert.equal(
      await workoutIn(exec, A_SCOPE, aOther, workoutPublicId),
      false,
      'FAM-1 6a-ii: workoutIn: a workout under another program of the household is false',
    );
  });
  console.log(
    '✓ FAM-1 6a-ii: saveWorkout (fixture read, replay, reorder, swap, refusals, households)',
  );
}

/**
 * `workoutInHousehold` (for 7a-ii's copy and 12b's day page): a live workout of any of this
 * household's live programs is `true`; every miss is the same `false`.
 */
async function verifyWorkoutInHousehold({ A_SCOPE, B_SCOPE }: VerifyContext): Promise<void> {
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    const workoutOf = async (scope: HouseholdScope, programPublicId: string, name: string) => {
      const saved = await saveWorkout(exec, scope, {
        programPublicId,
        workoutPublicId: null,
        workoutClientId: newId(),
        name,
        description: null,
        items: [],
      });
      assert.ok(saved.ok, `workoutInHousehold: saving the workout "${name}" succeeds`);
      return saved.workoutPublicId;
    };
    const first = await mustCreate(tx, A_SCOPE, 'First program');
    const second = await mustCreate(tx, A_SCOPE, 'Second program');
    const mine = await workoutOf(A_SCOPE, first, 'Heavy A');
    const alsoMine = await workoutOf(A_SCOPE, second, 'Heavy B');
    const theirs = await workoutOf(
      B_SCOPE,
      await mustCreate(tx, B_SCOPE, 'B program'),
      'B workout',
    );
    const hiddenWorkout = await workoutOf(A_SCOPE, first, 'Gone');
    await tx
      .update(schema.workouts)
      .set({ deletedAt: sql`now()` })
      .where(eq(schema.workouts.publicId, hiddenWorkout));
    const hiddenProgram = await mustCreate(tx, A_SCOPE, 'Hidden program');
    const inHiddenProgram = await workoutOf(A_SCOPE, hiddenProgram, 'Orphan');
    await hide(tx, hiddenProgram);
    // A workout planted under the seeded LEGACY block with a raw insert (the writers refuse to put
    // one there): the read is template blocks only, not merely the household's live blocks.
    const legacy = await seededBlock(tx, A_SCOPE);
    const [legacyBlock] = await tx
      .select({ id: schema.programBlocks.id })
      .from(schema.programBlocks)
      .where(eq(schema.programBlocks.publicId, legacy.publicId));
    const onLegacy = newId();
    await tx
      .insert(schema.workouts)
      .values({ publicId: onLegacy, clientId: newId(), blockId: legacyBlock!.id, name: 'Planted' });

    const cases: Array<[string, HouseholdScope, string, boolean]> = [
      ['its own workout', A_SCOPE, mine, true],
      ['a workout of another of its programs', A_SCOPE, alsoMine, true],
      ['its own workout, the id in upper case', A_SCOPE, mine.toUpperCase(), true],
      ["another household's workout", A_SCOPE, theirs, false],
      ["A's workout, asked by B", B_SCOPE, mine, false],
      ['a hidden workout', A_SCOPE, hiddenWorkout, false],
      ['a workout of a hidden program', A_SCOPE, inHiddenProgram, false],
      ['a workout on the legacy block', A_SCOPE, onLegacy, false],
      ['an unknown id', A_SCOPE, newId(), false],
      ['a malformed id', A_SCOPE, 'not-a-uuid', false],
    ];
    for (const [what, scope, id, expected] of cases) {
      assert.equal(
        await workoutInHousehold(exec, scope, id),
        expected,
        `FAM-1 workoutInHousehold: ${what} is ${expected}`,
      );
    }
  });
  console.log('✓ FAM-1 workoutInHousehold: live workouts of the household only, any program');
}

/** A workout with no items in `programPublicId`, which must save; its public id. */
async function mustSaveWorkout(
  tx: VerifyTx,
  scope: HouseholdScope,
  programPublicId: string,
  name: string,
) {
  const saved = await saveWorkout(asTx(tx), scope, {
    programPublicId,
    workoutPublicId: null,
    workoutClientId: newId(),
    name,
    description: null,
    items: [],
  });
  assert.ok(saved.ok, `FAM-1 6b: saving the workout "${name}" succeeds`);
  return saved.workoutPublicId;
}

/**
 * Every week slot row, live and hidden, with its place and label, and its `ctid`: any UPDATE writes
 * a new tuple version, so a rewrite with the same values is seen (`updated_at` cannot see one, since
 * `now()` is one value inside `rolledBack`'s transaction; lessons.md).
 */
async function slotRows(tx: VerifyTx) {
  return tx
    .select({
      id: schema.blockDayWorkouts.id,
      blockId: schema.blockDayWorkouts.blockId,
      weekday: schema.blockDayWorkouts.weekday,
      idx: schema.blockDayWorkouts.idx,
      workoutId: schema.blockDayWorkouts.workoutId,
      label: schema.blockDayWorkouts.label,
      deletedAt: schema.blockDayWorkouts.deletedAt,
      ctid: sql<string>`${schema.blockDayWorkouts}.ctid::text`,
    })
    .from(schema.blockDayWorkouts)
    .orderBy(schema.blockDayWorkouts.id);
}

/** A week with every day a rest day, then the days given. */
const weekOf = (days: Partial<WeekDraft['days']> = {}): WeekDraft['days'] => ({
  ...emptyWeek(),
  ...days,
});

const slot = (workoutPublicId: string, label: string | null = null) => ({ workoutPublicId, label });

async function verifySaveWeek({ A_SCOPE, B_SCOPE }: VerifyContext): Promise<void> {
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    const tryIt = (scope: HouseholdScope, input: unknown) =>
      saveWeek(exec, scope, input).catch((e: unknown) => ({ threw: String(e) }));

    // Neighbours with weeks of their own, saved first: no save below may touch their slots.
    const other = await mustCreate(tx, A_SCOPE, 'Other program');
    const otherWorkout = await mustSaveWorkout(tx, A_SCOPE, other, 'Their workout');
    const theirs = await mustCreate(tx, B_SCOPE, 'B program');
    const theirWorkout = await mustSaveWorkout(tx, B_SCOPE, theirs, 'B workout');
    for (const [scope, program, workout] of [
      [A_SCOPE, other, otherWorkout],
      [B_SCOPE, theirs, theirWorkout],
    ] as const) {
      assert.deepEqual(
        await tryIt(scope, { programPublicId: program, days: weekOf({ 1: [slot(workout)] }) }),
        { ok: true },
        'FAM-1 6b: a neighbouring program saves its own week',
      );
    }
    const neighbours = await slotRows(tx);

    const programPublicId = await mustCreate(tx, A_SCOPE, 'Week program');
    const a = await mustSaveWorkout(tx, A_SCOPE, programPublicId, 'Heavy A');
    const b = await mustSaveWorkout(tx, A_SCOPE, programPublicId, 'Heavy B');
    const c = await mustSaveWorkout(tx, A_SCOPE, programPublicId, 'Mobility');
    const save = (days: WeekDraft['days']) => tryIt(A_SCOPE, { programPublicId, days });
    const readBack = async () => {
      const days = await readWeek(exec, A_SCOPE, programPublicId);
      assert.ok(
        days && weekDaysSchema.safeParse(days).success,
        'FAM-1 6b: the read is a WeekDraft week',
      );
      return days;
    };
    const ours = async () => {
      const [block] = await tx
        .select({ id: schema.programBlocks.id })
        .from(schema.programBlocks)
        .where(eq(schema.programBlocks.publicId, programPublicId));
      return (await slotRows(tx)).filter((r) => r.blockId === block!.id);
    };
    const liveOn = async (weekday: number) =>
      (await ours())
        .filter((r) => r.deletedAt === null && r.weekday === weekday)
        .sort((x, y) => x.idx - y.idx);

    const noneInBand = async (after: string) =>
      assert.ok(
        (await ours()).every((r) => r.deletedAt !== null || r.idx < SHIFT_BAND),
        `FAM-1 6b: no slot is left in the band after ${after}`,
      );

    // ── a new program's week is seven rest days ──
    assert.deepEqual(await readBack(), weekOf(), 'FAM-1 6b: a new program reads seven rest days');

    // ── a week saves, and reads back as saved ──
    const week = weekOf({
      1: [slot(a, 'Morning'), slot(b)],
      2: [slot(a), slot(b), slot(c)],
      3: [slot(a)],
      4: [slot(a), slot(b)],
      5: [slot(c, 'After practice')],
    });
    assert.deepEqual(await save(week), { ok: true }, 'FAM-1 6b: saving a week succeeds');
    assert.deepEqual(await readBack(), week, 'FAM-1 6b: the week reads back as saved');

    // ── a replay writes nothing ──
    const before = await slotRows(tx);
    assert.deepEqual(await save(week), { ok: true }, 'FAM-1 6b: a replayed saveWeek succeeds');
    assert.deepEqual(await slotRows(tx), before, 'FAM-1 6b: a replayed saveWeek writes nothing');

    // ── a swap keeps both rows; a moved slot takes its new label ──
    const [wasFirst, wasSecond] = await liveOn(1);
    const swapped = weekOf({ ...week, 1: [slot(b, 'Evening'), slot(a, 'Morning')] });
    assert.deepEqual(
      await save(swapped),
      { ok: true },
      'FAM-1 6b: a week that swaps two slots saves (through the band)',
    );
    assert.deepEqual(
      (await liveOn(1)).map((r) => [r.id, r.idx, r.label]),
      [
        [wasSecond!.id, 0, 'Evening'],
        [wasFirst!.id, 1, 'Morning'],
      ],
      'FAM-1 6b: a moved slot keeps its row and takes its new label',
    );
    await noneInBand('a swap');

    // ── a partial reorder moves only the slots it moves, each to its exact place ──
    const [x, y, z] = await liveOn(2);
    const partial = weekOf({ ...swapped, 2: [slot(a), slot(c), slot(b)] });
    assert.deepEqual(await save(partial), { ok: true }, 'FAM-1 6b: a partial reorder saves');
    assert.deepEqual(
      (await liveOn(2)).map((r) => [r.id, r.idx]),
      [
        [x!.id, 0],
        [z!.id, 1],
        [y!.id, 2],
      ],
      'FAM-1 6b: a partial reorder places every slot exactly',
    );
    await noneInBand('a partial reorder');

    // ── a new slot put in front of a kept one, in one save: the kept one moves out of its place first ──
    const sundayOne = weekOf({ ...partial, 0: [slot(a)] });
    assert.deepEqual(await save(sundayOne), { ok: true }, 'FAM-1 6b: a one-slot Sunday saves');
    const [sundayA] = await liveOn(0);
    const sundayTwo = weekOf({ ...partial, 0: [slot(b), slot(a)] });
    assert.deepEqual(
      await save(sundayTwo),
      { ok: true },
      'FAM-1 6b: a slot added in front of a kept one saves (the kept one moves first)',
    );
    const sunday = await liveOn(0);
    assert.deepEqual(
      sunday.map((r) => [r.id === sundayA!.id, r.idx]),
      [
        [false, 0],
        [true, 1],
      ],
      'FAM-1 6b: the kept slot keeps its row at its new place, and the added one is a new row',
    );

    // ── a moved or relabelled slot is stamped; an untouched one is not ──
    const old = new Date('2000-01-01T00:00:00Z');
    const ourBlock = sunday[0]!.blockId;
    await tx
      .update(schema.blockDayWorkouts)
      .set({ updatedAt: old })
      .where(eq(schema.blockDayWorkouts.blockId, ourBlock));
    const restSunday = weekOf({ ...partial, 0: [slot(a, 'Easy'), slot(b)] });
    assert.deepEqual(await save(restSunday), { ok: true }, 'FAM-1 6b: reordering Sunday saves');
    const stamped = (await liveOn(0)).map((r) => r.id);
    const stamps = await tx
      .select({ id: schema.blockDayWorkouts.id, updatedAt: schema.blockDayWorkouts.updatedAt })
      .from(schema.blockDayWorkouts)
      .where(
        and(
          eq(schema.blockDayWorkouts.blockId, ourBlock),
          isNull(schema.blockDayWorkouts.deletedAt),
        ),
      );
    assert.ok(
      stamps.every((r) =>
        stamped.includes(r.id) ? r.updatedAt > old : r.updatedAt.getTime() === old.getTime(),
      ),
      'FAM-1 6b: a moved slot is stamped with updated_at, and an untouched one is not',
    );

    // ── a label change keeps the row ──
    const friday = (await liveOn(5))[0]!;
    const relabelled = weekOf({ ...restSunday, 5: [slot(c, 'Late')] });
    assert.deepEqual(await save(relabelled), { ok: true }, 'FAM-1 6b: relabelling a slot saves');
    assert.deepEqual(
      (await liveOn(5)).map((r) => [r.id, r.label]),
      [[friday.id, 'Late']],
      'FAM-1 6b: a relabelled slot keeps its row, with the new label',
    );
    const [fridayStamp] = await tx
      .select({ updatedAt: schema.blockDayWorkouts.updatedAt })
      .from(schema.blockDayWorkouts)
      .where(eq(schema.blockDayWorkouts.id, friday.id));
    assert.ok(
      fridayStamp!.updatedAt > old,
      'FAM-1 6b: a slot only relabelled is stamped with updated_at too',
    );

    // ── one save takes a slot off and fills its place ──
    const [thursdayA, thursdayB] = await liveOn(4);
    const replaced = weekOf({ ...relabelled, 4: [slot(c), slot(b)] });
    assert.deepEqual(
      await save(replaced),
      { ok: true },
      'FAM-1 6b: replacing a slot in one save frees its place first',
    );
    const thursday = await liveOn(4);
    assert.equal(
      thursday[1]!.id,
      thursdayB!.id,
      'FAM-1 6b: the slot beside a replaced one keeps its row',
    );
    assert.ok(thursday[0]!.id !== thursdayA!.id, 'FAM-1 6b: a replacing slot is a new row');
    const closedUp = weekOf({ ...replaced, 4: [slot(b)] });
    assert.deepEqual(
      await save(closedUp),
      { ok: true },
      'FAM-1 6b: a slot moves into the place a removed one freed, in one save',
    );
    assert.deepEqual(
      (await liveOn(4)).map((r) => [r.id, r.idx]),
      [[thursdayB!.id, 0]],
      'FAM-1 6b: the kept slot moves up into the freed place',
    );
    assert.deepEqual(await readBack(), closedUp, 'FAM-1 6b: the closed-up week reads back');

    // ── a removed slot is hidden, and its workout can come back to that day as a new slot ──
    const wednesday = (await liveOn(3))[0]!;
    const cleared = weekOf({ ...closedUp, 3: [] });
    assert.deepEqual(await save(cleared), { ok: true }, 'FAM-1 6b: removing a slot saves');
    const hidden = (await slotRows(tx)).find((r) => r.id === wednesday.id)!;
    assert.ok(hidden.deletedAt !== null, 'FAM-1 6b: a removed slot is hidden, not deleted');
    assert.deepEqual(await readBack(), cleared, 'FAM-1 6b: the read leaves out a removed slot');
    const refilled = weekOf({ ...cleared, 3: [slot(c), slot(a)] });
    assert.deepEqual(
      await save(refilled),
      { ok: true },
      'FAM-1 6b: a removed slot frees its place and its once-a-day key',
    );
    assert.ok(
      (await liveOn(3)).every((r) => r.id !== wednesday.id),
      'FAM-1 6b: a workout put back on a day is a new slot',
    );
    assert.deepEqual(await readBack(), refilled, 'FAM-1 6b: the refilled week reads back');

    // ── ids in upper case are the same ids ──
    const upper = (days: WeekDraft['days']) =>
      Object.fromEntries(
        Object.entries(days).map(([d, slots]) => [
          d,
          slots.map((s) => ({ ...s, workoutPublicId: s.workoutPublicId.toUpperCase() })),
        ]),
      ) as WeekDraft['days'];
    const stamp = await slotRows(tx);
    assert.deepEqual(
      await tryIt(A_SCOPE, {
        programPublicId: programPublicId.toUpperCase(),
        days: upper(refilled),
      }),
      { ok: true },
      'FAM-1 6b: ids in upper case are the same ids',
    );
    assert.deepEqual(
      await slotRows(tx),
      stamp,
      'FAM-1 6b: the same week in upper case writes nothing',
    );
    assert.deepEqual(
      await readWeek(exec, A_SCOPE, programPublicId.toUpperCase()),
      refilled,
      'FAM-1 6b: the read takes an upper-case id',
    );

    // ── refusals: typed, and nothing written ──
    const hiddenProgram = await mustCreate(tx, A_SCOPE, 'Hidden program');
    await hide(tx, hiddenProgram);
    const legacy = await seededBlock(tx, A_SCOPE);
    const rest = weekOf();
    const cases: Array<[string, unknown, string]> = [
      [
        'a workout twice on one day',
        { programPublicId, days: weekOf({ 2: [slot(a), slot(a, 'Again')] }) },
        PROGRAM_REFUSAL.once_per_day,
      ],
      [
        'a workout twice on one day, the second id in upper case',
        { programPublicId, days: weekOf({ 2: [slot(a), slot(a.toUpperCase())] }) },
        PROGRAM_REFUSAL.once_per_day,
      ],
      [
        'a workout twice on one day and a label over SLOT_LABEL_MAX (as the fake answers)',
        {
          programPublicId,
          days: weekOf({ 2: [slot(a), slot(a)], 3: [slot(b, 'x'.repeat(SLOT_LABEL_MAX + 1))] }),
        },
        PROGRAM_REFUSAL.once_per_day,
      ],
      [
        'a workout twice on one day and a missing day (as the fake answers)',
        {
          programPublicId,
          days: Object.fromEntries(
            WEEKDAYS.slice(1).map((d) => [d, d === 2 ? [slot(a), slot(a)] : []]),
          ),
        },
        PROGRAM_REFUSAL.once_per_day,
      ],
      [
        "another program's workout",
        { programPublicId, days: weekOf({ 2: [slot(otherWorkout)] }) },
        PROGRAM_REFUSAL.not_found,
      ],
      [
        "another household's workout",
        { programPublicId, days: weekOf({ 2: [slot(theirWorkout)] }) },
        PROGRAM_REFUSAL.not_found,
      ],
      [
        'a workout that does not exist',
        { programPublicId, days: weekOf({ 2: [slot(newId())] }) },
        PROGRAM_REFUSAL.not_found,
      ],
      [
        "another household's program",
        { programPublicId: theirs, days: rest },
        PROGRAM_REFUSAL.not_found,
      ],
      [
        'a hidden program',
        { programPublicId: hiddenProgram, days: rest },
        PROGRAM_REFUSAL.not_found,
      ],
      [
        'the seeded legacy block',
        { programPublicId: legacy.publicId, days: rest },
        PROGRAM_REFUSAL.not_found,
      ],
      [
        'a program that does not exist',
        { programPublicId: newId(), days: rest },
        PROGRAM_REFUSAL.not_found,
      ],
      [
        'a week missing a day',
        { programPublicId, days: Object.fromEntries(WEEKDAYS.slice(1).map((d) => [d, []])) },
        PROGRAM_REFUSAL.invalid,
      ],
      [
        'a label over SLOT_LABEL_MAX',
        { programPublicId, days: weekOf({ 2: [slot(a, 'x'.repeat(SLOT_LABEL_MAX + 1))] }) },
        PROGRAM_REFUSAL.invalid,
      ],
      [
        'a label with a control character',
        { programPublicId, days: weekOf({ 2: [slot(a, 'Morn\u0007ing')] }) },
        PROGRAM_REFUSAL.invalid,
      ],
      [
        'a program id that is not a uuid',
        { programPublicId: 'nope', days: rest },
        PROGRAM_REFUSAL.invalid,
      ],
    ];
    const unchanged = await slotRows(tx);
    for (const [what, input, reason] of cases) {
      assert.deepEqual(
        await tryIt(A_SCOPE, input),
        { ok: false, reason },
        `FAM-1 6b: saving ${what} is ${reason}`,
      );
    }
    assert.deepEqual(await slotRows(tx), unchanged, 'FAM-1 6b: a refused week writes nothing');

    // ── a hidden workout: left out of the read, refused on the week, its slot hidden by a save ──
    const d = await mustSaveWorkout(tx, A_SCOPE, programPublicId, 'Sprints');
    const withD = weekOf({ ...refilled, 6: [slot(d, 'Saturday')] });
    assert.deepEqual(
      await save(withD),
      { ok: true },
      'FAM-1 6b: a week with a fourth workout saves',
    );
    const dSlot = (await liveOn(6))[0]!;
    await tx
      .update(schema.workouts)
      .set({ deletedAt: sql`now()` })
      .where(eq(schema.workouts.publicId, d));
    assert.deepEqual(
      await readBack(),
      refilled,
      "FAM-1 6b: the read leaves out a hidden workout's slot",
    );
    const beforeHidden = await slotRows(tx);
    assert.deepEqual(
      await save(withD),
      { ok: false, reason: PROGRAM_REFUSAL.not_found },
      'FAM-1 6b: a hidden workout on the week is not_found',
    );
    assert.deepEqual(
      await slotRows(tx),
      beforeHidden,
      'FAM-1 6b: a refused hidden workout writes nothing',
    );
    assert.deepEqual(
      await save(refilled),
      { ok: true },
      'FAM-1 6b: saving the week as read succeeds',
    );
    assert.ok(
      (await slotRows(tx)).find((r) => r.id === dSlot.id)!.deletedAt !== null,
      "FAM-1 6b: saving the week as read hides a hidden workout's slot",
    );

    // ── the neighbours' weeks are as they were ──
    const neighbourIds = new Set(neighbours.map((r) => r.id));
    assert.deepEqual(
      (await slotRows(tx)).filter((r) => neighbourIds.has(r.id)),
      neighbours,
      "FAM-1 6b: other programs' weeks, in both households, are untouched",
    );

    // ── the read is scoped ──
    assert.equal(
      await readWeek(exec, B_SCOPE, programPublicId),
      null,
      "FAM-1 6b: another household's program reads null",
    );
    assert.equal(
      await readWeek(exec, A_SCOPE, 'nope'),
      null,
      'FAM-1 6b: a malformed id reads null',
    );
    assert.equal(
      await readWeek(exec, A_SCOPE, hiddenProgram),
      null,
      'FAM-1 6b: a hidden program reads null',
    );
    assert.equal(
      await readWeek(exec, A_SCOPE, legacy.publicId),
      null,
      'FAM-1 6b: the seeded legacy block reads null',
    );
  });
  console.log(
    '✓ FAM-1 6b: saveWeek and readWeek (read back, replay, swap, partial reorder, replace, removed slot, hidden workout, refusals, neighbours)',
  );
}

/**
 * `movementOptions` (the picker's read) and `newItem` (FAM-1 6a-iii-a; contract change C8). The read
 * lists every live catalog row the picker map names and every live household item no catalog slug
 * shadows, used or not (maintainer, 2026-11-17). `newItem` selects what that list already names, by
 * name key or alias, and answers with the item's stored name and own type.
 */
async function verifyMovementOptionsAndNewItem({ A_SCOPE, B_SCOPE }: VerifyContext): Promise<void> {
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    const own = async (
      scope: HouseholdScope,
      name: string,
      trackingType: TrackingType = TRACKING_TYPE.reps,
    ) => {
      const publicId = newId();
      await insertMovementOwnedBy(exec, scope, {
        publicId,
        slug: movementSlug(name),
        name,
        isBodyweight: false,
        trackingType,
      });
      return publicId;
    };
    const rows = async () =>
      (await tx.select({ id: schema.movements.id }).from(schema.movements)).length;

    const hop = await own(A_SCOPE, 'Garden Hop Drill', TRACKING_TYPE.distance);
    const theirs = await own(B_SCOPE, 'Porch Step Hold');
    const gone = await own(A_SCOPE, 'Yard Cone Weave');
    await tx
      .update(schema.movements)
      .set({ deletedAt: sql`now()` })
      .where(eq(schema.movements.publicId, gone));
    // A household row under a catalog slug: the resolver is global-first, so it never answers a name.
    const catalogSeed = MOVEMENT_SEED_ROWS[0]!;
    const shadowed = newId();
    await insertMovementOwnedBy(exec, A_SCOPE, {
      publicId: shadowed,
      slug: catalogSeed.slug,
      name: `${catalogSeed.name} (ours)`,
      isBodyweight: false,
    });

    // A household "RDL" made before the alias rule, beside the catalog's Romanian Deadlift (alias
    // `RDL`): since C30 an item's own name ranks before another item's alias, so `RDL` is the
    // household's own item in this household.
    const ourRdl = await own(A_SCOPE, 'RDL');
    // A household name with the catalog name's key but another slug (so not shadowed), that sorts
    // first by name: only `isCatalog` puts the catalog's row first, as the picker does.
    await own(A_SCOPE, 'Romanian Dead-lift');
    // Two names whose code-point order and folded order differ ('Z' sorts before 'a' in C collation).
    const zebra = await own(A_SCOPE, 'Zebra Step Drill');
    const apple = await own(A_SCOPE, 'apple Reach Drill');

    // ── the read ──
    const options = await movementOptions(exec, A_SCOPE);
    const ids = options.map((o) => o.publicId);
    const catalog = options.filter((o) => o.owner === 'catalog');
    assert.equal(
      catalog.length,
      Object.keys(MOVEMENT_PICKER_ENTRIES).length,
      'FAM-1 6a-iii-a: the read lists every catalog row the picker map names',
    );
    const rdl = catalog.find((o) => o.owner === 'catalog' && o.aliases.includes('RDL'));
    assert.ok(rdl, 'FAM-1 6a-iii-a: a catalog row carries its aliases');
    const ohp = catalog.find((o) => o.owner === 'catalog' && o.aliases.includes('OHP'));
    assert.ok(ohp, 'FAM-1 6a-iii-a: the catalog has the OHP alias the proof uses');
    const boxJump = MOVEMENT_SEED_ROWS.find((r) => r.slug === 'box_jump')!;
    const { publicId: _boxId, ...boxOption } = catalog.find((o) => o.name === boxJump.name)!;
    assert.deepEqual(
      boxOption,
      {
        name: boxJump.name,
        unitDefault: boxJump.unitDefault,
        isBodyweight: boxJump.isBodyweight,
        trackingType: boxJump.trackingType,
        owner: 'catalog',
        group: MOVEMENT_PICKER_ENTRIES.box_jump.group,
        aliases: MOVEMENT_PICKER_ENTRIES.box_jump.aliases ?? [],
        slug: boxJump.slug,
      },
      "FAM-1 6a-iii-a: a catalog option carries its row's declaration and the picker map's group and aliases",
    );
    assert.ok(ids.includes(hop), 'FAM-1 6a-iii-a: an unused household item is listed');
    assert.ok(
      options.every((o) => (o.owner === 'catalog') === 'slug' in o),
      'FAM-1 P11-i: a catalog option carries its slug, and a household option never does',
    );
    assert.equal(
      options.find((o) => o.publicId === hop)?.trackingType,
      TRACKING_TYPE.distance,
      "FAM-1 6a-iii-a: an option carries its item's own tracking type",
    );
    assert.ok(!ids.includes(gone), 'FAM-1 6a-iii-a: a hidden household item is not listed');
    assert.ok(!ids.includes(theirs), "FAM-1 6a-iii-a: another household's item is not listed");
    assert.ok(
      !ids.includes(shadowed),
      'FAM-1 6a-iii-a: a household item a catalog row shadows is not listed',
    );
    const folded = (xs: readonly { name: string }[]) =>
      xs.every(
        (o, i) => i === 0 || foldMovementQuery(xs[i - 1]!.name) <= foldMovementQuery(o.name),
      );
    const household = options.filter((o) => o.owner === 'household');
    assert.ok(
      folded(catalog) &&
        folded(household) &&
        options.findIndex((o) => o.owner === 'household') >= catalog.length,
      'FAM-1 6a-iii-a: catalog rows come first, each part by its folded name',
    );
    assert.ok(
      ids.indexOf(apple) < ids.indexOf(zebra),
      'FAM-1 6a-iii-a: household items are ordered by folded name, whatever the collation',
    );
    assert.ok(
      ids.includes(ourRdl),
      'FAM-1 6a-iii-a: a household item named like an alias is listed',
    );

    // ── newItem selects what the list already names ──
    const selects: Array<[string, string, string, string]> = [
      ['an alias', 'ohp', ohp.publicId, ohp.name],
      ["the household's own item named like a catalog alias (C30)", 'rdl', ourRdl, 'RDL'],
      ['a catalog name a household item ties with', 'romanian deadlift', rdl.publicId, rdl.name],
      ['a re-spelled household name', ' garden-hop drill ', hop, 'Garden Hop Drill'],
      [
        'a catalog name in another case',
        catalogSeed.name.toUpperCase(),
        catalog.find((o) => o.name === catalogSeed.name)!.publicId,
        catalogSeed.name,
      ],
    ];
    for (const [what, name, publicId, stored] of selects) {
      const before = await rows();
      const answer = await newItem(exec, A_SCOPE, { name, trackingType: TRACKING_TYPE.check });
      assert.ok(answer.ok, `FAM-1 6a-iii-a: newItem with ${what} succeeds`);
      assert.deepEqual(
        {
          id: answer.itemPublicId,
          name: answer.name,
          existed: answer.existed,
          trackingType: answer.trackingType,
        },
        {
          id: publicId,
          name: stored,
          existed: true,
          trackingType: options.find((o) => o.publicId === publicId)!.trackingType,
        },
        `FAM-1 6a-iii-a: newItem with ${what} selects the item and returns its stored name and own type`,
      );
      assert.equal(await rows(), before, `FAM-1 6a-iii-a: newItem with ${what} adds no row`);
    }
    const typed = await newItem(exec, A_SCOPE, {
      name: 'garden hop drill',
      trackingType: TRACKING_TYPE.check,
    });
    assert.ok(
      typed.ok && typed.trackingType === TRACKING_TYPE.distance,
      'FAM-1 6a-iii-a: a selected item keeps its own type, whatever was asked',
    );

    // ── a catalog row the picker does not list is still the item its slug names ──
    // A household row under the same slug, made before the catalog row existed: the slug step reads
    // global first, as the resolver does, so the catalog row is the answer.
    await own(A_SCOPE, 'Unlisted Drill');
    const unlisted = newId();
    await tx.insert(schema.movements).values({
      publicId: unlisted,
      slug: movementSlug('Unlisted Drill'),
      name: 'Unlisted Drill',
      pattern: MOVEMENT_PATTERNS[0],
      isBodyweight: false,
    });
    const before = await rows();
    const viaSlug = await newItem(exec, A_SCOPE, {
      name: 'unlisted   drill',
      trackingType: TRACKING_TYPE.reps,
    });
    assert.deepEqual(
      viaSlug.ok && {
        id: viaSlug.itemPublicId,
        existed: viaSlug.existed,
        name: viaSlug.name,
        trackingType: viaSlug.trackingType,
      },
      { id: unlisted, existed: true, name: 'Unlisted Drill', trackingType: DEFAULT_TRACKING_TYPE },
      'FAM-1 6a-iii-a: a catalog row the picker does not list answers its own name, and is not duplicated',
    );
    assert.equal(await rows(), before, 'FAM-1 6a-iii-a: …and adds no row');

    // ── a new name makes one household item, typed as asked; asking again selects it ──
    const fresh = await newItem(exec, A_SCOPE, {
      name: 'Hallway Crab Drill',
      trackingType: TRACKING_TYPE.distance,
    });
    assert.ok(fresh.ok && !fresh.existed, 'FAM-1 6a-iii-a: a new name makes a new item');
    assert.equal(fresh.trackingType, TRACKING_TYPE.distance, 'FAM-1 6a-iii-a: …typed as asked');
    // Ownership through the scope's own predicate: only `ownership.ts` unwraps a scope (scope.test.ts).
    const [made] = await tx
      .select({ name: schema.movements.name })
      .from(schema.movements)
      .where(and(eq(schema.movements.publicId, fresh.itemPublicId), movementInHousehold(A_SCOPE)));
    assert.deepEqual(
      made,
      { name: 'Hallway Crab Drill' },
      "FAM-1 6a-iii-a: the new item is the household's own, under the typed name",
    );
    const count = await rows();
    const again = await newItem(exec, A_SCOPE, {
      name: 'hallway crab drills',
      trackingType: TRACKING_TYPE.reps,
    });
    assert.deepEqual(
      again.ok && { id: again.itemPublicId, existed: again.existed, name: again.name },
      { id: fresh.itemPublicId, existed: true, name: 'Hallway Crab Drill' },
      'FAM-1 6a-iii-a: an item made and not yet used is selected by a re-spelled name',
    );
    assert.equal(await rows(), count, 'FAM-1 6a-iii-a: …and no second item is made');
    const inB = await newItem(exec, B_SCOPE, {
      name: 'Hallway Crab Drill',
      trackingType: TRACKING_TYPE.reps,
    });
    assert.ok(
      inB.ok && !inB.existed && inB.itemPublicId !== fresh.itemPublicId,
      "FAM-1 6a-iii-a: another household's item is not this household's: B makes its own",
    );

    // ── refusals ──
    for (const [what, input] of [
      ['a name with no key', { name: 'S', trackingType: TRACKING_TYPE.reps }],
      ['an empty name', { name: '', trackingType: TRACKING_TYPE.reps }],
      ['a control character', { name: 'Hallway\u0007Crab', trackingType: TRACKING_TYPE.reps }],
      ['an unknown type', { name: 'Crab Walk', trackingType: 'juggling' }],
      ['no type', { name: 'Crab Walk' }],
    ] as const) {
      const n = await rows();
      assert.deepEqual(
        await newItem(exec, A_SCOPE, input),
        { ok: false, reason: PROGRAM_REFUSAL.invalid },
        `FAM-1 6a-iii-a: newItem with ${what} is invalid`,
      );
      assert.equal(await rows(), n, `FAM-1 6a-iii-a: newItem with ${what} writes nothing`);
    }
  });
  console.log(
    '✓ FAM-1 6a-iii-a: movementOptions and newItem (catalog, own, shadowed, alias, re-spelled, new, refusals)',
  );
}

/**
 * `copyWorkout` (FAM-1 6a-iii-b; contract change C15): an independent copy with frozen provenance,
 * named by C15's rules, with no second workout of one name in a program; a replay adds nothing.
 */
async function verifyCopyWorkout({ A_SCOPE, B_SCOPE }: VerifyContext): Promise<void> {
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    const { programPublicId: home, draft } = await seedHeavyA(tx, A_SCOPE);
    const saved = await saveWorkout(exec, A_SCOPE, draft);
    assert.ok(saved.ok, 'FAM-1 6a-iii-b: the source workout saves');
    const source = saved.workoutPublicId;
    const away = await mustCreate(tx, A_SCOPE, 'Away program');
    const copy = (over: Record<string, unknown>) =>
      copyWorkout(exec, A_SCOPE, {
        clientId: newId(),
        workoutPublicId: source,
        toProgramPublicId: home,
        weekdays: [],
        label: null,
        ...over,
      }).catch((e: unknown) => ({ threw: String(e) }));
    const read = (programPublicId: string, workoutPublicId: string) =>
      readWorkoutDraft(exec, A_SCOPE, { programPublicId, workoutPublicId });
    const counts = async () => ({
      workouts: (await tx.select({ id: schema.workouts.id }).from(schema.workouts)).length,
      items: (await tx.select({ id: schema.prescriptions.id }).from(schema.prescriptions)).length,
      quantities: (
        await tx
          .select({ id: schema.prescriptionQuantities.id })
          .from(schema.prescriptionQuantities)
      ).length,
      slots: (await tx.select({ id: schema.blockDayWorkouts.id }).from(schema.blockDayWorkouts))
        .length,
    });
    /** A workout's items without their card ids: what a copy must carry over unchanged. */
    const content = (w: Awaited<ReturnType<typeof read>>) =>
      w!.items.map(({ prescriptionClientId: _id, ...item }) => item);

    // The source as a person leaves it: superset B's two cards removed (hidden, with their
    // quantities); the lone last card (Time per set) moved first, so stored order differs from write
    // order, and its target cleared, so a LIVE card has a hidden quantity; one target a range.
    const live = await read(home, source);
    const lone = live!.items[4]!;
    assert.ok(lone.quantities.length > 0, 'FAM-1 6a-iii-b: the lone card has a target to clear');
    const resaved = await saveWorkout(exec, A_SCOPE, {
      ...draft,
      workoutPublicId: source,
      items: [{ ...lone, quantities: [] }, live!.items[0]!, live!.items[1]!],
    });
    assert.ok(resaved.ok, 'FAM-1 6a-iii-b: the source is edited before it is copied');
    const [ranged] = await tx
      .select({ id: schema.prescriptionQuantities.id })
      .from(schema.prescriptionQuantities)
      .innerJoin(
        schema.prescriptions,
        eq(schema.prescriptions.id, schema.prescriptionQuantities.prescriptionId),
      )
      .innerJoin(schema.workouts, eq(schema.workouts.id, schema.prescriptions.workoutId))
      .where(
        and(
          eq(schema.workouts.publicId, source),
          isNull(schema.prescriptions.deletedAt),
          isNull(schema.prescriptionQuantities.deletedAt),
          sql`${schema.prescriptionQuantities.valueMin} is not null`,
        ),
      )
      .limit(1);
    assert.ok(ranged, 'FAM-1 6a-iii-b: the source has a target to make a range');
    await tx
      .update(schema.prescriptionQuantities)
      .set({ valueMax: sql`${schema.prescriptionQuantities.valueMin} + 5` })
      .where(eq(schema.prescriptionQuantities.id, ranged.id));
    /** A workout's live quantities as stored, in item order: what `readWorkoutDraft` leaves out. */
    const storedQuantities = (workoutPublicId: string) =>
      tx
        .select({
          slot: schema.prescriptionQuantities.slot,
          dimension: schema.prescriptionQuantities.dimension,
          unit: schema.prescriptionQuantities.unit,
          valueMin: schema.prescriptionQuantities.valueMin,
          valueMax: schema.prescriptionQuantities.valueMax,
        })
        .from(schema.prescriptionQuantities)
        .innerJoin(
          schema.prescriptions,
          eq(schema.prescriptions.id, schema.prescriptionQuantities.prescriptionId),
        )
        .innerJoin(schema.workouts, eq(schema.workouts.id, schema.prescriptions.workoutId))
        .where(
          and(
            eq(schema.workouts.publicId, workoutPublicId),
            isNull(schema.prescriptions.deletedAt),
            isNull(schema.prescriptionQuantities.deletedAt),
          ),
        )
        .orderBy(asc(schema.prescriptions.idx), asc(schema.prescriptionQuantities.slot));

    // ── into its own program, with no name: the name and " (copy)" ──
    const clientId = newId();
    const mine = await copy({ clientId });
    assert.ok('ok' in mine && mine.ok, 'FAM-1 6a-iii-b: a copy into its own program succeeds');
    const copied = await read(home, mine.workoutPublicId);
    const original = await read(home, source);
    assert.equal(
      copied!.name,
      copyName(original!.name),
      'FAM-1 6a-iii-b: a copy in its own program is named with " (copy)"',
    );
    assert.equal(
      copied!.description,
      original!.description,
      'FAM-1 6a-iii-b: …with its description',
    );
    assert.deepEqual(
      content(copied),
      content(original),
      "FAM-1 6a-iii-b: the copy has the source's items, in order, with their numbers",
    );
    assert.equal(
      copied!.items.length,
      live!.items.length - 2,
      "FAM-1 6a-iii-b: the source's removed cards are not copied",
    );
    assert.deepEqual(
      await storedQuantities(mine.workoutPublicId),
      await storedQuantities(source),
      "FAM-1 6a-iii-b: the copy's quantities are the source's, every column (a range included)",
    );
    const sourceCards = new Set(original!.items.map((i) => i.prescriptionClientId));
    assert.ok(
      copied!.items.every((i) => !sourceCards.has(i.prescriptionClientId)),
      'FAM-1 6a-iii-b: every card of the copy is a new row',
    );
    const [row] = await tx
      .select({
        copiedFromWorkoutId: schema.workouts.copiedFromWorkoutId,
        copiedFromProgramName: schema.workouts.copiedFromProgramName,
      })
      .from(schema.workouts)
      .where(eq(schema.workouts.publicId, mine.workoutPublicId));
    const [src] = await tx
      .select({ id: schema.workouts.id })
      .from(schema.workouts)
      .where(eq(schema.workouts.publicId, source));
    assert.deepEqual(
      row,
      { copiedFromWorkoutId: src!.id, copiedFromProgramName: 'Kids program' },
      "FAM-1 6a-iii-b: the copy records its source and the source program's name",
    );

    // ── a replay adds nothing ──
    const before = await counts();
    assert.deepEqual(
      await copy({ clientId }),
      { ok: true, workoutPublicId: mine.workoutPublicId },
      'FAM-1 6a-iii-b: a replayed copy answers the same workout',
    );
    assert.deepEqual(await counts(), before, 'FAM-1 6a-iii-b: a replayed copy adds nothing');

    // ── independent: an edit to the copy leaves the source as it was ──
    const edited = await saveWorkout(exec, A_SCOPE, {
      ...copied!,
      programPublicId: home,
      workoutClientId: newId(),
      items: copied!.items.map((item, i) =>
        i === 0 ? { ...item, notes: 'Changed in the copy' } : item,
      ),
    });
    assert.ok(edited.ok, 'FAM-1 6a-iii-b: the copy can be edited');
    assert.deepEqual(
      await read(home, source),
      original,
      'FAM-1 6a-iii-b: editing the copy leaves the source unchanged',
    );

    // ── into another program: its own name; then that name is taken there ──
    const there = await copy({ toProgramPublicId: away, weekdays: [1, 3], label: 'Evening' });
    assert.ok('ok' in there && there.ok, 'FAM-1 6a-iii-b: a copy into another program succeeds');
    assert.equal(
      (await read(away, there.workoutPublicId))!.name,
      original!.name,
      "FAM-1 6a-iii-b: a copy in another program keeps the workout's own name",
    );
    const provenance = async (workoutPublicId: string) =>
      (
        await tx
          .select({
            copiedFromWorkoutId: schema.workouts.copiedFromWorkoutId,
            copiedFromProgramName: schema.workouts.copiedFromProgramName,
          })
          .from(schema.workouts)
          .where(eq(schema.workouts.publicId, workoutPublicId))
      )[0];
    assert.deepEqual(
      await provenance(there.workoutPublicId),
      { copiedFromWorkoutId: src!.id, copiedFromProgramName: 'Kids program' },
      "FAM-1 6a-iii-b: a copy into another program records the SOURCE program's name",
    );
    const renamed = await renameProgram(exec, A_SCOPE, {
      programPublicId: home,
      name: 'Renamed program',
    });
    assert.ok(renamed.ok, 'FAM-1 6a-iii-b: the source program renames');
    assert.equal(
      (await provenance(there.workoutPublicId))!.copiedFromProgramName,
      'Kids program',
      "FAM-1 6a-iii-b: the source program's name is frozen at copy time",
    );
    assert.deepEqual(
      content(await read(away, there.workoutPublicId)),
      content(original),
      "FAM-1 6a-iii-b: a copy into another program has the source's items too",
    );
    assert.deepEqual(
      await storedQuantities(there.workoutPublicId),
      await storedQuantities(source),
      'FAM-1 6a-iii-b: …and its quantities',
    );
    const week = await readWeek(exec, A_SCOPE, away);
    assert.deepEqual(
      [week![1], week![3]],
      [
        [{ workoutPublicId: there.workoutPublicId, label: 'Evening' }],
        [{ workoutPublicId: there.workoutPublicId, label: 'Evening' }],
      ],
      'FAM-1 6a-iii-b: the copy goes onto the days named, with the label',
    );
    const second = await copy({ toProgramPublicId: away, name: 'Second Copy', weekdays: [1] });
    assert.ok('ok' in second && second.ok, 'FAM-1 6a-iii-b: a second copy, named, succeeds');
    assert.deepEqual(
      (await readWeek(exec, A_SCOPE, away))![1].map((slot) => slot.workoutPublicId),
      [there.workoutPublicId, second.workoutPublicId],
      'FAM-1 6a-iii-b: the copy goes last on each day named',
    );

    // ── a long name: " (copy)" still fits ──
    const long = 'L'.repeat(WORKOUT_NAME_MAX);
    const longSave = await saveWorkout(exec, A_SCOPE, {
      ...draft,
      workoutPublicId: null,
      workoutClientId: newId(),
      name: long,
      items: [],
    });
    assert.ok(longSave.ok, 'FAM-1 6a-iii-b: a workout with the longest name saves');
    const longCopy = await copy({ workoutPublicId: longSave.workoutPublicId });
    assert.ok(
      'ok' in longCopy && longCopy.ok,
      'FAM-1 6a-iii-b: copying a longest-name workout succeeds',
    );
    const longName = (await read(home, longCopy.workoutPublicId))!.name;
    assert.ok(
      longName.endsWith(COPY_NAME_SUFFIX) && longName.length === WORKOUT_NAME_MAX,
      'FAM-1 6a-iii-b: the default name is cut to fit',
    );

    // ── refusals: typed, and nothing written ──
    const theirs = await mustCreate(tx, B_SCOPE, 'B program');
    const theirWorkout = await saveWorkout(exec, B_SCOPE, {
      programPublicId: theirs,
      workoutPublicId: null,
      workoutClientId: newId(),
      name: 'B workout',
      description: null,
      items: [],
    });
    assert.ok(theirWorkout.ok, "FAM-1 6a-iii-b: household B's workout saves");
    const hiddenProgram = await mustCreate(tx, A_SCOPE, 'Hidden target');
    await hide(tx, hiddenProgram);
    // A live workout of a program removed since: the program's own liveness keeps it from copying.
    const shelved = await mustCreate(tx, A_SCOPE, 'Shelved program');
    const shelvedWorkout = await saveWorkout(exec, A_SCOPE, {
      programPublicId: shelved,
      workoutPublicId: null,
      workoutClientId: newId(),
      name: 'Shelved workout',
      description: null,
      items: [],
    });
    assert.ok(shelvedWorkout.ok, 'FAM-1 6a-iii-b: a workout of the program to remove saves');
    await hide(tx, shelved);
    const legacy = await seededBlock(tx, A_SCOPE);
    const gone = await copy({ toProgramPublicId: away, name: 'Gone Copy' });
    assert.ok('ok' in gone && gone.ok, 'FAM-1 6a-iii-b: a copy to remove later succeeds');
    await tx
      .update(schema.workouts)
      .set({ deletedAt: sql`now()` })
      .where(eq(schema.workouts.publicId, gone.workoutPublicId));
    const goneClient = (
      await tx
        .select({ clientId: schema.workouts.clientId })
        .from(schema.workouts)
        .where(eq(schema.workouts.publicId, gone.workoutPublicId))
    )[0]!.clientId;
    const cases: Array<[string, Record<string, unknown>, string]> = [
      [
        'its own name, folded, into a program that has it',
        { toProgramPublicId: away, name: 'heavy  a' },
        PROGRAM_REFUSAL.name_taken,
      ],
      [
        'no name, into a program that has its name',
        { toProgramPublicId: away },
        PROGRAM_REFUSAL.name_taken,
      ],
      ['a blank name', { name: '   ' }, PROGRAM_REFUSAL.invalid],
      [
        'a name over WORKOUT_NAME_MAX',
        { name: 'x'.repeat(WORKOUT_NAME_MAX + 1) },
        PROGRAM_REFUSAL.invalid,
      ],
      ['a weekday twice', { weekdays: [2, 2] }, PROGRAM_REFUSAL.invalid],
      [
        "another household's workout",
        { workoutPublicId: theirWorkout.workoutPublicId },
        PROGRAM_REFUSAL.not_found,
      ],
      [
        "into another household's program",
        { toProgramPublicId: theirs },
        PROGRAM_REFUSAL.not_found,
      ],
      ['into a hidden program', { toProgramPublicId: hiddenProgram }, PROGRAM_REFUSAL.not_found],
      [
        'into the seeded legacy block',
        { toProgramPublicId: legacy.publicId },
        PROGRAM_REFUSAL.not_found,
      ],
      [
        'a hidden workout',
        { workoutPublicId: gone.workoutPublicId, toProgramPublicId: home, name: 'From Gone' },
        PROGRAM_REFUSAL.not_found,
      ],
      ['a workout that does not exist', { workoutPublicId: newId() }, PROGRAM_REFUSAL.not_found],
      [
        'a workout of a removed program',
        { workoutPublicId: shelvedWorkout.workoutPublicId },
        PROGRAM_REFUSAL.not_found,
      ],
      [
        'the replay of a copy removed since',
        { clientId: goneClient, toProgramPublicId: away, name: 'Gone Copy' },
        PROGRAM_REFUSAL.not_found,
      ],
    ];
    const unchanged = await counts();
    for (const [what, over, reason] of cases) {
      assert.deepEqual(
        await copy(over),
        { ok: false, reason },
        `FAM-1 6a-iii-b: copying ${what} is ${reason}`,
      );
    }
    assert.deepEqual(await counts(), unchanged, 'FAM-1 6a-iii-b: a refused copy writes nothing');
    // The removed "Gone Copy" was in `away`: its name, re-cased, is free there again.
    const freed = await copy({ toProgramPublicId: away, name: 'gone  copy' });
    assert.ok(
      'ok' in freed && freed.ok,
      'FAM-1 6a-iii-b: a name a removed workout had is free again',
    );

    // ── a replay still answers after the source is removed (another device, meanwhile) ──
    const settled = await counts();
    await tx
      .update(schema.workouts)
      .set({ deletedAt: sql`now()` })
      .where(eq(schema.workouts.publicId, source));
    assert.deepEqual(
      await copy({ clientId }),
      { ok: true, workoutPublicId: mine.workoutPublicId },
      'FAM-1 6a-iii-b: a replayed copy answers the same workout after its source is removed',
    );
    assert.deepEqual(await counts(), settled, 'FAM-1 6a-iii-b: …and adds nothing');

    // ── household B cannot copy A's workout into its own program ──
    assert.deepEqual(
      await copyWorkout(exec, B_SCOPE, {
        clientId: newId(),
        workoutPublicId: source,
        toProgramPublicId: theirs,
        weekdays: [],
        label: null,
      }),
      { ok: false, reason: PROGRAM_REFUSAL.not_found },
      "FAM-1 6a-iii-b: household B copying A's workout is not_found",
    );
  });
  console.log(
    '✓ FAM-1 6a-iii-b: copyWorkout (names, independence, provenance, week, replay, refusals)',
  );
}

// ── FAM-1 6c-i: put on, and the fixture seed ────────────────────────────────────────────────────────

/** The proofs' today, fixed: the writer takes the day as an argument. */
const PUT_ON_TODAY = '2026-11-17';

/** A new live athlete of `scope`'s household, by public id. */
async function mustAddAthlete(tx: VerifyTx, scope: HouseholdScope, name: string) {
  const clientId = newId();
  await insertProfileOwnedBy(asTx(tx), scope, { name, kind: PROFILE_KIND.kid, clientId });
  // Read back through the seam: `profiles.client_id` is named only inside it (scope.test.ts).
  const row = await profileByClientId(asTx(tx), scope, clientId);
  assert.ok(row, `FAM-1 6c-i: adding the athlete "${name}" succeeds`);
  return row.publicId;
}

/**
 * Every assignment row and weekday row, live and hidden, with each row's `ctid`, so a write that
 * leaves the values as they were is still seen (`updated_at` cannot see it inside one transaction).
 */
async function assignmentRows(tx: VerifyTx) {
  const a = schema.programAssignments;
  const assignments = await tx
    .select({
      ctid: sql<string>`${a}.ctid::text`,
      id: a.id,
      profile: schema.profiles.publicId,
      program: schema.programBlocks.publicId,
      idx: a.idx,
      activeFrom: a.activeFrom,
      activeTo: a.activeTo,
      deletedAt: a.deletedAt,
    })
    .from(a)
    .innerJoin(schema.profiles, eq(schema.profiles.id, a.profileId))
    .innerJoin(schema.programBlocks, eq(schema.programBlocks.id, a.blockId))
    .orderBy(a.id);
  const w = schema.programAssignmentWeekdays;
  const weekdays = await tx
    .select({
      ctid: sql<string>`${w}.ctid::text`,
      assignmentId: w.assignmentId,
      weekday: w.weekday,
      deletedAt: w.deletedAt,
    })
    .from(w)
    .orderBy(w.assignmentId, w.weekday);
  return { assignments, weekdays };
}

async function verifyPutOn({ A_SCOPE, B_SCOPE }: VerifyContext): Promise<void> {
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    const tryIt = (scope: HouseholdScope, input: unknown, today = PUT_ON_TODAY) =>
      putOn(exec, scope, input, today).catch((e: unknown) => ({ threw: String(e) }));
    const tomorrow = addDays(PUT_ON_TODAY, 1);
    const yesterday = addDays(PUT_ON_TODAY, -1);

    const P = await mustCreate(tx, A_SCOPE, 'Put-on P');
    const Q = await mustCreate(tx, A_SCOPE, 'Put-on Q');
    const R = await mustCreate(tx, A_SCOPE, 'Put-on R');
    const gone = await mustCreate(tx, A_SCOPE, 'Put-on removed');
    await hide(tx, gone);
    const legacy = (await seededBlock(tx, A_SCOPE)).publicId;
    const theirs = await mustCreate(tx, B_SCOPE, 'Put-on B');

    const x = await mustAddAthlete(tx, A_SCOPE, 'Put-on Athlete X');
    const y = await mustAddAthlete(tx, A_SCOPE, 'Put-on Athlete Y');
    const archived = await mustAddAthlete(tx, A_SCOPE, 'Put-on Archived');
    await tx
      .update(schema.profiles)
      .set({ archivedAt: sql`now()` })
      .where(eq(schema.profiles.publicId, archived));
    const removed = await mustAddAthlete(tx, A_SCOPE, 'Put-on Removed');
    await tx
      .update(schema.profiles)
      .set({ deletedAt: sql`now()` })
      .where(eq(schema.profiles.publicId, removed));
    const b = await mustAddAthlete(tx, B_SCOPE, 'Put-on B Athlete');

    const rowsOf = async (profile: string) =>
      (await assignmentRows(tx)).assignments.filter((r) => r.profile === profile);
    const openOrder = async (profile: string) =>
      (await rowsOf(profile))
        .filter((r) => r.deletedAt === null && r.activeTo === null)
        .sort((m, n) => m.idx - n.idx)
        .map((r) => ({ program: r.program, idx: r.idx }));

    // ── A first put on: one row each, from the day given, last in their order, all seven days ──
    assert.deepEqual(
      await tryIt(A_SCOPE, { programPublicId: P, profilePublicIds: [x, y], from: PUT_ON_TODAY }),
      { ok: true },
      'FAM-1 6c-i: put on answers ok',
    );
    const all = await assignmentRows(tx);
    for (const athlete of [x, y]) {
      const rows = all.assignments.filter((r) => r.profile === athlete);
      assert.deepEqual(
        rows.map((r) => ({ ...r, ctid: undefined, id: undefined })),
        [
          {
            ctid: undefined,
            id: undefined,
            profile: athlete,
            program: P,
            idx: 0,
            activeFrom: PUT_ON_TODAY,
            activeTo: null,
            deletedAt: null,
          },
        ],
        'FAM-1 6c-i: put on writes one open row from `from`, at the first place',
      );
      assert.deepEqual(
        all.weekdays
          .filter((w) => w.assignmentId === rows[0]!.id && w.deletedAt === null)
          .map((w) => w.weekday),
        [...WEEKDAYS].sort((m, n) => m - n),
        'FAM-1 6c-i: put on writes all seven weekday rows',
      );
    }

    // ── A replay is one effect ──
    assert.deepEqual(
      await tryIt(A_SCOPE, { programPublicId: P, profilePublicIds: [y, x], from: tomorrow }),
      { ok: true },
      'FAM-1 6c-i: putting someone on a program they are on answers ok',
    );
    assert.deepEqual(
      await assignmentRows(tx),
      all,
      'FAM-1 6c-i: …and writes nothing, whatever `from` says',
    );

    // ── A second program goes last, and may start tomorrow ──
    assert.deepEqual(
      await tryIt(A_SCOPE, { programPublicId: Q, profilePublicIds: [x], from: tomorrow }),
      { ok: true },
      'FAM-1 6c-i: put on from tomorrow answers ok',
    );
    assert.deepEqual(
      await openOrder(x),
      [
        { program: P, idx: 0 },
        { program: Q, idx: 1 },
      ],
      'FAM-1 6c-i: a second program takes the next place in the athlete’s order',
    );
    assert.equal(
      (await rowsOf(x)).find((r) => r.program === Q)?.activeFrom,
      tomorrow,
      'FAM-1 6c-i: …from tomorrow',
    );
    assert.deepEqual(
      await tryIt(A_SCOPE, { programPublicId: Q, profilePublicIds: [x], from: PUT_ON_TODAY }),
      { ok: true },
      'FAM-1 6c-i: a start still to come counts as on',
    );
    assert.equal(
      (await rowsOf(x)).filter((r) => r.program === Q).length,
      1,
      'FAM-1 6c-i: …so a second put on adds no row',
    );

    // ── Refusals write nothing ──
    const before = await assignmentRows(tx);
    const refusals: Array<[string, HouseholdScope, unknown, string]> = [
      [
        'a start yesterday',
        A_SCOPE,
        { programPublicId: R, profilePublicIds: [x], from: yesterday },
        PROGRAM_REFUSAL.invalid,
      ],
      [
        'a start two days ahead',
        A_SCOPE,
        { programPublicId: R, profilePublicIds: [x], from: addDays(PUT_ON_TODAY, 2) },
        PROGRAM_REFUSAL.invalid,
      ],
      [
        'no athlete',
        A_SCOPE,
        { programPublicId: R, profilePublicIds: [], from: PUT_ON_TODAY },
        PROGRAM_REFUSAL.invalid,
      ],
      [
        'an athlete named twice',
        A_SCOPE,
        { programPublicId: R, profilePublicIds: [x, x], from: PUT_ON_TODAY },
        PROGRAM_REFUSAL.invalid,
      ],
      [
        'a program id that is not a uuid',
        A_SCOPE,
        { programPublicId: 'p1', profilePublicIds: [x], from: PUT_ON_TODAY },
        PROGRAM_REFUSAL.invalid,
      ],
      [
        'another household’s program',
        A_SCOPE,
        { programPublicId: theirs, profilePublicIds: [x], from: PUT_ON_TODAY },
        PROGRAM_REFUSAL.not_found,
      ],
      [
        'a legacy block',
        A_SCOPE,
        { programPublicId: legacy, profilePublicIds: [x], from: PUT_ON_TODAY },
        PROGRAM_REFUSAL.not_found,
      ],
      [
        'a removed program',
        A_SCOPE,
        { programPublicId: gone, profilePublicIds: [x], from: PUT_ON_TODAY },
        PROGRAM_REFUSAL.not_found,
      ],
      [
        'an unknown program',
        A_SCOPE,
        { programPublicId: newId(), profilePublicIds: [x], from: PUT_ON_TODAY },
        PROGRAM_REFUSAL.not_found,
      ],
      [
        'another household’s athlete beside one of ours',
        A_SCOPE,
        { programPublicId: R, profilePublicIds: [x, b], from: PUT_ON_TODAY },
        PROGRAM_REFUSAL.not_found,
      ],
      [
        'an archived athlete',
        A_SCOPE,
        { programPublicId: R, profilePublicIds: [archived], from: PUT_ON_TODAY },
        PROGRAM_REFUSAL.not_found,
      ],
      [
        'a removed athlete',
        A_SCOPE,
        { programPublicId: R, profilePublicIds: [removed], from: PUT_ON_TODAY },
        PROGRAM_REFUSAL.not_found,
      ],
      [
        'an unknown athlete',
        A_SCOPE,
        { programPublicId: R, profilePublicIds: [newId()], from: PUT_ON_TODAY },
        PROGRAM_REFUSAL.not_found,
      ],
      [
        'household B putting A’s athlete on its program',
        B_SCOPE,
        { programPublicId: theirs, profilePublicIds: [x], from: PUT_ON_TODAY },
        PROGRAM_REFUSAL.not_found,
      ],
      [
        'household B putting its athlete on A’s program',
        B_SCOPE,
        { programPublicId: R, profilePublicIds: [b], from: PUT_ON_TODAY },
        PROGRAM_REFUSAL.not_found,
      ],
    ];
    for (const [what, scope, input, reason] of refusals) {
      assert.deepEqual(
        await tryIt(scope, input),
        { ok: false, reason },
        `FAM-1 6c-i: put on refuses ${what}`,
      );
    }
    assert.deepEqual(
      await assignmentRows(tx),
      before,
      'FAM-1 6c-i: …and every refusal writes nothing',
    );

    // ── Taken off by mistake and straight back on: the order closes up, the program goes last ──
    const z = await mustAddAthlete(tx, A_SCOPE, 'Put-on Athlete Z');
    for (const program of [P, Q]) {
      assert.deepEqual(
        await tryIt(A_SCOPE, {
          programPublicId: program,
          profilePublicIds: [z],
          from: PUT_ON_TODAY,
        }),
        { ok: true },
        'FAM-1 6c-i: z goes on P, then Q',
      );
    }
    // The usual case: on P since earlier in the week, taken off today, put straight back on.
    const zp = (await rowsOf(z)).find((r) => r.program === P)!;
    const zStart = addDays(PUT_ON_TODAY, -3);
    await tx
      .update(schema.programAssignments)
      .set({ activeFrom: zStart, activeTo: PUT_ON_TODAY })
      .where(eq(schema.programAssignments.id, zp.id));
    assert.deepEqual(
      await tryIt(A_SCOPE, { programPublicId: P, profilePublicIds: [z], from: PUT_ON_TODAY }),
      { ok: true },
      'FAM-1 6c-i: taken off and straight back on answers ok',
    );
    assert.deepEqual(
      await openOrder(z),
      [
        { program: Q, idx: 0 },
        { program: P, idx: 1 },
      ],
      'FAM-1 6c-i: …the order closed up, the reopened program last',
    );
    assert.deepEqual(
      (await rowsOf(z))
        .filter((r) => r.program === P)
        .map((r) => ({ id: r.id, activeFrom: r.activeFrom, activeTo: r.activeTo })),
      [{ id: zp.id, activeFrom: zStart, activeTo: null }],
      'FAM-1 6c-i: …a stretch that began before today is reopened on its own row, its start kept',
    );

    // ── One call, one athlete already on and one new: only the new one is written ──
    const w = await mustAddAthlete(tx, A_SCOPE, 'Put-on Athlete W');
    const zBefore = await rowsOf(z);
    assert.deepEqual(
      await tryIt(A_SCOPE, { programPublicId: Q, profilePublicIds: [z, w], from: PUT_ON_TODAY }),
      { ok: true },
      'FAM-1 6c-i: put on one athlete already on and one new answers ok',
    );
    assert.deepEqual(
      await rowsOf(z),
      zBefore,
      'FAM-1 6c-i: …leaves the one already on as they were',
    );
    assert.deepEqual(
      await openOrder(w),
      [{ program: Q, idx: 0 }],
      'FAM-1 6c-i: …and puts the new one on',
    );

    // ── Take off P, put on R, put on P again: P is reopened, one row, last, no gap ──
    // `active_to = today` stands in for Take off, step 6d's writer, which is what it writes.
    const pRow = (await rowsOf(x)).find((r) => r.program === P)!;
    await tx
      .update(schema.programAssignments)
      .set({ activeTo: PUT_ON_TODAY })
      .where(eq(schema.programAssignments.id, pRow.id));
    assert.deepEqual(
      await tryIt(A_SCOPE, { programPublicId: R, profilePublicIds: [x], from: PUT_ON_TODAY }),
      { ok: true },
      'FAM-1 6c-i: after a take off, put on another program answers ok',
    );
    assert.deepEqual(
      await openOrder(x),
      [
        { program: Q, idx: 0 },
        { program: R, idx: 1 },
      ],
      'FAM-1 6c-i: …and the place the take off freed is closed up, the order kept',
    );
    assert.deepEqual(
      await tryIt(A_SCOPE, { programPublicId: P, profilePublicIds: [x], from: tomorrow }),
      { ok: true },
      'FAM-1 6c-i: putting them back on the program they came off today answers ok',
    );
    const pRows = (await rowsOf(x)).filter((r) => r.program === P);
    assert.deepEqual(
      pRows.map((r) => ({ id: r.id, activeFrom: r.activeFrom, activeTo: r.activeTo })),
      [{ id: pRow.id, activeFrom: PUT_ON_TODAY, activeTo: null }],
      'FAM-1 6c-i: …reopens the same row, its start kept: one stretch, no gap, whatever `from` says',
    );
    assert.deepEqual(
      await openOrder(x),
      [
        { program: Q, idx: 0 },
        { program: R, idx: 1 },
        { program: P, idx: 2 },
      ],
      'FAM-1 6c-i: …in the last place of their order',
    );

    // ── A stretch that ended before today is history: a new row, the old one untouched ──
    const yRow = (await rowsOf(y)).find((r) => r.program === P)!;
    await tx
      .update(schema.programAssignments)
      .set({ activeFrom: addDays(PUT_ON_TODAY, -5), activeTo: yesterday })
      .where(eq(schema.programAssignments.id, yRow.id));
    const yBefore = (await rowsOf(y)).find((r) => r.id === yRow.id);
    assert.deepEqual(
      await tryIt(A_SCOPE, { programPublicId: P, profilePublicIds: [y], from: PUT_ON_TODAY }),
      { ok: true },
      'FAM-1 6c-i: put on after a stretch that ended yesterday answers ok',
    );
    const yRows = await rowsOf(y);
    assert.deepEqual(
      yRows.find((r) => r.id === yRow.id),
      yBefore,
      'FAM-1 6c-i: …leaves the ended stretch as it was',
    );
    assert.deepEqual(
      yRows
        .filter((r) => r.id !== yRow.id)
        .map((r) => ({
          program: r.program,
          activeFrom: r.activeFrom,
          activeTo: r.activeTo,
          idx: r.idx,
        })),
      [{ program: P, activeFrom: PUT_ON_TODAY, activeTo: null, idx: 0 }],
      'FAM-1 6c-i: …and starts a new one',
    );

    // A today the writer cannot read is the caller's bug, not a refusal: it throws.
    const bad = await tryIt(
      A_SCOPE,
      { programPublicId: R, profilePublicIds: [y], from: PUT_ON_TODAY },
      'today',
    );
    assert.ok(
      'threw' in bad && bad.threw.includes('putOn needs today'),
      'FAM-1 6c-i: put on throws on a today that is not an ISO day',
    );
  });
  console.log(
    '✓ FAM-1 6c-i: put on writes one row and seven weekdays, last in the order; a replay adds nothing; refusals write nothing; a take off today is reopened on its row',
  );
}

/**
 * The fixture seed (FAM-1 6c-i). `verify.ts` seeds with fixtures, twice, before this module runs, so
 * household A holds them now. Proved through the reads lane P has: each workout through
 * `readWorkoutDraft` against `workoutDraft(world, p, w)`, each week through `readWeek` against the
 * fixture's week, and the assignment rows against the world's. 6c-ii's `program-view` and
 * `program-list` deep-equals finish it.
 */
async function verifySeedFixtures({ A_SCOPE, B_SCOPE }: VerifyContext): Promise<void> {
  const world = DAY_PLAN_FIXTURE_SOURCES['today-two-programs'].world;
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    const programIds = new Map<string, string>();
    const workoutIds = new Map<string, string>();

    for (const program of world.programs) {
      const block = await programBlockByClientId(
        exec,
        A_SCOPE,
        seedFixtureProgramClientId(program.id),
      );
      assert.ok(
        block && !block.deleted,
        `FAM-1 6c-i: the seed made the live program ${program.id}`,
      );
      assert.equal(block.kind, PROGRAM_BLOCK_KIND.template, 'FAM-1 6c-i: …a template program');
      assert.equal(
        (await blockRow(tx, block.publicId))?.name,
        program.name,
        'FAM-1 6c-i: …with the fixture’s name',
      );
      programIds.set(fixtureIds.program(program.id), block.publicId);

      const workouts = await tx
        .select({ publicId: schema.workouts.publicId, name: schema.workouts.name })
        .from(schema.workouts)
        .where(and(eq(schema.workouts.blockId, block.id), isNull(schema.workouts.deletedAt)));
      assert.deepEqual(
        workouts.map((w) => w.name).sort(),
        program.workouts.map((w) => w.name).sort(),
        `FAM-1 6c-i: ${program.id} holds the fixture’s workouts, and no other`,
      );
      for (const workout of program.workouts) {
        const publicId = workouts.find((w) => w.name === workout.name)!.publicId;
        workoutIds.set(fixtureIds.workout(workout.wid), publicId);
        const read = await readWorkoutDraft(exec, A_SCOPE, {
          programPublicId: block.publicId,
          workoutPublicId: publicId,
        });
        assert.ok(read, `FAM-1 6c-i: the seeded workout ${workout.wid} reads back`);
        const fixture = workoutDraft(world, program.id, workout.wid);
        // Each item is the one a person typing the fixture's name gets (`newItem`: an item the
        // catalog has is the catalog's, under its stored name, "DB bench press" is "Dumbbell Bench
        // Press"). Asked again here, it answers that item and writes nothing. Card ids are the
        // database's own; every other field is the fixture's.
        const expectedItems = [];
        for (const [i, item] of workout.items.entries()) {
          const { name, type } = world.catalog[item.iid];
          const found = await newItem(exec, A_SCOPE, { name, trackingType: type });
          assert.ok(found.ok && found.existed, `FAM-1 6c-i: the seed made or found ${item.iid}`);
          const { prescriptionClientId: _c, ...rest } = fixture.items[i]!;
          expectedItems.push({ ...rest, itemPublicId: found.itemPublicId, itemName: found.name });
        }
        const withoutCardIds = (draft: WorkoutDraft) =>
          draft.items.map(({ prescriptionClientId: _c, ...rest }) => rest);
        assert.deepEqual(
          { name: read.name, description: read.description, items: withoutCardIds(read) },
          { name: fixture.name, description: fixture.description, items: expectedItems },
          `FAM-1 6c-i: the seeded workout ${workout.wid} equals the contract’s workoutDraft`,
        );
      }

      const week = await readWeek(exec, A_SCOPE, block.publicId);
      const expected = programView(world, program.id).week;
      assert.deepEqual(
        week,
        Object.fromEntries(
          Object.entries(expected).map(([day, slots]) => [
            day,
            slots.map((slot) => ({
              ...slot,
              workoutPublicId: workoutIds.get(slot.workoutPublicId),
            })),
          ]),
        ),
        `FAM-1 6c-i: the seeded week of ${program.id} equals the fixture’s`,
      );
    }

    // Who is on what, from which day, in which order.
    const rows = await assignmentRows(tx);
    for (const [athlete, profile] of Object.entries(SEED_FIXTURE_ATHLETES)) {
      const ours = rows.assignments
        .filter((r) => r.profile === profile && r.deletedAt === null)
        .filter((r) => [...programIds.values()].includes(r.program))
        .sort((m, n) => m.idx - n.idx);
      assert.deepEqual(
        ours.map((r) => ({ program: r.program, from: r.activeFrom, to: r.activeTo })),
        (world.assign[athlete] ?? []).map((a) => ({
          program: programIds.get(fixtureIds.program(a.prog)),
          from: a.from,
          to: null,
        })),
        `FAM-1 6c-i: ${athlete} is on the fixture’s programs, from its days, in its order`,
      );
      for (const r of ours) {
        assert.equal(
          rows.weekdays.filter((w) => w.assignmentId === r.id && w.deletedAt === null).length,
          WEEKDAYS.length,
          `FAM-1 6c-i: ${athlete}'s seeded stretches are due all seven days`,
        );
      }
    }
    assert.equal(
      rows.assignments.filter(
        (r) => r.program === programIds.get(fixtureIds.program('p3')) && r.deletedAt === null,
      ).length,
      0,
      'FAM-1 6c-i: Adult One has no seed profile, so nobody is on Adult One’s program',
    );

    // A third run, after a person changed a fixture program, leaves it as they left it.
    const p1 = programIds.get(fixtureIds.program('p1'))!;
    await renameProgram(exec, A_SCOPE, { programPublicId: p1, name: 'Renamed family program' });
    const snapshotOf = async () => ({
      rows: await assignmentRows(tx),
      blocks: await blocksIn(tx, A_SCOPE),
      name: (await blockRow(tx, p1))?.name,
      movements: (
        await tx
          .select({ id: schema.movements.id })
          .from(schema.movements)
          .where(movementInHousehold(A_SCOPE))
      ).length,
    });
    const before = await snapshotOf();
    await seedProgramFixtures(exec, A_SCOPE);
    assert.deepEqual(
      await snapshotOf(),
      before,
      'FAM-1 6c-i: the seed run again writes nothing, and leaves a changed fixture program as it is',
    );
  });

  // State a person can make through the app is skipped, never a throw: the preview database keeps
  // it, and a throw would fail every preview seed until the database is reset.
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    // Retire the fixture programs (a fresh client id, removed), so the seed makes them again.
    for (const id of SEED_FIXTURE_PROGRAM_CLIENT_IDS) {
      const block = await programBlockByClientId(exec, A_SCOPE, id);
      if (block) {
        await tx
          .update(schema.programBlocks)
          .set({ clientId: newId(), deletedAt: sql`now()` })
          .where(eq(schema.programBlocks.id, block.id));
      }
    }
    await tx
      .update(schema.profiles)
      .set({ archivedAt: sql`now()` })
      .where(eq(schema.profiles.publicId, SEED_FIXTURE_ATHLETES.a2!));
    await orFail('FAM-1 6c-i: the seed succeeds with a seed athlete archived', () =>
      seedProgramFixtures(exec, A_SCOPE),
    );
    const made = new Set<string>();
    for (const id of SEED_FIXTURE_PROGRAM_CLIENT_IDS) {
      const block = await programBlockByClientId(exec, A_SCOPE, id);
      assert.ok(block && !block.deleted, 'FAM-1 6c-i: …and writes every fixture program');
      made.add(block.publicId);
    }
    const onMade = (profile: string) =>
      assignmentRows(tx).then(({ assignments }) =>
        assignments.filter(
          (r) => r.profile === profile && r.deletedAt === null && made.has(r.program),
        ),
      );
    assert.equal(
      (await onMade(SEED_FIXTURE_ATHLETES.a2!)).length,
      0,
      'FAM-1 6c-i: …and puts the archived athlete on nothing',
    );
    assert.equal(
      (await onMade(SEED_FIXTURE_ATHLETES.a1!)).length,
      DAY_PLAN_FIXTURE_SOURCES['today-two-programs'].world.assign.a1?.length,
      'FAM-1 6c-i: …and the other seed athlete on their two programs',
    );
  });

  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    // Household B already has an item under a fixture item's name, with another type.
    const grip = DAY_PLAN_FIXTURE_SOURCES['today-two-programs'].world.catalog.grip;
    const planted = await newItem(exec, B_SCOPE, {
      name: grip.name,
      trackingType: TRACKING_TYPE.reps,
    });
    assert.ok(planted.ok && !planted.existed, 'FAM-1 6c-i: B makes its own item named like grip');
    await orFail('FAM-1 6c-i: the seed succeeds when an item has another type', () =>
      seedProgramFixtures(exec, B_SCOPE),
    );
    const written = [];
    for (const program of world.programs) {
      const block = await programBlockByClientId(
        exec,
        B_SCOPE,
        seedFixtureProgramClientId(program.id),
      );
      if (block) written.push(program.id);
    }
    assert.deepEqual(
      written,
      ['p2', 'p3'],
      'FAM-1 6c-i: …and leaves out only the program that holds that item',
    );
    assert.equal(
      (await assignmentRows(tx)).assignments.filter(
        (r) => r.deletedAt === null && Object.values(SEED_FIXTURE_ATHLETES).includes(r.profile),
      ).length,
      // Household A's seeded stretches only: A's seed athletes are not B's, so B puts none on.
      SEED_FIXTURE_COUNTS.assignments,
      'FAM-1 6c-i: …and puts no athlete of another household on its programs',
    );
  });
  console.log(
    '✓ FAM-1 6c-i: the seeded fixture programs equal the contract’s workouts and weeks, the seed’s athletes are on them in order, and a re-run writes nothing',
  );
}

// ── FAM-1 caps (C35, invariant 30): items, workouts and a weekday's slots ──────────────────────────

/** A new household of its own, so a count is exact: the caps are per household and per program. */
async function capsHousehold(tx: VerifyTx) {
  const [household] = await tx
    .insert(schema.households)
    .values({ publicId: newId(), name: 'Verify caps' })
    .returning({ id: schema.households.id });
  return Object.assign(householdScopeForScript(household!.id), { proofId: household!.id });
}

async function verifyCaps(): Promise<void> {
  // ── The household's own items ──
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    const scope = await capsHousehold(tx);
    for (let i = 0; i < MAX_HOUSEHOLD_ITEMS - 1; i++) {
      await insertMovementOwnedBy(exec, scope, {
        publicId: newId(),
        slug: `caps-item-${i}`,
        name: `Caps Item ${i}`,
        isBodyweight: false,
        trackingType: TRACKING_TYPE.reps,
      });
    }
    // An item a catalog row shadows (its slug is a catalog slug): the picker does not list it, so it
    // never counts toward the cap.
    await insertMovementOwnedBy(exec, scope, {
      publicId: newId(),
      slug: MOVEMENT_SEED_ROWS[0]!.slug,
      name: 'Caps shadowed item',
      isBodyweight: false,
      trackingType: TRACKING_TYPE.reps,
    });
    const own = async () =>
      (
        await tx
          .select({ id: schema.movements.id })
          .from(schema.movements)
          .where(movementInHousehold(scope))
      ).length;
    const add = (name: string) => newItem(exec, scope, { name, trackingType: TRACKING_TYPE.reps });

    const last = await add('Caps Last Drill');
    assert.ok(last.ok && !last.existed, 'FAM-1 caps: the item that reaches the cap is made');
    assert.equal(
      await own(),
      MAX_HOUSEHOLD_ITEMS + 1,
      'FAM-1 caps: …and the household holds the cap, plus the shadowed item it does not count',
    );
    // The lock was taken under its namespace, keyed by the household (waiting is unprovable on
    // PGlite's one connection; the key is not).
    const [key] = (await tx.execute(sql`select hashint8(${scope.proofId}::bigint) as k`))
      .rows as Array<{ k: number }>;
    const locks = (
      await tx.execute(
        sql`select classid::bigint as c, objid::bigint as o from pg_locks where locktype = 'advisory' and objsubid = 2`,
      )
    ).rows as Array<{ c: string | number; o: string | number }>;
    assert.ok(
      locks.some(
        (l) =>
          Number(l.c) === ADVISORY_LOCK.householdItems &&
          Number(l.o) === (Number(key!.k) + 2 ** 32) % 2 ** 32,
      ),
      'FAM-1 caps: newItem holds the household-items advisory lock, keyed by its household',
    );
    assert.deepEqual(
      await add('Caps One Too Many'),
      { ok: false, reason: PROGRAM_REFUSAL.limit_reached },
      'FAM-1 caps: a new item past the household’s cap is limit_reached',
    );
    assert.equal(await own(), MAX_HOUSEHOLD_ITEMS + 1, 'FAM-1 caps: …and writes nothing');
    const again = await add('caps last drill');
    assert.ok(
      again.ok && again.existed && again.itemPublicId === (last.ok ? last.itemPublicId : ''),
      'FAM-1 caps: at the cap, a name the household already has selects its item',
    );
    const library = await newItem(exec, scope, {
      name: MOVEMENT_SEED_ROWS[0]!.name,
      trackingType: TRACKING_TYPE.reps,
    });
    assert.ok(
      library.ok && library.existed,
      'FAM-1 caps: at the cap, a library item is still selected',
    );
  });

  // ── A program's workouts, a copy's destination, and a weekday's slots ──
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    const scope = await capsHousehold(tx);
    const full = await mustCreate(tx, scope, 'Caps full program');
    const roomy = await mustCreate(tx, scope, 'Caps roomy program');
    const workouts: string[] = [];
    for (let i = 0; i < MAX_PROGRAM_WORKOUTS - 1; i++) {
      workouts.push(await mustSaveWorkout(tx, scope, full, `Caps workout ${i}`));
    }
    const count = async (programPublicId: string) =>
      (
        await tx
          .select({ id: schema.workouts.id })
          .from(schema.workouts)
          .innerJoin(schema.programBlocks, eq(schema.programBlocks.id, schema.workouts.blockId))
          .where(
            and(
              eq(schema.programBlocks.publicId, programPublicId),
              isNull(schema.workouts.deletedAt),
            ),
          )
      ).length;
    const fresh = (programPublicId: string, name: string, clientId = newId()) =>
      saveWorkout(exec, scope, {
        programPublicId,
        workoutPublicId: null,
        workoutClientId: clientId,
        name,
        description: null,
        items: [],
      });

    const lastClient = newId();
    const lastSaved = await fresh(full, 'Caps workout last', lastClient);
    assert.ok(lastSaved.ok, 'FAM-1 caps: the workout that reaches the cap is saved');
    assert.deepEqual(
      await fresh(full, 'Caps workout over'),
      { ok: false, reason: PROGRAM_REFUSAL.limit_reached },
      'FAM-1 caps: a new workout past the program’s cap is limit_reached',
    );
    assert.deepEqual(
      await fresh(full, 'Caps workout 0'),
      { ok: false, reason: PROGRAM_REFUSAL.limit_reached },
      'FAM-1 caps: …judged before the name: a full program says so, even for a taken name',
    );
    assert.deepEqual(
      await saveWorkout(exec, scope, {
        programPublicId: full,
        workoutPublicId: newId(),
        workoutClientId: newId(),
        name: 'Caps workout stale',
        description: null,
        items: [],
      }),
      { ok: false, reason: PROGRAM_REFUSAL.not_found },
      'FAM-1 caps: …but a stale workout id in a full program is not_found, asked first',
    );
    assert.equal(await count(full), MAX_PROGRAM_WORKOUTS, 'FAM-1 caps: …and writes nothing');
    assert.deepEqual(
      await fresh(full, 'Caps workout last', lastClient),
      lastSaved,
      'FAM-1 caps: a replay at the cap answers as the first save did',
    );
    const renamed = await saveWorkout(exec, scope, {
      programPublicId: full,
      workoutPublicId: workouts[0]!,
      workoutClientId: newId(),
      name: 'Caps workout renamed',
      description: null,
      items: [],
    });
    assert.ok(renamed.ok, 'FAM-1 caps: an edit at the cap is never capped');

    // A copy counts the program it lands in.
    const copy = (to: string, clientId = newId()) =>
      copyWorkout(exec, scope, {
        clientId,
        workoutPublicId: workouts[1]!,
        toProgramPublicId: to,
        weekdays: [],
        label: null,
      });
    assert.deepEqual(
      await copy(full),
      { ok: false, reason: PROGRAM_REFUSAL.limit_reached },
      'FAM-1 caps: a copy into a full program is limit_reached',
    );
    assert.deepEqual(
      await copyWorkout(exec, scope, {
        clientId: newId(),
        workoutPublicId: workouts[1]!,
        toProgramPublicId: full,
        name: 'Caps workout 3',
        weekdays: [],
        label: null,
      }),
      { ok: false, reason: PROGRAM_REFUSAL.limit_reached },
      'FAM-1 caps: …judged before the name: a copy named like a workout of the full program says it is full',
    );
    assert.deepEqual(
      await copyWorkout(exec, scope, {
        clientId: newId(),
        workoutPublicId: newId(),
        toProgramPublicId: full,
        weekdays: [],
        label: null,
      }),
      { ok: false, reason: PROGRAM_REFUSAL.not_found },
      'FAM-1 caps: …but a copy of an unknown workout into a full program is not_found, asked first',
    );
    const copyClient = newId();
    const intoRoomy = await copy(roomy, copyClient);
    assert.ok(
      intoRoomy.ok,
      'FAM-1 caps: a copy from a full program into another is made (the destination counts)',
    );
    for (let i = await count(roomy); i < MAX_PROGRAM_WORKOUTS; i++) {
      await mustSaveWorkout(tx, scope, roomy, `Caps roomy ${i}`);
    }
    assert.deepEqual(
      await copy(roomy, copyClient),
      intoRoomy,
      'FAM-1 caps: a replayed copy into a program full since answers as it did',
    );

    // Hide one: a new workout fits again (only live workouts count).
    await tx
      .update(schema.workouts)
      .set({ deletedAt: sql`now()` })
      .where(eq(schema.workouts.publicId, workouts[2]!));
    assert.ok(
      (await fresh(full, 'Caps workout after a removal')).ok,
      'FAM-1 caps: a removed workout frees its place',
    );

    // A weekday's slots.
    const day = (n: number, repeat = false) =>
      weekOf({
        1: [
          ...workouts.slice(3, 3 + n).map((w) => slot(w)),
          ...(repeat ? [slot(workouts[3]!)] : []),
        ],
      });
    assert.deepEqual(
      await saveWeek(exec, scope, { programPublicId: full, days: day(MAX_DAY_SLOTS) }),
      { ok: true },
      'FAM-1 caps: a weekday of exactly MAX_DAY_SLOTS workouts is saved',
    );
    const before = await slotRows(tx);
    assert.deepEqual(
      await saveWeek(exec, scope, { programPublicId: full, days: day(MAX_DAY_SLOTS + 1) }),
      { ok: false, reason: PROGRAM_REFUSAL.limit_reached },
      'FAM-1 caps: a weekday past MAX_DAY_SLOTS is limit_reached',
    );
    assert.deepEqual(
      await saveWeek(exec, scope, { programPublicId: full, days: day(MAX_DAY_SLOTS + 1, true) }),
      { ok: false, reason: PROGRAM_REFUSAL.once_per_day },
      'FAM-1 caps: …but a repeat on that day is asked first (once_per_day)',
    );
    assert.deepEqual(await slotRows(tx), before, 'FAM-1 caps: …and neither writes anything');

    // A copy onto a weekday that holds MAX_DAY_SLOTS: refused whole, nothing written (C35, (a)).
    const spare = await mustCreate(tx, scope, 'Caps week program');
    const dayWorkouts: string[] = [];
    for (let i = 0; i < MAX_DAY_SLOTS + 1; i++) {
      dayWorkouts.push(await mustSaveWorkout(tx, scope, spare, `Caps day ${i}`));
    }
    assert.deepEqual(
      await saveWeek(exec, scope, {
        programPublicId: spare,
        days: weekOf({ 1: dayWorkouts.slice(0, MAX_DAY_SLOTS).map((w) => slot(w)) }),
      }),
      { ok: true },
      'FAM-1 caps: the proof fills Monday',
    );
    const workoutsBefore = await count(spare);
    const slotsBefore = await slotRows(tx);
    assert.deepEqual(
      await copyWorkout(exec, scope, {
        clientId: newId(),
        workoutPublicId: dayWorkouts[0]!,
        toProgramPublicId: spare,
        weekdays: [2, 1],
        label: null,
      }),
      { ok: false, reason: PROGRAM_REFUSAL.limit_reached },
      'FAM-1 caps: a copy onto a full weekday is limit_reached',
    );
    assert.deepEqual(
      await copyWorkout(exec, scope, {
        clientId: newId(),
        workoutPublicId: dayWorkouts[0]!,
        toProgramPublicId: spare,
        name: 'Caps day 1',
        weekdays: [1],
        label: null,
      }),
      { ok: false, reason: PROGRAM_REFUSAL.limit_reached },
      'FAM-1 caps: …judged before the name: a copy onto a full weekday named like a workout there says it is full',
    );
    assert.deepEqual(
      [await count(spare), await slotRows(tx)],
      [workoutsBefore, slotsBefore],
      'FAM-1 caps: …and writes nothing, on any day',
    );
    assert.ok(
      (
        await copyWorkout(exec, scope, {
          clientId: newId(),
          workoutPublicId: dayWorkouts[0]!,
          toProgramPublicId: spare,
          weekdays: [2],
          label: null,
        })
      ).ok,
      'FAM-1 caps: a copy onto a day with room is made',
    );
  });
  console.log(
    '✓ FAM-1 caps: items, workouts (a copy counts its destination) and a weekday’s slots answer limit_reached past their caps; an edit, a replay and an existing item never do',
  );
}
