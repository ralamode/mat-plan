import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DEFAULT_TRACKING_TYPE,
  GATE_COLORS,
  localWeekday,
  MAX_SETS_PER_MOVEMENT,
  MAX_STORABLE_QUANTITY,
  MAX_WORKOUT_ITEMS,
  FREE_TEXT_NOTE_MAX,
  MOVEMENT_SEED_ROWS,
  newId,
  PROFILE_KIND,
  PROGRAM_BLOCK_KIND,
  PROGRAM_BLOCK_KINDS,
  PROGRAM_NAME_MAX,
  PROGRAM_READ_KIND,
  SLOT_LABEL_MAX,
  TARGET_REPS_MAX,
  TRACKING_TYPE_FIELDS,
  UNIT_DIMENSION_BY_CODE,
  unitsForTrackingType,
  WEEKDAYS,
  WORKOUT_NAME_MAX,
  PROGRAM_SEED,
  SEED_HOUSEHOLD_PUBLIC_ID,
  QUANTITY_SLOT,
  SESSION_TYPE,
  SESSION_TYPES,
  TRACKING_TYPE,
  TRACKING_TYPES,
  UNIT_DIMENSION,
} from '@mat-plan/shared';
import { and, eq, inArray, notExists, sql } from 'drizzle-orm';

import { schema } from '../../src/client';
import {
  assignmentCurrentAsOf,
  assignmentDueOn,
  assignmentOnDay,
} from '../../src/queries/program-assignments';
import { householdHasProgram, programDayRows } from '../../src/queries/program-day';
import { householdScopeForScript } from '../../src/writers/household-scope-script';
import { prescribedSnapshotsFor } from '../../src/writers/prescribed-snapshot';
import {
  ASSIGNMENT_OPEN_UNIQUE_INDEX,
  ASSIGNMENT_ORDER_UNIQUE_INDEX,
  ASSIGNMENT_START_UNIQUE_INDEX,
  ENTRY_PRESCRIPTION_SET_UNIQUE_INDEX,
  PRESCRIPTION_QUANTITY_SLOT_UNIQUE_INDEX,
  PRESCRIPTION_WORKOUT_CLIENT_ID_UNIQUE_INDEX,
  PRESCRIPTION_WORKOUT_SLOT_UNIQUE_INDEX,
  SESSION_WORKOUT_DAY_UNIQUE_INDEX,
  SUPERSET_PRESCRIPTION_GROUP_UNIQUE_INDEX,
} from '../../src/schema';
import { seed } from '../../src/seed';
import { findOrCreateTypedMovement } from '../../src/writers/movement-catalog';
import {
  insertMovementOwnedBy,
  insertProgramBlockOwnedBy,
  insertWorkoutOwnedBy,
  movementInHousehold,
  movementIsGlobal,
  programBlockByClientId,
  programBlockInHousehold,
} from '../../src/writers/ownership';
import {
  asDb,
  asTx,
  assertCheckCoversConst,
  columnCatalogShape,
  constraintDef,
  db,
  expectRejectedBy,
  idsOf,
  rolledBack,
  rowsOf,
  type VerifyContext,
  type VerifyTx,
} from './harness';

/**
 * `db:verify` proofs for the FAM-1 SCHEMA chain.
 *
 * **Owner: lane A** (`docs/plans/fam-1-family-program.md` §5 → "Lane A · the schema chain"). Only
 * lane A edits this file. Its steps add the proofs here, each in the PR that creates the object it
 * proves (§3 → "Proofs (`db:verify`), in the step that creates each object"):
 *
 * - step 3 ✅: the §3 migration's CHECKs against their shared consts, every built-in item typed (by
 *   the migration's own statement, and a second run changes nothing), `(primary, count)` storable,
 *   the typed resolver never retypes. `DAY_ROLES` unchanged is already pinned twice in `verify.ts`
 *   (`sessions_day_role_check`, `prescriptions_day_role_check`), against the const that now spreads
 *   `LEGACY_SESSION_TYPES`;
 * - step 4a-i ✅: blocks, slots, identity, the "flagged" audits and the program tables' erasure order
 *   (ADR 0007 Amendment 2 §10), `assertCheckCoversIntConst`, the length CHECKs pinned to their consts;
 * - step 4a-ii ✅: the append arbiters, the row arbiter, the recreated superset-order index under a
 *   purge, the one-way CHECKs, and the two cross-household audits (ADR 0007 A2 §6, A3);
 * - step 4b: the XOR both ways, slot keys, quantity keys, the scoped `client_id`;
 * - step 5b ✅: the legacy reads are byte-identical with a newer template block present, and
 *   `householdHasProgram` counts legacy blocks only;
 * - step 5: assignments and erasure.
 *
 * What a module can rely on when it runs, and the helpers to import, are in `./harness` →
 * `VerifyContext`: the modules run LAST, on a database that already holds every fixture `verify.ts`
 * wrote. Every proof here that writes runs inside {@link rolledBack}, so this module leaves nothing
 * behind for a later module to count.
 */
export async function verifySchema(ctx: VerifyContext): Promise<void> {
  await verifyStep3(ctx);
  await verifyStep4ai(ctx);
  await verifyStep5b(ctx);
  await verifyStep4aii(ctx);
  await verifyStep4b(ctx);
  await verifyStep5(ctx);
  await verifyTechDebtChecks(ctx);
  await verifyStep1();
}

// The marker the migration puts on the line above its typing statement.
const TYPING_MARKER = '-- fam-1-3:typing';

/**
 * The migration's own typing statement, read verbatim from its file (the 0012 pre-check precedent in
 * `verify.ts`): re-typing it here would prove a lookalike of the migration, not the migration.
 */
function migrationTypingStatement(): string {
  const file = readFileSync(
    new URL('../../migrations/0022_fam1_3_tracking_types.sql', import.meta.url),
    'utf8',
  );
  const lines = file.split('\n');
  const at = lines.findIndex((l) => l.startsWith(TYPING_MARKER));
  assert.ok(at >= 0, 'FAM-1 3: migration 0022 carries the typing marker');
  const statement = lines[at + 1].replace(/;--> statement-breakpoint$/, '');
  assert.match(
    statement,
    /^UPDATE "movements"/,
    'FAM-1 3: the line after the marker is the UPDATE',
  );
  return statement;
}

/** The seeded built-ins' types, as the const declares them, keyed by slug. */
const SEEDED_TYPE_BY_SLUG = new Map(MOVEMENT_SEED_ROWS.map((r) => [r.slug, r.trackingType]));

async function globalTypesBySlug(tx: VerifyTx | typeof db): Promise<Map<string, string>> {
  const rows = await tx
    .select({ slug: schema.movements.slug, trackingType: schema.movements.trackingType })
    .from(schema.movements)
    .where(
      and(movementIsGlobal(), inArray(schema.movements.slug, [...SEEDED_TYPE_BY_SLUG.keys()])),
    );
  return new Map(rows.map((r) => [r.slug, r.trackingType]));
}

async function verifyStep3({ A_SCOPE }: VerifyContext): Promise<void> {
  // ── (a) the column and its CHECK ─────────────────────────────────────────────────────────────────
  assert.deepEqual(
    await columnCatalogShape('movements', 'tracking_type'),
    { data_type: 'text', is_nullable: 'NO', column_default: "'weight_reps'::text" },
    'FAM-1 3: movements.tracking_type is text NOT NULL DEFAULT weight_reps',
  );
  await assertCheckCoversConst('movements_tracking_type_check', TRACKING_TYPES);
  await rolledBack(async (tx) => {
    await expectRejectedBy(
      'movements_tracking_type_check',
      () =>
        tx.insert(schema.movements).values({
          publicId: newId(),
          slug: 'fam-1-3_probe_bad_type',
          name: 'FAM-1 3 probe',
          pattern: 'core',
          trackingType: 'sets_of_anything',
        }),
      tx,
    );
  });
  console.log(
    '✓ FAM-1 3: movements.tracking_type is NOT NULL, defaults to weight_reps, and its CHECK is TRACKING_TYPES exactly',
  );

  // ── (b) sessions admit 'workout', and the CHECK is SESSION_TYPES exactly ─────────────────────────
  // Not pinned anywhere before this step: `verify.ts` pinned only the day_role CHECK.
  await assertCheckCoversConst('sessions_session_type_check', SESSION_TYPES);
  await rolledBack(async (tx) => {
    const [profile] = await tx.select({ id: schema.profiles.id }).from(schema.profiles).limit(1);
    assert.ok(profile, 'FAM-1 3: a profile exists to hang a probe session on');
    await tx.insert(schema.sessions).values({
      publicId: newId(),
      clientId: newId(),
      profileId: profile.id,
      activityDate: '2026-11-15',
      sessionType: SESSION_TYPE.workout,
    });
    await expectRejectedBy(
      'sessions_session_type_check',
      () =>
        tx.insert(schema.sessions).values({
          publicId: newId(),
          clientId: newId(),
          profileId: profile.id,
          activityDate: '2026-11-15',
          sessionType: 'my workout',
        }),
      tx,
    );
  });
  console.log(
    "✓ FAM-1 3: a 'workout' session inserts; sessions_session_type_check is SESSION_TYPES exactly",
  );

  // ── (c) every built-in is typed as its seed row says (the fresh-seed path) ───────────────────────
  assert.deepEqual(
    Object.fromEntries(await globalTypesBySlug(db)),
    Object.fromEntries(SEEDED_TYPE_BY_SLUG),
    'FAM-1 3: every global seeded movement carries the trackingType MOVEMENT_SEED_ROWS declares',
  );
  console.log(
    `✓ FAM-1 3: all ${SEEDED_TYPE_BY_SLUG.size} built-in items are typed as the seed declares`,
  );

  // ── (d) the migration's typing, run as written, on rows that hold the default (the prod path) ────
  // Every gate migrates an EMPTY movements table, so this is the only place the UPDATE meets rows
  // before production. A household's own row with a slug the typing RETYPES must survive it.
  const typing = migrationTypingStatement();
  const PINNED = '2000-01-01T00:00:00Z';
  const notAtDefault = [...SEEDED_TYPE_BY_SLUG].filter(([, t]) => t !== DEFAULT_TRACKING_TYPE);
  assert.ok(notAtDefault.length > 0, 'FAM-1 3: the typing retypes at least one built-in');
  const [ownSlug] = notAtDefault[0];
  // Only the seeded slugs: verify.ts leaves other global rows behind that the hand-re-added
  // global-row CHECK would refuse on any update (harness → "two constraints are not as the
  // migrations left them"). The typing touches only these slugs, so nothing outside them can move.
  const seededSlug = inArray(schema.movements.slug, [...SEEDED_TYPE_BY_SLUG.keys()]);
  await rolledBack(async (tx) => {
    await tx
      .update(schema.movements)
      .set({ trackingType: DEFAULT_TRACKING_TYPE })
      .where(and(movementIsGlobal(), seededSlug));
    await insertMovementOwnedBy(asTx(tx), A_SCOPE, {
      publicId: newId(),
      slug: ownSlug,
      name: 'FAM-1 3 probe: own row with a seeded slug',
      isBodyweight: true,
    });

    // The reset took: every built-in is at the default before the typing runs, so what follows
    // measures the migration, not a leftover type.
    assert.deepEqual(
      [...new Set((await globalTypesBySlug(tx)).values())],
      [DEFAULT_TRACKING_TYPE],
      'FAM-1 3: every built-in is at the default before the typing runs',
    );
    await tx.execute(typing); // the migration's own text, verbatim — not interpolated input

    assert.deepEqual(
      Object.fromEntries(await globalTypesBySlug(tx)),
      Object.fromEntries(SEEDED_TYPE_BY_SLUG),
      "FAM-1 3: migration 0022's typing gives every built-in the type MOVEMENT_SEED_ROWS declares",
    );
    const [own] = await tx
      .select({ trackingType: schema.movements.trackingType })
      .from(schema.movements)
      .where(and(eq(schema.movements.slug, ownSlug), movementInHousehold(A_SCOPE)));
    assert.equal(
      own?.trackingType,
      DEFAULT_TRACKING_TYPE,
      "FAM-1 3: the typing never touches a household's own row, even one with a slug it retypes",
    );

    // A second run changes nothing: pin every row's updated_at, run it again, and no row moves.
    await tx
      .update(schema.movements)
      .set({ updatedAt: new Date(PINNED) })
      .where(seededSlug);
    await tx.execute(typing);
    const [moved] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.movements)
      .where(and(seededSlug, sql`${schema.movements.updatedAt} <> ${PINNED}::timestamptz`));
    assert.equal(moved?.n, 0, 'FAM-1 3: a second run of the typing updates no row');
  });
  console.log(
    "✓ FAM-1 3: migration 0022's typing, run as written, types every built-in, spares a household's own row, and a second run changes nothing",
  );

  // ── (e) a Count of a plain number is storable: (primary, count) is a slot pair ───────────────────
  await rolledBack(async (tx) => {
    // A set with no primary quantity yet, so the slot's own UNIQUE cannot be what answers.
    const [set] = await tx
      .select({ id: schema.entrySets.id })
      .from(schema.entrySets)
      .where(
        notExists(
          tx
            .select({ one: sql`1` })
            .from(schema.entrySetQuantities)
            .where(
              and(
                eq(schema.entrySetQuantities.entrySetId, schema.entrySets.id),
                eq(schema.entrySetQuantities.slot, QUANTITY_SLOT.primary),
              ),
            ),
        ),
      )
      .limit(1);
    assert.ok(set, 'FAM-1 3: an entry set exists to hang a probe quantity on');
    await tx.insert(schema.entrySetQuantities).values({
      clientId: newId(),
      entrySetId: set.id,
      slot: QUANTITY_SLOT.primary,
      dimension: UNIT_DIMENSION.count,
      unit: 'count',
      valueNum: '10',
    });
  });
  console.log('✓ FAM-1 3: a (primary, count) quantity in unit count inserts');

  // ── (f) the typed resolver: types a NEW item, never retypes an existing one ──────────────────────
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    const name = 'FAM-1 3 probe: a new Check item';
    const made = await findOrCreateTypedMovement(exec, A_SCOPE, name, TRACKING_TYPE.check);
    assert.equal(
      made.trackingType,
      TRACKING_TYPE.check,
      'FAM-1 3: a new item is made with the type asked for',
    );
    const again = await findOrCreateTypedMovement(exec, A_SCOPE, name, TRACKING_TYPE.reps);
    assert.deepEqual(
      again,
      made,
      'FAM-1 3: the same name with another type returns the item unchanged',
    );

    const [seededReps] = notAtDefault;
    const seededName = MOVEMENT_SEED_ROWS.find((r) => r.slug === seededReps[0])!.name;
    const global = await findOrCreateTypedMovement(exec, A_SCOPE, seededName, TRACKING_TYPE.check);
    assert.equal(
      global.trackingType,
      seededReps[1],
      "FAM-1 3: a built-in's name returns the built-in, with its own type",
    );

    const types = await tx
      .select({ trackingType: schema.movements.trackingType })
      .from(schema.movements)
      .where(inArray(schema.movements.id, [made.id, global.id]));
    assert.deepEqual(
      types.map((t) => t.trackingType).sort(),
      [TRACKING_TYPE.check, seededReps[1]].sort(),
      'FAM-1 3: neither row was retyped in the database',
    );
  });
  console.log(
    '✓ FAM-1 3: findOrCreateTypedMovement types a new item, and returns an existing one (own or built-in) with its own type',
  );
}

// ── FAM-1 step 4a-i ─────────────────────────────────────────────────────────────────────────────────

/**
 * An INTEGER CHECK's accepted set equals its shared const exactly, both directions. The int sibling of
 * `assertCheckCoversConst`, which reads quoted tokens only. The CHECK must be written `x IN (…)`:
 * Postgres renders that as `x = ANY (ARRAY[…])`, every member visible, whereas a `BETWEEN` renders as
 * its two endpoints, so a gap in the const could never be seen (SCHED-1 plan's correction).
 */
async function assertCheckCoversIntConst(
  conname: string,
  values: readonly number[],
): Promise<void> {
  const list = (await constraintDef(conname)).match(/ARRAY\[([^\]]*)\]/);
  assert.ok(list, `${conname} is written as IN (…), so every accepted value is visible`);
  const accepted = list[1].split(',').map((v) => Number(v.trim()));
  assert.deepEqual(
    [...accepted].sort((a, b) => a - b),
    [...values].sort((a, b) => a - b),
    `${conname} accepts EXACTLY its shared const`,
  );
}

/**
 * A CHECK's one upper bound equals its shared const: a length, a set count or a place (the
 * maintainer's call, 2026-11-16).
 */
async function assertUpperBoundIs(conname: string, max: number): Promise<void> {
  const bounds = [...(await constraintDef(conname)).matchAll(/<= (\d+)/g)].map((m) => Number(m[1]));
  assert.deepEqual(bounds, [max], `${conname}'s upper bound is its shared const (${max})`);
}

/** A string of exactly `n` code points, each OUTSIDE the BMP: zod and char_length must agree on it. */
const astral = (n: number) => '😀'.repeat(n);

/**
 * Workouts whose block is not a TEMPLATE block. No constraint stops one (A2 §2: "writer, plus
 * `db:verify`"); this is the "flagged" half. It runs here, on PGlite: against production the same query
 * is run by hand (safe, read-only).
 */
async function workoutsOnNonTemplateBlocks(tx: VerifyTx): Promise<number[]> {
  const rows = await tx
    .select({ id: schema.workouts.id })
    .from(schema.workouts)
    .innerJoin(schema.programBlocks, eq(schema.programBlocks.id, schema.workouts.blockId))
    .where(sql`${schema.programBlocks.kind} <> ${PROGRAM_BLOCK_KIND.template}`);
  return rows.map((r) => r.id);
}

