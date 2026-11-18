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
  assertRefTableMatches,
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

/**
 * What each reference table must hold after a seed: its natural key, and that key's values in the
 * shared source. Compared both ways (`assertRefTableMatches`), so a wrong code fails, not only a
 * wrong count.
 */
const REFERENCE_SOURCE = new Map<
  PgTable,
  { key: ReturnType<typeof sql>; values: readonly string[] }
>([
  [schema.units, { key: sql`code`, values: UNITS.map((u) => u.code) }],
  [schema.equipment, { key: sql`code`, values: EQUIPMENT }],
  [schema.muscles, { key: sql`code`, values: MUSCLES }],
  [
    schema.quantitySlots,
    {
      key: sql`code || ':' || dimension`,
      values: QUANTITY_SLOT_ROWS.map((r) => `${r.code}:${r.dimension}`),
    },
  ],
  [
    schema.activityTypeCategories,
    { key: sql`code`, values: ACTIVITY_CATEGORY_ROWS.map((r) => r.code) },
  ],
  [schema.activityTypes, { key: sql`key`, values: ACTIVITY_TYPE_SEED_ROWS.map((r) => r.key) }],
  [
    schema.metricDefinitions,
    { key: sql`key`, values: METRIC_DEFINITION_SEED_ROWS.map((r) => r.key) },
  ],
]);

async function keysOf(
  exec: Exec,
  table: PgTable,
  key: ReturnType<typeof sql>,
  where?: ReturnType<typeof sql>,
) {
  const res = await exec.execute(
    where
      ? sql`SELECT ${key} AS k FROM ${table} WHERE ${where}`
      : sql`SELECT ${key} AS k FROM ${table}`,
  );
  return rowsOf<{ k: string }>(res).map((r) => ({ k: r.k }));
}

type Exec = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };

async function countOf(exec: Exec, table: PgTable, where?: ReturnType<typeof sql>) {
  const res = await exec.execute(
    where
      ? sql`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`
      : sql`SELECT count(*)::int AS n FROM ${table}`,
  );
  return rowsOf<{ n: number }>(res)[0].n;
}

/**
 * Every household table's row count and a digest of its rows, by name: what a seed must leave
 * unchanged. The digest is what catches an UPDATE, which a count cannot see.
 */
async function householdTableCounts(exec: Exec): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const g of HOUSEHOLD_GRAPH) {
    const res = await exec.execute(
      sql`SELECT count(*)::int AS n, md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS d FROM ${g.table} AS t`,
    );
    const [r] = rowsOf<{ n: number; d: string }>(res);
    out[graphTableName(g.table)] = `${r.n}:${r.d}`;
  }
  return out;
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

  // Each reference table equals its shared source; that every reference table HAS one is checked
  // late (verifySeedLeavesHouseholdsAlone), after erasure's P1 has classified every table.
  for (const [table, { key, values }] of REFERENCE_SOURCE) {
    assertRefTableMatches(
      graphTableName(table),
      await keysOf(db, table, key),
      values.map((k) => ({ k })),
    );
  }
  assertRefTableMatches(
    'global movements (the legacy catalog, until CAT-3 A2)',
    await keysOf(db, schema.movements, sql`slug`, sql`${schema.movements.householdId} IS NULL`),
    MOVEMENT_SEED_ROWS.map((m) => ({ k: m.slug })),
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
  // Every reference table has a shared source Proof A compares it with. Here, not in A: erasure's P1,
  // which runs before this, is what classifies a table; a reclassification fails there first.
  assert.deepEqual(
    REFERENCE_TABLES.map(graphTableName).sort(),
    [...REFERENCE_SOURCE.keys()].map(graphTableName).sort(),
    'OPS-2 A: every reference table has a shared source Proof A compares it with',
  );

  // Units (the maintainer's "fix it", 2026-11-18): a unit that differs from UNITS is rewritten to
  // match (`501`), and an unchanged one is never written, so never row-locked (`500`). PGlite cannot
  // show a lock, but a rewritten row gets a new xmin.
  await rolledBack(async (tx) => {
    const [first] = UNITS;
    await tx
      .update(schema.units)
      .set({ label: 'OPS-2 stale' })
      .where(eq(schema.units.code, first.code));
    const versions = async () =>
      rowsOf<{ code: string; x: string }>(
        await tx.execute(
          sql`SELECT code, xmin::text AS x FROM ${schema.units} WHERE code <> ${first.code} ORDER BY code`,
        ),
      );
    const before = await versions();
    await productionSeedResolves(
      tx,
      'OPS-2 units: seed({ fixtures: false }) resolves on a drifted unit',
    );
    const [row] = await tx
      .select({ label: schema.units.label })
      .from(schema.units)
      .where(eq(schema.units.code, first.code));
    assert.equal(
      row.label,
      first.label,
      'OPS-2 units: a unit that differs from UNITS is rewritten to match',
    );
    assert.deepEqual(await versions(), before, 'OPS-2 units: an unchanged unit is never rewritten');
  });

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
