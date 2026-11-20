import assert from 'node:assert/strict';

import {
  type CatalogMovement,
  EQUIPMENT,
  MODALITIES,
  MODALITY,
  MUSCLE_ROLE,
  MUSCLE_ROLES,
  MOVEMENT_SEED_ROWS,
  MUSCLES,
  newId,
  type Muscle,
} from '@mat-plan/shared';
import { CATALOG_MOVEMENTS } from '@mat-plan/shared/catalog/data';
import { CATALOG_FIXTURE } from '@mat-plan/shared/catalog/fixture';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { schema } from '../../src/client';
import { graphTableName, HOUSEHOLD_GRAPH } from '../../src/erasure/graph';
import type { Database } from '../../src/client';
import { reportSeed, seedCatalog, seedReference } from '../../src/seed';
import { insertMovementOwnedBy, movementIsCatalog } from '../../src/writers/ownership';
import { CORRECTIONS, MOVEMENTS_OWNERSHIP_REPORT_NAME } from '../corrections/registry';
import {
  assertCheckCoversConst,
  assertRefTableMatches,
  asDb,
  asPg,
  asTx,
  captureOutput,
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
  // CAT-3 A2-i first: its forced-failure proof runs outside any transaction (D5.1).
  await verifyCatalogSeedWriter(ctx);

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
        tx.insert(schema.movementMuscles).values({
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
      assert.ok(
        globalIds.length > 0,
        `CAT-3 A1 S2: the proof planted ${graphTableName(table)} rows on a global movement`,
      );
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

// ── CAT-3 A2-i: the catalog seed's writer (`docs/plans/cat-3-a2-i-catalog-seed.md`, D5) ──────────

/** The stored fields of an entry, as the catalog row must hold them (spec E1). */
function storedFieldsOf(entry: CatalogMovement) {
  return {
    slug: entry.slug,
    name: entry.name,
    modality: entry.modality,
    pattern: entry.pattern,
    trackingType: entry.trackingType,
    unitDefault: entry.unitDefault,
    isBodyweight: entry.isBodyweight,
  };
}

/** What one entry's join rows must be: equipment and secondaries in authored order, primary first. */
function joinRowsOf(entry: CatalogMovement) {
  return {
    equipment: [...entry.equipment],
    muscles: [
      ...(entry.primaryMuscle ? [`primary:${entry.primaryMuscle}`] : []),
      ...entry.secondaryMuscles.map((m) => `secondary:${m}`),
    ],
  };
}

/**
 * The catalog rows (`movementIsCatalog()`) on `slugs` (all of them when omitted), with their stored
 * fields and join rows in identity order, keyed by slug. Read on `tx`, never on `db` (PGlite has one
 * connection).
 */
async function catalogStateOn(tx: VerifyTx, slugs?: readonly string[]) {
  const m = schema.movements;
  const rows = await tx
    .select({
      id: m.id,
      slug: m.slug,
      name: m.name,
      modality: m.modality,
      pattern: m.pattern,
      trackingType: m.trackingType,
      unitDefault: m.unitDefault,
      isBodyweight: m.isBodyweight,
    })
    .from(m)
    .where(slugs ? and(movementIsCatalog(), inArray(m.slug, [...slugs])) : movementIsCatalog());
  const ids = rows.map((r) => r.id);
  const equipment =
    ids.length === 0
      ? []
      : await tx
          .select({
            movementId: schema.movementEquipment.movementId,
            code: schema.movementEquipment.equipmentCode,
          })
          .from(schema.movementEquipment)
          .where(inArray(schema.movementEquipment.movementId, ids))
          .orderBy(asc(schema.movementEquipment.id));
  const muscles =
    ids.length === 0
      ? []
      : await tx
          .select({
            movementId: schema.movementMuscles.movementId,
            code: schema.movementMuscles.muscleCode,
            role: schema.movementMuscles.role,
          })
          .from(schema.movementMuscles)
          .where(inArray(schema.movementMuscles.movementId, ids))
          .orderBy(asc(schema.movementMuscles.id));
  return new Map(
    rows.map(({ id, ...stored }) => [
      stored.slug,
      {
        stored,
        equipment: equipment.filter((e) => e.movementId === id).map((e) => e.code),
        muscles: muscles.filter((x) => x.movementId === id).map((x) => `${x.role}:${x.code}`),
      },
    ]),
  );
}

/** Join rows of any movement on `slugs`, of any owner: the count a proof expects to be zero. */
async function joinRowCountOn(tx: VerifyTx, movementIds: readonly number[]): Promise<number> {
  if (movementIds.length === 0) return 0;
  const [e] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.movementEquipment)
    .where(inArray(schema.movementEquipment.movementId, [...movementIds]));
  const [mm] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.movementMuscles)
    .where(inArray(schema.movementMuscles.movementId, [...movementIds]));
  return (e?.n ?? 0) + (mm?.n ?? 0);
}

const LEGACY_SLUGS = new Set<string>(MOVEMENT_SEED_ROWS.map((r) => r.slug));

/**
 * D5.2, **E1 on a database with no global movements.** Called right after
 * `verifyCatalogMigrationFacts`, before Proof A's first seed, and entirely inside `rolledBack`, so
 * the shared verify database never holds a catalog row (erasure P7 and patches 318/319 stay as they
 * are until A2-ii).
 */
export async function verifyCatalogSeedOnAFreshDatabase(): Promise<void> {
  // CAT-3 A2-ii (mutation 515): no seed() path passes an empty library any more, so the writer's
  // empty-list guard (drizzle throws on an empty insert) is proved here, first, on its own.
  await rolledBack(async (tx) => {
    await assert.doesNotReject(
      () => seedReference(asDb(tx), { library: { entries: [], legacyMovements: true } }),
      'CAT-3 A2-ii: seedReference resolves on an empty library list (A2-i D5.4)',
    );
  });
  await rolledBack(async (tx) => {
    const [before] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.movements)
      .where(isNull(schema.movements.householdId));
    assert.equal(before?.n, 0, 'CAT-3 A2-i E1: the proof starts with no global movement');

    const counts = await seedReference(asDb(tx), {
      library: { entries: CATALOG_MOVEMENTS, legacyMovements: true },
    }).catch((e: unknown) =>
      assert.fail(`CAT-3 A2-i E1: the catalog seed resolves on a fresh database (${String(e)})`),
    );
    const state = await catalogStateOn(tx);

    // Both directions: no legacy row passes as a catalog row, and no entry is missing.
    assert.deepEqual(
      [...state.keys()].sort(),
      CATALOG_MOVEMENTS.map((e) => e.slug).sort(),
      'CAT-3 A2-i E1: the catalog rows (movementIsCatalog) are exactly the entries, both directions',
    );
    for (const entry of CATALOG_MOVEMENTS) {
      const row = state.get(entry.slug)!;
      assert.deepEqual(
        row.stored,
        storedFieldsOf(entry),
        `CAT-3 A2-i E1: ${entry.slug}'s stored fields are its entry's`,
      );
      assert.deepEqual(
        { equipment: row.equipment, muscles: row.muscles },
        joinRowsOf(entry),
        `CAT-3 A2-i E1: ${entry.slug}'s equipment and muscles are its entry's, in authored order`,
      );
    }
    const [legacy] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.movements)
      .where(and(isNull(schema.movements.householdId), isNull(schema.movements.modality)));
    const shared = CATALOG_MOVEMENTS.filter((e) => LEGACY_SLUGS.has(e.slug)).length;
    assert.equal(
      legacy?.n,
      MOVEMENT_SEED_ROWS.length - shared,
      'CAT-3 A2-i E1: the legacy rows that share no slug are still written, after the catalog',
    );
    assert.deepEqual(
      [counts.catalogInserted, counts.catalogPresent, counts.catalogDuplicates],
      [CATALOG_MOVEMENTS.length, 0, 0],
      'CAT-3 A2-i E1: the counts say every entry was inserted',
    );

    // Rule 7: a second run, every entry already present, resolves and writes nothing (D2's guards).
    const joinIds = async () => ({
      equipment: (
        await tx.select({ id: schema.movementEquipment.id }).from(schema.movementEquipment)
      )
        .map((r) => r.id)
        .sort(),
      muscles: (await tx.select({ id: schema.movementMuscles.id }).from(schema.movementMuscles))
        .map((r) => r.id)
        .sort(),
    });
    const idsBefore = await joinIds();
    let again: Awaited<ReturnType<typeof seedReference>> | undefined;
    await assert.doesNotReject(async () => {
      again = await seedReference(asDb(tx), {
        library: { entries: CATALOG_MOVEMENTS, legacyMovements: true },
      });
    }, 'CAT-3 A2-i rule 7: a second run, with every entry present, resolves');
    assert.deepEqual(
      [again!.catalogInserted, again!.catalogPresent],
      [0, CATALOG_MOVEMENTS.length],
      'CAT-3 A2-i E1: a second run inserts nothing and counts every entry as present',
    );
    assert.deepEqual(
      [await catalogStateOn(tx), await joinIds()],
      [state, idsBefore],
      'CAT-3 A2-i E2: …and leaves every present catalog row and its join rows untouched (the same ids)',
    );

    // Rule 7: an entry with no equipment and no muscles resolves, and writes the movement only.
    const bare: CatalogMovement = {
      ...CATALOG_MOVEMENTS.find((e) => e.modality !== MODALITY.strength)!,
      slug: 'cat3_a2_bare',
      equipment: [],
      primaryMuscle: null,
      secondaryMuscles: [],
    };
    await assert.doesNotReject(
      () => seedCatalog(asDb(tx), [bare]),
      'CAT-3 A2-i rule 7: an entry with no equipment and no muscles resolves',
    );
    const bareState = (await catalogStateOn(tx, [bare.slug])).get(bare.slug);
    assert.deepEqual(
      bareState && { equipment: bareState.equipment, muscles: bareState.muscles },
      { equipment: [], muscles: [] },
      'CAT-3 A2-i rule 7: …and writes the movement with no join row',
    );
  });
  console.log(
    '✓ CAT-3 A2-i: the catalog seed writes every entry once, idempotently, on a fresh database',
  );
}