/** Workouts copied from a workout in ANOTHER household (A2 §2, §8). Also the runbook pre-flight's query. */
async function crossHouseholdWorkoutCopies(tx: VerifyTx): Promise<number[]> {
  const res = await tx.execute(sql`
    SELECT w.id FROM workouts w
      JOIN program_blocks b ON b.id = w.block_id
      JOIN workouts src ON src.id = w.copied_from_workout_id
      JOIN program_blocks sb ON sb.id = src.block_id
     WHERE b.household_id <> sb.household_id`);
  return idsOf(res);
}

/** A template block in `scope`, through the real writer, read back by its client_id. */
async function mkTemplateBlock(
  exec: ReturnType<typeof asTx>,
  scope: VerifyContext['A_SCOPE'],
  slug: string,
): Promise<number> {
  const clientId = newId();
  await insertProgramBlockOwnedBy(exec, scope, { clientId, slug, name: slug, notes: null });
  return (await programBlockByClientId(exec, scope, clientId))!.id;
}

/**
 * A live strength entry in `blockId`'s household, with its identity columns stripped, so a probe
 * row cloned from it changes only the columns a proof is about. 🔴 The `where` is what a clonable
 * strength entry IS; it lives here once (4a-ii and 4b both clone from it).
 */
async function probeEntryBase(tx: VerifyTx, blockId: number, label: string) {
  const [tpl] = await tx
    .select()
    .from(schema.entries)
    .innerJoin(schema.profiles, eq(schema.profiles.id, schema.entries.profileId))
    .innerJoin(schema.programBlocks, eq(schema.programBlocks.id, blockId))
    .where(
      sql`${schema.profiles.householdId} = ${schema.programBlocks.householdId} and ${schema.entries.sessionId} is not null and ${schema.entries.movementId} is not null and ${schema.entries.metricKey} is null and ${schema.entries.deletedAt} is null`,
    )
    .orderBy(schema.entries.id)
    .limit(1);
  assert.ok(tpl, `${label}: a strength entry exists to clone probe rows from`);
  const {
    id: _id,
    publicId: _p,
    clientId: _c,
    createdAt: _ca,
    updatedAt: _ua,
    ...base
  } = tpl.entries;
  return base;
}

async function countOf(tx: VerifyTx, table: 'workouts' | 'program_blocks'): Promise<number> {
  const t = table === 'workouts' ? schema.workouts : schema.programBlocks;
  const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(t);
  return row.n;
}

async function verifyStep4ai({ A_SCOPE, B_SCOPE }: VerifyContext): Promise<void> {
  // ── (a) the shapes, the CHECKs pinned to their consts, and the encoding they count in ────────────
  assert.deepEqual(
    await columnCatalogShape('program_blocks', 'kind'),
    { data_type: 'text', is_nullable: 'NO', column_default: "'legacy'::text" },
    'FAM-1 4a-i: program_blocks.kind is text NOT NULL DEFAULT legacy',
  );
  assert.equal(
    (await columnCatalogShape('program_blocks', 'client_id'))?.is_nullable,
    'YES',
    'FAM-1 4a-i: program_blocks.client_id is nullable (the seeded/legacy blocks have none)',
  );
  await assertCheckCoversConst('program_blocks_kind_check', PROGRAM_BLOCK_KINDS);
  await assertCheckCoversIntConst('block_day_workouts_weekday_check', WEEKDAYS);
  await assertUpperBoundIs('workouts_name_length_check', WORKOUT_NAME_MAX);
  await assertUpperBoundIs('workouts_description_length_check', FREE_TEXT_NOTE_MAX);
  await assertUpperBoundIs('workouts_copied_from_program_name_length_check', PROGRAM_NAME_MAX);
  await assertUpperBoundIs('block_day_workouts_label_length_check', SLOT_LABEL_MAX);
  // char_length counts code points only under UTF8; zod's .max counts code points too.
  const enc = await db.execute(sql`SHOW server_encoding`);
  assert.equal(
    (enc as unknown as { rows: { server_encoding: string }[] }).rows[0]?.server_encoding,
    'UTF8',
    'FAM-1 4a-i: the database is UTF8, so a length CHECK counts what zod counts',
  );
  const kinds = await db
    .selectDistinct({ kind: schema.programBlocks.kind })
    .from(schema.programBlocks);
  assert.deepEqual(
    kinds.map((k) => k.kind),
    [PROGRAM_BLOCK_KIND.legacy],
    'FAM-1 4a-i: every block the seed and verify.ts wrote is legacy (the default; the seed omits kind)',
  );
  console.log(
    '✓ FAM-1 4a-i: kind, weekday and the four length CHECKs are pinned to their shared consts; the seed lands legacy',
  );

  // ── (b) blocks: the writer lands `template`; the scoped client_id ─────────────────────────────────
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    const blockClient = newId();
    const block = { clientId: blockClient, slug: 'fam-1-4a-i-probe', name: 'Probe', notes: null };
    await insertProgramBlockOwnedBy(exec, A_SCOPE, block);
    const made = await programBlockByClientId(exec, A_SCOPE, blockClient);
    assert.equal(made?.kind, PROGRAM_BLOCK_KIND.template, 'FAM-1 4a-i: the writer lands template');
    const before = await countOf(tx, 'program_blocks');
    await insertProgramBlockOwnedBy(exec, A_SCOPE, { ...block, slug: 'fam-1-4a-i-probe-replay' });
    assert.equal(
      await countOf(tx, 'program_blocks'),
      before,
      'FAM-1 4a-i: a replayed block adds nothing',
    );
    assert.deepEqual(await programBlockByClientId(exec, A_SCOPE, blockClient), made);

    // The read is scoped: a block only A holds is not found under B's scope.
    assert.equal(
      await programBlockByClientId(exec, B_SCOPE, blockClient),
      null,
      "FAM-1 4a-i: another household's block is not found by its client_id",
    );
    // The same id in ANOTHER household is accepted (the key is scoped), and is B's own row.
    await insertProgramBlockOwnedBy(exec, B_SCOPE, block);
    const bMade = await programBlockByClientId(exec, B_SCOPE, blockClient);
    assert.ok(bMade, 'FAM-1 4a-i: same client_id, other household');
    assert.notEqual(bMade.id, made!.id, "FAM-1 4a-i: B's block is its own row, not A's");
    // A template block with no client_id is refused: a replay could never be matched.
    const [{ householdId: aHh }] = await tx
      .select({ householdId: schema.programBlocks.householdId })
      .from(schema.programBlocks)
      .where(eq(schema.programBlocks.id, made!.id));
    await expectRejectedBy(
      'program_blocks_template_client_id_check',
      () =>
        tx.insert(schema.programBlocks).values({
          publicId: newId(),
          householdId: aHh,
          kind: PROGRAM_BLOCK_KIND.template,
          slug: 'fam-1-4a-i-no-client',
          name: 'No client',
        }),
      tx,
    );

    // A twin in the SAME household (fresh slug and public_id, so only client_id can refuse it) is
    // refused — also once the holder is hidden: a hidden block still owns its id.
    const [{ householdId: aHousehold }] = await tx
      .select({ householdId: schema.programBlocks.householdId })
      .from(schema.programBlocks)
      .where(eq(schema.programBlocks.id, made!.id));
    const twin = (slug: string) =>
      tx.insert(schema.programBlocks).values({
        publicId: newId(),
        householdId: aHousehold,
        kind: PROGRAM_BLOCK_KIND.template,
        clientId: blockClient,
        slug,
        name: 'Twin',
      });
    await expectRejectedBy(
      'uq_program_blocks_household_client_id',
      () => twin('fam-1-4a-i-twin'),
      tx,
    );
    await tx
      .update(schema.programBlocks)
      .set({ deletedAt: new Date() })
      .where(eq(schema.programBlocks.id, made!.id));
    await expectRejectedBy(
      'uq_program_blocks_household_client_id',
      () => twin('fam-1-4a-i-twin-2'),
      tx,
    );
  });
  console.log(
    '✓ FAM-1 4a-i: insertProgramBlockOwnedBy lands template; a replay adds nothing; client_id is unique per household, a hidden holder included, and free across households',
  );

  // ── (c) workouts: ownership, replay, refusals one conjunct at a time, provenance ─────────────────
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    const mkBlock = (scope: typeof A_SCOPE, slug: string) => mkTemplateBlock(exec, scope, slug);
    const aBlock = await mkBlock(A_SCOPE, 'fam-1-4a-i-a');
    const aBlock2 = await mkBlock(A_SCOPE, 'fam-1-4a-i-a2');
    const bBlock = await mkBlock(B_SCOPE, 'fam-1-4a-i-b');
    const [{ householdId: aHousehold }] = await tx
      .select({ householdId: schema.programBlocks.householdId })
      .from(schema.programBlocks)
      .where(eq(schema.programBlocks.id, aBlock));
    // A LEGACY block in A's own household: refused by the kind conjunct alone.
    const [{ id: aLegacy }] = await tx
      .insert(schema.programBlocks)
      .values({ publicId: newId(), householdId: aHousehold, slug: 'fam-1-4a-i-legacy', name: 'L' })
      .returning({ id: schema.programBlocks.id });
    // A HIDDEN template block in A's own household: refused by the live conjunct alone.
    const aHidden = await mkBlock(A_SCOPE, 'fam-1-4a-i-hidden');
    await tx
      .update(schema.programBlocks)
      .set({ deletedAt: new Date() })
      .where(eq(schema.programBlocks.id, aHidden));

    const workout = (blockId: number, clientId = newId()) => ({
      blockId,
      clientId,
      name: 'Push day',
      description: null,
    });
    const w1Client = newId();
    const w1 = await insertWorkoutOwnedBy(exec, A_SCOPE, workout(aBlock, w1Client));
    assert.ok(w1, "FAM-1 4a-i: a workout in this household's live template block is written");
    assert.deepEqual(
      { created: w1.created, deleted: w1.deleted },
      { created: true, deleted: false },
      'FAM-1 4a-i: a first write reports created, and live',
    );
    const count = await countOf(tx, 'workouts');
    assert.deepEqual(
      await insertWorkoutOwnedBy(exec, A_SCOPE, { ...workout(aBlock, w1Client), name: 'Renamed' }),
      { ...w1, created: false },
      'FAM-1 4a-i: a replayed workout returns the FIRST row, not a refusal',
    );
    assert.equal(await countOf(tx, 'workouts'), count, 'FAM-1 4a-i: a replay writes nothing');

    for (const [why, blockId] of [
      ['a legacy block', aLegacy],
      ['a hidden template block', aHidden],
      ["another household's live template block", bBlock],
    ] as const) {
      assert.equal(
        await insertWorkoutOwnedBy(exec, A_SCOPE, workout(blockId)),
        null,
        `FAM-1 4a-i: insertWorkoutOwnedBy refuses ${why}`,
      );
    }
    assert.equal(await countOf(tx, 'workouts'), count, 'FAM-1 4a-i: a refusal writes nothing');

    // Copies: one from this household is written with its provenance; one from another is refused.
    const bWorkout = await insertWorkoutOwnedBy(exec, B_SCOPE, workout(bBlock));
    const copy = await insertWorkoutOwnedBy(exec, A_SCOPE, {
      ...workout(aBlock2),
      copiedFrom: { workoutId: w1!.id, programName: 'Family program' },
    });
    assert.ok(copy, "FAM-1 4a-i: a copy of this household's workout is written");
    assert.equal(
      await insertWorkoutOwnedBy(exec, A_SCOPE, {
        ...workout(aBlock2),
        copiedFrom: { workoutId: bWorkout!.id, programName: 'Their program' },
      }),
      null,
      "FAM-1 4a-i: a copy of another household's workout is refused",
    );

    // The scoped client_id: a twin in one block (fresh public_id) is refused, the same id in another
    // block accepted.
    await expectRejectedBy(
      'uq_workouts_block_client_id',
      () =>
        tx
          .insert(schema.workouts)
          .values({ publicId: newId(), clientId: w1Client, blockId: aBlock, name: 'Twin' }),
      tx,
    );
    assert.ok(await insertWorkoutOwnedBy(exec, A_SCOPE, workout(aBlock2, w1Client)));

    // Lengths: the max passes (in astral characters, which zod and char_length both count as one);
    // one more, and a blank name, are refused. Provenance: an id never outlives its name.
    const raw = (over: Partial<typeof schema.workouts.$inferInsert>) =>
      tx
        .insert(schema.workouts)
        .values({ publicId: newId(), clientId: newId(), blockId: aBlock, name: 'W', ...over });
    await raw({ name: astral(WORKOUT_NAME_MAX) });
    await expectRejectedBy(
      'workouts_name_length_check',
      () => raw({ name: astral(WORKOUT_NAME_MAX + 1) }),
      tx,
    );
    await expectRejectedBy('workouts_name_length_check', () => raw({ name: '   ' }), tx);
    await expectRejectedBy(
      'workouts_description_length_check',
      () => raw({ description: astral(FREE_TEXT_NOTE_MAX + 1) }),
      tx,
    );
    await expectRejectedBy(
      'workouts_copied_from_program_name_length_check',
      () => raw({ copiedFromProgramName: astral(PROGRAM_NAME_MAX + 1) }),
      tx,
    );
    // A replay is answered before any check: a hidden workout comes back flagged, and a replay
    // after its block was hidden still returns the row (never a refusal).
    await tx
      .update(schema.workouts)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workouts.id, w1.id));
    assert.deepEqual(
      await insertWorkoutOwnedBy(exec, A_SCOPE, workout(aBlock, w1Client)),
      { ...w1, created: false, deleted: true },
      'FAM-1 4a-i: a replay onto a hidden workout returns it, flagged deleted',
    );
    await tx
      .update(schema.programBlocks)
      .set({ deletedAt: new Date() })
      .where(eq(schema.programBlocks.id, aBlock));
    assert.equal(
      (await insertWorkoutOwnedBy(exec, A_SCOPE, workout(aBlock, w1Client)))?.id,
      w1.id,
      'FAM-1 4a-i: a replay after its block was hidden is still a replay, not a refusal',
    );
    await expectRejectedBy(
      'workouts_copied_from_pairing_check',
      () => raw({ copiedFromWorkoutId: w1!.id }),
      tx,
    );
  });
  console.log(
    "✓ FAM-1 4a-i: insertWorkoutOwnedBy writes into this household's live template block, answers a replay with the first row, refuses a legacy, hidden or foreign block and a foreign copy source; client_id is unique per block; lengths and provenance hold",
  );

  // ── (d) the week: composite FK, slot keys, weekday, idx, label ───────────────────────────────────
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    const mk = async (scope: typeof A_SCOPE, slug: string) => {
      const clientId = newId();
      await insertProgramBlockOwnedBy(exec, scope, { clientId, slug, name: slug, notes: null });
      const blockId = (await programBlockByClientId(exec, scope, clientId))!.id;
      const w = (await insertWorkoutOwnedBy(exec, scope, {
        blockId,
        clientId: newId(),
        name: 'A',
        description: null,
      }))!;
      const w2 = (await insertWorkoutOwnedBy(exec, scope, {
        blockId,
        clientId: newId(),
        name: 'B',
        description: null,
      }))!;
      return { blockId, w: w.id, w2: w2.id };
    };
    const a = await mk(A_SCOPE, 'fam-1-4a-i-week-a');
    const other = await mk(A_SCOPE, 'fam-1-4a-i-week-other');
    const slot = (over: Partial<typeof schema.blockDayWorkouts.$inferInsert>) =>
      tx
        .insert(schema.blockDayWorkouts)
        .values({ blockId: a.blockId, weekday: 1, idx: 0, workoutId: a.w, ...over });

    await slot({});
    // A second slot at the same place (a DIFFERENT workout, so only the slot key can refuse it).
    await expectRejectedBy('uq_block_day_workouts_slot', () => slot({ workoutId: a.w2 }), tx);
    // The same workout twice in one day (a DIFFERENT idx, so only the once-per-day key can refuse it).
    await expectRejectedBy('uq_block_day_workouts_once_per_day', () => slot({ idx: 1 }), tx);
    // Hiding the slot frees both places.
    await tx
      .update(schema.blockDayWorkouts)
      .set({ deletedAt: new Date() })
      .where(eq(schema.blockDayWorkouts.blockId, a.blockId));
    await slot({});
    // Another block's workout (same household) can never be placed: the composite FK.
    await expectRejectedBy(
      'block_day_workouts_workout_block_fkey',
      () => slot({ weekday: 2, workoutId: other.w }),
      tx,
    );
    await expectRejectedBy(
      'block_day_workouts_weekday_check',
      () => slot({ weekday: 7, workoutId: a.w2 }),
      tx,
    );
    await expectRejectedBy('block_day_workouts_idx_check', () => slot({ weekday: 3, idx: -1 }), tx);
    await slot({ weekday: 4, label: astral(SLOT_LABEL_MAX) });
    await expectRejectedBy(
      'block_day_workouts_label_length_check',
      () => slot({ weekday: 5, label: astral(SLOT_LABEL_MAX + 1) }),
      tx,
    );
    await expectRejectedBy(
      'block_day_workouts_label_length_check',
      () => slot({ weekday: 5, label: ' ' }),
      tx,
    );
  });
  console.log(
    "✓ FAM-1 4a-i: a week slot names only its own block's workout; one slot per place and one per workout per day, a hidden slot freeing both; weekday, idx and label are bounded",
  );

  // ── (e) flagged: the two rules no constraint holds, and the erasure order ────────────────────────
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    assert.deepEqual(
      await workoutsOnNonTemplateBlocks(tx),
      [],
      'FAM-1 4a-i: no workout sits on a non-template block',
    );
    assert.deepEqual(
      await crossHouseholdWorkoutCopies(tx),
      [],
      'FAM-1 4a-i: no workout is copied across households',
    );

    const aClient = newId();
    await insertProgramBlockOwnedBy(exec, A_SCOPE, {
      clientId: aClient,
      slug: 'fam-1-4a-i-erase-a',
      name: 'A',
      notes: null,
    });
    const aBlock = (await programBlockByClientId(exec, A_SCOPE, aClient))!.id;
    const bClient = newId();
    await insertProgramBlockOwnedBy(exec, B_SCOPE, {
      clientId: bClient,
      slug: 'fam-1-4a-i-erase-b',
      name: 'B',
      notes: null,
    });
    const bBlock = (await programBlockByClientId(exec, B_SCOPE, bClient))!.id;
    const bWorkout = (await insertWorkoutOwnedBy(exec, B_SCOPE, {
      blockId: bBlock,
      clientId: newId(),
      name: 'B',
      description: null,
    }))!;
    const bCopy = (await insertWorkoutOwnedBy(exec, B_SCOPE, {
      blockId: bBlock,
      clientId: newId(),
      name: 'B copy',
      description: null,
      copiedFrom: { workoutId: bWorkout.id, programName: 'B' },
    }))!;
    await tx
      .insert(schema.blockDayWorkouts)
      .values({ blockId: bBlock, weekday: 0, idx: 0, workoutId: bWorkout.id });

    // Planted violations, written past the writer: each audit flags exactly its own.
    const [{ householdId: aHousehold }] = await tx
      .select({ householdId: schema.programBlocks.householdId })
      .from(schema.programBlocks)
      .where(eq(schema.programBlocks.id, aBlock));
    const [{ id: legacy }] = await tx
      .insert(schema.programBlocks)
      .values({
        publicId: newId(),
        householdId: aHousehold,
        slug: 'fam-1-4a-i-erase-legacy',
        name: 'L',
      })
      .returning({ id: schema.programBlocks.id });
    const [{ id: onLegacy }] = await tx
      .insert(schema.workouts)
      .values({ publicId: newId(), clientId: newId(), blockId: legacy, name: 'On legacy' })
      .returning({ id: schema.workouts.id });
    const [{ id: crossCopy }] = await tx
      .insert(schema.workouts)
      .values({
        publicId: newId(),
        clientId: newId(),
        blockId: aBlock,
        name: 'Copied across',
        copiedFromWorkoutId: bWorkout.id,
        copiedFromProgramName: 'B',
      })
      .returning({ id: schema.workouts.id });
    assert.deepEqual(
      await workoutsOnNonTemplateBlocks(tx),
      [onLegacy],
      'FAM-1 4a-i: a workout on a legacy block is flagged',
    );
    assert.deepEqual(
      await crossHouseholdWorkoutCopies(tx),
      [crossCopy],
      'FAM-1 4a-i: a cross-household copy is flagged',
    );

    // The runbook's order for B's program tables: week slots (9a), then workouts (9b), then blocks.
    // Out of order is refused by the FKs, so the order is load-bearing, not tidy.
    const bBlocks = tx
      .select({ id: schema.programBlocks.id })
      .from(schema.programBlocks)
      .where(eq(schema.programBlocks.id, bBlock));
    await expectRejectedBy(
      'block_day_workouts_workout_block_fkey',
      () => tx.delete(schema.workouts).where(inArray(schema.workouts.blockId, bBlocks)),
      tx,
    );
    await tx
      .delete(schema.blockDayWorkouts)
      .where(inArray(schema.blockDayWorkouts.blockId, bBlocks));
    await expectRejectedBy(
      'workouts_block_id_program_blocks_id_fk',
      () => tx.delete(schema.programBlocks).where(eq(schema.programBlocks.id, bBlock)),
      tx,
    );
    await tx.delete(schema.workouts).where(inArray(schema.workouts.blockId, bBlocks));
    await tx.delete(schema.programBlocks).where(eq(schema.programBlocks.id, bBlock));
    // The cross-household copy survives its source's deletion with the pointer NULL and the frozen
    // name kept, which is why the pre-flight must flag it BEFORE the delete (SET NULL is silent).
    const [kept] = await tx
      .select({
        from: schema.workouts.copiedFromWorkoutId,
        name: schema.workouts.copiedFromProgramName,
      })
      .from(schema.workouts)
      .where(eq(schema.workouts.id, crossCopy));
    assert.deepEqual(
      kept,
      { from: null, name: 'B' },
      'FAM-1 4a-i: a copy outlives its source with the name kept',
    );
    void bCopy;
  });
  console.log(
    "✓ FAM-1 4a-i: a workout on a non-template block and a cross-household copy are each flagged; the program tables erase in the runbook's order (slots, workouts, blocks), and out of order is refused",
  );
}

