import assert from 'node:assert/strict';

import {
  EQUIPMENT,
  MODALITIES,
  MODALITY,
  MUSCLE_ROLE,
  MUSCLE_ROLES,
  MUSCLES,
  newId,
} from '@mat-plan/shared';
import { eq, sql } from 'drizzle-orm';

import { schema } from '../../src/client';
import { graphTableName, HOUSEHOLD_GRAPH } from '../../src/erasure/graph';
import { insertMovementOwnedBy } from '../../src/writers/ownership';
import {
  assertCheckCoversConst,
  assertRefTableMatches,
  asTx,
  constraintDef,
  db,
  expectRejectedBy,
  rolledBack,
  rowsOf,
  type VerifyContext,
  type VerifyTx,
} from './harness';

/**
 * `CAT-3` A1's proofs: the movement library's tables (`docs/plans/cat-3-a1-catalog-tables.md`,
 * spec S1–S6). Lane A owns this file alone. Two entry points, because two of the facts are only
 * true of the migration at one point in `verify.ts`:
 *
 * - {@link verifyCatalogMigrationFacts} runs right after `migrate()`, before `seed()` and before the
 *   V1-1b simulation drops and re-adds `movements_global_row_has_pattern` by hand. It proves S5 on
 *   **0032's** constraint, and returns that constraint's definition for the comparison after the
 *   re-add. It depends on no seeded row.
 * - {@link verifyCatalogTables} runs last, with the other modules, and proves everything else.
 *
 * Every planted row is inside `rolledBack`. The order inside each function is fixed so that each
 * mutation's `.expect` names the first failure (the plan's § Test plan); keep it when adding a proof.
 */

/** A probe insert of one `movements` row: the columns the CHECKs read, and nothing a seed provides. */
function movementRow(slug: string, over: Partial<typeof schema.movements.$inferInsert>) {
  return { publicId: newId(), slug, name: slug, ...over };
}

/** `expectRejectedBy`, failing on `what` so a mutation's `.expect` can tell two proofs apart. */
async function refused(what: string, conname: string, fn: () => Promise<unknown>, tx: VerifyTx) {
  try {
    await expectRejectedBy(conname, fn, tx);
  } catch (e) {
    assert.fail(`${what} (${(e as Error).message})`);
  }
}

/** An insert that must succeed, failing on `what` if Postgres refuses it. */
async function accepted(what: string, fn: () => Promise<unknown>, tx: VerifyTx) {
  try {
    await tx.transaction(async () => {
      await fn();
    });
  } catch (e) {
    const cause = (e as { cause?: { constraint?: string } }).cause?.constraint ?? '(none)';
    assert.fail(`${what} (refused by '${cause}')`);
  }
}

export async function verifyCatalogMigrationFacts(): Promise<string> {
  const CHECK = schema.MOVEMENT_GLOBAL_ROW_HAS_PATTERN_CHECK;
  await rolledBack(async (tx) => {
    // `310`: without `modality IS NOT NULL`, NULL <> 'strength' is NULL and this row passes.
    await refused(
      `CAT-3 A1 S5: a global row with no pattern and no modality is refused by 0032's ${CHECK}`,
      CHECK,
      () => tx.insert(schema.movements).values(movementRow('cat3_a1_no_pattern_no_modality', {})),
      tx,
    );
    // `311`: a strength catalog row still needs its lift pattern.
    await refused(
      `CAT-3 A1 S5: a global strength row with no pattern is refused by 0032's ${CHECK}`,
      CHECK,
      () =>
        tx
          .insert(schema.movements)
          .values(movementRow('cat3_a1_strength_no_pattern', { modality: MODALITY.strength })),
      tx,
    );
    await accepted(
      `CAT-3 A1 S5: a global mobility row with no pattern is accepted by 0032's ${CHECK}`,
      () =>
        tx
          .insert(schema.movements)
          .values(movementRow('cat3_a1_mobility_no_pattern', { modality: MODALITY.mobility })),
      tx,
    );
  });
  const def = await constraintDef(CHECK);
  console.log(`✓ CAT-3 A1 S5: 0032's ${CHECK} refuses both bad global rows (read before V1-1b)`);
  return def;
}

/** The V1-1b re-add, compared with the definition {@link verifyCatalogMigrationFacts} returned. */
export async function assertGlobalCheckMatchesMigration(migrated: string): Promise<void> {
  const CHECK = schema.MOVEMENT_GLOBAL_ROW_HAS_PATTERN_CHECK;
  const reAdded = (await constraintDef(CHECK)).replace(/ NOT VALID$/, '');
  assert.equal(
    reAdded,
    migrated,
    `CAT-3 A1 S5: the V1-1b simulation re-adds ${CHECK} with the migration's own predicate (movementGlobalRowHasPattern)`,
  );
}

