import assert from 'node:assert/strict';

import {
  GATE_COLORS,
  HOUSEHOLD_ROLE,
  newId,
  QUANTITY_SLOT,
  SESSION_TYPES,
  UNIT_DIMENSION,
} from '@mat-plan/shared';
import { eq, sql, type SQL } from 'drizzle-orm';

import { schema } from '../../src/client';
import {
  ATHLETE_GRAPH,
  ATHLETE_GRAPH_TABLES,
  graphTableName,
  HOUSEHOLD_GRAPH,
  isAthleteGrain,
  NON_ABORTING_EDGES,
  REFERENCE_TABLES,
} from '../../src/erasure/graph';
import type { HouseholdScope } from '../../src/scope';
import {
  householdMemberInHousehold,
  householdRowIs,
  insertHouseholdMember,
  insertMovementOwnedBy,
  insertWorkoutOwnedBy,
} from '../../src/writers/ownership';
import { asTx, db, idsOf, rolledBack, rowsOf, type VerifyContext, type VerifyTx } from './harness';
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
 * The database is not pristine (`./harness` → `VerifyContext`), so nothing here asserts over a whole
 * table: only over what A's and B's predicates match and the ids this module planted, all rolled back.
 */
export async function verifyErasure(ctx: VerifyContext): Promise<void> {
  await verifyPartition();
  await verifyCatalog();
  await verifyHouseholdPartition(ctx);
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
    const withDeletedAt = rowsOf<{ t: string }>(
      await tx.execute(sql`
        SELECT table_name AS t FROM information_schema.columns
         WHERE table_schema = 'public' AND column_name = 'deleted_at'`),
    ).map((r) => r.t);
    const hidden: string[] = [];
    for (const g of HOUSEHOLD_GRAPH) {
      const name = graphTableName(g.table);
      if (!withDeletedAt.includes(name)) continue;
      const ids = sql.join(
        planted.get(name)!.map((id) => sql`${id}`),
        sql`, `,
      );
      await tx.execute(
        sql`UPDATE ${g.table} SET ${sql.identifier('deleted_at')} = now() WHERE ${g.table.id} IN (${ids})`,
      );
      hidden.push(name);
    }
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
