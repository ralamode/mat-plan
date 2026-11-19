import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  EQUIPMENT,
  GATE_COLORS,
  HOUSEHOLD_ROLE,
  MUSCLE_ROLE,
  MUSCLES,
  newId,
  QUANTITY_SLOT,
  SESSION_TYPES,
  UNIT_DIMENSION,
} from '@mat-plan/shared';
import { eq, sql, type SQL } from 'drizzle-orm';

import { schema } from '../../src/client';
import {
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
import { ownerScope, type HouseholdScope, type OwnerScope } from '../../src/scope';
import type { Executor } from '../../src/writers/executor';
import { householdScopeForScript } from '../../src/writers/household-scope-script';
import {
  householdMemberInHousehold,
  householdRowIs,
  insertHouseholdMember,
  insertMovementOwnedBy,
  insertWorkoutOwnedBy,
} from '../../src/writers/ownership';
import {
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
  await verifyPreflightsRefuse();
  await verifyHiddenHouseholdErased();
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

/** Thrown by a proof to roll back a savepoint it opened; never by the code under test. */
class CallerRollback extends Error {}

/** Run `fn` in a savepoint of `tx` that is always rolled back. */
async function inSavepoint(tx: VerifyTx, fn: (sp: VerifyTx) => Promise<void>): Promise<void> {
  try {
    await tx.transaction(async (sp) => {
      await fn(sp);
      throw new CallerRollback();
    });
  } catch (e) {
    if (!(e instanceof CallerRollback)) throw e;
  }
}

async function newHousehold(tx: VerifyTx | typeof db, name: string): Promise<number> {
  const [row] = await tx
    .insert(schema.households)
    .values({ publicId: newId(), name })
    .returning({ id: schema.households.id });
  return row.id;
}

function asOwner(scope: HouseholdScope, what: string): OwnerScope {
  const owner = ownerScope(scope);
  assert.ok(owner, `PRIV-3 2a: ${what}'s scope is an owner scope`);
  return owner;
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
  // guide invariant 12); the core takes the same two first, then every other parent, parent first.
  const parentNames = PARENT_TABLES.map(graphTableName);
  const expected = [
    'program_blocks',
    'profiles',
    ...[...parentNames].reverse().filter((t) => t !== 'program_blocks' && t !== 'profiles'),
  ];
  assert.deepEqual(
    LOCK_ORDER.map(graphTableName),
    expected,
    "PRIV-3 2a: the core locks program_blocks, then profiles, then the other parents parent first (the program writers' order)",
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
    `✓ PRIV-3 2a: the core locks the ${PARENT_TABLES.length} parent tables FOR UPDATE, program_blocks then profiles first, before its pre-flights`,
  );
}

// ── P3: the core erases H and nothing else ──────────────────────────────────────────────────────
async function verifyCoreErases(): Promise<void> {
  await rolledBack(async (tx) => {
    const H_SCOPE = householdScopeForScript(await newHousehold(tx, 'verify PRIV-3 2a H'));
    const K_SCOPE = householdScopeForScript(await newHousehold(tx, 'verify PRIV-3 2a K'));
    const h = asOwner(H_SCOPE, 'H');
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
      'PRIV-3 2a: P3 the report marks exactly the sign-in that is live in another household',
    );
    assert.equal(
      dry.members.length,
      hBefore.household_members.length,
      'PRIV-3 2a: P3 the report lists every membership of H, hidden ones too',
    );

    // Inside a caller's transaction (CAT-3 R0's shape): the core completes, the caller throws, and
    // the whole erasure is rolled back with the caller's transaction.
    let inner: Awaited<ReturnType<typeof eraseHousehold>> | undefined;
    let thrown: unknown;
    try {
      await tx.transaction(async (callerTx) => {
        inner = await eraseHousehold(asTx(callerTx), h, { apply: true });
        throw new CallerRollback();
      });
    } catch (e) {
      thrown = e;
    }
    assert.ok(
      thrown instanceof CallerRollback,
      `PRIV-3 2a: P3 the core erases household H, hidden rows included (threw: ${String((thrown as Error)?.message).slice(0, 120)})`,
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

// ── P4: each pre-flight refuses, naming itself, and changes nothing ─────────────────────────────
async function verifyPreflightsRefuse(): Promise<void> {
  await rolledBack(async (tx) => {
    const H_SCOPE = householdScopeForScript(await newHousehold(tx, 'verify PRIV-3 2a P4 H'));
    const K_SCOPE = householdScopeForScript(await newHousehold(tx, 'verify PRIV-3 2a P4 K'));
    const h = asOwner(H_SCOPE, 'H');
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
    ];

    for (const c of cases) {
      await inSavepoint(tx, async (sp) => {
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
      });
    }

    // (d) the other way: H's own entry on K's movement is erased with H, and is not refused.
    await inSavepoint(tx, async (sp) => {
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
    });
    console.log(
      `✓ PRIV-3 2a: P4 each of the ${cases.length} pre-flights, planted alone, refuses the erasure naming itself and changes nothing (the SET NULL pointers of (e), (f) and (g) included); (d) the other way erases`,
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
    eraseHousehold(executor, asOwner(P5_SCOPE, 'P5'), { apply: true }),
    'PRIV-3 2a: P5 the core erases a hidden household',
  );
  const left = await db.transaction(async (tx) => stillThere(tx, planted));
  assert.equal(left, 0, 'PRIV-3 2a: P5 every row of the hidden household is gone, by raw id');
  console.log('✓ PRIV-3 2a: P5 a hidden household is erased like a live one, on a committed run');
}
