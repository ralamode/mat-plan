import assert from 'node:assert/strict';

import {
  ACTIVITY_CATEGORY_ROWS,
  ACTIVITY_TYPE_SEED_ROWS,
  EQUIPMENT,
  METRIC_DEFINITION_SEED_ROWS,
  MOVEMENT_SEED_ROWS,
  MUSCLES,
  newId,
  PROFILE_KIND,
  QUANTITY_SLOT_ROWS,
  SEED_HOUSEHOLD_PUBLIC_ID,
  UNITS,
} from '@mat-plan/shared';
import { eq, isNull, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

import { schema } from '../../src/client';
import { graphTableName, HOUSEHOLD_GRAPH, REFERENCE_TABLES } from '../../src/erasure/graph';
import { seed } from '../../src/seed';
import { householdScopeForScript } from '../../src/writers/household-scope-script';
import { insertMovementOwnedBy } from '../../src/writers/ownership';
import {
  asDb,
  asPg,
  asTx,
  captureWarnings,
  db,
  rolledBack,
  rowsOf,
  type VerifyContext,
  type VerifyTx,
} from './harness';

/**
 * `OPS-2` PR 1's proofs: production's seed (`seed({ fixtures: false })`, what `migrate.yml` runs)
 * writes reference data only, and never throws whatever state the seed household is in
 * ([plan](../../../../docs/plans/ops-2-split-the-seed.md), § Test plan).
 *
 * - {@link verifySeedOnAFreshDatabase} (Proof A) runs EARLY, right after `CAT-3` A1's
 *   `verifyCatalogMigrationFacts` and before `verify.ts`'s first fixture seed: the one point where the
 *   database is a fork's first run (only migration 0001's seed household, no athletes).
 * - {@link verifySeedLeavesHouseholdsAlone} (Proof B) runs LAST, with the other modules, each case in
 *   its own rolled-back transaction on the fixture world.
 *
 * Proof C is one line in `verify.ts`'s 1c-4 block, where the seed household's `public_id` is swapped.
 *
 * 🔴 **"Household-scoped" is `HOUSEHOLD_GRAPH`**, never "every table outside the reference set":
 * `movements` and the two join tables hold global and household rows alike, and the graph scopes each
 * per household (P1 and P2 hold it complete). Every "does not throw" is `assert.doesNotReject` with a
 * named message: a thrown `Error` is not an `AssertionError`, so the mutation gate would call it the
 * wrong assertion.
 */

/** What each reference table must hold after a seed, from its shared source. */
const REFERENCE_SOURCE = new Map<PgTable, number>([
  [schema.units, UNITS.length],
  [schema.equipment, EQUIPMENT.length],
  [schema.muscles, MUSCLES.length],
  [schema.quantitySlots, QUANTITY_SLOT_ROWS.length],
  [schema.activityTypeCategories, ACTIVITY_CATEGORY_ROWS.length],
  [schema.activityTypes, ACTIVITY_TYPE_SEED_ROWS.length],
  [schema.metricDefinitions, METRIC_DEFINITION_SEED_ROWS.length],
]);

type Exec = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };

async function countOf(exec: Exec, table: PgTable, where?: ReturnType<typeof sql>) {
  const res = await exec.execute(
    where
      ? sql`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`
      : sql`SELECT count(*)::int AS n FROM ${table}`,
  );
  return rowsOf<{ n: number }>(res)[0].n;
}

/** Every household table's row count, by name: what a seed must leave unchanged. */
async function householdTableCounts(exec: Exec): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const g of HOUSEHOLD_GRAPH) counts[graphTableName(g.table)] = await countOf(exec, g.table);
  return counts;
}

/** Production's seed, on the transaction, failing on `what` if it throws. */
async function productionSeedResolves(tx: VerifyTx, what: string): Promise<void> {
  await assert.doesNotReject(() => seed(asDb(tx), { fixtures: false }), what);
}

export async function verifySeedOnAFreshDatabase(): Promise<void> {
  for (const run of ['first', 'second']) {
    await assert.doesNotReject(
      () => seed(asPg, { fixtures: false }),
      `OPS-2 A: seed({ fixtures: false }) on a fresh database resolves (${run} run)`,
    );
  }

  // Every reference table is in the source map, so a new one cannot go unproved.
  assert.deepEqual(
    REFERENCE_TABLES.map(graphTableName).sort(),
    [...REFERENCE_SOURCE.keys()].map(graphTableName).sort(),
    'OPS-2 A: every reference table has a shared source this proof counts against',
  );
  for (const [table, expected] of REFERENCE_SOURCE) {
    assert.equal(
      await countOf(db, table),
      expected,
      `OPS-2 A: seed({ fixtures: false }) writes ${graphTableName(table)} from its shared const`,
    );
  }
  assert.equal(
    await countOf(db, schema.movements, sql`${schema.movements.householdId} IS NULL`),
    MOVEMENT_SEED_ROWS.length,
    'OPS-2 A: seed({ fixtures: false }) writes the legacy global movements (until CAT-3 A2)',
  );

  // Migration 0001's household is the only one, so its scope reaches every household row there is.
  const [row] = await db
    .select({ id: schema.households.id })
    .from(schema.households)
    .where(eq(schema.households.publicId, SEED_HOUSEHOLD_PUBLIC_ID));
  assert.ok(row, "OPS-2 A: a fresh database holds migration 0001's seed household");
  assert.equal(
    await countOf(db, schema.households),
    1,
    "OPS-2 A: seed({ fixtures: false }) creates no household beside migration 0001's",
  );
  const SEED_SCOPE = householdScopeForScript(row.id);
  for (const g of HOUSEHOLD_GRAPH) {
    if (g.table === schema.households) continue;
    assert.equal(
      await countOf(db, g.table, g.householdRows(SEED_SCOPE)),
      0,
      `OPS-2 A: seed({ fixtures: false }) writes no ${graphTableName(g.table)} row`,
    );
  }
  console.log(
    '✓ OPS-2 A: on a fresh database the production seed writes reference data only, twice',
  );
}

