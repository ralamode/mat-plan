import assert from 'node:assert/strict';

import { movementSlug, newId, PROGRAM_BLOCK_KIND, PROGRAM_REFUSAL } from '@mat-plan/shared';
import { and, eq, sql } from 'drizzle-orm';

import { schema } from '../../src/client';
import type { HouseholdScope } from '../../src/scope';
import { programBlockInHousehold } from '../../src/writers/ownership';
import { createProgram } from '../../src/writers/program/create-program';
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
}

/** A program block of `scope`'s household, by public id, as the proofs compare it. */
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

/** How many blocks `scope`'s household holds, hidden ones included. */
async function blocksIn(tx: VerifyTx, scope: HouseholdScope): Promise<number> {
  const rows = await tx
    .select({ id: schema.programBlocks.id })
    .from(schema.programBlocks)
    .where(programBlockInHousehold(scope));
  return rows.length;
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
      .select({ householdId: schema.programBlocks.householdId })
      .from(schema.programBlocks)
      .where(and(eq(schema.programBlocks.publicId, heavy), programBlockInHousehold(A_SCOPE)));
    assert.ok(aOwn, "FAM-1 6a-i: the program is the caller's household's");

    // ── a replay answers the first call's program, and adds nothing ──
    const before = await blocksIn(tx, A_SCOPE);
    for (const name of ['Heavy A', 'Something else']) {
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
      { clientId: newId(), name: 'x'.repeat(61) },
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
    const [legacy] = await tx
      .select({ name: schema.programBlocks.name, slug: schema.programBlocks.slug })
      .from(schema.programBlocks)
      .where(
        and(
          programBlockInHousehold(A_SCOPE),
          eq(schema.programBlocks.kind, PROGRAM_BLOCK_KIND.legacy),
          sql`${schema.programBlocks.deletedAt} is null`,
        ),
      );
    assert.ok(legacy, 'FAM-1 6a-i: household A has the seeded block (the proof below needs it)');
    // Its name is not a program's, so it is not taken.
    await mustCreate(tx, A_SCOPE, legacy.name);
    // Its slug is: a program whose name slugs to it is suffixed past it (the slug index spans kinds).
    assert.equal(movementSlug(legacy.slug), legacy.slug, 'the seeded slug is its own movementSlug');
    const sameSlug = await mustCreate(tx, A_SCOPE, legacy.slug);
    assert.equal(
      (await blockRow(tx, sameSlug))?.slug,
      `${legacy.slug}-2`,
      "FAM-1 6a-i: a program is slugged past the seeded block's slug",
    );

    // ── another household: its own names, its own client ids ──
    const bHeavy = await mustCreate(tx, B_SCOPE, 'Heavy A', clientId);
    assert.notEqual(bHeavy, heavy, "FAM-1 6a-i: the same client id in B is B's own program");
    assert.notEqual(
      (await blockRow(tx, bHeavy))?.householdId,
      row?.householdId,
      "FAM-1 6a-i: B's program is in B's household",
    );

    // ── a removed program: its replay is not_found; its name and slug are free again ──
    await hide(tx, heavy);
    assert.deepEqual(
      await createProgram(exec, A_SCOPE, { clientId, name: 'Heavy A' }),
      { ok: false, reason: PROGRAM_REFUSAL.not_found },
      'FAM-1 6a-i: replaying the create of a removed program is not_found, not a second program',
    );
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
    assert.equal((await blockRow(tx, heavy))?.name, 'Heavy B', 'FAM-1 6a-i: the name is stored');
    assert.equal(
      (await blockRow(tx, heavy))?.slug,
      movementSlug('Heavy A'),
      'FAM-1 6a-i: a rename keeps the slug',
    );
    assert.deepEqual(
      await renameProgram(exec, A_SCOPE, { programPublicId: heavy, name: 'heavy b' }),
      { ok: true },
      "FAM-1 6a-i: a program's own name, re-spelt, is not taken",
    );

    for (const name of ['Light A', 'light  a']) {
      assert.deepEqual(
        await renameProgram(exec, A_SCOPE, { programPublicId: heavy, name }),
        { ok: false, reason: PROGRAM_REFUSAL.name_taken },
        `FAM-1 6a-i: renaming to "${name}", another program's name, is name_taken`,
      );
    }
    for (const name of ['', '  ', 'x'.repeat(61)]) {
      assert.deepEqual(
        await renameProgram(exec, A_SCOPE, { programPublicId: heavy, name }),
        { ok: false, reason: PROGRAM_REFUSAL.invalid },
        `FAM-1 6a-i: renaming to ${JSON.stringify(name)} is invalid`,
      );
    }
    assert.equal(
      (await blockRow(tx, heavy))?.name,
      'heavy b',
      'FAM-1 6a-i: a refusal writes nothing',
    );

    // ── not_found, the same answer for each: another household's, the seeded block, removed, unknown ──
    const [legacy] = await tx
      .select({ publicId: schema.programBlocks.publicId, name: schema.programBlocks.name })
      .from(schema.programBlocks)
      .where(
        and(
          programBlockInHousehold(A_SCOPE),
          eq(schema.programBlocks.kind, PROGRAM_BLOCK_KIND.legacy),
        ),
      );
    assert.ok(legacy, 'FAM-1 6a-i: household A has the seeded block (the proof below needs it)');
    await hide(tx, light);
    const cases: Array<[string, string]> = [
      ["another household's program", theirs],
      ['the seeded (legacy) block', legacy.publicId],
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
    assert.equal(
      (await blockRow(tx, theirs))?.name,
      'Theirs',
      "FAM-1 6a-i: B's program is unchanged",
    );
    assert.equal(
      (await blockRow(tx, legacy.publicId))?.name,
      legacy.name,
      'FAM-1 6a-i: the seeded block is unchanged',
    );
    assert.equal(
      (await blockRow(tx, light))?.name,
      'Light A',
      'FAM-1 6a-i: a removed one is unchanged',
    );
  });
  console.log('✓ FAM-1 6a-i: renameProgram (name_taken, invalid, not_found across households)');
}
