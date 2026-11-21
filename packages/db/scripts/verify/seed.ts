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
import { CATALOG_MOVEMENTS, CATALOG_SLUGS } from '@mat-plan/shared/catalog/data';
import { eq, isNull, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

import { schema } from '../../src/client';
import { graphTableName, HOUSEHOLD_GRAPH, REFERENCE_TABLES } from '../../src/erasure/graph';
import { assertSeedOwnsDatabase, seed } from '../../src/seed';
import { householdScopeForScript } from '../../src/writers/household-scope-script';
import { insertMovementOwnedBy } from '../../src/writers/ownership';
import {
  asDb,
  assertRefTableMatches,
  asTx,
  captureOutput,
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
 *
 * 🔴 **Household-owned rows only, in the three tables that also hold global ones** (CAT-3 A2-ii, plan
 * D3). Production's seed now writes the movement library, which is global reference data, into
 * `movements` and its two join tables; a whole-table digest would call that a household write.
 * `assertOnlyLibraryRowsAdded` is the other half: the global rows a seed adds are library rows.
 */
const OWNED_ONLY = new Map<PgTable, ReturnType<typeof sql>>([
  [schema.movements, sql`t.household_id IS NOT NULL`],
  [
    schema.movementEquipment,
    sql`t.movement_id IN (SELECT id FROM movements WHERE household_id IS NOT NULL)`,
  ],
  [
    schema.movementMuscles,
    sql`t.movement_id IN (SELECT id FROM movements WHERE household_id IS NOT NULL)`,
  ],
]);

async function householdTableCounts(exec: Exec): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const g of HOUSEHOLD_GRAPH) {
    const owned = OWNED_ONLY.get(g.table);
    const res = await exec.execute(
      sql`SELECT count(*)::int AS n, md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS d FROM ${g.table} AS t ${owned ? sql`WHERE ${owned}` : sql``}`,
    );
    const [r] = rowsOf<{ n: number; d: string }>(res);
    out[graphTableName(g.table)] = `${r.n}:${r.d}`;
  }
  return out;
}

/** The global movements' slugs, and a digest of those rows and their join rows. */
interface GlobalSnapshot {
  readonly slugs: ReadonlySet<string>;
  readonly digest: string;
}

/** A digest of the global movements on `slugs` (every one when omitted) and of their join rows. */
async function globalDigest(exec: Exec, slugs?: readonly string[]): Promise<string> {
  if (slugs && slugs.length === 0) return 'none';
  const on = (col: ReturnType<typeof sql>) =>
    slugs
      ? sql` AND ${col} IN (${sql.join(
          slugs.map((s) => sql`${s}`),
          sql`, `,
        )})`
      : sql``;
  const parts: string[] = [];
  for (const query of [
    sql`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS d FROM movements t WHERE t.household_id IS NULL${on(sql`t.slug`)}`,
    sql`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS d FROM movement_equipment t JOIN movements m ON m.id = t.movement_id WHERE m.household_id IS NULL${on(sql`m.slug`)}`,
    sql`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS d FROM movement_muscles t JOIN movements m ON m.id = t.movement_id WHERE m.household_id IS NULL${on(sql`m.slug`)}`,
  ]) {
    parts.push(rowsOf<{ d: string }>(await exec.execute(query))[0].d);
  }
  return parts.join(':');
}

/** What `assertOnlyLibraryRowsAdded` compares across a seed. */
async function globalSnapshot(exec: Exec): Promise<GlobalSnapshot> {
  return {
    slugs: new Set(
      (await keysOf(exec, schema.movements, sql`slug`, sql`household_id IS NULL`)).map((r) => r.k),
    ),
    digest: await globalDigest(exec),
  };
}

/**
 * CAT-3 A2-ii (A10): the only global rows production's seed added are library rows, each on a
 * `CATALOG_MOVEMENTS` slug and carrying a modality. The household digest above no longer sees global
 * rows, so this is what keeps a seed from adding any other kind of global row unnoticed.
 */
