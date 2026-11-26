import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  EQUIPMENT,
  GATE_COLORS,
  HOUSEHOLD_ROLE,
  MODALITY,
  MOVEMENT_PATTERNS,
  MOVEMENT_SEED_PUBLIC_IDS,
  MUSCLE_ROLE,
  MUSCLES,
  newId,
  QUANTITY_SLOT,
  SEED_HOUSEHOLD_PUBLIC_ID,
  SEED_PUBLIC_IDS,
  SESSION_TYPES,
  UNIT_DIMENSION,
} from '@mat-plan/shared';
import { CATALOG_SLUGS } from '@mat-plan/shared/catalog/data';
import { eq, sql, type SQL } from 'drizzle-orm';

import { schema, type Database } from '../../src/client';
import {
  CORRECTIONS,
  CREATE_HOUSEHOLD_NAME,
  DELETE_LEGACY_MOVEMENTS_NAME,
  ERASE_SEEDED_HOUSEHOLD_NAME,
  MOVEMENTS_OWNERSHIP_REPORT_NAME,
} from '../corrections/registry';
import { CREATE_HOUSEHOLD_ACCOUNTS_ENV } from '../corrections/accounts';
import { EXPECT_ERASED_ROWS } from '../corrections/erasure-gates';
import { LEGACY_COUNT_ENV } from '../corrections/movement-gates';
import {
  CENSUS_REFERENCE_TABLES,
  foreignKeysIntoMovements,
  MOVEMENT_JOIN_TABLES,
  movementFkTable,
} from '../../src/queries/movement-ownership';
import { lineText } from '../corrections/summary';
import {
  ErasureCountMismatch,
  ErasurePreflightRefused,
  ErasureTargetNotFound,
  eraseHousehold,
  LOCK_ORDER,
  PARENT_TABLES,
} from '../../src/erasure/erase';
import {
  ATHLETE_GRAPH,
  ATHLETE_GRAPH_TABLES,
  graphTableName,
  HOUSEHOLD_GRAPH,
  isAthleteGrain,
  NON_ABORTING_EDGES,
  REFERENCE_TABLES,
} from '../../src/erasure/graph';
import { PREFLIGHT_CHECKS, type PreflightCheck } from '../../src/erasure/preflight';
import { type HouseholdScope } from '../../src/scope';
import { setLocalTimeouts, type Executor } from '../../src/writers/executor';
import { householdScopeForScript } from '../../src/writers/household-scope-script';
import {
  householdMemberInHousehold,
  householdRowIs,
  insertHouseholdMember,
  insertMovementOwnedBy,
  insertWorkoutOwnedBy,
} from '../../src/writers/ownership';
import {
  asOwner,
  asPg,
  asTx,
  db,
  idsOf,
  rolledBack,
  rowsOf,
  type VerifyContext,
  type VerifyTx,
} from './harness';
import { mkAssignment, mkKid, mkTemplateBlock } from './schema';

/**
 * `db:verify` proofs for the household graph (`PRIV-3` PR 1, `docs/plans/priv-3-guarded-deletion.md`
 * → Test plan): `packages/db/src/erasure/graph.ts` against the live catalog, and its predicates
 * against a household holding a row in every table.
 *
 * - P1: the graph and the reference tables partition `public`;
 * - P2: graph order is child before parent for every FK, the non-aborting FKs are the allowlist, and
 *   the athlete-grain tables are `ATHLETE_GRAPH`, in its order;
 * - P7: the predicates partition households A and B, and a row straddling the two is matched by
 *   neither (the `AND` rows);
 * - P8: at athlete grain, the household form and step 5's per-profile scopes select the same rows.
 *
 * And the erasure core (`PRIV-3` PR 2a, `src/erasure/erase.ts`):
 *
 * - the lock set: `PARENT_TABLES` against `pg_constraint`; `LOCK_ORDER` and the lock mode pinned
 *   from the source (PGlite has one connection, so no proof can show a wait);
 * - P3: the core erases household H, hidden rows included, and leaves household K, the reference
 *   tables and the global movements exactly as they were; inside a caller's transaction that then
 *   throws, it erases nothing;
 * - P4: each pre-flight (a)–(h), planted alone, refuses naming itself and changes nothing;
 * - P5: a hidden household is erased (measured by raw id), on a committed run.
 *
 * The database is not pristine (`./harness` → `VerifyContext`), so nothing here asserts over a whole
 * table: only over what A's and B's predicates match and the ids this module planted, all rolled back.
 */
export async function verifyErasure(ctx: VerifyContext): Promise<void> {
  await verifyPartition();
  await verifyCatalog();
  await verifyHouseholdPartition(ctx);
  await verifyLocks();
  await verifyCoreErases();
  await verifyDeleteCountChecked();
  await verifyPreflightsRefuse();
  await verifyHiddenHouseholdErased();
  await verifyTimeoutsHold();
  await verifyOneShotErasure();
  await verifyLegacyMovementDeletion();
  await verifyFreshStartCounts();
}

const GRAPH_NAMES = HOUSEHOLD_GRAPH.map((g) => graphTableName(g.table));
const REFERENCE_NAMES = REFERENCE_TABLES.map(graphTableName);
const sorted = (xs: readonly string[]) => [...xs].sort();

// ── P1: every table is in exactly one list ───────────────────────────────────────────────────────
async function verifyPartition(): Promise<void> {
  // `public` only: drizzle's migration ledger lives in the `drizzle` schema and holds no person's data.
  const tables = rowsOf<{ t: string }>(
    await db.execute(sql`
      SELECT table_name AS t FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY 1`),
  ).map((r) => r.t);
  const listed = [...GRAPH_NAMES, ...REFERENCE_NAMES];
  assert.deepEqual(
    listed.filter((t, i) => listed.indexOf(t) !== i),
    [],
    'PRIV-3 1: P1 no table is listed twice across HOUSEHOLD_GRAPH and REFERENCE_TABLES',
  );
  assert.deepEqual(
    listed.filter((t) => !tables.includes(t)),
    [],
    'PRIV-3 1: P1 every table HOUSEHOLD_GRAPH and REFERENCE_TABLES name exists in public',
  );
  assert.deepEqual(
    tables.filter((t) => !listed.includes(t)),
    [],
    'PRIV-3 1: P1 every table in public is in HOUSEHOLD_GRAPH or REFERENCE_TABLES',
  );
  const owned = rowsOf<{ t: string }>(
    await db.execute(sql`
      SELECT DISTINCT c.table_name AS t FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
         AND c.column_name IN ('household_id', 'profile_id')
       ORDER BY 1`),
  ).map((r) => r.t);
  assert.deepEqual(
    owned.filter((t) => !GRAPH_NAMES.includes(t)),
    [],
    'PRIV-3 1: P1 every table with a household_id or profile_id column is in HOUSEHOLD_GRAPH',
  );
  console.log(
    `✓ PRIV-3 1: P1 the ${GRAPH_NAMES.length} graph tables and ${REFERENCE_NAMES.length} reference tables partition public, and every household_id or profile_id table is in the graph`,
  );
}

// ── P2: the graph's order and its non-aborting edges, against pg_constraint ──────────────────────
async function verifyCatalog(): Promise<void> {
  const fks = rowsOf<{ fk: string; child: string; parent: string; rule: string }>(
    await db.execute(sql`
      SELECT conname AS fk, conrelid::regclass::text AS child, confrelid::regclass::text AS parent,
             confdeltype AS rule
        FROM pg_constraint
       WHERE contype = 'f' AND connamespace = 'public'::regnamespace
       ORDER BY conname`),
  );
  const intoGraph = fks.filter((f) => GRAPH_NAMES.includes(f.parent));
  // A self-FK (`workouts.copied_from_workout_id`) cannot be ordered against itself; it is a
  // non-aborting edge, and the allowlist below holds it.
  const outOfOrder = intoGraph
    .filter((f) => f.child !== f.parent)
    .filter(
      (f) =>
        !(
          GRAPH_NAMES.indexOf(f.child) >= 0 &&
          GRAPH_NAMES.indexOf(f.child) < GRAPH_NAMES.indexOf(f.parent)
        ),
    )
    .map((f) => `${f.fk}: ${f.child} → ${f.parent}`);
  assert.deepEqual(
    outOfOrder,
    [],
    'PRIV-3 1: P2 every FK into the graph comes from a graph table deleted before its parent',
  );
  // `a` NO ACTION and `r` RESTRICT both abort a delete that would orphan a row; the rest do not.
  const nonAborting = intoGraph.filter((f) => !['a', 'r'].includes(f.rule));
  assert.deepEqual(
    sorted(nonAborting.map((f) => f.fk)),
    sorted(NON_ABORTING_EDGES.map((e) => e.fk)),
    'PRIV-3 1: P2 the FKs into the graph that do not abort a delete are exactly NON_ABORTING_EDGES',
  );
  for (const e of NON_ABORTING_EDGES) {
    const rule = nonAborting.find((f) => f.fk === e.fk)!.rule;
    assert.equal(
      e.guard === 'cascade',
      rule === 'c',
      `PRIV-3 1: P2 ${e.fk} is guarded as a cascade exactly when it cascades`,
    );
  }
  assert.deepEqual(
    GRAPH_NAMES.filter(isAthleteGrain),
    [...ATHLETE_GRAPH_TABLES],
    "PRIV-3 1: P2 HOUSEHOLD_GRAPH's athlete-grain tables are ATHLETE_GRAPH's, in its order",
  );
  console.log(
    `✓ PRIV-3 1: P2 every FK into the graph runs child before parent; the ${NON_ABORTING_EDGES.length} non-aborting FKs are the allowlist; the athlete-grain tables are ATHLETE_GRAPH, in order`,
  );
}

// ── P7 and P8: the predicates against a household holding a row in every table ──────────────────

/** Two predicates, each parenthesized: drizzle's `and()` does not wrap its operands. */
const both = (x: SQL, y: SQL) => sql`(${x}) AND (${y})`;

/** The ids of `table` a predicate matches, ascending. */
async function idsMatching(tx: VerifyTx, g: (typeof HOUSEHOLD_GRAPH)[number], where: SQL) {
  return idsOf(
    await tx.execute(sql`SELECT ${g.table.id} AS id FROM ${g.table} WHERE ${where} ORDER BY 1`),
  );
}

async function householdOf(tx: VerifyTx, blockId: number): Promise<number> {
  const [{ householdId }] = await tx
    .select({ householdId: schema.programBlocks.householdId })
    .from(schema.programBlocks)
    .where(eq(schema.programBlocks.id, blockId));
  return householdId!;
}

/**
 * A row of `scope`'s household in EVERY graph table, through the real writers where one exists, and
 * the ids planted, by table. The household row itself is the one table nothing inserts into.
 */