/** Rename the seed household out of the seed's namespace (the 1c-4 block's construction). */
async function removeSeedHousehold(tx: VerifyTx): Promise<void> {
  await tx
    .update(schema.households)
    .set({ publicId: newId() })
    .where(eq(schema.households.publicId, SEED_HOUSEHOLD_PUBLIC_ID));
}

async function liveHouseholds(tx: VerifyTx): Promise<number> {
  return countOf(tx, schema.households, sql`${schema.households.deletedAt} IS NULL`);
}

export async function verifySeedLeavesHouseholdsAlone(ctx: VerifyContext): Promise<void> {
  // B1: one more household with a kid; production's seed changes no household table.
  await rolledBack(async (tx) => {
    const [h] = await tx
      .insert(schema.households)
      .values({ publicId: newId(), name: 'OPS-2 B1' })
      .returning({ id: schema.households.id });
    await tx.insert(schema.profiles).values({
      publicId: newId(),
      name: 'OPS-2 B1 kid',
      kind: PROFILE_KIND.kid,
      householdId: h.id,
    });
    const before = await householdTableCounts(tx);
    await productionSeedResolves(
      tx,
      'OPS-2 B1: with another household, seed({ fixtures: false }) resolves',
    );
    assert.deepEqual(
      await householdTableCounts(tx),
      before,
      'OPS-2 B1: with another household, seed({ fixtures: false }) changes no household table',
    );
  });

  // B2: the seed household removed and no live household left (`328`).
  await rolledBack(async (tx) => {
    await removeSeedHousehold(tx);
    await tx
      .update(schema.households)
      .set({ deletedAt: sql`now()` })
      .where(isNull(schema.households.deletedAt));
    assert.equal(await liveHouseholds(tx), 0, 'OPS-2 B2 fixture: no live household is left');
    const before = await householdTableCounts(tx);
    await productionSeedResolves(
      tx,
      'OPS-2 B2: with no live household, seed({ fixtures: false }) resolves',
    );
    assert.deepEqual(
      await householdTableCounts(tx),
      before,
      'OPS-2 B2: with no live household, seed({ fixtures: false }) creates no household or profile',
    );
  });

  // B3: the seed household removed, another household live (`327` reddens Proof C first).
  await rolledBack(async (tx) => {
    await removeSeedHousehold(tx);
    assert.ok((await liveHouseholds(tx)) > 0, 'OPS-2 B3 fixture: another household is live');
    const before = await householdTableCounts(tx);
    await productionSeedResolves(
      tx,
      'OPS-2 B3: with only a foreign household live, seed({ fixtures: false }) resolves',
    );
    assert.deepEqual(
      await householdTableCounts(tx),
      before,
      'OPS-2 B3: with only a foreign household live, seed({ fixtures: false }) creates nothing',
    );
  });

  // B4: the TEN-2c report still fires without fixtures (`329`).
  await rolledBack(async (tx) => {
    const slug = MOVEMENT_SEED_ROWS[0].slug;
    await insertMovementOwnedBy(asTx(tx), ctx.B_SCOPE, {
      publicId: newId(),
      slug,
      name: 'OPS-2 B4 item',
      isBodyweight: false,
    });
    const warned = await captureWarnings(() => seed(asDb(tx), { fixtures: false }));
    assert.ok(
      warned.includes(slug),
      'OPS-2 B4: seed({ fixtures: false }) still reports a seeded slug a household also owns (TEN-2c)',
    );
  });

  // B5: the seed household and its athletes soft-deleted, every household too. No mutation reddens
  // this (under `326` it stays green: every insert conflicts); it pins the tombstone state.
  await rolledBack(async (tx) => {
    await tx
      .update(schema.profiles)
      .set({ deletedAt: sql`now()` })
      .where(isNull(schema.profiles.deletedAt));
    await tx
      .update(schema.households)
      .set({ deletedAt: sql`now()` })
      .where(isNull(schema.households.deletedAt));
    const before = await householdTableCounts(tx);
    await productionSeedResolves(
      tx,
      'OPS-2 B5: with the seed household soft-deleted, seed({ fixtures: false }) resolves',
    );
    assert.deepEqual(
      await householdTableCounts(tx),
      before,
      'OPS-2 B5: with the seed household soft-deleted, seed({ fixtures: false }) changes nothing',
    );
  });

  console.log(
    '✓ OPS-2 B: the production seed resolves and writes no household row, whatever the seed household’s state',
  );
}