/** One foreign key out of a join table, as Postgres stores it. */
type ForeignKey = { child: string; column: string; parent: string };

export async function verifyCatalogTables(ctx: VerifyContext): Promise<void> {
  // ── S1 first: `321` drops a muscle from the seed, and every muscle planted below is `.at(-1)` ──
  const equipmentRows = await db.select({ code: schema.equipment.code }).from(schema.equipment);
  const muscleRows = await db.select({ code: schema.muscles.code }).from(schema.muscles);
  assertRefTableMatches(
    'equipment',
    equipmentRows,
    EQUIPMENT.map((code) => ({ code })),
  );
  assertRefTableMatches(
    'muscles',
    muscleRows,
    MUSCLES.map((code) => ({ code })),
  );

  // ── S5 and the role CHECK: each pinned to its shared const, both directions ──
  await assertCheckCoversConst(schema.MOVEMENT_MODALITY_CHECK, MODALITIES);
  await assertCheckCoversConst(schema.MOVEMENT_MUSCLES_ROLE_CHECK, MUSCLE_ROLES);

  // ── S2: exactly the four FKs, each led by a non-partial index (before any insert: `323`) ──
  const fks = rowsOf<ForeignKey>(
    await db.execute(sql`
      SELECT c.relname AS child, a.attname AS "column", p.relname AS parent
      FROM pg_constraint k
      JOIN pg_class c ON c.oid = k.conrelid
      JOIN pg_class p ON p.oid = k.confrelid
      JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
      WHERE k.contype = 'f' AND c.relname IN ('movement_equipment', 'movement_muscles')`),
  );
  const fkKey = (f: ForeignKey) => `${f.child}.${f.column} → ${f.parent}`;
  assert.deepEqual(
    fks.map(fkKey).sort(),
    [
      'movement_equipment.equipment_code → equipment',
      'movement_equipment.movement_id → movements',
      'movement_muscles.movement_id → movements',
      'movement_muscles.muscle_code → muscles',
    ],
    'CAT-3 A1 S2: the join tables have exactly their four foreign keys',
  );
  for (const fk of fks) {
    const covering = rowsOf<{ n: number }>(
      await db.execute(sql`
        SELECT count(*)::int AS n
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indrelid
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
        WHERE c.relname = ${fk.child} AND a.attname = ${fk.column} AND i.indpred IS NULL`),
    );
    assert.ok(
      covering[0].n > 0,
      `CAT-3 A1 S2: ${fkKey(fk)} is led by a non-partial covering index`,
    );
  }

  // ── S4 on the seeded database: no join row belongs to a household's own movement ──
  const householdJoinRows = async (exec: { execute: typeof db.execute }) =>
    rowsOf<{ n: number }>(
      await exec.execute(sql`
        SELECT count(*)::int AS n FROM (
          SELECT movement_id FROM movement_equipment UNION ALL SELECT movement_id FROM movement_muscles
        ) j JOIN movements m ON m.id = j.movement_id
        WHERE m.household_id IS NOT NULL`),
    )[0].n;
  assert.equal(
    await householdJoinRows(db),
    0,
    "CAT-3 A1 S4: no household's own movement has an equipment or muscle row (no writer makes one)",
  );

  const [muscle, otherMuscle] = [MUSCLES.at(-1)!, MUSCLES.at(-2)!];
  const tool = EQUIPMENT.at(-1)!;

  await rolledBack(async (tx) => {
    const [global] = await tx
      .insert(schema.movements)
      .values(movementRow('cat3_a1_global', { modality: MODALITY.mobility }))
      .returning({ id: schema.movements.id });
    // B's own movement, through the writer that owns household rows (a proof never opens a scope).
    const ownPublicId = newId();
    await insertMovementOwnedBy(asTx(tx), ctx.B_SCOPE, {
      publicId: ownPublicId,
      slug: 'cat3_a1_own',
      name: 'cat3_a1_own',
      isBodyweight: false,
    });
    const [own] = await tx
      .select({ id: schema.movements.id })
      .from(schema.movements)
      .where(eq(schema.movements.publicId, ownPublicId));

    // S4: `312`. A modality other than `skill`, which `313` drops from the IN-list.
    await refused(
      'CAT-3 A1 S4: a household row given a modality is refused',
      schema.MOVEMENT_HOUSEHOLD_ROW_HAS_NO_MODALITY_CHECK,
      () =>
        tx
          .update(schema.movements)
          .set({ modality: MODALITY.conditioning })
          .where(eq(schema.movements.id, own.id)),
      tx,
    );

    // S3: `314`. Two different muscles, so with the index gone the pair-unique does not refuse instead.
    await tx
      .insert(schema.movementMuscles)
      .values({ movementId: global.id, muscleCode: muscle, role: MUSCLE_ROLE.primary });
    await refused(
      'CAT-3 A1 S3: a second primary muscle on one movement is refused',
      schema.MOVEMENT_MUSCLES_ONE_PRIMARY_UNIQUE_INDEX,
      () =>
        tx
          .insert(schema.movementMuscles)
          .values({ movementId: global.id, muscleCode: otherMuscle, role: MUSCLE_ROLE.primary }),
      tx,
    );
    await accepted(
      'CAT-3 A1 S3: a secondary muscle beside the primary is accepted',
      () =>
        tx
          .insert(schema.movementMuscles)
          .values({ movementId: global.id, muscleCode: otherMuscle, role: MUSCLE_ROLE.secondary }),
      tx,
    );
    // `315`, `316`.
    await refused(
      'CAT-3 A1: the same muscle twice on one movement is refused',
      schema.MOVEMENT_MUSCLES_PAIR_UNIQUE_INDEX,
      () =>
        tx
          .insert(schema.movementMuscles)
          .values({ movementId: global.id, muscleCode: muscle, role: MUSCLE_ROLE.secondary }),
      tx,
    );
    await tx
      .insert(schema.movementEquipment)
      .values({ movementId: global.id, equipmentCode: tool });
    await refused(
      'CAT-3 A1: the same equipment twice on one movement is refused',
      schema.MOVEMENT_EQUIPMENT_PAIR_UNIQUE_INDEX,
      () =>
        tx.insert(schema.movementEquipment).values({ movementId: global.id, equipmentCode: tool }),
      tx,
    );
    // After the exact FK set, so `323` fails there first.
    await refused(
      'CAT-3 A1 S2: a muscle code the muscles table does not hold is refused',
      'movement_muscles_muscle_code_muscles_code_fk',
      () =>
        tx
          .insert(schema.movementMuscles)
          .values({
            movementId: global.id,
            muscleCode: 'not_a_muscle',
            role: MUSCLE_ROLE.secondary,
          }),
      tx,
    );

    // The household's own movement gets one row of each, so S2 and S4's self-check have a red half.
    await tx.insert(schema.movementEquipment).values({ movementId: own.id, equipmentCode: tool });
    await tx
      .insert(schema.movementMuscles)
      .values({ movementId: own.id, muscleCode: muscle, role: MUSCLE_ROLE.primary });

    // S2: `318`, `319`. A global movement's rows are matched by no household; P7 cannot see this,
    // because none of its fixture rows is on a global movement.
    for (const table of [schema.movementEquipment, schema.movementMuscles]) {
      const entry = HOUSEHOLD_GRAPH.find((g) => g.table === table);
      assert.ok(entry, `CAT-3 A1 S2: ${graphTableName(table)} is in HOUSEHOLD_GRAPH`);
      const globalIds = rowsOf<{ id: number | string }>(
        await tx.execute(sql`SELECT id FROM ${table} WHERE movement_id = ${global.id}`),
      ).map((r) => Number(r.id));
      for (const [name, scope] of [
        ['A', ctx.A_SCOPE],
        ['B', ctx.B_SCOPE],
      ] as const) {
        const matched: number[] = rowsOf<{ id: number | string }>(
          await tx.execute(sql`SELECT id FROM ${table} WHERE ${entry.householdRows(scope)}`),
        ).map((r) => Number(r.id));
        assert.deepEqual(
          matched.filter((id) => globalIds.includes(id)),
          [],
          `CAT-3 A1 S2: no ${graphTableName(table)} row of a global movement is matched by household ${name}`,
        );
      }
    }

    // S4's self-check: the same query finds the planted household rows, and not the global ones.
    assert.equal(
      await householdJoinRows(tx),
      2,
      "CAT-3 A1 S4: the household-row query finds a planted row on a household's movement, and none on a global one",
    );
  });

  console.log(
    '✓ CAT-3 A1: equipment and muscles mirror their consts; the join tables refuse a second primary, a duplicate and an unknown code; a global movement’s rows belong to no household',
  );
}