async function populateEveryGraphTable(
  tx: VerifyTx,
  scope: HouseholdScope,
  label: string,
): Promise<{ householdId: number; planted: Map<string, number[]> }> {
  const exec = asTx(tx);
  const planted = new Map<string, number[]>();
  const plant = (t: Parameters<typeof graphTableName>[0], id: number) =>
    planted.set(graphTableName(t), [...(planted.get(graphTableName(t)) ?? []), id]);

  const blockId = await mkTemplateBlock(exec, scope, `${label}-block`);
  plant(schema.programBlocks, blockId);
  const householdId = await householdOf(tx, blockId);
  plant(schema.households, householdId);

  const memberPublicId = newId();
  await insertHouseholdMember(exec, scope, {
    publicId: memberPublicId,
    clerkUserId: `verify_${label}_${memberPublicId}`,
    role: HOUSEHOLD_ROLE.member,
  });
  const [member] = await tx
    .select({ id: schema.householdMembers.id })
    .from(schema.householdMembers)
    .where(eq(schema.householdMembers.publicId, memberPublicId));
  plant(schema.householdMembers, member.id);

  const movementPublicId = newId();
  await insertMovementOwnedBy(exec, scope, {
    publicId: movementPublicId,
    slug: `${label}-movement`,
    name: `${label} movement`,
    isBodyweight: false,
  });
  const [movement] = await tx
    .select({ id: schema.movements.id })
    .from(schema.movements)
    .where(eq(schema.movements.publicId, movementPublicId));
  plant(schema.movements, movement.id);
  // CAT-3 A1: one row in each join table, on this household's own movement (no writer makes one; the
  // planted rows exist only inside this rolled-back fixture). `.at(-1)`: mutation 321 drops the FIRST
  // muscle from the seed, and this fixture must not fail before its proof does.
  const [equipmentRow] = await tx
    .insert(schema.movementEquipment)
    .values({ movementId: movement.id, equipmentCode: EQUIPMENT.at(-1)! })
    .returning({ id: schema.movementEquipment.id });
  plant(schema.movementEquipment, equipmentRow.id);
  const [muscleRow] = await tx
    .insert(schema.movementMuscles)
    .values({ movementId: movement.id, muscleCode: MUSCLES.at(-1)!, role: MUSCLE_ROLE.primary })
    .returning({ id: schema.movementMuscles.id });
  plant(schema.movementMuscles, muscleRow.id);

  const kid = await mkKid(tx, householdId, `${label} athlete`);
  plant(schema.profiles, kid);

  const workout = (await insertWorkoutOwnedBy(exec, scope, {
    blockId,
    clientId: newId(),
    name: `${label} workout`,
    description: null,
  }))!;
  plant(schema.workouts, workout.id);
  const [slot] = await tx
    .insert(schema.blockDayWorkouts)
    .values({ blockId, weekday: 1, idx: 0, workoutId: workout.id })
    .returning({ id: schema.blockDayWorkouts.id });
  plant(schema.blockDayWorkouts, slot.id);
  const [prescription] = await tx
    .insert(schema.prescriptions)
    .values({
      publicId: newId(),
      blockId,
      workoutId: workout.id,
      clientId: newId(),
      movementId: movement.id,
      idx: 0,
    })
    .returning({ id: schema.prescriptions.id });
  plant(schema.prescriptions, prescription.id);
  const [quantity] = await tx
    .insert(schema.prescriptionQuantities)
    .values({
      prescriptionId: prescription.id,
      slot: QUANTITY_SLOT.primary,
      dimension: UNIT_DIMENSION.mass,
      unit: 'lb',
      valueMin: '45',
    })
    .returning({ id: schema.prescriptionQuantities.id });
  plant(schema.prescriptionQuantities, quantity.id);
  const [target] = await tx
    .insert(schema.prescriptionTargets)
    .values({ publicId: newId(), prescriptionId: prescription.id, profileId: kid, load: '45' })
    .returning({ id: schema.prescriptionTargets.id });
  plant(schema.prescriptionTargets, target.id);

  const assignment = await mkAssignment(tx, { blockId, profileId: kid }, [1]);
  plant(schema.programAssignments, assignment);
  const [weekday] = await tx
    .select({ id: schema.programAssignmentWeekdays.id })
    .from(schema.programAssignmentWeekdays)
    .where(eq(schema.programAssignmentWeekdays.assignmentId, assignment));
  plant(schema.programAssignmentWeekdays, weekday.id);

  const [{ metricKey }] = await tx
    .select({ metricKey: schema.metricDefinitions.key })
    .from(schema.metricDefinitions)
    .orderBy(schema.metricDefinitions.key)
    .limit(1);
  const [readiness] = await tx
    .insert(schema.dayReadiness)
    .values({
      publicId: newId(),
      profileId: kid,
      readinessDate: '2026-11-10',
      gateColor: GATE_COLORS[0],
    })
    .returning({ id: schema.dayReadiness.id });
  plant(schema.dayReadiness, readiness.id);
  const [ramp] = await tx
    .insert(schema.rampTargets)
    .values({
      publicId: newId(),
      profileId: kid,
      metricKey,
      weekStart: '2026-11-09',
      targetValue: '10',
    })
    .returning({ id: schema.rampTargets.id });
  plant(schema.rampTargets, ramp.id);

  const [session] = await tx
    .insert(schema.sessions)
    .values({
      publicId: newId(),
      clientId: newId(),
      profileId: kid,
      activityDate: '2026-11-10',
      sessionType: SESSION_TYPES[0],
      workoutId: workout.id,
      workoutName: 'Probe workout',
    })
    .returning({ id: schema.sessions.id });
  plant(schema.sessions, session.id);
  const [superset] = await tx
    .insert(schema.supersets)
    .values({ publicId: newId(), clientId: newId(), sessionId: session.id })
    .returning({ id: schema.supersets.id });
  plant(schema.supersets, superset.id);

  // A strength entry's reference columns (unit, activity type, kind) from any live strength entry.
  // Its `movement_name` is another household's text, so it is not copied: the name is this fixture's.
  const [base] = await tx
    .select()
    .from(schema.entries)
    .where(
      sql`${schema.entries.kind} = 'strength' and ${schema.entries.movementId} is not null and ${schema.entries.metricKey} is null and ${schema.entries.deletedAt} is null`,
    )
    .orderBy(schema.entries.id)
    .limit(1);
  assert.ok(base, `PRIV-3 1: ${label} a strength entry exists to take reference columns from`);
  const [entry] = await tx
    .insert(schema.entries)
    .values({
      publicId: newId(),
      clientId: newId(),
      profileId: kid,
      activityDate: '2026-11-10',
      kind: base.kind,
      unit: base.unit,
      movementName: `${label} movement`,
      activityTypeId: base.activityTypeId,
      movementId: movement.id,
      sessionId: session.id,
      supersetId: superset.id,
      supersetOrder: 1,
      prescriptionId: prescription.id,
      prescriptionSet: 1,
    })
    .returning({ id: schema.entries.id });
  plant(schema.entries, entry.id);
  const [entrySet] = await tx
    .insert(schema.entrySets)
    .values({ publicId: newId(), clientId: newId(), entryId: entry.id, idx: 1 })
    .returning({ id: schema.entrySets.id });
  plant(schema.entrySets, entrySet.id);
  const [setQuantity] = await tx
    .insert(schema.entrySetQuantities)
    .values({
      clientId: newId(),
      entrySetId: entrySet.id,
      slot: QUANTITY_SLOT.primary,
      dimension: UNIT_DIMENSION.mass,
      unit: 'lb',
      valueNum: '45',
    })
    .returning({ id: schema.entrySetQuantities.id });
  plant(schema.entrySetQuantities, setQuantity.id);

  // The guard: a table added to the graph without a row here would pass P7 as empty.
  assert.deepEqual(
    sorted([...planted.keys()]),
    sorted(GRAPH_NAMES),
    `PRIV-3 1: P7 the ${label} fixture holds a row in every HOUSEHOLD_GRAPH table`,
  );
  return { householdId, planted };
}

/**
 * Hide every planted row in each graph table that has a `deleted_at` column, except `skip`, and
 * return the tables hidden.
 */
async function hidePlanted(
  tx: VerifyTx,
  planted: Map<string, number[]>,
  skip: readonly string[] = [],
): Promise<string[]> {
  const withDeletedAt = rowsOf<{ t: string }>(
    await tx.execute(sql`
      SELECT table_name AS t FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'deleted_at'`),
  ).map((r) => r.t);
  const hidden: string[] = [];
  for (const g of HOUSEHOLD_GRAPH) {
    const name = graphTableName(g.table);
    if (!withDeletedAt.includes(name) || skip.includes(name)) continue;
    const ids = sql.join(
      planted.get(name)!.map((id) => sql`${id}`),
      sql`, `,
    );
    await tx.execute(
      sql`UPDATE ${g.table} SET ${sql.identifier('deleted_at')} = now() WHERE ${g.table.id} IN (${ids})`,
    );
    hidden.push(name);
  }
  return hidden;
}

