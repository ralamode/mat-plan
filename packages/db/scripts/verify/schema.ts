import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MOVEMENT_SEED_ROWS,
  newId,
  QUANTITY_SLOT,
  SESSION_TYPE,
  SESSION_TYPES,
  TRACKING_TYPE,
  TRACKING_TYPES,
  UNIT_DIMENSION,
} from '@mat-plan/shared';
import { and, eq, inArray, notExists, sql } from 'drizzle-orm';

import { schema } from '../../src/client';
import { findOrCreateTypedMovement } from '../../src/writers/movement-catalog';
import {
  insertMovementOwnedBy,
  movementInHousehold,
  movementIsGlobal,
} from '../../src/writers/ownership';
import {
  asTx,
  assertCheckCoversConst,
  columnCatalogShape,
  db,
  expectRejectedBy,
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
 * - step 4a-i: blocks, slots, identity (ADR 0007 Amendment 2 §10), `assertCheckCoversIntConst`;
 * - step 4a-ii: the append arbiters and the row arbiter;
 * - step 4b: the XOR both ways, slot keys, quantity keys, the scoped `client_id`;
 * - step 5: assignments and erasure.
 *
 * What a module can rely on when it runs, and the helpers to import, are in `./harness` →
 * `VerifyContext`: the modules run LAST, on a database that already holds every fixture `verify.ts`
 * wrote. Every proof here that writes runs inside {@link rolledBack}, so this module leaves nothing
 * behind for a later module to count.
 */
export async function verifySchema(ctx: VerifyContext): Promise<void> {
  await verifyStep3(ctx);
}

/** Thrown to roll a probe transaction back; anything else propagates. */
class Rollback extends Error {}

/** Run `fn` in a transaction that is always rolled back, so a probe's writes never persist. */
async function rolledBack(fn: (tx: VerifyTx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
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
  const notAtDefault = [...SEEDED_TYPE_BY_SLUG].filter(([, t]) => t !== TRACKING_TYPE.weight_reps);
  assert.ok(notAtDefault.length > 0, 'FAM-1 3: the typing retypes at least one built-in');
  const [ownSlug] = notAtDefault[0];
  // Only the seeded slugs: verify.ts leaves other global rows behind that the hand-re-added
  // global-row CHECK would refuse on any update (harness → "two constraints are not as the
  // migrations left them"). The typing touches only these slugs, so nothing outside them can move.
  const seededSlug = inArray(schema.movements.slug, [...SEEDED_TYPE_BY_SLUG.keys()]);
  await rolledBack(async (tx) => {
    await tx
      .update(schema.movements)
      .set({ trackingType: TRACKING_TYPE.weight_reps })
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
      [TRACKING_TYPE.weight_reps],
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
      TRACKING_TYPE.weight_reps,
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