/**
 * FAM-1 step 1 (plan D10): the program fixtures are written ONLY when the seed is asked for them.
 *
 * In a rolled-back transaction: hard-delete the seed household's program (targets → prescriptions →
 * blocks; nothing else references them), then `seed(…, { fixtures: false })` must leave it empty and
 * `seed(…, { fixtures: true })` must put `PROGRAM_SEED` back, every block, prescription and target.
 * The seed runs on the transaction's own handle (PGlite has one connection).
 */
async function verifyStep1(): Promise<void> {
  const seedBlocks = PROGRAM_SEED.filter((b) => b.householdPublicId === SEED_HOUSEHOLD_PUBLIC_ID);
  assert.ok(seedBlocks.length > 0, 'FAM-1 1: PROGRAM_SEED has a block for the seed household');
  const expected = {
    blocks: seedBlocks.map((b) => b.slug).sort(),
    prescriptions: seedBlocks.reduce((n, b) => n + b.prescriptions.length, 0),
    targets: seedBlocks.reduce(
      (n, b) => n + b.prescriptions.reduce((m, p) => m + p.targets.length, 0),
      0,
    ),
  };

  await rolledBack(async (tx) => {
    const [household] = await tx
      .select({ id: schema.households.id })
      .from(schema.households)
      .where(eq(schema.households.publicId, SEED_HOUSEHOLD_PUBLIC_ID));
    assert.ok(household, 'FAM-1 1: the seed household exists');

    const blocksOf = tx
      .select({ id: schema.programBlocks.id })
      .from(schema.programBlocks)
      .where(eq(schema.programBlocks.householdId, household.id));
    const prescriptionsOf = tx
      .select({ id: schema.prescriptions.id })
      .from(schema.prescriptions)
      .where(inArray(schema.prescriptions.blockId, blocksOf));

    /** What the seed household's program holds now: block slugs, and the live rows under them. */
    const program = async () => {
      const blocks = await tx
        .select({ slug: schema.programBlocks.slug })
        .from(schema.programBlocks)
        .where(eq(schema.programBlocks.householdId, household.id));
      const [p] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.prescriptions)
        .where(inArray(schema.prescriptions.blockId, blocksOf));
      const [t] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.prescriptionTargets)
        .where(inArray(schema.prescriptionTargets.prescriptionId, prescriptionsOf));
      return { blocks: blocks.map((b) => b.slug).sort(), prescriptions: p.n, targets: t.n };
    };

    await tx
      .delete(schema.prescriptionTargets)
      .where(inArray(schema.prescriptionTargets.prescriptionId, prescriptionsOf));
    await tx.delete(schema.prescriptions).where(inArray(schema.prescriptions.blockId, blocksOf));
    await tx.delete(schema.programBlocks).where(eq(schema.programBlocks.householdId, household.id));
    assert.deepEqual(
      await program(),
      { blocks: [], prescriptions: 0, targets: 0 },
      'FAM-1 1: the seed household holds no program before the seed runs',
    );

    const seedDb = asDb(tx);
    await seed(seedDb, { fixtures: false });
    assert.deepEqual(
      await program(),
      { blocks: [], prescriptions: 0, targets: 0 },
      'FAM-1 1: seed({ fixtures: false }) writes no program, which is how production seeds',
    );

    await seed(seedDb, { fixtures: true });
    assert.deepEqual(
      await program(),
      expected,
      'FAM-1 1: seed({ fixtures: true }) writes PROGRAM_SEED: every block, prescription and target',
    );
  });
  console.log(
    '✓ FAM-1 1: the seed writes the program only when asked for fixtures (production never asks)',
  );
}

// ── FAM-1 step 5b ───────────────────────────────────────────────────────────────────────────────────

async function verifyStep5b({ A_SCOPE }: VerifyContext): Promise<void> {
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    const pg = asDb(tx);

    // A day role A's legacy block programs WITH a rendered target (sets set), so a snapshot is
    // non-empty, and a kid of that household to read it for.
    const [legacy] = await tx
      .select({
        dayRole: schema.prescriptions.dayRole,
        householdId: schema.programBlocks.householdId,
      })
      .from(schema.prescriptions)
      .innerJoin(schema.programBlocks, eq(schema.programBlocks.id, schema.prescriptions.blockId))
      .where(
        and(
          programBlockInHousehold(A_SCOPE),
          sql`${schema.programBlocks.kind} = ${PROGRAM_BLOCK_KIND.legacy} and ${schema.programBlocks.deletedAt} is null and ${schema.prescriptions.deletedAt} is null and ${schema.prescriptions.sets} is not null`,
        ),
      )
      .orderBy(schema.prescriptions.id)
      .limit(1);
    assert.ok(legacy, 'FAM-1 5b: a legacy prescription with a target exists');
    const [kid] = await tx
      .select({ publicId: schema.profiles.publicId })
      .from(schema.profiles)
      .where(
        sql`${schema.profiles.householdId} = ${legacy.householdId} and ${schema.profiles.kind} = ${PROGRAM_READ_KIND} and ${schema.profiles.deletedAt} is null`,
      )
      .orderBy(schema.profiles.id)
      .limit(1);
    assert.ok(kid, 'FAM-1 5b: a kid reads that program');
    const dayRole = legacy.dayRole as Parameters<typeof programDayRows>[1]['dayRole'];
    const read = { scope: A_SCOPE, profilePublicId: kid.publicId, dayRole };

    const rowsBefore = await programDayRows(pg, read);
    assert.ok(
      rowsBefore.length > 0,
      'FAM-1 5b: the legacy read returns rows (an adult would give [] on both sides)',
    );
    const legacyMovements = [...new Set(rowsBefore.map((r) => r.movementId))];

    // The worst case: a NEWER template block in the same household, with a prescription on the SAME
    // day role (legal in the database after 4b too; only the writer refuses it), a target, and a
    // movement the legacy block does not use.
    const clientId = newId();
    await insertProgramBlockOwnedBy(exec, A_SCOPE, {
      clientId,
      slug: 'fam-1-5b-template',
      name: 'T',
      notes: null,
    });
    const template = (await programBlockByClientId(exec, A_SCOPE, clientId))!;
    const [otherMovement] = await tx
      .select({ id: schema.movements.id })
      .from(schema.movements)
      .where(
        sql`${schema.movements.householdId} is null and ${schema.movements.id} not in (${sql.join(
          legacyMovements.map((m) => sql`${m}`),
          sql`, `,
        )})`,
      )
      .orderBy(schema.movements.id)
      .limit(1);
    await tx.insert(schema.prescriptions).values({
      publicId: newId(),
      blockId: template.id,
      dayRole,
      movementId: otherMovement.id,
      idx: 0,
      sets: 3,
      targetReps: '5',
    });
    const movementIds = [...legacyMovements, otherMovement.id];
    // Control: unfiltered, the template block IS the newest block programming this day role.
    const [newest] = await tx
      .select({ id: schema.programBlocks.id })
      .from(schema.programBlocks)
      .innerJoin(schema.prescriptions, eq(schema.prescriptions.blockId, schema.programBlocks.id))
      .where(
        sql`${schema.programBlocks.householdId} = ${legacy.householdId} and ${schema.prescriptions.dayRole} = ${dayRole} and ${schema.programBlocks.deletedAt} is null`,
      )
      .orderBy(sql`${schema.programBlocks.id} desc`)
      .limit(1);
    assert.equal(
      newest.id,
      template.id,
      'FAM-1 5b: control — unfiltered, the template block would be the one read',
    );

    // Byte-identical legacy output with the template block present.
    assert.deepEqual(
      await programDayRows(pg, read),
      rowsBefore,
      'FAM-1 5b: programDayRows is byte-identical with a template block present',
    );
    // The snapshot writer reads programDayRows too; recorded on the same movements, it must not see
    // the template prescription. (Recording the "before" map now is equivalent: the legacy rows did not change.)
    const snapshots = await prescribedSnapshotsFor(pg, { ...read, movementIds });
    assert.ok(
      [...snapshots.values()].some((v) => v !== ''),
      'FAM-1 5b: control — a legacy snapshot renders non-empty',
    );
    assert.equal(
      snapshots.get(otherMovement.id) ?? '',
      '',
      "FAM-1 5b: the template's movement has no snapshot",
    );
  });
  console.log(
    '✓ FAM-1 5b: programDayRows and the snapshot writer read the legacy block only, byte-identical with a newer template block on the same day',
  );

  // householdHasProgram counts LEGACY blocks only, in a household of its own.
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    const pg = asDb(tx);
    const [hh] = await tx
      .insert(schema.households)
      .values({ publicId: newId(), name: 'FAM-1 5b probe' })
      .returning({ id: schema.households.id });
    const FRESH_SCOPE = householdScopeForScript(hh.id);
    assert.equal(
      await householdHasProgram(pg, { scope: FRESH_SCOPE }),
      false,
      'FAM-1 5b: no blocks: no program',
    );
    const clientId = newId();
    await insertProgramBlockOwnedBy(exec, FRESH_SCOPE, {
      clientId,
      slug: 'fam-1-5b-only-template',
      name: 'T',
      notes: null,
    });
    const t = await programBlockByClientId(exec, FRESH_SCOPE, clientId);
    assert.ok(t && !t.deleted, 'FAM-1 5b: the template block exists and is live');
    assert.equal(
      await householdHasProgram(pg, { scope: FRESH_SCOPE }),
      false,
      'FAM-1 5b: a template block alone is not "a program" for this read',
    );
    const [legacyBlock] = await tx
      .insert(schema.programBlocks)
      .values({ publicId: newId(), householdId: hh.id, slug: 'fam-1-5b-legacy', name: 'L' })
      .returning({ id: schema.programBlocks.id });
    assert.equal(
      await householdHasProgram(pg, { scope: FRESH_SCOPE }),
      true,
      'FAM-1 5b: a live legacy block is',
    );
    await tx
      .update(schema.programBlocks)
      .set({ deletedAt: new Date() })
      .where(eq(schema.programBlocks.id, legacyBlock.id));
    assert.equal(
      await householdHasProgram(pg, { scope: FRESH_SCOPE }),
      false,
      'FAM-1 5b: a hidden legacy block is not',
    );
  });
  console.log('✓ FAM-1 5b: householdHasProgram counts a live legacy block, never a template one');
}

// ── FAM-1 step 4a-ii ────────────────────────────────────────────────────────────────────────────────

/** Sessions whose workout is in ANOTHER household than the session's profile (A2 §6). Runbook pre-flight (f). */
async function sessionsOnForeignWorkouts(tx: VerifyTx): Promise<number[]> {
  const res = await tx.execute(sql`
    SELECT s.id FROM sessions s
      JOIN profiles p ON p.id = s.profile_id
      JOIN workouts w ON w.id = s.workout_id
      JOIN program_blocks b ON b.id = w.block_id
     WHERE p.household_id <> b.household_id`);
  return idsOf(res);
}

/** Entries whose prescription is in ANOTHER household than the entry's profile (A3). Runbook pre-flight (g). */
async function entriesOnForeignPrescriptions(tx: VerifyTx): Promise<number[]> {
  const res = await tx.execute(sql`
    SELECT e.id FROM entries e
      JOIN profiles p ON p.id = e.profile_id
      JOIN prescriptions pr ON pr.id = e.prescription_id
      JOIN program_blocks b ON b.id = pr.block_id
     WHERE p.household_id <> b.household_id`);
  return idsOf(res);
}

/** Sessions naming a workout whose type is not `workout` (D6). Not a CHECK: A2 §6 does not authorize one. */
async function workoutSessionsOfAnotherType(tx: VerifyTx): Promise<number[]> {
  const rows = await tx
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(
      sql`${schema.sessions.workoutId} is not null and ${schema.sessions.sessionType} is distinct from ${SESSION_TYPE.workout}`,
    );
  return rows.map((r) => r.id);
}

/** Sessions naming a workout that also carry a `day_role` (A2 §6: it stays NULL on a template session). */
async function workoutSessionsWithADayRole(tx: VerifyTx): Promise<number[]> {
  const rows = await tx
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(
      sql`${schema.sessions.workoutId} is not null and ${schema.sessions.dayRole} is not null`,
    );
  return rows.map((r) => r.id);
}