async function assertOnlyLibraryRowsAdded(
  tx: VerifyTx,
  before: GlobalSnapshot,
  what: string,
): Promise<void> {
  // E2: every global row that was there before, and its join rows, is exactly as it was. Production
  // keeps its 35 legacy rows until R2, so this is what catches a seed that rewrites one.
  assert.equal(
    await globalDigest(tx, [...before.slugs]),
    before.digest,
    `CAT-3 A2-ii ${what}: production’s seed leaves every global row it found, and its join rows, unchanged`,
  );
  const added = [...(await globalSnapshot(tx)).slugs].filter((slug) => !before.slugs.has(slug));
  const stray = added.filter((slug) => !CATALOG_SLUGS.has(slug));
  assert.deepEqual(stray, [], `CAT-3 A2-ii ${what}: production’s seed adds only library slugs`);
  if (added.length > 0) {
    assert.equal(
      await countOf(
        tx,
        schema.movements,
        sql`household_id IS NULL AND modality IS NULL AND slug IN (${sql.join(
          added.map((s) => sql`${s}`),
          sql`, `,
        )})`,
      ),
      0,
      `CAT-3 A2-ii ${what}: …each one a library row (a modality)`,
    );
  }
}

/** Production's seed, on the transaction, failing on `what` if it throws. */
async function productionSeedResolves(tx: VerifyTx, what: string): Promise<void> {
  await assert.doesNotReject(() => seed(asDb(tx), { fixtures: false }), what);
}

/** The first entry for each library slug: what the writer keeps (A2-i, D5.5). */
const LIBRARY_BY_SLUG = new Map<string, (typeof CATALOG_MOVEMENTS)[number]>();
for (const entry of CATALOG_MOVEMENTS) {
  if (!LIBRARY_BY_SLUG.has(entry.slug)) LIBRARY_BY_SLUG.set(entry.slug, entry);
}

/**
 * Proof A, rolled back since CAT-3 A2-ii (plan D3): production's seed now writes the real library, and
 * the shared verify database must stay a fixtures database, as every e2e and preview one is. Every
 * read is on `tx`: a read through the module `db` would wait forever on PGlite's one connection.
 */
