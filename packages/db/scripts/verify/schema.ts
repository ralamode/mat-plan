import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DEFAULT_TRACKING_TYPE,
  MAX_SETS_PER_MOVEMENT,
  MAX_STORABLE_QUANTITY,
  MAX_WORKOUT_ITEMS,
  FREE_TEXT_NOTE_MAX,
  MOVEMENT_SEED_ROWS,
  newId,
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

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { schema } from '../../src/client';
import { householdHasProgram, programDayRows } from '../../src/queries/program-day';
import { householdScopeForScript } from '../../src/writers/household-scope-script';
import { prescribedSnapshotsFor } from '../../src/writers/prescribed-snapshot';
import {
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
  asTx,
  assertCheckCoversConst,
  columnCatalogShape,
  constraintDef,
  db,
  expectRejectedBy,
  idsOf,
  rolledBack,
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
export async function mkTemplateBlock(
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

    const seedDb = tx as unknown as NodePgDatabase<typeof schema>;
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
    const pg = tx as unknown as NodePgDatabase<typeof schema>;

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
    const pg = tx as unknown as NodePgDatabase<typeof schema>;
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
export async function sessionsOnForeignWorkouts(tx: VerifyTx): Promise<number[]> {
  const res = await tx.execute(sql`
    SELECT s.id FROM sessions s
      JOIN profiles p ON p.id = s.profile_id
      JOIN workouts w ON w.id = s.workout_id
      JOIN program_blocks b ON b.id = w.block_id
     WHERE p.household_id <> b.household_id`);
  return idsOf(res);
}

/** Entries whose prescription is in ANOTHER household than the entry's profile (A3). Runbook pre-flight (g). */
export async function entriesOnForeignPrescriptions(tx: VerifyTx): Promise<number[]> {
  const res = await tx.execute(sql`
    SELECT e.id FROM entries e
      JOIN profiles p ON p.id = e.profile_id
      JOIN prescriptions pr ON pr.id = e.prescription_id
      JOIN program_blocks b ON b.id = pr.block_id
     WHERE p.household_id <> b.household_id`);
  return idsOf(res);
}

/** Sessions naming a workout whose type is not `workout` (D6). Not a CHECK: A2 §6 does not authorize one. */
export async function workoutSessionsOfAnotherType(tx: VerifyTx): Promise<number[]> {
  const rows = await tx
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(
      sql`${schema.sessions.workoutId} is not null and ${schema.sessions.sessionType} is distinct from ${SESSION_TYPE.workout}`,
    );
  return rows.map((r) => r.id);
}

/** Sessions naming a workout that also carry a `day_role` (A2 §6: it stays NULL on a template session). */
export async function workoutSessionsWithADayRole(tx: VerifyTx): Promise<number[]> {
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
export async function entriesOnAnotherWorkoutsPrescriptions(tx: VerifyTx): Promise<number[]> {
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