async function verifyStep4aii({ A_SCOPE, B_SCOPE }: VerifyContext): Promise<void> {
  // ── (a) the bounds are pinned to their consts ─────────────────────────────────────────────────────
  await assertUpperBoundIs('sessions_workout_name_length_check', WORKOUT_NAME_MAX);
  await assertUpperBoundIs('supersets_prescription_group_length_check', SLOT_LABEL_MAX);
  await assertUpperBoundIs('entries_prescription_set_check', MAX_SETS_PER_MOVEMENT);

  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    // A template block and workout in A, and a prescription in that block; an existing strength
    // entry in a session is the template every probe row is cloned from, so each probe changes only
    // the columns it is about.
    const mkWorkout = async (scope: typeof A_SCOPE, slug: string) => {
      const blockId = await mkTemplateBlock(exec, scope, slug);
      const w = (await insertWorkoutOwnedBy(exec, scope, {
        blockId,
        clientId: newId(),
        name: 'Push day',
        description: null,
      }))!;
      return { blockId, workoutId: w.id };
    };
    const a = await mkWorkout(A_SCOPE, 'fam-1-4a-ii-a');

    const entryBase = await probeEntryBase(tx, a.blockId, 'FAM-1 4a-ii');
    const profileId = entryBase.profileId;
    const [{ householdId: entryHousehold }] = await tx
      .select({ householdId: schema.profiles.householdId })
      .from(schema.profiles)
      .where(eq(schema.profiles.id, profileId));
    const [{ householdId: aHousehold }] = await tx
      .select({ householdId: schema.programBlocks.householdId })
      .from(schema.programBlocks)
      .where(eq(schema.programBlocks.id, a.blockId));
    // The template entry's household must be A's, or the "foreign" audits below would be measuring
    // the wrong boundary.
    assert.equal(entryHousehold, aHousehold, "FAM-1 4a-ii: the probe entry is in A's household");

    // A TEMPLATE row (FAM-1 4b): its workout and a client_id, no day_role, the shape step 11b links
    // a logged row to. (A day-role row on a template block is legal, but it is the shape 4b flags.)
    const prescription = async (w: { blockId: number; workoutId: number }, idx: number) => {
      const [row] = await tx
        .insert(schema.prescriptions)
        .values({
          publicId: newId(),
          blockId: w.blockId,
          workoutId: w.workoutId,
          clientId: newId(),
          movementId: entryBase.movementId!,
          idx,
        })
        .returning({ id: schema.prescriptions.id });
      return row.id;
    };
    const pA = await prescription(a, 900);

    const session = (over: Partial<typeof schema.sessions.$inferInsert> = {}) =>
      tx
        .insert(schema.sessions)
        .values({
          publicId: newId(),
          clientId: newId(),
          profileId,
          activityDate: '2026-11-16',
          sessionType: SESSION_TYPE.workout,
          workoutId: a.workoutId,
          workoutName: 'Push day',
          ...over,
        })
        .returning({ id: schema.sessions.id });
    const entry = (over: Partial<typeof schema.entries.$inferInsert>) =>
      tx
        .insert(schema.entries)
        .values({
          ...entryBase,
          publicId: newId(),
          clientId: newId(),
          supersetId: null,
          supersetOrder: null,
          ...over,
        })
        .returning({ id: schema.entries.id });

    // ── (b) the session append arbiter, and the frozen name ────────────────────────────────────────
    const [s1] = await session();
    await expectRejectedBy(SESSION_WORKOUT_DAY_UNIQUE_INDEX, () => session(), tx);
    await session({ activityDate: '2026-11-17' }); // another day: accepted
    // Each key column is load-bearing: the same day with ANOTHER workout, and the same day and workout
    // for ANOTHER athlete, are both accepted (an index keyed on fewer columns would refuse them).
    const w2 = (await insertWorkoutOwnedBy(exec, A_SCOPE, {
      blockId: a.blockId,
      clientId: newId(),
      name: 'Pull day',
      description: null,
    }))!;
    await session({ workoutId: w2.id, workoutName: 'Pull day' });
    const [sibling] = await tx
      .select({ id: schema.profiles.id })
      .from(schema.profiles)
      .where(
        sql`${schema.profiles.householdId} = ${aHousehold} and ${schema.profiles.id} <> ${profileId} and ${schema.profiles.deletedAt} is null`,
      )
      .orderBy(schema.profiles.id)
      .limit(1);
    assert.ok(sibling, 'FAM-1 4a-ii: a second athlete exists in the household');
    await session({ profileId: sibling.id });
    await expectRejectedBy(
      'sessions_workout_name_length_check',
      () => session({ activityDate: '2026-11-18', workoutName: '  ' }),
      tx,
    );
    await expectRejectedBy(
      'sessions_workout_named_check',
      () => session({ activityDate: '2026-11-18', workoutName: null }),
      tx,
    );
    await expectRejectedBy(
      'sessions_workout_name_length_check',
      () => session({ activityDate: '2026-11-18', workoutName: astral(WORKOUT_NAME_MAX + 1) }),
      tx,
    );
    const [hiddenDay] = await session({ activityDate: '2026-11-19' });
    await tx
      .update(schema.sessions)
      .set({ deletedAt: new Date() })
      .where(eq(schema.sessions.id, hiddenDay.id));
    await session({ activityDate: '2026-11-19' }); // a hidden session frees its place

    // ── (c) the superset append arbiter ─────────────────────────────────────────────────────────────
    const superset = (over: Partial<typeof schema.supersets.$inferInsert> = {}) =>
      tx
        .insert(schema.supersets)
        .values({
          publicId: newId(),
          clientId: newId(),
          sessionId: s1.id,
          prescriptionGroup: 'A',
          ...over,
        })
        .returning({ id: schema.supersets.id });
    const [ss] = await superset();
    await expectRejectedBy(SUPERSET_PRESCRIPTION_GROUP_UNIQUE_INDEX, () => superset(), tx);
    const [ssB] = await superset({ prescriptionGroup: 'B' }); // another group: accepted
    await tx
      .update(schema.supersets)
      .set({ deletedAt: new Date() })
      .where(eq(schema.supersets.id, ssB.id));
    await assert.doesNotReject(
      tx.transaction(async (sp) => {
        await sp.insert(schema.supersets).values({
          publicId: newId(),
          clientId: newId(),
          sessionId: s1.id,
          prescriptionGroup: 'B',
        });
      }),
      'FAM-1 4a-ii: a hidden superset frees its group',
    );
    await expectRejectedBy(
      'supersets_prescription_group_length_check',
      () => superset({ prescriptionGroup: ' ' }),
      tx,
    );

    // ── (d) the row arbiter, and the one-way CHECKs ─────────────────────────────────────────────────
    const linked = { sessionId: s1.id, prescriptionId: pA, prescriptionSet: 1 };
    const [e1] = await entry(linked);
    await expectRejectedBy(ENTRY_PRESCRIPTION_SET_UNIQUE_INDEX, () => entry(linked), tx); // a second device's ✓
    await entry({ ...linked, prescriptionSet: 2 }); // the next set: accepted
    await tx
      .update(schema.entries)
      .set({ deletedAt: new Date() })
      .where(eq(schema.entries.id, e1.id));
    await assert.doesNotReject(
      tx.transaction(async (sp) => {
        await sp.insert(schema.entries).values({
          ...entryBase,
          publicId: newId(),
          clientId: newId(),
          supersetId: null,
          supersetOrder: null,
          ...linked,
        });
      }),
      'FAM-1 4a-ii: a hidden row frees its place in the row arbiter',
    );
    await expectRejectedBy(
      'entries_prescription_needs_set_check',
      () => entry({ sessionId: s1.id, prescriptionId: pA, prescriptionSet: null }),
      tx,
    );
    await expectRejectedBy(
      'entries_prescription_needs_session_check',
      () => entry({ sessionId: null, prescriptionId: pA, prescriptionSet: 3 }),
      tx,
    );
    await expectRejectedBy(
      'entries_prescription_set_check',
      () => entry({ ...linked, prescriptionSet: 0 }),
      tx,
    );
    await expectRejectedBy(
      'entries_prescription_set_check',
      () => entry({ ...linked, prescriptionSet: MAX_SETS_PER_MOVEMENT + 1 }),
      tx,
    );

    // ── (e) two sets of one superset member commit, and so does purging their prescription ──────────
    const pB = await prescription(a, 901);
    const member = { sessionId: s1.id, prescriptionId: pB, supersetId: ss.id, supersetOrder: 0 };
    await tx.insert(schema.entries).values({
      ...entryBase,
      publicId: newId(),
      clientId: newId(),
      ...member,
      prescriptionSet: 1,
    });
    await assert.doesNotReject(
      tx.transaction(async (sp) => {
        await sp.insert(schema.entries).values({
          ...entryBase,
          publicId: newId(),
          clientId: newId(),
          ...member,
          prescriptionSet: 2,
        });
      }),
      'FAM-1 4a-ii: two sets of one superset member commit (the superset-order index skips linked rows)',
    );
    // ADR 0008's purge: the prescription goes, its entries keep their snapshot and their set number,
    // and SET NULL leaves both rows at one superset place, which the recreated index must allow.
    await assert.doesNotReject(
      tx.transaction(async (sp) => {
        await sp.delete(schema.prescriptions).where(eq(schema.prescriptions.id, pB));
      }),
      'FAM-1 4a-ii: a purge with two logged sets of one superset member commits',
    );
    const kept = await tx
      .select({
        prescriptionId: schema.entries.prescriptionId,
        set: schema.entries.prescriptionSet,
      })
      .from(schema.entries)
      .where(eq(schema.entries.supersetId, ss.id));
    assert.deepEqual(
      kept.map((k) => [k.prescriptionId, k.set]).sort(),
      [
        [null, 1],
        [null, 2],
      ],
      'FAM-1 4a-ii: a purge clears the prescription and keeps each set number',
    );

    // ── (f) flagged: the cross-household pointers no constraint stops ───────────────────────────────
    assert.deepEqual(
      await sessionsOnForeignWorkouts(tx),
      [],
      "FAM-1 4a-ii: no session names another household's workout",
    );
    assert.deepEqual(
      await entriesOnForeignPrescriptions(tx),
      [],
      "FAM-1 4a-ii: no entry names another household's prescription",
    );
    assert.deepEqual(
      await workoutSessionsOfAnotherType(tx),
      [],
      'FAM-1 4a-ii: every session naming a workout is of type workout',
    );
    const bLive = await mkWorkout(B_SCOPE, 'fam-1-4a-ii-b2');
    const pForeign = await prescription(bLive, 902);
    const [foreignSession] = await session({
      activityDate: '2026-11-20',
      workoutId: bLive.workoutId,
    });
    const [foreignEntry] = await entry({
      sessionId: s1.id,
      prescriptionId: pForeign,
      prescriptionSet: 1,
    });
    const [otherType] = await session({
      activityDate: '2026-11-21',
      sessionType: SESSION_TYPES[0],
    });
    // The NULL branch: `<>` would miss this one; `IS DISTINCT FROM` flags it.
    const [noType] = await session({ activityDate: '2026-11-22', sessionType: null });
    const [withRole] = await session({ activityDate: '2026-11-23', dayRole: 'strength' });
    assert.deepEqual(
      await sessionsOnForeignWorkouts(tx),
      [foreignSession.id],
      "FAM-1 4a-ii: a session on another household's workout is flagged",
    );
    assert.deepEqual(
      await entriesOnForeignPrescriptions(tx),
      [foreignEntry.id],
      "FAM-1 4a-ii: an entry on another household's prescription is flagged",
    );
    assert.deepEqual(
      (await workoutSessionsOfAnotherType(tx)).sort((x, y) => x - y),
      [otherType.id, noType.id].sort((x, y) => x - y),
      'FAM-1 4a-ii: a workout session of another type, or of no type, is flagged',
    );
    assert.deepEqual(
      await workoutSessionsWithADayRole(tx),
      [withRole.id],
      'FAM-1 4a-ii: a workout session with a day role is flagged',
    );
  });
  console.log(
    "✓ FAM-1 4a-ii: the session, superset and row arbiters each refuse a twin and free a hidden place; each varies one key column at a time; a linked row names its set and has a session; two sets of one superset member commit, and so does their prescription's purge; cross-household pointers, a workout session of another or no type, and one with a day role are each flagged",
  );

  // ── (g) a purged workout leaves its session with the frozen name ──────────────────────────────────
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    const clientId = newId();
    await insertProgramBlockOwnedBy(exec, A_SCOPE, {
      clientId,
      slug: 'fam-1-4a-ii-purge',
      name: 'P',
      notes: null,
    });
    const blockId = (await programBlockByClientId(exec, A_SCOPE, clientId))!.id;
    const w = (await insertWorkoutOwnedBy(exec, A_SCOPE, {
      blockId,
      clientId: newId(),
      name: 'Legs',
      description: null,
    }))!;
    const [profile] = await tx
      .select({ id: schema.profiles.id })
      .from(schema.profiles)
      .innerJoin(
        schema.programBlocks,
        eq(schema.programBlocks.householdId, schema.profiles.householdId),
      )
      .where(eq(schema.programBlocks.id, blockId))
      .orderBy(schema.profiles.id)
      .limit(1);
    const [s] = await tx
      .insert(schema.sessions)
      .values({
        publicId: newId(),
        clientId: newId(),
        profileId: profile.id,
        activityDate: '2026-11-16',
        sessionType: SESSION_TYPE.workout,
        workoutId: w.id,
        workoutName: 'Legs',
      })
      .returning({ id: schema.sessions.id });
    await tx.delete(schema.workouts).where(eq(schema.workouts.id, w.id));
    const [after] = await tx
      .select({ workoutId: schema.sessions.workoutId, workoutName: schema.sessions.workoutName })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, s.id));
    assert.deepEqual(
      after,
      { workoutId: null, workoutName: 'Legs' },
      'FAM-1 4a-ii: a purged workout leaves its session, with the frozen name',
    );
  });
  console.log(
    '✓ FAM-1 4a-ii: a purged workout leaves its session with workout_id NULL and the frozen name kept',
  );
}

// ── FAM-1 step 4b ───────────────────────────────────────────────────────────────────────────────────

/**
 * Linked entries whose prescription is not in the workout their session names (plan §5 row 4b, owed
 * by 4a-ii's review): a legacy prescription, a session naming no workout, or another workout. With
 * `prescriptions.workout_id` in place, this is what stops a twin filed under another session, which
 * the row arbiter cannot see. Hidden rows are NOT excluded: a hidden mismatch is still a defect.
 * Against production the same query is run by hand (read-only).
 */
async function entriesOnAnotherWorkoutsPrescriptions(tx: VerifyTx): Promise<number[]> {
  const res = await tx.execute(sql`
    SELECT e.id FROM entries e
      JOIN sessions s ON s.id = e.session_id
      JOIN prescriptions pr ON pr.id = e.prescription_id
     WHERE pr.workout_id IS NULL OR pr.workout_id IS DISTINCT FROM s.workout_id
     ORDER BY e.id`);
  return idsOf(res);
}

/**
 * Prescriptions on a TEMPLATE block with no workout (A2 §4, §10: "a template prescription with a
 * `day_role` is refused and flagged"). The XOR cannot see the block's kind, so this is the "flagged"
 * half; step 6a's writer is the "refused" half. Run by hand against production too.
 */
async function prescriptionsWithoutAWorkoutOnTemplateBlocks(tx: VerifyTx): Promise<number[]> {
  const res = await tx.execute(sql`
    SELECT pr.id FROM prescriptions pr
      JOIN program_blocks b ON b.id = pr.block_id
     WHERE b.kind = ${PROGRAM_BLOCK_KIND.template} AND pr.workout_id IS NULL
     ORDER BY pr.id`);
  return idsOf(res);
}

/**
 * Prescribed quantities on a LEGACY prescription (no workout). The table is a template item's
 * targets (D2); a legacy row's are `prescription_targets`. Nothing refuses one, so it is flagged.
 */
async function quantitiesOnLegacyPrescriptions(tx: VerifyTx): Promise<number[]> {
  const res = await tx.execute(sql`
    SELECT q.id FROM prescription_quantities q
      JOIN prescriptions pr ON pr.id = q.prescription_id
     WHERE pr.workout_id IS NULL
     ORDER BY q.id`);
  return idsOf(res);
}

