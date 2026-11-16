import assert from 'node:assert/strict';

import {
  movementSlug,
  newId,
  PROGRAM_BLOCK_KIND,
  PROGRAM_NAME_MAX,
  PROGRAM_REFUSAL,
  PROGRAM_SEED,
} from '@mat-plan/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { schema } from '../../src/client';
import type { HouseholdScope } from '../../src/scope';
import {
  insertProgramBlockOwnedBy,
  programBlockInHousehold,
  programBlockIsLegacy,
} from '../../src/writers/ownership';
import { createProgram } from '../../src/writers/program/create-program';
import { lostSlugRace } from '../../src/writers/program/program-name';
import { renameProgram } from '../../src/writers/program/rename-program';
import { asTx, rolledBack, type VerifyContext, type VerifyTx } from './harness';

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
