import assert from 'node:assert/strict';

import {
  MAX_REPS_PER_SET,
  movementSlug,
  newId,
  PROGRAM_BLOCK_KIND,
  PROGRAM_NAME_MAX,
  PROGRAM_REFUSAL,
  PROGRAM_SEED,
  QUANTITY_SLOT,
  SLOT_LABEL_MAX,
  TRACKING_TYPE,
  emptyWeek,
  WEEKDAYS,
  weekDaysSchema,
} from '@mat-plan/shared';
import { heavyADraft } from '@mat-plan/shared/program/fixtures';
import type { WeekDraft, WorkoutDraft } from '@mat-plan/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { schema } from '../../src/client';
import type { HouseholdScope } from '../../src/scope';
import {
  insertMovementOwnedBy,
  insertProgramBlockOwnedBy,
  programBlockInHousehold,
  programBlockIsLegacy,
} from '../../src/writers/ownership';
import { createProgram } from '../../src/writers/program/create-program';
import { lostSlugRace } from '../../src/writers/program/program-name';
import { renameProgram } from '../../src/writers/program/rename-program';
import { programIn, readWeek, readWorkoutDraft, workoutIn } from '../../src/queries/program';
import { saveWeek } from '../../src/writers/program/save-week';
import { saveWorkout } from '../../src/writers/program/save-workout';
import { SHIFT_BAND } from '../../src/writers/program/shift-band';
import { asTx, rolledBack, type VerifyContext, type VerifyTx } from './harness';
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