async function verifyStep4b({ A_SCOPE }: VerifyContext): Promise<void> {
  // ── (a) shapes, and every bound pinned to its shared const ────────────────────────────────────────
  assert.equal(
    (await columnCatalogShape('prescriptions', 'day_role'))?.is_nullable,
    'YES',
    'FAM-1 4b: prescriptions.day_role is nullable (the XOR replaces NOT NULL)',
  );
  await assertUpperBoundIs('prescriptions_notes_length_check', FREE_TEXT_NOTE_MAX);
  await assertUpperBoundIs('prescriptions_rest_after_length_check', SLOT_LABEL_MAX);
  await assertUpperBoundIs('prescriptions_superset_label_length_check', SLOT_LABEL_MAX);
  await assertUpperBoundIs('prescriptions_target_reps_length_check', TARGET_REPS_MAX);
  await assertUpperBoundIs('prescriptions_sets_max_check', MAX_SETS_PER_MOVEMENT);
  await assertUpperBoundIs('prescriptions_superset_order_check', MAX_WORKOUT_ITEMS);
  // 🔴 11b copies superset_label into supersets.prescription_group: the two CHECKs must be the SAME
  // expression, not merely the same bound, or the ✓ fails with 23514 (plan §3 row 4b).
  assert.equal(
    (await constraintDef('prescriptions_superset_label_length_check')).replaceAll(
      'superset_label',
      'prescription_group',
    ),
    await constraintDef('supersets_prescription_group_length_check'),
    "FAM-1 4b: superset_label's CHECK is exactly supersets.prescription_group's",
  );
  console.log(
    '✓ FAM-1 4b: day_role is nullable; the six new bounds are pinned to their consts, and superset_label is bounded exactly as prescription_group is',
  );

  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    assert.deepEqual(
      await entriesOnAnotherWorkoutsPrescriptions(tx),
      [],
      "FAM-1 4b: on the seeded database, no entry names a prescription outside its session's workout",
    );
    assert.deepEqual(
      await prescriptionsWithoutAWorkoutOnTemplateBlocks(tx),
      [],
      'FAM-1 4b: on the seeded database, no template block holds a prescription without a workout',
    );
    assert.deepEqual(
      await quantitiesOnLegacyPrescriptions(tx),
      [],
      'FAM-1 4b: on the seeded database, no legacy prescription has a prescribed quantity',
    );

    // A template block with two workouts, and a second template block with one.
    const mkBlock = (slug: string) => mkTemplateBlock(exec, A_SCOPE, slug);
    const mkWorkout = async (blockId: number, name: string) =>
      (await insertWorkoutOwnedBy(exec, A_SCOPE, {
        blockId,
        clientId: newId(),
        name,
        description: null,
      }))!.id;
    const blockA = await mkBlock('fam-1-4b-a');
    const w1 = await mkWorkout(blockA, 'Push day');
    const w2 = await mkWorkout(blockA, 'Pull day');
    const blockB = await mkBlock('fam-1-4b-b');
    const w3 = await mkWorkout(blockB, 'Legs day');
    const [{ movementId }] = await tx
      .select({ movementId: schema.prescriptions.movementId })
      .from(schema.prescriptions)
      .orderBy(schema.prescriptions.id)
      .limit(1);
    const [legacy] = await tx
      .select({ id: schema.programBlocks.id })
      .from(schema.programBlocks)
      .where(eq(schema.programBlocks.kind, PROGRAM_BLOCK_KIND.legacy))
      .orderBy(schema.programBlocks.id)
      .limit(1);

    type PrescriptionInsert = typeof schema.prescriptions.$inferInsert;
    const tpl = (over: Partial<PrescriptionInsert> = {}) =>
      tx
        .insert(schema.prescriptions)
        .values({
          publicId: newId(),
          blockId: blockA,
          workoutId: w1,
          clientId: newId(),
          movementId,
          idx: 0,
          ...over,
        })
        .returning({ id: schema.prescriptions.id, clientId: schema.prescriptions.clientId });
    const legacyRow = (over: Partial<PrescriptionInsert> & { idx: number }) =>
      tx
        .insert(schema.prescriptions)
        .values({ publicId: newId(), blockId: legacy.id, dayRole: 'strength', movementId, ...over })
        .returning({ id: schema.prescriptions.id });

    // ── (b) the XOR, the client_id CHECK and the composite FK ──────────────────────────────────────
    const [p0] = await tpl();
    await expectRejectedBy(
      'prescriptions_day_role_xor_workout_check',
      () => tpl({ idx: 1, dayRole: 'strength' }),
      tx,
    );
    await expectRejectedBy(
      'prescriptions_day_role_xor_workout_check',
      () => legacyRow({ idx: 960, dayRole: null }),
      tx,
    );
    await expectRejectedBy(
      'prescriptions_template_client_id_check',
      () => tpl({ idx: 1, clientId: null }),
      tx,
    );
    await expectRejectedBy(
      'prescriptions_template_client_id_check',
      () => legacyRow({ idx: 960, clientId: newId() }),
      tx,
    );
    // A workout of ANOTHER block: the block a row names is its workout's, by the composite FK.
    await expectRejectedBy(
      'prescriptions_workout_block_fkey',
      () => tpl({ idx: 1, workoutId: w3 }),
      tx,
    );
    console.log(
      '✓ FAM-1 4b: a row names a day_role or a workout, exactly one; a template row has a client_id and a legacy row none; a workout of another block is refused',
    );

    // ── (c) the slot key, the client_id key, and a reorder through a band ──────────────────────────
    await expectRejectedBy(PRESCRIPTION_WORKOUT_SLOT_UNIQUE_INDEX, () => tpl({ idx: 0 }), tx);
    await tpl({ idx: 0, workoutId: w2 }); // same idx, another workout of the SAME block: accepted
    await tx
      .update(schema.prescriptions)
      .set({ deletedAt: new Date() })
      .where(eq(schema.prescriptions.id, p0.id));
    await assert.doesNotReject(
      tx.transaction(async () => {
        await tpl({ idx: 0 });
      }),
      'FAM-1 4b: a hidden row frees its slot',
    );
    // The client_id key: a twin in one workout is refused, even once its holder is HIDDEN (p0 is),
    // and the same id in another workout is accepted.
    await expectRejectedBy(
      PRESCRIPTION_WORKOUT_CLIENT_ID_UNIQUE_INDEX,
      () => tpl({ idx: 2, clientId: p0.clientId }),
      tx,
    );
    await tpl({ idx: 2, workoutId: w2, clientId: p0.clientId });
    // A reorder: swapping two places directly is refused (why 6a's shift-band exists); shifting both
    // up a band and back commits, and each row keeps its id and client_id.
    const [r1] = await tpl({ idx: 10 });
    const [r2] = await tpl({ idx: 11 });
    await expectRejectedBy(
      PRESCRIPTION_WORKOUT_SLOT_UNIQUE_INDEX,
      () =>
        tx.update(schema.prescriptions).set({ idx: 11 }).where(eq(schema.prescriptions.id, r1.id)),
      tx,
    );
    await tx
      .update(schema.prescriptions)
      .set({ idx: sql`${schema.prescriptions.idx} + 100` })
      .where(inArray(schema.prescriptions.id, [r1.id, r2.id]));
    await tx
      .update(schema.prescriptions)
      .set({ idx: 11 })
      .where(eq(schema.prescriptions.id, r1.id));
    await tx
      .update(schema.prescriptions)
      .set({ idx: 10 })
      .where(eq(schema.prescriptions.id, r2.id));
    const swapped = await tx
      .select({
        id: schema.prescriptions.id,
        idx: schema.prescriptions.idx,
        clientId: schema.prescriptions.clientId,
      })
      .from(schema.prescriptions)
      .where(inArray(schema.prescriptions.id, [r1.id, r2.id]))
      .orderBy(schema.prescriptions.idx);
    assert.deepEqual(
      swapped,
      [
        { id: r2.id, idx: 10, clientId: r2.clientId },
        { id: r1.id, idx: 11, clientId: r1.clientId },
      ],
      'FAM-1 4b: a reorder through a band keeps each row and its client_id',
    );
    console.log(
      '✓ FAM-1 4b: one live row per workout place (a hidden row frees it); a client_id is unique in its workout, hidden or not, and free in another; a reorder through a band keeps rows',
    );

    // ── (d) the text and number bounds; the template-only ones leave legacy rows alone ─────────────
    const at = (n: number) => 'x'.repeat(n);
    const group = { supersetLabel: 'a', supersetOrder: 1 };
    await tpl({ idx: 20, notes: at(FREE_TEXT_NOTE_MAX) });
    await expectRejectedBy(
      'prescriptions_notes_length_check',
      () => tpl({ idx: 21, notes: at(FREE_TEXT_NOTE_MAX + 1) }),
      tx,
    );
    await expectRejectedBy(
      'prescriptions_notes_length_check',
      () => tpl({ idx: 21, notes: '  ' }),
      tx,
    );
    await tpl({
      idx: 21,
      ...group,
      supersetLabel: at(SLOT_LABEL_MAX),
      restAfter: at(SLOT_LABEL_MAX),
    });
    await expectRejectedBy(
      'prescriptions_superset_label_length_check',
      () => tpl({ idx: 22, ...group, supersetLabel: at(SLOT_LABEL_MAX + 1) }),
      tx,
    );
    await expectRejectedBy(
      'prescriptions_rest_after_length_check',
      () => tpl({ idx: 22, ...group, restAfter: at(SLOT_LABEL_MAX + 1) }),
      tx,
    );
    // Never blank: 12a's DayPlan parses `restAfter` as a non-empty short text.
    await expectRejectedBy(
      'prescriptions_rest_after_length_check',
      () => tpl({ idx: 22, ...group, restAfter: ' ' }),
      tx,
    );
    await tpl({ idx: 22, targetReps: at(TARGET_REPS_MAX), sets: MAX_SETS_PER_MOVEMENT });
    await expectRejectedBy(
      'prescriptions_target_reps_length_check',
      () => tpl({ idx: 23, targetReps: at(TARGET_REPS_MAX + 1) }),
      tx,
    );
    await expectRejectedBy(
      'prescriptions_target_reps_length_check',
      () => tpl({ idx: 23, targetReps: ' ' }),
      tx,
    );
    await expectRejectedBy(
      'prescriptions_sets_max_check',
      () => tpl({ idx: 23, sets: MAX_SETS_PER_MOVEMENT + 1 }),
      tx,
    );
    // 🔴 The scoping, pinned: a LEGACY row keeps the archived block's 32-character reps and its set
    // count, as production's rows do. An all-rows CHECK would fail 0025's validating scan.
    await assert.doesNotReject(
      tx.transaction(async () => {
        await legacyRow({
          idx: 961,
          targetReps: '3 (top triple, then 2 back-offs)',
          sets: MAX_SETS_PER_MOVEMENT + 1,
        });
      }),
      "FAM-1 4b: a legacy row keeps the archived block's 32-character reps and 21 sets",
    );
    await tpl({ idx: 24, supersetLabel: 'b', supersetOrder: MAX_WORKOUT_ITEMS });
    await expectRejectedBy(
      'prescriptions_superset_order_check',
      () => tpl({ idx: 23, supersetLabel: 'a', supersetOrder: 0 }),
      tx,
    );
    await expectRejectedBy(
      'prescriptions_superset_order_check',
      () => tpl({ idx: 23, supersetLabel: 'a', supersetOrder: MAX_WORKOUT_ITEMS + 1 }),
      tx,
    );
    await expectRejectedBy(
      'prescriptions_superset_pair_check',
      () => tpl({ idx: 23, supersetLabel: 'a' }),
      tx,
    );
    await expectRejectedBy(
      'prescriptions_superset_pair_check',
      () => tpl({ idx: 23, supersetOrder: 1 }),
      tx,
    );
    await expectRejectedBy(
      'prescriptions_rest_after_needs_superset_check',
      () => tpl({ idx: 23, restAfter: '90 s' }),
      tx,
    );
    console.log(
      "✓ FAM-1 4b: notes, rest, group, reps, sets and group place are bounded at their consts on template rows; a legacy row keeps the archived block's 32-character reps",
    );

    // ── (e) prescription_quantities ────────────────────────────────────────────────────────────────
    const [pq] = await tpl({ idx: 30 });
    type QuantityInsert = typeof schema.prescriptionQuantities.$inferInsert;
    const quantity = (over: Partial<QuantityInsert> = {}) =>
      tx
        .insert(schema.prescriptionQuantities)
        .values({
          prescriptionId: pq.id,
          slot: QUANTITY_SLOT.primary,
          dimension: UNIT_DIMENSION_BY_CODE.lb,
          unit: 'lb',
          valueMin: null,
          ...over,
        })
        .returning({ id: schema.prescriptionQuantities.id });
    // Every (slot, unit) a tracking type can prescribe is writable: a pair missing from
    // quantity_slots would otherwise first show as a 23503 inside 6a's writer.
    for (const type of TRACKING_TYPES) {
      const { slot } = TRACKING_TYPE_FIELDS[type];
      if (!slot) continue;
      for (const unit of unitsForTrackingType(type)) {
        const [row] = await quantity({ slot, unit, dimension: UNIT_DIMENSION_BY_CODE[unit] });
        await tx
          .delete(schema.prescriptionQuantities)
          .where(eq(schema.prescriptionQuantities.id, row.id));
      }
    }
    await expectRejectedBy(
      'prescription_quantities_unit_dimension_fkey',
      () => quantity({ unit: 'in' }), // a length unit on a mass quantity
      tx,
    );
    await expectRejectedBy(
      'prescription_quantities_slot_dimension_fkey',
      () => quantity({ slot: QUANTITY_SLOT.distance }), // a mass on the distance slot
      tx,
    );
    const [q1] = await quantity(); // value_min NULL: "log in this unit, no target"
    await expectRejectedBy(PRESCRIPTION_QUANTITY_SLOT_UNIQUE_INDEX, () => quantity(), tx);
    await tx
      .update(schema.prescriptionQuantities)
      .set({ deletedAt: new Date() })
      .where(eq(schema.prescriptionQuantities.id, q1.id));
    await assert.doesNotReject(
      tx.transaction(async () => {
        await quantity({ valueMin: '95', valueMax: '115' }); // a range, once the hidden row freed the slot
      }),
      'FAM-1 4b: a hidden quantity frees its slot',
    );
    const one = {
      slot: QUANTITY_SLOT.distance,
      dimension: UNIT_DIMENSION_BY_CODE.yd,
      unit: 'yd' as const,
    };
    await expectRejectedBy(
      'prescription_quantities_value_min_check',
      () => quantity({ ...one, valueMin: '-1' }),
      tx,
    );
    await expectRejectedBy(
      'prescription_quantities_value_min_check',
      () => quantity({ ...one, valueMin: 'NaN' }),
      tx,
    );
    await expectRejectedBy(
      'prescription_quantities_value_max_check',
      () => quantity({ ...one, valueMin: '10', valueMax: '5' }),
      tx,
    );
    await expectRejectedBy(
      'prescription_quantities_value_max_check',
      () => quantity({ ...one, valueMin: null, valueMax: '5' }),
      tx,
    );
    // `'NaN' >= value_min` is TRUE in Postgres, so this arm is load-bearing on its own.
    await expectRejectedBy(
      'prescription_quantities_value_max_check',
      () => quantity({ ...one, valueMin: '10', valueMax: 'NaN' }),
      tx,
    );
    // Both ends the contract accepts are storable (`quantityValueSchema`: 0 … MAX_STORABLE_QUANTITY,
    // which is what numeric(8,3) holds), so a value the editor offers never fails the insert.
    await assert.doesNotReject(
      tx.transaction(async () => {
        const [zero] = await quantity({ ...one, valueMin: '0' });
        await tx
          .delete(schema.prescriptionQuantities)
          .where(eq(schema.prescriptionQuantities.id, zero.id));
        const top = String(MAX_STORABLE_QUANTITY);
        await quantity({ ...one, valueMin: top, valueMax: top });
      }),
      'FAM-1 4b: a quantity stores 0 and MAX_STORABLE_QUANTITY',
    );
    console.log(
      '✓ FAM-1 4b: every prescribable (slot, unit) is writable; a unit or slot of the wrong dimension is refused; one live quantity per slot (a hidden one frees it); a negative, NaN, inverted or half range is refused; 0 and the storable maximum are accepted',
    );

    // ── (f) the audits, each branch with its own control ───────────────────────────────────────────
    const entryBase = await probeEntryBase(tx, blockA, 'FAM-1 4b');
    let day = 0;
    const FROZEN_NAME = 'Push day'; // the name every probe session freezes, asserted after the purge
    const sessionOn = async (workoutId: number | null) => {
      day += 1;
      const [row] = await tx
        .insert(schema.sessions)
        .values({
          publicId: newId(),
          clientId: newId(),
          profileId: entryBase.profileId,
          activityDate: `2026-12-${String(day).padStart(2, '0')}`,
          sessionType: workoutId === null ? SESSION_TYPES[0] : SESSION_TYPE.workout,
          workoutId,
          workoutName: workoutId === null ? null : FROZEN_NAME,
        })
        .returning({ id: schema.sessions.id });
      return row.id;
    };
    type EntryInsert = typeof schema.entries.$inferInsert;
    const linked = async (
      sessionId: number,
      prescriptionId: number,
      over: Partial<EntryInsert> = {},
    ) => {
      const [row] = await tx
        .insert(schema.entries)
        .values({
          ...entryBase,
          publicId: newId(),
          clientId: newId(),
          supersetId: null,
          supersetOrder: null,
          sessionId,
          prescriptionId,
          prescriptionSet: 1,
          ...over,
        })
        .returning({ id: schema.entries.id });
      return row.id;
    };
    const [inW1] = await tpl({ idx: 40 });
    const [legacyP] = await legacyRow({ idx: 962 });
    const ok = await linked(await sessionOn(w1), inW1.id); // (a) its own workout: not flagged
    const otherWorkout = await linked(await sessionOn(w2), inW1.id); // (b) another workout
    const noWorkout = await linked(await sessionOn(null), inW1.id); // (c) `<>` would miss it
    const legacyLink = await linked(await sessionOn(null), legacyP.id); // (d) the IS NULL arm
    assert.deepEqual(
      await entriesOnAnotherWorkoutsPrescriptions(tx),
      [otherWorkout, noWorkout, legacyLink],
      "FAM-1 4b: an entry naming a prescription outside its session's workout is flagged, each branch",
    );
    void ok;
    const [onTemplate] = await legacyRow({ blockId: blockA, idx: 963 }); // a day-role row, but on a template block
    assert.deepEqual(
      await prescriptionsWithoutAWorkoutOnTemplateBlocks(tx),
      [onTemplate.id],
      'FAM-1 4b: a day-role row on a template block is legal to the XOR, and flagged here',
    );
    const [onLegacy] = await quantity({ prescriptionId: legacyP.id });
    assert.deepEqual(
      await quantitiesOnLegacyPrescriptions(tx),
      [onLegacy.id],
      'FAM-1 4b: a quantity on a legacy prescription is flagged',
    );
    console.log(
      "✓ FAM-1 4b: an entry outside its session's workout (another workout, none, a legacy row), a day-role row on a template block and a quantity on a legacy row are each flagged",
    );

    // ── (g) erasure and ADR 0008's purge: the order is load-bearing ────────────────────────────────
    // One child per refusal, so the constraint named is the only one that could fire.
    const blockE = await mkBlock('fam-1-4b-erase');
    const wE = await mkWorkout(blockE, 'Erase day');
    const [pE] = await tpl({ blockId: blockE, workoutId: wE, idx: 0 });
    await expectRejectedBy(
      'prescriptions_workout_block_fkey',
      () => tx.delete(schema.workouts).where(eq(schema.workouts.id, wE)),
      tx,
    );
    const [qE] = await quantity({ prescriptionId: pE.id, valueMin: '45' });
    await tx
      .update(schema.prescriptionQuantities)
      .set({ deletedAt: new Date() })
      .where(eq(schema.prescriptionQuantities.id, qE.id));
    await expectRejectedBy(
      'prescription_quantities_prescription_id_prescriptions_id_fk',
      () => tx.delete(schema.prescriptions).where(eq(schema.prescriptions.id, pE.id)),
      tx, // a HIDDEN quantity still refuses: the household delete counts and deletes hidden rows
    );
    const sE = await sessionOn(wE);
    const SNAPSHOT = '3 × 8 @ 45 lb'; // a real frozen prescription, so "kept" cannot pass on NULL = NULL
    const eE = await linked(sE, pE.id, { prescribedSnapshot: SNAPSHOT });
    // The purge, in its order: quantities, then the prescription, then the workout.
    await tx
      .delete(schema.prescriptionQuantities)
      .where(eq(schema.prescriptionQuantities.prescriptionId, pE.id));
    await tx.delete(schema.prescriptions).where(eq(schema.prescriptions.id, pE.id));
    await tx.delete(schema.workouts).where(eq(schema.workouts.id, wE));
    const [entryAfter] = await tx
      .select({
        prescriptionId: schema.entries.prescriptionId,
        set: schema.entries.prescriptionSet,
        snapshot: schema.entries.prescribedSnapshot,
      })
      .from(schema.entries)
      .where(eq(schema.entries.id, eE));
    assert.deepEqual(
      entryAfter,
      { prescriptionId: null, set: 1, snapshot: SNAPSHOT },
      'FAM-1 4b: a purged prescription leaves its entry with the set and the snapshot',
    );
    const [sessionAfter] = await tx
      .select({ workoutId: schema.sessions.workoutId, name: schema.sessions.workoutName })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sE));
    assert.deepEqual(
      sessionAfter,
      { workoutId: null, name: FROZEN_NAME },
      'FAM-1 4b: the purged workout leaves its session with the frozen name',
    );
  });
  console.log(
    "✓ FAM-1 4b: a workout with a prescription, and a prescription with a quantity (hidden or not), refuse deletion; quantities → prescription → workout commits and keeps the log's snapshot and name",
  );
}