async function verifyHouseholdPartition({ A_SCOPE, B_SCOPE }: VerifyContext): Promise<void> {
  await rolledBack(async (tx) => {
    const { householdId: bHousehold, planted } = await populateEveryGraphTable(
      tx,
      B_SCOPE,
      'priv-3-1-b',
    );
    const aBlock = await mkTemplateBlock(asTx(tx), A_SCOPE, 'priv-3-1-a');
    const aHousehold = await householdOf(tx, aBlock);
    const aKid = await mkKid(tx, aHousehold, 'PRIV-3 1 straddling athlete');
    const bBlock = planted.get('program_blocks')![0];
    const bPrescription = planted.get('prescriptions')![0];

    // Two straddles, the shapes no writer makes: A's athlete on B's program.
    const [ptStraddle] = await tx
      .insert(schema.prescriptionTargets)
      .values({ publicId: newId(), prescriptionId: bPrescription, profileId: aKid, load: '45' })
      .returning({ id: schema.prescriptionTargets.id });
    const paStraddle = await mkAssignment(tx, { blockId: bBlock, profileId: aKid, idx: 1 }, [1]);
    const [paStraddleWeekday] = await tx
      .select({ id: schema.programAssignmentWeekdays.id })
      .from(schema.programAssignmentWeekdays)
      .where(eq(schema.programAssignmentWeekdays.assignmentId, paStraddle));
    const byName = (name: string) => HOUSEHOLD_GRAPH.find((g) => graphTableName(g.table) === name)!;

    // (c) first: a straddle is the narrowest witness of an `AND` widened to `OR`.
    for (const [name, id] of [
      ['prescription_targets', ptStraddle.id],
      ['program_assignments', paStraddle],
      ['program_assignment_weekdays', paStraddleWeekday.id],
    ] as const) {
      const g = byName(name);
      for (const [side, scope] of [
        ['A', A_SCOPE],
        ['B', B_SCOPE],
      ] as const) {
        assert.deepEqual(
          await idsMatching(tx, g, both(eq(g.table.id, id), g.householdRows(scope))),
          [],
          `PRIV-3 1: P7 a ${name} row straddling A and B is matched by neither household (${side})`,
        );
      }
    }

    // (a) no row of any graph table is matched by both households.
    for (const g of HOUSEHOLD_GRAPH) {
      const name = graphTableName(g.table);
      assert.deepEqual(
        await idsMatching(tx, g, both(g.householdRows(A_SCOPE), g.householdRows(B_SCOPE))),
        [],
        `PRIV-3 1: P7 no ${name} row is matched by both households`,
      );
    }

    // (b) every planted row is matched by B's predicate and not by A's: first live, then hidden, so a
    // `deleted_at` conjunct in any table's predicate goes red here.
    const assertPlantedMatchedByBAlone = async (phase: string) => {
      for (const g of HOUSEHOLD_GRAPH) {
        const name = graphTableName(g.table);
        for (const id of planted.get(name)!) {
          assert.deepEqual(
            await idsMatching(tx, g, both(eq(g.table.id, id), g.householdRows(B_SCOPE))),
            [id],
            `PRIV-3 1: P7 household B's planted ${name} row is matched by B (${phase})`,
          );
          assert.deepEqual(
            await idsMatching(tx, g, both(eq(g.table.id, id), g.householdRows(A_SCOPE))),
            [],
            `PRIV-3 1: P7 household B's planted ${name} row is not matched by A (${phase})`,
          );
        }
      }
    };
    await assertPlantedMatchedByBAlone('live');
    const hidden = await hidePlanted(tx, planted);
    assert.ok(
      hidden.length > 0,
      'PRIV-3 1: P7 the fixture hides its rows in the soft-delete tables',
    );
    await assertPlantedMatchedByBAlone('hidden');

    // The two new leaves, named: the household row and the membership.
    const households = byName('households');
    assert.deepEqual(
      await idsMatching(
        tx,
        households,
        both(
          householdRowIs(A_SCOPE),
          sql`${schema.households.id} IN (${aHousehold}, ${bHousehold})`,
        ),
      ),
      [aHousehold],
      "PRIV-3 1: P7 householdRowIs(A) matches A's household row and not B's",
    );
    assert.deepEqual(
      await idsMatching(
        tx,
        byName('household_members'),
        both(
          householdMemberInHousehold(A_SCOPE),
          eq(schema.householdMembers.id, planted.get('household_members')![0]),
        ),
      ),
      [],
      "PRIV-3 1: P7 householdMemberInHousehold(A) does not match B's member",
    );
    console.log(
      `✓ PRIV-3 1: P7 with B holding a row in all ${GRAPH_NAMES.length} graph tables, no row is matched by both A and B, each planted row by B alone, and both straddles by neither; hidden and live alike (${hidden.length} soft-delete tables)`,
    );

    // ── P8: at athlete grain, the household form and step 5's scope select the same rows ──────────
    // A hidden athlete of B with only a hidden readiness row, and no session: the household form
    // must reach it through `profiles` as step 5's scope does, hidden rows included.
    const hiddenKid = await mkKid(tx, bHousehold, 'PRIV-3 1 hidden athlete');
    await tx
      .update(schema.profiles)
      .set({ deletedAt: new Date() })
      .where(eq(schema.profiles.id, hiddenKid));
    await tx.insert(schema.dayReadiness).values({
      publicId: newId(),
      profileId: hiddenKid,
      readinessDate: '2026-11-11',
      gateColor: GATE_COLORS[0],
      deletedAt: new Date(),
    });
    // B's athletes by the raw column, not by the predicate under test, hidden ones included. The
    // straddles belong to A's athlete, so neither enters B's sets on either side.
    // ⚠️ P8 holds only on data with no straddling row (the per-profile scope takes one, the `AND`
    // leaves it). A straddling B row that an earlier module COMMITTED would turn this red by design:
    // that is a row "Erase one athlete"'s pre-flight 2 would refuse.
    const bProfiles = (
      await tx
        .select({ id: schema.profiles.id })
        .from(schema.profiles)
        .where(eq(schema.profiles.householdId, bHousehold))
    ).map((r) => r.id);
    for (const { table, scope } of ATHLETE_GRAPH) {
      const union = new Set<number>();
      for (const p of bProfiles) {
        for (const id of idsOf(
          await tx.execute(sql`SELECT id FROM ${sql.identifier(table)} WHERE ${scope(p)}`),
        )) {
          union.add(id);
        }
      }
      const byScope = [...union].sort((x, y) => x - y);
      assert.ok(byScope.length > 0, `PRIV-3 1: P8 household B holds a row in ${table}`);
      const g = byName(table);
      assert.deepEqual(
        await idsMatching(tx, g, g.householdRows(B_SCOPE)),
        byScope,
        `PRIV-3 1: P8 the household form and step 5's scope select the same rows of ${table}`,
      );
    }
    console.log(
      `✓ PRIV-3 1: P8 for household B, each of the ${ATHLETE_GRAPH.length} athlete-grain tables selects the same ids by the household form as by step 5's per-athlete scopes`,
    );
  });
}

// ── PRIV-3 2a: the erasure core ─────────────────────────────────────────────────────────────────

async function newHousehold(tx: VerifyTx | typeof db, name: string): Promise<number> {
  const [row] = await tx
    .insert(schema.households)
    .values({ publicId: newId(), name })
    .returning({ id: schema.households.id });
  return row.id;
}

/** Each graph table's ids matched by `scope`'s predicate, by table name. */
async function idsByTable(tx: VerifyTx, scope: HouseholdScope): Promise<Record<string, number[]>> {
  const out: Record<string, number[]> = {};
  for (const g of HOUSEHOLD_GRAPH) {
    out[graphTableName(g.table)] = await idsMatching(tx, g, g.householdRows(scope));
  }
  return out;
}

/** Of the planted ids, those still present, by raw id (never through a predicate under test). */
async function stillThere(tx: VerifyTx, planted: Map<string, number[]>): Promise<number> {
  let n = 0;
  for (const g of HOUSEHOLD_GRAPH) {
    const ids = planted.get(graphTableName(g.table)) ?? [];
    if (ids.length === 0) continue;
    const list = sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    );
    n += rowsOf<{ n: number }>(
      await tx.execute(
        sql`SELECT count(*)::int AS n FROM ${g.table} WHERE ${g.table.id} IN (${list})`,
      ),
    )[0].n;
  }
  return n;
}

/** The reference tables and the global movements, as one comparable value. */
async function sharedRows(tx: VerifyTx): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of REFERENCE_TABLES) {
    out[graphTableName(t)] = rowsOf<{ d: string }>(
      await tx.execute(
        sql`SELECT count(*)::text || ':' || md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS d FROM ${t} x`,
      ),
    )[0].d;
  }
  out['movements (global)'] = idsOf(
    await tx.execute(
      sql`SELECT ${schema.movements.id} AS id FROM ${schema.movements} WHERE ${schema.movements.householdId} IS NULL ORDER BY 1`,
    ),
  ).join(',');
  return out;
}

const NO_PREFLIGHT = Object.fromEntries(PREFLIGHT_CHECKS.map((c) => [c, 0]));