/**
 * D5.1 and D5.3–D5.5, D5.7: the writer against the seeded verify database. The first proof runs at
 * top level on `db`, outside any transaction; the rest inside `rolledBack`.
 */
async function verifyCatalogSeedWriter(ctx: VerifyContext): Promise<void> {
  // D5.1, E1's one transaction. 🔴 Never `expectRejectedBy(…, tx)` here: its savepoint would roll the
  // partial rows back itself, and a writer with no transaction (mutation 502) could not fail.
  const ok = CATALOG_MOVEMENTS.find(
    (e) => e.equipment.length > 0 && e.secondaryMuscles.length > 0,
  )!;
  const forced: CatalogMovement[] = [
    { ...ok, slug: 'cat3_a2_forced_a' },
    { ...ok, slug: 'cat3_a2_forced_b', primaryMuscle: 'not_a_muscle' as Muscle },
  ];
  let violated: string | undefined;
  try {
    await seedCatalog(asPg, forced);
  } catch (e) {
    violated = (e as { cause?: { constraint?: string } })?.cause?.constraint;
  }
  assert.equal(
    violated,
    'movement_muscles_muscle_code_muscles_code_fk',
    'CAT-3 A2-i E1: a list with an unknown muscle code is refused by the muscles FK',
  );
  const [left] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.movements)
    .where(
      inArray(
        schema.movements.slug,
        forced.map((e) => e.slug),
      ),
    );
  assert.equal(left?.n, 0, 'CAT-3 A2-i E1: …and a failure part-way leaves no row: one transaction');

  // D5.3, E2: the legacy `sled_push` (a `weight_reps` row with a seed id and no modality; the entry is
  // `distance`) already holds the slug. Left exactly as it is, with no join row, and counted.
  await rolledBack(async (tx) => {
    const entry = CATALOG_MOVEMENTS.find((e) => e.slug === 'sled_push');
    assert.ok(entry, 'CAT-3 A2-i E2: the library has sled_push, which a legacy row already holds');
    const legacyOf = () =>
      tx
        .select()
        .from(schema.movements)
        .where(and(eq(schema.movements.slug, entry.slug), isNull(schema.movements.householdId)));
    const before = await legacyOf();
    assert.equal(before.length, 1, 'CAT-3 A2-i E2: one legacy global sled_push before the seed');
    const counts = await seedReference(asDb(tx), {
      library: { entries: [entry], legacyMovements: true },
    });
    assert.deepEqual(
      await legacyOf(),
      before,
      'CAT-3 A2-i E2: a global row that already holds the slug is left exactly as it is',
    );
    assert.equal(
      await joinRowCountOn(tx, [before[0]!.id]),
      0,
      'CAT-3 A2-i E2: …and gets no join row',
    );
    assert.deepEqual(
      [counts.catalogInserted, counts.catalogHeldByLegacy],
      [0, 1],
      'CAT-3 A2-i E2: …and is counted as held by a legacy row',
    );
  });

  // D5.4, E3 and E5: a household row on a library-only slug is never touched and gets no join row; the
  // global catalog row lands beside it; the report counts it and names nothing.
  await rolledBack(async (tx) => {
    const entry = CATALOG_MOVEMENTS.find(
      (e) =>
        !LEGACY_SLUGS.has(e.slug) &&
        e.equipment.length > 0 &&
        (e.primaryMuscle !== null || e.secondaryMuscles.length > 0),
    )!;
    const HOUSEHOLD_NAME = 'A2-i household item';
    const plantedPublicId = newId();
    await insertMovementOwnedBy(asTx(tx), ctx.A_SCOPE, {
      publicId: plantedPublicId,
      slug: entry.slug,
      name: HOUSEHOLD_NAME,
      isBodyweight: false,
    });
    const [planted] = await tx
      .select({ id: schema.movements.id })
      .from(schema.movements)
      .where(eq(schema.movements.publicId, plantedPublicId));
    assert.ok(planted, 'CAT-3 A2-i E3: the household row is planted');
    const householdRow = () =>
      tx.select().from(schema.movements).where(eq(schema.movements.id, planted.id));
    const before = await householdRow();

    // Everything the seed run prints, from the write through the report: a slug printed anywhere in
    // it reaches the same public log.
    let counts!: Awaited<ReturnType<typeof seedReference>>;
    const printed = await captureOutput(async () => {
      counts = await seedReference(asDb(tx), {
        library: { entries: [entry], legacyMovements: true },
      });
      reportSeed(counts);
    });
    assert.deepEqual(
      await householdRow(),
      before,
      "CAT-3 A2-i E3: a household's row on a library slug is left exactly as it is",
    );
    assert.equal(
      await joinRowCountOn(tx, [planted.id]),
      0,
      "CAT-3 A2-i E3: …and the seed writes no join row for a household's movement",
    );
    const beside = (await catalogStateOn(tx, [entry.slug])).get(entry.slug);
    assert.deepEqual(
      beside && { equipment: beside.equipment, muscles: beside.muscles },
      joinRowsOf(entry),
      'CAT-3 A2-i E3: …while the global catalog row lands beside it, with its join rows',
    );
    assert.equal(
      counts.householdRowsOnCatalogSlugs,
      1,
      'CAT-3 A2-i E5: the household row on a library slug is counted',
    );
    assert.ok(
      /and 1 share a library slug/.test(printed),
      'CAT-3 A2-i E5: the report prints the count',
    );
    assert.ok(
      !printed.includes(entry.slug) && !printed.includes(HOUSEHOLD_NAME),
      "CAT-3 A2-i E5: …and names no slug a household holds, and no household's text (spec rule 7)",
    );
  });

  // A household row on a slug that is both a legacy and a library slug is counted ONCE, as legacy.
  await rolledBack(async (tx) => {
    const entry = CATALOG_MOVEMENTS.find((e) => e.slug === 'sled_push')!;
    const baseline = await seedReference(asDb(tx), {
      library: { entries: [], legacyMovements: true },
    });
    await insertMovementOwnedBy(asTx(tx), ctx.A_SCOPE, {
      publicId: newId(),
      slug: entry.slug,
      name: 'A2-i shared-slug item',
      isBodyweight: false,
    });
    const counts = await seedReference(asDb(tx), {
      library: { entries: [entry], legacyMovements: true },
    });
    assert.deepEqual(
      [
        counts.householdRowsOnSeedSlugs - baseline.householdRowsOnSeedSlugs,
        counts.householdRowsOnCatalogSlugs,
      ],
      [1, 0],
      'CAT-3 A2-i E5: a household row on a shared legacy/library slug is counted once, as legacy',
    );
  });

  // D5.5: a slug twice in one list: the first entry is written, with its join rows only.
  await rolledBack(async (tx) => {
    const first = CATALOG_MOVEMENTS.find(
      (e) => !LEGACY_SLUGS.has(e.slug) && e.equipment.length > 0,
    )!;
    const a = { ...first, slug: 'cat3_a2_twice' };
    const b = { ...first, slug: 'cat3_a2_twice', name: `${first.name} (second)`, equipment: [] };
    const counts = await seedCatalog(asDb(tx), [a, b]);
    const row = (await catalogStateOn(tx, [a.slug])).get(a.slug);
    assert.deepEqual(
      row && { name: row.stored.name, equipment: row.equipment },
      { name: a.name, equipment: [...a.equipment] },
      'CAT-3 A2-i: a slug twice in the list writes the first entry and its join rows only',
    );
    assert.deepEqual(
      [counts.catalogInserted, counts.catalogDuplicates],
      [1, 1],
      'CAT-3 A2-i: …and counts the second as a duplicate',
    );
  });

  // D5.7, owed from A1: the TEN-2d blocker count reads the CHECK's own predicate.
  const report = CORRECTIONS.find((c) => c.name === MOVEMENTS_OWNERSHIP_REPORT_NAME);
  assert.ok(report, 'CAT-3 A2-i: the movements-ownership report is in the registry');
  // The shared verify database already holds rows other proofs planted, so the proof is a DELTA.
  const blockers = async (tx: VerifyTx) => {
    const line =
      ((await report.run(tx as unknown as Database, false)) as string[]).find((l) =>
        l.startsWith('TEN-2d blocker'),
      ) ?? '';
    const n = /: (\d+)$/.exec(line)?.[1];
    assert.ok(n !== undefined, `CAT-3 A2-i: the report has a TEN-2d blocker count (${line})`);
    return Number(n);
  };
  await rolledBack(async (tx) => {
    const before = await blockers(tx);
    await tx
      .insert(schema.movements)
      .values(
        movementRow('cat3_a2_mobility_no_pattern', { modality: MODALITY.mobility, pattern: null }),
      );
    assert.equal(
      await blockers(tx),
      before,
      'CAT-3 A2-i: a global non-strength catalog row with no pattern is not a TEN-2d blocker',
    );
    await tx.execute(
      sql`ALTER TABLE movements DROP CONSTRAINT ${sql.identifier(schema.MOVEMENT_GLOBAL_ROW_HAS_PATTERN_CHECK)}`,
    );
    await tx.insert(schema.movements).values(movementRow('cat3_a2_neither', { pattern: null }));
    assert.equal(
      await blockers(tx),
      before + 1,
      'CAT-3 A2-i: …and a global row with neither a pattern nor a modality is one',
    );
  });

  // CAT-3 A2-ii (plan D4, A9): a library row is curated, by an exact test (a modality AND a
  // CATALOG_MOVEMENTS slug), so it never reaches the orphan input; a global row with a modality on any
  // other slug is not, and has its own line. Deltas: the shared database holds other proofs' rows.
  const reportCount = async (tx: VerifyTx, prefix: string) => {
    const line =
      ((await report.run(tx as unknown as Database, false)) as string[]).find((l) =>
        l.startsWith(prefix),
      ) ?? '';
    const n = /: (\d+)$/.exec(line)?.[1];
    assert.ok(n !== undefined, `CAT-3 A2-ii A9: the report has a "${prefix}" count (${line})`);
    return Number(n);
  };
  const ORPHANS = 'TEN-2b-2 input';
  const STRAY = 'global rows with a modality but no CATALOG_MOVEMENTS slug';
  await rolledBack(async (tx) => {
    const before = { orphans: await reportCount(tx, ORPHANS), stray: await reportCount(tx, STRAY) };
    const entry = CATALOG_MOVEMENTS.find(
      (e) => !LEGACY_SLUGS.has(e.slug) && !CATALOG_FIXTURE.some((f) => f.slug === e.slug),
    )!;
    await seedCatalog(asDb(tx), [entry]);
    assert.deepEqual(
      { orphans: await reportCount(tx, ORPHANS), stray: await reportCount(tx, STRAY) },
      before,
      'CAT-3 A2-ii A9: a library row is curated: it is not an orphan the next correction would remove',
    );
    await tx
      .insert(schema.movements)
      .values(
        movementRow('cat3_a2ii_not_a_library_slug', { modality: MODALITY.mobility, pattern: null }),
      );
    assert.deepEqual(
      { orphans: await reportCount(tx, ORPHANS), stray: await reportCount(tx, STRAY) },
      { orphans: before.orphans + 1, stray: before.stray + 1 },
      'CAT-3 A2-ii A9: …but a global row with a modality on a slug the library does not have is not, and is counted on its own line',
    );
  });

  console.log(
    '✓ CAT-3 A2-i: the writer is one transaction, leaves held slugs and household rows alone, and reports counts only',
  );
}