// ── FAM-1 step 5 ────────────────────────────────────────────────────────────────────────────────────

/** Assignments to a block that is not a TEMPLATE block (A2 §1: refused by 6c's writer; flagged here). */
async function assignmentsOnLegacyBlocks(tx: VerifyTx): Promise<number[]> {
  return idsOf(
    await tx.execute(sql`
      SELECT a.id FROM program_assignments a
        JOIN program_blocks b ON b.id = a.block_id
       WHERE b.kind <> ${PROGRAM_BLOCK_KIND.template}
       ORDER BY a.id`),
  );
}

/**
 * Assignments whose athlete and program are in different households. The same join as the runbook's
 * household pre-flight (h), unscoped: (h) adds "either side in H". No `deleted_at` filter.
 */
async function assignmentsAcrossHouseholds(tx: VerifyTx): Promise<number[]> {
  return idsOf(
    await tx.execute(sql`
      SELECT a.id FROM program_assignments a
        JOIN profiles p ON p.id = a.profile_id
        JOIN program_blocks b ON b.id = a.block_id
       WHERE p.household_id <> b.household_id
       ORDER BY a.id`),
  );
}

/**
 * The LATER of two live assignments of one athlete to one program whose inclusive ranges share a day:
 * the program would be due twice that day. The keys cannot see this (the open key ignores closed rows),
 * and off-and-on-again on one day makes it in the usual case (`schema.ts` → `programAssignments`).
 * Hidden rows are excluded on purpose: a program taken off before it started is hidden, and putting it
 * on again from the same day is the normal path, not an overlap.
 */
async function assignmentsOverlapping(tx: VerifyTx): Promise<number[]> {
  return idsOf(
    await tx.execute(sql`
      SELECT DISTINCT later.id FROM program_assignments later
        JOIN program_assignments earlier
          ON earlier.profile_id = later.profile_id AND earlier.block_id = later.block_id
         AND earlier.id < later.id
         AND earlier.deleted_at IS NULL AND later.deleted_at IS NULL
         AND later.active_from <= coalesce(earlier.active_to, 'infinity'::date)
         AND earlier.active_from <= coalesce(later.active_to, 'infinity'::date)
       ORDER BY later.id`),
  );
}

/** A live assignment with no live weekday row: on a program and never due, a silent blank. */
async function assignmentsWithoutWeekdays(tx: VerifyTx): Promise<number[]> {
  return idsOf(
    await tx.execute(sql`
      SELECT a.id FROM program_assignments a
       WHERE a.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM program_assignment_weekdays w
                          WHERE w.assignment_id = a.id AND w.deleted_at IS NULL)
       ORDER BY a.id`),
  );
}

/**
 * Every table reachable from `profiles` through FKs, at any depth (a grandchild such as `entry_sets`
 * included). The per-athlete erasure must name every one: a new table one hop down is as much the
 * athlete's as one with an FK to `profiles`.
 */
async function tablesReachableFromProfiles(): Promise<string[]> {
  return rowsOf<{ t: string }>(
    await db.execute(sql`
      WITH RECURSIVE reach(t) AS (
        SELECT 'profiles'::text
        UNION
        SELECT c.conrelid::regclass::text FROM pg_constraint c
          JOIN reach r ON c.confrelid::regclass::text = r.t
         WHERE c.contype = 'f'
      )
      SELECT t FROM reach ORDER BY t`),
  ).map((r) => r.t);
}

/**
 * 🔴 **"Erase one athlete" as ONE ordered list** (FAM-1 step 5; ADR 0007 A2 §8, §10): child before
 * parent, each table with its scope. `eraseAthlete` and `athleteCounts` are generated from it, and
 * `db:verify` reads the runbook's step-4 table and step-3 count block and requires both to be exactly
 * this list, in this order (`runbookEraseAthleteLists`). No `deleted_at` filter anywhere: a hidden row
 * is still a row the erasure removes.
 */
const P_ENTRIES = (p: number) => sql`(SELECT id FROM entries WHERE profile_id = ${p})`;
const P_SESSIONS = (p: number) => sql`(SELECT id FROM sessions WHERE profile_id = ${p})`;
const P_ASSIGNMENTS = (p: number) =>
  sql`(SELECT id FROM program_assignments WHERE profile_id = ${p})`;
const ERASE_ATHLETE = [
  {
    table: 'entry_set_quantities',
    scope: (p: number) =>
      sql`entry_set_id IN (SELECT id FROM entry_sets WHERE entry_id IN ${P_ENTRIES(p)})`,
  },
  { table: 'entry_sets', scope: (p: number) => sql`entry_id IN ${P_ENTRIES(p)}` },
  { table: 'entries', scope: (p: number) => sql`profile_id = ${p}` },
  { table: 'supersets', scope: (p: number) => sql`session_id IN ${P_SESSIONS(p)}` },
  { table: 'sessions', scope: (p: number) => sql`profile_id = ${p}` },
  { table: 'day_readiness', scope: (p: number) => sql`profile_id = ${p}` },
  { table: 'ramp_targets', scope: (p: number) => sql`profile_id = ${p}` },
  { table: 'prescription_targets', scope: (p: number) => sql`profile_id = ${p}` },
  {
    table: 'program_assignment_weekdays',
    scope: (p: number) => sql`assignment_id IN ${P_ASSIGNMENTS(p)}`,
  },
  { table: 'program_assignments', scope: (p: number) => sql`profile_id = ${p}` },
  { table: 'profiles', scope: (p: number) => sql`id = ${p}` },
] as const;
const ERASE_ATHLETE_TABLES = ERASE_ATHLETE.map((r) => r.table);

async function eraseAthlete(tx: VerifyTx, p: number): Promise<void> {
  for (const { table, scope } of ERASE_ATHLETE) {
    await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE ${scope(p)}`);
  }
}

/** One athlete's row count in each table the erasure names (no `deleted_at` filter). */
async function athleteCounts(tx: VerifyTx, p: number): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const { table, scope } of ERASE_ATHLETE) {
    const [row] = rowsOf<{ n: number }>(
      await tx.execute(
        sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE ${scope(p)}`,
      ),
    );
    counts[table] = Number(row.n);
  }
  return counts;
}

/** The runbook's "Erase one athlete": its step-4 table, and the labels of its step-3 count block. */
function runbookEraseAthleteLists(): { order: string[]; counted: string[] } {
  const file = readFileSync(new URL('../../../../docs/runbooks.md', import.meta.url), 'utf8');
  const start = file.indexOf('## Erase one athlete');
  assert.ok(start >= 0, 'FAM-1 5: the runbook has an "Erase one athlete" section');
  const section = file.slice(start, file.indexOf('\n---', start));
  const order = [...section.matchAll(/^\| \d+ +\| `([a-z_]+)` +\|/gm)].map((m) => m[1]);
  const countBlock = section.slice(section.indexOf('```sql'), section.indexOf('-- PRE-FLIGHT'));
  const counted = [...countBlock.matchAll(/SELECT '([a-z_]+)'/g)].map((m) => m[1]);
  return { order, counted };
}

/**
 * The runbook's report: TEMPLATE blocks of P's household every one of whose assignment rows (open,
 * closed or hidden) is P's. The household is asked keep-or-remove for each. Scoped to the household,
 * so a stray assignment to another family's block never offers that family's program for removal.
 */
async function blocksOnlyThisAthleteWasOn(tx: VerifyTx, p: number, h: number): Promise<number[]> {
  return idsOf(
    await tx.execute(sql`
      SELECT b.id FROM program_blocks b
       WHERE b.kind = ${PROGRAM_BLOCK_KIND.template} AND b.household_id = ${h}
         AND EXISTS (SELECT 1 FROM program_assignments a WHERE a.block_id = b.id)
         AND NOT EXISTS (SELECT 1 FROM program_assignments a
                          WHERE a.block_id = b.id AND a.profile_id <> ${p})
       ORDER BY b.id`),
  );
}

/** Pre-flight: another athlete's entry in this athlete's session OR superset (the delete would abort). */
async function strayEntriesInAthletesSessions(tx: VerifyTx, p: number): Promise<number[]> {
  return idsOf(
    await tx.execute(sql`
      SELECT e.id FROM entries e
       WHERE e.profile_id <> ${p}
         AND (e.session_id IN (SELECT id FROM sessions WHERE profile_id = ${p})
              OR e.superset_id IN (SELECT ss.id FROM supersets ss
                                     JOIN sessions s ON s.id = ss.session_id
                                    WHERE s.profile_id = ${p}))
       ORDER BY e.id`),
  );
}

/**
 * Pre-flight: P's rows that point at ANOTHER household's program (a target on its prescription, an
 * assignment to its block). Deleting by `profile_id = P` would remove a row tied to that family's data;
 * no writer makes one, and the household delete's (a) and (h) stop on the same shape. Must be 0.
 */
async function athleteRowsOnAnotherHouseholdsProgram(tx: VerifyTx, p: number): Promise<number[]> {
  return idsOf(
    await tx.execute(sql`
      SELECT t.id FROM prescription_targets t
        JOIN prescriptions x ON x.id = t.prescription_id
        JOIN program_blocks b ON b.id = x.block_id
        JOIN profiles pr ON pr.id = t.profile_id
       WHERE t.profile_id = ${p} AND b.household_id <> pr.household_id
      UNION ALL
      SELECT a.id FROM program_assignments a
        JOIN program_blocks b ON b.id = a.block_id
        JOIN profiles pr ON pr.id = a.profile_id
       WHERE a.profile_id = ${p} AND b.household_id <> pr.household_id
       ORDER BY 1`),
  );
}

/**
 * Pre-flight for the optional "remove a program only P was on": another athlete's rows that point at
 * those blocks without an assignment (A2 §7: doing someone else's workout creates none). The block's
 * delete would SET NULL a sibling's `sessions.workout_id` and `entries.prescription_id` silently, or
 * abort on their target or a copy in another program. Must be 0, or the household is told first.
 */
async function othersOnTheseBlocks(tx: VerifyTx, p: number, blocks: number[]): Promise<number[]> {
  if (blocks.length === 0) return [];
  const ids = sql.join(
    blocks.map((b) => sql`${b}`),
    sql`, `,
  );
  return idsOf(
    await tx.execute(sql`
      SELECT s.id FROM sessions s JOIN workouts w ON w.id = s.workout_id
       WHERE w.block_id IN (${ids}) AND s.profile_id <> ${p}
      UNION ALL
      SELECT e.id FROM entries e JOIN prescriptions x ON x.id = e.prescription_id
       WHERE x.block_id IN (${ids}) AND e.profile_id <> ${p}
      UNION ALL
      SELECT t.id FROM prescription_targets t JOIN prescriptions x ON x.id = t.prescription_id
       WHERE x.block_id IN (${ids}) AND t.profile_id <> ${p}
      UNION ALL
      SELECT c.id FROM workouts c JOIN workouts src ON src.id = c.copied_from_workout_id
       WHERE src.block_id IN (${ids}) AND c.block_id NOT IN (${ids})
       ORDER BY 1`),
  );
}

/** A household of a template block just made (verify reads the household through the block). */
async function householdOfBlock(tx: VerifyTx, blockId: number): Promise<number> {
  const [{ householdId }] = await tx
    .select({ householdId: schema.programBlocks.householdId })
    .from(schema.programBlocks)
    .where(eq(schema.programBlocks.id, blockId));
  return householdId!;
}

/** An app-created kid in `householdId` (not a seeded one: the seed would re-create a seeded profile). */
async function mkKid(tx: VerifyTx, householdId: number, name: string): Promise<number> {
  const [row] = await tx
    .insert(schema.profiles)
    .values({ publicId: newId(), householdId, name, kind: PROFILE_KIND.kid })
    .returning({ id: schema.profiles.id });
  return row.id;
}

type AssignmentInsert = typeof schema.programAssignments.$inferInsert;
async function mkAssignment(
  tx: VerifyTx,
  row: Pick<AssignmentInsert, 'blockId' | 'profileId'> & Partial<AssignmentInsert>,
  weekdays: readonly number[] = [],
): Promise<number> {
  const [a] = await tx
    .insert(schema.programAssignments)
    .values({ publicId: newId(), idx: 0, activeFrom: '2026-11-02', ...row })
    .returning({ id: schema.programAssignments.id });
  for (const weekday of weekdays) {
    await tx.insert(schema.programAssignmentWeekdays).values({ assignmentId: a.id, weekday });
  }
  return a.id;
}