// ── The lock set and its order ───────────────────────────────────────────────────────────────────
async function verifyLocks(): Promise<void> {
  const parents = rowsOf<{ t: string }>(
    await db.execute(sql`
      SELECT DISTINCT confrelid::regclass::text AS t FROM pg_constraint
       WHERE contype = 'f' AND connamespace = 'public'::regnamespace`),
  )
    .map((r) => r.t)
    .filter((t) => GRAPH_NAMES.includes(t));
  assert.deepEqual(
    sorted(PARENT_TABLES.map(graphTableName)),
    sorted(parents),
    'PRIV-3 2a: PARENT_TABLES is exactly the graph tables some foreign key points into',
  );
  // The program writers lock `program_blocks`, then `profiles` (`writers/program/assign.ts`, lane
  // guide invariant 12); the core takes the same two first, then the household row, then the two
  // again (to hold any inserted before the household row was locked), then every other parent,
  // parent first.
  const parentNames = PARENT_TABLES.map(graphTableName);
  const first = ['program_blocks', 'profiles'];
  const expected = [
    ...first,
    'households',
    ...first,
    ...[...parentNames].reverse().filter((t) => !first.includes(t) && t !== 'households'),
  ];
  assert.deepEqual(
    LOCK_ORDER.map(graphTableName),
    expected,
    "PRIV-3 2a: the core locks program_blocks, then profiles, then the household, then both again, then the other parents parent first (the program writers' order)",
  );
  // The mode and the place, from the source: PGlite has one connection, so no proof can show a wait.
  const src = readFileSync(new URL('../../src/erasure/erase.ts', import.meta.url), 'utf8');
  const lock = src.match(
    /for \(const t of LOCK_ORDER\) \{\s*await tx\.execute\(\s*sql`SELECT \$\{t\.id\} FROM \$\{t\} WHERE \$\{householdRowsOf\(t, scope\)\} ORDER BY \$\{t\.id\} (FOR [A-Z ]+)`/,
  );
  assert.ok(lock, 'PRIV-3 2a: erase.ts locks each LOCK_ORDER table in one statement, in id order');
  assert.equal(
    lock[1],
    'FOR UPDATE',
    'PRIV-3 2a: the core locks the parents FOR UPDATE (FOR NO KEY UPDATE lets a child insert through)',
  );
  assert.ok(
    !/\.for\(/.test(src) && (src.match(/ORDER BY \$\{t\.id\} FOR /g) ?? []).length === 1,
    'PRIV-3 2a: erase.ts takes no other row lock',
  );
  assert.ok(
    src.indexOf(lock[0]) < src.indexOf('const m = await measure(tx, scope)'),
    'PRIV-3 2a: the core locks before it re-runs the pre-flights',
  );
  console.log(
    `✓ PRIV-3 2a: the core locks the ${PARENT_TABLES.length} parent tables FOR UPDATE, program_blocks then profiles first and again after the household row, before its pre-flights`,
  );
}

// ── P3: the core erases H and nothing else ──────────────────────────────────────────────────────
async function verifyCoreErases(): Promise<void> {
  await rolledBack(async (tx) => {
    const H_SCOPE = householdScopeForScript(await newHousehold(tx, 'verify PRIV-3 2a H'));
    const K_SCOPE = householdScopeForScript(await newHousehold(tx, 'verify PRIV-3 2a K'));
    const h = asOwner(H_SCOPE, 'PRIV-3 2a: H');
    const live = await populateEveryGraphTable(tx, H_SCOPE, 'priv-3-2a-h');
    const hiddenSet = await populateEveryGraphTable(tx, H_SCOPE, 'priv-3-2a-h-hidden');
    // The second set hidden: block, workout, assignment, profile, entry, membership and the rest. The
    // household row stays live here; P5 erases a hidden one.
    const hiddenTables = await hidePlanted(tx, hiddenSet.planted, ['households']);
    await populateEveryGraphTable(tx, K_SCOPE, 'priv-3-2a-k');
    // One sign-in, hidden in H and live in K (the "freed slot"): the report must mark it.
    const shared = `verify_priv_3_2a_shared_${newId()}`;
    await tx.insert(schema.householdMembers).values([
      {
        publicId: newId(),
        householdId: live.householdId,
        clerkUserId: shared,
        role: HOUSEHOLD_ROLE.member,
        deletedAt: new Date(),
      },
    ]);
    const kMember = await tx
      .select({ householdId: schema.householdMembers.householdId })
      .from(schema.householdMembers)
      .where(householdMemberInHousehold(K_SCOPE))
      .limit(1);
    await tx.insert(schema.householdMembers).values({
      publicId: newId(),
      householdId: kMember[0].householdId,
      clerkUserId: shared,
      role: HOUSEHOLD_ROLE.member,
    });
    // Neither of these is live elsewhere, by the resolver's rule (member row AND household live):
    // a sign-in live in H and hidden in K, and one hidden in H and live in a HIDDEN household.
    const liveInH = `verify_priv_3_2a_live_in_h_${newId()}`;
    const inHiddenHousehold = `verify_priv_3_2a_hidden_household_${newId()}`;
    const hiddenHousehold = await newHousehold(tx, 'verify PRIV-3 2a hidden K2');
    await tx
      .update(schema.households)
      .set({ deletedAt: new Date() })
      .where(eq(schema.households.id, hiddenHousehold));
    await tx.insert(schema.householdMembers).values([
      {
        publicId: newId(),
        householdId: live.householdId,
        clerkUserId: liveInH,
        role: HOUSEHOLD_ROLE.member,
      },
      {
        publicId: newId(),
        householdId: kMember[0].householdId,
        clerkUserId: liveInH,
        role: HOUSEHOLD_ROLE.member,
        deletedAt: new Date(),
      },
      {
        publicId: newId(),
        householdId: live.householdId,
        clerkUserId: inHiddenHousehold,
        role: HOUSEHOLD_ROLE.member,
        deletedAt: new Date(),
      },
      {
        publicId: newId(),
        householdId: hiddenHousehold,
        clerkUserId: inHiddenHousehold,
        role: HOUSEHOLD_ROLE.member,
      },
    ]);
    // K's movement that nothing references, inserted LAST: the newest movement row in the database.
    // A walk that widened `movements` to another household's unreferenced row would delete it with no
    // foreign key to stop it; the core's household check must.
    await insertMovementOwnedBy(asTx(tx), K_SCOPE, {
      publicId: newId(),
      slug: 'priv-3-2a-k-orphan',
      name: 'priv-3-2a K orphan movement',
      isBodyweight: false,
    });

    const hBefore = await idsByTable(tx, H_SCOPE);
    const kBefore = await idsByTable(tx, K_SCOPE);
    const sharedBefore = await sharedRows(tx);

    // The dry run: counts, pre-flights and memberships; nothing changes.
    const dry = await eraseHousehold(asTx(tx), h, { apply: false });
    assert.deepEqual(
      dry.counts,
      GRAPH_NAMES.map((t) => ({ table: t, rows: hBefore[t].length })),
      "PRIV-3 2a: P3 the dry run counts H's rows in every graph table, in graph order",
    );
    assert.ok(
      dry.counts.every((c) => c.rows > 0),
      'PRIV-3 2a: P3 H holds a row in every graph table',
    );
    assert.deepEqual(
      dry.preflights,
      NO_PREFLIGHT,
      'PRIV-3 2a: P3 every pre-flight reads zero on H',
    );
    assert.equal(dry.restorePoint, null, 'PRIV-3 2a: P3 a dry run reports no restore point');
    assert.deepEqual(
      await idsByTable(tx, H_SCOPE),
      hBefore,
      'PRIV-3 2a: P3 the dry run erases nothing',
    );
    assert.deepEqual(
      dry.members.filter((m) => m.liveElsewhere).map((m) => m.clerkUserId),
      [shared],
      'PRIV-3 2a: P3 the report marks exactly the sign-in that is live in another household (not one hidden there, nor one in a hidden household)',
    );
    assert.equal(
      dry.members.length,
      hBefore.household_members.length,
      'PRIV-3 2a: P3 the report lists every membership of H, hidden ones too',
    );

    // Inside a caller's transaction (CAT-3 R0's shape): the core completes, the caller throws, and
    // the whole erasure is rolled back with the caller's transaction.
    let inner: Awaited<ReturnType<typeof eraseHousehold>> | undefined;
    await assert.doesNotReject(
      rolledBack(async (callerTx) => {
        inner = await eraseHousehold(asTx(callerTx), h, { apply: true });
      }, tx),
      'PRIV-3 2a: P3 the core erases household H, hidden rows included',
    );
    assert.deepEqual(
      inner?.counts,
      dry.counts,
      'PRIV-3 2a: P3 the core reports the per-table counts it deleted, equal to the dry run',
    );
    assert.equal(
      inner?.total,
      dry.total,
      'PRIV-3 2a: P3 the deleted total equals the dry run total',
    );
    assert.deepEqual(
      await idsByTable(tx, H_SCOPE),
      hBefore,
      "PRIV-3 2a: P3 a caller's throw after the core rolls the whole erasure back",
    );

    // The erasure, applied.
    const applied = await eraseHousehold(asTx(tx), h, { apply: true });
    assert.ok(
      applied.applied && applied.restorePoint && applied.restorePoint.walLsn.length > 0,
      'PRIV-3 2a: P3 an applied run reports its restore point',
    );
    assert.deepEqual(
      applied.counts,
      dry.counts,
      'PRIV-3 2a: P3 the applied counts are the dry run',
    );
    assert.deepEqual(
      Object.values(await idsByTable(tx, H_SCOPE)).flat(),
      [],
      "PRIV-3 2a: P3 no graph table holds a row of H's afterwards",
    );
    assert.equal(
      (await stillThere(tx, live.planted)) + (await stillThere(tx, hiddenSet.planted)),
      0,
      'PRIV-3 2a: P3 every planted row of H is gone by raw id, hidden ones included',
    );
    assert.deepEqual(
      await idsByTable(tx, K_SCOPE),
      kBefore,
      "PRIV-3 2a: P3 household K's id sets are unchanged, table by table",
    );
    assert.deepEqual(
      await sharedRows(tx),
      sharedBefore,
      'PRIV-3 2a: P3 the reference tables and the global movements are unchanged',
    );
    await assert.rejects(
      eraseHousehold(asTx(tx), h, { apply: true }),
      ErasureTargetNotFound,
      'PRIV-3 2a: P3 a second run finds nothing to erase',
    );
    await assert.rejects(
      eraseHousehold(asTx(tx), h, { apply: false }),
      ErasureTargetNotFound,
      'PRIV-3 2a: P3 a dry run of an erased household finds nothing',
    );
    console.log(
      `✓ PRIV-3 2a: P3 the core erases ${dry.total} rows of H across all ${GRAPH_NAMES.length} graph tables (hidden rows in ${hiddenTables.length} tables), leaves K, the reference tables and the global movements unchanged, rolls back with a caller that throws, and marks the sign-in live elsewhere`,
    );
  });
}

// ── P3b: a DELETE that removes fewer rows than it counted aborts the erasure ───────────────────
async function verifyDeleteCountChecked(): Promise<void> {
  await rolledBack(async (tx) => {
    const H_SCOPE = householdScopeForScript(await newHousehold(tx, 'verify PRIV-3 2a P3b H'));
    const h = asOwner(H_SCOPE, 'PRIV-3 2a: H');
    await populateEveryGraphTable(tx, H_SCOPE, 'priv-3-2a-p3b');
    // A trigger that silently skips every delete of one leaf table. Without the RETURNING-length
    // check the skipped rows would surface later as an untyped 23503 (day_readiness -> profiles);
    // the check names the table first, with a correct report. Rolled back with the transaction.
    await tx.execute(sql`
      CREATE FUNCTION verify_priv_3_2a_skip_delete() RETURNS trigger LANGUAGE plpgsql
        AS $$ BEGIN RETURN NULL; END $$`);
    await tx.execute(sql`
      CREATE TRIGGER verify_priv_3_2a_skip_delete BEFORE DELETE ON day_readiness
        FOR EACH ROW EXECUTE FUNCTION verify_priv_3_2a_skip_delete()`);
    let thrown: unknown;
    try {
      await eraseHousehold(asTx(tx), h, { apply: true });
    } catch (e) {
      thrown = e;
    }
    assert.ok(
      thrown instanceof ErasureCountMismatch &&
        thrown.table === 'day_readiness' &&
        thrown.expected === 1 &&
        thrown.actual === 0,
      `PRIV-3 2a: P3b a DELETE that removes fewer rows than it counted aborts with ErasureCountMismatch on that table (threw: ${String((thrown as Error)?.message).slice(0, 120)})`,
    );
    console.log(
      '✓ PRIV-3 2a: P3b a DELETE that removes fewer rows than it counted aborts the erasure, naming the table',
    );
  });
}

// ── P4: each pre-flight refuses, naming itself, and changes nothing ─────────────────────────────
async function verifyPreflightsRefuse(): Promise<void> {
  await rolledBack(async (tx) => {
    const H_SCOPE = householdScopeForScript(await newHousehold(tx, 'verify PRIV-3 2a P4 H'));
    const K_SCOPE = householdScopeForScript(await newHousehold(tx, 'verify PRIV-3 2a P4 K'));
    const h = asOwner(H_SCOPE, 'PRIV-3 2a: H');
    const H = (await populateEveryGraphTable(tx, H_SCOPE, 'priv-3-2a-p4-h')).planted;
    const K = (await populateEveryGraphTable(tx, K_SCOPE, 'priv-3-2a-p4-k')).planted;
    const one = (m: Map<string, number[]>, t: string) => m.get(t)![0];

    /** A copy of `from`'s entry with no session, superset or prescription, then `values`. */
    const plantEntry = async (
      sp: VerifyTx,
      from: number,
      values: Partial<typeof schema.entries.$inferInsert>,
    ) => {
      const [base] = await sp.select().from(schema.entries).where(eq(schema.entries.id, from));
      const { id, ...rest } = base;
      void id;
      const [row] = await sp
        .insert(schema.entries)
        .values({
          ...rest,
          publicId: newId(),
          clientId: newId(),
          sessionId: null,
          supersetId: null,
          supersetOrder: null,
          prescriptionId: null,
          prescriptionSet: null,
          ...values,
        })
        .returning({ id: schema.entries.id });
      return row.id;
    };
    /** A nullable pointer the check guards: the planted row must still hold it after the refusal. */
    type Pointer = { table: PgTableWithId; id: number; column: string; value: number };
    type PgTableWithId = (typeof HOUSEHOLD_GRAPH)[number]['table'];
    const pointerOf = async (sp: VerifyTx, p: Pointer) =>
      Number(
        rowsOf<{ v: number | string | null }>(
          await sp.execute(
            sql`SELECT ${sql.identifier(p.column)} AS v FROM ${p.table} WHERE ${p.table.id} = ${p.id}`,
          ),
        )[0].v,
      );

    const cases: {
      check: PreflightCheck;
      what: string;
      plant: (sp: VerifyTx) => Promise<Pointer | null>;
    }[] = [
      {
        check: 'a',
        what: "K's athlete's target on H's prescription",
        plant: async (sp) => {
          await sp.insert(schema.prescriptionTargets).values({
            publicId: newId(),
            prescriptionId: one(H, 'prescriptions'),
            profileId: one(K, 'profiles'),
            load: '45',
          });
          return null;
        },
      },
      {
        check: 'a',
        what: "H's athlete's target on K's prescription",
        plant: async (sp) => {
          await sp.insert(schema.prescriptionTargets).values({
            publicId: newId(),
            prescriptionId: one(K, 'prescriptions'),
            profileId: one(H, 'profiles'),
            load: '45',
          });
          return null;
        },
      },
      {
        check: 'b',
        what: "K's athlete's entry in H's session",
        plant: async (sp) => {
          await plantEntry(sp, one(K, 'entries'), { sessionId: one(H, 'sessions') });
          return null;
        },
      },
      {
        check: 'c',
        what: "K's athlete's entry in H's superset",
        plant: async (sp) => {
          await plantEntry(sp, one(K, 'entries'), {
            sessionId: one(K, 'sessions'),
            supersetId: one(H, 'supersets'),
            supersetOrder: 2,
          });
          return null;
        },
      },
      {
        check: 'd',
        what: "K's athlete's entry on H's movement",
        plant: async (sp) => {
          await plantEntry(sp, one(K, 'entries'), { movementId: one(H, 'movements') });
          return null;
        },
      },
      {
        check: 'd',
        what: "K's prescription on H's movement",
        plant: async (sp) => {
          await sp
            .update(schema.prescriptions)
            .set({ movementId: one(H, 'movements') })
            .where(eq(schema.prescriptions.id, one(K, 'prescriptions')));
          return null;
        },
      },
      {
        check: 'e',
        what: "K's workout copied from H's workout",
        plant: async (sp) => {
          const id = one(K, 'workouts');
          await sp
            .update(schema.workouts)
            .set({ copiedFromWorkoutId: one(H, 'workouts'), copiedFromProgramName: 'P4 copy' })
            .where(eq(schema.workouts.id, id));
          return {
            table: schema.workouts,
            id,
            column: 'copied_from_workout_id',
            value: one(H, 'workouts'),
          };
        },
      },
      {
        check: 'f',
        what: "K's session naming H's workout",
        plant: async (sp) => {
          const id = one(K, 'sessions');
          await sp
            .update(schema.sessions)
            .set({ workoutId: one(H, 'workouts') })
            .where(eq(schema.sessions.id, id));
          return { table: schema.sessions, id, column: 'workout_id', value: one(H, 'workouts') };
        },
      },
      {
        check: 'g',
        what: "K's entry naming H's prescription",
        plant: async (sp) => {
          const id = one(K, 'entries');
          await sp
            .update(schema.entries)
            .set({ prescriptionId: one(H, 'prescriptions') })
            .where(eq(schema.entries.id, id));
          return {
            table: schema.entries,
            id,
            column: 'prescription_id',
            value: one(H, 'prescriptions'),
          };
        },
      },
      {
        check: 'h',
        what: "K's athlete's assignment to H's program",
        plant: async (sp) => {
          await mkAssignment(sp, {
            blockId: one(H, 'program_blocks'),
            profileId: one(K, 'profiles'),
            idx: 1,
          });
          return null;
        },
      },
      {
        check: 'h',
        what: "H's athlete's assignment to K's program",
        plant: async (sp) => {
          await mkAssignment(sp, {
            blockId: one(K, 'program_blocks'),
            profileId: one(H, 'profiles'),
            idx: 1,
          });
          return null;
        },
      },
    ];

    for (const c of cases) {
      await rolledBack(async (sp) => {
        const pointer = await c.plant(sp);
        const before = [await idsByTable(sp, H_SCOPE), await idsByTable(sp, K_SCOPE)];
        let thrown: unknown;
        try {
          await eraseHousehold(asTx(sp), h, { apply: true });
        } catch (e) {
          thrown = e;
        }
        assert.ok(
          thrown instanceof ErasurePreflightRefused && thrown.check === c.check,
          `PRIV-3 2a: P4 (${c.check}) ${c.what} refuses the erasure, naming (${c.check}) (threw: ${String((thrown as Error)?.message).slice(0, 120)})`,
        );
        assert.deepEqual(
          [await idsByTable(sp, H_SCOPE), await idsByTable(sp, K_SCOPE)],
          before,
          `PRIV-3 2a: P4 (${c.check}) the refusal changes no row of H or K`,
        );
        if (pointer) {
          assert.equal(
            await pointerOf(sp, pointer),
            pointer.value,
            `PRIV-3 2a: P4 (${c.check}) the planted row still points at H's row`,
          );
        }
        const dry = await eraseHousehold(asTx(sp), h, { apply: false });
        assert.deepEqual(
          PREFLIGHT_CHECKS.filter((x) => dry.preflights[x] !== 0),
          [c.check],
          `PRIV-3 2a: P4 (${c.check}) the dry run reports (${c.check}) alone`,
        );
      }, tx);
    }

    // (d) the other way: H's own entry on K's movement is erased with H, and is not refused.
    await rolledBack(async (sp) => {
      await plantEntry(sp, one(H, 'entries'), { movementId: one(K, 'movements') });
      await assert.doesNotReject(
        eraseHousehold(asTx(sp), h, { apply: true }),
        "PRIV-3 2a: P4 (d) H's own entry on another household's movement does not refuse",
      );
      assert.equal(
        await stillThere(sp, new Map([['movements', [one(K, 'movements')]]])),
        1,
        "PRIV-3 2a: P4 (d) K's movement survives H's erasure",
      );
    }, tx);
    console.log(
      `✓ PRIV-3 2a: P4 each of ${cases.length} pre-flight cases, planted alone ((a) and (h) both ways, (d) by entry and by prescription), refuses the erasure naming itself and changes nothing (the SET NULL pointers of (e), (f) and (g) included); (d) the other way erases`,
    );
  });
}

// ── P5: a hidden household is erased (committed; measured by raw id) ─────────────────────────────
async function verifyHiddenHouseholdErased(): Promise<void> {
  // Committed, not rolled back, so the core runs as production runs it: its own transaction on a
  // database handle. It creates its own household and erases it, so nothing is left behind.
  const householdId = await newHousehold(db, 'verify PRIV-3 2a P5 hidden');
  const P5_SCOPE = householdScopeForScript(householdId);
  let planted = new Map<string, number[]>();
  await db.transaction(async (tx) => {
    planted = (await populateEveryGraphTable(tx, P5_SCOPE, 'priv-3-2a-p5')).planted;
    await tx
      .update(schema.households)
      .set({ deletedAt: new Date() })
      .where(eq(schema.households.id, householdId));
  });
  const executor: Executor = asPg;
  await assert.doesNotReject(
    eraseHousehold(executor, asOwner(P5_SCOPE, 'PRIV-3 2a: P5'), { apply: true }),
    'PRIV-3 2a: P5 the core erases a hidden household',
  );
  const left = await db.transaction(async (tx) => stillThere(tx, planted));
  assert.equal(left, 0, 'PRIV-3 2a: P5 every row of the hidden household is gone, by raw id');
  console.log('✓ PRIV-3 2a: P5 a hidden household is erased like a live one, on a committed run');
}

// ── the guarded-write timeouts hold inside a transaction, and refuse to run outside one ───────────
async function verifyTimeoutsHold(): Promise<void> {
  // The last migration and the seed leave the session at lock 5s and statement 60s, the very values
  // setLocalTimeouts sets, and PGlite has one session. Without the reset below, a setLocalTimeouts
  // that set nothing would still read them back and pass.
  const session = async (ex: Pick<typeof db, 'execute'>) =>
    rowsOf<{ lock: string; statement: string; held: boolean }>(
      await ex.execute(sql`
        SELECT current_setting('lock_timeout') AS lock,
               current_setting('statement_timeout') AS statement,
               current_setting('lock_timeout')::interval = '5s'::interval
           AND current_setting('statement_timeout')::interval = '60s'::interval AS held`),
    )[0]!;
  const before = await session(db);
  await db.execute(
    sql`SELECT set_config('lock_timeout', '0', false), set_config('statement_timeout', '0', false)`,
  );
  try {
    await rolledBack(async (tx) => {
      // The guard for this proof itself: EACH setting starts from a value setLocalTimeouts does not set.
      const start = await session(tx);
      assert.deepEqual(
        [start.lock, start.statement],
        ['0', '0'],
        'PRIV-3 2a: the timeouts proof starts from reset settings',
      );
      await assert.doesNotReject(
        setLocalTimeouts(tx, '60s'), // displayed as '1min': the check compares intervals
        'PRIV-3 2a: setLocalTimeouts sets both timeouts inside a transaction',
      );
      assert.equal(
        (await session(tx)).held,
        true,
        'PRIV-3 2a: inside the transaction both timeouts read back as set',
      );
    });
    // The guard for the outside-transaction case: it, too, must start from reset settings.
    const after = await session(db);
    assert.deepEqual(
      [after.lock, after.statement],
      ['0', '0'],
      'PRIV-3 2a: the outside-transaction case starts from reset settings',
    );
    await assert.rejects(
      setLocalTimeouts(db, '60s'),
      /did not hold/,
      'PRIV-3 2a: setLocalTimeouts outside a transaction throws instead of silently setting nothing',
    );
  } finally {
    await db.execute(
      sql`SELECT set_config('lock_timeout', ${before.lock}, false), set_config('statement_timeout', ${before.statement}, false)`,
    );
  }
  console.log('✓ PRIV-3 2a: setLocalTimeouts holds inside a transaction and throws outside one');
}

// ── CAT-3 R0: the fresh start's one-shot erasure of the seeded household ─────────────────────────
//
// Inside `rolledBack`, so the seeded household is back for anything after this module. The target
// is a remote-looking URL whose database is `postgres`, which is PGlite's `current_database()`, so
// the in-transaction check passes; `…/mat_plan` is the name-mismatch case. This module carries its
// own `withEnv` and console sink (verify.ts's are not exported; plan D1's file list).

const ERASE_CONSOLE = ['log', 'info', 'warn', 'error'] as const;
async function withEnv<T>(
  vars: Readonly<Record<string, string | undefined>>,
  fn: () => Promise<T>,
  sink?: string[],
): Promise<T> {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  const consoleBefore = ERASE_CONSOLE.map((m) => console[m]);
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  if (sink) {
    for (const m of ERASE_CONSOLE) {
      console[m] = (...args: unknown[]) => {
        sink.push(args.map(String).join(' '));
      };
    }
  }
  try {
    return await fn();
  } finally {
    ERASE_CONSOLE.forEach((m, i) => {
      console[m] = consoleBefore[i]!;
    });
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const correctionNamed = (name: string) => {
  const c = CORRECTIONS.find((x) => x.name === name);
  assert.ok(c, `CAT-3 R0: the registry holds ${name}`);
  return c;
};

/** Every graph table's row count: "unchanged" means every one is equal. */
async function graphCounts(tx: VerifyTx): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const g of HOUSEHOLD_GRAPH) {
    const [row] = rowsOf<{ n: number }>(
      await tx.execute(sql`SELECT count(*)::int AS n FROM ${g.table}`),
    );
    out[graphTableName(g.table)] = row?.n ?? -1;
  }
  return out;
}

const REMOTE = 'postgres://u:p@ep-verify.invalid/postgres';
const NO_ERASE_ENV = { DATABASE_URL: undefined, [EXPECT_ERASED_ROWS]: undefined } as const;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function verifyOneShotErasure(): Promise<void> {
  const erase = correctionNamed(ERASE_SEEDED_HOUSEHOLD_NAME);
  await rolledBack(async (tx) => {
    // 🔴 Counts transaction opens, so the proof can tell the core ran INSIDE the entry's transaction
    // (a savepoint on its `tx`) from the core opening one of its own. Under PGlite both look alike: a
    // core handed the outer handle opens a savepoint that shadows the entry's, and the entry's
    // rollback still undoes it, so a total compare that guarded nothing would pass (DB-safety lens,
    // #708). In production that second transaction would be a second pooled connection that commits.
    const opens = { outer: 0, nested: 0 };
    const counted = <T extends object>(target: T, onOpen: () => void, wrapInner: boolean): T =>
      new Proxy(target, {
        get(t, key, receiver) {
          const value = Reflect.get(t, key, receiver) as unknown;
          if (key !== 'transaction' || typeof value !== 'function') return value;
          return (fn: (inner: unknown) => Promise<unknown>, ...rest: unknown[]) => {
            onOpen();
            return (value as (...a: unknown[]) => Promise<unknown>).call(
              t,
              (inner: object) =>
                fn(
                  wrapInner
                    ? counted(
                        inner,
                        () => {
                          opens.nested += 1;
                        },
                        false,
                      )
                    : inner,
                ),
              ...rest,
            );
          };
        },
      });
    const asDb = counted(
      tx,
      () => {
        opens.outer += 1;
      },
      true,
    ) as unknown as Database;
    const run = (env: Record<string, string | undefined>, apply: boolean, sink?: string[]) =>
      withEnv(
        { ...NO_ERASE_ENV, DATABASE_URL_UNPOOLED: REMOTE, ...env },
        () => erase.run(asDb, apply),
        sink,
      );

    // Refusals before connecting: the entry's gate is wired (erasure-gates.test.ts drives each branch).
    for (const [what, url, why] of [
      ['the preview', 'postgres://u:p@ep-verify.invalid/mat_plan_preview', /preview database/],
      ['a URL with no database name', 'postgres://u:p@ep-verify.invalid', /names no database/],
      ['an unset direct string', undefined, /not set/],
    ] as const) {
      await assert.rejects(
        run({ DATABASE_URL_UNPOOLED: url }, false),
        why,
        `CAT-3 R0: the one-shot erasure refuses ${what}`,
      );
    }
    await assert.rejects(
      run({ DATABASE_URL_UNPOOLED: undefined, DATABASE_URL: REMOTE }, false),
      /not set/,
      'CAT-3 R0: the erasure reads the direct string only, never a DATABASE_URL fallback',
    );

    // A member in the seeded household, so "no account id is printed" has an account to leak: the
    // core's report carries members' Clerk ids (for 2b), and this entry must print none of them.
    const [seedRow] = await tx
      .select({ id: schema.households.id })
      .from(schema.households)
      .where(eq(schema.households.publicId, SEED_HOUSEHOLD_PUBLIC_ID));
    assert.ok(seedRow, 'CAT-3 R0: the seeded household is in the verify database');
    const SEED_SCOPE = householdScopeForScript(seedRow.id);
    await insertHouseholdMember(asTx(tx), SEED_SCOPE, {
      publicId: newId(),
      clerkUserId: 'user_verifyR0seedmember',
      role: HOUSEHOLD_ROLE.owner,
    });

    // The other-households line must count, not only print: one hidden and one live non-seed
    // household are planted, and the line must read the baseline plus one each.
    const othersOf = (lines: readonly string[]) => {
      const m = /^households not in SEED_PUBLIC_IDS: live (\d+), hidden (\d+)$/.exec(
        lines.find((l) => l.startsWith('households not in SEED_PUBLIC_IDS')) ?? '',
      );
      return m ? { live: Number(m[1]), hidden: Number(m[2]) } : null;
    };
    const baseline = othersOf((await run({}, false)).map(lineText));
    assert.ok(baseline, 'CAT-3 R0: the dry run prints the other households, live and hidden');
    await newHousehold(tx, 'r0-other-live');
    const hiddenOther = await newHousehold(tx, 'r0-other-hidden');
    await tx
      .update(schema.households)
      .set({ deletedAt: sql`now()` })
      .where(eq(schema.households.id, hiddenOther));

    // 🔴 HIDE the seeded household and one of its athletes: the entry must find and erase a
    // soft-deleted household too (D1), which a live-only lookup would report as "not here".
    await tx
      .update(schema.households)
      .set({ deletedAt: sql`now()` })
      .where(eq(schema.households.publicId, SEED_HOUSEHOLD_PUBLIC_ID));
    const [seedProfile] = await tx
      .select({ id: schema.profiles.id })
      .from(schema.profiles)
      .where(eq(schema.profiles.householdId, seedRow.id))
      .limit(1);
    assert.ok(seedProfile, 'CAT-3 R0: the seeded household has an athlete to hide');
    await tx
      .update(schema.profiles)
      .set({ deletedAt: sql`now()` })
      .where(eq(schema.profiles.id, seedProfile.id));

    // A pre-flight refusal reaches the operator by its letter, and every table is unchanged: (h), an
    // assignment of a seeded athlete to another household's program. Nested, so it is undone here.
    await rolledBack(async (inner) => {
      const kId = await newHousehold(inner, 'r0-preflight-k');
      const K_SCOPE = householdScopeForScript(kId);
      const block = await mkTemplateBlock(asTx(inner), K_SCOPE, 'r0-preflight-k-block');
      await mkAssignment(inner, { blockId: block, profileId: seedProfile.id, idx: 999 });
      const innerDb = inner as unknown as Database;
      const dryLines = (
        await withEnv({ ...NO_ERASE_ENV, DATABASE_URL_UNPOOLED: REMOTE }, () =>
          erase.run(innerDb, false),
        )
      ).map(lineText);
      assert.ok(
        dryLines.some((l) => /^pre-flight \(h\) 1: --apply WILL refuse/.test(l)),
        'CAT-3 R0: the dry run says which pre-flight will refuse --apply',
      );
      const total = Number(
        /total: (\d+)/.exec(dryLines.find((l) => l.startsWith('total: ')) ?? '')?.[1],
      );
      const kept = await graphCounts(inner);
      await assert.rejects(
        withEnv(
          { ...NO_ERASE_ENV, DATABASE_URL_UNPOOLED: REMOTE, [EXPECT_ERASED_ROWS]: String(total) },
          () => erase.run(innerDb, true),
        ),
        /pre-flight \(h\) found 1 row/,
        'CAT-3 R0: a pre-flight refusal names its letter and count',
      );
      assert.deepEqual(await graphCounts(inner), kept, 'CAT-3 R0: …and nothing is erased');
    }, tx);

    // The dry run: counts only, the total to give back, and nothing written.
    const before = await graphCounts(tx);
    const dryOut: string[] = [];
    const dry = (await run({}, false, dryOut)).map(lineText);
    const totalLine = dry.find((l) => l.startsWith('total: '));
    assert.ok(totalLine, 'CAT-3 R0: the dry run prints the total');
    const total = Number(/total: (\d+)/.exec(totalLine)?.[1]);
    assert.ok(total > 0, 'CAT-3 R0: the dry run finds the seeded household and its rows');
    assert.deepEqual(
      othersOf(dry),
      { live: baseline.live + 1, hidden: baseline.hidden + 1 },
      'CAT-3 R0: the other-households line counts a planted live and a planted hidden household',
    );
    assert.deepEqual(await graphCounts(tx), before, 'CAT-3 R0: the dry run writes nothing');

    // --apply without this sitting's total, or with another one, refuses; every table unchanged.
    await assert.rejects(
      run({}, true),
      /needs EXPECT_ERASED_ROWS/,
      'CAT-3 R0: a bare --apply refuses',
    );
    await assert.rejects(
      run({ [EXPECT_ERASED_ROWS]: String(total + 1) }, true),
      /rolled back, nothing erased/,
      'CAT-3 R0: --apply with another total refuses',
    );
    assert.deepEqual(
      await graphCounts(tx),
      before,
      'CAT-3 R0: after a mismatched --apply every graph table is unchanged (the compare ran before any commit)',
    );

    // A connection that is not the database the URL names refuses inside the transaction.
    await assert.rejects(
      run(
        {
          DATABASE_URL_UNPOOLED: 'postgres://u:p@ep-verify.invalid/mat_plan',
          [EXPECT_ERASED_ROWS]: String(total),
        },
        true,
      ),
      /not the one the URL names/,
      "CAT-3 R0: --apply refuses when current_database() is not the URL's database",
    );

    // The erasure: the seeded household is gone, and no line names an account or a public_id.
    opens.outer = 0;
    opens.nested = 0;
    const appliedOut: string[] = [];
    const applied = (await run({ [EXPECT_ERASED_ROWS]: String(total) }, true, appliedOut)).map(
      lineText,
    );
    const [left] = rowsOf<{ n: number }>(
      await tx.execute(
        sql`SELECT count(*)::int AS n FROM households WHERE public_id = ${SEED_HOUSEHOLD_PUBLIC_ID}`,
      ),
    );
    assert.equal(left?.n, 0, 'CAT-3 R0: --apply erases the seeded household, hidden or live');
    assert.deepEqual(
      opens,
      { outer: 1, nested: 1 },
      "CAT-3 R0: the core runs inside the entry's transaction (one transaction, the core's savepoint on its tx)",
    );
    assert.ok(
      applied.some((l) => l.startsWith(`total: ${total} `)),
      "CAT-3 R0: --apply erases exactly the dry run's total",
    );
    for (const line of [...dry, ...dryOut, ...applied, ...appliedOut]) {
      assert.ok(
        !/user_/.test(line) && !UUID.test(line),
        `CAT-3 R0: no account id or public_id is printed: ${line.slice(0, 40)}`,
      );
    }

    // Once the target is gone: a dry run notes it; --apply refuses.
    const again = (await run({}, false)).map(lineText);
    assert.ok(
      again.some((l) => l.includes('the seeded household is not here')),
      'CAT-3 R0: a dry run after the erasure says there is nothing to erase',
    );
    await assert.rejects(
      run({ [EXPECT_ERASED_ROWS]: '0' }, true),
      /not here/,
      'CAT-3 R0: --apply after the erasure refuses',
    );
  });

  // RC's half of the no-path gap: create-household refuses a URL that names no database.
  await withEnv(
    {
      DATABASE_URL: undefined,
      DATABASE_URL_UNPOOLED: 'postgres://u:p@ep-verify.invalid',
      [CREATE_HOUSEHOLD_ACCOUNTS_ENV]: 'user_verifyr0nopath',
    },
    () =>
      assert.rejects(
        correctionNamed(CREATE_HOUSEHOLD_NAME).run(db as unknown as Database, false),
        /names no database/,
        'CAT-3 R0: create-household refuses a target URL that names no database',
      ),
  );
  console.log(
    '✓ CAT-3 R0: the one-shot erasure runs against production only, once, tied to its dry run, and prints counts only',
  );
}

// ── CAT-3 R1: the fresh start's step 5, and R4's counts ─────────────────────────────────────────
//
// Inside `rolledBack`, so every movement is back for anything after this module. The verify
// database's seeded entries and prescriptions point at legacy rows, so the success path first
// repoints them at a planted catalog row: what is left is exactly the shape step 5 meets after step 3.

const NO_LEGACY_ENV = Object.fromEntries(
  Object.values(LEGACY_COUNT_ENV).map((k) => [k, undefined]),
) as Record<string, undefined>;

/** The legacy rows by a hand predicate, independent of the entry's: global, and no modality or a seed id. */
async function legacyByHand(tx: VerifyTx) {
  const seedIds = [...MOVEMENT_SEED_PUBLIC_IDS];
  const [row] = rowsOf<{ movements: number; equipment: number; muscles: number }>(
    await tx.execute(sql`
      WITH l AS (
        SELECT id FROM movements
         WHERE household_id IS NULL
           AND (modality IS NULL OR public_id::text IN (${sql.join(
             seedIds.map((id) => sql`${id}`),
             sql`, `,
           )})))
      SELECT (SELECT count(*)::int FROM l) AS movements,
             (SELECT count(*)::int FROM movement_equipment WHERE movement_id IN (SELECT id FROM l)) AS equipment,
             (SELECT count(*)::int FROM movement_muscles WHERE movement_id IN (SELECT id FROM l)) AS muscles`),
  );
  return row!;
}

/** The three counts a dry run printed, by its own words. */
function printedCounts(lines: readonly string[]) {
  const n = (what: string) =>
    Number(
      new RegExp(`^would delete (\\d+) ${what}`).exec(
        lines.find((l) => l.includes(` ${what}`)) ?? '',
      )?.[1],
    );
  return {
    movements: n('legacy movements row'),
    equipment: n('movement_equipment row'),
    muscles: n('movement_muscles row'),
  };
}

async function verifyLegacyMovementDeletion(): Promise<void> {
  // (1) The reader against this module's hand list: a new FK into movements turns both red together.
  const fks = await foreignKeysIntoMovements(db);
  assert.deepEqual(
    sorted(fks.map(movementFkTable)),
    sorted([...CENSUS_REFERENCE_TABLES, ...MOVEMENT_JOIN_TABLES]),
    "CAT-3 R1: the FKs into movements (pg_constraint) are exactly the census's tables plus the two join tables",
  );
  assert.ok(
    fks.every(
      (f) => f.columns.length === 1 && f.referencedColumns.join() === 'id' && f.deleteRule === 'a',
    ),
    'CAT-3 R1: every FK into movements today is one NO ACTION column onto movements.id',
  );
  // The census's hand list is the tables its joins read, not a third copy beside them.
  const census = readFileSync(
    new URL('../../src/queries/movement-ownership.ts', import.meta.url),
    'utf8',
  );
  const joins = census.slice(
    census.indexOf('const entryMovementRefs = '),
    census.indexOf('/**', census.indexOf('const prescriptionMovementRefs = ')),
  );
  assert.deepEqual(
    sorted([...joins.matchAll(/select count\(\*\)::int from (\w+) \w+\s/g)].map((m) => m[1]!)),
    sorted(CENSUS_REFERENCE_TABLES),
    "CAT-3 R1: CENSUS_REFERENCE_TABLES is exactly the tables the census's two joins read",
  );
  // Step 5 deletes join rows; a key INTO a join table would be a third level it does not read.
  const intoJoins = rowsOf<{ n: number }>(
    await db.execute(sql`
      SELECT count(*)::int AS n FROM pg_constraint
       WHERE contype = 'f'
         AND confrelid IN ('public.movement_equipment'::regclass, 'public.movement_muscles'::regclass)`),
  )[0]!.n;
  assert.equal(
    intoJoins,
    0,
    'CAT-3 R1: no foreign key points into movement_equipment or movement_muscles',
  );

  // (2) The lock and the locked-ids delete, from the source: PGlite has one connection, so no proof
  // can show a row committed after the lock (2a's lock mode is pinned the same way).
  const src = readFileSync(new URL('../corrections/registry.ts', import.meta.url), 'utf8');
  const start = src.indexOf('const deleteLegacyMovements: Correction = {');
  const entry = src.slice(start, src.indexOf('export const CORRECTIONS', start));
  const at = (needle: string) => entry.indexOf(needle);
  assert.ok(
    start >= 0 && at("for('update')") > 0,
    'CAT-3 R1: step 5 locks the legacy rows FOR UPDATE',
  );
  assert.ok(
    at('setLocalTimeouts(tx') >= 0 && at('setLocalTimeouts(tx') < at("for('update')"),
    'CAT-3 R1: step 5 sets its timeouts before it locks',
  );
  assert.ok(
    at("for('update')") < at('movementReferenceCounts(tx') &&
      at("for('update')") < at('foreignKeysIntoMovements(tx') &&
      at("for('update')") < at('legacyCounts(tx'),
    'CAT-3 R1: step 5 re-reads the keys, the references and the counts under the lock',
  );
  for (const target of [
    'schema.movementEquipment.movementId',
    'schema.movementMuscles.movementId',
    'schema.movements.id',
  ]) {
    assert.ok(
      entry.includes(`.where(inArray(${target}, locked))`),
      `CAT-3 R1: step 5 deletes by the locked ids only (${target})`,
    );
  }
  assert.equal(
    (entry.match(/\.delete\(/g) ?? []).length,
    3,
    'CAT-3 R1: step 5 runs exactly three deletes, each by the locked ids',
  );

  const step5 = correctionNamed(DELETE_LEGACY_MOVEMENTS_NAME);
  await rolledBack(async (tx) => {
    const asDb = tx as unknown as Database;
    const run = (env: Record<string, string | undefined>, apply: boolean, sink?: string[]) =>
      withEnv(
        { ...NO_LEGACY_ENV, DATABASE_URL: undefined, DATABASE_URL_UNPOOLED: REMOTE, ...env },
        () => step5.run(asDb, apply),
        sink,
      );
    const expectEnv = (c: { movements: number; equipment: number; muscles: number }) => ({
      [LEGACY_COUNT_ENV.movements]: String(c.movements),
      [LEGACY_COUNT_ENV.equipment]: String(c.equipment),
      [LEGACY_COUNT_ENV.muscles]: String(c.muscles),
    });
    const movementCount = async () =>
      rowsOf<{ n: number }>(await tx.execute(sql`SELECT count(*)::int AS n FROM movements`))[0]!.n;

    // The plant: a catalog row with join rows (must survive); a legacy row with NO modality and join
    // rows (D2-N1, defensive: `IS NOT TRUE` keeps it selected under a predicate that could be NULL); a seed row hand-UPDATEd to
    // carry a modality (D3's count 2, must go); a household's own row (must survive).
    const plantJoins = async (movementId: number) => {
      await tx
        .insert(schema.movementEquipment)
        .values({ movementId, equipmentCode: EQUIPMENT.at(-1)! });
      await tx
        .insert(schema.movementMuscles)
        .values({ movementId, muscleCode: MUSCLES.at(-1)!, role: MUSCLE_ROLE.primary });
    };
    const [catalog] = await tx
      .insert(schema.movements)
      .values({
        publicId: newId(),
        slug: 'cat3_r1_catalog',
        name: 'cat3_r1_catalog',
        modality: MODALITY.skill,
      })
      .returning({ id: schema.movements.id });
    await plantJoins(catalog!.id);
    const [legacy] = await tx
      .insert(schema.movements)
      .values({
        publicId: newId(),
        slug: 'cat3_r1_legacy',
        name: 'cat3_r1_legacy',
        pattern: MOVEMENT_PATTERNS[0],
      })
      .returning({ id: schema.movements.id });
    await plantJoins(legacy!.id);
    const [handUpdated] = rowsOf<{ id: number }>(
      await tx.execute(sql`
        UPDATE movements SET modality = ${MODALITY.skill}
         WHERE id = (SELECT id FROM movements WHERE household_id IS NULL AND public_id::text IN (${sql.join(
           [...MOVEMENT_SEED_PUBLIC_IDS].map((id) => sql`${id}`),
           sql`, `,
         )}) ORDER BY id LIMIT 1)
        RETURNING id`),
    );
    assert.ok(handUpdated, 'CAT-3 R1: the verify database holds a legacy seed movement');
    const owner = await newHousehold(tx, 'r1-owner');
    const [owned] = await tx
      .insert(schema.movements)
      .values({
        publicId: newId(),
        slug: 'cat3_r1_owned',
        name: 'cat3_r1_owned',
        householdId: owner,
      })
      .returning({ id: schema.movements.id });

    // Repoint the seed's references from every legacy row to the catalog row.
    const legacyIds = sql`(SELECT id FROM movements WHERE household_id IS NULL AND (modality IS NULL OR id = ${handUpdated.id}))`;
    await tx.execute(
      sql`UPDATE entries SET movement_id = ${catalog!.id} WHERE movement_id IN ${legacyIds}`,
    );
    await tx.execute(
      sql`UPDATE prescriptions SET movement_id = ${catalog!.id} WHERE movement_id IN ${legacyIds}`,
    );

    const byHand = await legacyByHand(tx);
    assert.ok(
      byHand.movements >= 2 && byHand.equipment >= 1,
      'CAT-3 R1: the plant holds legacy rows',
    );

    // The dry run: every count, no refusal, nothing written, counts only.
    const before = await movementCount();
    const dryOut: string[] = [];
    const dry = (await run({}, false, dryOut)).map(lineText);
    assert.deepEqual(
      printedCounts(dry),
      byHand,
      'CAT-3 R1: the dry run finds exactly the legacy rows and their join rows (the NULL-modality row and the hand-updated seed row included)',
    );
    assert.ok(
      dry.some((l) => /^references from entries\.movement_id, hidden rows included: 0$/.test(l)) &&
        dry.some((l) =>
          /^references from prescriptions\.movement_id, hidden rows included: 0$/.test(l),
        ),
      'CAT-3 R1: the dry run prints each reference count',
    );
    assert.ok(
      !dry.some((l) => l.startsWith('would refuse')),
      'CAT-3 R1: the dry run sees no refusal',
    );
    assert.equal(await movementCount(), before, 'CAT-3 R1: the dry run deletes nothing');

    // Each refusal, in a savepoint, under --apply with the dry run's counts; nothing deleted after it.
    const refusesApply = async (
      what: string,
      plant: (sp: VerifyTx) => Promise<void>,
      why: RegExp,
    ) => {
      await rolledBack(async (sp) => {
        await plant(sp);
        const spDb = sp as unknown as Database;
        const dryHere = (await withEnv(NO_LEGACY_ENV, () => step5.run(spDb, false))).map(lineText);
        assert.ok(
          dryHere.some((l) => l.startsWith('would refuse --apply: ') && why.test(l)),
          `CAT-3 R1: the dry run says --apply would refuse ${what}`,
        );
        assert.ok(
          dryHere.some((l) => l.startsWith('--apply would refuse (see the note above)')) &&
            !dryHere.some((l) => l.includes('EXPECT_LEGACY_')),
          `CAT-3 R1: a dry run that would refuse offers no counts to apply with (${what})`,
        );
        await assert.rejects(
          withEnv({ ...NO_LEGACY_ENV, DATABASE_URL_UNPOOLED: REMOTE, ...expectEnv(byHand) }, () =>
            step5.run(spDb, true),
          ),
          why,
          `CAT-3 R1: --apply refuses ${what}`,
        );
        const [{ n }] = rowsOf<{ n: number }>(
          await sp.execute(sql`SELECT count(*)::int AS n FROM movements`),
        );
        assert.equal(n, before, `CAT-3 R1: …and deletes nothing (${what})`);
      }, tx);
    };
    await refusesApply(
      'a reference from a table the census does not list, naming it',
      async (sp) => {
        await sp.execute(
          sql`CREATE TABLE cat3_r1_scratch (id int PRIMARY KEY, mv bigint REFERENCES movements (id))`,
        );
        await sp.execute(sql`INSERT INTO cat3_r1_scratch VALUES (1, ${legacy!.id})`);
      },
      /cat3_r1_scratch\.mv: 1 row\(s\) still reference/,
    );
    await refusesApply(
      'a hidden entry on a legacy row',
      async (sp) => {
        const [hidden] = rowsOf<{ id: number }>(
          await sp.execute(sql`
            UPDATE entries SET movement_id = ${legacy!.id}, deleted_at = now()
             WHERE id = (SELECT id FROM entries WHERE movement_id IS NOT NULL ORDER BY id LIMIT 1)
            RETURNING id`),
        );
        assert.ok(hidden, 'CAT-3 R1: the verify database holds a strength entry to hide');
      },
      /entries\.movement_id: 1 row\(s\) still reference/,
    );
    await refusesApply(
      'a multi-column FK into movements, never skipping it',
      async (sp) => {
        await sp.execute(sql`ALTER TABLE movements ADD CONSTRAINT cat3_r1_pair UNIQUE (id, slug)`);
        await sp.execute(
          sql`CREATE TABLE cat3_r1_pairs (mv bigint, slug text, FOREIGN KEY (mv, slug) REFERENCES movements (id, slug))`,
        );
      },
      /from cat3_r1_pairs into movements is not one column onto movements\.id/,
    );
    await refusesApply(
      'an FK into movements that does not abort a delete',
      async (sp) => {
        await sp.execute(
          sql`CREATE TABLE cat3_r1_setnull (mv bigint REFERENCES movements (id) ON DELETE SET NULL)`,
        );
      },
      /from cat3_r1_setnull into movements does not abort a delete/,
    );

    // A deleted count short of the locked count rolls back: a trigger that skips the planted legacy
    // row's delete (on movements only; on a join table the movement's delete would abort 23503 first).
    await rolledBack(async (sp) => {
      await sp.execute(sql`
        CREATE FUNCTION cat3_r1_skip() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF OLD.slug = 'cat3_r1_legacy' THEN RETURN NULL; END IF;
          RETURN OLD;
        END $$`);
      await sp.execute(
        sql`CREATE TRIGGER cat3_r1_skip BEFORE DELETE ON movements FOR EACH ROW EXECUTE FUNCTION cat3_r1_skip()`,
      );
      const spDb = sp as unknown as Database;
      await assert.rejects(
        withEnv({ ...NO_LEGACY_ENV, DATABASE_URL_UNPOOLED: REMOTE, ...expectEnv(byHand) }, () =>
          step5.run(spDb, true),
        ),
        /not the locked count: rolled back/,
        'CAT-3 R1: --apply refuses when the delete removes fewer movements than it locked',
      );
      const [{ n }] = rowsOf<{ n: number }>(
        await sp.execute(sql`SELECT count(*)::int AS n FROM movements`),
      );
      assert.equal(n, before, 'CAT-3 R1: …and deletes nothing (the short delete)');
    }, tx);

    // --apply reads the direct string only: unset, with a DATABASE_URL beside it, refuses.
    await assert.rejects(
      run({ ...expectEnv(byHand), DATABASE_URL_UNPOOLED: undefined, DATABASE_URL: REMOTE }, true),
      /DATABASE_URL_UNPOOLED is not set/,
      'CAT-3 R1: --apply refuses without DATABASE_URL_UNPOOLED, never falling back to DATABASE_URL',
    );
    await assert.rejects(
      run({ ...expectEnv(byHand), [LEGACY_COUNT_ENV.equipment]: '1.5' }, true),
      /EXPECT_LEGACY_EQUIPMENT is not a whole number/,
      'CAT-3 R1: --apply refuses a malformed count',
    );

    // --apply without the counts, or with another one, refuses; nothing deleted.
    await assert.rejects(
      run({}, true),
      /--apply needs EXPECT_LEGACY_MOVEMENTS/,
      'CAT-3 R1: a bare --apply refuses',
    );
    await assert.rejects(
      run(expectEnv({ ...byHand, movements: byHand.movements + 1 }), true),
      /EXPECT_LEGACY_MOVEMENTS is \d+: rolled back, nothing deleted/,
      'CAT-3 R1: --apply with another movements count refuses',
    );
    await assert.rejects(
      run(expectEnv({ ...byHand, muscles: byHand.muscles + 1 }), true),
      /EXPECT_LEGACY_MUSCLES is \d+: rolled back, nothing deleted/,
      'CAT-3 R1: --apply with another muscles count refuses',
    );
    assert.equal(
      await movementCount(),
      before,
      'CAT-3 R1: after a refused --apply nothing is deleted',
    );

    // The deletion.
    const appliedOut: string[] = [];
    const applied = (await run(expectEnv(byHand), true, appliedOut)).map(lineText);
    assert.deepEqual(
      await legacyByHand(tx),
      { movements: 0, equipment: 0, muscles: 0 },
      'CAT-3 R1: --apply deletes every legacy row and its join rows',
    );
    assert.equal(
      await movementCount(),
      before - byHand.movements,
      "CAT-3 R1: --apply deletes exactly the dry run's movements",
    );
    const survivors = rowsOf<{ id: number; eq: number; mu: number }>(
      await tx.execute(sql`
        SELECT m.id::int AS id,
               (SELECT count(*)::int FROM movement_equipment e WHERE e.movement_id = m.id) AS eq,
               (SELECT count(*)::int FROM movement_muscles u WHERE u.movement_id = m.id) AS mu
          FROM movements m WHERE m.id IN (${catalog!.id}, ${owned!.id}) ORDER BY m.id`),
    );
    assert.deepEqual(
      survivors.map((r) => [r.id, r.eq, r.mu]),
      [
        [catalog!.id, 1, 1],
        [owned!.id, 0, 0],
      ],
      "CAT-3 R1: a catalog row and its join rows, and a household's own row, survive",
    );
    for (const line of [...dry, ...dryOut, ...applied, ...appliedOut]) {
      assert.ok(
        !UUID.test(line) && !/cat3_r1_/.test(line),
        `CAT-3 R1: no public_id or slug is printed: ${line.slice(0, 40)}`,
      );
    }

    // A second run deletes nothing: the dry run and --apply (with no counts) both say so.
    const again = (await run({}, false)).map(lineText);
    assert.ok(
      again.some((l) => l.includes('nothing to do')),
      'CAT-3 R1: a dry run after the deletion says there is nothing to do',
    );
    const againApplied = (await run({}, true)).map(lineText);
    assert.ok(
      againApplied.some((l) => l.includes('nothing to do')),
      'CAT-3 R1: a second --apply deletes nothing and needs no counts',
    );
  });
  console.log(
    '✓ CAT-3 R1: step 5 deletes the legacy movements only, refuses any reference the catalog shows, ties --apply to its dry run, and prints counts only',
  );
}

/** One R4 line's numbers, by its label. */
async function r4Counts(tx: VerifyTx, n: 1 | 2 | 3 | 4): Promise<number[]> {
  const report = correctionNamed(MOVEMENTS_OWNERSHIP_REPORT_NAME);
  const lines = (await report.run(tx as unknown as Database, false)).map(lineText);
  const line = lines.find((l) => l.startsWith(`R4 (${n}) `)) ?? '';
  assert.ok(line, `CAT-3 R1: the report prints R4 (${n})`);
  return [...line.slice(line.lastIndexOf(':')).matchAll(/\d+/g)].map((m) => Number(m[0]));
}

async function verifyFreshStartCounts(): Promise<void> {
  await rolledBack(async (tx) => {
    // (1) hidden rows included: hiding a seeded household changes nothing; re-keying a seeded athlete
    // takes one off.
    const [h1, p1] = await r4Counts(tx, 1);
    assert.equal(h1, 1, 'CAT-3 R1: R4 (1) counts the one seeded household here');
    await tx
      .update(schema.households)
      .set({ deletedAt: sql`now()` })
      .where(eq(schema.households.publicId, SEED_HOUSEHOLD_PUBLIC_ID));
    const seedProfiles = rowsOf<{ id: number }>(
      await tx.execute(sql`
        SELECT id FROM profiles WHERE public_id::text IN (${sql.join(
          [...SEED_PUBLIC_IDS].map((id) => sql`${id}`),
          sql`, `,
        )}) ORDER BY id LIMIT 2`),
    );
    assert.equal(seedProfiles.length, 2, 'CAT-3 R1: the verify database holds two seeded profiles');
    await tx
      .update(schema.profiles)
      .set({ deletedAt: sql`now()` })
      .where(eq(schema.profiles.id, seedProfiles[0]!.id));
    assert.deepEqual(
      await r4Counts(tx, 1),
      [h1, p1!],
      'CAT-3 R1: R4 (1) counts a hidden seed household and a hidden seed profile',
    );
    await tx
      .update(schema.profiles)
      .set({ publicId: newId() })
      .where(eq(schema.profiles.id, seedProfiles[1]!.id));
    assert.deepEqual(
      await r4Counts(tx, 1),
      [h1, p1! - 1],
      'CAT-3 R1: R4 (1) counts seed-namespace profiles by public_id',
    );

    // (2) every row, a modality or not; (3) global rows that are not catalog rows.
    const [m2] = await r4Counts(tx, 2);
    const [m3] = await r4Counts(tx, 3);
    await tx.execute(sql`
      UPDATE movements SET modality = ${MODALITY.skill}
       WHERE id = (SELECT id FROM movements WHERE household_id IS NULL AND modality IS NULL
                     AND public_id::text IN (${sql.join(
                       [...MOVEMENT_SEED_PUBLIC_IDS].map((id) => sql`${id}`),
                       sql`, `,
                     )}) ORDER BY id LIMIT 1)`);
    assert.deepEqual(
      [...(await r4Counts(tx, 2)), ...(await r4Counts(tx, 3))],
      [m2!, m3! - 1],
      'CAT-3 R1: R4 (2) still counts a seed row given a modality; R4 (3) no longer does',
    );

    // (4) read from the table: a catalog row on a missing slug takes one off; a household's row on one
    // does not.
    const [m4] = await r4Counts(tx, 4);
    const held = new Set(
      rowsOf<{ slug: string }>(await tx.execute(sql`SELECT slug FROM movements`)).map(
        (r) => r.slug,
      ),
    );
    const [free, other, plain, hiddenSlug] = [...CATALOG_SLUGS].filter((slug) => !held.has(slug));
    assert.ok(
      free && other && plain && hiddenSlug,
      'CAT-3 R1: four catalog slugs have no row here',
    );
    await tx.insert(schema.movements).values({
      publicId: newId(),
      slug: plain,
      name: plain,
      pattern: MOVEMENT_PATTERNS[0],
    });
    assert.deepEqual(
      await r4Counts(tx, 4),
      [m4!],
      'CAT-3 R1: R4 (4) does not count a global row with no modality as a catalog row',
    );
    await tx.insert(schema.movements).values({
      publicId: newId(),
      slug: hiddenSlug,
      name: hiddenSlug,
      modality: MODALITY.skill,
      deletedAt: sql`now()`,
    });
    assert.deepEqual(
      await r4Counts(tx, 4),
      [m4!],
      'CAT-3 R1: R4 (4) does not count a hidden catalog row as present',
    );
    const owner = await newHousehold(tx, 'r1-r4-owner');
    await tx
      .insert(schema.movements)
      .values({ publicId: newId(), slug: other, name: other, householdId: owner });
    assert.deepEqual(
      await r4Counts(tx, 4),
      [m4!],
      "CAT-3 R1: R4 (4) does not count a household's row as a catalog row",
    );
    await tx
      .insert(schema.movements)
      .values({ publicId: newId(), slug: free, name: free, modality: MODALITY.skill });
    assert.deepEqual(
      await r4Counts(tx, 4),
      [m4! - 1],
      'CAT-3 R1: R4 (4) counts catalog slugs with no live global catalog row, read from the table',
    );
  });
  console.log(
    '✓ CAT-3 R1: the report prints the fresh start’s four counts, each read from the table',
  );
}