export async function verifySeedOnAFreshDatabase(): Promise<void> {
  await rolledBack(async (tx) => {
    // ⚠️ CAT-3 A2-ii, the documented limit, pinned: a freshly migrated database holds migration 0001's
    // household under the seed's own public_id, so the fixtures ownership check passes on it. So it
    // passes on production too until the fresh start erases that household (docs/tech-debt.md).
    await assert.doesNotReject(
      () => assertSeedOwnsDatabase(asDb(tx)),
      'CAT-3 A2-ii: the fixtures ownership check passes on a freshly migrated database (the limit tech-debt records)',
    );
    let afterFirst: string | undefined;
    for (const run of ['first', 'second']) {
      await assert.doesNotReject(
        () => seed(asDb(tx), { fixtures: false }),
        `OPS-2 A: seed({ fixtures: false }) on a fresh database resolves (${run} run)`,
      );
      const digest = await globalDigest(tx);
      const all = `${await countOf(tx, schema.movements)}:${await countOf(tx, schema.movementEquipment)}:${await countOf(tx, schema.movementMuscles)}:${digest}`;
      if (afterFirst === undefined) afterFirst = all;
      else
        assert.equal(all, afterFirst, 'CAT-3 A2-ii A1: a second production seed inserts nothing');
    }

    // CAT-3 A2-ii, E4 (A1): production's seed writes the approved library and no legacy row. Checked
    // FIRST, so a seed that still writes the legacy rows (mutation 598) fails here.
    assertRefTableMatches(
      'CAT-3 A2-ii A1: global movements are exactly the CATALOG_MOVEMENTS slugs, and no legacy row',
      await keysOf(tx, schema.movements, sql`slug`, sql`${schema.movements.householdId} IS NULL`),
      [...LIBRARY_BY_SLUG.keys()].map((k) => ({ k })),
    );
    assert.equal(
      await countOf(
        tx,
        schema.movements,
        sql`${schema.movements.householdId} IS NULL AND ${schema.movements.modality} IS NULL`,
      ),
      0,
      'CAT-3 A2-ii A1: every global movement is a library row (a modality)',
    );
    const entries = [...LIBRARY_BY_SLUG.values()];
    const joinCounts: Array<[PgTable, number]> = [
      [schema.movementEquipment, entries.reduce((n, e) => n + e.equipment.length, 0)],
      [
        schema.movementMuscles,
        entries.reduce((n, e) => n + (e.primaryMuscle ? 1 : 0) + e.secondaryMuscles.length, 0),
      ],
    ];
    for (const [table, want] of joinCounts) {
      assert.equal(
        await countOf(
          tx,
          table,
          sql`movement_id IN (SELECT id FROM ${schema.movements} WHERE ${schema.movements.householdId} IS NULL)`,
        ),
        want,
        `CAT-3 A2-ii A1: every library row has its ${graphTableName(table)} rows`,
      );
    }

    // Each reference table equals its shared source; that every reference table HAS one is checked
    // late (verifySeedLeavesHouseholdsAlone), after erasure's P1 has classified every table.
    for (const [table, { key, values }] of REFERENCE_SOURCE) {
      assertRefTableMatches(
        graphTableName(table),
        await keysOf(tx, table, key),
        values.map((k) => ({ k })),
      );
    }

    // Migration 0001's household is the only one, so its scope reaches every household row there is.
    const [row] = await tx
      .select({ id: schema.households.id })
      .from(schema.households)
      .where(eq(schema.households.publicId, SEED_HOUSEHOLD_PUBLIC_ID));
    assert.ok(row, "OPS-2 A: a fresh database holds migration 0001's seed household");
    assert.equal(
      await countOf(tx, schema.households),
      1,
      "OPS-2 A: seed({ fixtures: false }) creates no household beside migration 0001's",
    );
    const SEED_SCOPE = householdScopeForScript(row.id);
    for (const g of HOUSEHOLD_GRAPH) {
      if (g.table === schema.households) continue;
      assert.equal(
        await countOf(tx, g.table, g.householdRows(SEED_SCOPE)),
        0,
        `OPS-2 A: seed({ fixtures: false }) writes no ${graphTableName(g.table)} row`,
      );
    }
  });
  // Rolled back: the shared database is still a fork's first run for the fixtures seed that follows.
  assert.equal(
    await countOf(db, schema.movements),
    0,
    'CAT-3 A2-ii: Proof A leaves the shared database without the real library',
  );
  console.log(
    '✓ OPS-2 A / CAT-3 A2-ii A1: on a fresh database the production seed writes reference data and the approved library only, twice',
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
    const globalBefore = await globalSnapshot(tx);
    await productionSeedResolves(
      tx,
      'OPS-2 B1: with another household, seed({ fixtures: false }) resolves',
    );
    await assertOnlyLibraryRowsAdded(tx, globalBefore, 'B1');
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
    const globalBefore = await globalSnapshot(tx);
    await productionSeedResolves(
      tx,
      'OPS-2 B2: with no live household, seed({ fixtures: false }) resolves',
    );
    await assertOnlyLibraryRowsAdded(tx, globalBefore, 'B2');
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
    const globalBefore = await globalSnapshot(tx);
    await productionSeedResolves(
      tx,
      'OPS-2 B3: with only a foreign household live, seed({ fixtures: false }) resolves',
    );
    await assertOnlyLibraryRowsAdded(tx, globalBefore, 'B3');
    assert.deepEqual(
      await householdTableCounts(tx),
      before,
      'OPS-2 B3: with only a foreign household live, seed({ fixtures: false }) creates nothing',
    );
  });

  // B4: the TEN-2c report still fires without fixtures (`329`), as a count (CAT-3 A2-i).
  await rolledBack(async (tx) => {
    const slug = MOVEMENT_SEED_ROWS[0].slug;
    await insertMovementOwnedBy(asTx(tx), ctx.B_SCOPE, {
      publicId: newId(),
      slug,
      name: 'OPS-2 B4 item',
      isBodyweight: false,
    });
    const warned = await captureOutput(() => seed(asDb(tx), { fixtures: false }));
    assert.ok(
      /share a legacy seed slug/.test(warned),
      'OPS-2 B4: seed({ fixtures: false }) still reports a household row on a seeded slug (TEN-2c)',
    );
    assert.ok(
      !warned.includes(slug),
      'OPS-2 B4 / CAT-3 A2-i: …as a COUNT: the report names no slug a household holds (spec rule 7)',
    );
  });

  // B5: the seed household and its athletes soft-deleted, every household too. No mutation reddens
  // this (under `326` it stays green: it writes no household row); it pins the tombstone state.
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
    const globalBefore = await globalSnapshot(tx);
    await productionSeedResolves(
      tx,
      'OPS-2 B5: with the seed household soft-deleted, seed({ fixtures: false }) resolves',
    );
    await assertOnlyLibraryRowsAdded(tx, globalBefore, 'B5');
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