async function verifyStep5({ A_SCOPE, B_SCOPE }: VerifyContext): Promise<void> {
  // ── (a) shapes, the weekday CHECK pinned to WEEKDAYS, the catalog and the runbook ─────────────────
  assert.deepEqual(
    await columnCatalogShape('program_assignments', 'active_from'),
    { data_type: 'date', is_nullable: 'NO', column_default: null },
    'FAM-1 5: active_from is date NOT NULL',
  );
  assert.equal(
    (await columnCatalogShape('program_assignments', 'active_to'))?.is_nullable,
    'YES',
    'FAM-1 5: active_to is nullable (open)',
  );
  assert.equal(
    (await columnCatalogShape('program_assignment_weekdays', 'weekday'))?.data_type,
    'integer',
    'FAM-1 5: weekday is an integer',
  );
  await assertCheckCoversIntConst('program_assignment_weekdays_weekday_check', WEEKDAYS);
  // The database's own weekday agrees with `localWeekday` over a whole week, so a reader that computes
  // the weekday in SQL has the same origin (DOW, not ISODOW, whose Sunday is 7).
  for (let i = 0; i < 7; i += 1) {
    const day = `2026-10-${String(11 + i).padStart(2, '0')}`;
    const [{ d }] = rowsOf<{ d: number }>(
      await db.execute(sql`SELECT extract(dow from ${day}::date)::int AS d`),
    );
    assert.equal(
      Number(d),
      localWeekday(day),
      `FAM-1 5: Postgres's DOW and localWeekday agree on ${day}`,
    );
  }
  // Every table reachable from profiles by FK, at any depth, is one the erasure deletes.
  assert.deepEqual(
    await tablesReachableFromProfiles(),
    [...ERASE_ATHLETE_TABLES].sort(),
    'FAM-1 5: every table reachable from profiles is in the per-athlete erasure, and nothing else is',
  );
  // The runbook IS the code: its step-4 order and its step-3 count block are exactly this list.
  const runbook = runbookEraseAthleteLists();
  assert.deepEqual(
    runbook.order,
    ERASE_ATHLETE_TABLES,
    "FAM-1 5: the runbook's erasure order is eraseAthlete's, table for table",
  );
  assert.deepEqual(
    runbook.counted,
    ERASE_ATHLETE_TABLES,
    "FAM-1 5: the runbook's step-3 counts cover eraseAthlete's tables, in its order",
  );
  console.log(
    "✓ FAM-1 5: shapes; the weekday CHECK is WEEKDAYS; Postgres's weekday is localWeekday's; every table reachable from profiles is in the erasure, and the runbook's order and counts are the code's",
  );

  // ── (b) the keys, one column at a time; take off, back on, and the order ───────────────────────────
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    const blockA = await mkTemplateBlock(exec, A_SCOPE, 'fam-1-5-a');
    const blockA2 = await mkTemplateBlock(exec, A_SCOPE, 'fam-1-5-a2');
    const P = await mkKid(tx, await householdOfBlock(tx, blockA), 'Assignment probe');
    const assign = (over: Partial<AssignmentInsert> = {}) =>
      mkAssignment(tx, { blockId: blockA, profileId: P, ...over });
    // An insert the keys must ACCEPT, as an assertion, so a mutation that breaks it fails by name.
    const accepted = async (message: string, over: Partial<AssignmentInsert>) => {
      let id = 0;
      await assert.doesNotReject(
        tx.transaction(async () => {
          id = await assign(over);
        }),
        message,
      );
      return id;
    };
    const close = (id: number, activeTo: string) =>
      tx
        .update(schema.programAssignments)
        .set({ activeTo })
        .where(eq(schema.programAssignments.id, id));
    const hide = (id: number) =>
      tx
        .update(schema.programAssignments)
        .set({ deletedAt: new Date() })
        .where(eq(schema.programAssignments.id, id));
    const onDay = async (day: string) =>
      (
        await tx
          .select({ id: schema.programAssignments.id })
          .from(schema.programAssignments)
          .where(and(eq(schema.programAssignments.profileId, P), assignmentOnDay(day)))
          .orderBy(schema.programAssignments.idx, schema.programAssignments.id)
      ).map((r) => r.id);

    // CHECKs and FKs.
    await expectRejectedBy('program_assignments_idx_check', () => assign({ idx: -1 }), tx);
    await expectRejectedBy(
      'program_assignments_active_range_check',
      () => assign({ activeTo: '2026-11-01' }),
      tx,
    );
    await expectRejectedBy(
      'program_assignments_block_id_program_blocks_id_fk',
      () => assign({ blockId: 2_000_000_000 }),
      tx,
    );
    await expectRejectedBy(
      'program_assignments_profile_id_profiles_id_fk',
      () => assign({ profileId: 2_000_000_000 }),
      tx,
    );
    await expectRejectedBy(
      'program_assignment_weekdays_assignment_fkey',
      () =>
        tx
          .insert(schema.programAssignmentWeekdays)
          .values({ assignmentId: 2_000_000_000, weekday: 1 }),
      tx,
    );
    await accepted('FAM-1 5: a one-day program is legal (the last day is inclusive)', {
      blockId: await mkTemplateBlock(exec, A_SCOPE, 'fam-1-5-one-day'),
      idx: 9, // its own place: no other proof's key should be able to refuse it
      activeFrom: '2026-10-01',
      activeTo: '2026-10-01',
    });

    // The start key: a duplicate (profile, block, from) is refused; the open key: a second OPEN row for
    // one program with another start is refused; the order key: two open programs at one place.
    const first = await assign({ idx: 0 });
    await expectRejectedBy(
      ASSIGNMENT_START_UNIQUE_INDEX,
      () => assign({ idx: 5, activeTo: '2026-11-30' }),
      tx,
    );
    await expectRejectedBy(
      ASSIGNMENT_OPEN_UNIQUE_INDEX,
      () => assign({ idx: 5, activeFrom: '2026-11-09' }),
      tx,
    );
    await expectRejectedBy(
      ASSIGNMENT_ORDER_UNIQUE_INDEX,
      () => assign({ blockId: blockA2, idx: 0, activeFrom: '2026-11-09' }),
      tx,
    );
    await accepted('FAM-1 5: an open program on another block at another place is accepted', {
      blockId: blockA2,
      idx: 1,
      activeFrom: '2026-11-09',
    });

    // Off and on again THE SAME DAY, case 1 (it started today too): the closed row holds the start key.
    await close(first, '2026-11-02');
    await expectRejectedBy(ASSIGNMENT_START_UNIQUE_INDEX, () => assign({ idx: 2 }), tx);
    // A new row starting the NEXT day: the closed one kept as history. (Amendment 4's writer reopens on
    // the take-off day instead; this is the shape the keys allow for any later day.)
    const backOn = await accepted('FAM-1 5: back on from the next day is a new row', {
      idx: 2,
      activeFrom: '2026-11-03',
    });
    // The closed row freed its place in the order: an open program may take idx 0 now.
    const atZero = await accepted('FAM-1 5: a closed program frees its place in the order', {
      blockId: await mkTemplateBlock(exec, A_SCOPE, 'fam-1-5-a3'),
      idx: 0,
      activeFrom: '2026-11-02',
    });
    // On the take-off day the closed row and the open one at its old place are BOTH on, ordered (idx, id).
    assert.deepEqual(
      (await onDay('2026-11-02')).filter((id) => id === first || id === atZero),
      [first, atZero],
      'FAM-1 5: on its last day a closed program is still on, beside the one that took its place',
    );
    const nextDay = await onDay('2026-11-03');
    assert.ok(
      !nextDay.includes(first) && nextDay.includes(backOn),
      'FAM-1 5: the day after, only the new row is on',
    );
    // "Current" is per program: taken off today and back on tomorrow, BOTH rows are current today, and
    // only the new one tomorrow; a reader lists the program once (assignmentCurrentAsOf's docblock).
    const current = async (today: string) =>
      (
        await tx
          .select({ id: schema.programAssignments.id })
          .from(schema.programAssignments)
          .where(
            and(
              eq(schema.programAssignments.profileId, P),
              eq(schema.programAssignments.blockId, blockA),
              assignmentCurrentAsOf(today),
            ),
          )
          .orderBy(schema.programAssignments.id)
      ).map((r) => r.id);
    assert.deepEqual(
      await current('2026-11-02'),
      [first, backOn],
      'FAM-1 5: on its last day a closed row is still current, beside the row starting tomorrow',
    );
    assert.deepEqual(
      await current('2026-11-03'),
      [backOn],
      'FAM-1 5: the day after its last day, a closed row is no longer current',
    );

    // Off and on again THE SAME DAY, case 2 (the usual one: it started earlier). NO key refuses the
    // second row, and the program is on twice that day; only the overlap audit sees it.
    const blockLong = await mkTemplateBlock(exec, A_SCOPE, 'fam-1-5-long');
    const longOn = await assign({ blockId: blockLong, idx: 3, activeFrom: '2026-10-01' });
    await close(longOn, '2026-11-10');
    const again = await accepted(
      'FAM-1 5: off and on the same day after weeks is accepted by every key',
      {
        blockId: blockLong,
        idx: 4,
        activeFrom: '2026-11-10',
      },
    );
    const takeOffDay = await onDay('2026-11-10');
    assert.ok(
      takeOffDay.includes(longOn) && takeOffDay.includes(again),
      'FAM-1 5: both rows of that program are on its take-off day',
    );
    assert.ok(
      (await assignmentsOverlapping(tx)).includes(again),
      'FAM-1 5: the overlap audit flags the second row of a same-day off-and-on',
    );

    // A program taken off before it started is HIDDEN, and hiding frees all three keys: the same
    // start, the same place, open again.
    const [{ id: openA2 }] = await tx
      .select({ id: schema.programAssignments.id })
      .from(schema.programAssignments)
      .where(
        and(
          eq(schema.programAssignments.profileId, P),
          eq(schema.programAssignments.blockId, blockA2),
          sql`${schema.programAssignments.activeTo} is null and ${schema.programAssignments.deletedAt} is null`,
        ),
      );
    await hide(openA2);
    await accepted('FAM-1 5: a hidden assignment frees its start, its open slot and its place', {
      blockId: blockA2,
      idx: 1,
      activeFrom: '2026-11-09',
    });

    // The inference a writer relies on: ON CONFLICT naming the start key's columns and predicate is
    // inferred (no 42P10), and a replay of the same open row adds nothing.
    const replay = () =>
      tx.execute(sql`INSERT INTO program_assignments (public_id, block_id, profile_id, idx, active_from)
        VALUES (${newId()}, ${blockA}, ${P}, 9, '2026-12-20')
        ON CONFLICT (profile_id, block_id, active_from) WHERE deleted_at IS NULL DO NOTHING`);
    await close(backOn, '2026-12-01');
    await replay();
    await replay();
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.programAssignments)
      .where(
        and(
          eq(schema.programAssignments.profileId, P),
          eq(schema.programAssignments.activeFrom, '2026-12-20'),
        ),
      );
    assert.equal(
      n,
      1,
      'FAM-1 5: ON CONFLICT on the start key is inferred and a replay adds nothing',
    );

    // Weekday rows: one live row per weekday, a hidden one frees it, and the CHECK refuses 7 and -1.
    const weekday = (assignmentId: number, w: number) =>
      tx
        .insert(schema.programAssignmentWeekdays)
        .values({ assignmentId, weekday: w })
        .returning({ id: schema.programAssignmentWeekdays.id });
    await expectRejectedBy(
      'program_assignment_weekdays_weekday_check',
      () => weekday(atZero, 7),
      tx,
    );
    await expectRejectedBy(
      'program_assignment_weekdays_weekday_check',
      () => weekday(atZero, -1),
      tx,
    );
    const [wd] = await weekday(atZero, 1);
    await expectRejectedBy(
      'uq_program_assignment_weekdays_assignment_weekday',
      () => weekday(atZero, 1),
      tx,
    );
    await tx
      .update(schema.programAssignmentWeekdays)
      .set({ deletedAt: new Date() })
      .where(eq(schema.programAssignmentWeekdays.id, wd.id));
    await assert.doesNotReject(
      tx.transaction(async () => {
        await weekday(atZero, 1);
      }),
      'FAM-1 5: a hidden weekday row frees its weekday',
    );
  });
  console.log(
    '✓ FAM-1 5: the CHECKs and FKs; one live row per start, one open row per program, one open program per place; off and on the same day is refused only when it also started that day, and otherwise accepted and flagged; a closed program is on and current on its last day; a hidden one frees all three keys; ON CONFLICT on the start key is inferred',
  );

  // ── (c) due on a day: the origin against literals, and every boundary ──────────────────────────────
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    const blockId = await mkTemplateBlock(exec, A_SCOPE, 'fam-1-5-due');
    const P = await mkKid(tx, await householdOfBlock(tx, blockId), 'Due probe');
    let place = 0;
    const mk = async (
      activeFrom: string,
      activeTo: string | null,
      weekdays: readonly number[],
      slug: string,
    ) => {
      place += 1;
      const b = slug === 'same' ? blockId : await mkTemplateBlock(exec, A_SCOPE, slug);
      return mkAssignment(
        tx,
        { blockId: b, profileId: P, idx: place, activeFrom, activeTo },
        weekdays,
      );
    };
    const dueOn = async (id: number, day: string) =>
      (
        await tx
          .select({ id: schema.programAssignments.id })
          .from(schema.programAssignments)
          .where(and(eq(schema.programAssignments.id, id), assignmentDueOn(day)))
      ).length === 1;
    // The origin, literals on the assertion side: a stored 1 is Monday 2026-10-12; a stored 0 is Sunday.
    const mondays = await mk('2026-10-01', null, [1], 'same');
    assert.equal(
      await dueOn(mondays, '2026-10-12'),
      true,
      'FAM-1 5: a stored 1 is due on Monday 2026-10-12',
    );
    assert.equal(
      await dueOn(mondays, '2026-10-11'),
      false,
      'FAM-1 5: a stored 1 is not due on Sunday',
    );
    assert.equal(
      await dueOn(mondays, '2026-10-13'),
      false,
      'FAM-1 5: a stored 1 is not due on Tuesday',
    );
    const sundays = await mk('2026-10-01', null, [0], 'fam-1-5-sun');
    assert.equal(
      await dueOn(sundays, '2026-10-11'),
      true,
      'FAM-1 5: a stored 0 is due on Sunday 2026-10-11',
    );
    // The range, inclusive at both ends.
    const ranged = await mk('2026-10-05', '2026-10-09', WEEKDAYS, 'fam-1-5-range');
    assert.equal(await dueOn(ranged, '2026-10-04'), false, 'FAM-1 5: not due before its first day');
    assert.equal(await dueOn(ranged, '2026-10-05'), true, 'FAM-1 5: due on its first day');
    assert.equal(
      await dueOn(ranged, '2026-10-09'),
      true,
      'FAM-1 5: due on its LAST day (inclusive)',
    );
    assert.equal(
      await dueOn(ranged, '2026-10-10'),
      false,
      'FAM-1 5: not due the day after its last',
    );
    // A hidden assignment is never due, whatever weekday rows it keeps; a hidden weekday row is not a day.
    const hidden = await mk('2026-10-01', null, WEEKDAYS, 'fam-1-5-hidden');
    await tx
      .update(schema.programAssignments)
      .set({ deletedAt: new Date() })
      .where(eq(schema.programAssignments.id, hidden));
    assert.equal(
      await dueOn(hidden, '2026-10-12'),
      false,
      'FAM-1 5: a hidden assignment is never due',
    );
    const hiddenDay = await mk('2026-10-01', null, [1], 'fam-1-5-hidden-day');
    await tx
      .update(schema.programAssignmentWeekdays)
      .set({ deletedAt: new Date() })
      .where(eq(schema.programAssignmentWeekdays.assignmentId, hiddenDay));
    assert.equal(
      await dueOn(hiddenDay, '2026-10-12'),
      false,
      'FAM-1 5: a hidden weekday row is not a due day',
    );
  });
  console.log(
    '✓ FAM-1 5: due on a day is a weekday lookup with 0 = Sunday (literals), inclusive at both ends of the range, never through a hidden assignment or a hidden weekday row',
  );

  // ── (d) the audits, each with positive and negative controls ───────────────────────────────────────
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    for (const [name, audit] of [
      ['legacy block', assignmentsOnLegacyBlocks],
      ['across households', assignmentsAcrossHouseholds],
      ['overlapping', assignmentsOverlapping],
      ['without weekdays', assignmentsWithoutWeekdays],
    ] as const) {
      assert.deepEqual(
        await audit(tx),
        [],
        `FAM-1 5: on the seeded database, no assignment is ${name}`,
      );
    }
    const blockId = await mkTemplateBlock(exec, A_SCOPE, 'fam-1-5-audit');
    const bBlock = await mkTemplateBlock(exec, B_SCOPE, 'fam-1-5-audit-b');
    const householdId = await householdOfBlock(tx, blockId);
    const [legacy] = await tx
      .select({ id: schema.programBlocks.id })
      .from(schema.programBlocks)
      .where(
        and(
          eq(schema.programBlocks.kind, PROGRAM_BLOCK_KIND.legacy),
          eq(schema.programBlocks.householdId, householdId),
        ),
      )
      .orderBy(schema.programBlocks.id)
      .limit(1);
    const P = await mkKid(tx, householdId, 'Audit probe');
    let place = 10;
    const assign = (over: Partial<AssignmentInsert>, weekdays: readonly number[] = [1]) =>
      mkAssignment(tx, { blockId, profileId: P, idx: (place += 1), ...over }, weekdays);
    // Negative controls: a closed row and one starting the day after its last day.
    await assign({ activeTo: '2026-11-08' });
    await assign({ activeFrom: '2026-11-09' });
    // A later-ID row with EARLIER dates, the day before the other's first: the audit's second arm.
    const reversedBlock = await mkTemplateBlock(exec, A_SCOPE, 'fam-1-5-reversed');
    await assign({ blockId: reversedBlock, activeFrom: '2026-12-01' });
    await assign({ blockId: reversedBlock, activeFrom: '2026-11-01', activeTo: '2026-11-30' });
    // A hidden row and a live one with the same start (taken off before it started, put on again).
    const hiddenBlock = await mkTemplateBlock(exec, A_SCOPE, 'fam-1-5-hidden-again');
    const hiddenFirst = await assign({ blockId: hiddenBlock, activeFrom: '2026-12-05' });
    await tx
      .update(schema.programAssignments)
      .set({ deletedAt: new Date() })
      .where(eq(schema.programAssignments.id, hiddenFirst));
    await assign({ blockId: hiddenBlock, activeFrom: '2026-12-05' });
    // A hidden assignment with no weekday row is not flagged by the weekday audit.
    const hiddenNoDays = await assign(
      { blockId: await mkTemplateBlock(exec, A_SCOPE, 'fam-1-5-hidden-nodays') },
      [],
    );
    await tx
      .update(schema.programAssignments)
      .set({ deletedAt: new Date() })
      .where(eq(schema.programAssignments.id, hiddenNoDays));
    // Positive controls, one per audit (the overlap one starts ON another row's last day).
    const onLegacy = await assign({ blockId: legacy.id });
    const across = await assign({ blockId: bBlock });
    const overlapBase = await mkTemplateBlock(exec, A_SCOPE, 'fam-1-5-overlap');
    await assign({ blockId: overlapBase, activeTo: '2026-11-10' });
    const overlap = await assign({ blockId: overlapBase, activeFrom: '2026-11-10' });
    const noDays = await assign(
      { blockId: await mkTemplateBlock(exec, A_SCOPE, 'fam-1-5-nodays') },
      [],
    );
    assert.deepEqual(
      await assignmentsOnLegacyBlocks(tx),
      [onLegacy],
      'FAM-1 5: an assignment to a legacy block is flagged',
    );
    assert.deepEqual(
      await assignmentsAcrossHouseholds(tx),
      [across],
      'FAM-1 5: an assignment across households is flagged',
    );
    assert.deepEqual(
      await assignmentsOverlapping(tx),
      [overlap],
      "FAM-1 5: a row starting on another's last day is flagged, the day after is not",
    );
    assert.deepEqual(
      await assignmentsWithoutWeekdays(tx),
      [noDays],
      'FAM-1 5: a live assignment with no weekday row is flagged',
    );
    // Hidden rows: still flagged by the legacy and cross-household audits (the runbook deletes hidden
    // rows too); excluded from the overlap and weekday audits, which the controls above prove.
    for (const id of [onLegacy, across]) {
      await tx
        .update(schema.programAssignments)
        .set({ deletedAt: new Date() })
        .where(eq(schema.programAssignments.id, id));
    }
    assert.deepEqual(
      await assignmentsOnLegacyBlocks(tx),
      [onLegacy],
      'FAM-1 5: a hidden legacy-block assignment is still flagged',
    );
    assert.deepEqual(
      await assignmentsAcrossHouseholds(tx),
      [across],
      'FAM-1 5: a hidden cross-household assignment is still flagged',
    );
  });
  console.log(
    '✓ FAM-1 5: an assignment to a legacy block, across households, overlapping another of its program, or with no weekday row is each flagged; the controls (closed then next day, reversed ids, hidden then again, hidden with no days) are not',
  );

  // ── (e) the household delete: out of order is refused by name; in order commits ───────────────────
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    const blockId = await mkTemplateBlock(exec, A_SCOPE, 'fam-1-5-erase');
    const P = await mkKid(tx, await householdOfBlock(tx, blockId), 'Erase order probe');
    const [a] = await tx
      .insert(schema.programAssignments)
      .values({
        publicId: newId(),
        blockId,
        profileId: P,
        idx: 0,
        activeFrom: '2026-11-02',
        deletedAt: new Date(),
      })
      .returning({ id: schema.programAssignments.id });
    await tx
      .insert(schema.programAssignmentWeekdays)
      .values({ assignmentId: a.id, weekday: 3, deletedAt: new Date() });
    // Every row here is HIDDEN: a hidden row still holds its FK.
    await expectRejectedBy(
      'program_assignment_weekdays_assignment_fkey',
      () => tx.delete(schema.programAssignments).where(eq(schema.programAssignments.id, a.id)),
      tx,
    );
    await tx
      .delete(schema.programAssignmentWeekdays)
      .where(eq(schema.programAssignmentWeekdays.assignmentId, a.id));
    await expectRejectedBy(
      'program_assignments_block_id_program_blocks_id_fk',
      () => tx.delete(schema.programBlocks).where(eq(schema.programBlocks.id, blockId)),
      tx,
    );
    await expectRejectedBy(
      'program_assignments_profile_id_profiles_id_fk',
      () => tx.delete(schema.profiles).where(eq(schema.profiles.id, P)),
      tx,
    );
    await tx.delete(schema.programAssignments).where(eq(schema.programAssignments.id, a.id));
    await tx.delete(schema.programBlocks).where(eq(schema.programBlocks.id, blockId));
    await tx.delete(schema.profiles).where(eq(schema.profiles.id, P));
  });
  console.log(
    "✓ FAM-1 5: an assignment (hidden or not) refuses its block's and its athlete's delete, and its weekday rows refuse its own; weekday rows, then assignments, then blocks and profiles commits",
  );

  // ── (f) "Erase one athlete": a row in every table, a sibling left exactly as it was ────────────────
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    const sharedBlock = await mkTemplateBlock(exec, A_SCOPE, 'fam-1-5-family');
    const onlyP = await mkTemplateBlock(exec, A_SCOPE, 'fam-1-5-only-p');
    const otherFamily = await mkTemplateBlock(exec, B_SCOPE, 'fam-1-5-other-family');
    const householdId = await householdOfBlock(tx, sharedBlock);
    const entryBase = await probeEntryBase(tx, sharedBlock, 'FAM-1 5');
    const [{ prescriptionId }] = await tx
      .select({ prescriptionId: schema.prescriptions.id })
      .from(schema.prescriptions)
      .orderBy(schema.prescriptions.id)
      .limit(1);
    const [{ metricKey }] = await tx
      .select({ metricKey: schema.metricDefinitions.key })
      .from(schema.metricDefinitions)
      .orderBy(schema.metricDefinitions.key)
      .limit(1);
    const athlete = async (name: string, onBlocks: number[]) => {
      const id = await mkKid(tx, householdId, name);
      const [s] = await tx
        .insert(schema.sessions)
        .values({
          publicId: newId(),
          clientId: newId(),
          profileId: id,
          activityDate: '2026-11-10',
          sessionType: SESSION_TYPES[0],
        })
        .returning({ id: schema.sessions.id });
      const [ss] = await tx
        .insert(schema.supersets)
        .values({ publicId: newId(), clientId: newId(), sessionId: s.id })
        .returning({ id: schema.supersets.id });
      for (const hidden of [false, true]) {
        const [e] = await tx
          .insert(schema.entries)
          .values({
            ...entryBase,
            publicId: newId(),
            clientId: newId(),
            profileId: id,
            sessionId: s.id,
            supersetId: ss.id,
            supersetOrder: hidden ? 2 : 1,
            prescriptionId: null,
            prescriptionSet: null,
            deletedAt: hidden ? new Date() : null,
          })
          .returning({ id: schema.entries.id });
        const [es] = await tx
          .insert(schema.entrySets)
          .values({ publicId: newId(), clientId: newId(), entryId: e.id, idx: 1 })
          .returning({ id: schema.entrySets.id });
        await tx.insert(schema.entrySetQuantities).values({
          clientId: newId(),
          entrySetId: es.id,
          slot: QUANTITY_SLOT.primary,
          dimension: UNIT_DIMENSION.mass,
          unit: 'lb',
          valueNum: '45',
        });
      }
      await tx.insert(schema.dayReadiness).values({
        publicId: newId(),
        profileId: id,
        readinessDate: '2026-11-10',
        gateColor: GATE_COLORS[0],
      });
      await tx.insert(schema.rampTargets).values({
        publicId: newId(),
        profileId: id,
        metricKey,
        weekStart: '2026-11-09',
        targetValue: '10',
      });
      await tx
        .insert(schema.prescriptionTargets)
        .values({ publicId: newId(), prescriptionId, profileId: id, load: '45' });
      for (const [i, blockId] of onBlocks.entries()) {
        await mkAssignment(tx, { blockId, profileId: id, idx: i }, WEEKDAYS);
      }
      // A closed and a hidden assignment too: history and a program taken off before it started.
      await mkAssignment(
        tx,
        {
          blockId: sharedBlock,
          profileId: id,
          idx: 5,
          activeFrom: '2026-10-01',
          activeTo: '2026-10-31',
        },
        [2],
      );
      await mkAssignment(tx, {
        blockId: sharedBlock,
        profileId: id,
        idx: 6,
        activeFrom: '2026-12-01',
        deletedAt: new Date(),
      });
      return { id, sessionId: s.id, supersetId: ss.id };
    };
    const P = await athlete('Erase probe', [sharedBlock, onlyP]);
    const S = await athlete('Sibling probe', [sharedBlock]);
    const before = await athleteCounts(tx, P.id);
    for (const t of ERASE_ATHLETE_TABLES) {
      assert.ok(
        before[t]! > 0,
        `FAM-1 5: the erased athlete holds a row in ${t} before the erasure`,
      );
    }
    const siblingBefore = await athleteCounts(tx, S.id);
    const blocksBefore = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.programBlocks);

    // The runbook's pre-flights and its report.
    assert.deepEqual(
      await strayEntriesInAthletesSessions(tx, P.id),
      [],
      "FAM-1 5: no other athlete's entry is in P's sessions",
    );
    assert.deepEqual(
      await athleteRowsOnAnotherHouseholdsProgram(tx, P.id),
      [],
      "FAM-1 5: none of P's rows points at another household's program",
    );
    assert.deepEqual(
      await blocksOnlyThisAthleteWasOn(tx, P.id, householdId),
      [onlyP],
      'FAM-1 5: the report lists the program only P was ever on, not one a sibling was on',
    );
    assert.deepEqual(
      await othersOnTheseBlocks(tx, P.id, [onlyP]),
      [],
      'FAM-1 5: nobody else logged against the program only P was on',
    );
    // A stray assignment of P to ANOTHER household's block: the pre-flight stops, and the report never
    // offers that family's program for removal.
    const stray = await mkAssignment(tx, { blockId: otherFamily, profileId: P.id, idx: 7 }, [1]);
    assert.deepEqual(
      await athleteRowsOnAnotherHouseholdsProgram(tx, P.id),
      [stray],
      "FAM-1 5: P's assignment to another household's block stops the erasure",
    );
    assert.deepEqual(
      await blocksOnlyThisAthleteWasOn(tx, P.id, householdId),
      [onlyP],
      "FAM-1 5: the report never lists another household's program",
    );
    await tx
      .delete(schema.programAssignmentWeekdays)
      .where(eq(schema.programAssignmentWeekdays.assignmentId, stray));
    await tx.delete(schema.programAssignments).where(eq(schema.programAssignments.id, stray));
    const afterStrayRemoved = await athleteCounts(tx, P.id);

    await eraseAthlete(tx, P.id);
    assert.deepEqual(
      await athleteCounts(tx, P.id),
      Object.fromEntries(ERASE_ATHLETE_TABLES.map((t) => [t, 0])),
      'FAM-1 5: after the erasure the athlete has no row in any table',
    );
    void afterStrayRemoved;
    assert.deepEqual(
      await athleteCounts(tx, S.id),
      siblingBefore,
      "FAM-1 5: the sibling's rows are exactly as they were",
    );
    // Step 4b's pre-flight, positive control: a sibling who did a workout of that program (no assignment)
    // is caught, because removing the block would SET NULL their session's workout silently.
    const w = (await insertWorkoutOwnedBy(exec, A_SCOPE, {
      blockId: onlyP,
      clientId: newId(),
      name: 'Only P day',
      description: null,
    }))!;
    const [borrowed] = await tx
      .insert(schema.sessions)
      .values({
        publicId: newId(),
        clientId: newId(),
        profileId: S.id,
        activityDate: '2026-11-12',
        sessionType: SESSION_TYPE.workout,
        workoutId: w.id,
        workoutName: 'Only P day',
      })
      .returning({ id: schema.sessions.id });
    assert.deepEqual(
      await othersOnTheseBlocks(tx, P.id, [onlyP]),
      [borrowed.id],
      "FAM-1 5: a sibling's session on a workout of a program only P was on is caught before its removal",
    );
    assert.deepEqual(
      await tx.select({ n: sql<number>`count(*)::int` }).from(schema.programBlocks),
      blocksBefore,
      "FAM-1 5: the household's programs are untouched (program text belongs to the household)",
    );
  });

  // The pre-flight's positive controls: a sibling's entry in P's session, and one in P's superset from
  // the sibling's own session. Each is caught, and each makes the erasure abort on its FK.
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    const blockId = await mkTemplateBlock(exec, A_SCOPE, 'fam-1-5-stray');
    const householdId = await householdOfBlock(tx, blockId);
    const entryBase = await probeEntryBase(tx, blockId, 'FAM-1 5');
    const P = await mkKid(tx, householdId, 'Stray probe');
    const S = await mkKid(tx, householdId, 'Stray sibling');
    const session = async (profileId: number, day: string) =>
      (
        await tx
          .insert(schema.sessions)
          .values({
            publicId: newId(),
            clientId: newId(),
            profileId,
            activityDate: day,
            sessionType: SESSION_TYPES[0],
          })
          .returning({ id: schema.sessions.id })
      )[0].id;
    const pSession = await session(P, '2026-11-10');
    const sSession = await session(S, '2026-11-11');
    const [pSuperset] = await tx
      .insert(schema.supersets)
      .values({ publicId: newId(), clientId: newId(), sessionId: pSession })
      .returning({ id: schema.supersets.id });
    const siblingEntry = async (over: Partial<typeof schema.entries.$inferInsert>) =>
      (
        await tx
          .insert(schema.entries)
          .values({
            ...entryBase,
            publicId: newId(),
            clientId: newId(),
            profileId: S,
            supersetId: null,
            supersetOrder: null,
            prescriptionId: null,
            prescriptionSet: null,
            ...over,
          })
          .returning({ id: schema.entries.id })
      )[0].id;
    const inSession = await siblingEntry({ sessionId: pSession });
    const inSuperset = await siblingEntry({
      sessionId: sSession,
      supersetId: pSuperset.id,
      supersetOrder: 1,
    });
    assert.deepEqual(
      await strayEntriesInAthletesSessions(tx, P),
      [inSession, inSuperset].sort((a, b) => a - b),
      "FAM-1 5: a sibling's entry in P's session, and one in P's superset, are both caught by the pre-flight",
    );
    await expectRejectedBy('entries_superset_id_supersets_id_fk', () => eraseAthlete(tx, P), tx);
  });
  console.log(
    "✓ FAM-1 5: erasing one athlete removes their row in every table (hidden ones too) and leaves a sibling and the household's programs exactly as they were; the pre-flights catch a sibling's entry in their session or superset (which aborts the erasure) and a row on another household's program; the report lists only this household's program only they were on",
  );
}

// ── Lane A tech-debt: four CHECKs added NOT VALID (migration 0029; validated by the next) ──────────

/** The four constraints 0029 adds NOT VALID; the validating migration flips each to valid. */
const TECH_DEBT_CHECKS = [
  'program_blocks_name_length_check',
  'ramp_targets_target_value_not_nan_check',
  'entries_value_num_check',
  'entry_set_quantities_value_num_not_nan_check',
] as const;

async function verifyTechDebtChecks({ A_SCOPE }: VerifyContext): Promise<void> {
  // ── (a) each exists, NOT VALID until the validating migration, and the name bound is its const ─────
  // ⚠️ Read straight off the migrations, BEFORE (c) below drops and re-adds the name CHECK inside a
  // rolled-back transaction (the TEN-2c lesson, verify.ts: a re-added constraint would make this read
  // measure itself). (c) re-reads it afterwards, so a (c) that commits fails here.
  const rows = rowsOf<{ conname: string; convalidated: boolean }>(
    await db.execute(sql`
      SELECT conname, convalidated FROM pg_constraint
       WHERE conname IN (${sql.join(
         TECH_DEBT_CHECKS.map((c) => sql`${c}`),
         sql`, `,
       )})
       ORDER BY conname`),
  );
  assert.deepEqual(
    rows.map((r) => [r.conname, r.convalidated]),
    [...TECH_DEBT_CHECKS].sort().map((c) => [c, false]),
    'lane A tech-debt: the four CHECKs exist and are NOT VALID until the validating migration',
  );
  await assertUpperBoundIs('program_blocks_name_length_check', PROGRAM_NAME_MAX);
  console.log(
    '✓ lane A tech-debt: the program-name, NaN and entries-value CHECKs exist, NOT VALID; the name bound is PROGRAM_NAME_MAX',
  );

  // ── (b) each refuses what it names, by name, and accepts the bounds ────────────────────────────────
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    const blockId = await mkTemplateBlock(exec, A_SCOPE, 'td-checks');
    const householdId = await householdOfBlock(tx, blockId);
    const block = (name: string) =>
      tx
        .insert(schema.programBlocks)
        .values({ publicId: newId(), householdId, slug: `td-${newId()}`, name });
    // Code points, not bytes: astral characters are 4 bytes each, so a byte-counting CHECK fails here.
    await assert.doesNotReject(
      tx.transaction(async () => {
        await block(astral(PROGRAM_NAME_MAX));
        await block('L');
      }),
      'lane A tech-debt: a block name of PROGRAM_NAME_MAX code points, and of one, is accepted',
    );
    await expectRejectedBy(
      'program_blocks_name_length_check',
      () => block(astral(PROGRAM_NAME_MAX + 1)),
      tx,
    );
    await expectRejectedBy('program_blocks_name_length_check', () => block('   '), tx);

    // entries.value_num: refused negative and NaN, on an UPDATE of an existing reading.
    const [reading] = await tx
      .select({ id: schema.entries.id })
      .from(schema.entries)
      .where(sql`${schema.entries.valueNum} is not null`)
      .orderBy(schema.entries.id)
      .limit(1);
    assert.ok(reading, 'lane A tech-debt: a logged reading exists to probe');
    const setReading = (v: string) =>
      tx.update(schema.entries).set({ valueNum: v }).where(eq(schema.entries.id, reading.id));
    await expectRejectedBy('entries_value_num_check', () => setReading('-1'), tx);
    await expectRejectedBy('entries_value_num_check', () => setReading('NaN'), tx);
    await assert.doesNotReject(
      tx.transaction(async () => {
        await setReading('0');
      }),
      'lane A tech-debt: a reading of 0 is accepted',
    );

    // entry_set_quantities.value_num: NaN refused (the older `>= 0` CHECK admits it).
    const [quantity] = await tx
      .select({ id: schema.entrySetQuantities.id })
      .from(schema.entrySetQuantities)
      .orderBy(schema.entrySetQuantities.id)
      .limit(1);
    assert.ok(quantity, 'lane A tech-debt: a logged quantity exists to probe');
    await expectRejectedBy(
      'entry_set_quantities_value_num_not_nan_check',
      () =>
        tx
          .update(schema.entrySetQuantities)
          .set({ valueNum: 'NaN' })
          .where(eq(schema.entrySetQuantities.id, quantity.id)),
      tx,
    );

    // ramp_targets.target_value: NaN refused; a real target accepted.
    const P = await mkKid(tx, householdId, 'Ramp probe');
    const [{ metricKey }] = await tx
      .select({ metricKey: schema.metricDefinitions.key })
      .from(schema.metricDefinitions)
      .orderBy(schema.metricDefinitions.key)
      .limit(1);
    const ramp = (targetValue: string, weekStart: string) =>
      tx
        .insert(schema.rampTargets)
        .values({ publicId: newId(), profileId: P, metricKey, weekStart, targetValue });
    await expectRejectedBy(
      'ramp_targets_target_value_not_nan_check',
      () => ramp('NaN', '2026-11-09'),
      tx,
    );
    await assert.doesNotReject(
      tx.transaction(async () => {
        await ramp('10', '2026-11-16');
      }),
      'lane A tech-debt: a real ramp target is accepted',
    );
  });

  // ── (c) why the production read gates the merge: NOT VALID still refuses an UPDATE of a bad row ───
  // A demonstration of Postgres's NOT VALID behaviour on THIS constraint: it drops the migrated CHECK,
  // plants a violator, re-adds the CHECK NOT VALID, and shows the violator's soft delete is refused. The
  // re-added definition is asserted equal to the migrated one, so the copy below cannot drift from 0029.
  const migratedDef = await constraintDef('program_blocks_name_length_check');
  await rolledBack(async (tx) => {
    const exec = asTx(tx);
    const householdId = await householdOfBlock(
      tx,
      await mkTemplateBlock(exec, A_SCOPE, 'td-window'),
    );
    await tx.execute(
      sql`ALTER TABLE program_blocks DROP CONSTRAINT program_blocks_name_length_check`,
    );
    const [bad] = await tx
      .insert(schema.programBlocks)
      .values({
        publicId: newId(),
        householdId,
        slug: `td-${newId()}`,
        name: 'x'.repeat(PROGRAM_NAME_MAX + 1),
      })
      .returning({ id: schema.programBlocks.id });
    await tx.execute(sql`ALTER TABLE program_blocks ADD CONSTRAINT program_blocks_name_length_check
      CHECK (char_length(btrim(name)) >= 1 and char_length(name) <= 60) NOT VALID`); // DDL takes no parameter; the equality below ties this 60 to 0029's
    const [{ def: readded }] = rowsOf<{ def: string }>(
      await tx.execute(sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'program_blocks_name_length_check'`),
    );
    assert.equal(
      readded,
      migratedDef,
      'lane A tech-debt: the re-added CHECK is exactly the migrated one',
    );
    await expectRejectedBy(
      'program_blocks_name_length_check',
      () =>
        tx
          .update(schema.programBlocks)
          .set({ deletedAt: new Date() })
          .where(eq(schema.programBlocks.id, bad.id)),
      tx,
    );
  });
  // (c) rolled back: the migrated constraint is still the NOT VALID one 0029 added.
  const [{ convalidated }] = rowsOf<{ convalidated: boolean }>(
    await db.execute(sql`SELECT convalidated FROM pg_constraint
      WHERE conname = 'program_blocks_name_length_check'`),
  );
  assert.equal(convalidated, false, 'lane A tech-debt: (c) left the migrated name CHECK as it was');
  console.log(
    '✓ lane A tech-debt: a long or blank block name, a negative or NaN reading, a NaN quantity and a NaN ramp target are each refused by name; the bounds are accepted; and NOT VALID still refuses a soft delete of an existing bad row, which is why the production read gates the merge',
  );
}
