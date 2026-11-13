import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_INPUT_SHAPES,
  ACTIVITY_METRIC_MAP,
  ACTIVITY_TYPE_SEED_ROWS,
  CALISTHENICS_METRIC_KEYS,
  DAY_ROLES,
  DEFAULT_BODYWEIGHT_CONTEXT,
  E2E_SESSION_BYPASS_USER,
  ENTRY_KIND,
  ENTRY_STATUS,
  HOUSEHOLD_ROLE,
  HOUSEHOLD_ROLES,
  MAX_HOUSEHOLD_ATHLETES,
  METRIC_AGGREGATION,
  METRIC_AGGREGATIONS,
  METRIC_DEFINITION_SEED_ROWS,
  METRIC_KEYS,
  METRIC_VALUE_TYPES,
  MOVEMENT_PATTERNS,
  MOVEMENT_SEED_PUBLIC_IDS,
  MOVEMENT_SEED_ROWS,
  PROFILE_KIND,
  PROFILE_NAME_MAX,
  PROGRAM_SEED,
  QUANTITY_SLOT,
  QUANTITY_SLOT_ROWS,
  ROUTINE_VERSION,
  SEED_ACTIVITY_TYPE_KEYS,
  SEED_ACTIVITY_TYPE_SC_LIFT_PUBLIC_ID,
  SEED_ACTIVITY_TYPE_WEIGH_IN_PUBLIC_ID,
  SEED_METRIC_BODYWEIGHT_PUBLIC_ID,
  SEED_METRIC_KEYS,
  SEED_PUBLIC_ID_PREFIX,
  SESSION_TYPES,
  UNITS,
  UNIT_CODES,
  UNIT_DIMENSION,
  UNIT_DIMENSIONS,
  UNIT_DIMENSION_BY_CODE,
  WEEK_LENGTH_DAYS,
  activityTypeSeedRowSchema,
  assertRollupAggregation,
  foldAggregation,
  foldName,
  metricDefinitionSeedRowSchema,
  movementSeedRowSchema,
  movementSlug,
  movementSlugMatchesName,
  newId,
  routineConfigSchema,
  type MetricAggregation,
  type ProgramBlockSeedRow,
  type RoutineConfig,
  uuidSchema,
} from '@mat-plan/shared';
import { and, eq, gte, inArray, isNull, lt, max, sql, sum } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import { type Database, schema } from '../src/client';
import { bodyweightMonthRows, loggedMonths, strengthMonthRows } from '../src/queries/export-month';
import { prescribedSnapshotsFor } from '../src/writers/prescribed-snapshot';
import { householdProfileRows } from '../src/queries/household-profiles';
import { liveHouseholdIds } from '../src/queries/household-scope';
// TEN-2c: the ONE definition of "a movement is referenced", shared with `runbooks.md` pre-flight (d),
// the report-only correction, and (by requirement) TEN-2b-2's orphan correction + TEN-2c-1's split.
// This file hand-wrote the `entries` half of it before 2c and missed `prescriptions` entirely.
import { crossHouseholdMovementRefs, sharedMovementRows } from '../src/queries/movement-ownership';
import { programDayRows } from '../src/queries/program-day';
import { ownerScope, type HouseholdScope, type OwnerScope } from '../src/scope';
import { weeklyAdherenceRows } from '../src/queries/weekly-adherence';
import {
  findAmendableBodyweight,
  insertBodyweightEntry,
  updateBodyweightEntryById,
} from '../src/writers/bodyweight';
// TEN-1 1b: imported by RELATIVE path on purpose — `src/index.ts` does not re-export it, so the app
// cannot reach the constructor that takes a household id as an argument at all (module resolution
// fails on a deep bare import). A script has no request to derive a scope from, so it NAMES one.
import { householdScopeForScript } from '../src/writers/household-scope-script';
// TEN-1 1d: the REAL find-or-create the app DAL delegates to. `apps/web/lib/dal/catalog.ts` is
// `server-only` and imports the app's env, so the catalog verdict at the end of this file can only
// run the code the app runs if that core lives here (write-path.md invariant 3).
import {
  findOrCreateMovement,
  MOVEMENT_NOT_AVAILABLE,
  MovementNotAvailableError,
  resolveSessionMovements,
} from '../src/writers/movement-catalog';
import {
  findNameMatch,
  insertHouseholdMember,
  isLiveProfile,
  insertProfileOwnedBy,
  isOwnerOf,
  movementIsGlobal,
  ownedEntryIds,
  profileByClientId,
} from '../src/writers/ownership';
import {
  archiveProfile,
  createProfile,
  renameProfile,
  restoreProfile,
} from '../src/writers/profile';
import { membershipHousehold } from '../src/queries/household-membership';
import { updateStrengthSetById, writeStrengthSession } from '../src/writers/strength-session';
// TEN-1 1d: the corrections registry itself, so the bulk household predicate is proved by running
// the correction's own dry run rather than a lookalike of its SQL.
import { CORRECTIONS, NULL_ROUTINE_TO_FULL_NAME } from './corrections/registry';
import {
  SEED_FULL_ROUTINE,
  SEED_HOUSEHOLD_PUBLIC_ID,
  SEED_PROFILE_2_PUBLIC_ID,
  SEED_PROFILE_3_PUBLIC_ID,
  SEED_PROFILE_NAME,
  SEED_PROFILE_PUBLIC_ID,
  seed,
  seedProgram,
} from '../src/seed';

/**
 * Verifies the migration + seed against an in-process Postgres (PGlite) — no
 * Docker needed locally. Proves: the migration applies cleanly, the seed is
 * idempotent (run twice → identical), and the tagged-union CHECK is enforced.
 * The real DB gates (Docker PG + Neon branch) land at V0-11 in CI.
 */
const db = drizzle(new PGlite(), { schema, casing: 'snake_case' });
const asPg = db as unknown as NodePgDatabase<typeof schema>;

/** The transaction handle `db.transaction` hands its callback — derived here, never re-typed. */
type VerifyTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Assert `fn` rejects with a Postgres error whose violated constraint is `constraintName`,
 * read off `cause.constraint` (the node-postgres / PGlite error shape). Extracted from the two
 * inline copies this file grew (V1-1c's activity_type_id guard + V1-5's shape-CHECK trap) and
 * reused for the V1-6b-1 ramp_targets rejections — one idiom, so a rename fails in one place.
 *
 * **TEN-2a: pass `tx` when the probe runs inside an enclosing transaction.** A failed statement
 * aborts the whole transaction, so a second probe would fail `25P02` and this helper would report
 * `got '(none)'` for a constraint that is working perfectly. With `tx` each probe runs in its own
 * nested `tx.transaction(...)` — drizzle emits `SAVEPOINT` / `ROLLBACK TO SAVEPOINT` — so the
 * enclosing transaction survives every rejection. `fn` must issue its statements on that same `tx`:
 * PGlite has ONE connection, so a query on the module-level `db` inside a transaction waits forever.
 */
async function expectRejectedBy(
  constraintName: string,
  fn: () => Promise<unknown>,
  tx?: VerifyTx,
): Promise<void> {
  let violated: string | undefined;
  try {
    if (tx) {
      await tx.transaction(async () => {
        await fn();
      });
    } else {
      await fn();
    }
  } catch (e) {
    violated = (e as { cause?: { constraint?: string } })?.cause?.constraint;
  }
  assert.equal(
    violated,
    constraintName,
    `expected rejection by constraint '${constraintName}', got '${violated ?? '(none)'}'`,
  );
}

/**
 * A reference table must equal its shared-const source EXACTLY, in BOTH directions — a row the const
 * doesn't know about is drift just as much as a const member with no row.
 *
 * Extracted at GAP-3 (reuse panel): `units` open-coded this as two loops, and `quantity_slots` was
 * about to open-code it a second time. Both now call this, so the parity RULE lives once even though
 * the two tables' columns differ.
 */
function assertRefTableMatches(
  table: string,
  dbRows: readonly Record<string, unknown>[],
  constRows: readonly Record<string, unknown>[],
): void {
  const norm = (rows: readonly Record<string, unknown>[]) =>
    rows.map((r) => JSON.stringify(Object.entries(r).sort())).sort();
  assert.deepEqual(
    norm(dbRows),
    norm(constRows),
    `${table} rows equal their shared const EXACTLY (both directions)`,
  );
}

/**
 * The column set of a table, keyed by name → data_type — the `information_schema.columns` cast shape
 * lives ONCE here (the routine_config + entries checks both call it, plus the V1-10 tables).
 *
 * It carries `data_type` only. Nullability and the column default are catalog facts this shape
 * cannot express, so a check that needs them calls `columnCatalogShape` below rather than widening
 * this Map and churning its four existing callers.
 */
async function columnsOf(tableName: string): Promise<Map<string, string>> {
  const res = await db.execute(
    sql`select column_name, data_type from information_schema.columns where table_name = ${tableName}`,
  );
  const rows = (res as unknown as { rows: { column_name: string; data_type: string }[] }).rows;
  return new Map(rows.map((r) => [r.column_name, r.data_type]));
}

/**
 * The three catalog facts about ONE column that `columnsOf` cannot carry: declared type, NULLability
 * and the stored default. Returns `undefined` when the column does not exist.
 *
 * Extracted at TEN-2a, its second consumer (TEN-1 1a's `households.synthetic` readback was the
 * first, converted in the same PR). ⚠️ `expectRejectedBy` cannot reach NULLability either — a NOT
 * NULL violation is `23502`, which carries a column, not a named constraint — so this readback is
 * the only way to assert that a column shipped nullable, or didn't.
 */
async function columnCatalogShape(
  tableName: string,
  columnName: string,
): Promise<{ data_type: string; is_nullable: string; column_default: string | null } | undefined> {
  const res = await db.execute(
    sql`select data_type, is_nullable, column_default from information_schema.columns
        where table_name = ${tableName} and column_name = ${columnName}`,
  );
  return (
    res as unknown as {
      rows: { data_type: string; is_nullable: string; column_default: string | null }[];
    }
  ).rows[0];
}

await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
console.log('✓ migration applied to PGlite');

// ── 🔴 TEN-2c: TWO CATALOG FACTS THAT MUST BE READ *HERE*, AND NOWHERE ELSE ────────────────────────
//
// ⚠️ **DO NOT MOVE THESE DOWN THE FILE. They are only true of the MIGRATION at this point.** A
// fixture below mutates exactly this object, so a later read measures `verify.ts` instead of 0017:
// the V1-1b backfill simulation (~550 lines down) **drops and re-adds**
// `movements_global_row_has_pattern` itself, because that CHECK post-dates 0002's backfill and the
// simulation is faithful to the DEPLOY ORDER. Its re-add is hand-written `NOT VALID`, so a
// `convalidated` read taken after it would pass even if 0017 had **lost** its own `NOT VALID`
// hand-edit on a rebase — and `drizzle-kit`'s drift guard diffs `schema.ts` against the snapshot, not
// the SQL, so nothing else in any gate catches that. This read is the only thing that does.
//
// `movements_slug_unique` is read here for the same reason, one step weaker: the TEN-2a/2b sections
// below used to DROP and re-`ADD` it around their probes, and asserting its absence from up here is
// what keeps the assertion about **the migration** rather than about whatever ran last.
//
// The 0015 FK precedent (`convalidated = true`, asserted in the TEN-2a block) escapes this only
// because nothing re-adds the FK; `entries_activity_type_id_not_null` escapes it because nothing
// asserts its `convalidated` at all.
{
  const CHECK = schema.MOVEMENT_GLOBAL_ROW_HAS_PATTERN_CHECK;
  const checkRows = (
    (await db.execute(
      sql`select convalidated from pg_constraint where conname = ${CHECK}`,
    )) as unknown as { rows: { convalidated: boolean }[] }
  ).rows;
  assert.equal(
    checkRows.length,
    1,
    `TEN-2c: ${CHECK} exists in pg_constraint, exactly once — a count of 0 means 0017 did not apply`,
  );
  assert.equal(
    checkRows[0].convalidated,
    true,
    `TEN-2d: …and it is now VALIDATED — migration 0018 ran VALIDATE CONSTRAINT, flipping 2c's convalidated = false, which is how "do not forget the VALIDATE" was a red build rather than a reminder. ⚠️ This is the arc's ONLY check against a REAL row — db:verify runs on PGlite and never against production, so the VALIDATE itself is what scanned prod (it reported zero violators before merge). A false here means 0018 did not apply`,
  );

  // The constraint 0017 DROPPED — asserted ABSENT by name, which is where the literal
  // 'movements_slug_unique' survives in this file, once. (0017 deliberately carries no `IF EXISTS`,
  // so no DDL guard masks a database where it had already been removed by hand.)
  const droppedRows = (
    (await db.execute(
      sql`select conname from pg_constraint where conname = 'movements_slug_unique'`,
    )) as unknown as { rows: { conname: string }[] }
  ).rows;
  assert.deepEqual(
    droppedRows,
    [],
    'TEN-2c: movements_slug_unique is GONE from pg_constraint — the non-partial UNIQUE("slug") dominated both partial indexes, so until 0017 they were declared and NOT in effect',
  );
  console.log(
    `✓ TEN-2c: movements_slug_unique is absent from pg_constraint, and ${CHECK} exists NOT VALID ` +
      '(both read HERE, before any fixture re-adds either — see the note above)',
  );
}

// The 1c-4 seed guard's proof is BELOW, after the idempotency block it depends on — see
// "AUTH-1 1c-4: the seed refuses a household it does not own".

// Seed twice → must be idempotent.
await seed(asPg);
await seed(asPg);

const units = await db.select().from(schema.units);
const profiles = await db.select().from(schema.profiles);
const households = await db.select().from(schema.households);
const categories = await db.select().from(schema.activityTypeCategories);
assert.equal(units.length, UNIT_CODES.length, 'units seeded exactly once');
// GAP-3 — the row COUNT above is nearly tautological (the seed inserts from UNIT_CODES, so it compares
// the const to itself). These assert the CONTENT: that every code is present and that each one's stored
// dimension matches the shared map. That is what actually catches drift — a renamed code, or a unit
// seeded with the wrong dimension, which the count can never see.
{
  assertRefTableMatches(
    'units',
    units.map((u) => ({ code: u.code, dimension: u.dimension })),
    UNITS.map((u) => ({ code: u.code, dimension: u.dimension })),
  );
  // GAP-3's whole point: a length dimension now EXISTS. Before this there was none at all, which is why
  // a box-jump height had nowhere to live but the free-text load string.
  assert.ok(
    units.some((u) => u.dimension === 'length'),
    'at least one length unit is seeded (GAP-3)',
  );
}
// V1-3: the kid profiles, stable by public_id across re-seeds. PROF-1 b added a THIRD, owned by the
// archive e2e specs — see `SEED_PROFILE_3_PUBLIC_ID`'s docblock for why archive cannot share one.
assert.equal(profiles.length, 3, 'exactly three profiles after two seed runs');
const seededProfileIds = profiles.map((p) => p.publicId).sort();
assert.deepEqual(
  seededProfileIds,
  [SEED_PROFILE_PUBLIC_ID, SEED_PROFILE_2_PUBLIC_ID, SEED_PROFILE_3_PUBLIC_ID].sort(),
  'every seed profile stable by public_id',
);
// The literal is deliberate and lives here exactly once (AGENTS.md -> constants: "a contract test that
// pins the const's value"). This is the OSS-1 guard: it fails if anyone puts a real first name back into
// SEED_PROFILE_NAME / SEED_PROFILE_2_NAME, which asserting against the consts could never catch.
assert.deepEqual(
  profiles.map((p) => p.name).sort(),
  ['Athlete One', 'Athlete Three', 'Athlete Two'],
  'OSS-1: the seeded profile names are role names, not real first names',
);
assert.equal(households.length, 1, 'exactly one household after two seed runs');
assert.equal(
  households[0].publicId,
  SEED_HOUSEHOLD_PUBLIC_ID,
  'root household stable by public_id',
);
assert.equal(
  categories.length,
  ACTIVITY_CATEGORIES.length,
  'activity_type_categories seeded from the shared const, exactly once',
);
console.log(
  `✓ idempotent seed: ${units.length} units, ${categories.length} categories, ${households.length} household, ${profiles.length} profiles`,
);

// 🔴 **AUTH-1 1c-4: the seed refuses a household it does not own.**
//
// `seed.ts`'s household insert is conditional on no live household existing. It is the replacement
// for the detector 1c-4 removed — the resolver used to throw on a second live household, so a seed
// that created one announced itself as an outage; it counts a principal's memberships now, and two
// live households is the intended Beta 0 end state, so there is nothing left to be loud.
// `migrate.yml` seeds PRODUCTION on every merge to `main`, which makes this seed the one automated
// creator of household #2. The guard closes the creator.
//
// ⚠️ **The first version of this proof was vacuous, and the reason is the lesson.** The state the
// guard is about is "a live household, and NONE under the seed's `public_id`". Inserting an extra
// household here cannot produce it — the seed row is already present, so the new one is the SECOND
// and the guard correctly skips past it, which passes with the guard deleted. The construction that
// DOES produce it is to move the seed row out of the way: nothing references
// `households.public_id` (children carry `household_id` → `households.id`) and
// `households_public_id_unique` is a plain UNIQUE, so renaming it is reversible and local.
{
  // A fresh UUIDv7, deliberately NOT from `SEED_PUBLIC_ID_PREFIX`: the whole construction is "a live
  // household the seed does not own", and borrowing the seed namespace to express that would be
  // self-contradicting.
  const PROOF_SWAP_PUBLIC_ID = newId();
  const liveBefore = await db
    .select({ id: schema.households.id })
    .from(schema.households)
    .where(isNull(schema.households.deletedAt));

  await db
    .update(schema.households)
    .set({ publicId: PROOF_SWAP_PUBLIC_ID })
    .where(eq(schema.households.publicId, SEED_HOUSEHOLD_PUBLIC_ID));

  // ⚠️ `finally`, because the rename is the only destructive step in this file. If an assertion
  // below throws, every later block would otherwise run against a seed household under a FOREIGN
  // `public_id` and fail for a reason that has nothing to do with what broke.
  try {
    // The guard skips the insert, so the `public_id` resolve finds nothing and the seed REFUSES.
    // With the `if (!liveHousehold)` guard deleted the insert lands, the resolve succeeds and
    // `seed()` returns — which is what makes this assertion able to fail
    // (`10-seed-ignores-live-household.patch`).
    await assert.rejects(
      () => seed(asPg),
      /refusing to seed into a household this seed does not own/,
      'AUTH-1 1c-4: a live household under a foreign public_id makes the seed REFUSE, by the message it throws — not by a TypeError',
    );

    const liveAfter = await db
      .select({ id: schema.households.id })
      .from(schema.households)
      .where(isNull(schema.households.deletedAt));
    assert.equal(
      liveAfter.length,
      liveBefore.length,
      'AUTH-1 1c-4: the refused seed created NO household — the point of the guard is that household #2 never appears',
    );
  } finally {
    // 🔴 **The restore must be CONFLICT-FREE, or it hides the failure it is protecting.** In the
    // world where the assertion above fails — the guard deleted, which is
    // `10-seed-ignores-live-household.patch` — the seed DID insert its own household under
    // `SEED_HOUSEHOLD_PUBLIC_ID`, so renaming the original back violates
    // `households_public_id_unique`, and an error thrown from a `finally` REPLACES the assertion
    // error. The mutation gate compares the first failing assertion against `.expect`, so that
    // swap turned a correct RED into "RED, but on the WRONG assertion". Restore only when the id
    // is free; when it is not, the proof has already failed and the process is exiting.
    const [occupied] = await db
      .select({ id: schema.households.id })
      .from(schema.households)
      .where(eq(schema.households.publicId, SEED_HOUSEHOLD_PUBLIC_ID));
    if (!occupied) {
      await db
        .update(schema.households)
        .set({ publicId: SEED_HOUSEHOLD_PUBLIC_ID })
        .where(eq(schema.households.publicId, PROOF_SWAP_PUBLIC_ID));
    }
  }
  console.log(
    '✓ AUTH-1 1c-4: the seed refuses a live household it does not own, and creates nothing',
  );
}

// V1-1a: every seed profile must be scoped to the root household (household_id NOT NULL
// enforced by the migration's CHECK; the migration backfill + seed both set it).
for (const p of profiles) {
  assert.equal(p.householdId, households[0].id, 'seed profile scoped to root household');
  assert.ok(p.householdId != null, 'profile.household_id is non-null (CHECK-enforced)');
}
console.log('✓ profiles scoped to root household (household_id NOT NULL)');

// ── TEN-1 1b: THE NAMED SCOPES. Every scoped call in this file passes one of exactly these ───────
// `householdScopeForScript` appears here, at B_SCOPE below, and at A_MEMBER_SCOPE below that —
// `packages/db/src/scope.test.ts` fails the build on any mint that is not a named const WITH A
// STATED REASON (it was a bare count of two until PROF-1 b). The reason is the plan's R5: with
// ~22 mechanical call-site edits, one ad-hoc scope minted at a call site makes an assertion pass for
// the wrong reason, and that is invisible in review. Two named constants mean a wrong scope is a
// wrong NAME, which reads.
//
// A_SCOPE is the SEED household — the real one. It is the scope every pre-TEN-1 assertion in this file
// was implicitly written against, so threading it is what keeps those proofs proving what their
// messages say. B_SCOPE (the "Verify Programming HH") cannot be defined until that household is
// inserted, ~3400 lines down, at the V1-10 programming fixture.
const A_SCOPE = householdScopeForScript(households[0].id);

// ── PROF-1 b: THE THIRD SCOPE — household A, as a MEMBER rather than the owner ───────────────────
// 🔴 **A legitimately-minted member, which is the whole reason this exists.** `b-s` proved the owner
// conjunct against a FORGED scope (`{ ...A_SCOPE, role: 'member' } as OwnerScope`), which is the
// right test for a forgery and the WRONG one for "a member of this household cannot archive": a
// forged scope is a cast nobody writes, while a member scope is what the resolver hands every
// non-owner on every request. Proving the member path against a forgery would be proving the wrong
// sentence, so `b` mints the real thing and `scope.test.ts`'s MINTED_SCOPES carries the reason.
//
// ⚠️ It is NOT narrowable: `ownerScope(A_MEMBER_SCOPE)` returns `null`, which is what makes it
// impossible to pass to `archiveProfile` without a cast — the compile-time half, asserted below.
const A_MEMBER_SCOPE = householdScopeForScript(households[0].id, HOUSEHOLD_ROLE.member);

// ── TEN-1 chunk 1a: households.synthetic — the OBS-2 flag, shipped dark (migration 0014) ─────────
// Deliberately NOT a bare `assert.equal(households[0].synthetic, false)`: that compares the column
// default to itself and stays green even if the migration shipped the column nullable with no
// default at all. These four assertions each catch something that can actually happen.
//
// (1) The declared type. Same idiom as the V1-18 routine_config check below.
assert.equal(
  (await columnsOf('households')).get('synthetic'),
  'boolean',
  'TEN-1 1a: households.synthetic is boolean',
);
// (2) NOT NULL + the catalog default. `columnsOf` carries data_type only, and `expectRejectedBy`
// cannot reach this either (a NOT NULL violation is 23502, which carries a column, not a named
// constraint). This is the half that guarantees prod's pre-existing household row acquired `false`
// rather than NULL, and that the stored default has not drifted from drizzle's `.default(false)`.
// (TEN-2a: this readback moved into `columnCatalogShape` when TEN-2a became its second consumer —
// same assertions, one less inline `information_schema` cast.)
const syntheticCol = await columnCatalogShape('households', 'synthetic');
assert.equal(syntheticCol?.is_nullable, 'NO', 'TEN-1 1a: households.synthetic is NOT NULL');
assert.equal(
  syntheticCol?.column_default,
  'false',
  'TEN-1 1a: households.synthetic DEFAULTs false in the catalog (not just in schema.ts)',
);
// (3) THE ASSERTION THAT IS NOT A TAUTOLOGY: a set flag survives a re-seed. migrate.yml runs
// `db:seed` against PROD on every push to main, so if the households insert ever became
// `onConflictDoUpdate`, every unrelated merge would silently reset a synthetic household's flag —
// destroying the one property OBS-2 depends on. The seed ran twice above; flip the flag, seed a
// THIRD time, and prove the value held.
await db
  .update(schema.households)
  .set({ synthetic: true })
  .where(eq(schema.households.publicId, SEED_HOUSEHOLD_PUBLIC_ID));
await seed(asPg);
const [afterReseed] = await db
  .select({ synthetic: schema.households.synthetic })
  .from(schema.households)
  .where(eq(schema.households.publicId, SEED_HOUSEHOLD_PUBLIC_ID));
assert.equal(
  afterReseed?.synthetic,
  true,
  'TEN-1 1a: a set synthetic flag survives a re-seed (the households insert stays ON CONFLICT DO NOTHING)',
);
// (4) And the seed never flips it the other way either: restore, re-seed, still false. Together
// with (3) this pins "the seed does not name this column" in both directions — the rule that keeps
// a fresh/restored prod database from labelling the real family's household a test fixture.
await db
  .update(schema.households)
  .set({ synthetic: false })
  .where(eq(schema.households.publicId, SEED_HOUSEHOLD_PUBLIC_ID));
await seed(asPg);
const [afterRestore] = await db
  .select({ synthetic: schema.households.synthetic })
  .from(schema.households)
  .where(eq(schema.households.publicId, SEED_HOUSEHOLD_PUBLIC_ID));
assert.equal(
  afterRestore?.synthetic,
  false,
  'TEN-1 1a: the seed never sets synthetic — a re-seed leaves a real household false',
);
console.log(
  '✓ TEN-1 1a: households.synthetic — boolean NOT NULL DEFAULT false; the seed never names it (both directions)',
);

// V1-18 (PR 1a): the per-kid routine_config column + the two-kid A≠B seed.
assert.equal(
  (await columnsOf('profiles')).get('routine_config'),
  'jsonb',
  'V1-18: profiles.routine_config is jsonb',
);
const athleteOne = profiles.find((p) => p.publicId === SEED_PROFILE_PUBLIC_ID)!;
const athleteTwo = profiles.find((p) => p.publicId === SEED_PROFILE_2_PUBLIC_ID)!;
// A≠B on a fresh DB, and since ONB-0 BOTH are explicit.
//
// Athlete One used to be NULL here, deliberately, to demonstrate "NULL → the default routine". ONB-0 narrowed
// that default to `['strength']`, so NULL now means the NEUTRAL first-run routine — and a fixture that
// rode it would lose the habits and the brush-teeth metrics that `e2e/global.setup.ts` and the V0-11
// smoke both drive on this profile. So the seed writes the full catalog explicitly, and what gets proved
// here is the stronger property: no seeded fixture depends on a read-time default at all.
assert.ok(
  athleteOne.routineConfig != null,
  'ONB-0: profile 1 has an explicit routine_config (was NULL)',
);
assert.deepEqual(
  athleteOne.routineConfig,
  SEED_FULL_ROUTINE,
  'ONB-0: profile 1 is seeded with the explicit pre-ONB-0 full-catalog routine',
);
assert.ok(athleteTwo.routineConfig != null, 'V1-18: Athlete Two has an explicit routine_config');
assert.notDeepEqual(
  athleteOne.routineConfig,
  athleteTwo.routineConfig,
  'V1-18: the two seeded routines differ (A≠B, fresh DB)',
);
// Prove the stored config is GRAMMAR-VALID (a bad seed key fails loudly here, not silently on read).
assert.ok(
  routineConfigSchema.safeParse(athleteTwo.routineConfig).success,
  'V1-18: Athlete Two’s seeded routine_config parses against routineConfigSchema',
);
console.log('✓ V1-18: routine_config jsonb column; two-kid A≠B seed; stored config is valid');

// V1-18 (PR 2): the coach-editor WRITE path — prove a routine config round-trips through the jsonb column
// (drizzle UPDATE → reread → byte-identical), the DB half of `updateProfileRoutine`. The pure strict
// validation (`validateRoutineForWrite`) is unit-tested app-side; here we prove the column stores + returns
// the config unchanged.
//
// ONB-0: this used to get the NULL → set transition for free, because the seed left this profile NULL.
// It no longer does, so the NULL is set up EXPLICITLY rather than quietly dropping that coverage.
await db
  .update(schema.profiles)
  .set({ routineConfig: null })
  .where(eq(schema.profiles.publicId, SEED_PROFILE_PUBLIC_ID));
const [cleared] = await db
  .select({ routineConfig: schema.profiles.routineConfig })
  .from(schema.profiles)
  .where(eq(schema.profiles.publicId, SEED_PROFILE_PUBLIC_ID));
assert.equal(
  cleared?.routineConfig,
  null,
  'ONB-0: routine_config is nullable (NULL → set is reachable)',
);

const writeRoutine = {
  version: ROUTINE_VERSION,
  order: [{ key: 'strength' }, { key: 'checkin:rice_bucket' }],
} satisfies RoutineConfig;
await db
  .update(schema.profiles)
  .set({ routineConfig: writeRoutine })
  .where(eq(schema.profiles.publicId, SEED_PROFILE_PUBLIC_ID));
const [rewritten] = await db
  .select({ routineConfig: schema.profiles.routineConfig })
  .from(schema.profiles)
  .where(eq(schema.profiles.publicId, SEED_PROFILE_PUBLIC_ID));
assert.deepEqual(
  rewritten?.routineConfig,
  writeRoutine,
  'V1-18 (PR 2): routine_config write round-trips through jsonb unchanged',
);
assert.ok(
  routineConfigSchema.safeParse(rewritten?.routineConfig).success,
  'V1-18 (PR 2): the written routine_config re-parses against routineConfigSchema',
);
console.log('✓ V1-18 (PR 2): routine_config write round-trips through jsonb');

// Tagged-union CHECK: a bodyweight entry with no value_num must be rejected.
let rejected = false;
try {
  await db.insert(schema.entries).values({
    publicId: '019826b4-0000-7000-8000-0000000000aa',
    clientId: '019826b4-0000-7000-8000-0000000000ab',
    profileId: profiles[0].id,
    activityDate: '2026-07-18',
    kind: 'bodyweight',
    unit: 'lb',
  });
} catch {
  rejected = true;
}
assert.ok(rejected, 'shape CHECK rejects a bodyweight entry missing value_num');
console.log('✓ tagged-union CHECK enforced');

// V1-1a: a bad gate_color must be rejected by the day_readiness CHECK.
let gateRejected = false;
try {
  await db.insert(schema.dayReadiness).values({
    publicId: '019826b4-0000-7000-8000-0000000000ba',
    profileId: profiles[0].id,
    readinessDate: '2026-07-20',
    gateColor: 'purple', // not in GATE_COLORS
  });
} catch {
  gateRejected = true;
}
assert.ok(gateRejected, 'gate_color CHECK rejects a color outside GATE_COLORS');

// V1-1a: a bad input_shape must be rejected by the activity_types CHECK.
let shapeRejected = false;
try {
  await db.insert(schema.activityTypes).values({
    publicId: '019826b4-0000-7000-8000-0000000000bb',
    key: 'bad_shape_probe',
    label: 'Bad shape probe',
    category: categories[0].code,
    inputShape: 'bogus', // not in ACTIVITY_INPUT_SHAPES
  });
} catch {
  shapeRejected = true;
}
assert.ok(shapeRejected, 'input_shape CHECK rejects a shape outside ACTIVITY_INPUT_SHAPES');
console.log('✓ gate_color + input_shape CHECKs enforced');

// ── V1-1b: generalized entry columns + at-most-one CHECK + backfill logic ───────────

// The FULL V1-2 catalog is seeded (activity_types + metric_definitions + movements),
// idempotent across the two seed runs above.
const activityTypes = await db.select().from(schema.activityTypes);
const metricDefinitions = await db.select().from(schema.metricDefinitions);
const movements = await db.select().from(schema.movements);
assert.equal(
  activityTypes.length,
  ACTIVITY_TYPE_SEED_ROWS.length,
  'activity_types: full catalog seeded from the shared const, exactly once',
);
assert.equal(
  metricDefinitions.length,
  METRIC_DEFINITION_SEED_ROWS.length,
  'metric_definitions: full catalog seeded from the shared const, exactly once',
);
assert.equal(
  movements.length,
  MOVEMENT_SEED_ROWS.length,
  'movements: full catalog seeded from the shared const, exactly once',
);
console.log(
  `✓ full catalog seeded: ${activityTypes.length} activity_types, ${metricDefinitions.length} metric_definitions, ${movements.length} movements`,
);

// ── V1-2: catalog coverage block (runs after the count asserts, before the backfill sim) ──

// (1) zod pre-flight — every shared seed row parses against its row schema (a bad value in
// a catalog row fails HERE, not on a DB insert further along).
for (const row of ACTIVITY_TYPE_SEED_ROWS) activityTypeSeedRowSchema.parse(row);
for (const row of METRIC_DEFINITION_SEED_ROWS) metricDefinitionSeedRowSchema.parse(row);
for (const row of MOVEMENT_SEED_ROWS) movementSeedRowSchema.parse(row);
console.log('✓ catalog rows pass zod pre-flight');

// (2) V1-1b's 3 reused rows keep their FIXED public_ids (single-source, spread-not-redefined).
async function publicIdByActivityKey(key: string): Promise<string> {
  const [row] = await db
    .select({ publicId: schema.activityTypes.publicId })
    .from(schema.activityTypes)
    .where(eq(schema.activityTypes.key, key));
  assert.ok(row, `activity_type '${key}' is seeded`);
  return row.publicId;
}
assert.equal(
  await publicIdByActivityKey(SEED_ACTIVITY_TYPE_KEYS.weighIn),
  SEED_ACTIVITY_TYPE_WEIGH_IN_PUBLIC_ID,
  'reused weigh_in row keeps its fixed public_id (…020)',
);
assert.equal(
  await publicIdByActivityKey(SEED_ACTIVITY_TYPE_KEYS.scLift),
  SEED_ACTIVITY_TYPE_SC_LIFT_PUBLIC_ID,
  'reused sc_lift row keeps its fixed public_id (…021)',
);
const [bodyweightMetric] = await db
  .select({
    publicId: schema.metricDefinitions.publicId,
    aggregation: schema.metricDefinitions.aggregation,
  })
  .from(schema.metricDefinitions)
  .where(eq(schema.metricDefinitions.key, SEED_METRIC_KEYS.bodyweight));
assert.equal(
  bodyweightMetric.publicId,
  SEED_METRIC_BODYWEIGHT_PUBLIC_ID,
  'reused bodyweight metric keeps its fixed public_id (…030)',
);
console.log('✓ V1-1b reused rows keep fixed public_ids');

// (3) Walk ACTIVITY_METRIC_MAP — every activity key AND every metric key it lists resolves
// to a seeded row (the map can't reference a catalog row that does not exist).
const seededActivityKeys = new Set(activityTypes.map((r) => r.key));
const seededMetricKeys = new Set(metricDefinitions.map((r) => r.key));
for (const [activityKey, metricKeys] of Object.entries(ACTIVITY_METRIC_MAP)) {
  assert.ok(seededActivityKeys.has(activityKey), `map activity '${activityKey}' is a seeded row`);
  for (const metricKey of metricKeys) {
    assert.ok(
      seededMetricKeys.has(metricKey),
      `map metric '${metricKey}' (for '${activityKey}') is a seeded row`,
    );
  }
}
assert.equal(
  Object.keys(ACTIVITY_METRIC_MAP).length,
  activityTypes.length,
  'ACTIVITY_METRIC_MAP covers every seeded activity_type',
);
console.log('✓ ACTIVITY_METRIC_MAP resolves against the seeded catalog');

// (4) exactly ONE canonical `shot` metric (not double-modeled).
assert.equal(
  metricDefinitions.filter((r) => r.key === 'shot').length,
  1,
  'exactly one canonical shot metric',
);
// (5) `pullup_max` is a first-class metric with aggregation=max.
const [pullupMax] = await db
  .select({ aggregation: schema.metricDefinitions.aggregation })
  .from(schema.metricDefinitions)
  .where(eq(schema.metricDefinitions.key, 'pullup_max'));
assert.ok(pullupMax, 'pullup_max metric is seeded');
assert.equal(pullupMax.aggregation, 'max', 'pullup_max aggregation is max');
console.log('✓ canonical shot (exactly one) + pullup_max aggregation=max');

// (6) every movement slug is exactly `movementSlug(name)` (natural key ↔ DAL/backfill parity).
for (const row of MOVEMENT_SEED_ROWS) {
  assert.ok(
    movementSlugMatchesName(row),
    `movement slug '${row.slug}' === movementSlug('${row.name}')`,
  );
}
// (7) every MOVEMENT_PATTERN has ≥1 seeded movement (patterns fully covered).
const seededPatterns = new Set(movements.map((r) => r.pattern));
for (const pattern of MOVEMENT_PATTERNS) {
  assert.ok(seededPatterns.has(pattern), `movement pattern '${pattern}' has ≥1 seeded movement`);
}
console.log('✓ movement slug↔name parity + every pattern covered');

// (8) Round-trip ONE entry per input_shape — proving the tagged union carries every activity
// shape with NO bespoke per-activity column, each satisfying the at-most-one source CHECK.
// NB: the legacy V0 `entries_shape_check` (RETAINED past V1-1c; dropped at V1-1d) still forces
// kind∈{bodyweight,strength} + value_num/movement_name; that guard is incidental here — the assertion is on the
// GENERALIZED columns (activity_type_id + the at-most-one movement_id/metric_key + unit/event_at).
async function activityTypeIdByKey(key: string): Promise<number> {
  const [row] = await db
    .select({ id: schema.activityTypes.id })
    .from(schema.activityTypes)
    .where(eq(schema.activityTypes.key, key));
  assert.ok(row, `activity_type '${key}' resolves`);
  return row.id;
}
const [frontSquat] = await db
  .select({ id: schema.movements.id })
  .from(schema.movements)
  .where(eq(schema.movements.slug, 'front_squat'));
assert.ok(frontSquat, 'front_squat movement is seeded');

// set_list → movement_id (metric_key NULL)
await db.insert(schema.entries).values({
  publicId: '019826b4-0000-7000-8000-0000000000d0',
  clientId: '019826b4-0000-7000-8000-0000000000d1',
  profileId: profiles[0].id,
  activityDate: '2026-07-21',
  kind: 'strength', // legacy guard: strength needs movement_name
  unit: 'lb',
  movementName: 'Front Squat',
  activityTypeId: await activityTypeIdByKey('sc_lift'),
  movementId: frontSquat.id,
});
// single_metric → metric_key + value_num (movement_id NULL)
await db.insert(schema.entries).values({
  publicId: '019826b4-0000-7000-8000-0000000000d2',
  clientId: '019826b4-0000-7000-8000-0000000000d3',
  profileId: profiles[0].id,
  activityDate: '2026-07-21',
  kind: 'bodyweight',
  unit: 'lb',
  valueNum: '182',
  activityTypeId: await activityTypeIdByKey('weigh_in'),
  metricKey: SEED_METRIC_KEYS.bodyweight,
});
// boolean → NEITHER source column, unit=bool
await db.insert(schema.entries).values({
  publicId: '019826b4-0000-7000-8000-0000000000d4',
  clientId: '019826b4-0000-7000-8000-0000000000d5',
  profileId: profiles[0].id,
  activityDate: '2026-07-21',
  kind: 'bodyweight', // legacy guard needs value_num; the shape point is unit=bool + neither source
  unit: 'bool',
  valueNum: '1',
  activityTypeId: await activityTypeIdByKey('rice_bucket'),
});
// timing → NEITHER source column, event_at set
await db.insert(schema.entries).values({
  publicId: '019826b4-0000-7000-8000-0000000000d6',
  clientId: '019826b4-0000-7000-8000-0000000000d7',
  profileId: profiles[0].id,
  activityDate: '2026-07-21',
  kind: 'bodyweight',
  unit: 'timing',
  valueNum: '0',
  eventAt: new Date('2026-07-21T06:30:00Z'),
  activityTypeId: await activityTypeIdByKey('wake'),
});

async function roundTrip(publicId: string) {
  const [row] = await db
    .select({
      movementId: schema.entries.movementId,
      metricKey: schema.entries.metricKey,
      unit: schema.entries.unit,
      valueNum: schema.entries.valueNum,
      eventAt: schema.entries.eventAt,
    })
    .from(schema.entries)
    .where(eq(schema.entries.publicId, publicId));
  return row;
}
const setListRt = await roundTrip('019826b4-0000-7000-8000-0000000000d0');
assert.ok(setListRt.movementId != null, 'set_list entry carries movement_id');
assert.equal(setListRt.metricKey, null, 'set_list entry has no metric_key (at-most-one)');
const singleMetricRt = await roundTrip('019826b4-0000-7000-8000-0000000000d2');
assert.equal(
  singleMetricRt.metricKey,
  SEED_METRIC_KEYS.bodyweight,
  'single_metric entry: metric_key',
);
assert.ok(singleMetricRt.valueNum != null, 'single_metric entry carries value_num');
assert.equal(
  singleMetricRt.movementId,
  null,
  'single_metric entry has no movement_id (at-most-one)',
);
const booleanRt = await roundTrip('019826b4-0000-7000-8000-0000000000d4');
assert.equal(booleanRt.movementId, null, 'boolean entry: neither source (movement_id)');
assert.equal(booleanRt.metricKey, null, 'boolean entry: neither source (metric_key)');
assert.equal(booleanRt.unit, 'bool', 'boolean entry: unit=bool');
const timingRt = await roundTrip('019826b4-0000-7000-8000-0000000000d6');
assert.equal(timingRt.movementId, null, 'timing entry: neither source (movement_id)');
assert.equal(timingRt.metricKey, null, 'timing entry: neither source (metric_key)');
assert.ok(timingRt.eventAt != null, 'timing entry carries event_at');
console.log('✓ round-trip one entry per input_shape (all satisfy the at-most-one CHECK)');

// (9) NO bespoke column: `entries` has no json/jsonb column and no column named after any
// activity key (proves the tagged union, not an EAV/per-activity-column sprawl).
const entryCols = await columnsOf('entries');
for (const [name, dataType] of entryCols) {
  assert.ok(
    dataType !== 'json' && dataType !== 'jsonb',
    `entries.${name} is not json/jsonb (no EAV)`,
  );
}
for (const key of Object.keys(ACTIVITY_METRIC_MAP)) {
  assert.ok(!entryCols.has(key), `no bespoke per-activity column named '${key}'`);
}
console.log(
  '✓ no bespoke column: entries is a tagged union (no json/jsonb, no per-activity column)',
);

// Resolve the two activity_type ids the backfill maps onto.
const [weighIn] = await db
  .select({ id: schema.activityTypes.id })
  .from(schema.activityTypes)
  .where(eq(schema.activityTypes.key, SEED_ACTIVITY_TYPE_KEYS.weighIn));
const [scLift] = await db
  .select({ id: schema.activityTypes.id })
  .from(schema.activityTypes)
  .where(eq(schema.activityTypes.key, SEED_ACTIVITY_TYPE_KEYS.scLift));

// Insert legacy-shaped v0 rows (generalized cols NULL), then RE-RUN migration 0002's
// backfill: the migration's one-time backfill saw an empty table on this fresh PGlite,
// so we replicate its guarded (idempotent) statements to prove the backfill LOGIC resolves.
// V1-1c note: these pre-backfill rows carry activity_type_id NULL, which the V1-1c invariant
// (entries_activity_type_id_not_null) now forbids. That is faithful to the DEPLOY ORDER — 0002's
// backfill runs BEFORE 0003 adds the CHECK — so we reproduce it here: drop the CHECK, run the
// backfill sim, then re-add it (NOT VALID → VALIDATE) against the now-backfilled rows.
//
// 🔴 **TEN-2c added a SECOND constraint to the same dance, for the same reason, and it took TWO
// fixes rather than one — measured, not reasoned.** 0017 drops `movements_slug_unique` and adds
// `movements_global_row_has_pattern`. The raw `INSERT INTO "movements" … ON CONFLICT ("slug")` below
// is 0002's backfill verbatim, and it died **twice** against the post-0017 schema:
//
//  1. `42P10` — a bare `ON CONFLICT ("slug")` can only infer a NON-PARTIAL unique index, and after
//     0017 there is none. The arbiter below therefore carries `WHERE "household_id" IS NULL`, which
//     implies `uq_movements_slug_global`'s predicate. ⚠️ A fidelity compromise, stated: 0002's real
//     statement had no such clause. The alternative is no simulation at all.
//  2. `23514` — the rows it inserts are `household_id NULL` **and** `pattern NULL`, which the new
//     CHECK forbids. The planner resolves the arbiter before any row is inserted, which is why
//     `42P10` comes first and why fixing only the arbiter just moves the failure.
//
// Giving those fixture rows a `pattern` instead would be wrong: the discriminator at
// "TEN-2a discriminator (2/3)" requires every app-authored row to have `pattern IS NULL`, and these
// rows are app-authored by construction. So the CHECK joins the drop → sim → re-add `NOT VALID`
// shape this block already uses — which is also faithful to the deploy order, since 0017 genuinely
// post-dates 0002. ⚠️ **That re-add is why `convalidated` is read right after `migrate()`** (see the
// TEN-2c block up there): from here on, a `convalidated` read measures THIS re-add, not 0017's.
await db.execute(
  sql`ALTER TABLE "movements" DROP CONSTRAINT ${sql.identifier(schema.MOVEMENT_GLOBAL_ROW_HAS_PATTERN_CHECK)}`,
);
await db.execute(sql`ALTER TABLE "entries" DROP CONSTRAINT "entries_activity_type_id_not_null"`);
await db.insert(schema.entries).values({
  publicId: '019826b4-0000-7000-8000-0000000000c1',
  clientId: '019826b4-0000-7000-8000-0000000000c2',
  profileId: profiles[0].id,
  activityDate: '2026-07-19',
  kind: 'bodyweight',
  unit: 'lb',
  valueNum: '180', // legacy shape guard requires value_num for bodyweight
});
await db.insert(schema.entries).values({
  publicId: '019826b4-0000-7000-8000-0000000000c3',
  clientId: '019826b4-0000-7000-8000-0000000000c4',
  profileId: profiles[0].id,
  activityDate: '2026-07-19',
  kind: 'strength',
  unit: 'lb',
  movementName: 'Back Squat', // slug → back_squat (movementSlug parity with the SQL)
});

await db.execute(sql`
  INSERT INTO "movements" ("public_id", "slug", "name", "is_bodyweight")
  SELECT gen_random_uuid(), lower(regexp_replace(btrim("movement_name"), '\s+', '_', 'g')), "movement_name", false
  FROM (SELECT DISTINCT "movement_name" FROM "entries"
        WHERE "kind" = 'strength' AND "movement_name" IS NOT NULL AND "deleted_at" IS NULL) d
  ON CONFLICT ("slug") WHERE "household_id" IS NULL DO NOTHING`);
await db.execute(sql`
  UPDATE "entries" SET
    "activity_type_id" = (SELECT "id" FROM "activity_types" WHERE "key" = 'weigh_in'),
    "metric_key" = 'bodyweight'
  WHERE "kind" = 'bodyweight' AND "activity_type_id" IS NULL`);
await db.execute(sql`
  UPDATE "entries" AS e SET
    "activity_type_id" = (SELECT "id" FROM "activity_types" WHERE "key" = 'sc_lift'),
    "movement_id" = m."id"
  FROM "movements" m
  WHERE m."slug" = lower(regexp_replace(btrim(e."movement_name"), '\s+', '_', 'g'))
    AND e."kind" = 'strength' AND e."activity_type_id" IS NULL`);
// Re-establish the V1-1c invariant now that every row is backfilled (reproduces 0003's
// NOT VALID → VALIDATE against the just-backfilled rows — all now carry activity_type_id).
await db.execute(
  sql`ALTER TABLE "entries" ADD CONSTRAINT "entries_activity_type_id_not_null" CHECK ("activity_type_id" IS NOT NULL) NOT VALID`,
);
await db.execute(
  sql`ALTER TABLE "entries" VALIDATE CONSTRAINT "entries_activity_type_id_not_null"`,
);
// TEN-2c: and the CHECK 0017 added, back as `NOT VALID` — the shape 0017 ships. ⚠️ **NOT** `VALIDATE`d
// here: the rows this simulation just inserted are global with `pattern IS NULL`, i.e. exactly what
// TEN-2d's `VALIDATE` will have to deal with in production, and validating them away here would make
// this file quietly stronger than the database. ⚠️ Nothing may assert `convalidated` on this
// constraint below this line — it would measure this statement rather than the migration; the read
// that matters is immediately after `migrate()`.
await db.execute(
  sql`ALTER TABLE "movements" ADD CONSTRAINT ${sql.identifier(schema.MOVEMENT_GLOBAL_ROW_HAS_PATTERN_CHECK)} CHECK ("household_id" IS NOT NULL OR "pattern" IS NOT NULL) NOT VALID`,
);

const [bwEntry] = await db
  .select({
    activityTypeId: schema.entries.activityTypeId,
    metricKey: schema.entries.metricKey,
    movementId: schema.entries.movementId,
  })
  .from(schema.entries)
  .where(eq(schema.entries.publicId, '019826b4-0000-7000-8000-0000000000c1'));
assert.equal(
  bwEntry.metricKey,
  SEED_METRIC_KEYS.bodyweight,
  'bodyweight backfill → metric_key=bodyweight',
);
assert.equal(bwEntry.activityTypeId, weighIn.id, 'bodyweight backfill → weigh_in activity');
assert.equal(bwEntry.movementId, null, 'bodyweight backfill leaves movement_id NULL (at-most-one)');

const [stEntry] = await db
  .select({
    activityTypeId: schema.entries.activityTypeId,
    metricKey: schema.entries.metricKey,
    movementId: schema.entries.movementId,
  })
  .from(schema.entries)
  .where(eq(schema.entries.publicId, '019826b4-0000-7000-8000-0000000000c3'));
assert.ok(stEntry.movementId != null, 'strength backfill → non-null movement_id');
assert.equal(stEntry.activityTypeId, scLift.id, 'strength backfill → sc_lift activity');
assert.equal(stEntry.metricKey, null, 'strength backfill leaves metric_key NULL (at-most-one)');
console.log('✓ v0-entry backfill resolves (bodyweight→metric, strength→movement)');

// at-most-one CHECK REJECTS an insert with BOTH movement_id and metric_key set.
let bothRejected = false;
try {
  await db.insert(schema.entries).values({
    publicId: '019826b4-0000-7000-8000-0000000000c5',
    clientId: '019826b4-0000-7000-8000-0000000000c6',
    profileId: profiles[0].id,
    activityDate: '2026-07-19',
    kind: 'strength',
    unit: 'lb',
    movementName: 'Back Squat',
    movementId: stEntry.movementId, // both source columns set → must violate the CHECK
    metricKey: SEED_METRIC_KEYS.bodyweight,
  });
} catch {
  bothRejected = true;
}
assert.ok(bothRejected, 'entries_value_source_check rejects BOTH movement_id and metric_key set');

// at-most-one CHECK ALLOWS an insert with NEITHER set (boolean/timing activities — decision 1).
await db.insert(schema.entries).values({
  publicId: '019826b4-0000-7000-8000-0000000000c7',
  clientId: '019826b4-0000-7000-8000-0000000000c8',
  profileId: profiles[0].id,
  activityDate: '2026-07-19',
  kind: 'bodyweight', // legacy shape guard satisfied via value_num; both source cols NULL
  unit: 'lb',
  valueNum: '181',
  activityTypeId: weighIn.id,
});
console.log('✓ at-most-one CHECK: rejects both source cols, allows neither');

// ── V1-1c: kind relaxed to NULLABLE (unblocks metric-only check-ins) + activity_type_id NOT NULL ──

// (a) A `kind`-less metric-only check-in inserts + round-trips. This is the row V1-1c unblocks: a
// rice_bucket check-in carries NO kind, unit='bool', a bool-typed metric (stance), and its reading
// in value_num. Why value_num is set: entries_shape_check is RETAINED, and Postgres 3-valued logic
// only lets a kind=NULL row PASS it when no sub-predicate is FALSE — a NULL kind alone makes the
// expression NULL (→ pass), but a NULL value_num makes `value_num is not null` FALSE, forcing the
// whole CHECK FALSE (→ reject). Every seeded metric is numeric (bool/count/duration/scale_10/number
// → value_num), so a real metric entry always carries value_num (V1-1b's boolean row did the same).
await db.insert(schema.entries).values({
  publicId: '019826b4-0000-7000-8000-0000000000e0',
  clientId: '019826b4-0000-7000-8000-0000000000e1',
  profileId: profiles[0].id,
  activityDate: '2026-07-22',
  unit: 'bool',
  activityTypeId: await activityTypeIdByKey('rice_bucket'),
  metricKey: 'stance', // seeded value_type='bool' metric
  valueNum: '1', // the bool reading (numeric); NOT kind — the point of V1-1c is the absent kind
  // no `kind` — the row V1-1c unblocks
});
const [checkin] = await db
  .select({
    kind: schema.entries.kind,
    activityTypeId: schema.entries.activityTypeId,
    movementId: schema.entries.movementId,
    metricKey: schema.entries.metricKey,
  })
  .from(schema.entries)
  .where(eq(schema.entries.publicId, '019826b4-0000-7000-8000-0000000000e0'));
assert.equal(checkin.kind, null, 'V1-1c: kind-less check-in row has kind IS NULL');
assert.ok(checkin.activityTypeId != null, 'V1-1c: check-in row carries activity_type_id');
assert.equal(checkin.metricKey, 'stance', 'V1-1c: check-in row carries its bool metric_key');
assert.equal(checkin.movementId, null, 'V1-1c: check-in row has no movement_id (at-most-one)');
console.log('✓ V1-1c: kind-less metric-only check-in inserts + round-trips (kind IS NULL)');

// (b) The discriminant invariant: a row WITHOUT activity_type_id is rejected by
// entries_activity_type_id_not_null (the hand-added CHECK, mirroring household_id). The row is
// otherwise VALID (kind NULL + value_num set → shape CHECK passes; movement_id NULL → at-most-one
// passes) so the rejection isolates the discriminant guard — asserted by the constraint NAME.
await expectRejectedBy('entries_activity_type_id_not_null', () =>
  db.insert(schema.entries).values({
    publicId: '019826b4-0000-7000-8000-0000000000e2',
    clientId: '019826b4-0000-7000-8000-0000000000e3',
    profileId: profiles[0].id,
    activityDate: '2026-07-22',
    unit: 'bool',
    activityTypeId: null, // violates the discriminant NOT-NULL guard
    metricKey: 'stance',
    valueNum: '1',
  }),
);
console.log('✓ V1-1c: activity_type_id NOT-NULL guard enforced');

// ── V1-5: the check-in write shape (a bare habit) + the shape-CHECK boundary ──────

// (a) A bare HABIT row: kind NULL and NEITHER source column set (no metric_key, no
// movement_id) — the shape V1-5 introduces. The V1-1c block above covers a kind-less
// row WITH a metric; this covers the neither-source case the habit checkboxes write.
await db.insert(schema.entries).values({
  publicId: '019826b4-0000-7000-8000-0000000000e4',
  clientId: '019826b4-0000-7000-8000-0000000000e5',
  profileId: profiles[0].id,
  activityDate: '2026-07-22',
  unit: 'bool',
  activityTypeId: await activityTypeIdByKey('rice_bucket'),
  valueNum: '1', // the checked box; REQUIRED — see (b)
  // no kind, no metric_key, no movement_id, no movement_name
});
const [habit] = await db
  .select({
    kind: schema.entries.kind,
    metricKey: schema.entries.metricKey,
    movementId: schema.entries.movementId,
    valueNum: schema.entries.valueNum,
  })
  .from(schema.entries)
  .where(eq(schema.entries.publicId, '019826b4-0000-7000-8000-0000000000e4'));
assert.equal(habit.kind, null, 'V1-5: bare habit row has kind IS NULL');
assert.equal(habit.metricKey, null, 'V1-5: bare habit row has no metric_key');
assert.equal(habit.movementId, null, 'V1-5: bare habit row has no movement_id');
assert.equal(Number(habit.valueNum), 1, 'V1-5: a checked habit is encoded as value_num = 1');
console.log('✓ V1-5: bare habit (kind NULL, NEITHER source col) inserts + round-trips');

// (b) THE TRAP, pinned by constraint NAME. entries_shape_check is retained until V1-1d.
// With kind NULL it passes only while no sub-predicate is FALSE — so a kind-less row with
// value_num NULL *and* movement_name NULL is REJECTED. This is why every check-in must
// carry value_num (a bool is 1) and must never set movement_name. If this assertion ever
// fails, the DAL's encoding assumption has changed and logCheckinEntries must be revisited.
const riceBucketId = await activityTypeIdByKey('rice_bucket');
await expectRejectedBy('entries_shape_check', () =>
  db.insert(schema.entries).values({
    publicId: '019826b4-0000-7000-8000-0000000000e6',
    clientId: '019826b4-0000-7000-8000-0000000000e7',
    profileId: profiles[0].id,
    activityDate: '2026-07-22',
    unit: 'bool',
    activityTypeId: riceBucketId,
    // no valueNum and no movementName → the CHECK evaluates FALSE
  }),
);
console.log('✓ V1-5: shape CHECK rejects a kind-less check-in missing value_num');

// CHECK ↔ shared-const parity: each DB text-enum CHECK definition must list EVERY member of
// its shared const (pins the schema CHECKs to the single source of truth — one can't drift
// from the other without this failing). V1-2 extends this from input_shape to the movement
// pattern + metric value_type/aggregation CHECKs (their columns are now catalog-populated).
async function assertCheckCoversConst(conname: string, values: readonly string[]): Promise<void> {
  const res = await db.execute(sql`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${conname}`);
  const rows = (res as unknown as { rows: { def: string }[] }).rows;
  assert.equal(rows.length, 1, `${conname} exists`);
  const def = rows[0].def;
  for (const value of values) {
    assert.ok(def.includes(`'${value}'`), `${conname} includes shared const member '${value}'`);
  }
  // BOTH directions: the CHECK's accepted set must equal the shared const EXACTLY — an inlined literal the
  // const doesn't have (a misspelling, or a value the app can't map) is drift the coverage loop above misses.
  // pg_get_constraintdef quotes enum literals with single quotes (identifiers use double quotes), so every
  // single-quoted token IS an accepted value.
  const inlined = [...new Set([...def.matchAll(/'([^']*)'/g)].map((m) => m[1]))].sort();
  assert.deepEqual(
    inlined,
    [...values].sort(),
    `${conname} accepts EXACTLY its shared const (no extra/misspelled literal)`,
  );
}
// GAP-3 — the DB CHECK and the shared UNIT_DIMENSIONS const must agree EXACTLY, in both directions.
// Without this the column is a convention with a CHECK beside it rather than a single source of truth.
// ── GAP-3: quantity_slots + entry_set_quantities ──────────────────────────────────────────────────
// The typed replacement for the free-text `weight_label`. These proofs are the REASON this design was
// chosen over fixed columns, so they run the guard rather than asserting it in prose.
{
  const slots = await db.select().from(schema.quantitySlots);
  assertRefTableMatches(
    'quantity_slots',
    slots.map((r) => ({ code: r.code, dimension: r.dimension })),
    QUANTITY_SLOT_ROWS.map((r) => ({ code: r.code, dimension: r.dimension })),
  );
  // Seeded TWICE by the harness above — the PK is the (code, dimension) pair, so a second run must
  // conflict-do-nothing rather than double the table.
  assert.equal(
    slots.length,
    QUANTITY_SLOT_ROWS.length,
    'quantity_slots is idempotent across two seed runs',
  );
  // `primary` at three dimensions is the whole point of the composite PK: a back squat's mass, a broad
  // jump's length and a hold's duration are all "the thing this movement measures".
  assert.equal(
    slots.filter((r) => r.code === QUANTITY_SLOT.primary).length,
    3,
    'primary is legal at mass, length AND time (the panel finding that killed a mass-pinned primary)',
  );
  console.log('✓ GAP-3: quantity_slots seeded from the shared const, idempotent');
}

await assertCheckCoversConst('quantity_slots_dimension_check', UNIT_DIMENSIONS);

// The free-text columns are GONE. Asserted explicitly: the whole arc's acceptance criterion is that no
// free-text load is REPRESENTABLE, and a surviving column would silently make that false.
{
  const cols = await columnsOf('entry_sets');
  for (const dropped of ['weight_num', 'weight_label', 'seconds']) {
    assert.ok(!cols.has(dropped), `entry_sets.${dropped} was dropped (GAP-3 contract)`);
  }
  assert.equal(cols.get('is_bodyweight'), 'boolean', 'entry_sets.is_bodyweight exists');
  assert.equal(cols.get('is_band'), 'boolean', 'entry_sets.is_band exists');
  console.log('✓ GAP-3: the free-text load columns no longer exist');
}

await assertCheckCoversConst('units_dimension_check', UNIT_DIMENSIONS);
await assertCheckCoversConst('activity_types_input_shape_check', ACTIVITY_INPUT_SHAPES);
await assertCheckCoversConst('movements_pattern_check', MOVEMENT_PATTERNS);
await assertCheckCoversConst('metric_definitions_value_type_check', METRIC_VALUE_TYPES);
await assertCheckCoversConst('metric_definitions_aggregation_check', METRIC_AGGREGATIONS);
console.log(
  '✓ schema-CHECK ↔ shared-const parity (input_shape, movement pattern, metric value_type + aggregation)',
);

// ── V1-6b-1: ramp_targets table + SQL weekly-adherence parity against foldAggregation ──────

// The empty ramp schedule seeds ZERO ramp_targets (the seed ran twice above); assert that so a
// future non-empty schedule that regresses idempotency shows up here, not in prod.
const seededRampTargets = await db.select().from(schema.rampTargets);
assert.equal(
  seededRampTargets.length,
  0,
  'V1-6b-1: empty CALISTHENICS_RAMP_SCHEDULE seeds zero ramp_targets (idempotent, no duplicates)',
);
console.log('✓ V1-6b-1: empty ramp schedule seeds zero rows (seed idempotent)');

// Guard the sum/max assumption the weekly SQL adherence rests on: EVERY calisthenics metric must
// aggregate by `sum` or `max` (a future `avg`/`last` calisthenics metric would silently break the
// weekly rollup, which only computes SUM + MAX). Pins the assumption to the seed catalog.
const aggByMetricKey = new Map(metricDefinitions.map((m) => [m.key, m.aggregation]));
for (const key of CALISTHENICS_METRIC_KEYS) {
  const agg = aggByMetricKey.get(key);
  // Reuse the SAME {sum,max} membership guard the read DAL's mapper uses (it throws on avg/last),
  // so the domain lives in one place — a future avg/last calisthenics metric fails here, not in prod.
  assert.doesNotThrow(
    () => assertRollupAggregation(agg as MetricAggregation),
    `V1-6b-1: calisthenics metric '${key}' aggregation ∈ {sum,max} (weekly adherence assumes it), got '${agg}'`,
  );
}
console.log('✓ V1-6b-1: every calisthenics metric aggregates by sum or max');

// A dedicated TEST profile + a clearly TEST-ONLY week (2026-01-05 = a Monday) that is NOT in the
// (empty) schedule, so the fixture is fully self-contained and can never collide with seed data.
const RAMP_TEST_WEEK_START = '2026-01-05'; // ISO-week Monday, UTC
const [rampTestProfile] = await db
  .insert(schema.profiles)
  .values({
    publicId: '019826b4-0000-7000-8000-0000000000f0',
    name: 'Ramp Test Kid',
    kind: PROFILE_KIND.kid,
    householdId: households[0].id,
  })
  .returning({ id: schema.profiles.id });
const calisthenicsId = await activityTypeIdByKey('calisthenics');

// Seed a ramp_target per calisthenics metric for the test profile/week (the mechanism the seed
// uses; here with concrete numbers so the join has a target to return).
const RAMP_TEST_TARGETS: Record<string, number> = {
  [METRIC_KEYS.pushups]: 45,
  [METRIC_KEYS.pullups]: 12,
  [METRIC_KEYS.vsit_crunch]: 40,
  [METRIC_KEYS.vsit_skill_step]: 6,
};
await db.insert(schema.rampTargets).values(
  CALISTHENICS_METRIC_KEYS.map((metricKey) => ({
    publicId: `019826b4-0000-7000-8000-0000000000${metricKey === METRIC_KEYS.pushups ? 'f1' : metricKey === METRIC_KEYS.pullups ? 'f2' : metricKey === METRIC_KEYS.vsit_crunch ? 'f3' : 'f4'}`,
    profileId: rampTestProfile.id,
    metricKey,
    weekStart: RAMP_TEST_WEEK_START,
    targetValue: String(RAMP_TEST_TARGETS[metricKey]),
  })),
);

// Real in-week calisthenics bouts (kind-NULL count entries — the V1-6a write shape):
//   pushups: 20, 30  → SUM = 50  (= foldAggregation('sum', [20,30]))
//   vsit_skill_step: 3, 5, 4  → MAX = 5  (= foldAggregation('max', [3,5,4]))
// plus three DECOYS that the adherence filters MUST exclude.
let entryProbe = 0;
async function insertCalisthenicsBout(args: {
  metricKey: string;
  value: number;
  activityDate: string;
  status?: (typeof ENTRY_STATUS)[keyof typeof ENTRY_STATUS];
  softDeleted?: boolean;
  /** TEN-1 1b: whose bout. Defaults to the ramp-test kid, which every V1-6b case below wants; the
   *  TEN-1 matrix passes the OTHER household's profile so both sides of it have something to find.
   *  Ids come from this builder's own counter, so a second caller can never collide with the
   *  hand-assigned ids elsewhere in this file (the plan's R5(4)). */
  profileId?: number;
}): Promise<void> {
  const tag = (0x10 + entryProbe++).toString(16); // f-block probe ids
  await db.insert(schema.entries).values({
    publicId: `019826b4-0000-7000-8000-0000000001${tag}`,
    clientId: `019826b4-0000-7000-8000-0000000002${tag}`,
    profileId: args.profileId ?? rampTestProfile.id,
    activityDate: args.activityDate,
    unit: 'count',
    activityTypeId: calisthenicsId,
    metricKey: args.metricKey,
    valueNum: String(args.value),
    status: args.status ?? ENTRY_STATUS.done,
    deletedAt: args.softDeleted ? new Date('2026-01-06T00:00:00Z') : null,
  });
}
await insertCalisthenicsBout({
  metricKey: METRIC_KEYS.pushups,
  value: 20,
  activityDate: '2026-01-05',
});
await insertCalisthenicsBout({
  metricKey: METRIC_KEYS.pushups,
  value: 30,
  activityDate: '2026-01-07',
});
await insertCalisthenicsBout({
  metricKey: METRIC_KEYS.vsit_skill_step,
  value: 3,
  activityDate: '2026-01-05',
});
await insertCalisthenicsBout({
  metricKey: METRIC_KEYS.vsit_skill_step,
  value: 5,
  activityDate: '2026-01-06',
});
await insertCalisthenicsBout({
  metricKey: METRIC_KEYS.vsit_skill_step,
  value: 4,
  activityDate: '2026-01-08',
});
// DECOY 1 — next week (>= weekStart+7): excluded by the date range.
await insertCalisthenicsBout({
  metricKey: METRIC_KEYS.pushups,
  value: 999,
  activityDate: '2026-01-12',
});
// DECOY 2 — skipped bout: excluded by status='done'.
await insertCalisthenicsBout({
  metricKey: METRIC_KEYS.pushups,
  value: 888,
  activityDate: '2026-01-06',
  status: ENTRY_STATUS.skipped,
});
// DECOY 3 — soft-deleted bout: excluded by deleted_at IS NULL.
await insertCalisthenicsBout({
  metricKey: METRIC_KEYS.pushups,
  value: 777,
  activityDate: '2026-01-06',
  softDeleted: true,
});

// THE ADHERENCE AGGREGATE (SQL, not in-memory): SUM + MAX per metric over the in-week, done,
// non-deleted calisthenics entries for this profile. `week_start <= activity_date < week_start+7`.
const weekEndExclusive = sql`${schema.rampTargets.weekStart} + ${WEEK_LENGTH_DAYS}::int`; // date + int = date
const adherence = await db
  .select({
    metricKey: schema.entries.metricKey,
    actualSum: sum(schema.entries.valueNum),
    actualMax: max(schema.entries.valueNum),
  })
  .from(schema.entries)
  .where(
    and(
      eq(schema.entries.profileId, rampTestProfile.id),
      eq(schema.entries.activityTypeId, calisthenicsId),
      eq(schema.entries.status, ENTRY_STATUS.done),
      isNull(schema.entries.deletedAt),
      gte(schema.entries.activityDate, RAMP_TEST_WEEK_START),
      lt(
        schema.entries.activityDate,
        sql`${RAMP_TEST_WEEK_START}::date + ${WEEK_LENGTH_DAYS}::int`,
      ),
    ),
  )
  .groupBy(schema.entries.metricKey);

const byMetric = new Map(adherence.map((r) => [r.metricKey, r]));
// Exactly two metrics have in-week done readings — the three pushups decoys added NO extra group.
assert.equal(
  adherence.length,
  2,
  'V1-6b-1: only pushups + vsit_skill_step have in-week done readings',
);

const pushupsAgg = byMetric.get(METRIC_KEYS.pushups);
assert.ok(pushupsAgg, 'V1-6b-1: pushups adherence row present');
// SUM(pushups) === 50 === foldAggregation('sum',[20,30]); the 999/888/777 decoys are all excluded.
assert.equal(Number(pushupsAgg.actualSum), 50, 'V1-6b-1: SUM(pushups) = 50 (decoys excluded)');
assert.equal(
  Number(pushupsAgg.actualSum),
  foldAggregation(METRIC_AGGREGATION.sum, [20, 30]),
  'V1-6b-1: SQL SUM(pushups) === foldAggregation(sum,[20,30]) — golden-vector parity',
);

const vsitAgg = byMetric.get(METRIC_KEYS.vsit_skill_step);
assert.ok(vsitAgg, 'V1-6b-1: vsit_skill_step adherence row present');
assert.equal(Number(vsitAgg.actualMax), 5, 'V1-6b-1: MAX(vsit_skill_step) = 5');
assert.equal(
  Number(vsitAgg.actualMax),
  foldAggregation(METRIC_AGGREGATION.max, [3, 5, 4]),
  'V1-6b-1: SQL MAX(vsit_skill_step) === foldAggregation(max,[3,5,4]) — golden-vector parity',
);
console.log(
  '✓ V1-6b-1: weekly SQL adherence === foldAggregation golden vectors (SUM pushups=50, MAX vsit_skill_step=5; decoys excluded)',
);

// The ramp_target JOIN returns the seeded target alongside the actual — the shape V1-6b-2's DAL
// reads (actual weekly performance vs target, joined on profile/metric/week, all in SQL).
const [joined] = await db
  .select({
    metricKey: schema.rampTargets.metricKey,
    target: schema.rampTargets.targetValue,
    actual: sum(schema.entries.valueNum),
  })
  .from(schema.rampTargets)
  .innerJoin(
    schema.entries,
    and(
      eq(schema.entries.profileId, schema.rampTargets.profileId),
      eq(schema.entries.metricKey, schema.rampTargets.metricKey),
      eq(schema.entries.activityTypeId, calisthenicsId),
      eq(schema.entries.status, ENTRY_STATUS.done),
      isNull(schema.entries.deletedAt),
      gte(schema.entries.activityDate, schema.rampTargets.weekStart),
      lt(schema.entries.activityDate, weekEndExclusive),
    ),
  )
  .where(
    and(
      eq(schema.rampTargets.profileId, rampTestProfile.id),
      eq(schema.rampTargets.metricKey, METRIC_KEYS.pushups),
      isNull(schema.rampTargets.deletedAt),
    ),
  )
  .groupBy(schema.rampTargets.metricKey, schema.rampTargets.targetValue);
assert.ok(joined, 'V1-6b-1: ramp_target ⋈ entries join returns a row for pushups');
assert.equal(Number(joined.actual), 50, 'V1-6b-1: joined actual pushups = 50');
assert.equal(
  Number(joined.target),
  45,
  'V1-6b-1: ramp_target join returns the seeded pushups target (45)',
);
console.log('✓ V1-6b-1: ramp_target ⋈ entries join returns actual (50) alongside target (45)');

// ── V1-6b-2: the read DAL's EXACT query (weeklyAdherenceRows), proven here ────────────────────
// The app DAL and this proof call the SAME function (single-sourced in src/queries), so the
// LEFT-JOIN + profile/label joins + zero-bout NULL-actual paths the DAL ships are covered on real
// SQL — not the different (INNER, sum-only) shape the b-1 block above pins.
const RAMP_TEST_PROFILE_PUBLIC_ID = '019826b4-0000-7000-8000-0000000000f0'; // rampTestProfile above
const dalRows = await weeklyAdherenceRows(asPg, {
  profilePublicId: RAMP_TEST_PROFILE_PUBLIC_ID,
  weekStart: RAMP_TEST_WEEK_START,
  activityTypeId: calisthenicsId,
  metricKeys: CALISTHENICS_METRIC_KEYS,
  scope: A_SCOPE,
});
const dalByMetric = new Map(dalRows.map((r) => [r.metricKey, r]));
// Targets DRIVE the rows: all four calisthenics metrics have a target this week → four rows.
assert.equal(dalRows.length, 4, 'V1-6b-2: one row per calisthenics target for the week');

const dalPush = dalByMetric.get(METRIC_KEYS.pushups);
assert.ok(dalPush, 'V1-6b-2: pushups row present');
assert.equal(assertRollupAggregation(dalPush.aggregation as MetricAggregation), 'sum');
assert.equal(
  Number(dalPush.actualSum),
  50,
  'V1-6b-2: pushups actualSum = 50 (LEFT JOIN, decoys excluded)',
);
assert.equal(Number(dalPush.target), 45, 'V1-6b-2: pushups target = 45');
assert.equal(dalPush.label, 'Push-ups', 'V1-6b-2: label comes from the metric_definitions join');

// DAL-1: a soft-deleted profile owns no adherence rows (the same `isLiveProfile` scope as the day
// read). Restored straight after.
await db
  .update(schema.profiles)
  .set({ deletedAt: new Date() })
  .where(eq(schema.profiles.id, rampTestProfile.id));
const deadProfileAdherence = await weeklyAdherenceRows(asPg, {
  profilePublicId: RAMP_TEST_PROFILE_PUBLIC_ID,
  weekStart: RAMP_TEST_WEEK_START,
  activityTypeId: calisthenicsId,
  metricKeys: CALISTHENICS_METRIC_KEYS,
  scope: A_SCOPE,
});
await db
  .update(schema.profiles)
  .set({ deletedAt: null })
  .where(eq(schema.profiles.id, rampTestProfile.id));
assert.equal(deadProfileAdherence.length, 0, 'DAL-1: a soft-deleted profile has no adherence rows');

const dalVsit = dalByMetric.get(METRIC_KEYS.vsit_skill_step);
assert.ok(dalVsit, 'V1-6b-2: vsit_skill_step row present');
assert.equal(assertRollupAggregation(dalVsit.aggregation as MetricAggregation), 'max');
assert.equal(Number(dalVsit.actualMax), 5, 'V1-6b-2: vsit_skill_step actualMax = 5');

// THE zero-bout path: pullups has a target (12) but NO in-week bouts → LEFT JOIN yields NULL
// actuals, which the DAL's `Number(actual ?? 0)` coerces to 0. This is the graceful-empty-metric
// case the INNER-join b-1 pin could never exercise.
const dalPull = dalByMetric.get(METRIC_KEYS.pullups);
assert.ok(dalPull, 'V1-6b-2: a target with zero logged bouts STILL returns a row (LEFT JOIN)');
assert.equal(
  dalPull.actualSum,
  null,
  'V1-6b-2: zero-bout target has NULL actualSum (DAL coerces → 0)',
);
assert.equal(Number(dalPull.actualSum ?? 0), 0, 'V1-6b-2: NULL actual coerces to 0');
console.log(
  '✓ V1-6b-2: weeklyAdherenceRows (the DAL query) — LEFT-JOIN target+actual, zero-bout → 0',
);

// Profile scoping: a SECOND profile's target + bout the same week must NEVER leak into profile 1's rows.
const [otherRampProfile] = await db
  .insert(schema.profiles)
  .values({
    publicId: '019826b4-0000-7000-8000-0000000000e0',
    name: 'Other Ramp Kid',
    kind: PROFILE_KIND.kid,
    householdId: households[0].id,
  })
  .returning({ id: schema.profiles.id });
await db.insert(schema.rampTargets).values({
  publicId: '019826b4-0000-7000-8000-0000000000e1',
  profileId: otherRampProfile.id,
  metricKey: METRIC_KEYS.pushups,
  weekStart: RAMP_TEST_WEEK_START,
  targetValue: '999',
});
await db.insert(schema.entries).values({
  publicId: '019826b4-0000-7000-8000-0000000001e0',
  clientId: '019826b4-0000-7000-8000-0000000002e0',
  profileId: otherRampProfile.id,
  activityDate: '2026-01-05',
  unit: 'count',
  activityTypeId: calisthenicsId,
  metricKey: METRIC_KEYS.pushups,
  valueNum: '500',
  status: ENTRY_STATUS.done,
});
const scoped = await weeklyAdherenceRows(asPg, {
  profilePublicId: RAMP_TEST_PROFILE_PUBLIC_ID,
  weekStart: RAMP_TEST_WEEK_START,
  activityTypeId: calisthenicsId,
  metricKeys: CALISTHENICS_METRIC_KEYS,
  scope: A_SCOPE,
});
assert.equal(
  scoped.length,
  4,
  'V1-6b-2: profile scoping — profile 2 target does not appear in profile 1',
);
assert.equal(
  Number(scoped.find((r) => r.metricKey === METRIC_KEYS.pushups)!.actualSum),
  50,
  'V1-6b-2: profile scoping — profile 1 pushups stays 50, not 500 from profile 2',
);
console.log('✓ V1-6b-2: weeklyAdherenceRows is profile-scoped (no cross-profile leak)');

// ── V1-7: life activities (wake timing event + wrestling practice) — the generality proof ──────
// The APP write shape: kind NULL for both; wake is a NEITHER-source timing event (metric/movement
// NULL → unit resolves to 'timing') carrying value_num = local minutes-since-midnight (forced
// non-null by the retained entries_shape_check) + event_at (the instant); wrestling_practice is the
// practice_minutes metric. Both must PASS the shape-CHECK; a value_num-less wake must be REJECTED.
const wakeActivityId = await activityTypeIdByKey('wake');
const wrestlingActivityId = await activityTypeIdByKey('wrestling_practice');

await db.insert(schema.entries).values({
  publicId: '019826b4-0000-7000-8000-0000000007a0',
  clientId: '019826b4-0000-7000-8000-0000000007a1',
  profileId: rampTestProfile.id,
  activityDate: '2026-01-05',
  unit: 'timing',
  valueNum: '412', // 06:52 local
  eventAt: new Date('2026-01-05T14:52:00Z'),
  activityTypeId: wakeActivityId,
  metricKey: null,
  status: ENTRY_STATUS.done,
});
const [wakeRow] = await db
  .select({
    kind: schema.entries.kind,
    metricKey: schema.entries.metricKey,
    movementId: schema.entries.movementId,
    unit: schema.entries.unit,
    valueNum: schema.entries.valueNum,
    eventAt: schema.entries.eventAt,
  })
  .from(schema.entries)
  .where(eq(schema.entries.publicId, '019826b4-0000-7000-8000-0000000007a0'));
assert.equal(wakeRow.kind, null, 'V1-7: wake row is kind-NULL (the app write shape)');
assert.equal(wakeRow.metricKey, null, 'V1-7: wake has no metric_key (neither-source)');
assert.equal(wakeRow.movementId, null, 'V1-7: wake has no movement_id');
assert.equal(wakeRow.unit, 'timing', 'V1-7: wake unit is timing');
assert.equal(Number(wakeRow.valueNum), 412, 'V1-7: wake value_num = local minutes-since-midnight');
assert.ok(wakeRow.eventAt instanceof Date, 'V1-7: wake carries event_at (the timing instant)');

// A value_num-less wake is REJECTED by the retained entries_shape_check (the trap that forces the
// always-set-value_num idiom — the same direction the V1-5 proof pins).
let wakeNullRejected = false;
try {
  await db.insert(schema.entries).values({
    publicId: '019826b4-0000-7000-8000-0000000007a2',
    clientId: '019826b4-0000-7000-8000-0000000007a3',
    profileId: rampTestProfile.id,
    activityDate: '2026-01-05',
    unit: 'timing',
    eventAt: new Date('2026-01-05T14:52:00Z'),
    activityTypeId: wakeActivityId,
    metricKey: null,
    status: ENTRY_STATUS.done,
  });
} catch {
  wakeNullRejected = true;
}
assert.ok(
  wakeNullRejected,
  'V1-7: a wake row with NULL value_num is rejected by entries_shape_check',
);

await db.insert(schema.entries).values({
  publicId: '019826b4-0000-7000-8000-0000000007b0',
  clientId: '019826b4-0000-7000-8000-0000000007b1',
  profileId: rampTestProfile.id,
  activityDate: '2026-01-05',
  unit: 'min',
  valueNum: '90',
  activityTypeId: wrestlingActivityId,
  metricKey: METRIC_KEYS.practice_minutes,
  status: ENTRY_STATUS.done,
});
const [wrestlingRow] = await db
  .select({
    kind: schema.entries.kind,
    metricKey: schema.entries.metricKey,
    unit: schema.entries.unit,
    valueNum: schema.entries.valueNum,
  })
  .from(schema.entries)
  .where(eq(schema.entries.publicId, '019826b4-0000-7000-8000-0000000007b0'));
assert.equal(wrestlingRow.kind, null, 'V1-7: wrestling_practice is kind-NULL');
assert.equal(
  wrestlingRow.metricKey,
  METRIC_KEYS.practice_minutes,
  'V1-7: wrestling carries practice_minutes',
);
assert.equal(Number(wrestlingRow.valueNum), 90, 'V1-7: wrestling value_num = default minutes');
console.log(
  '✓ V1-7: wake (timing event) + wrestling_practice round-trip; NULL-value_num wake rejected',
);

// ── V1-8-1: strength SESSION + SUPERSET model — the generality proof ──────────────────────────
// Prove the schema carries ARBITRARY N-movement adult PPL pairings (spec §4): a session groups N
// movement entries; 2+ are tagged into a superset (superset_id + superset_order); each member is a
// strength entry (kind=NULL, movement_id + movement_name set, metric_key NULL) → entry_set. Order
// within a superset is deterministic (uq_entries_superset_order); session-level order is insertion (id).
const scLiftActivityId = await activityTypeIdByKey('sc_lift');
const [movX, movY, movZ] = movements; // three distinct seeded movements
const [sessionProfileA] = await db
  .insert(schema.profiles)
  .values({
    publicId: '019826b4-0000-7000-8000-0000000009a0',
    name: 'Session Kid A',
    kind: PROFILE_KIND.kid,
    householdId: households[0].id,
  })
  .returning({ id: schema.profiles.id });
const [sessionProfileB] = await db
  .insert(schema.profiles)
  .values({
    publicId: '019826b4-0000-7000-8000-0000000009b0',
    name: 'Session Kid B',
    kind: PROFILE_KIND.kid,
    householdId: households[0].id,
  })
  .returning({ id: schema.profiles.id });

/** Insert `values` into a session-graph table idempotently (onConflictDoNothing on client_id) and
 *  return the row id — re-selecting by client_id on a replay conflict. ONE helper so the three
 *  session/superset/entry inserts can't drift on the replay-fetch strategy (code-reuse). */
type GraphTable = typeof schema.sessions | typeof schema.supersets | typeof schema.entries;
async function upsertReturningId(
  table: GraphTable,
  values: Record<string, unknown>,
  clientId: string,
): Promise<number> {
  const [row] = await db
    .insert(table)
    .values(values as never)
    .onConflictDoNothing({ target: table.clientId, where: isNull(table.deletedAt) })
    .returning({ id: table.id });
  if (row) return row.id;
  // 🔴 **`deleted_at IS NULL`, and a throw on a miss — the production writer's
  // `reselectLiveByClientId` shape, not a shortcut.** Before V1-9b B0 the partial UNIQUE kept a
  // hidden row out of the index, so a conflict implied a LIVE row and an unguarded re-select was
  // merely sloppy. B0 puts hidden rows back in the index, so a conflict can now be WITH a hidden
  // row — and this re-select would hand its id back and attach children to a dead parent. The
  // writer's own docblock names this helper as the place that dropped the guard; B0 is where that
  // stops being true.
  const [live] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.clientId, clientId), isNull(table.deletedAt)))
    .limit(1);
  if (!live) throw new Error(`no live row for client_id ${clientId}`);
  return live.id;
}

/** Insert a strength member/standalone entry (kind=NULL, movement_id+movement_name set) + its set,
 *  idempotent by client_id (a replay with the same `tag` is a no-op). Returns the entry id. */
async function insertSessionEntry(
  tag: string,
  args: {
    profileId: number;
    sessionId: number;
    movementId: number;
    supersetId?: number;
    supersetOrder?: number;
  },
): Promise<number> {
  const cid = `019826b4-0000-7000-8000-000000000a${tag}`;
  const entryId = await upsertReturningId(
    schema.entries,
    {
      publicId: `019826b4-0000-7000-8000-0000000009${tag}`,
      clientId: cid,
      profileId: args.profileId,
      sessionId: args.sessionId,
      activityDate: '2026-02-02',
      unit: 'lb',
      movementName: 'Lift', // kind=NULL + movement_name set → passes entries_shape_check (3-valued NULL)
      activityTypeId: scLiftActivityId,
      movementId: args.movementId,
      supersetId: args.supersetId ?? null,
      supersetOrder: args.supersetOrder ?? null,
      status: ENTRY_STATUS.done,
    },
    cid,
  );
  const [setRow] = await db
    .insert(schema.entrySets)
    .values({
      publicId: `019826b4-0000-7000-8000-000000000b${tag}`,
      clientId: `019826b4-0000-7000-8000-000000000c${tag}`,
      entryId,
      idx: 1,
      reps: 5,
      status: ENTRY_STATUS.done,
    })
    .onConflictDoNothing({
      target: schema.entrySets.clientId,
      where: isNull(schema.entrySets.deletedAt),
    })
    .returning({ id: schema.entrySets.id });
  // GAP-3: the 135 lb lives in the child table now.
  if (setRow) {
    await db.insert(schema.entrySetQuantities).values({
      clientId: `019826b4-0000-7000-8000-000000000d${tag}`,
      entrySetId: setRow.id,
      slot: QUANTITY_SLOT.primary,
      dimension: UNIT_DIMENSION.mass,
      unit: 'lb',
      valueNum: '135',
    });
  }
  return entryId;
}

/** Insert a session (idempotent by client_id). `SESSION_TYPES[0]` = 'strength' — the shared const,
 *  not a re-typed literal. */
async function insertSession(tag: string, profileId: number): Promise<number> {
  const cid = `019826b4-0000-7000-8000-000000000d${tag}`;
  return upsertReturningId(
    schema.sessions,
    {
      publicId: `019826b4-0000-7000-8000-000000000e${tag}`,
      clientId: cid,
      profileId,
      activityDate: '2026-02-02',
      sessionType: SESSION_TYPES[0],
    },
    cid,
  );
}

/** Insert a superset (idempotent by client_id). */
async function insertSuperset(tag: string, sessionId: number, label: string): Promise<number> {
  const cid = `019826b4-0000-7000-8000-000000000f${tag}`;
  return upsertReturningId(
    schema.supersets,
    { publicId: `019826b4-0000-7000-8000-0000000010${tag}`, clientId: cid, sessionId, label },
    cid,
  );
}

// Session 1 (profile A): a 2-movement superset + a standalone movement (a MIXED session).
const session1 = await insertSession('10', sessionProfileA.id);
const superset1 = await insertSuperset('10', session1, 'DB Bench + Overhead Press');
const memberA = await insertSessionEntry('11', {
  profileId: sessionProfileA.id,
  sessionId: session1,
  movementId: movX.id,
  supersetId: superset1,
  supersetOrder: 1,
});
const memberB = await insertSessionEntry('12', {
  profileId: sessionProfileA.id,
  sessionId: session1,
  movementId: movY.id,
  supersetId: superset1,
  supersetOrder: 2,
});
const standaloneC = await insertSessionEntry('13', {
  profileId: sessionProfileA.id,
  sessionId: session1,
  movementId: movZ.id,
});

const s1entries = await db
  .select({
    id: schema.entries.id,
    kind: schema.entries.kind,
    movementId: schema.entries.movementId,
    supersetId: schema.entries.supersetId,
    supersetOrder: schema.entries.supersetOrder,
  })
  .from(schema.entries)
  .where(and(eq(schema.entries.sessionId, session1), isNull(schema.entries.deletedAt)))
  .orderBy(schema.entries.id);
assert.equal(s1entries.length, 3, 'V1-8-1: the session groups its 3 movement entries');
assert.deepEqual(
  s1entries.map((e) => e.id),
  [memberA, memberB, standaloneC],
  'V1-8-1: session-level block order is deterministic by insertion (id)',
);
for (const e of s1entries) {
  assert.equal(e.kind, null, 'V1-8-1: session entry is kind=NULL (decoupled from the V1-1d drop)');
  assert.ok(e.movementId != null, 'V1-8-1: session entry carries movement_id');
}
assert.equal(
  s1entries.find((e) => e.id === memberA)!.supersetId,
  superset1,
  'V1-8-1: member A is tagged to the superset',
);
assert.equal(s1entries.find((e) => e.id === memberA)!.supersetOrder, 1, 'V1-8-1: member A order 1');
assert.equal(s1entries.find((e) => e.id === memberB)!.supersetOrder, 2, 'V1-8-1: member B order 2');
assert.equal(
  s1entries.find((e) => e.id === standaloneC)!.supersetId,
  null,
  'V1-8-1: the standalone movement has no superset',
);

const s1members = await db
  .select({ order: schema.entries.supersetOrder })
  .from(schema.entries)
  .where(and(eq(schema.entries.supersetId, superset1), isNull(schema.entries.deletedAt)))
  .orderBy(schema.entries.supersetOrder);
assert.deepEqual(
  s1members.map((m) => m.order),
  [1, 2],
  'V1-8-1: superset members return in their alternating order',
);

const s1sets = await db
  .select({ id: schema.entrySets.id })
  .from(schema.entrySets)
  .where(inArray(schema.entrySets.entryId, [memberA, memberB, standaloneC]));
assert.equal(
  s1sets.length,
  3,
  'V1-8-1: each of THESE THREE fixture entries expands to an entry_set (insertSessionEntry always\n   inserts one) — NOT a universal: GAP-1 P1-1a makes a skipped movement legitimately set-less',
);

// Session 2 (profile A): a 3-movement superset — NO arity cap (the PPL-generality property).
const session2 = await insertSession('20', sessionProfileA.id);
const superset2 = await insertSuperset('20', session2, 'Three-way giant set');
await insertSessionEntry('21', {
  profileId: sessionProfileA.id,
  sessionId: session2,
  movementId: movX.id,
  supersetId: superset2,
  supersetOrder: 1,
});
await insertSessionEntry('22', {
  profileId: sessionProfileA.id,
  sessionId: session2,
  movementId: movY.id,
  supersetId: superset2,
  supersetOrder: 2,
});
await insertSessionEntry('23', {
  profileId: sessionProfileA.id,
  sessionId: session2,
  movementId: movZ.id,
  supersetId: superset2,
  supersetOrder: 3,
});
const s2members = await db
  .select({ order: schema.entries.supersetOrder })
  .from(schema.entries)
  .where(and(eq(schema.entries.supersetId, superset2), isNull(schema.entries.deletedAt)))
  .orderBy(schema.entries.supersetOrder);
assert.deepEqual(
  s2members.map((m) => m.order),
  [1, 2, 3],
  'V1-8-1: a 3-movement superset round-trips (no arity cap) — v2 PPL reuses it verbatim',
);

// Idempotent whole-graph replay (R8): re-run session1's graph (same client_ids) → still one graph.
await insertSession('10', sessionProfileA.id);
await insertSuperset('10', session1, 'DB Bench + Overhead Press');
await insertSessionEntry('11', {
  profileId: sessionProfileA.id,
  sessionId: session1,
  movementId: movX.id,
  supersetId: superset1,
  supersetOrder: 1,
});
const s1entriesAfter = await db
  .select({ id: schema.entries.id })
  .from(schema.entries)
  .where(and(eq(schema.entries.sessionId, session1), isNull(schema.entries.deletedAt)));
const s1supersetsAfter = await db
  .select({ id: schema.supersets.id })
  .from(schema.supersets)
  .where(and(eq(schema.supersets.sessionId, session1), isNull(schema.supersets.deletedAt)));
assert.equal(
  s1entriesAfter.length,
  3,
  'V1-8-1: replaying the graph inserts no duplicate entries (per-row client_id dedupe)',
);
assert.equal(s1supersetsAfter.length, 1, 'V1-8-1: replaying inserts no duplicate superset');

// Profile scoping (R2 — writer invariant): profile B's session never appears in profile A's graph.
const sessionB = await insertSession('30', sessionProfileB.id);
await insertSuperset('30', sessionB, 'B superset');
const aSupersets = await db
  .select({ id: schema.supersets.id })
  .from(schema.supersets)
  .innerJoin(schema.sessions, eq(schema.supersets.sessionId, schema.sessions.id))
  .where(
    and(eq(schema.sessions.profileId, sessionProfileA.id), isNull(schema.supersets.deletedAt)),
  );
assert.equal(
  aSupersets.length,
  2,
  'V1-8-1: profile A sees only its own supersets (scoped via session.profile_id)',
);
console.log(
  '✓ V1-8-1: session + superset (2- and 3-movement) round-trip; mixed order deterministic; idempotent replay; profile-scoped',
);

// Constraint rejections (6) via the shared helper.
await expectRejectedBy('entries_superset_order_check', () =>
  db.insert(schema.entries).values({
    publicId: '019826b4-0000-7000-8000-000000009f01',
    clientId: '019826b4-0000-7000-8000-000000009f02',
    profileId: sessionProfileA.id,
    sessionId: session1,
    activityDate: '2026-02-02',
    unit: 'lb',
    movementName: 'Lift',
    activityTypeId: scLiftActivityId,
    movementId: movX.id,
    supersetId: superset1,
    supersetOrder: null, // superset without an order → the pairing CHECK
    status: ENTRY_STATUS.done,
  }),
);
await expectRejectedBy('uq_entries_superset_order', () =>
  db.insert(schema.entries).values({
    publicId: '019826b4-0000-7000-8000-000000009f03',
    clientId: '019826b4-0000-7000-8000-000000009f04',
    profileId: sessionProfileA.id,
    sessionId: session1,
    activityDate: '2026-02-02',
    unit: 'lb',
    movementName: 'Lift',
    activityTypeId: scLiftActivityId,
    movementId: movZ.id,
    supersetId: superset1,
    supersetOrder: 1, // slot 1 already taken in superset1 → the ordinal UNIQUE
    status: ENTRY_STATUS.done,
  }),
);
await expectRejectedBy('entries_superset_movement_check', () =>
  db.insert(schema.entries).values({
    publicId: '019826b4-0000-7000-8000-000000009f05',
    clientId: '019826b4-0000-7000-8000-000000009f06',
    profileId: sessionProfileA.id,
    sessionId: session1,
    activityDate: '2026-02-02',
    unit: 'bool',
    valueNum: '1',
    activityTypeId: scLiftActivityId,
    movementId: null, // a superset member that isn't a movement → the member-is-movement CHECK
    supersetId: superset1,
    supersetOrder: 9,
    status: ENTRY_STATUS.done,
  }),
);
await expectRejectedBy('entries_superset_id_supersets_id_fk', () =>
  db.insert(schema.entries).values({
    publicId: '019826b4-0000-7000-8000-000000009f07',
    clientId: '019826b4-0000-7000-8000-000000009f08',
    profileId: sessionProfileA.id,
    sessionId: session1,
    activityDate: '2026-02-02',
    unit: 'lb',
    movementName: 'Lift',
    activityTypeId: scLiftActivityId,
    movementId: movX.id,
    supersetId: 9_999_999, // no such superset → FK
    supersetOrder: 5,
    status: ENTRY_STATUS.done,
  }),
);
await expectRejectedBy('supersets_session_id_sessions_id_fk', () =>
  db.insert(schema.supersets).values({
    publicId: '019826b4-0000-7000-8000-000000009f09',
    clientId: '019826b4-0000-7000-8000-000000009f0a',
    sessionId: 9_999_999, // no such session → FK
    label: 'orphan',
  }),
);
await expectRejectedBy('uq_supersets_client_id', () =>
  db.insert(schema.supersets).values({
    publicId: '019826b4-0000-7000-8000-000000009f0b',
    clientId: '019826b4-0000-7000-8000-000000000f10', // superset1's client_id (tag '10') → partial UNIQUE
    sessionId: session1,
    label: 'dup client',
  }),
);
console.log(
  '✓ V1-8-1: superset rejections (order pairing, dup slot, member-is-movement, 2 FKs, client_id UNIQUE)',
);

// ── V1-8-2: the FLAT session write path — through the SHARED writer core (single-sourced) ──────────
// The app DAL's `logStrengthSession` and THIS proof both call `writeStrengthSession`, so this exercises
// the ACTUAL insert path the app ships (not a bespoke re-implementation) — the `weeklyAdherenceRows`
// "one unit, two consumers" pattern applied to a writer (panel B2/N5, the sole behavior pin for the core
// now that `logStrengthEntry` is retired). A 3-movement flat session round-trips; a replay dedupes.
const flatSessionCid = '019826b4-0000-7000-8000-000000001200';
const flatArgs = {
  profilePublicId: '019826b4-0000-7000-8000-0000000009a0', // sessionProfileA
  scope: A_SCOPE,
  day: '2026-02-03',
  sessionType: SESSION_TYPES[0],
  sessionClientId: flatSessionCid,
  activityTypeId: scLiftActivityId,
  feel: 'strong', // V1-8-3b: the session feel persists on the first (non-conflict) insert path
  movements: [
    {
      movementName: movY.name,
      unit: 'lb',
      movementId: movX.id,
      clientId: '019826b4-0000-7000-8000-000000001201',
      sets: [
        { reps: 5, weight: 135 },
        { reps: 5, weight: 155 },
      ],
    },
    {
      movementName: 'Bench Press',
      unit: 'lb',
      movementId: movY.id,
      clientId: '019826b4-0000-7000-8000-000000001202',
      sets: [{ reps: 8, weight: 95 }],
    },
    {
      movementName: 'Barbell Row',
      unit: 'lb',
      movementId: movZ.id,
      clientId: '019826b4-0000-7000-8000-000000001203',
      sets: [{ reps: 10, weight: 75 }],
    },
  ],
} as const;

const flat = await writeStrengthSession(asPg, flatArgs);
const [flatSession] = await db
  .select({
    id: schema.sessions.id,
    profileId: schema.sessions.profileId,
    feel: schema.sessions.feel,
  })
  .from(schema.sessions)
  .where(eq(schema.sessions.publicId, flat.sessionId));
assert.ok(flatSession, 'V1-8-2: writeStrengthSession returns the session public_id');
assert.equal(
  flatSession.profileId,
  sessionProfileA.id,
  'V1-8-2: the session is written under the resolved profile (F7 seam, profile-scoped)',
);
assert.equal(flatSession.feel, 'strong', 'V1-8-3b: the session feel persists');

const flatEntries = await db
  .select({
    id: schema.entries.id,
    kind: schema.entries.kind,
    movementId: schema.entries.movementId,
    movementName: schema.entries.movementName,
    sessionId: schema.entries.sessionId,
    supersetId: schema.entries.supersetId,
  })
  .from(schema.entries)
  .where(and(eq(schema.entries.sessionId, flatSession.id), isNull(schema.entries.deletedAt)))
  .orderBy(schema.entries.id);
assert.equal(flatEntries.length, 3, 'V1-8-2: the flat session groups its 3 movement entries');
for (const e of flatEntries) {
  assert.equal(e.kind, null, 'V1-8-2: session member is kind=NULL (decoupled forward shape)');
  assert.ok(
    e.movementId != null,
    'V1-8-2: member carries movement_id (read set-fetch discriminant)',
  );
  assert.ok(
    e.movementName != null,
    'V1-8-2: member carries movement_name (passes entries_shape_check)',
  );
  assert.equal(
    e.sessionId,
    flatSession.id,
    'V1-8-2: member session_id == the session (writer invariant)',
  );
  assert.equal(e.supersetId, null, 'V1-8-2: a flat-session member has no superset');
}
const flatSets = await db
  .select({ entryId: schema.entrySets.entryId, idx: schema.entrySets.idx })
  .from(schema.entrySets)
  .where(
    inArray(
      schema.entrySets.entryId,
      flatEntries.map((e) => e.id),
    ),
  )
  .orderBy(schema.entrySets.entryId, schema.entrySets.idx);
assert.equal(flatSets.length, 4, 'V1-8-2: 2+1+1 sets round-trip across the 3 movements');
assert.deepEqual(
  flatSets.filter((s) => s.entryId === flatEntries[0].id).map((s) => s.idx),
  [1, 2],
  'V1-8-2: the first movement’s sets are 1-based and ordered',
);

// Idempotent whole-graph replay: re-run the SAME graph (same client_ids) → still one graph, same id.
const flatReplay = await writeStrengthSession(asPg, flatArgs);
assert.equal(flatReplay.sessionId, flat.sessionId, 'V1-8-2: replay returns the same session id');
const flatEntriesAfter = await db
  .select({ id: schema.entries.id })
  .from(schema.entries)
  .where(and(eq(schema.entries.sessionId, flatSession.id), isNull(schema.entries.deletedAt)));
const flatSetsAfter = await db
  .select({ id: schema.entrySets.id })
  .from(schema.entrySets)
  .where(
    inArray(
      schema.entrySets.entryId,
      flatEntriesAfter.map((e) => e.id),
    ),
  );
assert.equal(
  flatEntriesAfter.length,
  3,
  'V1-8-2: replay inserts no duplicate entries (per-row dedupe)',
);
assert.equal(flatSetsAfter.length, 4, 'V1-8-2: replay does not double the sets');
console.log(
  '✓ V1-8-2: flat multi-movement session round-trips via the shared writer core; idempotent replay; profile-scoped',
);

// ── V1-8-3c: the SUPERSET write branch via the REAL writer ─────────────────────────────────────────
// Prove `writeStrengthSession` creates supersets rows + stamps members (superset_id + superset_order),
// for a 2- AND a 3-movement superset (no arity cap — the PPL property), idempotent on replay. The
// V1-8-1 raw-SQL block above still proves the rejections the writer structurally can't emit; this only
// asserts the DELTA the writer adds.
const ssArgs = {
  profilePublicId: '019826b4-0000-7000-8000-0000000009a0', // sessionProfileA
  scope: A_SCOPE,
  day: '2026-02-04',
  sessionType: SESSION_TYPES[0],
  sessionClientId: '019826b4-0000-7000-8000-000000001300',
  activityTypeId: scLiftActivityId,
  supersets: [
    { clientId: '019826b4-0000-7000-8000-000000001310', label: 'DB Bench + Overhead Press' },
    { clientId: '019826b4-0000-7000-8000-000000001320' }, // 3-movement giant set, no label
  ],
  movements: [
    {
      movementName: 'DB Bench',
      unit: 'lb',
      movementId: movX.id,
      clientId: '019826b4-0000-7000-8000-000000001301',
      sets: [{ reps: 8, weight: 40 }],
      supersetClientId: '019826b4-0000-7000-8000-000000001310',
      supersetOrder: 1,
    },
    {
      movementName: 'Overhead Press',
      unit: 'lb',
      movementId: movY.id,
      clientId: '019826b4-0000-7000-8000-000000001302',
      sets: [{ reps: 8, weight: 30 }],
      supersetClientId: '019826b4-0000-7000-8000-000000001310',
      supersetOrder: 2,
    },
    {
      movementName: 'Dip',
      unit: 'lb',
      movementId: movX.id,
      clientId: '019826b4-0000-7000-8000-000000001303',
      sets: [{ reps: 10, weight: 0 }],
      supersetClientId: '019826b4-0000-7000-8000-000000001320',
      supersetOrder: 1,
    },
    {
      movementName: 'Lateral Raise',
      unit: 'lb',
      movementId: movY.id,
      clientId: '019826b4-0000-7000-8000-000000001304',
      sets: [{ reps: 12, weight: 10 }],
      supersetClientId: '019826b4-0000-7000-8000-000000001320',
      supersetOrder: 2,
    },
    {
      movementName: 'Push-up',
      unit: 'lb',
      movementId: movZ.id,
      clientId: '019826b4-0000-7000-8000-000000001305',
      sets: [{ reps: 15, weight: 0 }],
      supersetClientId: '019826b4-0000-7000-8000-000000001320',
      supersetOrder: 3,
    },
  ],
} as const;

const ss = await writeStrengthSession(asPg, ssArgs);
const [ssSession] = await db
  .select({ id: schema.sessions.id })
  .from(schema.sessions)
  .where(eq(schema.sessions.publicId, ss.sessionId));
const ssSupersetRows = await db
  .select({ id: schema.supersets.id })
  .from(schema.supersets)
  .where(and(eq(schema.supersets.sessionId, ssSession.id), isNull(schema.supersets.deletedAt)))
  .orderBy(schema.supersets.id);
assert.equal(ssSupersetRows.length, 2, 'V1-8-3c: the writer created 2 supersets');
for (const [i, expectedOrders] of [
  [1, 2],
  [1, 2, 3],
].entries()) {
  const members = await db
    .select({ order: schema.entries.supersetOrder })
    .from(schema.entries)
    .where(
      and(eq(schema.entries.supersetId, ssSupersetRows[i].id), isNull(schema.entries.deletedAt)),
    )
    .orderBy(schema.entries.supersetOrder);
  assert.deepEqual(
    members.map((m) => m.order),
    expectedOrders,
    `V1-8-3c: superset ${i + 1} members carry superset_order ${expectedOrders.join(',')}`,
  );
}

// Idempotent replay → still 2 supersets + 5 members (per-row ON CONFLICT at every level).
await writeStrengthSession(asPg, ssArgs);
const ssSupersetsAfter = await db
  .select({ id: schema.supersets.id })
  .from(schema.supersets)
  .where(and(eq(schema.supersets.sessionId, ssSession.id), isNull(schema.supersets.deletedAt)));
assert.equal(ssSupersetsAfter.length, 2, 'V1-8-3c: replay creates no duplicate supersets');
const ssMembersAfter = await db
  .select({ id: schema.entries.id })
  .from(schema.entries)
  .where(and(eq(schema.entries.sessionId, ssSession.id), isNull(schema.entries.deletedAt)));
assert.equal(ssMembersAfter.length, 5, 'V1-8-3c: replay creates no duplicate members');
console.log(
  '✓ V1-8-3c: superset write branch (2- and 3-movement) via the real writer; ordered; idempotent replay',
);

// ── GAP-3 (was GAP-1 P0-2): NON-NUMERIC loads via the shipped writer ───────────────────────────────
// GAP-1 P0-2 made `BW`/`30s` loggable by storing them as TEXT. GAP-3 keeps the capability and changes
// the destination — deliberately, and the backlog says so ("Partially reverses GAP-1 P0-2 on
// purpose"). `BW` is now a BOOLEAN on the set and `30s` a typed ('primary','time') quantity, so the
// same three shapes still round-trip and none of them is a string any more.
const LABELED_SESSION_CLIENT_ID = newId();
const LABELED_MOVEMENT_CLIENT_ID = newId();
await writeStrengthSession(asPg, {
  profilePublicId: '019826b4-0000-7000-8000-0000000009a0', // sessionProfileA
  scope: A_SCOPE,
  day: '2026-02-10',
  sessionType: SESSION_TYPES[0],
  sessionClientId: LABELED_SESSION_CLIENT_ID,
  activityTypeId: scLiftActivityId,
  movements: [
    {
      movementName: movX.name,
      // GAP-3 PR 4a: the unit is a property of the MOVEMENT, and its dimension follows from it. This
      // one is a HOLD, so it is logged in seconds — which is what makes the third set's `30` a
      // duration rather than a weight, with no per-set unit anywhere.
      unit: 'sec',
      movementId: movX.id,
      clientId: LABELED_MOVEMENT_CLIENT_ID,
      // The three shapes that matter: a bodyweight MODE, a second one, and a DURATION — which used to
      // need `entry_sets.seconds` and now rides the same mechanism as every other magnitude.
      sets: [
        { reps: 5, weight: null, isBodyweight: true },
        { reps: 3, weight: null, isBodyweight: true }, // the vest itself is a slot the NEXT PR's form writes
        {
          reps: 1,
          weight: 30, // a HOLD: the movement's unit is `sec`, so this is 30 seconds
        },
      ],
    },
  ],
});
const labeledSets = (
  await db.execute(sql`
    select es.idx, es.reps, es.is_bodyweight, es.is_band,
           q.slot, q.dimension, q.unit, q.value_num
    from entry_sets es
    join entries e on e.id = es.entry_id
    left join entry_set_quantities q on q.entry_set_id = es.id and q.deleted_at is null
    where e.client_id = ${LABELED_MOVEMENT_CLIENT_ID}
    order by es.idx`)
).rows as unknown as {
  idx: number;
  reps: number;
  is_bodyweight: boolean;
  is_band: boolean;
  slot: string | null;
  dimension: string | null;
  unit: string | null;
  value_num: string | null;
}[];
assert.equal(labeledSets.length, 3, 'GAP-3: all three non-numeric sets persisted');
assert.deepEqual(
  labeledSets.map((r) => r.is_bodyweight),
  [true, true, false],
  'GAP-3: BW is a BOOLEAN on the set, not a string',
);
// The duration: what used to be the string `30s` is now a typed quantity carrying its own unit.
const durationSet = labeledSets[2];
assert.equal(durationSet.slot, QUANTITY_SLOT.primary, "GAP-3: a hold's duration is its PRIMARY");
assert.equal(durationSet.dimension, UNIT_DIMENSION.time, 'GAP-3: …at dimension time');
assert.equal(durationSet.unit, 'sec', 'GAP-3: …with the unit stored ON THE ROW (ADR 0004 §6)');
assert.equal(durationSet.value_num, '30.000', 'GAP-3: …and the magnitude as a number');

// V1-30: a non-mass set is UNEDITABLE by design. The edit guard keys on a live primary MASS quantity
// (writers/strength-session.ts), and the form's `isEditableSet` agrees (strength-logging invariant 3).
// This set has no mode flag and one quantity, so the dimension is the ONLY thing refusing it. Since
// V1-30 the form can save time and distance sets, so this is the population the refusal now covers;
// recovering a typo in one means writing a correction (docs/features/strength-logging.md).
const [durationSetRow] = (
  await db.execute(sql`
    select es.public_id from entry_sets es join entries e on e.id = es.entry_id
    where e.client_id = ${LABELED_MOVEMENT_CLIENT_ID} and es.idx = ${durationSet.idx}`)
).rows as unknown as { public_id: string }[];
const timedEdit = await updateStrengthSetById(asPg, {
  profilePublicId: '019826b4-0000-7000-8000-0000000009a0', // sessionProfileA, the set's owner
  setId: durationSetRow.public_id,
  reps: 1,
  weight: 45,
  scope: A_SCOPE,
});
assert.equal(timedEdit, null, 'V1-30: a time set is not editable (the edit path is mass-only)');
// The two bodyweight sets carry no quantity at all — a MODE is not a magnitude.
assert.ok(
  labeledSets.slice(0, 2).every((r) => r.value_num === null),
  'GAP-3: a pure bodyweight set stores NO quantity row',
);

// A labeled set on a SUPERSET member — that path had no other coverage.
const LABELED_SS_SESSION = newId();
const LABELED_SS_GROUP = newId();
const LABELED_SS_A = newId();
const LABELED_SS_B = newId();
await writeStrengthSession(asPg, {
  profilePublicId: '019826b4-0000-7000-8000-0000000009a0', // sessionProfileA
  scope: A_SCOPE,
  day: '2026-02-11',
  sessionType: SESSION_TYPES[0],
  sessionClientId: LABELED_SS_SESSION,
  activityTypeId: scLiftActivityId,
  supersets: [{ clientId: LABELED_SS_GROUP }],
  movements: [
    {
      movementName: movX.name,
      unit: 'lb',
      movementId: movX.id,
      clientId: LABELED_SS_A,
      sets: [{ reps: 5, weight: null, isBodyweight: true }],
      supersetClientId: LABELED_SS_GROUP,
      supersetOrder: 1,
    },
    {
      movementName: movY.name,
      unit: 'lb',
      movementId: movY.id,
      clientId: LABELED_SS_B,
      sets: [{ reps: 5, weight: 60 }], // the numeric path must be unaffected alongside a labeled one
      supersetClientId: LABELED_SS_GROUP,
      supersetOrder: 2,
    },
  ],
});
const ssSets = (
  await db.execute(sql`
    select e.client_id, es.is_bodyweight, q.value_num, q.unit
    from entry_sets es
    join entries e on e.id = es.entry_id
    left join entry_set_quantities q on q.entry_set_id = es.id and q.deleted_at is null
    where e.client_id in (${LABELED_SS_A}, ${LABELED_SS_B})`)
).rows as unknown as {
  client_id: string;
  is_bodyweight: boolean;
  value_num: string | null;
  unit: string | null;
}[];
const ssLabeled = ssSets.find((r) => r.client_id === LABELED_SS_A);
const ssNumeric = ssSets.find((r) => r.client_id === LABELED_SS_B);
assert.equal(ssLabeled?.is_bodyweight, true, 'GAP-3: a superset MEMBER can be bodyweight');
assert.equal(ssLabeled?.value_num, null, 'GAP-3: …and carries no quantity');
assert.equal(ssNumeric?.is_bodyweight, false, 'GAP-3: the numeric sibling is unaffected');
assert.equal(ssNumeric?.value_num, '60.000', 'GAP-3: …and still stores its number');
assert.equal(ssNumeric?.unit, 'lb', 'GAP-3: …with the unit that came off the ENTRY');
console.log('✓ GAP-3: BW / duration loads round-trip typed, incl. on a superset member');

// ── GAP-3 PR 4a: a MODE and a MAGNITUDE on the same set, through the real writer ───────────────────
// The pairing the old string wire made structurally impossible — the chip OVERWROTE the weight field,
// so `BW` and a number could never coexist. #139 proved the TABLE could hold it; this proves the
// WRITER does, which is the half PR 4a adds. (The worn-load SLOT itself is 4b; here the magnitude
// still lands in `primary`.)
{
  const MODE_PLUS_MAGNITUDE = newId();
  await writeStrengthSession(asPg, {
    profilePublicId: '019826b4-0000-7000-8000-0000000009a0',
    scope: A_SCOPE,
    day: '2026-02-12',
    sessionType: SESSION_TYPES[0],
    sessionClientId: newId(),
    activityTypeId: scLiftActivityId,
    movements: [
      {
        movementName: movY.name,
        unit: 'lb',
        movementId: movY.id,
        clientId: MODE_PLUS_MAGNITUDE,
        sets: [{ reps: 8, weight: 8, isBodyweight: true }],
      },
    ],
  });
  const [row] = (
    await db.execute(sql`
      select es.is_bodyweight, q.slot, q.dimension, q.unit, q.value_num
      from entry_sets es
      join entries e on e.id = es.entry_id
      left join entry_set_quantities q on q.entry_set_id = es.id and q.deleted_at is null
      where e.client_id = ${MODE_PLUS_MAGNITUDE}`)
  ).rows as unknown as {
    is_bodyweight: boolean;
    slot: string | null;
    dimension: string | null;
    unit: string | null;
    value_num: string | null;
  }[];
  assert.equal(row.is_bodyweight, true, 'PR 4a: the MODE persisted');
  assert.equal(row.value_num, '8.000', 'PR 4a: …and the MAGNITUDE persisted alongside it');
  assert.equal(row.slot, QUANTITY_SLOT.primary, 'PR 4a: the magnitude is the primary quantity');
  assert.equal(
    row.dimension,
    UNIT_DIMENSION.mass,
    'PR 4a: dimension derived from the movement unit',
  );
  console.log(
    '✓ GAP-3 PR 4a: a mode and a magnitude coexist on one set (was structurally impossible)',
  );
}

// ── V1-13b: the month-scoped export reads, against rows the REAL writer authored ────────────────────
// The formatters have golden vectors; these prove the READS — ordering, the soft-delete filters, the
// skipped-movement LEFT JOIN, and that a month boundary is half-open. Run through the shipped
// `strengthMonthRows`, so the DAL and this proof cannot diverge.
{
  const EXPORT_SESSION = newId();
  await writeStrengthSession(asPg, {
    profilePublicId: '019826b4-0000-7000-8000-0000000009a0',
    scope: A_SCOPE,
    day: '2026-03-11',
    sessionType: SESSION_TYPES[0],
    sessionClientId: EXPORT_SESSION,
    activityTypeId: scLiftActivityId,
    movements: [
      {
        movementName: movX.name,
        unit: 'lb',
        movementId: movX.id,
        clientId: newId(),
        sets: [
          { reps: 5, weight: 70 },
          { reps: 5, weight: 75 },
          { reps: 5, weight: 75 },
        ],
      },
      {
        movementName: movY.name,
        unit: 'lb',
        movementId: movY.id,
        clientId: newId(),
        status: ENTRY_STATUS.skipped,
        sets: [],
      },
    ],
  });

  const rows = await strengthMonthRows(asPg, {
    profilePublicId: '019826b4-0000-7000-8000-0000000009a0',
    month: '2026-03',
    scope: A_SCOPE,
  });

  // A SKIPPED movement carries ZERO set rows, and the LEFT JOIN must still surface it — an inner
  // join would drop the row that has to export as `0,0,SKIPPED`.
  const skipped = rows.filter((r) => r.entryStatus === ENTRY_STATUS.skipped);
  assert.equal(skipped.length, 1, 'V1-13b: the skipped movement survives the LEFT JOIN');
  assert.equal(skipped[0].setId, null, 'V1-13b: ...carrying no set row');

  // The typed quantity round-trips with its unit — this is what `load` is rebuilt from.
  const loaded = rows.filter((r) => r.valueNum !== null);
  assert.ok(loaded.length >= 3, 'V1-13b: quantities come back alongside the sets');
  assert.equal(loaded[0].unit, 'lb', 'V1-13b: ...carrying the unit stored on the row');

  // A month is HALF-OPEN: the filename's month must always match its rows.
  const adjacent = await strengthMonthRows(asPg, {
    profilePublicId: '019826b4-0000-7000-8000-0000000009a0',
    month: '2026-04',
    scope: A_SCOPE,
  });
  assert.equal(adjacent.length, 0, 'V1-13b: an adjacent month sees none of these rows');

  // BOLA: the same month for a different profile must be empty.
  // BOLA inside ONE household: both profiles are legitimately in A, so A_SCOPE is correct here and
  // the profile conjunct is what must refuse. The cross-HOUSEHOLD direction is the TEN-1 matrix.
  const otherProfile = await strengthMonthRows(asPg, {
    profilePublicId: '019826b4-0000-7000-8000-0000000009b0',
    month: '2026-03',
    scope: A_SCOPE,
  });
  assert.equal(otherProfile.length, 0, 'V1-13b: the export read is profile-scoped');

  const months = await loggedMonths(asPg, {
    profilePublicId: '019826b4-0000-7000-8000-0000000009a0',
    scope: A_SCOPE,
  });
  assert.ok(
    months.some((m) => m.month === '2026-03'),
    'V1-13b: loggedMonths finds the month just written',
  );

  console.log('✓ V1-13b: export reads — skipped LEFT JOIN, quantities, half-open month, BOLA');
}

// ── V1-30: a newly loggable unit round-trips from the REAL writer to the export read ───────────────
// The CSV tests build rows by hand; this proves the stored side. Before V1-30 the session schema
// refused `m` outright and a `kg` set made the export throw. The fold + CSV builder live in apps/web
// (`foldStrengthRows`), out of reach here, so this asserts on what they consume: the quantity row's
// (dimension, unit) and `strengthMonthRows`' unit + value — the bytes `20m`/`85kg` are pinned by the
// strength-log CSV tests over those same fields.
{
  const V130_PROFILE = '019826b4-0000-7000-8000-0000000009a0';
  await writeStrengthSession(asPg, {
    profilePublicId: V130_PROFILE,
    scope: A_SCOPE,
    day: '2026-05-14',
    sessionType: SESSION_TYPES[0],
    sessionClientId: newId(),
    activityTypeId: scLiftActivityId,
    movements: [
      {
        movementName: movX.name,
        unit: 'kg',
        movementId: movX.id,
        clientId: newId(),
        sets: [{ reps: 5, weight: 85 }],
      },
      {
        movementName: movY.name,
        unit: 'm',
        movementId: movY.id,
        clientId: newId(),
        sets: [{ reps: 1, weight: 20 }],
      },
    ],
  });
  const stored = (
    await db.execute(sql`
      select q.dimension, q.unit, q.value_num::float8 as value
      from entry_set_quantities q
      join entry_sets es on es.id = q.entry_set_id
      join entries e on e.id = es.entry_id
      join profiles p on p.id = e.profile_id
      where p.public_id = ${V130_PROFILE} and e.activity_date = '2026-05-14'
      order by q.unit`)
  ).rows as unknown as { dimension: string; unit: string; value: number }[];
  assert.deepEqual(
    stored.map((r) => [r.dimension, r.unit, r.value]),
    [
      ['mass', 'kg', 85],
      ['length', 'm', 20],
    ],
    'V1-30: kg stores as (mass, kg) and m as (length, m)',
  );
  const read = await strengthMonthRows(asPg, {
    profilePublicId: V130_PROFILE,
    month: '2026-05',
    scope: A_SCOPE,
  });
  assert.deepEqual(
    read
      .filter((r) => r.valueNum !== null)
      .map((r) => [r.unit, Number(r.valueNum)])
      .sort(),
    [
      ['kg', 85],
      ['m', 20],
    ],
    'V1-30: the export read returns each unit with its value',
  );
  console.log('✓ V1-30: kg and m round-trip from the writer to the export read');
}

// ── GAP-3: the composite-FK unit guard, and the shapes fixed columns could not hold ────────────────
// This is the block that justifies the design. `lb` in a box-jump height is rejected BY THE DATABASE,
// not by review — there is no third spelling that gets a mass unit into a length quantity, because
// `dimension` is the shared column of two composite FKs against two PRIMARY KEYS.
{
  const qtySetId = (
    (
      await db.execute(sql`
        select es.id from entry_sets es join entries e on e.id = es.entry_id
        where e.client_id = ${LABELED_MOVEMENT_CLIENT_ID} order by es.idx limit 1`)
    ).rows as unknown as { id: number }[]
  )[0].id;

  const insertQty = (slot: string, dimension: string, unit: string, value = '10') =>
    db.insert(schema.entrySetQuantities).values({
      clientId: newId(),
      entrySetId: qtySetId,
      slot,
      dimension,
      unit,
      valueNum: value,
    });

  // A mass unit in a LENGTH quantity: the slot/dimension pair is legal, the unit/dimension pair is not.
  await expectRejectedBy('entry_set_quantities_unit_dimension_fkey', () =>
    insertQty('distance', UNIT_DIMENSION.length, 'lb'),
  );
  // Lying about the dimension to match the unit just fails the OTHER FK — `distance` is length-only.
  await expectRejectedBy('entry_set_quantities_slot_dimension_fkey', () =>
    insertQty('distance', UNIT_DIMENSION.mass, 'lb'),
  );
  // A slot outside the seeded vocabulary — slots are a CLOSED list, never free text.
  await expectRejectedBy('entry_set_quantities_slot_dimension_fkey', () =>
    insertQty('torso', UNIT_DIMENSION.mass, 'lb'),
  );
  // `primary` is legal at mass/length/time but NOT at count — a slot is bounded by its declared set.
  await expectRejectedBy('entry_set_quantities_slot_dimension_fkey', () =>
    insertQty(QUANTITY_SLOT.primary, UNIT_DIMENSION.count, 'count'),
  );
  // `weight_num` never had a non-negative CHECK (parseLoad enforced it); the typed column does.
  await expectRejectedBy('entry_set_quantities_value_num_check', () =>
    insertQty(QUANTITY_SLOT.vest, UNIT_DIMENSION.mass, 'lb', '-1'),
  );
  console.log('✓ GAP-3: a mass unit in a length quantity is UNREPRESENTABLE (two composite FKs)');

  // The shapes a fixed-column design could not hold. THREE worn loads on ONE set — the YDP movement
  // that overflowed ADR 0004 and is the reason the child table exists at all.
  const wornSetId = (
    (
      await db.execute(sql`
        select es.id from entry_sets es join entries e on e.id = es.entry_id
        where e.client_id = ${LABELED_MOVEMENT_CLIENT_ID} order by es.idx offset 1 limit 1`)
    ).rows as unknown as { id: number }[]
  )[0].id;
  await db.insert(schema.entrySetQuantities).values(
    ([QUANTITY_SLOT.vest, QUANTITY_SLOT.ankle, QUANTITY_SLOT.wrist] as const).map((slot, i) => ({
      clientId: newId(),
      entrySetId: wornSetId,
      slot,
      dimension: UNIT_DIMENSION.mass,
      unit: 'lb' as const,
      valueNum: String(i + 1),
    })),
  );
  const worn = await db
    .select({ slot: schema.entrySetQuantities.slot })
    .from(schema.entrySetQuantities)
    .where(
      and(
        eq(schema.entrySetQuantities.entrySetId, wornSetId),
        isNull(schema.entrySetQuantities.deletedAt),
      ),
    );
  assert.equal(worn.length, 3, 'GAP-3: vest + ankle + wrist coexist on ONE set');

  // The arity rule: a SECOND vest on the SAME set is rejected — nothing can write fourteen vest rows.
  await expectRejectedBy('uq_entry_set_quantities_set_slot', () =>
    db.insert(schema.entrySetQuantities).values({
      clientId: newId(),
      entrySetId: wornSetId, // the set that already HAS a vest
      slot: QUANTITY_SLOT.vest,
      dimension: UNIT_DIMENSION.mass,
      unit: 'lb',
      valueNum: '99',
    }),
  );

  // Two DIMENSIONS on one set — the sled push, `123 (50ft)`. A fixed weight column could never say
  // this: the mass and the length are BOTH the record, and neither is the other's unit.
  await db.insert(schema.entrySetQuantities).values([
    {
      clientId: newId(),
      entrySetId: qtySetId,
      slot: QUANTITY_SLOT.primary,
      dimension: UNIT_DIMENSION.mass,
      unit: 'lb',
      valueNum: '123',
    },
    {
      clientId: newId(),
      entrySetId: qtySetId,
      slot: QUANTITY_SLOT.distance,
      dimension: UNIT_DIMENSION.length,
      unit: 'ft',
      valueNum: '50',
    },
  ]);
  const sled = await db
    .select({ dimension: schema.entrySetQuantities.dimension })
    .from(schema.entrySetQuantities)
    .where(
      and(
        eq(schema.entrySetQuantities.entrySetId, qtySetId),
        isNull(schema.entrySetQuantities.deletedAt),
      ),
    );
  assert.ok(
    new Set(sled.map((r) => r.dimension)).size >= 2,
    'GAP-3: one set carries TWO dimensions at once (the `123 (50ft)` sled row)',
  );

  // Soft-delete a quantity, then write a replacement for the same slot — the PARTIAL unique index is
  // what makes the edit path possible, and `targetWhere` is what makes the upsert legal against it.
  await db
    .update(schema.entrySetQuantities)
    .set({ deletedAt: sql`now()` })
    .where(
      and(
        eq(schema.entrySetQuantities.entrySetId, wornSetId),
        eq(schema.entrySetQuantities.slot, QUANTITY_SLOT.vest),
      ),
    );
  await db.insert(schema.entrySetQuantities).values({
    clientId: newId(),
    entrySetId: wornSetId,
    slot: QUANTITY_SLOT.vest,
    dimension: UNIT_DIMENSION.mass,
    unit: 'lb',
    valueNum: '12',
  });
  console.log('✓ GAP-3: multi-slot + multi-dimension sets, arity guard, soft-delete-then-replace');

  // ⚠️ ON DELETE CASCADE is HARD-delete only. The app SOFT-deletes, so a soft-deleted set leaves its
  // quantities live — every reader must join through a live parent, which the DAL now does. Proven
  // here so the trap is visible rather than discovered in a wrong total later.
  await db
    .update(schema.entrySets)
    .set({ deletedAt: sql`now()` })
    .where(eq(schema.entrySets.id, wornSetId));
  const orphans = await db
    .select({ id: schema.entrySetQuantities.id })
    .from(schema.entrySetQuantities)
    .where(
      and(
        eq(schema.entrySetQuantities.entrySetId, wornSetId),
        isNull(schema.entrySetQuantities.deletedAt),
      ),
    );
  assert.ok(
    orphans.length > 0,
    'GAP-3: a SOFT-deleted set leaves live quantities — readers MUST join a live parent',
  );
  // And a HARD delete really does cascade.
  await db.delete(schema.entrySets).where(eq(schema.entrySets.id, wornSetId));
  const cascaded = await db
    .select({ id: schema.entrySetQuantities.id })
    .from(schema.entrySetQuantities)
    .where(eq(schema.entrySetQuantities.entrySetId, wornSetId));
  assert.equal(cascaded.length, 0, 'GAP-3: a HARD delete cascades to the quantities');
  console.log('✓ GAP-3: soft-delete leaves live children (documented trap); hard delete cascades');
}

// ── GAP-1 P0-1: `sessions.day_role` — WHICH programmed day a session was ───────────────────────────
// The CHECK's frozen literals can't silently drift from the shared const (the prescriptions precedent).
await assertCheckCoversConst('sessions_day_role_check', DAY_ROLES);

// Round-trips through the SHIPPED writer, not a raw insert — the writer's pass-through is precisely the
// thing most likely to be forgotten, so a raw insert would prove nothing about the code that ships.
const DAY_ROLE_SESSION_CLIENT_ID = newId();
await writeStrengthSession(asPg, {
  profilePublicId: '019826b4-0000-7000-8000-0000000009a0', // sessionProfileA
  scope: A_SCOPE,
  day: '2026-03-02',
  sessionType: SESSION_TYPES[0],
  sessionClientId: DAY_ROLE_SESSION_CLIENT_ID,
  activityTypeId: scLiftActivityId,
  dayRole: 'strength_b',
  movements: [
    {
      movementName: movX.name,
      unit: 'lb',
      movementId: movX.id,
      clientId: newId(),
      sets: [{ reps: 5, weight: 60 }],
    },
  ],
});
const [withRole] = (
  await db.execute(sql`
    select day_role, session_type from sessions where client_id = ${DAY_ROLE_SESSION_CLIENT_ID}`)
).rows as unknown as { day_role: string | null; session_type: string | null }[];
assert.equal(withRole.day_role, 'strength_b', 'GAP-1: the asserted day_role round-trips');
assert.equal(
  withRole.session_type,
  'strength',
  'GAP-1: session_type is UNCHANGED — day_role is a second column, not a replacement',
);

// NULL is a first-class value: a session on a non-programmed day is normal, and every pre-existing row
// is NULL. `NULL in (...)` is NULL, and a CHECK fails only on FALSE, so the constraint permits it.
const NO_ROLE_SESSION_CLIENT_ID = newId();
await writeStrengthSession(asPg, {
  profilePublicId: '019826b4-0000-7000-8000-0000000009a0',
  scope: A_SCOPE,
  day: '2026-03-03',
  sessionType: SESSION_TYPES[0],
  sessionClientId: NO_ROLE_SESSION_CLIENT_ID,
  activityTypeId: scLiftActivityId,
  // dayRole deliberately omitted
  movements: [
    {
      movementName: movX.name,
      unit: 'lb',
      movementId: movX.id,
      clientId: newId(),
      sets: [{ reps: 5, weight: 60 }],
    },
  ],
});
const [noRole] = (
  await db.execute(
    sql`select day_role from sessions where client_id = ${NO_ROLE_SESSION_CLIENT_ID}`,
  )
).rows as unknown as { day_role: string | null }[];
assert.equal(noRole.day_role, null, 'GAP-1: an omitted day_role stores NULL, not a guess');

// A garbage literal is refused by the CHECK.
await expectRejectedBy('sessions_day_role_check', () =>
  db.insert(schema.sessions).values({
    publicId: newId(),
    clientId: newId(),
    profileId: sessionProfileA.id,
    activityDate: '2026-03-04',
    sessionType: SESSION_TYPES[0],
    dayRole: 'not_a_day_role',
  }),
);
console.log(
  '✓ GAP-1: sessions.day_role — CHECK parity, asserted round-trip, NULL, bad-literal reject',
);

// ── GAP-1 P1-1a: a movement logged as SKIPPED, carrying ZERO entry_sets ───────────────────────────
// Through the SHIPPED writer (not a hand-rolled insert), so this proves the path the app runs. The
// point of the fixture is the MIX: one skipped movement and one done sibling in the SAME session, so
// "zero sets" is demonstrably scoped to the skipped entry rather than a session that wrote no sets.
const SKIP_SESSION_CLIENT_ID = newId();
const SKIPPED_MOVEMENT_CLIENT_ID = newId();
const DONE_MOVEMENT_CLIENT_ID = newId();
await writeStrengthSession(asPg, {
  profilePublicId: '019826b4-0000-7000-8000-0000000009a0',
  scope: A_SCOPE,
  day: '2026-03-05',
  sessionType: SESSION_TYPES[0],
  sessionClientId: SKIP_SESSION_CLIENT_ID,
  activityTypeId: scLiftActivityId,
  movements: [
    {
      movementName: movX.name,
      unit: 'lb',
      movementId: movX.id,
      clientId: SKIPPED_MOVEMENT_CLIENT_ID,
      status: ENTRY_STATUS.skipped,
      sets: [], // the whole point — unrepresentable before P1-1a
    },
    {
      movementName: movY.name,
      unit: 'lb',
      movementId: movY.id,
      clientId: DONE_MOVEMENT_CLIENT_ID,
      // status omitted → the writer omits the column → the DB default. The `done` path is untouched.
      sets: [
        { reps: 5, weight: 60 },
        { reps: 5, weight: 65 },
      ],
    },
  ],
});

const skipRows = await db
  .select({
    id: schema.entries.id,
    clientId: schema.entries.clientId,
    status: schema.entries.status,
  })
  .from(schema.entries)
  .where(inArray(schema.entries.clientId, [SKIPPED_MOVEMENT_CLIENT_ID, DONE_MOVEMENT_CLIENT_ID]));
const skippedEntry = skipRows.find((r) => r.clientId === SKIPPED_MOVEMENT_CLIENT_ID);
const doneEntry = skipRows.find((r) => r.clientId === DONE_MOVEMENT_CLIENT_ID);
assert.ok(skippedEntry && doneEntry, 'GAP-1 P1-1a: both movements were written');
assert.equal(
  skippedEntry.status,
  ENTRY_STATUS.skipped,
  'GAP-1 P1-1a: the skipped movement persists entries.status = skipped',
);
assert.equal(
  doneEntry.status,
  ENTRY_STATUS.done,
  'GAP-1 P1-1a: an omitted status still takes the DB default `done` (the existing path is byte-identical)',
);

const skippedSets = await db
  .select({ id: schema.entrySets.id })
  .from(schema.entrySets)
  .where(eq(schema.entrySets.entryId, skippedEntry.id));
assert.equal(
  skippedSets.length,
  0,
  'GAP-1 P1-1a: a skipped movement stores ZERO entry_sets (the CSV 0,0,SKIPPED triple is a RENDER, never stored)',
);
const doneSets = await db
  .select({ id: schema.entrySets.id, idx: schema.entrySets.idx })
  .from(schema.entrySets)
  .where(eq(schema.entrySets.entryId, doneEntry.id))
  .orderBy(schema.entrySets.idx);
assert.deepEqual(
  doneSets.map((r) => r.idx),
  [1, 2],
  'GAP-1 P1-1a: the done sibling in the same session keeps its sets, 1-based',
);

// The parent session is NOT marked skipped — one skipped movement does not skip the session, and
// writing it there would give the export a third source of truth for "did this happen" (plan D3).
const [skipSession] = (
  await db.execute(sql`select status from sessions where client_id = ${SKIP_SESSION_CLIENT_ID}`)
).rows as unknown as { status: string }[];
assert.equal(
  skipSession.status,
  ENTRY_STATUS.done,
  'GAP-1 P1-1a: sessions.status stays `done` — a session is not skipped because one movement was',
);

// Idempotent replay: the same payload re-run yields ONE entry and STILL zero sets (a retry must not
// resurrect set rows onto a skipped movement).
await writeStrengthSession(asPg, {
  profilePublicId: '019826b4-0000-7000-8000-0000000009a0',
  scope: A_SCOPE,
  day: '2026-03-05',
  sessionType: SESSION_TYPES[0],
  sessionClientId: SKIP_SESSION_CLIENT_ID,
  activityTypeId: scLiftActivityId,
  movements: [
    {
      movementName: movX.name,
      unit: 'lb',
      movementId: movX.id,
      clientId: SKIPPED_MOVEMENT_CLIENT_ID,
      status: ENTRY_STATUS.skipped,
      sets: [],
    },
  ],
});
const replayedSkipped = await db
  .select({ id: schema.entries.id })
  .from(schema.entries)
  .where(eq(schema.entries.clientId, SKIPPED_MOVEMENT_CLIENT_ID));
assert.equal(replayedSkipped.length, 1, 'GAP-1 P1-1a: replay does not duplicate the skipped entry');
const replayedSets = await db
  .select({ id: schema.entrySets.id })
  .from(schema.entrySets)
  .where(eq(schema.entrySets.entryId, skippedEntry.id));
assert.equal(replayedSets.length, 0, 'GAP-1 P1-1a: replay leaves the skipped movement set-less');
console.log(
  '✓ GAP-1 P1-1a: skipped movement — status persisted, ZERO sets, done sibling intact, session unmarked, replay-safe',
);

// ── GAP-1 P1-1b: a SET can be marked sub_failure, and a sub-failure set is NOT editable ───────────
// Through the SHIPPED writer. The mix matters again: one `done` set and one `sub_failure` set on the
// SAME movement, which is the realistic shape ("3 sets, the last one failed") and the one entry-level
// storage could never express.
const SF_SESSION_CLIENT_ID = newId();
const SF_MOVEMENT_CLIENT_ID = newId();
await writeStrengthSession(asPg, {
  profilePublicId: '019826b4-0000-7000-8000-0000000009a0',
  scope: A_SCOPE,
  day: '2026-03-06',
  sessionType: SESSION_TYPES[0],
  sessionClientId: SF_SESSION_CLIENT_ID,
  activityTypeId: scLiftActivityId,
  movements: [
    {
      movementName: movX.name,
      unit: 'lb',
      movementId: movX.id,
      clientId: SF_MOVEMENT_CLIENT_ID,
      sets: [
        { reps: 5, weight: 60 }, // status omitted → DB default
        {
          reps: 3,
          weight: 60,
          status: ENTRY_STATUS.sub_failure,
        },
      ],
    },
  ],
});

const [sfEntry] = await db
  .select({ id: schema.entries.id })
  .from(schema.entries)
  .where(eq(schema.entries.clientId, SF_MOVEMENT_CLIENT_ID));
assert.ok(sfEntry, 'GAP-1 P1-1b: the movement was written');
const sfSets = await db
  .select({
    publicId: schema.entrySets.publicId,
    idx: schema.entrySets.idx,
    reps: schema.entrySets.reps,
    status: schema.entrySets.status,
  })
  .from(schema.entrySets)
  .where(eq(schema.entrySets.entryId, sfEntry.id))
  .orderBy(schema.entrySets.idx);

assert.deepEqual(
  sfSets.map((r) => r.status),
  [ENTRY_STATUS.done, ENTRY_STATUS.sub_failure],
  'GAP-1 P1-1b: per-set status persists, and an omitted status takes the DB default `done`',
);
assert.deepEqual(
  sfSets.map((r) => r.reps),
  [5, 3],
  'GAP-1 P1-1b: a sub-failure set KEEPS its real reps (the DB is the richer record; the export re-derives `sub-failure`)',
);
// The count is the export's `sets` value — it must stay 2, which is why a `skipped` SET is refused
// at the boundary rather than stored (it would silently over-count here).
assert.equal(sfSets.length, 2, 'GAP-1 P1-1b: COUNT(entry_sets) is unaffected by a sub-failure set');

// BUG-2(a), the SERVER half: the V1-9 edit must refuse a sub-failure set. It is NUMERIC, so every
// other guard in updateStrengthSetById passes it — without the status clause this would succeed and
// silently leave `status = 'sub_failure'` on a row now claiming reps it never achieved.
const subFailureSet = sfSets.find((r) => r.status === ENTRY_STATUS.sub_failure)!;
const doneSet = sfSets.find((r) => r.status === ENTRY_STATUS.done)!;
const refused = await updateStrengthSetById(asPg, {
  profilePublicId: '019826b4-0000-7000-8000-0000000009a0',
  setId: subFailureSet.publicId,
  reps: 99,
  weight: 999,
  scope: A_SCOPE,
});
assert.equal(
  refused,
  null,
  'GAP-1 P1-1b (BUG-2a): editing a sub_failure set matches no row → null',
);
const [unchanged] = await db
  .select({ reps: schema.entrySets.reps, status: schema.entrySets.status })
  .from(schema.entrySets)
  .where(eq(schema.entrySets.publicId, subFailureSet.publicId));
assert.equal(unchanged.reps, 3, 'GAP-1 P1-1b (BUG-2a): the refused edit changed NOTHING');
assert.equal(
  unchanged.status,
  ENTRY_STATUS.sub_failure,
  'GAP-1 P1-1b (BUG-2a): the status survives the refused edit',
);

// …and the `done` sibling is still editable, so the guard is scoped to status, not a blanket freeze.
const stillEditable = await updateStrengthSetById(asPg, {
  profilePublicId: '019826b4-0000-7000-8000-0000000009a0',
  setId: doneSet.publicId,
  reps: 6,
  weight: 65,
  scope: A_SCOPE,
});
assert.ok(
  stillEditable,
  'GAP-1 P1-1b: a done set in the same movement is STILL editable (V1-9 intact)',
);
console.log(
  '✓ GAP-1 P1-1b: per-set sub_failure — status + reps persisted, count intact, edit refused server-side, done sibling still editable',
);

// ── V1-9: edit a logged set's reps/weight via the single-sourced `updateStrengthSetById` ──────────
// Proves the ownership-scoped UPDATE (the same guard the DAL runs): the owner's edit persists + advances
// updated_at (LWW server-now), while a cross-profile or soft-deleted-set edit matches no row → null.
const [editTarget] = await db
  .select({ publicId: schema.entrySets.publicId, updatedAt: schema.entrySets.updatedAt })
  .from(schema.entrySets)
  .innerJoin(schema.entries, eq(schema.entrySets.entryId, schema.entries.id))
  .where(and(eq(schema.entries.sessionId, ssSession.id), isNull(schema.entrySets.deletedAt)))
  .orderBy(schema.entrySets.id)
  .limit(1);

// (a) happy path — the owner corrects reps/weight.
const edited = await updateStrengthSetById(asPg, {
  profilePublicId: ssArgs.profilePublicId,
  setId: editTarget.publicId,
  reps: 7,
  weight: 142.5,
  scope: A_SCOPE,
});
assert.ok(edited, 'V1-9: an owner edit returns the set public id');
const [afterEdit] = await db
  .select({
    reps: schema.entrySets.reps,
    updatedAt: schema.entrySets.updatedAt,
    valueNum: schema.entrySetQuantities.valueNum,
  })
  .from(schema.entrySets)
  .innerJoin(
    schema.entrySetQuantities,
    eq(schema.entrySetQuantities.entrySetId, schema.entrySets.id),
  )
  .where(eq(schema.entrySets.publicId, editTarget.publicId));
assert.equal(afterEdit.reps, 7, 'V1-9: reps updated');
// GAP-3: reps and weight are now two statements in ONE transaction. This asserts they moved TOGETHER
// — the whole reason updateStrengthSetById stopped being a single atomic UPDATE.
assert.equal(
  Number(afterEdit.valueNum),
  142.5,
  'V1-9/GAP-3: the PRIMARY quantity updated in the same tx (precision-safe string)',
);
assert.ok(
  afterEdit.updatedAt >= editTarget.updatedAt,
  'V1-9: updated_at advanced (LWW server-now)',
);

// (b) ownership scope — a DIFFERENT profile editing the SAME setId matches nothing (BOLA guard).
const foreignEdit = await updateStrengthSetById(asPg, {
  profilePublicId: '019826b4-0000-7000-8000-0000000009b0', // sessionProfileB — not the owner
  setId: editTarget.publicId,
  reps: 999,
  weight: 999,
  scope: A_SCOPE,
});
assert.equal(foreignEdit, null, 'V1-9: a cross-profile edit matches no row');
const [afterForeign] = await db
  .select({ reps: schema.entrySets.reps })
  .from(schema.entrySets)
  .where(eq(schema.entrySets.publicId, editTarget.publicId));
assert.equal(afterForeign.reps, 7, 'V1-9: the cross-profile edit left the set unchanged');

// (c) numeric-set-only guard — GAP-3 restated it. It used to key on `weight_label IS NULL`; it now
// keys on the set being a plain single MASS quantity with no mode flag. Without this restatement the
// column drop would have made every previously-labeled set silently editable.
await db
  .update(schema.entrySets)
  .set({ isBodyweight: true })
  .where(eq(schema.entrySets.publicId, editTarget.publicId));
const labeledEdit = await updateStrengthSetById(asPg, {
  profilePublicId: ssArgs.profilePublicId,
  setId: editTarget.publicId,
  reps: 4,
  weight: 4,
  scope: A_SCOPE,
});
assert.equal(
  labeledEdit,
  null,
  'V1-9/GAP-3: a bodyweight set is not editable (numeric-only guard)',
);
const [afterLabeled] = await db
  .select({ reps: schema.entrySets.reps })
  .from(schema.entrySets)
  .where(eq(schema.entrySets.publicId, editTarget.publicId));
assert.equal(afterLabeled.reps, 7, 'V1-9: the rejected edit left the set unchanged');
await db
  .update(schema.entrySets)
  .set({ isBodyweight: false })
  .where(eq(schema.entrySets.publicId, editTarget.publicId)); // restore for the soft-delete case

// (d) soft-deleted set — an edit never writes it (guards V1-9b, when deleted sets exist).
await db
  .update(schema.entrySets)
  .set({ deletedAt: sql`now()` })
  .where(eq(schema.entrySets.publicId, editTarget.publicId));
const deletedEdit = await updateStrengthSetById(asPg, {
  profilePublicId: ssArgs.profilePublicId,
  setId: editTarget.publicId,
  reps: 3,
  weight: 3,
  scope: A_SCOPE,
});
assert.equal(deletedEdit, null, 'V1-9: a soft-deleted set is not editable');
console.log(
  '✓ V1-9: edit-set writer — owner edit persists (LWW); cross-profile, labeled, + soft-deleted rejected',
);

// ── V1-24 PR 1b: the bodyweight amend writer, and every pin in its guard ────────────────────────
// The app DAL and this proof call the SAME `updateBodyweightEntryById`, so the shipped WHERE is what
// gets exercised. It reuses the V1-9 block's already-seeded profiles rather than minting a third.

/** Seed one metric entry for the amend proofs. Ids are allocated from a local counter so adding a
 *  case never collides with the hand-assigned ids elsewhere in this file. */
let bwProbe = 0;
async function insertBodyweightProbe(args: {
  profileId: number;
  value: number;
  unit?: string;
  metricKey?: string;
  status?: (typeof ENTRY_STATUS)[keyof typeof ENTRY_STATUS];
  softDeleted?: boolean;
  valueText?: string;
  activityDate?: string;
  context?: string | null;
}): Promise<{ publicId: string }> {
  bwProbe += 1;
  // 3 hex digits, so the last UUID group stays exactly 12 characters.
  const n = bwProbe.toString(16).padStart(3, '0');
  // V1-24 1d: each probe gets its OWN day by default — `uq_entries_profile_day_bodyweight` allows one
  // live weigh-in per (profile, day, slot), and these proofs are about the amend guard, not the index.
  const ownDay = new Date(Date.UTC(2026, 6, 1) + bwProbe * 86_400_000).toISOString().slice(0, 10);
  const publicId = `019826b4-0000-7000-8000-00000000b${n}`;
  await db.insert(schema.entries).values({
    publicId,
    clientId: `019826b4-0000-7000-8000-00000000c${n}`,
    profileId: args.profileId,
    activityDate: args.activityDate ?? ownDay,
    kind: ENTRY_KIND.bodyweight,
    unit: args.unit ?? 'lb',
    valueNum: String(args.value),
    activityTypeId: await activityTypeIdByKey(SEED_ACTIVITY_TYPE_KEYS.weighIn),
    metricKey: args.metricKey ?? SEED_METRIC_KEYS.bodyweight,
    status: args.status ?? ENTRY_STATUS.done,
    ...(args.valueText ? { valueText: args.valueText } : {}),
    ...(args.context !== undefined ? { context: args.context } : {}),
    ...(args.softDeleted ? { deletedAt: new Date() } : {}),
  });
  return { publicId };
}

const bwOwner = ssArgs.profilePublicId;
const [bwOwnerRow] = await db
  .select({ id: schema.profiles.id })
  .from(schema.profiles)
  .where(eq(schema.profiles.publicId, bwOwner));

// (a) The happy path — the amend persists and advances updated_at.
// A fixed September day (its own, one weigh-in per day — V1-24 1d) so CSV-1's month read below finds it.
const bwTarget = await insertBodyweightProbe({
  profileId: bwOwnerRow.id,
  value: 84.5,
  activityDate: '2026-09-15',
});

// CSV-1: the bodyweight export read carries each row's UNIT, so the builder can write lb as logged
// and convert kg (never write a kg number bare under `weight_lb`). A kg probe on its OWN day (one
// weigh-in per day, V1-24 1d) proves the column is read, not assumed: a constant 'lb' would fail it.
const bwKgProbe = await insertBodyweightProbe({
  profileId: bwOwnerRow.id,
  value: 40.2,
  unit: 'kg',
  activityDate: '2026-09-14',
});
const bwExport = await bodyweightMonthRows(asPg, {
  profilePublicId: bwOwner,
  month: '2026-09',
  scope: A_SCOPE,
});
const bwExportTarget = bwExport.find((r) => r.value === '84.500');
assert.ok(bwExportTarget, 'CSV-1: the bodyweight export read returns the logged weight');
assert.equal(bwExportTarget.unit, 'lb', 'CSV-1: ...carrying the unit it was logged in');
const bwExportKg = bwExport.find((r) => r.value === '40.200');
assert.ok(bwExportKg, 'CSV-1: the export read returns the kg weigh-in');
assert.equal(bwExportKg.unit, 'kg', 'CSV-1: ...as kg, so the builder converts it');
await db.delete(schema.entries).where(eq(schema.entries.publicId, bwKgProbe.publicId));
const amended = await updateBodyweightEntryById(asPg, {
  profilePublicId: bwOwner,
  entryId: bwTarget.publicId,
  value: 85.2,
  unit: 'lb',
  seenValue: 84.5,
  scope: A_SCOPE,
});
assert.ok(amended, 'V1-24 1b: an owner amend returns the entry public id');
const [afterAmend] = await db
  .select({ valueNum: schema.entries.valueNum, unit: schema.entries.unit })
  .from(schema.entries)
  .where(eq(schema.entries.publicId, bwTarget.publicId));
assert.equal(Number(afterAmend.valueNum), 85.2, 'V1-24 1b: the value is corrected');
assert.equal(afterAmend.unit, 'lb', 'V1-24 1b: the unit is NOT written by an amend');

// (b) BOLA — a different profile amending the same entry matches nothing.
const foreignAmend = await updateBodyweightEntryById(asPg, {
  profilePublicId: '019826b4-0000-7000-8000-0000000009b0', // sessionProfileB — not the owner
  entryId: bwTarget.publicId,
  value: 999,
  unit: 'lb',
  seenValue: 85.2,
  scope: A_SCOPE,
});
assert.equal(foreignAmend, null, 'V1-24 1b: a cross-profile amend matches no row');

// (c) ⚠️ THE shape guard. A pushups entry, addressed through the bodyweight amend, must refuse —
// otherwise this endpoint rewrites any owned entry into a bodyweight.
const pushupRow = await insertBodyweightProbe({
  profileId: bwOwnerRow.id,
  value: 20,
  unit: 'count',
  metricKey: METRIC_KEYS.pushups,
});
const wrongMetric = await updateBodyweightEntryById(asPg, {
  profilePublicId: bwOwner,
  entryId: pushupRow.publicId,
  value: 85,
  unit: 'count',
  seenValue: 20,
  scope: A_SCOPE,
});
assert.equal(wrongMetric, null, 'V1-24 1b: a non-bodyweight metric is not amendable here');
const [pushupAfter] = await db
  .select({ valueNum: schema.entries.valueNum })
  .from(schema.entries)
  .where(eq(schema.entries.publicId, pushupRow.publicId));
assert.equal(Number(pushupAfter.valueNum), 20, 'V1-24 1b: ...and the row is untouched');

// (d) Optimistic concurrency — a stale seenValue refuses, so a second phone cannot be reverted.
const staleAmend = await updateBodyweightEntryById(asPg, {
  profilePublicId: bwOwner,
  entryId: bwTarget.publicId,
  value: 70,
  unit: 'lb',
  seenValue: 84.5, // the row is 85.2 now,
  scope: A_SCOPE,
});
assert.equal(staleAmend, null, 'V1-24 1b: a stale seenValue matches no row');

// (e) The unit is a GUARD: claiming kg to slip a value past the lb bound matches nothing.
const wrongUnit = await updateBodyweightEntryById(asPg, {
  profilePublicId: bwOwner,
  entryId: bwTarget.publicId,
  value: 200,
  unit: 'kg',
  seenValue: 85.2,
  scope: A_SCOPE,
});
assert.equal(wrongUnit, null, 'V1-24 1b: a mismatched unit matches no row');

// (f) A soft-deleted entry is not amendable.
const deadRow = await insertBodyweightProbe({
  profileId: bwOwnerRow.id,
  value: 70,
  softDeleted: true,
});
const deadAmend = await updateBodyweightEntryById(asPg, {
  profilePublicId: bwOwner,
  entryId: deadRow.publicId,
  value: 71,
  unit: 'lb',
  seenValue: 70,
  scope: A_SCOPE,
});
assert.equal(deadAmend, null, 'V1-24 1b: a soft-deleted entry is not amendable');

// (g) A non-`done` row is not amendable: correcting it would mean changing its status.
const skippedRow = await insertBodyweightProbe({
  profileId: bwOwnerRow.id,
  value: 70,
  status: ENTRY_STATUS.skipped,
});
const skippedAmend = await updateBodyweightEntryById(asPg, {
  profilePublicId: bwOwner,
  entryId: skippedRow.publicId,
  value: 71,
  unit: 'lb',
  seenValue: 70,
  scope: A_SCOPE,
});
assert.equal(skippedAmend, null, 'V1-24 1b: a non-done entry is not amendable');

// (h) A row carrying `value_text` is not amendable: setting value_num would leave two value sources.
const textRow = await insertBodyweightProbe({
  profileId: bwOwnerRow.id,
  value: 70,
  valueText: 'x',
});
const textAmend = await updateBodyweightEntryById(asPg, {
  profilePublicId: bwOwner,
  entryId: textRow.publicId,
  value: 71,
  unit: 'lb',
  seenValue: 70,
  scope: A_SCOPE,
});
assert.equal(textAmend, null, 'V1-24 1b: a text-valued entry is not amendable');

// (i) The re-read the action branches on shares the UPDATE's shape and ownership: it sees the owner's
// amendable row, and NOTHING the UPDATE could not have written.
assert.deepEqual(
  await findAmendableBodyweight(asPg, {
    profilePublicId: bwOwner,
    entryId: bwTarget.publicId,
    scope: A_SCOPE,
  }),
  { value: 85.2, unit: 'lb' },
  "V1-24 1b: the re-read returns the owner's current value",
);
for (const [entryId, profilePublicId, why] of [
  [bwTarget.publicId, '019826b4-0000-7000-8000-0000000009b0', 'cross-profile'],
  [skippedRow.publicId, bwOwner, 'non-done'],
  [textRow.publicId, bwOwner, 'text-valued'],
  [pushupRow.publicId, bwOwner, 'wrong metric'],
  [deadRow.publicId, bwOwner, 'soft-deleted'],
] as const) {
  assert.equal(
    await findAmendableBodyweight(asPg, { profilePublicId, entryId, scope: A_SCOPE }),
    null,
    `V1-24 1b: the re-read refuses a ${why} row`,
  );
}

// (j) THE profile half of `isLiveProfile`, for BOTH writers that share it: a soft-deleted profile owns
// nothing. Neither V1-9's proof nor (a)–(i) covered this. Restored straight after.
await db
  .update(schema.profiles)
  .set({ deletedAt: new Date() })
  .where(eq(schema.profiles.id, bwOwnerRow.id));
const deadProfileAmend = await updateBodyweightEntryById(asPg, {
  profilePublicId: bwOwner,
  entryId: bwTarget.publicId,
  value: 90,
  unit: 'lb',
  seenValue: 85.2,
  scope: A_SCOPE,
});
const deadProfileEdit = await updateStrengthSetById(asPg, {
  profilePublicId: bwOwner,
  setId: editTarget.publicId,
  reps: 99,
  weight: 99,
  scope: A_SCOPE,
});
await db
  .update(schema.profiles)
  .set({ deletedAt: null })
  .where(eq(schema.profiles.id, bwOwnerRow.id));
assert.equal(deadProfileAmend, null, 'V1-24 1b: a soft-deleted profile cannot amend a bodyweight');
assert.equal(deadProfileEdit, null, 'V1-9/V1-24: a soft-deleted profile cannot edit a set');

console.log(
  '✓ V1-24 1b: bodyweight amend — persists; cross-profile, wrong metric, stale value, wrong unit, soft-deleted, non-done, text-valued and dead-profile all refused; the re-read shares the guard',
);

// ── V1-24 PR 1d: one live weigh-in per (profile, day, slot) ─────────────────────────────────────
// `uq_entries_profile_day_bodyweight` keys on (profile_id, activity_date, coalesce(context,'morning'))
// for live bodyweight rows. Each case uses its own day so the cases cannot interfere.
{
  const UQ = 'uq_entries_profile_day_bodyweight';
  // (a) A second live weigh-in on the same day is rejected.
  await insertBodyweightProbe({ profileId: bwOwnerRow.id, value: 80, activityDate: '2026-05-01' });
  await expectRejectedBy(UQ, () =>
    insertBodyweightProbe({ profileId: bwOwnerRow.id, value: 81, activityDate: '2026-05-01' }),
  );
  // (b) NULL context and the 'morning' slot are the SAME slot — the reason for `coalesce`: no writer
  // sets `context` before 1e, so a bare-`context` key would let a NULL row beside a 'morning' row.
  await insertBodyweightProbe({
    profileId: bwOwnerRow.id,
    value: 80,
    activityDate: '2026-05-02',
    context: DEFAULT_BODYWEIGHT_CONTEXT,
  });
  await expectRejectedBy(UQ, () =>
    insertBodyweightProbe({
      profileId: bwOwnerRow.id,
      value: 81,
      activityDate: '2026-05-02',
      context: null,
    }),
  );
  // (c) A soft-deleted weigh-in frees the slot: the 1c correction's losers sit beside the keeper.
  await insertBodyweightProbe({
    profileId: bwOwnerRow.id,
    value: 80,
    activityDate: '2026-05-03',
    softDeleted: true,
  });
  await insertBodyweightProbe({ profileId: bwOwnerRow.id, value: 81, activityDate: '2026-05-03' });
  // (d) A different slot on the same day is allowed (V1-32's several-a-day).
  await insertBodyweightProbe({ profileId: bwOwnerRow.id, value: 80, activityDate: '2026-05-04' });
  await insertBodyweightProbe({
    profileId: bwOwnerRow.id,
    value: 81,
    activityDate: '2026-05-04',
    context: 'evening',
  });
  // (e) Scoped to bodyweight: another metric may repeat on a day.
  await insertBodyweightProbe({
    profileId: bwOwnerRow.id,
    value: 10,
    activityDate: '2026-05-05',
    metricKey: METRIC_KEYS.pushups,
  });
  await insertBodyweightProbe({
    profileId: bwOwnerRow.id,
    value: 12,
    activityDate: '2026-05-05',
    metricKey: METRIC_KEYS.pushups,
  });
  // (f) Another profile may weigh in on the same day.
  const [otherProfile] = await db
    .select({ id: schema.profiles.id })
    .from(schema.profiles)
    .where(eq(schema.profiles.publicId, '019826b4-0000-7000-8000-0000000009b0'));
  await insertBodyweightProbe({
    profileId: otherProfile.id,
    value: 60,
    activityDate: '2026-05-01',
  });

  // (g) The migration's pre-check REFUSES on an existing duplicate — run the migration file's own DO
  // block (read from disk, so this cannot drift from what ships) against a duplicate, with the index
  // dropped inside a transaction that is always rolled back.
  const migrationSql = readFileSync(
    new URL('../migrations/0012_bodyweight_one_per_day.sql', import.meta.url),
    'utf8',
  );
  const doBlock = migrationSql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .find((s) => s.startsWith('DO $$'));
  assert.ok(doBlock, 'V1-24 1d: the migration ships its duplicate pre-check');
  // Resolved BEFORE the transaction: PGlite has one connection, so a query on `db` inside `tx` waits forever.
  const weighInTypeId = await activityTypeIdByKey(SEED_ACTIVITY_TYPE_KEYS.weighIn);
  let refusal = '';
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`DROP INDEX "uq_entries_profile_day_bodyweight"`);
      const row = (n: string, profileId: number, activityDate: string, context: string | null) => ({
        publicId: `019826b4-0000-7000-8000-0000000d1d${n}`,
        clientId: `019826b4-0000-7000-8000-0000000d1e${n}`,
        profileId,
        activityDate,
        context,
        kind: ENTRY_KIND.bodyweight,
        unit: 'lb' as const,
        valueNum: '82',
        activityTypeId: weighInTypeId,
        metricKey: SEED_METRIC_KEYS.bodyweight,
      });
      // The fixture is built so each wrong grouping changes the COUNT the pre-check reports:
      // - the duplicate is 'morning' beside (a)'s NULL-context row → a bare-`context` key sees two
      //   different slots and reports 0 groups (the coalesce is what makes them one);
      // - (f) put another profile on 2026-05-01, and two more profiles' single weigh-ins share
      //   2026-05-06 → a key without `profile_id` merges them and reports 2 groups.
      await tx
        .insert(schema.entries)
        .values([
          row('01', bwOwnerRow.id, '2026-05-01', DEFAULT_BODYWEIGHT_CONTEXT),
          row('03', bwOwnerRow.id, '2026-05-06', null),
          row('04', otherProfile.id, '2026-05-06', null),
        ]);
      await tx.execute(doBlock); // the migration's own text, verbatim — not interpolated input
    });
  } catch (e) {
    refusal = String(
      (e as { cause?: { message?: string } })?.cause?.message ?? (e as Error).message,
    );
  }
  assert.match(
    refusal,
    /V1-24 1d: 1 \(profile, day, slot\) group/,
    'V1-24 1d: the pre-check refuses',
  );
  // The rollback restored the index: a duplicate is still rejected.
  await expectRejectedBy(UQ, () =>
    insertBodyweightProbe({ profileId: bwOwnerRow.id, value: 83, activityDate: '2026-05-01' }),
  );
}
console.log(
  '✓ V1-24 1d: one live weigh-in per (profile, day, slot) — a duplicate and a NULL-beside-morning are refused; soft-deleted, another slot, another metric and another profile are allowed; the migration pre-check refuses an existing duplicate',
);

// ── V1-24 1e: the create path's arbiter is target-less DO NOTHING (writers/bodyweight.ts) ─────────────
// Driven through `insertBodyweightEntry` — the IDENTICAL drizzle statement the app runs, parameters and
// all — so an inference failure ("no unique or exclusion constraint matching") would surface here.
{
  const weighInTypeId = await activityTypeIdByKey(SEED_ACTIVITY_TYPE_KEYS.weighIn);
  let n1e = 0;
  const ids1e = () => {
    n1e += 1;
    const h = n1e.toString(16).padStart(3, '0');
    return {
      publicId: `019826b4-0000-7000-8000-00000001e${h}`,
      clientId: `019826b4-0000-7000-8000-00000002e${h}`,
    };
  };
  const base = {
    profileId: bwOwnerRow.id,
    unit: 'lb',
    notes: null,
    activityTypeId: weighInTypeId,
    kind: ENTRY_KIND.bodyweight,
  };
  const liveOn = async (day: string) =>
    db
      .select({ value: schema.entries.valueNum, clientId: schema.entries.clientId })
      .from(schema.entries)
      .where(
        and(
          eq(schema.entries.profileId, bwOwnerRow.id),
          eq(schema.entries.activityDate, day),
          eq(schema.entries.metricKey, SEED_METRIC_KEYS.bodyweight),
          isNull(schema.entries.deletedAt),
        ),
      );

  // A first weigh-in inserts.
  const first = ids1e();
  const wrote = await insertBodyweightEntry(asPg, {
    ...base,
    ...first,
    day: '2026-11-01',
    value: 80,
  });
  assert.deepEqual(wrote, { id: first.publicId }, 'V1-24 1e: a first weigh-in inserts');

  // A replay of THAT submit (same client_id; the app mints a fresh public id each call) → its own id.
  const replay = await insertBodyweightEntry(asPg, {
    ...base,
    publicId: ids1e().publicId,
    clientId: first.clientId,
    day: '2026-11-01',
    value: 80,
  });
  assert.deepEqual(replay, { id: first.publicId }, 'V1-24 1e: a replay answers the SAME entry');

  // ANOTHER device's different weight on the same day → dayTaken, never a silent success.
  const other = await insertBodyweightEntry(asPg, {
    ...base,
    ...ids1e(),
    day: '2026-11-01',
    value: 91,
  });
  assert.deepEqual(other, { dayTaken: true }, 'V1-24 1e: a second device is told the day is taken');
  const nov1 = await liveOn('2026-11-01');
  assert.equal(nov1.length, 1, 'V1-24 1e: still exactly one live weigh-in');
  assert.equal(Number(nov1[0].value), 80, "V1-24 1e: the first weigh-in's value is untouched");

  // Another day inserts; a soft-deleted day frees its slot.
  const nov2 = await insertBodyweightEntry(asPg, {
    ...base,
    ...ids1e(),
    day: '2026-11-02',
    value: 81,
  });
  assert.ok('id' in nov2, 'V1-24 1e: another day inserts');
  await db
    .update(schema.entries)
    .set({ deletedAt: new Date() })
    .where(eq(schema.entries.publicId, first.publicId));
  const after = await insertBodyweightEntry(asPg, {
    ...base,
    ...ids1e(),
    day: '2026-11-01',
    value: 82,
  });
  assert.ok('id' in after, 'V1-24 1e: a soft-deleted weigh-in frees the day');

  // Cost (c), and the ownership seam: a client_id that belongs to ANOTHER profile's live entry conflicts
  // on uq_entries_client_id. It is neither this profile's replay nor its day slot → throws, and never
  // hands back the other profile's public id (the pre-1e fallback looked up client_id alone).
  const [foreign] = await db
    .select({ clientId: schema.entries.clientId, publicId: schema.entries.publicId })
    .from(schema.entries)
    .where(
      and(isNull(schema.entries.deletedAt), sql`${schema.entries.profileId} <> ${bwOwnerRow.id}`),
    )
    .limit(1);
  assert.ok(foreign, 'V1-24 1e: fixture — another profile owns a live entry');
  await assert.rejects(
    insertBodyweightEntry(asPg, {
      ...base,
      publicId: ids1e().publicId,
      clientId: foreign.clientId,
      day: '2026-11-03',
      value: 83,
    }),
    /neither a replay of this submit nor the day's weigh-in/,
    'V1-24 1e: an unexplained no-op throws instead of answering plausibly',
  );
  assert.equal((await liveOn('2026-11-03')).length, 0, 'V1-24 1e: and nothing was written');

  // A replay of a SOFT-DELETED submit (a still-mounted form resubmitting after a correction removed its
  // row) on a day another weigh-in now holds → dayTaken. The replay lookup must skip deleted rows, or
  // it would answer the dead row's id: success reported, nothing saved.
  const resubmit = await insertBodyweightEntry(asPg, {
    ...base,
    publicId: ids1e().publicId,
    clientId: first.clientId, // `first` was soft-deleted above; `after` holds 2026-11-01
    day: '2026-11-01',
    value: 80,
  });
  assert.deepEqual(
    resubmit,
    { dayTaken: true },
    "V1-24 1e: a soft-deleted submit's replay is not answered with the dead row",
  );

  // The replay lookup is pinned to WEIGH-INS: a POST reusing the client_id of the same profile's
  // non-bodyweight entry conflicts on uq_entries_client_id, and must never be answered with that row's id.
  const bout = await insertBodyweightProbe({
    profileId: bwOwnerRow.id,
    value: 20,
    metricKey: METRIC_KEYS.pushups,
    activityDate: '2026-11-05',
  });
  const [boutRow] = await db
    .select({ clientId: schema.entries.clientId })
    .from(schema.entries)
    .where(eq(schema.entries.publicId, bout.publicId));
  await assert.rejects(
    insertBodyweightEntry(asPg, {
      ...base,
      publicId: ids1e().publicId,
      clientId: boutRow.clientId,
      day: '2026-11-05',
      value: 84,
    }),
    /neither a replay of this submit nor the day's weigh-in/,
    "V1-24 1e: another metric's client_id is not a replay of this weigh-in",
  );
  assert.equal((await liveOn('2026-11-05')).length, 0, 'V1-24 1e: and no weigh-in was written');

  // The day-taken lookup keys on the SAME slot as the index (coalesce(context,'morning')): an EVENING
  // weigh-in does not take the default slot. Reached via an unexplained conflict on a day that holds
  // only an evening row → the throw in (c), not a false dayTaken.
  await insertBodyweightProbe({
    profileId: bwOwnerRow.id,
    value: 79,
    activityDate: '2026-11-06',
    context: 'evening',
  });
  await assert.rejects(
    insertBodyweightEntry(asPg, {
      ...base,
      publicId: ids1e().publicId,
      clientId: foreign.clientId,
      day: '2026-11-06',
      value: 85,
    }),
    /neither a replay of this submit nor the day's weigh-in/,
    'V1-24 1e: an evening weigh-in does not read as the default slot taken',
  );
}
console.log(
  "✓ V1-24 1e: target-less DO NOTHING through the app's own statement — insert, replay → same id, other device → dayTaken (value untouched), soft-delete frees the day, a foreign client_id throws without leaking; a dead row's replay, another metric's client_id and an evening slot are not misread",
);

// Constraint rejections (via the reused helper): natural-key UNIQUE, metric_key FK, profile_id FK,
// target_value CHECK.
await expectRejectedBy('uq_ramp_targets_profile_metric_week', () =>
  db.insert(schema.rampTargets).values({
    publicId: '019826b4-0000-7000-8000-0000000000fa',
    profileId: rampTestProfile.id,
    metricKey: METRIC_KEYS.pushups, // dup (profile, metric, week) → partial UNIQUE violated
    weekStart: RAMP_TEST_WEEK_START,
    targetValue: '50',
  }),
);
await expectRejectedBy('ramp_targets_metric_key_metric_definitions_key_fk', () =>
  db.insert(schema.rampTargets).values({
    publicId: '019826b4-0000-7000-8000-0000000000fb',
    profileId: rampTestProfile.id,
    metricKey: 'not_a_real_metric', // FK → metric_definitions.key violated
    weekStart: RAMP_TEST_WEEK_START,
    targetValue: '10',
  }),
);
await expectRejectedBy('ramp_targets_profile_id_profiles_id_fk', () =>
  db.insert(schema.rampTargets).values({
    publicId: '019826b4-0000-7000-8000-0000000000fc',
    profileId: 9_999_999, // FK → profiles.id violated (no such profile)
    metricKey: METRIC_KEYS.pushups,
    weekStart: RAMP_TEST_WEEK_START,
    targetValue: '10',
  }),
);
await expectRejectedBy('ramp_targets_target_value_check', () =>
  db.insert(schema.rampTargets).values({
    publicId: '019826b4-0000-7000-8000-0000000000fd',
    profileId: rampTestProfile.id,
    metricKey: METRIC_KEYS.pullups,
    weekStart: RAMP_TEST_WEEK_START,
    targetValue: '-1', // CHECK target_value >= 0 violated
  }),
);
console.log(
  '✓ V1-6b-1: ramp_targets rejections (natural-key UNIQUE, metric FK, profile FK, target CHECK)',
);

// ── V1-10 (PR 1): the programming data model (program_blocks → prescriptions → prescription_targets) ──
// DB-only, ships dark; the seed ships EMPTY. Prove the SCHEMA (columns, CHECK↔const parity, FK/unique/CHECK
// rejections) AND the seed RESOLVER — a test-only fixture driven through the REAL seedProgram, since the empty
// PROGRAM_SEED otherwise leaves the resolve-by-slug/public_id + ON CONFLICT arbiter unexercised until real data.

const V1_10_COLUMNS = [
  ['program_blocks', { public_id: 'uuid', household_id: 'bigint', slug: 'text', name: 'text' }],
  [
    'prescriptions',
    {
      public_id: 'uuid',
      block_id: 'bigint',
      day_role: 'text',
      movement_id: 'bigint',
      idx: 'integer',
      sets: 'integer',
      target_reps: 'text',
    },
  ],
  [
    'prescription_targets',
    {
      public_id: 'uuid',
      prescription_id: 'bigint',
      profile_id: 'bigint',
      load: 'text',
      reps: 'text',
    },
  ],
] as const;
for (const [table, expected] of V1_10_COLUMNS) {
  const cols = await columnsOf(table);
  for (const [col, type] of Object.entries(expected)) {
    assert.equal(cols.get(col), type, `V1-10: ${table}.${col} is ${type}`);
  }
}
console.log('✓ V1-10: program_blocks / prescriptions / prescription_targets columns + types');

// The frozen migration day_role list can't silently drift from the shared DAY_ROLES const.
await assertCheckCoversConst('prescriptions_day_role_check', DAY_ROLES);

// The seed is now POPULATED with Ray's real block (V1-10 PR 1b) — prove it seeded + resolved end-to-end.
assert.ok(PROGRAM_SEED.length >= 1, 'V1-10: PROGRAM_SEED is populated (Ray’s real block)');
const seededBlocks = (
  (await db.execute(sql`select count(*)::int as count from program_blocks`)).rows as unknown as {
    count: number;
  }[]
)[0].count;
// EXACT count (not just ≥1): the DB must hold precisely the blocks PROGRAM_SEED declares — nothing extra
// (an accidental / LLM-drafted block would fail here, the safety the old `== 0` empty-guard provided).
assert.equal(
  seededBlocks,
  PROGRAM_SEED.length,
  'V1-10: exactly PROGRAM_SEED’s blocks are seeded (no unexpected extras)',
);

// The kids_s&c_foundation block resolved all 3 strength days × 7 movements, with per-kid loads/reps intact.
const realBlock = (
  await db.execute(sql`
    select pr.day_role, pr.idx, pr.target_reps, m.slug as movement_slug, p.public_id as profile_public_id,
           pt.load, pt.reps
    from prescription_targets pt
    join prescriptions pr on pr.id = pt.prescription_id
    join program_blocks pb on pb.id = pr.block_id
    join movements m on m.id = pr.movement_id
    join profiles p on p.id = pt.profile_id
    where pb.slug = 'youth_daily_program'`)
).rows as unknown as {
  day_role: string;
  idx: number;
  target_reps: string;
  movement_slug: string;
  profile_public_id: string;
  load: string | null;
  reps: string | null;
}[];
// 2026-09-24: the seeded block is now the YOUTH DAILY PROGRAM, not the Kids S&C Foundation block
// (archived at docs/programs/kids-sc-foundation-archived.md). Ray's call — the kids run the daily
// program, so that is what the app should scaffold. Both cannot be seeded: `programDayRows` picks the
// newest block per day-role, so two would silently hijack one card with the other.
//
// 7 Day-A + 6 Day-B prescriptions × 2 kids = 26 target rows, 13 distinct slots.
assert.equal(
  realBlock.length,
  26,
  'YDP: the seeded block has 26 per-kid targets (13 prescriptions × 2 kids)',
);
assert.equal(
  new Set(realBlock.map((r) => `${r.day_role}#${r.idx}`)).size,
  13,
  'YDP: 13 distinct (day_role, idx) prescription slots',
);

// BOTH letters are programmed — the rotation runs every calendar day, so a card must exist daily.
assert.deepEqual(
  [...new Set(realBlock.map((r) => r.day_role))].sort(),
  ['strength_a', 'strength_b'],
  'YDP: both day letters are programmed',
);

// The core four run on BOTH days; the rotating pair is A-only and the swing is B-only. That is the
// design — the athlete does a jump OR a swing daily while each movement lands every other session.
const slugsOn = (role: string) =>
  new Set(realBlock.filter((r) => r.day_role === role).map((r) => r.movement_slug));
const dayA = slugsOn('strength_a');
const dayB = slugsOn('strength_b');
for (const core of ['push-ups', 'pull-up', 'leg_raises', 'v-sit_crunches']) {
  assert.ok(dayA.has(core) && dayB.has(core), `YDP: '${core}' runs every session`);
}
assert.ok(dayA.has('box_jump') && !dayB.has('box_jump'), 'YDP: box jumps are Day A only');
assert.ok(dayA.has('inverted_rows') && !dayB.has('inverted_rows'), 'YDP: inverted rows are A only');
assert.ok(dayB.has('kb_swings') && !dayA.has('kb_swings'), 'YDP: KB swings are Day B only');

// ⚠️ NO AUTHORED LOADS ANYWHERE. Two independent reasons, and both matter: the product rule that the
// LLM never authors loads, and the sheet's own design — it deliberately shows no goal numbers,
// because "the absence of a target reduced the 'I failed today' effect".
assert.ok(
  realBlock.every((r) => r.load === null),
  'YDP: no prescribed loads — the athlete logs what they actually did',
);
console.log('✓ YDP: daily A/B block seeded — both letters, core four daily, no authored loads');

// Drive a TEST-ONLY fixture through the REAL seedProgram (its own household/profile/block slug so a future
// real data-PR block can never collide). Proves resolve-by-slug + resolve-by-public_id + the arbiter.
const VERIFY_HH_PUBLIC_ID = '019826b4-0000-7000-8000-0000000000e0';
const VERIFY_PROFILE_PUBLIC_ID = '019826b4-0000-7000-8000-0000000000e1';
await db
  .insert(schema.households)
  .values({ publicId: VERIFY_HH_PUBLIC_ID, name: 'Verify Programming HH' });
const [verifyHh] = await db
  .select({ id: schema.households.id, synthetic: schema.households.synthetic })
  .from(schema.households)
  .where(eq(schema.households.publicId, VERIFY_HH_PUBLIC_ID));
// TEN-1 1a: the insert above never named `synthetic`, so a `false` here proves the DEFAULT is in the
// CATALOG and applies to a real INSERT — the behavioural half of the readback near the seed checks,
// which read the catalog text. A household is not synthetic unless its creator says so.
assert.equal(
  verifyHh.synthetic,
  false,
  'TEN-1 1a: an insert that does not name synthetic gets false from the column DEFAULT',
);

// ── THE SECOND SCOPE. `householdScopeForScript(` appears in this file EXACTLY TWICE — see A_SCOPE ──
// Defined here, the moment household B exists, because TEN-1 1c made `programDayRows` scoped and the
// V1-10 block below is the single biggest consumer of B's scope (its whole point is that A and B
// program DISJOINT day_roles). The TEN-1 matrix ~900 lines down uses this same constant.
const B_SCOPE = householdScopeForScript(verifyHh.id);

await db.insert(schema.profiles).values({
  publicId: VERIFY_PROFILE_PUBLIC_ID,
  name: 'Verify Kid',
  kind: 'kid',
  householdId: verifyHh.id,
});
const [anyMovement] = await db
  .select({ id: schema.movements.id, slug: schema.movements.slug })
  .from(schema.movements)
  .limit(1);

const programFixture: ProgramBlockSeedRow = {
  householdPublicId: VERIFY_HH_PUBLIC_ID,
  slug: 'verify_test_block',
  name: 'Verify Test Block',
  notes: null,
  prescriptions: [
    {
      dayRole: 'strength',
      movementSlug: anyMovement.slug,
      idx: 0,
      sets: 3,
      targetReps: '5',
      targets: [{ profilePublicId: VERIFY_PROFILE_PUBLIC_ID, load: '65', reps: '4, last AMRAP' }],
    },
  ],
};

await seedProgram(asPg, [programFixture]);
const graph = (
  await db.execute(sql`
    select pb.slug as block_slug, pr.day_role, pr.idx, pr.target_reps, m.slug as movement_slug,
           pt.load, pt.reps, p.public_id as profile_public_id
    from prescription_targets pt
    join prescriptions pr on pr.id = pt.prescription_id
    join program_blocks pb on pb.id = pr.block_id
    join movements m on m.id = pr.movement_id
    join profiles p on p.id = pt.profile_id
    where pb.slug = 'verify_test_block'`)
).rows as unknown as {
  block_slug: string;
  day_role: string;
  idx: number;
  target_reps: string;
  movement_slug: string;
  load: string;
  reps: string | null;
  profile_public_id: string;
}[];
assert.equal(graph.length, 1, 'V1-10: seedProgram wrote the block→prescription→target graph');
assert.equal(graph[0].load, '65', 'V1-10: per-kid load round-trips verbatim');
assert.equal(graph[0].reps, '4, last AMRAP', 'V1-10: per-kid reps override round-trips verbatim');
assert.equal(graph[0].target_reps, '5', 'V1-10: prescription target_reps round-trips');
assert.equal(
  graph[0].movement_slug,
  anyMovement.slug,
  'V1-10: prescription resolves movement by slug',
);
assert.equal(
  graph[0].profile_public_id,
  VERIFY_PROFILE_PUBLIC_ID,
  'V1-10: target resolves profile by public_id',
);

// Idempotent re-run — exercises each ON CONFLICT arbiter's WHERE deleted_at IS NULL (the V1-5 lesson).
await seedProgram(asPg, [programFixture]);
const reseed = (
  await db.execute(sql`
    select
      (select count(*)::int from program_blocks where slug = 'verify_test_block') as blocks,
      (select count(*)::int from prescriptions pr
        join program_blocks pb on pb.id = pr.block_id where pb.slug = 'verify_test_block') as prescriptions,
      (select count(*)::int from prescription_targets pt
        join prescriptions pr on pr.id = pt.prescription_id
        join program_blocks pb on pb.id = pr.block_id where pb.slug = 'verify_test_block') as targets`)
).rows as unknown as { blocks: number; prescriptions: number; targets: number }[];
assert.deepEqual(
  reseed[0],
  { blocks: 1, prescriptions: 1, targets: 1 },
  'V1-10: re-seed is idempotent (ON CONFLICT arbiters match the partial-unique indexes)',
);
console.log(
  '✓ V1-10: seedProgram resolver + idempotent re-seed (block→prescription→target round-trips)',
);

// ── V1-10 (slice 2): the read DAL's EXACT query (programDayRows), proven here ──────────────────
// `getProgramDay` and THIS proof both call `programDayRows`, so the shipped join shape — including its
// BOLA scoping and the per-kid LEFT JOIN — is what gets exercised (the `weeklyAdherenceRows` precedent).

// (a) The YOUTH DAILY PROGRAM: Day A is 7 movements, in the coach's authored `idx` order.
const athleteOneDayA = await programDayRows(asPg, {
  scope: A_SCOPE,
  profilePublicId: SEED_PROFILE_PUBLIC_ID,
  dayRole: 'strength_a',
});
assert.equal(athleteOneDayA.length, 7, 'YDP: programDayRows returns Day A’s 7 movements');
assert.deepEqual(
  athleteOneDayA.map((r) => r.movementName),
  [
    'Push-Ups',
    'Pull-Up',
    'Leg Raises',
    'V-Sit Crunches',
    'Box Jump',
    'Inverted Rows',
    'Single-Leg Hip Thrusts',
  ],
  'YDP: programDayRows orders by the prescription idx (the coach’s authored order)',
);

// ── PROF-1 a-g: the kid-only program read, proved three ways ───────────────────────────────────
// 🔴 **The POSITIVE case is the `athleteOneDayA` assertion above** — the seeded athlete is a `kid`
// (`seed.ts:218`, `:227`; the seed writes no adult), so the 7 rows it just returned ARE the proof
// that the new `profiles.kind` conjunct does not break the read it is meant to allow. Stated here
// because a negative-only proof would pass just as well against a query that returns nothing at all.
{
  const AG_ADULT = '019826b4-0000-7000-8000-00000004a001';

  // An ADULT in household A, which HAS a live block programming Day A — so the only thing that can
  // empty this read is the kind conjunct.
  await db.insert(schema.profiles).values({
    publicId: AG_ADULT,
    name: 'A-g Adult',
    kind: 'adult',
    householdId: households[0].id, // household A, the seeded one A_SCOPE wraps
  });

  const adultDayA = await programDayRows(asPg, {
    scope: A_SCOPE,
    profilePublicId: AG_ADULT,
    dayRole: 'strength_a',
  });
  assert.equal(
    adultDayA.length,
    0,
    'PROF-1 a-g: an ADULT reads no program rows, in a household whose block programs that day',
  );

  // 🔴 **THE FLIP, which is the case the maintainer has to understand before a-r ships.** `kind` is
  // read at QUERY time, not snapshotted, so flipping a kid to adult empties `prescribed` in every
  // PAST month of their export — and flipping back restores it. a-r can perform exactly this flip
  // from the edit form, which is why that form says so. Asserted in both directions, because a
  // one-way assertion would pass against a query that had simply stopped working.
  await db
    .update(schema.profiles)
    .set({ kind: 'adult' })
    .where(eq(schema.profiles.publicId, SEED_PROFILE_PUBLIC_ID));
  const flippedToAdult = await programDayRows(asPg, {
    scope: A_SCOPE,
    profilePublicId: SEED_PROFILE_PUBLIC_ID,
    dayRole: 'strength_a',
  });
  assert.equal(
    flippedToAdult.length,
    0,
    'PROF-1 a-g: flipping a kid to adult empties a day that returned 7 rows a moment ago',
  );

  await db
    .update(schema.profiles)
    .set({ kind: 'kid' })
    .where(eq(schema.profiles.publicId, SEED_PROFILE_PUBLIC_ID));
  const flippedBack = await programDayRows(asPg, {
    scope: A_SCOPE,
    profilePublicId: SEED_PROFILE_PUBLIC_ID,
    dayRole: 'strength_a',
  });
  assert.equal(
    flippedBack.length,
    7,
    'PROF-1 a-g: flipping back to kid restores all 7 rows — the read is not destructive',
  );

  // Leave no adult behind: later blocks count rows in household A.
  await db.delete(schema.profiles).where(eq(schema.profiles.publicId, AG_ADULT));

  console.log(
    '✓ PROF-1 a-g: the program read is kid-only — an adult in a programmed household reads zero ' +
      'rows, and the flip empties and restores a past day in both directions',
  );
}

// Day B swaps the rotating pair for the swing — 6 movements, and the athlete does a jump OR a swing
// every day while each individual movement lands every other session.
const athleteOneDayB = await programDayRows(asPg, {
  scope: A_SCOPE,
  profilePublicId: SEED_PROFILE_PUBLIC_ID,
  dayRole: 'strength_b',
});
assert.equal(athleteOneDayB.length, 6, 'YDP: programDayRows returns Day B’s 6 movements');
assert.ok(
  athleteOneDayB.some((r) => r.movementName === 'KB Swings'),
  'YDP: Day B carries the swing',
);
assert.ok(
  !athleteOneDayB.some((r) => r.movementName === 'Box Jump'),
  'YDP: Day B does NOT carry the jump',
);

// (b) Per-kid isolation — the SAME prescription yields each kid their own row. The YDP prescribes no
// loads at all, so what this proves is that BOTH kids get a row per movement (a WHERE-scoped join
// would drop one), not that the loads differ.
const athleteTwoDayA = await programDayRows(asPg, {
  scope: A_SCOPE,
  profilePublicId: SEED_PROFILE_2_PUBLIC_ID,
  dayRole: 'strength_a',
});
assert.equal(athleteTwoDayA.length, 7, 'YDP: the sibling gets their own 7 Day-A rows');
assert.ok(
  athleteOneDayA.every((r) => r.load === null) && athleteTwoDayA.every((r) => r.load === null),
  'YDP: no authored loads reach the card — the athlete logs what they did',
);

// (b2) V1-26 PR-A — the MOVEMENT's declaration rides out of the shipped query.
//
// This is the column pair that feeds the log form's Unit select and its BW-tap warning, and the seed
// is the real catalog, so this proves the actual movements the athletes log against — not a fixture.
// `KB Swings` is the 2026-09-28 movement: declared loaded, in pounds, and logged `20 × BW`.
const kbSwings = athleteOneDayB.find((r) => r.movementName === 'KB Swings');
assert.equal(kbSwings?.movementUnitDefault, 'lb', 'V1-26: KB Swings declares a pound default');
assert.equal(kbSwings?.movementIsBodyweight, false, 'V1-26: ...and is NOT a bodyweight movement');

const pushUps = athleteOneDayA.find((r) => r.movementName === 'Push-Ups');
assert.equal(pushUps?.movementIsBodyweight, true, 'V1-26: Push-Ups declares bodyweight');
assert.equal(pushUps?.movementUnitDefault, null, 'V1-26: ...and declares no unit');

// ⚠️ The declaration is the MOVEMENT's, never the coach's. `load` stays null on every YDP row (asserted
// just above), so widening the query did not open a path for an authored magnitude to reach an input.
assert.ok(
  athleteOneDayA.every((r) => r.load === null),
  'V1-26: widening the select did not let a prescribed load through',
);

// The one fixed prescription in the program survives the read.
const hipThrust = athleteOneDayA.find((r) => r.movementName === 'Single-Leg Hip Thrusts');
assert.equal(hipThrust?.sets, 3, 'YDP: hip thrusts keep their fixed 3 sets');
assert.equal(hipThrust?.targetReps, '10 per side', 'YDP: ...and their per-side prescription');

// (c) A day with no prescriptions → zero rows (the page renders no card). Strength B exists; 'skill' doesn't.
assert.equal(
  (
    await programDayRows(asPg, {
      profilePublicId: SEED_PROFILE_PUBLIC_ID,
      dayRole: 'skill',
      scope: A_SCOPE,
    })
  ).length,
  0,
  'V1-10: an unprogrammed day_role returns no rows',
);

// (d) BOLA, probed in BOTH directions. The two households program DISJOINT day_roles — the seed block only
// has strength_a/b/c, the verify block only has plain 'strength' — so each direction is a real leak test:
// whichever household you ask from, the OTHER household's day_role must come back empty. (Asking only one
// way would pass even with the household scoping deleted, since the globally-newest block happens to be
// the verify one — the assertion would then be proving fixture ordering, not ownership.)
//
// ⚠️ Each direction asks from its OWN household's scope (TEN-1 1c), so what is under test here is still
// the day_role disjointness and the block selection — not the scope. Asking from the WRONG scope would
// make these pass for a second reason and stop proving what their messages say. The scope's own four-way
// proof is the TEN-1 matrix at the end of this file, which seeds a day_role BOTH households program so a
// refusal cannot be mistaken for an unprogrammed day.
assert.equal(
  (
    await programDayRows(asPg, {
      profilePublicId: VERIFY_PROFILE_PUBLIC_ID,
      dayRole: 'strength_a',
      scope: B_SCOPE,
    })
  ).length,
  0,
  'V1-10: another household’s profile cannot read the kids’ strength_a (BOLA)',
);
assert.equal(
  (
    await programDayRows(asPg, {
      profilePublicId: SEED_PROFILE_PUBLIC_ID,
      dayRole: 'strength',
      scope: A_SCOPE,
    })
  ).length,
  0,
  'V1-10: …and a kid cannot read the other household’s plain-strength day (BOLA, reverse)',
);
const otherHouseholdOwn = await programDayRows(asPg, {
  profilePublicId: VERIFY_PROFILE_PUBLIC_ID,
  dayRole: 'strength',
  scope: B_SCOPE,
});
assert.equal(otherHouseholdOwn.length, 1, 'V1-10: …but each DOES return its OWN household’s block');
assert.equal(otherHouseholdOwn[0].load, '65', 'V1-10: with this profile’s own target');

// (e) A sibling with NO target on a prescription gets the row with a NULL load — never the other kid's.
// This is the LEFT JOIN (an inner join would DROP the movement; a WHERE-scoped one would leak '65').
const VERIFY_PROFILE_2_PUBLIC_ID = '019826b4-0000-7000-8000-0000000000e2';
await db.insert(schema.profiles).values({
  publicId: VERIFY_PROFILE_2_PUBLIC_ID,
  name: 'Verify Kid 2',
  kind: 'kid',
  householdId: verifyHh.id,
});
const untargeted = await programDayRows(asPg, {
  profilePublicId: VERIFY_PROFILE_2_PUBLIC_ID,
  dayRole: 'strength',
  scope: B_SCOPE,
});
assert.equal(
  untargeted.length,
  1,
  'V1-10: a kid with no target still sees the prescribed movement',
);
assert.equal(untargeted[0].load, null, 'V1-10: …with a NULL load, not the sibling’s');
assert.equal(untargeted[0].targetReps, '5', 'V1-10: …and the shared prescription reps');

// (f) An UNKNOWN profile id matches no household → zero rows (never an unscoped fan-out across every
// household's blocks). A household-LESS profile isn't probed here because it can't exist: the V1-1a
// `profiles_household_id_not_null` CHECK rejects the insert — the query's isNull-household case is
// belt-and-braces behind that constraint.
assert.equal(
  (
    await programDayRows(asPg, {
      profilePublicId: '019826b4-0000-7000-8000-0000000000ff',
      dayRole: 'strength',
      scope: B_SCOPE,
    })
  ).length,
  0,
  'V1-10: an unknown profile returns no rows (no unscoped fan-out)',
);

// (g) Deterministic single block: a household with TWO blocks resolves to the NEWEST only (ORDER BY id
// DESC LIMIT 1) — a bare join would fan the day out across every block the household ever authored.
await seedProgram(asPg, [
  {
    householdPublicId: VERIFY_HH_PUBLIC_ID,
    slug: 'verify_newer_block',
    name: 'Verify Newer Block',
    notes: null,
    prescriptions: [
      {
        dayRole: 'strength',
        movementSlug: anyMovement.slug,
        idx: 0,
        sets: 9,
        targetReps: 'newer',
        targets: [{ profilePublicId: VERIFY_PROFILE_PUBLIC_ID, load: '999', reps: null }],
      },
    ],
  },
]);
const twoBlocks = await programDayRows(asPg, {
  profilePublicId: VERIFY_PROFILE_PUBLIC_ID,
  dayRole: 'strength',
  scope: B_SCOPE,
});
assert.equal(twoBlocks.length, 1, 'V1-10: two blocks do NOT fan the day out (one block wins)');
assert.equal(twoBlocks[0].targetReps, 'newer', 'V1-10: the NEWEST block wins deterministically');

// (g2) …but "newest" is chosen only among blocks that PROGRAM THE REQUESTED DAY. Seed a third, even
// newer block that programs a DIFFERENT day_role: asking for 'strength' must still fall back to
// `verify_newer_block`, NOT blank the card. A plain `ORDER BY id DESC LIMIT 1` would pick this block,
// find no 'strength' prescriptions in it, and silently return zero rows — the real-world failure is Ray
// seeding next mesocycle under a new slug and Monday's card quietly going empty.
await seedProgram(asPg, [
  {
    householdPublicId: VERIFY_HH_PUBLIC_ID,
    slug: 'verify_newest_other_role_block',
    name: 'Verify Newest Other Role Block',
    notes: null,
    prescriptions: [
      {
        dayRole: 'skill', // deliberately NOT 'strength'
        movementSlug: anyMovement.slug,
        idx: 0,
        sets: 1,
        targetReps: 'other-role',
        targets: [{ profilePublicId: VERIFY_PROFILE_PUBLIC_ID, load: '1', reps: null }],
      },
    ],
  },
]);
const stillFallsBack = await programDayRows(asPg, {
  profilePublicId: VERIFY_PROFILE_PUBLIC_ID,
  dayRole: 'strength',
  scope: B_SCOPE,
});
assert.equal(
  stillFallsBack.length,
  1,
  'V1-10: a newer block that does NOT program this day must not blank the card',
);
assert.equal(
  stillFallsBack[0].targetReps,
  'newer',
  'V1-10: …it falls back to the newest block that DOES program this day',
);
// …and that newest block still answers for the day it does program.
assert.equal(
  (
    await programDayRows(asPg, {
      profilePublicId: VERIFY_PROFILE_PUBLIC_ID,
      dayRole: 'skill',
      scope: B_SCOPE,
    })
  )[0]?.targetReps,
  'other-role',
  'V1-10: the newest block still wins for the day_role it programs',
);
console.log(
  '✓ V1-10: programDayRows (the DAL query) — idx order, per-kid loads, BOLA + day-aware block scoping',
);

// (h) SOFT DELETES — the query filters `deleted_at` on all four tables it touches; without coverage a
// later refactor drops one silently. The `prescription_targets` filter is the sharpest: its unique index
// is partial (`WHERE deleted_at IS NULL`), so a future "change a kid's load" writer that soft-deletes and
// re-inserts legally leaves TWO target rows — and an unfiltered LEFT JOIN would then render the movement
// TWICE, once with a stale load. Probed on a dedicated block so nothing above is disturbed.
const VERIFY_SD_PROFILE_PUBLIC_ID = '019826b4-0000-7000-8000-0000000000e4';
await db.insert(schema.profiles).values({
  publicId: VERIFY_SD_PROFILE_PUBLIC_ID,
  name: 'Verify Soft-Delete Kid',
  kind: 'kid',
  householdId: verifyHh.id,
});
await seedProgram(asPg, [
  {
    householdPublicId: VERIFY_HH_PUBLIC_ID,
    slug: 'verify_soft_delete_block',
    name: 'Verify Soft Delete Block',
    notes: null,
    prescriptions: [
      {
        dayRole: 'core',
        movementSlug: anyMovement.slug,
        idx: 0,
        sets: 2,
        targetReps: '10',
        targets: [{ profilePublicId: VERIFY_SD_PROFILE_PUBLIC_ID, load: 'sd-load', reps: null }],
      },
    ],
  },
]);
const sdArgs = {
  profilePublicId: VERIFY_SD_PROFILE_PUBLIC_ID,
  dayRole: 'core',
  scope: B_SCOPE,
} as const;
const [sdBaseline] = await programDayRows(asPg, sdArgs);
assert.equal(sdBaseline?.load, 'sd-load', 'V1-10: soft-delete fixture renders before any deletion');

// h1 — a soft-deleted TARGET: the movement still shows (LEFT JOIN), but with NO load, and exactly once.
const [sdPrescription] = await db
  .select({ id: schema.prescriptions.id, movementId: schema.prescriptions.movementId })
  .from(schema.prescriptions)
  .innerJoin(schema.programBlocks, eq(schema.programBlocks.id, schema.prescriptions.blockId))
  .where(eq(schema.programBlocks.slug, 'verify_soft_delete_block'));
await db
  .update(schema.prescriptionTargets)
  .set({ deletedAt: new Date() })
  .where(eq(schema.prescriptionTargets.prescriptionId, sdPrescription.id));
const afterTargetDelete = await programDayRows(asPg, sdArgs);
assert.equal(
  afterTargetDelete.length,
  1,
  'V1-10: a soft-deleted target does not duplicate the row',
);
assert.equal(afterTargetDelete[0].load, null, 'V1-10: …and its load is gone, not stale');

// h2 — a soft-deleted MOVEMENT drops the row (it is prescribed from the grave otherwise).
await db
  .update(schema.movements)
  .set({ deletedAt: new Date() })
  .where(eq(schema.movements.id, sdPrescription.movementId));
assert.equal(
  (await programDayRows(asPg, sdArgs)).length,
  0,
  'V1-10: a soft-deleted movement drops off the card',
);
await db
  .update(schema.movements)
  .set({ deletedAt: null })
  .where(eq(schema.movements.id, sdPrescription.movementId)); // restore — other probes share the catalog

// h3 — a soft-deleted PRESCRIPTION drops the row.
await db
  .update(schema.prescriptions)
  .set({ deletedAt: new Date() })
  .where(eq(schema.prescriptions.id, sdPrescription.id));
assert.equal(
  (await programDayRows(asPg, sdArgs)).length,
  0,
  'V1-10: a soft-deleted prescription drops off the card',
);

// h4 — a soft-deleted BLOCK takes its whole day with it (and, with the day-aware selection above, a
// household whose only remaining block programs other days simply renders nothing).
await db
  .update(schema.prescriptions)
  .set({ deletedAt: null })
  .where(eq(schema.prescriptions.id, sdPrescription.id)); // restore the prescription…
await db
  .update(schema.programBlocks)
  .set({ deletedAt: new Date() })
  .where(eq(schema.programBlocks.slug, 'verify_soft_delete_block')); // …then delete its block
assert.equal(
  (await programDayRows(asPg, sdArgs)).length,
  0,
  'V1-10: a soft-deleted block takes its prescriptions off the card',
);
console.log('✓ V1-10: programDayRows excludes soft-deleted blocks/prescriptions/targets/movements');

// Resolve the fixture ids for the rejection probes.
const [verifyBlock] = await db
  .select({ id: schema.programBlocks.id })
  .from(schema.programBlocks)
  .where(
    and(
      eq(schema.programBlocks.householdId, verifyHh.id),
      eq(schema.programBlocks.slug, 'verify_test_block'),
    ),
  );
const [verifyPres] = await db
  .select({ id: schema.prescriptions.id })
  .from(schema.prescriptions)
  .where(eq(schema.prescriptions.blockId, verifyBlock.id));
const [verifyProfile] = await db
  .select({ id: schema.profiles.id })
  .from(schema.profiles)
  .where(eq(schema.profiles.publicId, VERIFY_PROFILE_PUBLIC_ID));

// FK rejections (valid movement id so the row fails ONLY on the probed FK).
await expectRejectedBy('prescriptions_block_id_program_blocks_id_fk', () =>
  db.insert(schema.prescriptions).values({
    publicId: newId(),
    blockId: 9_999_999,
    dayRole: 'strength',
    movementId: anyMovement.id,
    idx: 0,
  }),
);
await expectRejectedBy('prescription_targets_profile_id_profiles_id_fk', () =>
  db.insert(schema.prescriptionTargets).values({
    publicId: newId(),
    prescriptionId: verifyPres.id,
    profileId: 9_999_999,
    load: '1',
  }),
);

// CHECK rejections (each row violates exactly one CHECK; distinct idx values avoid a unique collision masking it).
await expectRejectedBy('prescriptions_day_role_check', () =>
  db.insert(schema.prescriptions).values({
    publicId: newId(),
    blockId: verifyBlock.id,
    dayRole: 'not_a_role',
    movementId: anyMovement.id,
    idx: 5,
  }),
);
await expectRejectedBy('prescriptions_idx_check', () =>
  db.insert(schema.prescriptions).values({
    publicId: newId(),
    blockId: verifyBlock.id,
    dayRole: 'strength',
    movementId: anyMovement.id,
    idx: -1,
  }),
);
await expectRejectedBy('prescriptions_sets_check', () =>
  db.insert(schema.prescriptions).values({
    publicId: newId(),
    blockId: verifyBlock.id,
    dayRole: 'strength',
    movementId: anyMovement.id,
    idx: 6,
    sets: 0,
  }),
);

// Partial-unique BOTH directions (the V1-5 soft-delete lesson): a LIVE duplicate target is rejected...
await expectRejectedBy('uq_prescription_targets_prescription_profile', () =>
  db.insert(schema.prescriptionTargets).values({
    publicId: newId(),
    prescriptionId: verifyPres.id,
    profileId: verifyProfile.id,
    load: 'dup',
  }),
);
// ...but soft-deleting it frees the slot to re-insert (the partial WHERE deleted_at IS NULL arbiter).
await db
  .update(schema.prescriptionTargets)
  .set({ deletedAt: new Date() })
  .where(
    and(
      eq(schema.prescriptionTargets.prescriptionId, verifyPres.id),
      eq(schema.prescriptionTargets.profileId, verifyProfile.id),
    ),
  );
await db.insert(schema.prescriptionTargets).values({
  publicId: newId(),
  prescriptionId: verifyPres.id,
  profileId: verifyProfile.id,
  load: '70',
}); // must NOT throw — the partial index excludes the soft-deleted row
console.log('✓ V1-10: FK + CHECK + partial-unique (both directions) rejections');

// The seed resolver fails LOUDLY on an unresolved ref (here a typo'd movement slug), not a silent skip — so
// a future data-only PR's authoring mistake is caught at seed time, never shipped as a missing prescription.
await assert.rejects(
  seedProgram(asPg, [
    {
      householdPublicId: VERIFY_HH_PUBLIC_ID,
      slug: 'verify_typo_block',
      name: 'Verify Typo Block',
      notes: null,
      prescriptions: [
        {
          dayRole: 'strength',
          movementSlug: 'definitely_not_a_movement',
          idx: 0,
          sets: 1,
          targetReps: null,
          targets: [],
        },
      ],
    },
  ]),
  /unknown movement slug/,
  'V1-10: seedProgram throws on an unresolved movement slug (no silent skip)',
);
// Refs are resolved BEFORE the block insert, so the throw left nothing written.
const typoBlocks = (
  (
    await db.execute(
      sql`select count(*)::int as count from program_blocks where slug = 'verify_typo_block'`,
    )
  ).rows as unknown as { count: number }[]
)[0].count;
assert.equal(typoBlocks, 0, 'V1-10: a resolver throw leaves no partial block written');
console.log('✓ V1-10: seedProgram fails loudly (+ writes nothing) on an unresolved ref');

// ── V1-22 chunk 1: the prescribed snapshot ────────────────────────────────────────────────────────
// NINE cases: {NULL, '', a real rendered string} × {movement arm, metric arm, NEITHER arm}.
//
// Why nine and not one reject case. The NEITHER arm is LEGAL — entries_value_source_check is
// at-most-one, not XOR (0002:79), and a boolean habit check-in writes exactly that shape. It is the
// row that kills the adjacent-column mutant `prescribed_snapshot IS NULL OR metric_key IS NULL`
// (those columns are declared consecutively, and the existing guard is written in terms of that
// pair), which a metric-arm-only proof passes while permitting a snapshot on the rows it forbids.
// The '' rows kill three more, including `coalesce(prescribed_snapshot,'') = '' OR …` — the exact
// form the spec forbids by name — and `= '' OR …`, which slips through on NULL.
// Plan: docs/plans/v1-22-1-prescribed-snapshot.md → "The state table".
const SNAP_CHECK = 'entries_prescribed_snapshot_movement_check';
const SNAP_RENDERED = '4x3 @ 145'; // what export.ts's composer actually emits
const SNAP_COMMA = '3 (top triple, then 2 back-offs)'; // a real seeded prescription (csv/row.ts)

const snapMovementId = (
  await db.select({ id: schema.movements.id }).from(schema.movements).limit(1)
)[0].id;
const snapTypeId = await activityTypeIdByKey(SEED_ACTIVITY_TYPE_KEYS.weighIn);

/** One entry on a chosen arm, carrying a chosen snapshot. Ids come from a LOCAL COUNTER (the
 *  insertBodyweightProbe idiom) — this file hand-assigns ids in 23 other places, and a
 *  uq_entries_client_id collision would make expectRejectedBy report the WRONG constraint name and
 *  the proof would stop proving anything while staying green. Every row sets kind + value_num (so
 *  entries_shape_check is definitively TRUE, not NULL) and activity_type_id (so
 *  entries_activity_type_id_not_null cannot arbitrate first), and takes its own day. */
let snapProbe = 0;
function snapshotRow(arm: 'movement' | 'metric' | 'neither', snapshot: string | null) {
  snapProbe += 1;
  const n = snapProbe.toString(16).padStart(3, '0');
  return {
    publicId: `019826b4-0000-7000-8000-00000000d${n}`,
    clientId: `019826b4-0000-7000-8000-00000000e${n}`,
    profileId: profiles[0].id,
    activityDate: new Date(Date.UTC(2026, 10, 1) + snapProbe * 86_400_000)
      .toISOString()
      .slice(0, 10),
    kind: ENTRY_KIND.bodyweight,
    unit: arm === 'metric' ? 'bool' : 'lb',
    valueNum: '1',
    activityTypeId: snapTypeId,
    ...(arm === 'movement' ? { movementId: snapMovementId } : {}),
    ...(arm === 'metric' ? { metricKey: 'stance' } : {}),
    prescribedSnapshot: snapshot,
  };
}
const insertSnapshot = (arm: 'movement' | 'metric' | 'neither', snapshot: string | null) =>
  db.insert(schema.entries).values(snapshotRow(arm, snapshot));

// --- the five ACCEPTS -----------------------------------------------------------------------------
await insertSnapshot('movement', null);
await insertSnapshot('metric', null);
await insertSnapshot('neither', null); // 100% of pre-chunk-1 rows are in one of these three states
const readbackRow = snapshotRow('movement', '');
await db.insert(schema.entries).values(readbackRow);
await insertSnapshot('movement', SNAP_RENDERED);

// --- the four REJECTS. The two NEITHER rows are the discriminating ones. --------------------------
await expectRejectedBy(SNAP_CHECK, () => insertSnapshot('metric', ''));
await expectRejectedBy(SNAP_CHECK, () => insertSnapshot('neither', ''));
await expectRejectedBy(SNAP_CHECK, () => insertSnapshot('metric', SNAP_RENDERED));
await expectRejectedBy(SNAP_CHECK, () => insertSnapshot('neither', SNAP_RENDERED));
console.log(
  '✓ V1-22 chunk 1: the movement-arm guard rejects a snapshot on the metric AND neither arms',
);

// --- '' is STORED, not collapsed to NULL ----------------------------------------------------------
// This is what acceptance 10 rests on: `''` is the frozen rendering of a movement-only prescription
// (11 of 13 live prescriptions render empty) and NULL means "never snapshotted". Only NULL falls back
// to the live (day_role, movement) match, so the read predicate is `IS NULL` and never
// `coalesce(…,'') = ''`.
const readback = (
  await db
    .select({ snap: schema.entries.prescribedSnapshot })
    .from(schema.entries)
    .where(eq(schema.entries.publicId, readbackRow.publicId))
)[0];
assert.equal(readback.snap, '', "V1-22 chunk 1: '' reads back as '', not NULL");
assert.equal(readback.snap === null, false, "V1-22 chunk 1: '' is not NULL");
const emptyNotNull = (
  (
    await db.execute(
      sql`select count(*)::int as count from entries
           where public_id = ${readbackRow.publicId} and prescribed_snapshot is null`,
    )
  ).rows as unknown as { count: number }[]
)[0].count;
assert.equal(emptyNotNull, 0, "V1-22 chunk 1: an '' snapshot must not satisfy IS NULL");
console.log("✓ V1-22 chunk 1: '' and NULL are distinct stored values");

// ── V1-22 chunk 2: the WRITER freezes the prescription, through writeStrengthSession ───────────────
// 🔴 Chunk 1 proved `''` round-trips through a DIRECT insert. That left the thing acceptance 10
// actually depends on unproven: that the WRITER stores `''` as `''`. Three one-word mutants —
// `if (!rendered)`, `if (snapshot) map.set(…)`, `...(snapshot ? {…} : {})` — each store NULL for
// every `open()` prescription, which is 11 of the 13 seeded, and every other gate stays green:
// the renderer test proves `''` in isolation, and by acceptance 11 the export's fallback emits the
// same bytes, so even the browser cannot see it. This block is the only thing that can.
//
// ⚠️ **A DEDICATED block, and it is the NEWEST one programming `skill` — not the only one.**
// `verify_newest_other_role_block` already programs `skill` in this household, so this fixture wins
// by seed order plus `programDayRows`' newest-block rule, which is the very hazard described below
// reproduced inside the fixture written to avoid it. Asserted rather than assumed, just below.
// The obvious fixture, `verify_test_block`,
// is unreachable through the writer: `verify_newer_block` supersedes it for the same
// (profile, role, scope) triple and `programDayRows` takes the newest. Chasing that by switching the
// expectation to the newer block's values would silently drop the only writer-path proof of the
// per-kid reps precedence AND of a comma inside a rendered string.
const SNAP2_PROFILE_PUBLIC_ID = '019826b4-0000-7000-8000-0000000000e5';
await db.insert(schema.profiles).values({
  publicId: SNAP2_PROFILE_PUBLIC_ID,
  name: 'Verify Snapshot Kid',
  kind: 'kid',
  householdId: verifyHh.id,
});
const [snapMovA, snapMovB, snapMovC, snapMovD] = await db
  .select({ id: schema.movements.id, slug: schema.movements.slug, name: schema.movements.name })
  .from(schema.movements)
  .orderBy(schema.movements.id)
  .limit(4);
await seedProgram(asPg, [
  {
    householdPublicId: VERIFY_HH_PUBLIC_ID,
    slug: 'verify_snapshot_block',
    name: 'Verify Snapshot Block',
    notes: null,
    prescriptions: [
      // (a) an OPEN prescription — no sets, no target reps, no load. Renders `''`. The dominant shape.
      {
        dayRole: 'skill',
        movementSlug: snapMovA.slug,
        idx: 0,
        sets: null,
        targetReps: null,
        targets: [{ profilePublicId: SNAP2_PROFILE_PUBLIC_ID, load: null, reps: null }],
      },
      // (b) a FIXED prescription whose rendering carries a comma AND a per-kid reps override, so one
      // case proves the precedence and the comma together.
      {
        dayRole: 'skill',
        movementSlug: snapMovB.slug,
        idx: 1,
        sets: 3,
        targetReps: 'ignored-by-the-override',
        targets: [{ profilePublicId: SNAP2_PROFILE_PUBLIC_ID, load: '65', reps: '4, last AMRAP' }],
      },
      // (c) the SAME movement twice in one day — warm-up + working. Ambiguous by design.
      {
        dayRole: 'skill',
        movementSlug: snapMovC.slug,
        idx: 2,
        sets: 2,
        targetReps: '5',
        targets: [{ profilePublicId: SNAP2_PROFILE_PUBLIC_ID, load: '45', reps: null }],
      },
      {
        dayRole: 'skill',
        movementSlug: snapMovC.slug,
        idx: 3,
        sets: 3,
        targetReps: '8',
        targets: [{ profilePublicId: SNAP2_PROFILE_PUBLIC_ID, load: '95', reps: null }],
      },
    ],
  },
]);

const snapCid = (n: number) => `019826b4-0000-7000-8000-0000000019${String(n).padStart(2, '0')}`;
const snapArgs = {
  profilePublicId: SNAP2_PROFILE_PUBLIC_ID,
  scope: B_SCOPE,
  day: '2026-03-02',
  sessionType: SESSION_TYPES[0],
  sessionClientId: snapCid(1),
  activityTypeId: scLiftActivityId,
  dayRole: 'skill',
  movements: [
    {
      movementName: snapMovA.name,
      unit: 'lb',
      movementId: snapMovA.id,
      clientId: snapCid(2),
      sets: [{ reps: 5, weight: 50 }],
    },
    {
      movementName: snapMovB.name,
      unit: 'lb',
      movementId: snapMovB.id,
      clientId: snapCid(3),
      sets: [{ reps: 4, weight: 50 }],
    },
    {
      movementName: snapMovC.name,
      unit: 'lb',
      movementId: snapMovC.id,
      clientId: snapCid(4),
      sets: [{ reps: 5, weight: 50 }],
    },
    // (d) logged but NOT in this day's program — a hand-typed movement, the commonest shape of all.
    {
      movementName: snapMovD.name,
      unit: 'lb',
      movementId: snapMovD.id,
      clientId: snapCid(5),
      sets: [{ reps: 6, weight: 50 }],
    },
  ],
} as const;
await writeStrengthSession(asPg, snapArgs);

const snapByClientId = new Map(
  (
    await db
      .select({ clientId: schema.entries.clientId, snap: schema.entries.prescribedSnapshot })
      .from(schema.entries)
      .where(inArray(schema.entries.clientId, [snapCid(2), snapCid(3), snapCid(4), snapCid(5)]))
  ).map((r) => [r.clientId, r.snap] as const),
);

// 🔴 THE case the panel called blocking. An `open()` prescription must reach the column as `''`.
assert.equal(
  snapByClientId.get(snapCid(2)),
  '',
  "V1-22 chunk 2: the WRITER stores an open() prescription as '', not NULL",
);
const snapEmptyIsNotNull = (
  (
    await db.execute(
      sql`select count(*)::int as count from entries
           where client_id = ${snapCid(2)} and prescribed_snapshot is null`,
    )
  ).rows as unknown as { count: number }[]
)[0].count;
assert.equal(
  snapEmptyIsNotNull,
  0,
  "V1-22 chunk 2: a writer-stored '' must not satisfy IS NULL — or the row re-reads the live program forever",
);

assert.equal(
  snapByClientId.get(snapCid(3)),
  '3x4, last AMRAP @ 65',
  'V1-22 chunk 2: the per-kid reps override beats target_reps, and a comma survives the column',
);
assert.equal(
  snapByClientId.get(snapCid(4)),
  '',
  "V1-22 chunk 2: a movement programmed TWICE in one day freezes '' — never an arbitrary pick",
);
// A2: freeze-always. Leaving NULL here would send this row back to the live program at every
// export, so chunk 4's first edit would rewrite it — for every hand-typed movement there is.
assert.equal(
  snapByClientId.get(snapCid(5)),
  '',
  "V1-22 chunk 2: a movement this day does not program freezes '', not NULL",
);

// Rule 1: no asserted day role → no snapshot at all, because the legacy fallback emits '' for the
// whole session and snapshotting it would make the two paths disagree on a one-tap shape.
await writeStrengthSession(asPg, {
  ...snapArgs,
  day: '2026-03-03',
  sessionClientId: snapCid(10),
  dayRole: undefined,
  movements: [
    {
      movementName: snapMovA.name,
      unit: 'lb',
      movementId: snapMovA.id,
      clientId: snapCid(11),
      sets: [{ reps: 5, weight: 50 }],
    },
  ],
});
const [snapNoRole] = await db
  .select({ snap: schema.entries.prescribedSnapshot })
  .from(schema.entries)
  .where(eq(schema.entries.clientId, snapCid(11)));
assert.equal(
  snapNoRole.snap,
  null,
  'V1-22 chunk 2: a session with no asserted day role takes no snapshot (NULL, the live fallback)',
);

// Replay: `onConflictDoNothing` on client_id means the FIRST snapshot stands. A future "let a
// corrected day_role through on replay" edit would rewrite frozen history with nothing going red.
// ⚠️ Scoped to THIS block. Keyed on the movement alone it would rewrite every household's target
// for that movement, and a later fixture would inherit the value with no clue why.
await db
  .update(schema.prescriptionTargets)
  .set({ reps: 'rewritten-after-the-fact' })
  .where(
    inArray(
      schema.prescriptionTargets.prescriptionId,
      db
        .select({ id: schema.prescriptions.id })
        .from(schema.prescriptions)
        .innerJoin(schema.programBlocks, eq(schema.programBlocks.id, schema.prescriptions.blockId))
        .where(
          and(
            eq(schema.prescriptions.movementId, snapMovB.id),
            eq(schema.programBlocks.slug, 'verify_snapshot_block'),
          ),
        ),
    ),
  );
// 🔴 **Prove the UPDATE actually bit**, or the replay assertion below holds for the wrong reason:
// a fixture reshaped so the target row moves would make "the original stands" vacuously true. This
// is the probe discipline (`docs/lessons.md`) applied to a fixture — red, green and DID-NOT-RUN are
// three outcomes, not two.
assert.equal(
  (
    await prescribedSnapshotsFor(asPg, {
      profilePublicId: SNAP2_PROFILE_PUBLIC_ID,
      scope: B_SCOPE,
      dayRole: 'skill',
      movementIds: [snapMovB.id],
    })
  ).get(snapMovB.id),
  '3xrewritten-after-the-fact @ 65',
  'V1-22 chunk 2: the fixture UPDATE really changed what the program now says',
);
await writeStrengthSession(asPg, snapArgs);
const [replayed] = await db
  .select({ snap: schema.entries.prescribedSnapshot })
  .from(schema.entries)
  .where(eq(schema.entries.clientId, snapCid(3)));
assert.equal(
  replayed.snap,
  '3x4, last AMRAP @ 65',
  'V1-22 chunk 2: a replay keeps the ORIGINAL snapshot — the program changing underneath must not rewrite it',
);

// 🔴 **The READ side, through the query the export actually ships.** Everything above proves the
// WRITE. Nothing read the column through `strengthMonthRows`, so `coalesce(…, '')` or
// `nullif(…, '')` on that select — one word — would survive every gate: the pure tests run on
// hand-built rows, `db:verify` read the column by direct `select`, and the e2e exports under an
// unchanged program where frozen and live bytes coincide. This is the read-side twin of the write
// mutant that mutation 34 catches.
const snapExportRows = await strengthMonthRows(asPg, {
  profilePublicId: SNAP2_PROFILE_PUBLIC_ID,
  month: '2026-03',
  scope: B_SCOPE,
});
// Keyed on (date, movement): the query returns no `client_id`, and the same movement appears on
// both days — 03-02 with a day role asserted (frozen `''`) and 03-03 without one (NULL).
const snapByDay = new Map(
  snapExportRows
    .filter((r) => r.movementId === snapMovA.id)
    .map((r) => [r.date, r.prescribedSnapshot] as const),
);
assert.equal(
  snapByDay.get('2026-03-02'),
  '',
  "V1-22 chunk 2: the EXPORT query returns '' as '' — a nullif(…, '') here would send every open() row back to today's program",
);
assert.equal(
  snapByDay.get('2026-03-03'),
  null,
  "V1-22 chunk 2: the EXPORT query returns NULL as NULL — a coalesce(…, '') here would make every never-snapshotted row look frozen",
);

console.log('✓ V1-22 chunk 2: the writer freezes the prescription, and a replay keeps the first');

// --- a comma survives the column (the CSV quotes it; `prescribed` is in csv/row.ts's QUOTABLE) ----
await insertSnapshot('movement', SNAP_COMMA);
console.log('✓ V1-22 chunk 1: a comma-bearing prescription stores verbatim');

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// TEN-1 1b — ONE HOUSEHOLD CANNOT SEE ANOTHER. The matrix.
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// Everything above this line proves per-PROFILE ownership. This block proves per-HOUSEHOLD isolation,
// which is a different claim: two profiles in ONE household are both legitimately reachable, and the
// question is whether a request scoped to household A can reach household B at all.
//
// `.github/SECURITY.md` has said *"every query is scoped by `household_id`"* since V0-1 and the code
// has never satisfied it — `listProfiles` returned every profile in the database and every write was
// existence-scoped. This is the proof that closes it, phrased as ADR 0006's forward-compatibility
// requirement 2 asks: **no cross-household access except through an explicitly published
// projection**, a set that is EMPTY today, so every unpublished case is proved exactly as strictly
// as an unconditional zero would be. A later published surface extends the matrix; it does not
// invalidate it.
//
// ⚠️ **EVERY ROW ASSERTS BOTH DIRECTIONS.** `verify.ts` already learned why, 200 lines up at the
// V1-10 BOLA probe: *"asking only one way would pass even with the household scoping deleted, since
// the globally-newest block happens to be the verify one — the assertion would then be proving
// fixture ordering, not ownership."* Generalised: a new zero-rows assertion ships with a matching
// assertion that the SAME call returns rows for the right household. A one-directional leak test is
// indistinguishable from a broken fixture.
//
// ⚠️ **Scoping is not authorization.** Before AUTH-1 the principal is a shared access code, so what
// this proves is CONSISTENT SCOPING: household B's data is unreachable from a request scoped to
// household A. It does not prove the requester is who they claim. That is AUTH-1, and it is the most
// likely thing for a reader of this block to over-claim.

// B_SCOPE is defined where household B is created (the V1-10 fixture, ~900 lines up) — TEN-1 1c's
// scoped `programDayRows` needs it there. A_SCOPE and B_SCOPE are still the only two scopes in this
// file, which `packages/db/src/scope.test.ts` pins.
const [verifyProfileRow] = await db
  .select({ id: schema.profiles.id })
  .from(schema.profiles)
  .where(eq(schema.profiles.publicId, VERIFY_PROFILE_PUBLIC_ID));

// ── (0) `liveHouseholdIds` — the AMBIGUITY PROBE, no longer the resolver's query ──────────────────
// ⚠️ **This block used to say "the one `getHouseholdScope()` runs" and "exactly the state
// `getHouseholdScope()` THROWS on". Both stopped being true at `AUTH-1` 1c-4**, which moved the
// resolver onto `membershipHousehold` — it counts a principal's memberships now, and two live
// households is the intended Beta 0 end state. A gate asserting a control that no longer exists is
// worse than no gate, so what this proves is re-stated as what it is: `liveHouseholdIds` keeps its
// `LIMIT 2` ambiguity probe, and its two surviving callers (this file, and
// `screenshot-ephemeral.ts`'s fixture scope) both refuse rather than pick when it returns 2.
assert.equal(
  (await liveHouseholdIds(asPg)).length,
  2,
  'TEN-1: liveHouseholdIds SEES two live households — its LIMIT 2 is an ambiguity probe, so its callers can refuse instead of picking (NOT the resolver since 1c-4)',
);

// A SOFT-DELETED household stops resolving, so its profiles become unreachable even though
// `profiles.household_id` still points at it. Both directions: exactly one row, and it is A's.
const bProfileCount = (
  await db
    .select({ id: schema.profiles.id })
    .from(schema.profiles)
    .where(eq(schema.profiles.householdId, verifyHh.id))
).length;
assert.ok(bProfileCount >= 2, 'TEN-1 fixture: household B has at least two profiles');
await db
  .update(schema.households)
  .set({ deletedAt: new Date() })
  .where(eq(schema.households.id, verifyHh.id));
const liveAfterDelete = await liveHouseholdIds(asPg);
assert.equal(liveAfterDelete.length, 1, 'TEN-1: a soft-deleted household does not resolve');
assert.equal(
  liveAfterDelete[0].id,
  households[0].id,
  'TEN-1: …and the one that does resolve is the LIVE one, not whichever row came back first',
);
// Its profiles are still there — which is the point: unreachable, not deleted.
assert.equal(
  (
    await db
      .select({ id: schema.profiles.id })
      .from(schema.profiles)
      .where(eq(schema.profiles.householdId, verifyHh.id))
  ).length,
  bProfileCount,
  'TEN-1: the soft-deleted household still OWNS its profiles (unreachable, not deleted)',
);
await db
  .update(schema.households)
  .set({ deletedAt: null })
  .where(eq(schema.households.id, verifyHh.id));
console.log(
  '✓ TEN-1 1b: the scope resolver — two live households are detected as ambiguous; a soft-deleted household stops resolving',
);

// ── (1) THE PICKER (ADR 0006's named obligation) ──────────────────────────────────────────────────
// Under option A (session-only) `/p` is byte-identical for every household on earth, so there is no
// id in the address to disagree with the session: `householdProfileRows` IS the isolation boundary
// for the app's front door. The obligation is two households with two profiles each, and this runs
// the SAME function `listProfiles` runs — an emitted-SQL assertion would only prove that a conjunct
// was appended, never which rows come back.
const pickerA = await householdProfileRows(asPg, { scope: A_SCOPE });
const pickerB = await householdProfileRows(asPg, { scope: B_SCOPE });
const pickerAIds = new Set(pickerA.map((r) => r.publicId));
const pickerBIds = new Set(pickerB.map((r) => r.publicId));

assert.ok(
  pickerAIds.has(SEED_PROFILE_PUBLIC_ID) && pickerAIds.has(SEED_PROFILE_2_PUBLIC_ID),
  "TEN-1: the picker returns BOTH of household A's seeded kids",
);
assert.ok(
  pickerBIds.has(VERIFY_PROFILE_PUBLIC_ID) && pickerBIds.has(VERIFY_PROFILE_2_PUBLIC_ID),
  "TEN-1: …and BOTH of household B's kids, from B's scope",
);
assert.ok(
  !pickerAIds.has(VERIFY_PROFILE_PUBLIC_ID) && !pickerAIds.has(VERIFY_PROFILE_2_PUBLIC_ID),
  "TEN-1: household A's picker does not list household B's kids",
);
assert.ok(
  !pickerBIds.has(SEED_PROFILE_PUBLIC_ID) && !pickerBIds.has(SEED_PROFILE_2_PUBLIC_ID),
  "TEN-1: …and household B's picker does not list household A's kids (reverse)",
);
// The two sets are DISJOINT and neither is the whole table — the shape a `WHERE 1=1` would break
// (both scopes would then see every profile, and the four assertions above would start failing).
const allLiveProfiles = (
  await db
    .select({ id: schema.profiles.publicId })
    .from(schema.profiles)
    .where(isNull(schema.profiles.deletedAt))
).length;
assert.ok(
  pickerA.length < allLiveProfiles && pickerB.length < allLiveProfiles,
  'TEN-1: neither picker returns the whole profiles table (the pre-TEN-1 behaviour)',
);
assert.equal(
  pickerA.filter((r) => pickerBIds.has(r.publicId)).length,
  0,
  'TEN-1: the two households’ pickers are DISJOINT',
);
// A soft-deleted profile is still excluded — the household conjunct is in ADDITION to, not instead
// of, the existing one. Restored straight after.
await db
  .update(schema.profiles)
  .set({ deletedAt: new Date() })
  .where(eq(schema.profiles.publicId, VERIFY_PROFILE_2_PUBLIC_ID));
assert.equal(
  (await householdProfileRows(asPg, { scope: B_SCOPE })).length,
  pickerB.length - 1,
  'TEN-1: the picker still drops a soft-deleted profile (household scope ADDS a conjunct)',
);
await db
  .update(schema.profiles)
  .set({ deletedAt: null })
  .where(eq(schema.profiles.publicId, VERIFY_PROFILE_2_PUBLIC_ID));
console.log(
  '✓ TEN-1 1b: the PICKER — two households × two profiles, disjoint in both directions, soft-delete still honoured (ADR 0006 obligation 1)',
);

// ── (2) HOUSEHOLD B's FIXTURE — so every call in the matrix has something to WRONGLY find ─────────
// Reuses the builders already in this file rather than hand-rolling a fourth insert shape, and takes
// its ids from `newId()` / those builders' own counters: a hand-assigned id that collided with
// `uq_entries_client_id` would make an `onConflictDoNothing` builder silently hand back ANOTHER
// profile's row, and the matrix would then be asserting about the wrong entry while staying green.
const TEN1_WEEK_START = '2026-03-02'; // an ISO-week Monday, in no other fixture's week

// (a) a weigh-in → the bodyweight amend + its re-read
const bTarget = await insertBodyweightProbe({
  profileId: verifyProfileRow.id,
  value: 70.5,
  activityDate: '2026-03-03',
});

// (b) a ramp target + an in-week bout → weeklyAdherenceRows
await db.insert(schema.rampTargets).values({
  publicId: newId(),
  profileId: verifyProfileRow.id,
  metricKey: METRIC_KEYS.pushups,
  weekStart: TEN1_WEEK_START,
  targetValue: '30',
});
await insertCalisthenicsBout({
  metricKey: METRIC_KEYS.pushups,
  value: 25,
  activityDate: TEN1_WEEK_START,
  profileId: verifyProfileRow.id,
});
// …and the SAME week for household A's ramp-test kid, so the adherence row of each direction exists
// and a leak would show up as the OTHER household's numbers rather than as zero rows.
await db.insert(schema.rampTargets).values({
  publicId: newId(),
  profileId: rampTestProfile.id,
  metricKey: METRIC_KEYS.pushups,
  weekStart: TEN1_WEEK_START,
  targetValue: '45',
});
await insertCalisthenicsBout({
  metricKey: METRIC_KEYS.pushups,
  value: 40,
  activityDate: TEN1_WEEK_START,
  profileId: rampTestProfile.id,
});

// (c) a real strength session through the REAL writer → updateStrengthSetById
const bSessionClientId = newId();
const bMovementClientId = newId();
await writeStrengthSession(asPg, {
  profilePublicId: VERIFY_PROFILE_PUBLIC_ID,
  scope: B_SCOPE,
  day: '2026-03-03',
  sessionType: SESSION_TYPES[0],
  sessionClientId: bSessionClientId,
  activityTypeId: scLiftActivityId,
  movements: [
    {
      movementName: 'Verify Lift',
      unit: 'lb',
      movementId: movX.id,
      clientId: bMovementClientId,
      sets: [{ reps: 5, weight: 95 }],
    },
  ],
});
// …and the mirror for household A, through the same writer, so the matrix's positive directions
// both exercise a set this block created rather than reaching for one an earlier proof may have
// soft-deleted or made un-editable on its way past.
const aSessionClientId = newId();
const aMovementClientId = newId();
await writeStrengthSession(asPg, {
  profilePublicId: ssArgs.profilePublicId,
  scope: A_SCOPE,
  day: '2026-03-03',
  sessionType: SESSION_TYPES[0],
  sessionClientId: aSessionClientId,
  activityTypeId: scLiftActivityId,
  movements: [
    {
      movementName: 'Tenancy Lift',
      unit: 'lb',
      movementId: movX.id,
      clientId: aMovementClientId,
      sets: [{ reps: 5, weight: 135 }],
    },
  ],
});

/** The one live, numerically-editable set of the session this block just wrote. */
async function ten1SetOf(movementClientId: string): Promise<{ publicId: string } | undefined> {
  const [row] = await db
    .select({ publicId: schema.entrySets.publicId })
    .from(schema.entrySets)
    .innerJoin(schema.entries, eq(schema.entrySets.entryId, schema.entries.id))
    .where(and(eq(schema.entries.clientId, movementClientId), isNull(schema.entrySets.deletedAt)));
  return row;
}
const bSet = await ten1SetOf(bMovementClientId);
const aSet = await ten1SetOf(aMovementClientId);
assert.ok(bSet, 'TEN-1 fixture: household B has an editable strength set');
assert.ok(aSet, 'TEN-1 fixture: household A has an editable strength set');

// (d) TEN-1 1c: a weigh-in for household A in the SAME month as B's, so `bodyweightMonthRows` has a
// row to wrongly find in both directions. B's is `bTarget` (2026-03-03); A's goes on a day no other
// probe owns — `uq_entries_profile_day_bodyweight` allows one live weigh-in per (profile, day, slot),
// and (4a) below claims 2026-03-04.
const aBwExportTarget = await insertBodyweightProbe({
  profileId: bwOwnerRow.id,
  value: 88.2,
  activityDate: '2026-03-02',
});

// (e) TEN-1 1c: ONE block per household, both programming the SAME day_role, through the REAL
// `seedProgram`. The V1-10 fixture deliberately gives the two households DISJOINT day_roles, which
// proves day-aware block selection but cannot prove household scoping — asked for a day_role the
// other household does not program, a leak and a correct refusal are the same zero rows. A day both
// households program is what makes the four-way matrix below mean something: every direction has a
// row to find, so only the scope can be what refuses.
//
// `'legs'` is used by no other fixture in this file, and the slugs are TEN-1's own, so
// `uq_program_blocks_household_slug` cannot collide with a future data-PR block.
const TEN1_DAY_ROLE = 'legs' as const;
for (const [householdPublicId, profilePublicId, slug, load] of [
  [SEED_HOUSEHOLD_PUBLIC_ID, SEED_PROFILE_PUBLIC_ID, 'ten1_legs_a', 'a-load'],
  [VERIFY_HH_PUBLIC_ID, VERIFY_PROFILE_PUBLIC_ID, 'ten1_legs_b', 'b-load'],
] as const) {
  await seedProgram(asPg, [
    {
      householdPublicId,
      slug,
      name: `TEN-1 ${slug}`,
      notes: null,
      prescriptions: [
        {
          dayRole: TEN1_DAY_ROLE,
          movementSlug: anyMovement.slug,
          idx: 0,
          sets: 3,
          targetReps: '8',
          targets: [{ profilePublicId, load, reps: null }],
        },
      ],
    },
  ]);
}
// The fixture itself, both ways — a seedProgram that silently wrote nothing would make every
// `programDayRows` row below pass for the wrong reason.
assert.equal(
  (
    await programDayRows(asPg, {
      profilePublicId: SEED_PROFILE_PUBLIC_ID,
      dayRole: TEN1_DAY_ROLE,
      scope: A_SCOPE,
    })
  )[0]?.load,
  'a-load',
  "TEN-1 fixture: household A's legs block carries A's own target",
);
assert.equal(
  (
    await programDayRows(asPg, {
      profilePublicId: VERIFY_PROFILE_PUBLIC_ID,
      dayRole: TEN1_DAY_ROLE,
      scope: B_SCOPE,
    })
  )[0]?.load,
  'b-load',
  "TEN-1 fixture: household B's legs block carries B's own target",
);

// ── (3) THE READ MATRIX — every scoped read, both directions ──────────────────────────────────────
// `ownedEntryIds` is `isLiveProfile` itself (it is the subselect both amend writers ride), so that
// row is the predicate's own proof. The rest are the shipped reads behind a screen: the Today page's
// adherence and programmed-day cards, and the three month reads behind the CSV export.
//
// Each row names **its own pair of profiles**. The reads need different fixtures — adherence needs
// ramp targets, the export reads need logged sessions, the program read needs a block — and one
// shared pair would have forced a re-typed lookalike fixture per read, which is the vehicle the
// panel rejected for the picker. The pair varies; the FOUR assertions do not.
type Ten1Read = readonly [
  label: string,
  aProfile: string,
  bProfile: string,
  call: (profilePublicId: string, scope: HouseholdScope) => Promise<readonly unknown[]>,
];

/**
 * The FOUR assertions, in one place, run over whichever list of reads is passed in.
 *
 * ⚠️ **1b's reads and 1c's are two lists on purpose (the 1d follow-up 1c's review recorded).**
 * `db:verify` is fail-fast, so `03-undo-1c-predicates.patch`'s claim — *"the first failure is a 1c
 * one, and 1b carries its own weight"* — was only half-checkable while a 1c assertion sat ahead of
 * 1b's: the 1b rows after it were **unreached, not green**. With every 1b proof ordered first, one
 * patch-03 run passes through all of them and then fails on a 1c row, which is the claim itself.
 */
async function ten1ReadMatrix(reads: readonly Ten1Read[]): Promise<void> {
  for (const [label, aProfile, bProfile, call] of reads) {
    assert.ok(
      (await call(aProfile, A_SCOPE)).length > 0,
      `TEN-1: ${label} returns household A's OWN rows`,
    );
    assert.equal(
      (await call(aProfile, B_SCOPE)).length,
      0,
      `TEN-1: ${label} — household B cannot read A`,
    );
    assert.ok(
      (await call(bProfile, B_SCOPE)).length > 0,
      `TEN-1: ${label} returns household B's OWN rows`,
    );
    assert.equal(
      (await call(bProfile, A_SCOPE)).length,
      0,
      `TEN-1: ${label} — household A cannot read B (reverse)`,
    );
  }
}

const TEN1_READS_1B: readonly Ten1Read[] = [
  [
    'ownedEntryIds (THE live-profile predicate)',
    RAMP_TEST_PROFILE_PUBLIC_ID,
    VERIFY_PROFILE_PUBLIC_ID,
    (profilePublicId, scope) => ownedEntryIds(asPg, profilePublicId, scope),
  ],
  [
    'weeklyAdherenceRows (the Today page’s adherence read)',
    RAMP_TEST_PROFILE_PUBLIC_ID,
    VERIFY_PROFILE_PUBLIC_ID,
    (profilePublicId, scope) =>
      weeklyAdherenceRows(asPg, {
        profilePublicId,
        weekStart: TEN1_WEEK_START,
        activityTypeId: calisthenicsId,
        metricKeys: CALISTHENICS_METRIC_KEYS,
        scope,
      }),
  ],
];

// ── TEN-1 1c's reads, asserted BELOW the 1b write matrix — see `ten1ReadMatrix` for why the order
// is load-bearing rather than cosmetic.
const TEN1_READS_1C: readonly Ten1Read[] = [
  [
    'programDayRows (the Today page’s program card)',
    SEED_PROFILE_PUBLIC_ID,
    VERIFY_PROFILE_PUBLIC_ID,
    (profilePublicId, scope) =>
      programDayRows(asPg, { profilePublicId, dayRole: TEN1_DAY_ROLE, scope }),
  ],
  [
    'strengthMonthRows (the CSV export’s strength log)',
    ssArgs.profilePublicId,
    VERIFY_PROFILE_PUBLIC_ID,
    (profilePublicId, scope) =>
      strengthMonthRows(asPg, { profilePublicId, month: '2026-03', scope }),
  ],
  [
    'bodyweightMonthRows (the CSV export’s weigh-ins)',
    bwOwner,
    VERIFY_PROFILE_PUBLIC_ID,
    (profilePublicId, scope) =>
      bodyweightMonthRows(asPg, { profilePublicId, month: '2026-03', scope }),
  ],
  [
    'loggedMonths (which months the export writes at all)',
    bwOwner,
    VERIFY_PROFILE_PUBLIC_ID,
    (profilePublicId, scope) => loggedMonths(asPg, { profilePublicId, scope }),
  ],
];

await ten1ReadMatrix(TEN1_READS_1B);
console.log(
  `✓ TEN-1 1b: the READ matrix — ${TEN1_READS_1B.length} scoped reads (ownedEntryIds, adherence), ` +
    'each proved in BOTH directions',
);

// The export's weigh-in fixture is load-bearing for the row above, so pin WHICH row the matrix found:
// a future probe that lands another weigh-in in March turns this into a failure rather than a silently
// vacuous pass. `insertBodyweightProbe` returns the public id; the month read returns the value.
const [aMarchWeighIn, ...otherMarchWeighIns] = await bodyweightMonthRows(asPg, {
  profilePublicId: bwOwner,
  month: '2026-03',
  scope: A_SCOPE,
});
assert.equal(otherMarchWeighIns.length, 0, 'TEN-1 fixture: one March weigh-in for household A');
assert.equal(Number(aMarchWeighIn.value), 88.2, 'TEN-1 fixture: …and it is (d)’s probe');
assert.equal(aMarchWeighIn.date, '2026-03-02', 'TEN-1 fixture: …on the day (d) wrote it');
assert.ok(aBwExportTarget.publicId, 'TEN-1 fixture: (d) returned a public id');

// ── (4) THE WRITE MATRIX — the refusal shape, both directions ─────────────────────────────────────
// Writers answer `null`/throw rather than zero rows, so they use this file's refusal-matrix idiom
// (`verify.ts`'s V1-24 1b block) rather than the loop above. Each is asserted FOUR ways, and the two
// positive directions are what stop these passing with the scoping deleted.
//
// ⚠️ The amends are DESTRUCTIVE on their happy path, so each own-household case asserts the write
// landed and then the cross-household case reuses the NEW seen-value. Ordering matters here.

// (a) the bodyweight amend — A's row from A, refused from B, and the reverse
const aBwTarget = await insertBodyweightProbe({
  profileId: bwOwnerRow.id,
  value: 80.1,
  activityDate: '2026-03-04',
});
assert.ok(
  await updateBodyweightEntryById(asPg, {
    profilePublicId: bwOwner,
    entryId: aBwTarget.publicId,
    scope: A_SCOPE,
    value: 80.6,
    unit: 'lb',
    seenValue: 80.1,
  }),
  "TEN-1: the bodyweight amend writes household A's own row",
);
assert.equal(
  await updateBodyweightEntryById(asPg, {
    profilePublicId: bwOwner,
    entryId: aBwTarget.publicId,
    scope: B_SCOPE,
    value: 999,
    unit: 'lb',
    seenValue: 80.6,
  }),
  null,
  'TEN-1: …and household B cannot amend it',
);
assert.ok(
  await updateBodyweightEntryById(asPg, {
    profilePublicId: VERIFY_PROFILE_PUBLIC_ID,
    entryId: bTarget.publicId,
    scope: B_SCOPE,
    value: 71,
    unit: 'lb',
    seenValue: 70.5,
  }),
  "TEN-1: the bodyweight amend writes household B's own row",
);
assert.equal(
  await updateBodyweightEntryById(asPg, {
    profilePublicId: VERIFY_PROFILE_PUBLIC_ID,
    entryId: bTarget.publicId,
    scope: A_SCOPE,
    value: 999,
    unit: 'lb',
    seenValue: 71,
  }),
  null,
  'TEN-1: …and household A cannot amend it (reverse)',
);
// The REFUSED writes changed nothing — a refusal that still wrote would be the worst possible pass.
const [aBwAfter] = await db
  .select({ valueNum: schema.entries.valueNum })
  .from(schema.entries)
  .where(eq(schema.entries.publicId, aBwTarget.publicId));
const [bBwAfter] = await db
  .select({ valueNum: schema.entries.valueNum })
  .from(schema.entries)
  .where(eq(schema.entries.publicId, bTarget.publicId));
assert.equal(Number(aBwAfter.valueNum), 80.6, "TEN-1: B's refused amend left A's weight alone");
assert.equal(Number(bBwAfter.valueNum), 71, "TEN-1: A's refused amend left B's weight alone");

// (b) the amend's re-read — the action's three-way branch must not see across the seam either
assert.ok(
  await findAmendableBodyweight(asPg, {
    profilePublicId: bwOwner,
    entryId: aBwTarget.publicId,
    scope: A_SCOPE,
  }),
  "TEN-1: the amend re-read sees household A's own row",
);
assert.equal(
  await findAmendableBodyweight(asPg, {
    profilePublicId: bwOwner,
    entryId: aBwTarget.publicId,
    scope: B_SCOPE,
  }),
  null,
  'TEN-1: …and household B cannot re-read it',
);
assert.ok(
  await findAmendableBodyweight(asPg, {
    profilePublicId: VERIFY_PROFILE_PUBLIC_ID,
    entryId: bTarget.publicId,
    scope: B_SCOPE,
  }),
  "TEN-1: the amend re-read sees household B's own row",
);
assert.equal(
  await findAmendableBodyweight(asPg, {
    profilePublicId: VERIFY_PROFILE_PUBLIC_ID,
    entryId: bTarget.publicId,
    scope: A_SCOPE,
  }),
  null,
  'TEN-1: …and household A cannot re-read it (reverse)',
);

// (c) the strength set-edit
assert.ok(
  await updateStrengthSetById(asPg, {
    profilePublicId: ssArgs.profilePublicId,
    setId: aSet.publicId,
    reps: 9,
    weight: 45,
    scope: A_SCOPE,
  }),
  "TEN-1: the set-edit writes household A's own set",
);
assert.equal(
  await updateStrengthSetById(asPg, {
    profilePublicId: ssArgs.profilePublicId,
    setId: aSet.publicId,
    reps: 999,
    weight: 999,
    scope: B_SCOPE,
  }),
  null,
  'TEN-1: …and household B cannot edit it',
);
assert.ok(
  await updateStrengthSetById(asPg, {
    profilePublicId: VERIFY_PROFILE_PUBLIC_ID,
    setId: bSet.publicId,
    reps: 6,
    weight: 100,
    scope: B_SCOPE,
  }),
  "TEN-1: the set-edit writes household B's own set",
);
assert.equal(
  await updateStrengthSetById(asPg, {
    profilePublicId: VERIFY_PROFILE_PUBLIC_ID,
    setId: bSet.publicId,
    reps: 999,
    weight: 999,
    scope: A_SCOPE,
  }),
  null,
  'TEN-1: …and household A cannot edit it (reverse)',
);
const [aSetAfter] = await db
  .select({ reps: schema.entrySets.reps })
  .from(schema.entrySets)
  .where(eq(schema.entrySets.publicId, aSet.publicId));
const [bSetAfter] = await db
  .select({ reps: schema.entrySets.reps })
  .from(schema.entrySets)
  .where(eq(schema.entrySets.publicId, bSet.publicId));
assert.equal(aSetAfter.reps, 9, "TEN-1: B's refused set-edit left A's set alone");
assert.equal(bSetAfter.reps, 6, "TEN-1: A's refused set-edit left B's set alone");

console.log(
  '✓ TEN-1 1b: the WRITE matrix — bodyweight amend, amend re-read and set-edit, each refused across the household seam in BOTH directions, with no side effect',
);

// ── (4b) TEN-1 1c's READS and its seed resolver — ordered AFTER every 1b proof above ────────────
// Deliberately down here, not beside 1b's: `03-undo-1c-predicates.patch` claims that under it every
// 1b assertion holds and the first failure is a 1c one. `db:verify` is fail-fast, so that was only
// provable with 1b's proofs ahead of 1c's — otherwise the 1b rows below a 1c failure are unreached
// rather than green, and the gate was being credited with showing something it could not. This is the
// follow-up 1c's own review recorded for 1d.
await ten1ReadMatrix(TEN1_READS_1C);
console.log(
  `✓ TEN-1 1c: the READ matrix — ${TEN1_READS_1C.length} scoped reads (programDayRows, the three ` +
    'export month reads), each proved in BOTH directions, after every 1b proof above',
);

// ⚠️ TEN-1 1c: `seedProgram` itself is household-scoped now — a target naming a profile in ANOTHER
// household throws with nothing written, instead of seeding a cross-household `prescription_targets`
// row that `programDayRows` would then have to refuse. This runs against PROD on every push, so it
// gets the positive direction above AND this negative one (the plan's R-af).
await assert.rejects(
  seedProgram(asPg, [
    {
      householdPublicId: VERIFY_HH_PUBLIC_ID,
      slug: 'ten1_cross_household_target',
      name: 'TEN-1 cross-household target',
      notes: null,
      prescriptions: [
        {
          dayRole: TEN1_DAY_ROLE,
          movementSlug: anyMovement.slug,
          idx: 0,
          sets: 1,
          targetReps: '1',
          // household A's kid, inside household B's block
          targets: [{ profilePublicId: SEED_PROFILE_PUBLIC_ID, load: 'leak', reps: null }],
        },
      ],
    },
  ]),
  /unknown profile .* not in household/,
  'TEN-1 1c: seedProgram refuses a target in another household',
);
assert.equal(
  (
    await db
      .select({ id: schema.programBlocks.id })
      .from(schema.programBlocks)
      .where(eq(schema.programBlocks.slug, 'ten1_cross_household_target'))
  ).length,
  0,
  'TEN-1 1c: …and wrote no block (refs resolve BEFORE the insert)',
);

// ── (5) TEN-1 1c: `writeStrengthSession` — the whole-session write core ───────────────────────────
// Different refusal shape from the amends: the ownership check is a `SELECT … LIMIT 1` inside the
// transaction, so a profile outside the scope resolves to nothing and the core THROWS
// `Profile not found` — byte-identical to the shape an unknown or soft-deleted profile already got.
// It is the one writer here whose refusal has to roll a multi-table graph back, so each refused
// direction also asserts that no `sessions` row survived: a refusal that still wrote half a session
// would be worse than a leak, because the athlete's next replay would attach to it.
const TEN1_SESSION_MOVEMENT = {
  movementName: 'Tenancy Session Lift',
  unit: 'lb' as const,
  movementId: movX.id,
  sets: [{ reps: 5, weight: 115 }],
};
/** Did a session with this client_id reach the database at all? */
async function ten1SessionExists(clientId: string): Promise<boolean> {
  return (
    (
      await db
        .select({ id: schema.sessions.id })
        .from(schema.sessions)
        .where(eq(schema.sessions.clientId, clientId))
    ).length > 0
  );
}
for (const [label, profilePublicId, ownScope, otherScope, day] of [
  ["household A's own session", ssArgs.profilePublicId, A_SCOPE, B_SCOPE, '2026-03-07'],
  ["household B's own session", VERIFY_PROFILE_PUBLIC_ID, B_SCOPE, A_SCOPE, '2026-03-08'],
] as const) {
  const okClientId = newId();
  const written = await writeStrengthSession(asPg, {
    profilePublicId,
    scope: ownScope,
    day,
    sessionType: SESSION_TYPES[0],
    sessionClientId: okClientId,
    activityTypeId: scLiftActivityId,
    movements: [{ ...TEN1_SESSION_MOVEMENT, clientId: newId() }],
  });
  assert.ok(written.sessionId, `TEN-1: writeStrengthSession writes ${label}`);
  assert.ok(await ten1SessionExists(okClientId), `TEN-1: …and the session row is there (${label})`);

  const refusedClientId = newId();
  await assert.rejects(
    writeStrengthSession(asPg, {
      profilePublicId,
      scope: otherScope,
      day,
      sessionType: SESSION_TYPES[0],
      sessionClientId: refusedClientId,
      activityTypeId: scLiftActivityId,
      movements: [{ ...TEN1_SESSION_MOVEMENT, clientId: newId() }],
    }),
    /Profile not found/,
    `TEN-1: …and the other household cannot write it (${label})`,
  );
  assert.equal(
    await ten1SessionExists(refusedClientId),
    false,
    `TEN-1: …with the whole transaction rolled back — no session row (${label})`,
  );
}
console.log(
  '✓ TEN-1 1c: writeStrengthSession — each household writes its OWN session and is refused the other’s, in BOTH directions, with the transaction rolled back',
);

// ── (6) TEN-1 1d: `db:correct`'s registry — the last hand-written predicates in the repo ──────────
// 1d converted the three that remained (`kbSwingsLoadRepsSwap`'s owner half, and `nullRoutineToFull`'s
// read AND write guards). The read is the one BULK shape anywhere in the corrections — a whole
// household's profiles, with no `public_id` half — so it takes `inHousehold(scope)` rather than
// `isLiveProfile`, the same split `seedProgram` made in 1c. That conjunct is the correction's "per-era
// guard": after PROF-1 ships athlete creation, `routine_config IS NULL` becomes the CORRECT state for
// somebody else's brand-new athlete, and an unscoped `--apply` would stamp this household's full
// routine onto them — a write with no delete action behind it.
//
// Proved through the REGISTRY ENTRY, dry-run (`apply = false`, so nothing is written), because that is
// the only vehicle that runs the correction's own SQL rather than a lookalike. The plan's § Test plan
// names "the `db:correct` registry query" in the refusal matrix; this is it.
// PGlite through one more step than `asPg`: `Correction.run` takes the POOLED `Database`, which
// carries a `$client: Pool` that PGlite has no equivalent of and that no correction touches. Same
// device, same reason, as `asPg` itself.
const asCorrectionDb = asPg as unknown as Database;
const nullRoutineCorrection = CORRECTIONS.find((c) => c.name === NULL_ROUTINE_TO_FULL_NAME);
assert.ok(nullRoutineCorrection, 'TEN-1 1d: the null-routine correction is in the registry');

// Both directions need a fixture that could go wrong. An UNSCOPED `routine_config IS NULL` sweep is
// exactly what the correction would be without `inHousehold(scope)`, so it is the baseline: it
// reaches household B's profile (inserted with no routine_config) as well as household A's. Asserted
// rather than assumed — if B ever gained a routine, the negative below would pass for the wrong
// reason, which is the plan's R5 vacuity.
const unscopedNullRoutine = (
  await db
    .select({ publicId: schema.profiles.publicId })
    .from(schema.profiles)
    .where(and(isNull(schema.profiles.routineConfig), isNull(schema.profiles.deletedAt)))
).map((r) => r.publicId);
// Household B's profiles, by household rather than by a hardcoded id — B has more than one, and a
// list that named only the first would have made the set comparison below pass while leaking the rest.
const bProfilePublicIds = new Set(
  (
    await db
      .select({ publicId: schema.profiles.publicId })
      .from(schema.profiles)
      .where(eq(schema.profiles.householdId, verifyHh.id))
  ).map((r) => r.publicId),
);
assert.ok(bProfilePublicIds.size > 1, 'TEN-1 1d fixture: household B has more than one profile');
assert.ok(
  unscopedNullRoutine.some((id) => bProfilePublicIds.has(id)),
  "TEN-1 1d fixture: an UNSCOPED NULL-routine sweep DOES reach household B's profiles — the rows the correction must refuse",
);

// The dry run (`apply = false`: nothing is written) must return exactly the NULL-routine profiles
// that are NOT household B's. Both directions in one assertion — it fails if the correction misses
// one of its own household's rows, and it fails if it reaches the other household's.
const nullRoutineDryRun = await nullRoutineCorrection.run(asCorrectionDb, false);
const foundPublicIds = nullRoutineDryRun
  .map((line) => /profile ([0-9a-f-]{36})/.exec(line)?.[1])
  .filter((id): id is string => id !== undefined)
  .sort();
assert.ok(
  foundPublicIds.length > 0,
  "TEN-1 1d: the correction DOES find household A's own NULL-routine profiles (the positive direction — a correction that found nothing would pass the negative for free)",
);
assert.deepEqual(
  foundPublicIds,
  unscopedNullRoutine.filter((id) => !bProfilePublicIds.has(id)).sort(),
  "TEN-1 1d: …and EXACTLY those: every NULL-routine profile in household A, and none of household B's, though theirs are NULL too. `inHousehold(scope)` is the correction's per-era guard",
);
assert.equal(
  nullRoutineDryRun.length,
  foundPublicIds.length,
  'TEN-1 1d: …and every line the dry run printed is one of them (no unparsed line hiding a row)',
);

console.log(
  '✓ TEN-1 1d: db:correct’s bulk predicate — the null-routine correction finds household A’s NULL routine and never household B’s, dry-run, in both directions',
);

// ── (7) TEN-1 1d: THE CATALOG VERDICT — the two namespaces, and what is still shared ─────────────
//
// ⚠️ **These assertions state what the code DOES, not what it should do.** They are the only input to
// `docs/milestones/beta-1.md`'s question — *"either TEN-1 proves the picker and the metadata stay per
// household, or TEN-2 moves into Beta 0"* — so an aspirational assertion here would answer a
// go/no-go with a wish. The verdict and its evidence are recorded in
// `docs/plans/ten-1-household-scope.md` → "1d as built — the catalog verdict", and the three PRs that
// have moved it since: `ten-2a`, `ten-2b`, `ten-2c`.
//
// The function under test is `findOrCreateMovement`, the REAL core the app DAL's
// `resolveSessionMovements` delegates to (single-sourced in 1d exactly so this proof can run it;
// `apps/web/lib/dal/catalog.ts` is `server-only` and cannot execute here).

// (a) The structural fact everything below follows from.
//
// ⚠️ **TEN-2a RE-TOOK THIS TRIPWIRE.** Until TEN-2a it read `(await columnsOf('movements'))
// .has('household_id') === false` — "there is nothing for this write path to scope BY" — and said
// TEN-2 was the PR that would redden it. TEN-2a is that PR, so the assertion now states what is true
// instead of being deleted: the column EXISTS, and it is NULLABLE (`household_id IS NULL` is a
// value — reference data owned by no household — not missing data, which is why TEN-2c contracted to
// a CHECK rather than to NOT NULL).
//
// 🔴 **TEN-2c INVERTED TWO OF THESE ASSERTIONS. Read this before "fixing" anything below.**
//
// TEN-2b left the verdict reading `LEAKS` by arithmetic: the non-partial `movements_slug_unique` was
// still live, so at most one row per slug existed in the whole table and two households could not
// both hold one — leaving only "B is handed A's row" (the leak, via the resolver's `23505` fallback)
// or "B's write fails forever" (a denial). TEN-2a chose the leak. **Migration 0017 removed the
// arithmetic**: the two partial indexes are the only arbiters now, so B's own row simply inserts.
//
// What that closes, and what it does NOT — the distinction the TEN-2c plan exists to keep honest:
//
//   ✅ **(A) the 2b→2c DENIAL primitive is closed, completely, by the drop alone.** A typing a name
//      first can no longer make B's write of that name fail forever; (b) and (d) below are that proof,
//      inverted rather than deleted.
//   ⚠️ **(B) the pre-existing READ leak is NOT closed here.** Any row already sitting at
//      `household_id IS NULL` that is not a seeded catalog row is still resolved by global-first for
//      **every** household. `TEN-2c-1` (the split backfill) is what closes that; 0017 only stops it
//      growing, via `movements_global_row_has_pattern`. The headline below says so.
//
// Already closed at TEN-2b, and unchanged here:
//   (i)  the row a refused session leaves behind lands in the CALLER'S OWN namespace, so it is
//        garbage rather than a cross-tenant write — (e) below says so;
//   (ii) the PROGRAMMING half: `seedProgram` resolves in the global namespace only, so a prescription
//        can no longer attach to another household's movement row — (d) asserts the refusal instead
//        of the poisoned card.
//
// The column's shape, the FK, the partial indexes in their new sole-arbiter role and the re-taken
// dark gate live in the TEN-2a/2b/2c section at the end of this file.
{
  const householdIdCol = await columnCatalogShape('movements', 'household_id');
  assert.ok(
    householdIdCol,
    'TEN-2a: `movements` HAS a household_id column now (TEN-1 1d’s tripwire, re-taken by the PR that fired it — and as of TEN-2b the column is LIVE: the resolver reads and writes it)',
  );
  assert.equal(
    householdIdCol.is_nullable,
    'YES',
    'TEN-2a: …and it is NULLABLE, forever — NULL means reference data owned by no household, so TEN-2c contracts to a CHECK, never to NOT NULL',
  );
}

/** The one movement row behind an internal id — the three columns the catalog DECLARES. */
async function movementRow(id: number) {
  const [row] = await db
    .select({
      publicId: schema.movements.publicId,
      name: schema.movements.name,
      slug: schema.movements.slug,
      isBodyweight: schema.movements.isBodyweight,
      unitDefault: schema.movements.unitDefault,
      // TEN-2b: the column every assertion below now needs. One reader, not three hand-rolled
      // `select({ householdId })` calls (2a had two).
      householdId: schema.movements.householdId,
    })
    .from(schema.movements)
    .where(eq(schema.movements.id, id));
  return row;
}

// (b) READ: the two namespaces, and the slug's two jobs.
// Neutral fixture names, never a person's (AGENTS.md → "No personal names"). The second string is
// spelled differently on purpose — `movementSlug` collapses case and whitespace, so the SLUG is the
// arbiter and two different strings converge on one row WITHIN a namespace.
const CATALOG_NAME_BY_A = 'TEN-1 Catalog Probe';
const CATALOG_NAME_BY_B = '  ten-1   CATALOG   probe ';
assert.equal(
  movementSlug(CATALOG_NAME_BY_A),
  movementSlug(CATALOG_NAME_BY_B),
  'TEN-1 1d fixture: the two households type different strings that slug the same',
);
const aMovementId = await findOrCreateMovement(asPg, A_SCOPE, CATALOG_NAME_BY_A);

// 🔴 **TEN-2c: SAME-HOUSEHOLD CONVERGENCE — the normalisation property nothing proved before.**
//
// Until 2c the cross-household assertion below doubled as the slug-normalisation proof, which is why
// mutation patch `04-slug-is-not-the-arbiter` pointed at it. 0017 inverted that assertion into "two
// households each get their OWN row", and a `notEqual` cannot see a broken `movementSlug` — two
// different strings would give two different rows either way, and the assertion would pass under the
// very mutation it was named for. So the property gets its own assertion, inside ONE household, where
// it is still true and still load-bearing: **two spellings of one movement are one movement to the
// household that typed them.** Without it a later author "fixing" the catalog by matching on `name`
// would split a kid's history for one lift across two rows with every gate green.
//
// ⚠️ This is patch `04`'s `.expect` line. It must stay the FIRST assertion that a broken
// `movementSlug` reddens — i.e. it stays ahead of everything else that calls the resolver.
assert.equal(
  await findOrCreateMovement(asPg, A_SCOPE, CATALOG_NAME_BY_B),
  aMovementId,
  'TEN-2c SAME-HOUSEHOLD CONVERGENCE: two spellings of one movement are ONE row within a household — the shared movementSlug derivation is the arbiter inside each namespace, so a household cannot end up with two rows (and two histories) for one lift',
);

// 🔴 **TEN-2c INVERTED THIS: household B typing a name household A already created now gets its OWN
// row.** This read `assert.equal(bMovementId, aMovementId)` from TEN-1 1d until 0017, with the
// message "LEAKS: household B is handed household A's movement row" — the single most-quoted
// assertion in the TEN-2 arc, and the one the `23505` fallback produced. It is INVERTED rather than
// deleted, which is what makes it the acceptance criterion rather than a claim.
//
// **Three conjuncts, because two of them would pass vacuously.** Different ids alone would pass if B
// got a row in the wrong namespace; the ownership conjuncts alone would pass if the two rows carried
// different slugs (which is what a broken `movementSlug` does — hence the convergence assertion
// above). The slug conjunct is the one that says these are the SAME movement in TWO namespaces.
const bMovementId = await findOrCreateMovement(asPg, B_SCOPE, CATALOG_NAME_BY_B);
assert.notEqual(
  bMovementId,
  aMovementId,
  'TEN-2c READ — the denial window is CLOSED: household B typing a name household A typed first gets its OWN row, not A’s. ⚠️ This assertion was `equal` and read "LEAKS" from TEN-1 1d through TEN-2b; migration 0017 dropped the non-partial movements_slug_unique that forced the two households to share one row, and the resolver’s 23505 fallback is now unreachable. Do NOT "fix" a failure here by restoring the equality',
);
const aRow = await movementRow(aMovementId);
const bRow = await movementRow(bMovementId);
assert.deepEqual(
  [aRow.householdId, bRow.householdId],
  [households[0].id, verifyHh.id],
  'TEN-2c READ: …each row is owned by the household that asked for it (A’s by A, B’s by B) — the two namespaces are real, not just two ids',
);
assert.equal(
  bRow.slug,
  aRow.slug,
  'TEN-2c READ: …and BOTH rows carry the SAME slug, which is the state that was unreachable before 0017 and is the whole acceptance criterion. Without this conjunct the two assertions above pass under patch 04’s mutation and prove nothing about the namespaces',
);
// The POSITIVE twin (verify.ts's both-directions rule, generalised): a genuinely different name does
// get its own row — so the convergence assertion above is about the SLUG being the arbiter, not about
// find-or-create trivially returning one row for everything.
assert.notEqual(
  await findOrCreateMovement(asPg, A_SCOPE, 'TEN-1 Catalog Probe Two'),
  aMovementId,
  'TEN-1 1d READ: …while a genuinely different name gets its OWN row (the convergence assertion above is not vacuous)',
);
// TEN-2c: each household's row carries ITS OWN typist's text now. Before 0017 there was one row and
// `ON CONFLICT DO NOTHING` discarded the second household's string, so this read `=== CATALOG_NAME_BY_A`
// for `aMovementId` and nothing else was assertable. Both directions, because "each household keeps
// its own text" is the readable half of "each household has its own row".
assert.deepEqual(
  [aRow.name, bRow.name],
  [CATALOG_NAME_BY_A, CATALOG_NAME_BY_B],
  'TEN-2c READ: …and each row carries the text ITS OWN household typed — B’s string is no longer discarded by an `ON CONFLICT DO NOTHING` against A’s row',
);

// (c) And the metadata it inherits can be a declaration this function could never have written.
// `Box Jump` is in the SEEDED catalog as `is_bodyweight: true`; `findOrCreateMovement` can only ever
// write `false`. So a free-text name that happens to slug onto a catalog row inherits the catalog's
// declaration wholesale — which is the benign half of the same mechanism as (d).
const seededBoxJump = MOVEMENT_SEED_ROWS.find((m) => m.slug === 'box_jump');
assert.ok(
  seededBoxJump?.isBodyweight,
  'TEN-1 1d fixture: box_jump is a seeded bodyweight movement',
);
const boxJumpId = await findOrCreateMovement(asPg, A_SCOPE, seededBoxJump.name);
const boxJump = await movementRow(boxJumpId);
assert.equal(
  boxJump.publicId,
  seededBoxJump.publicId,
  'TEN-1 1d READ: free text matching a catalog slug resolves to the SEEDED row, not a new one',
);
// TEN-2b fact 1: now resolved GLOBAL-FIRST and explicitly, rather than by accident of there being
// only one namespace — and it must hold from the OTHER household's scope too, or a household could
// shadow curated metadata with a row this writer is incapable of authoring properly.
assert.equal(
  boxJump.householdId,
  null,
  'TEN-2b: …and the seeded row it resolved to is still GLOBAL (household_id IS NULL) — global-first returned reference data, it did not clone it into a household',
);
assert.equal(
  await findOrCreateMovement(asPg, B_SCOPE, seededBoxJump.name),
  boxJumpId,
  'TEN-2b: …and household B resolves the SAME seeded row — a household cannot shadow a curated movement, which is the direction household-first would have broken',
);
assert.equal(
  boxJump.isBodyweight,
  true,
  'TEN-1 1d READ: …carrying `is_bodyweight: true`, which this function can never write — whatever the row declares, the caller did not declare it',
);

// (d) WRITE / POISON — 1d's worst defect, and the direction TEN-2c closes.
// Household B types a brand-new name FIRST. Until 0017 that pinned the slug permanently for
// EVERYBODY: `is_bodyweight: false`, no `unit_default`, and B's exact free text as the display name,
// handed to household A on its own later call. Now A's call gets A's own row.
const POISON_NAME_BY_B = 'TEN-1 Poisoned Lift';
const POISON_NAME_BY_A = 'ten-1  poisoned   LIFT';
const poisonedId = await findOrCreateMovement(asPg, B_SCOPE, POISON_NAME_BY_B);
// 🔴 TEN-2c INVERTED this too: it read `assert.equal(…, poisonedId)` — "household A, typing its own
// text, is handed the row household B created" — from TEN-1 1d through TEN-2b.
const unpoisonedId = await findOrCreateMovement(asPg, A_SCOPE, POISON_NAME_BY_A);
assert.notEqual(
  unpoisonedId,
  poisonedId,
  'TEN-2c WRITE — CLOSED: household A, typing its own text, gets its OWN row rather than the one household B created first. ⚠️ Inverted from TEN-1 1d’s "is handed the row household B created"; whoever types a name first no longer pins that slug for anybody else',
);
const poisoned = await movementRow(poisonedId);
const unpoisoned = await movementRow(unpoisonedId);
assert.deepEqual(
  [poisoned.name, unpoisoned.name],
  [POISON_NAME_BY_B, POISON_NAME_BY_A],
  'TEN-2c WRITE: …each row carries its own household’s text, and NEITHER household’s free text is now visible to the other',
);
assert.deepEqual(
  [poisoned.householdId, unpoisoned.householdId],
  [verifyHh.id, households[0].id],
  'TEN-2c WRITE: …with each row owned by the household that typed it — so a household deletion reaches its own row and only its own',
);
assert.equal(
  unpoisoned.slug,
  poisoned.slug,
  'TEN-2c WRITE: …and both rows carry the SAME slug: one movement, two namespaces (the second direction of the acceptance criterion)',
);
// What a household-authored row can and cannot declare is unchanged, and still worth asserting: the
// metadata hazard global-first exists to prevent is that this writer can only ever author `false` /
// no unit, so a household row is always a strictly worse version of a curated one.
assert.deepEqual(
  [poisoned.isBodyweight, poisoned.unitDefault],
  [false, null],
  'TEN-1 1d WRITE: …and a household-authored row is still declared loaded-rather-than-bodyweight with no default unit, because this function can only write false — which is WHY the resolver is global-first',
);

// ── 🔴 TEN-2b CLOSED THIS HALF, and the assertion is inverted rather than deleted ───────────────
//
// 1d proved that the poisoned row reached the OTHER household's Today card under that household's
// own, correct scope: `seedProgram` resolved prescriptions by movement SLUG — the same global
// arbiter — so a prescription household A authored rendered household B's free text, with B's
// `is_bodyweight: false` feeding A's log form as "the MOVEMENT's declaration".
//
// TEN-2b made `seedProgram` resolve in the GLOBAL namespace only (`household_id IS NULL`). The
// poisoned row is owned by B, so a block in household A naming its slug now resolves NOTHING and
// `seedProgram` THROWS before writing anything — which is the fix, and the loud direction:
// a prescription can no longer silently attach to another household's movement row, and the
// slug-keyed map's last-row-wins hazard is gone structurally rather than by preference.
//
// ⚠️ This is why the draft of 2b's plan was wrong to claim "no assertion changes": leaving the old
// fixture here would not have gone red with a clear message — `db:verify` is fail-fast, so it would
// have DIED at `seedProgram` and taken every later assertion in this 5,700-line file with it.
assert.equal(
  poisoned.householdId,
  verifyHh.id,
  'TEN-2b fixture: the poisoned row is owned by household B (not global) — which is what makes the refusal below meaningful',
);
await assert.rejects(
  () =>
    seedProgram(asPg, [
      {
        householdPublicId: SEED_HOUSEHOLD_PUBLIC_ID, // household A…
        slug: 'ten1_catalog_verdict',
        name: 'TEN-1 catalog verdict',
        notes: null,
        prescriptions: [
          {
            dayRole: 'pull',
            movementSlug: poisoned.slug, // …naming a movement household B owns
            idx: 0,
            sets: 3,
            targetReps: '5',
            targets: [{ profilePublicId: SEED_PROFILE_PUBLIC_ID, load: 'a-load', reps: null }],
          },
        ],
      },
    ]),
  /unknown movement slug/,
  'TEN-2b WRITE — CLOSED: a prescription in household A can no longer resolve a movement household B owns. `seedProgram` reads the GLOBAL namespace only, so it REFUSES loudly instead of silently attaching to another household’s row (1d’s poisoned Today card)',
);
// …and the refusal wrote nothing: no block, so no card, so nothing to render.
const [poisonedCard] = await programDayRows(asPg, {
  profilePublicId: SEED_PROFILE_PUBLIC_ID,
  dayRole: 'pull',
  scope: A_SCOPE,
});
assert.equal(
  poisonedCard,
  undefined,
  'TEN-2b WRITE: …with NOTHING written — `seedProgram` resolves every ref before the block insert, so a refusal leaves no partial block and household A’s pull card does not render another household’s string at all',
);

// (e) A REFUSED write leaves its caller-supplied catalog text behind. The strength DAL
// (`apps/web/lib/dal/entries.ts` → `logStrengthSession`) resolves every movement through
// find-or-create BEFORE `writeStrengthSession`, whose in-transaction re-resolve is the actual
// household seam — so the seam's refusal rolls back the SESSION and leaves the globally-visible
// movement row behind. Categorically different from a read leak: it is a cross-tenant WRITE primitive
// surviving a refusal.
//
// ⚠️ **This is a FIXTURE reproducing the DAL's call order, not a proof of it.** It calls
// `findOrCreateMovement` itself before the refused write, so the final assertion cannot fail — it
// shows what that order does to the database, given the order. That the DAL really calls
// find-or-create first, even for a write that is then refused, is asserted where the DAL can run:
// `apps/web/lib/dal/entries.test.ts` → "find-or-create runs, and commits, before the refused write".
const REFUSED_MOVEMENT_NAME = 'TEN-1 Refused Session Lift';
// Resolved under B_SCOPE — the scope the refused write will ask from — so the surviving row's
// ownership is the thing under test below.
const refusedMovementId = await findOrCreateMovement(asPg, B_SCOPE, REFUSED_MOVEMENT_NAME);
const refusedCatalogClientId = newId();
await assert.rejects(
  writeStrengthSession(asPg, {
    profilePublicId: ssArgs.profilePublicId, // household A's athlete…
    scope: B_SCOPE, // …asked for from household B's scope
    day: '2026-03-09',
    sessionType: SESSION_TYPES[0],
    sessionClientId: refusedCatalogClientId,
    activityTypeId: scLiftActivityId,
    movements: [
      {
        movementName: REFUSED_MOVEMENT_NAME,
        unit: 'lb',
        movementId: refusedMovementId,
        sets: [{ reps: 5, weight: 100 }],
        clientId: newId(),
      },
    ],
  }),
  /Profile not found/,
  'TEN-1 1d: the household seam refuses the cross-household session write (as 1c proves)',
);
assert.equal(
  await ten1SessionExists(refusedCatalogClientId),
  false,
  'TEN-1 1d: …with the whole session transaction rolled back',
);
// 🔴 TEN-2b CHANGED WHAT THIS MEANS, so the wording changed with it. The row still survives the
// refusal — the ordering fix is `TEN-2b-1`, deferred — but it is no longer in the SHARED catalog
// where every other household's resolver would serve it. It lands in the CALLER'S OWN namespace, so
// it is unreferenced garbage inside one household, reachable by `runbooks.md` step 11's
// `DELETE FROM movements WHERE household_id = H`. Garbage, not a cross-tenant write.
const refusedRow = await movementRow(refusedMovementId);
assert.ok(
  refusedRow,
  'TEN-1 1d WRITE: …and YET the movement row the refused caller named still exists — find-or-create runs before the session transaction, so the catalog write survives its own refusal (TEN-2b-1 moves it inside)',
);
assert.equal(
  refusedRow.householdId,
  verifyHh.id,
  'TEN-2b WRITE — DEFUSED: …but it is in the REFUSED CALLER’S OWN namespace, not the shared catalog. 1d’s cross-tenant write primitive is now unreferenced garbage in one household, which the deletion procedure removes — the leak half is gone even though the ordering wart is not',
);

// TEN-2b: the ids the REAL resolver returned in this run — one curated global resolve (box_jump),
// one owned insert, and the rows the leak and the refusal produced. The re-taken dark gate in the
// TEN-2a/2b section below asserts over exactly these, because they are the only rows a resolver
// touched; V1-1b's raw-SQL backfill fixture also writes `movements`, and nothing scopes those.
const TEN2B_RESOLVER_IDS: number[] = [
  aMovementId,
  bMovementId,
  boxJumpId,
  poisonedId,
  // TEN-2c: the two rows 0017 made reachable — household A's own row for a slug B typed first, and
  // (via `bMovementId` above) B's own row for a slug A typed first. They are the inverted
  // assertions' subjects, so they belong in the end-state membership proof too.
  unpoisonedId,
  refusedMovementId,
];

// ⚠️ **NOT A BARE "isolated", and that is deliberate.** This headline is the only input to beta-1's
// go/no-go on the invite, so it names what closed AND what did not. `docs/plan.md` is explicit that
// *"dropping the UNIQUE alone closes nothing — it only PERMITS two namespaces"*, and an earlier draft
// of TEN-2c's plan asserted the read leak's closure while deferring the step that delivers it.
console.log(
  '✓ TEN-1 1d THE CATALOG VERDICT, as of TEN-2d — the DENIAL window is CLOSED, the READ leak has a ' +
    'NAMED RESIDUAL that is now MEASURED. ✅ CLOSED AT TEN-2c, by migration 0017 dropping the ' +
    'non-partial movements_slug_unique: two households each hold their OWN row for one slug (asserted ' +
    'three ways — different ids, each row owned by the household that asked, both rows carrying the ' +
    'same slug, in BOTH directions), so A typing a name first can no longer deny B that write. ' +
    '✅ CLOSED AT TEN-2d: the resolver’s 23505 fallback is DELETED — 0017 had already made it ' +
    'unreachable, and it outlived the drop by one PR only because nothing couples migrate.yml to the ' +
    'Vercel deploy. The global catalog is still SHARED on purpose: both households resolve the same ' +
    'curated box_jump. ✅ ALREADY CLOSED at TEN-2b: the refused-session row lands in the caller’s OWN ' +
    'namespace (garbage, not cross-tenant), and seedProgram REFUSES a prescription naming another ' +
    'household’s movement. ⚠️ **NOT CLOSED: any PRE-TEN-2b app-authored row still sitting at ' +
    'household_id IS NULL is resolved by global-first for EVERY household — the read leak’s residual, ' +
    'which closes at TEN-2c-1 (the split backfill). 0017 stopped it GROWING via ' +
    'movements_global_row_has_pattern, and TEN-2d (0018) VALIDATEd that CHECK — the arc’s ONLY scan ' +
    'of real production rows. The production census (movements-ownership-2026-10-11, 2026-10-13) ' +
    'returned ZERO in every residual and blocker count, so TEN-2c-1 is a NO-OP against current data ' +
    '— and a dated zero is not an invariant, so it is re-measured immediately before the invite.** ' +
    'Verdict: docs/plans/ten-1-household-scope.md → "1d as built"; ' +
    'docs/plans/ten-2b-scoped-movement-lookup.md; docs/plans/ten-2c-drop-global-slug-unique.md',
);

// ── PICK-1 PR 2: a movement id resolves ONLY in its own namespace ──────────────────────────────────
//
// The functions under test are the REAL ones the DAL calls — `resolveSessionMovements` (ids before
// inserts) and `writeStrengthSession`'s in-transaction re-check. `apps/web/lib/dal/entries.ts` is
// `server-only` and cannot execute here, which is why resolution lives in `packages/db` at all
// (write-path invariant 3): a re-typed lookalike could not PROVE the cross-household refusal.
//
// ⚠️ **NOT ONE NEW `movements` ROW IS CREATED BELOW**, deliberately — and ASSERTED, twice, rather
// than left as a property of how the fixtures happen to be written: case (a) counts the table across
// its refusal, and a second count spans (c)–(e). The reason it matters is that the TEN-2a/2c section
// further down reads the whole table; a fixture that found-or-created a GLOBAL row would redden its
// seed-membership assertion, and one that created a household-owned row would slip past every
// discriminator there, which is exactly why the count is taken here instead.
{
  /** A card the picker would submit: an id, plus a label the server must IGNORE in favour of the row. */
  const picked = (movementPublicId: string, clientId: string) => ({
    movementPublicId,
    movementName: 'A LABEL THE ID MUST OVERRIDE',
    unit: 'lb' as const,
    clientId,
    // `SessionMovementInput` carries `status` as a zod `.default()`, so the PARSED type has it
    // required even though the wire field is optional — these fixtures stand in for parsed bodies.
    status: ENTRY_STATUS.done,
    sets: [{ reps: 5, weight: 100 }],
  });
  const typed = (movementName: string, clientId: string) => ({
    movementName,
    unit: 'lb' as const,
    clientId,
    status: ENTRY_STATUS.done,
    sets: [{ reps: 5, weight: 100 }],
  });
  const pickCid = (n: number) => `019826b4-0000-7000-8000-0000000021${String(n).padStart(2, '0')}`;

  const bOwnRow = await movementRow(bMovementId);
  // `snapMovB` was selected as `{ id, slug, name }` for chunk 2, which needs no public id. The
  // picker submits one, so read it from the same row rather than re-selecting the movement.
  const snapMovBRow = await movementRow(snapMovB.id);
  assert.equal(
    bOwnRow.householdId,
    verifyHh.id,
    'PICK-1 fixture: the row case (a) tries to steal is household B’s OWN (TEN-2c made that possible)',
  );

  // One counter, three tables, via Drizzle's `$count` rather than a third copy of this file's
  // inline `count(*)::int` cast — the second copy inside one block is the extract trigger
  // (AGENTS.md → "Reuse small logic too").
  const rowCounts = async () => ({
    movements: await db.$count(schema.movements),
    sessions: await db.$count(schema.sessions),
    entries: await db.$count(schema.entries),
  });

  // (a) 🔴 **A's request names B's own movement id, alongside a typed sibling that WOULD insert.**
  //
  // ⚠️ The typed name is chosen to slug onto NO existing row in either namespace, so phase 2 would
  // genuinely INSERT if it ran. That is what makes "zero new movements rows" an assertion rather
  // than a tautology — and it is the assertion `36-availability-ignores-household.patch` reddens:
  // widening `movementIsAvailableTo` to any owned row makes phase 1 succeed, phase 2 run, and this
  // count move. ⚠️ That patch is aimed at the shared PREDICATE, not at the resolver alone, so the
  // same one line also widens the in-transaction re-check case (d) checks; `db:verify` is fail-fast,
  // so (a) is what reports.
  const TYPED_SIBLING = 'PICK-1 Sibling That Must Not Land';
  assert.equal(
    (
      await db
        .select({ id: schema.movements.id })
        .from(schema.movements)
        .where(eq(schema.movements.slug, movementSlug(TYPED_SIBLING)))
    ).length,
    0,
    'PICK-1 fixture: the typed sibling slugs onto no existing row, in any namespace — so phase 2 really would insert it',
  );
  const before = await rowCounts();
  // ⚠️ Caught by hand rather than with `assert.rejects`, because (b) below COMPARES this message and
  // `assert.rejects` resolves to `undefined`. An earlier draft assigned its return value and then
  // compared (b)'s message against a `?? MOVEMENT_NOT_AVAILABLE` fallback — the constant compared
  // with itself, which is the assertion-about-evidence failure this file exists to avoid.
  const foreignIdError = await resolveSessionMovements(asPg, A_SCOPE, [
    picked(bOwnRow.publicId, pickCid(1)),
    typed(TYPED_SIBLING, pickCid(2)),
  ]).then(
    () => null,
    (e: unknown) => e as Error,
  );
  assert.ok(
    foreignIdError instanceof MovementNotAvailableError,
    'PICK-1 (a): household A naming household B’s own movement id is REFUSED — the resolver matches global-or-own under the CALLER’S scope, never any owned row',
  );
  assert.equal(
    foreignIdError.message,
    MOVEMENT_NOT_AVAILABLE,
    'PICK-1 (a): …with the named constant as its message, not a hand-typed string',
  );
  assert.deepEqual(
    await rowCounts(),
    before,
    'PICK-1 (a): …and the refusal wrote NOTHING — no movements row for the typed sibling, no session, no entry. Ids resolve before any insert, so a refused body commits no typed sibling (`37-typed-before-ids.patch` swaps the phases and this is the assertion that goes red)',
  );

  // (b) An id that names no row at all. The message must be IDENTICAL to (a)'s, or the refusal is an
  // oracle a caller can use to enumerate which movement public ids exist (security N2 — the same
  // 404-never-403 rule ADR 0006 applies to profiles).
  const UNKNOWN_ID = '019826b4-0000-7000-8000-0000000021ff';
  assert.equal(
    (
      await db
        .select({ id: schema.movements.id })
        .from(schema.movements)
        .where(eq(schema.movements.publicId, UNKNOWN_ID))
    ).length,
    0,
    'PICK-1 fixture: the unknown id really names no row',
  );
  await assert.rejects(
    async () => resolveSessionMovements(asPg, A_SCOPE, [picked(UNKNOWN_ID, pickCid(3))]),
    (err: unknown) => err instanceof MovementNotAvailableError,
    'PICK-1 (b): an unknown movement id is refused too',
  );
  const unknownIdError = await resolveSessionMovements(asPg, A_SCOPE, [
    picked(UNKNOWN_ID, pickCid(4)),
  ]).then(
    () => null,
    (e: unknown) => e as Error,
  );
  assert.equal(
    unknownIdError?.message,
    foreignIdError.message,
    'PICK-1 (b): …and BYTE-IDENTICAL to (a)’s — an unknown id and another household’s id are indistinguishable from outside, so the refusal is not an enumeration oracle',
  );
  assert.ok(
    !unknownIdError?.message.includes(UNKNOWN_ID),
    'PICK-1 (b): …and the message interpolates neither the id nor a name — a thrown value reaches Sentry verbatim, and a movement name is free text the notice warns may hold a person’s name',
  );

  // The movements count from here to the end of (e). Cases (c)–(e) write SESSIONS, and the claim that
  // "a resolver that minted something per call would show up" needed something to show up IN: (e)'s
  // session-id and entry-count assertions cannot see a stray household-owned `movements` row, and
  // neither can the TEN-2a/2c discriminators below (they admit an owned row with a NULL pattern).
  const beforeHappyPath = await rowCounts();

  // (c) 🔴 **The happy path, end to end through the real writer: the id decides, and the id path
  // still FREEZES the V1-22 chunk-2 snapshot.**
  //
  // Two cards, both by public id, under household B's snapshot fixture (the same `verify_snapshot_block`
  // / `skill` day chunk 2 proves against):
  //   · `snapMovB` — a GLOBAL row the day DOES prescribe, with a comma and a per-kid reps override;
  //   · `bOwnRow`  — household B's OWN row, which that day does NOT prescribe.
  // So one proves the id path freezes a real rendered string and the other that it freezes `''` —
  // which is what PICK-1's round-2 B1 asked for, restated against the mechanism chunk 2 shipped
  // (the plan's § Amendment, 2026-11-11: there is no `prescriptionId` on the wire to carry).
  const pickedResolved = await resolveSessionMovements(asPg, B_SCOPE, [
    picked(snapMovBRow.publicId, pickCid(5)),
    picked(bOwnRow.publicId, pickCid(6)),
  ]);
  assert.deepEqual(
    pickedResolved.map((m) => m.movementId),
    [snapMovB.id, bMovementId],
    'PICK-1 (c): a global row and this household’s OWN row both resolve by public id, to exactly those rows',
  );
  assert.deepEqual(
    pickedResolved.map((m) => m.movementName),
    [snapMovB.name, bOwnRow.name],
    'PICK-1 (c): …and each carries the DATABASE’S name, not the client’s label — "the id decides" is this assertion. A `{ ...m, movementId }` spread would have let the submitted label through',
  );
  const pickedWrite = await writeStrengthSession(asPg, {
    profilePublicId: SNAP2_PROFILE_PUBLIC_ID,
    scope: B_SCOPE,
    day: '2026-03-09',
    sessionType: SESSION_TYPES[0],
    sessionClientId: pickCid(7),
    activityTypeId: scLiftActivityId,
    dayRole: 'skill',
    movements: pickedResolved,
  });
  const pickedRows = new Map(
    (
      await db
        .select({
          clientId: schema.entries.clientId,
          movementId: schema.entries.movementId,
          movementName: schema.entries.movementName,
          snap: schema.entries.prescribedSnapshot,
        })
        .from(schema.entries)
        .where(inArray(schema.entries.clientId, [pickCid(5), pickCid(6)]))
    ).map((r) => [r.clientId, r] as const),
  );
  assert.deepEqual(
    [pickedRows.get(pickCid(5))?.movementId, pickedRows.get(pickCid(6))?.movementId],
    [snapMovB.id, bMovementId],
    'PICK-1 (c): the written entries reference the rows the IDS named (criterion 17)',
  );
  assert.deepEqual(
    [pickedRows.get(pickCid(5))?.movementName, pickedRows.get(pickCid(6))?.movementName],
    [snapMovB.name, bOwnRow.name],
    'PICK-1 (c): …and `entries.movement_name` is the DATABASE’S label — the column the day page renders, which a `{ ...m, movementId }` spread would have let the client set while the id decided the row. (The CSV’s `movement` column reads `movements.slug` through `movement_id` and never this column, so it was never the stake here.)',
  );
  // ⚠️ The expected string is the REWRITTEN one. Chunk 2's replay proof updated this prescription's
  // target reps to `rewritten-after-the-fact` earlier in this file, deliberately and scoped to this
  // block — so by the time PICK-1's session is written the live program says that, and freezing it is
  // the point-in-time behaviour acceptance 9 asks for. Expecting chunk 2's original `3x4, last AMRAP`
  // here would be expecting the snapshot to be stale, which is the opposite of what the column is for.
  assert.equal(
    pickedRows.get(pickCid(5))?.snap,
    '3xrewritten-after-the-fact @ 65',
    'PICK-1 (c): 🔴 the ID PATH still freezes the V1-22 chunk-2 snapshot — the global card’s day prescribes it, so what the program says AT THIS MOMENT is written. Chunk 2 matches on `movement_id`, which the resolver supplied; nothing on the wire names a prescription',
  );
  assert.equal(
    pickedRows.get(pickCid(6))?.snap,
    '',
    'PICK-1 (c): …and a picked movement the day does NOT prescribe freezes the EMPTY STRING, not NULL — chunk 2 rule 2, unchanged by the id path',
  );

  // (d) 🔴 **THE TOCTOU SEAM.** `writeStrengthSession` is called DIRECTLY with household B's internal
  // movement id under household A's scope — bypassing phase 1 entirely, which is what a soft-delete
  // or a `MOV-1`/`C4m` repoint between the pre-check and the write looks like from the writer's side.
  // The in-transaction re-check must refuse and the whole graph must roll back.
  // `38-drop-in-tx-recheck.patch` removes that check and this case goes red.
  const beforeD = await rowCounts();
  await assert.rejects(
    async () =>
      writeStrengthSession(asPg, {
        profilePublicId: SEED_PROFILE_PUBLIC_ID,
        scope: A_SCOPE,
        day: '2026-03-09',
        sessionType: SESSION_TYPES[0],
        sessionClientId: pickCid(8),
        activityTypeId: scLiftActivityId,
        movements: [
          {
            movementName: bOwnRow.name,
            unit: 'lb',
            movementId: bMovementId,
            clientId: pickCid(9),
            sets: [{ reps: 5, weight: 100 }],
          },
        ],
      }),
    (err: unknown) => err instanceof MovementNotAvailableError,
    'PICK-1 (d): the IN-TRANSACTION re-check refuses another household’s internal movement id even when phase 1 is bypassed — the pre-check is an optimisation, this is the seam',
  );
  assert.deepEqual(
    await rowCounts(),
    beforeD,
    'PICK-1 (d): …and nothing committed — it throws inside the transaction, so the session and its entries roll back together',
  );

  // (e) **Replay.** The same session `clientId` twice, both times by id: one session, one entry per
  // movement, the SAME `sessionId` back. Idempotency is unchanged by the id path — which is worth a
  // case because the resolver is a new step BEFORE the idempotent write.
  const pickedReplay = await writeStrengthSession(asPg, {
    profilePublicId: SNAP2_PROFILE_PUBLIC_ID,
    scope: B_SCOPE,
    day: '2026-03-09',
    sessionType: SESSION_TYPES[0],
    sessionClientId: pickCid(7),
    activityTypeId: scLiftActivityId,
    dayRole: 'skill',
    movements: await resolveSessionMovements(asPg, B_SCOPE, [
      picked(snapMovBRow.publicId, pickCid(5)),
      picked(bOwnRow.publicId, pickCid(6)),
    ]),
  });
  assert.equal(
    pickedReplay.sessionId,
    pickedWrite.sessionId,
    'PICK-1 (e): a replayed id-path session returns the SAME session public id',
  );
  assert.equal(
    (
      await db
        .select({ id: schema.entries.id })
        .from(schema.entries)
        .where(inArray(schema.entries.clientId, [pickCid(5), pickCid(6)]))
    ).length,
    2,
    'PICK-1 (e): …and exactly one entry per movement survives the replay',
  );
  // 🔴 **And the id path minted NO catalog row across (c), (d) and (e) together** — three writes, one
  // of them replayed, none of them find-or-create. Without this the "not one new movements row" claim
  // at the top of this block held only for case (a), which is the one that throws before phase 2.
  assert.equal(
    (await rowCounts()).movements,
    beforeHappyPath.movements,
    'PICK-1 (c)–(e): the id path created no `movements` row at all — three writes including a replay, and find-or-create was never reached',
  );

  console.log(
    '✓ PICK-1 PR 2: a movement id resolves ONLY in its own namespace — another household’s own id ' +
      'and an unknown id are byte-identical refusals that write nothing (not even the typed sibling ' +
      'in the same body), a global row and this household’s own row both resolve and the DATABASE’S ' +
      'name reaches the entry, the V1-22 chunk-2 snapshot still freezes on the id path, the ' +
      'in-transaction re-check refuses a bypassed foreign id and rolls back, and replay is unchanged',
  );
}

// ── TEN-2a/2c: the column, the FK, and the two indexes in their SOLE-ARBITER role ────────────────
//
// `movements.household_id` + the two partial unique indexes shipped DARK at TEN-2a (migration 0015),
// with the global `movements_slug_unique` left untouched so every deployed `ON CONFLICT (slug)` kept
// its arbiter. **Migration 0017 dropped that constraint**, which is what turns the two indexes from
// declared into binding — a narrower rule cannot widen what a broader one already forbids.
// Plans: docs/plans/ten-2a-household-movements.md, docs/plans/ten-2c-drop-global-slug-unique.md.
//
// ⚠️ **NO COMMITTED STATEMENT IN THIS SECTION MAY LEAVE A ROW BEHIND.** The dark gate at (4) and the
// discriminator at (5) read the WHOLE table, so every fixture below either is REJECTED, lives inside
// the rolled-back transaction at (3), or is DELETED by the statement after it — and the one committed
// probe TEN-2c added says so at both ends. The tempting repair when (4) goes red is to weaken it to
// `<= 1`, at which point it stops proving anything.
{
  const FK = 'movements_household_id_households_id_fk';
  const GLOBAL_UQ = schema.MOVEMENT_SLUG_GLOBAL_UNIQUE_INDEX;
  const HOUSEHOLD_UQ = schema.MOVEMENT_HOUSEHOLD_SLUG_UNIQUE_INDEX;

  // Resolved BEFORE the transaction at (3): PGlite has ONE connection, so a query on the
  // module-level `db` inside `tx` waits forever (the V1-24 1d lesson, 2,000 lines up).
  const [ten2aHousehold] = await db
    .select({ id: schema.households.id })
    .from(schema.households)
    .where(eq(schema.households.publicId, SEED_HOUSEHOLD_PUBLIC_ID));
  assert.ok(ten2aHousehold, 'TEN-2a fixture: the seed household resolves');

  // Probe rows. Their public_ids sit OUTSIDE `SEED_PUBLIC_ID_PREFIX` deliberately (the seed namespace
  // is `…-000000000xxx`, nine zeros; these are `…-00000002a0xx`), so even if one ever leaked past a
  // rollback it would be classified as app-authored rather than as curated reference data.
  const movementRowValues = (suffix: string, slug: string, householdId: number | null) => ({
    publicId: `019826b4-0000-7000-8000-00000002a0${suffix}`,
    slug,
    name: `TEN-2a ${slug} ${suffix}`,
    householdId,
  });

  // ── (1) SHAPE, and the FK — both halves, because the FK is this PR's load-bearing safety claim ──
  const shape = await columnCatalogShape('movements', 'household_id');
  assert.ok(shape, 'TEN-2a: movements.household_id exists');
  assert.equal(shape.data_type, 'bigint', 'TEN-2a: movements.household_id is bigint');
  assert.equal(
    shape.is_nullable,
    'YES',
    'TEN-2a: movements.household_id is NULLABLE — forever. NULL is a VALUE (reference data owned by no household), which is why TEN-2c contracted to movements_global_row_has_pattern and never to NOT NULL',
  );
  assert.equal(
    shape.column_default,
    null,
    'TEN-2a: …with no column default — a default would make "unowned" a shape the writer backs into rather than states',
  );

  // The FK REJECTS a non-existent household. `NOT VALID` skips only the validation SCAN: both
  // referential triggers are created and live, so TEN-2b's writes are protected before the
  // constraint is ever validated.
  await expectRejectedBy(FK, () =>
    db.insert(schema.movements).values(movementRowValues('01', 'ten2a_fk_probe', 9_999_999)),
  );
  // …and it is ACTUALLY `NOT VALID`. `drizzle-kit generate` emits the FK VALIDATED — the
  // `NOT VALID` is a hand-edit of 0015, and the drift guard diffs `schema.ts` against the snapshot,
  // not the SQL, so **nothing else in any gate catches this hand-edit being lost on a rebase**.
  // Losing it means prod runs a validating scan instead.
  //
  // ✅ **TEN-2b FLIPPED THIS ASSERTION, which is exactly what 2a built it for.** 0015 shipped the FK
  // `NOT VALID` and asserted `convalidated = false`; migration `0016` runs the `VALIDATE CONSTRAINT`
  // and this now asserts `true`. So "TEN-2b must not forget the VALIDATE" was never a prose reminder
  // — it was a red build until 0016 existed. ⚠️ Do not "fix" a failure here by relaxing the expected
  // value: a `false` now means 0016 did not apply, or its hand-written body was lost.
  const fkValidated = (
    (await db.execute(
      sql`select convalidated from pg_constraint where conname = ${FK}`,
    )) as unknown as { rows: { convalidated: boolean }[] }
  ).rows;
  assert.equal(fkValidated.length, 1, `TEN-2a: ${FK} exists`);
  assert.equal(
    fkValidated[0].convalidated,
    true,
    'TEN-2b: …and it is now VALIDATED — migration 0016 ran VALIDATE CONSTRAINT, flipping 2a’s `convalidated = false` assertion. ⚠️ A `false` here means 0016 did not apply or lost its body; do NOT relax this expectation',
  );

  // ── (2) 🔴 TEN-2c INVERTED THIS — the two-namespace proof, COMMITTED ────────────────────────────
  //
  // This was the one assertion in this block whose truth value FLIPS, and it is the acceptance
  // criterion stated at the schema level rather than through the resolver. From TEN-2a until 0017 it
  // read `expectRejectedBy(SLUG_CONSTRAINT, insert box_jump owned by this household)` — "the OLD
  // constraint is still non-partial and still binding, so a household-owned row cannot share a slug
  // with a GLOBAL row". `box_jump` is a seeded (`household_id IS NULL`) row, so the insert now
  // SUCCEEDS and the two rows coexist.
  //
  // ⚠️ **It is OUTSIDE any transaction, so the row must be DELETED, and that is load-bearing in two
  // directions.** (4)'s dark gate and (5)'s discriminator read the WHOLE table a few lines down, and
  // the snapshot is taken AFTER this. A committed app-authored row owned by a household is tolerable
  // there; a committed app-authored row carrying a non-NULL `pattern` would redden discriminator 2/3,
  // which is also why `movementRowValues` must NOT grow a `pattern` and only the GLOBAL probes below
  // pass one. Deleting it is simpler than reasoning about either.
  await db.insert(schema.movements).values(movementRowValues('02', 'box_jump', ten2aHousehold.id));
  const boxJumpNamespaces = await db
    .select({ householdId: schema.movements.householdId })
    .from(schema.movements)
    .where(eq(schema.movements.slug, 'box_jump'));
  assert.deepEqual(
    boxJumpNamespaces.map((r) => r.householdId).sort(),
    [null, ten2aHousehold.id].sort(),
    'TEN-2c: a household now holds its OWN row for a SEEDED slug, alongside the curated global one — the state movements_slug_unique forbade, asserted on committed rows rather than inside a rolled-back transaction. ⚠️ Inverted from TEN-2a’s expectRejectedBy(movements_slug_unique, …); do NOT "fix" a failure here by restoring the rejection',
  );
  // …and gone again, before (4) and (5) read the table. See the ⚠️ above.
  await db
    .delete(schema.movements)
    .where(eq(schema.movements.publicId, movementRowValues('02', 'box_jump', null).publicId));
  assert.deepEqual(
    await db
      .select({ householdId: schema.movements.householdId })
      .from(schema.movements)
      .where(eq(schema.movements.slug, 'box_jump')),
    [{ householdId: null }],
    'TEN-2c: …and the probe row is deleted again, leaving only the curated global row — (4) and (5) below read the WHOLE table',
  );

  // ── (3) THE THREE UNIQUENESS FACTS — in ONE transaction that is ALWAYS rolled back ──────────────
  //
  // ⚠️ **TEN-2c CHANGED WHY THIS TRANSACTION EXISTS, and the old reason is now FALSE — do not quote
  // it.** It used to say these facts *"CANNOT be asserted outside one"*, because `movements_slug_unique`
  // was non-partial on `(slug)` and therefore dominated both indexes: index insertion walks the index
  // list in OID order, so `expectRejectedBy`, which asserts the EXACT `cause.constraint`, would
  // deterministically get the 0001-era constraint rather than a 0015 index. 0017 dropped it, so each
  // probe below now names the index that actually rejected it, and (2) above proves the positive
  // direction on COMMITTED rows.
  //
  // The transaction stays for **row hygiene**: six probe rows across three slugs, in a file whose
  // next two sections read the whole table. The `DROP CONSTRAINT` it used to open with is GONE.
  //
  // Three mechanics still load-bearing:
  //  - the household id was resolved ABOVE, outside the transaction (one connection).
  //  - `expectRejectedBy` is passed `tx`, so each expected rejection runs in its own SAVEPOINT. A
  //    failed statement aborts the enclosing transaction, so without that the second probe fails
  //    `25P02` and reports `got '(none)'`.
  //  - the rollback is UNCONDITIONAL: the callback ends by throwing a sentinel the caller swallows.
  //    0012's transaction rolls back because its DO block RAISES; a callback that merely finishes
  //    **COMMITS**, which here would leave six probe rows behind for (4) and (5) to trip over.
  //
  // ⚠️ **The GLOBAL probes carry a `pattern`; the household ones must NOT.** `movements_global_row_has_pattern`
  // (0017) rejects a global row without one — `23514`, before any index is consulted. The `pattern` is
  // passed per-probe rather than added to `movementRowValues`, because a household-owned probe row
  // with a non-NULL `pattern` would redden discriminator 2/3 at (5).
  const ROLLBACK_SENTINEL = 'TEN-2a: rollback (expected)';
  /** A GLOBAL probe row: same shape, plus the `pattern` the TEN-2c CHECK requires of global rows. */
  const globalMovementRowValues = (suffix: string, slug: string) => ({
    ...movementRowValues(suffix, slug, null),
    pattern: MOVEMENT_PATTERNS[0],
  });
  try {
    await db.transaction(async (tx) => {
      // (a) two rows, same slug, both household_id NULL → the GLOBAL namespace is one row per slug.
      await tx.insert(schema.movements).values(globalMovementRowValues('03', 'ten2a_ns_probe'));
      await expectRejectedBy(
        GLOBAL_UQ,
        () => tx.insert(schema.movements).values(globalMovementRowValues('04', 'ten2a_ns_probe')),
        tx,
      );

      // (b) two rows, same slug, the SAME non-NULL household → one row per slug per household.
      await tx
        .insert(schema.movements)
        .values(movementRowValues('05', 'ten2a_hh_probe', ten2aHousehold.id));
      await expectRejectedBy(
        HOUSEHOLD_UQ,
        () =>
          tx
            .insert(schema.movements)
            .values(movementRowValues('06', 'ten2a_hh_probe', ten2aHousehold.id)),
        tx,
      );

      // (c) one GLOBAL row + one HOUSEHOLD row, SAME slug → BOTH insert. The namespaces are
      // separate, which is the entire point of the shape — and the ONLY assertion here that
      // distinguishes the new indexes from the constraint they replaced. Without it, (1)–(3) would
      // pass against a migration that created no indexes at all. (Since TEN-2c it has a committed
      // twin at (2) above, on a SEEDED slug.)
      await tx.insert(schema.movements).values(globalMovementRowValues('07', 'ten2a_both_probe'));
      await tx
        .insert(schema.movements)
        .values(movementRowValues('08', 'ten2a_both_probe', ten2aHousehold.id));
      const bothNamespaces = await tx
        .select({ householdId: schema.movements.householdId })
        .from(schema.movements)
        .where(eq(schema.movements.slug, 'ten2a_both_probe'));
      assert.equal(
        bothNamespaces.length,
        2,
        'TEN-2a: a global row and a household row SHARE a slug — the two namespaces are separate (this is what the partial indexes buy, and since TEN-2c dropped movements_slug_unique it is the state (2) above proves on committed rows too)',
      );
      assert.deepEqual(
        bothNamespaces.map((r) => r.householdId).sort(),
        [null, ten2aHousehold.id].sort(),
        'TEN-2a: …one owned by no household, one owned by this household',
      );

      throw new Error(ROLLBACK_SENTINEL);
    });
    assert.fail(
      'TEN-2a: the uniqueness transaction MUST roll back — a callback that merely finishes COMMITS',
    );
  } catch (e) {
    if ((e as Error).message !== ROLLBACK_SENTINEL) throw e;
  }

  // The rollback took the probe rows with it. (TEN-2c deleted the "and the constraint is back" probe
  // that used to sit here: there is no constraint to restore, and the whole-table reads at (4)/(5)
  // are what this check protects.)
  const leakedProbes = await db
    .select({ slug: schema.movements.slug })
    .from(schema.movements)
    .where(
      inArray(schema.movements.slug, ['ten2a_ns_probe', 'ten2a_hh_probe', 'ten2a_both_probe']),
    );
  assert.deepEqual(leakedProbes, [], 'TEN-2a: …and the rollback took every probe row with it');

  // ── (4) THE DARK CLAIM — the whole reason this PR is safe to land ahead of TEN-2b ───────────────
  //
  // Anti-vacuity FIRST, and it is PROPERTY-BASED on purpose: `count(*) > MOVEMENT_SEED_ROWS.length`
  // would be satisfied by extra rows from ANY source (this section's own probes included), while the
  // risk being guarded is "no row was created by a writer that COULD have set the column". So: at
  // least one row outside `MOVEMENT_SEED_PUBLIC_IDS` — i.e. authored by the only writer there is,
  // the REAL `findOrCreateMovement` the TEN-1 1d fixtures above drive.
  const allMovements = await db
    .select({
      publicId: schema.movements.publicId,
      householdId: schema.movements.householdId,
      pattern: schema.movements.pattern,
    })
    .from(schema.movements);
  const appAuthored = allMovements.filter((m) => !MOVEMENT_SEED_PUBLIC_IDS.has(m.publicId));
  assert.ok(
    appAuthored.length > 0,
    'TEN-2a anti-vacuity: at least one movements row was authored by the app’s find-or-create (outside MOVEMENT_SEED_PUBLIC_IDS) — otherwise the dark assertion below holds for want of a writer, not because the writer leaves the column alone',
  );
  // 🔴 **TEN-2b RE-TOOK THIS GATE — it is not deleted, it is INVERTED.**
  //
  // 2a asserted `household_id IS NOT NULL → 0` ("nothing writes it") and called that the load-bearing
  // half of the dark claim. TEN-2b is the PR that writes it, so this is 2b's to re-take, exactly as
  // 2a re-took 1d's structural tripwire.
  //
  // ⚠️ **The obvious inversion — "every non-seed row is now OWNED" — is FALSE, and asserting it would
  // have been a self-inflicted red build.** V1-1b's backfill fixture ~4,500 lines up inserts
  // `movements` rows with RAW SQL and `gen_random_uuid()`: non-seed `public_id`, `pattern IS NULL`,
  // `household_id IS NULL`, and no resolver ever touches them. They are app-authored by the
  // discriminator and unowned by construction.
  //
  // So the honest invariant is scoped to **rows this run's resolver actually returned**: every one of
  // them is either a curated global row (global-first resolved reference data) or owned by the
  // household that asked. Nothing the resolver touches is left in the shared namespace.
  const resolverTouched = await db
    .select({
      id: schema.movements.id,
      publicId: schema.movements.publicId,
      householdId: schema.movements.householdId,
    })
    .from(schema.movements)
    .where(inArray(schema.movements.id, TEN2B_RESOLVER_IDS));
  assert.equal(
    resolverTouched.length,
    new Set(TEN2B_RESOLVER_IDS).size,
    'TEN-2b anti-vacuity: every id the resolver returned in this run still resolves to a row (an empty set would pass the assertion below for free)',
  );
  assert.deepEqual(
    resolverTouched.filter(
      (m) => m.householdId === null && !MOVEMENT_SEED_PUBLIC_IDS.has(m.publicId),
    ),
    [],
    'TEN-2b THE COLUMN IS LIVE: every row the REAL findOrCreateMovement returned in this run is either a CURATED global row (resolved, not cloned) or OWNED by the household that asked — none is an app-authored row left in the shared namespace. ⚠️ This replaces TEN-2a’s all-NULL gate; a row appearing here means the resolver wrote outside the asking household’s namespace, which is the leak TEN-2 exists to close. Do NOT relax it',
  );

  // ── (5) THE AUTHORSHIP DISCRIMINATOR — four directions since TEN-2c ────────────────────────────
  // TEN-2b's backfill and its correction DELETE rows on this test, so it is proved here before
  // anything depends on it. The discriminator is exact set membership in `MOVEMENT_SEED_PUBLIC_IDS`,
  // NOT a `SEED_PUBLIC_ID_PREFIX` test: that prefix is the GLOBAL seed namespace shared by every
  // seeded table, so a `movements` row carrying `seedPublicId('010')` (the household's id) would pass
  // a prefix test and be mistaken for curated reference data.
  const seeded = allMovements.filter((m) => MOVEMENT_SEED_PUBLIC_IDS.has(m.publicId));
  assert.equal(
    seeded.length,
    MOVEMENT_SEED_ROWS.length,
    'TEN-2a: every seeded movement is present exactly once',
  );
  assert.deepEqual(
    seeded.filter((m) => m.pattern === null),
    [],
    'TEN-2a discriminator (1/4): a row IN the set has a non-NULL `pattern` — `movementSeedRowSchema` makes it non-nullable',
  );
  assert.deepEqual(
    appAuthored.filter((m) => m.pattern !== null),
    [],
    'TEN-2a discriminator (2/4): a row OUTSIDE the set has `pattern IS NULL` — `findOrCreateMovement` writes neither pattern nor unit_default, so this is the cross-check the backfill can lean on',
  );
  assert.deepEqual(
    appAuthored.filter((m) => m.publicId.startsWith(SEED_PUBLIC_ID_PREFIX)),
    [],
    'TEN-2a discriminator (3/4): NO row carries a seed-NAMESPACE public_id that is not in MOVEMENT_SEED_PUBLIC_IDS — the direction a prefix test would have missed entirely',
  );

  // 🔴 **(4/4) TEN-2c: END-STATE MEMBERSHIP — layer 2 of `movements_global_row_has_pattern`.**
  //
  // The CHECK 0017 added is a real control but a weaker one than its name suggests: a global row with
  // a hand-typed `pattern` satisfies it while being neither owned nor seeded. The exact invariant —
  // *the global namespace contains exactly the curated catalog* — is set membership, and only a proof
  // can state it. This is that proof, and it is why the CHECK must not be read as making this
  // assertion redundant. (`db:verify` never runs against production, which is why the CHECK exists at
  // all; the CHECK cannot express membership, which is why this does.)
  //
  // ⚠️ **SCOPED TO RESOLVER-TOUCHED ROWS, and the table-wide version is FALSE here** — see the
  // warning at (4) above: V1-1b's raw-SQL backfill fixture mints non-seed rows at
  // `household_id IS NULL`, so asserting it table-wide would be a self-inflicted red build. The
  // table-wide invariant lands with **`TEN-2c-1`** (the split backfill), which is the PR that removes
  // the rows that make it false. Said plainly rather than implied, because this is the gap between
  // "the denial window is closed" and "the read leak is closed".
  const resolverGlobal = resolverTouched.filter((m) => m.householdId === null);
  assert.ok(
    resolverGlobal.length > 0,
    'TEN-2c anti-vacuity: the resolver returned at least one GLOBAL row this run (global-first resolved curated reference data) — otherwise the membership assertion below holds for want of a row',
  );
  assert.deepEqual(
    resolverGlobal
      .map((m) => m.publicId)
      .filter((id) => !MOVEMENT_SEED_PUBLIC_IDS.has(id))
      .sort(),
    [],
    'TEN-2c END-STATE MEMBERSHIP (4/4): every GLOBAL row the resolver returned is a member of MOVEMENT_SEED_PUBLIC_IDS — exact set membership, not a slug test and not a public_id-prefix test (both were tried in this arc and both were wrong). This is layer 2 of movements_global_row_has_pattern, which can only require a `pattern`',
  );
  assert.deepEqual(
    allMovements
      .filter((m) => MOVEMENT_SEED_PUBLIC_IDS.has(m.publicId) && m.pattern === null)
      .map((m) => m.publicId),
    [],
    'TEN-2c: …and every curated row carries the `pattern` the CHECK requires of a global row, so the two layers agree rather than one of them being decoration',
  );
  // And the obligation behind all three: a `movements.public_id` only ever comes from `newId()` or
  // the seed const. Asserted nowhere before this. ⚠️ Version-agnostic on purpose: V1-1b's backfill
  // fixture ~4,500 lines up inserts via raw SQL with `gen_random_uuid()` (a UUIDv4), so a
  // UUIDv7-shaped assertion would fail on this file's own fixture rather than on a real defect.
  for (const m of appAuthored) {
    assert.ok(
      uuidSchema.safeParse(m.publicId).success,
      `TEN-2a: every non-seed movements.public_id is a generated UUID, never hand-typed (${m.publicId})`,
    );
  }

  console.log(
    `✓ TEN-2a/2b/2c: movements.household_id — nullable bigint; the FK rejects a missing household and is ` +
      `now VALIDATED (0016 flipped 2a's convalidated = false, which is how "don't forget the VALIDATE" ` +
      `was a red build); ${GLOBAL_UQ} + ${HOUSEHOLD_UQ} are now the SOLE arbiters — each rejects its own ` +
      `duplicate, and a household holds its own row for a SEEDED slug alongside the curated one, on ` +
      `COMMITTED rows (the state movements_slug_unique forbade until 0017); and of ${allMovements.length} rows ` +
      `(${appAuthored.length} app-authored), every row the REAL resolver returned is either curated-global or ` +
      `owned by the household that asked, with every global one an exact member of MOVEMENT_SEED_PUBLIC_IDS ` +
      `— 2a's all-NULL dark gate, re-taken and inverted twice`,
  );
}

// ── TEN-2b/2c: the resolver is scoped, and the facts 2c's schema finally makes observable ────────
//
// Plans: docs/plans/ten-2b-scoped-movement-lookup.md, docs/plans/ten-2c-drop-global-slug-unique.md.
// The TEN-1 1d section above already drives the REAL `findOrCreateMovement` in both directions and
// carries the verdict; this section proves the three things 1d's fixtures cannot observe.
//
// ✅ **TEN-2c SIMPLIFIED THIS SECTION, which is the clearest single sign the PR did its job.** Both
// proofs below used to live inside a transaction that DROPPED `movements_slug_unique` and was always
// rolled back, with the honest label *"this is the resolver under TEN-2c's schema, with the
// interference removed"*. 0017 removed the interference for real, so the scaffolding is gone and the
// assertions run against the live schema.
{
  const [ten2bHousehold] = await db
    .select({ id: schema.households.id })
    .from(schema.households)
    .where(eq(schema.households.publicId, SEED_HOUSEHOLD_PUBLIC_ID));
  assert.ok(ten2bHousehold, 'TEN-2b fixture: the seed household resolves');

  const movementsSeqValue = async (): Promise<string> =>
    (
      (await db.execute(sql`select last_value::text as v from movements_id_seq`)) as unknown as {
        rows: { v: string }[];
      }
    ).rows[0].v;

  // ── (1) A GLOBAL RESOLVE DOES NOT ATTEMPT AN INSERT ─────────────────────────────────────────────
  //
  // ⚠️ A row COUNT cannot prove this, and the draft of the plan thought it could: an absorbed
  // `ON CONFLICT DO NOTHING` leaves the count unchanged too. The identity sequence can — Postgres
  // BURNS a sequence value on an absorbed insert and a plain SELECT consumes none. So the sequence
  // standing still is the only observable that says "step 1 returned; step 3 never ran".
  const seqBefore = await movementsSeqValue();
  const seededForSeq = MOVEMENT_SEED_ROWS[0];
  const seqResolved = await findOrCreateMovement(asPg, A_SCOPE, seededForSeq.name);
  assert.equal(
    (await movementRow(seqResolved)).publicId,
    seededForSeq.publicId,
    'TEN-2b: a seeded name resolves to its curated row',
  );
  assert.equal(
    await movementsSeqValue(),
    seqBefore,
    'TEN-2b: …and the movements identity sequence did NOT advance — so global-first RETURNED at step 1 rather than attempting an insert that ON CONFLICT then absorbed (a row count cannot tell those apart)',
  );

  // ── (2) GLOBAL-FIRST — on the LIVE schema since TEN-2c ─────────────────────────────────────────
  //
  // 🔴 **This is TEN-2b's central design decision, and until 0017 it had no observable consequence at
  // all.** Measured during 2b's panel: with `movements_slug_unique` present, a global row and a
  // household row could not share a slug, so global-first and household-first returned the SAME id by
  // the same path and burned the same sequence values — an assertion out here would have passed under
  // the very mutation it names. The distinguishing state was exactly what the constraint forbade, so
  // 2b proved the order inside a transaction that dropped the constraint and always rolled back, with
  // the honest label *"the resolver under TEN-2c's schema, with the interference removed"*.
  //
  // ✅ **TEN-2c removed the interference, so the scaffolding is gone.** The two orders are now
  // distinguishable in the live schema, which is the win. The probe rows are COMMITTED and then
  // deleted (the whole-table reads are in the section above, which has already run) — the
  // `DROP CONSTRAINT`, the sentinel throw and the restore probe are all deleted with the constraint.
  const GF_SLUG = 'ten-2b_order_probe';
  const GF_NAME = 'TEN-2b Order Probe';
  const GF_GLOBAL_PUBLIC_ID = '019826b4-0000-7000-8000-00000002b001';
  const GF_HOUSEHOLD_PUBLIC_ID = '019826b4-0000-7000-8000-00000002b002';
  assert.equal(movementSlug(GF_NAME), GF_SLUG, 'TEN-2b fixture: the probe name slugs as expected');
  // The state `movements_slug_unique` forbade: one curated row and one household row, same slug.
  const [gfGlobalRow] = await db
    .insert(schema.movements)
    .values({
      publicId: GF_GLOBAL_PUBLIC_ID,
      slug: GF_SLUG,
      name: 'Curated Order Probe',
      pattern: 'squat',
      householdId: null,
    })
    .returning({ id: schema.movements.id });
  const [gfHouseholdRow] = await db
    .insert(schema.movements)
    .values({
      publicId: GF_HOUSEHOLD_PUBLIC_ID,
      slug: GF_SLUG,
      name: 'Household Order Probe',
      householdId: ten2bHousehold.id,
    })
    .returning({ id: schema.movements.id });
  assert.notEqual(gfGlobalRow.id, gfHouseholdRow.id, 'TEN-2b fixture: two distinct rows exist');

  // THE assertion. Household-first would return `gfHouseholdRow.id` here, and that row declares
  // `is_bodyweight: false` with no `unit_default` — strictly worse metadata than the curated row it
  // would be shadowing, which `queries/program-day.ts` reads as the movement's declaration.
  assert.equal(
    await findOrCreateMovement(asPg, A_SCOPE, GF_NAME),
    gfGlobalRow.id,
    'TEN-2b GLOBAL-FIRST: with BOTH a curated row and this household’s own row for one slug, the resolver returns the CURATED one. ⚠️ Household-first returns the household row here and that is the whole hazard: the only writer cannot author `pattern` / `unit_default`, so a household row always shadows curated metadata with something strictly worse. ✅ Since TEN-2c this runs against the LIVE schema — 2b could only prove it inside a rolled-back DROP CONSTRAINT transaction',
  );
  // Clean up the two committed probe rows — the proof is done, and nothing downstream should resolve
  // this slug. (2b got this for free from its rollback; 2c pays for the simpler shape here.)
  await db
    .delete(schema.movements)
    .where(inArray(schema.movements.publicId, [GF_GLOBAL_PUBLIC_ID, GF_HOUSEHOLD_PUBLIC_ID]));
  assert.deepEqual(
    await db
      .select({ slug: schema.movements.slug })
      .from(schema.movements)
      .where(eq(schema.movements.slug, GF_SLUG)),
    [],
    'TEN-2b: …and both order-probe rows are deleted again',
  );

  // ── (3) 🔴 THE FALLBACK'S PRICE, INVERTED — the one direct proof that 2c PAID it off ────────────
  //
  // `schema.ts`, `runbooks.md`, `SECURITY.md` and `notice.md` all used to say a cross-household
  // `entries.movement_id` was "prevented by construction". TEN-2b's `23505` fallback PRODUCED one by
  // design — the 1d section above had household B handed household A's row, so the entry B wrote
  // against it was exactly this reference — and `runbooks.md`'s PRIV-1 step 11
  // (`DELETE FROM movements WHERE household_id = H`, hand-typed after a 7-day cooling-off, in the
  // procedure `notice.md` calls "permanently removed") then ABORTED mid-transaction. TEN-2b asserted
  // the abort so the hazard could not be forgotten before TEN-2c.
  //
  // ✅ **TEN-2c INVERTED BOTH HALVES, and together they are the price being paid off.** B now holds
  // its own row, so the same probe entry is an ordinary same-household reference: pre-flight (d)
  // reads **zero**, and step 11 **succeeds**. Both were `> 0` / `expectRejectedBy(…FK)` until 0017.
  //
  // ⚠️ **This proves the mechanism is gone, NOT that production is clean.** Any reference the fallback
  // already minted is real data and outlives the code path; the report-only correction
  // `movements-ownership-2026-10-11` is what measures that, and `runbooks.md` pre-flight (d) stays in
  // the procedure for exactly that reason.
  const [ten2bBProfile] = await db
    .select({ id: schema.profiles.id })
    .from(schema.profiles)
    .where(eq(schema.profiles.publicId, VERIFY_PROFILE_PUBLIC_ID));
  assert.ok(ten2bBProfile, 'TEN-2b fixture: household B’s profile resolves');
  // 🔴 INVERTED: this read `=== ten2bHousehold.id` ("the row household B was handed is owned by
  // household A — the fallback's doing"). The fallback no longer runs, so B's row is B's.
  assert.equal(
    (await movementRow(bMovementId)).householdId,
    verifyHh.id,
    'TEN-2c fixture: the row household B got for a slug household A typed first is owned by B — inverted from TEN-2b’s "owned by household A (the fallback’s doing)"',
  );

  const PRICE_SENTINEL = 'TEN-2c: price rollback (expected)';
  try {
    await db.transaction(async (tx) => {
      // Household B logs against the movement it now owns — the SAME statement TEN-2b used to
      // manufacture a cross-household reference with.
      await tx.insert(schema.entries).values({
        publicId: '019826b4-0000-7000-8000-00000002b010',
        clientId: '019826b4-0000-7000-8000-00000002b011',
        profileId: ten2bBProfile.id,
        activityTypeId: scLiftActivityId,
        movementId: bMovementId,
        activityDate: '2026-03-09',
        unit: 'lb',
        kind: 'strength',
        movementName: 'TEN-2b price probe',
      });
      // `runbooks.md` pre-flight (d), through the SHARED census rather than a re-typed join:
      // `queries/movement-ownership.ts` is the one definition of "referenced", covering `entries`
      // AND `prescriptions`, which `TEN-2b-2` and `TEN-2c-1` must both use.
      const crossRefs = await crossHouseholdMovementRefs(tx as unknown as typeof asPg);
      assert.deepEqual(
        crossRefs,
        { entries: 0, prescriptions: 0, total: 0 },
        'TEN-2c PRICE PAID: runbooks.md pre-flight (d) reads ZERO — no entries row and no prescriptions row crosses a household boundary, even with the probe entry TEN-2b used to manufacture one. ⚠️ Inverted from TEN-2b’s `crossRefs > 0`; this says the WRITER is gone, not that a live database is clean (that is the reporter’s job)',
      );
      // …and step 11 therefore SUCCEEDS. ⚠️ **Faithful to the procedure's ORDER, and that is not
      // padding.** A household's OWN `entries.movement_id` / `prescriptions.movement_id` are
      // perfectly ordinary FKs that would abort step 11 too, which is why `runbooks.md` deletes the
      // household's own rows (steps 3–10, children before parents) before step 11 touches its
      // movements. What TEN-2b proved was that an OUTSIDE household's reference aborted step 11 **even
      // after all of that** — the one abort the procedure had no remedy for. So the statements below
      // are the procedure's own ordering, compressed.
      const hhProfiles = sql`(select id from profiles where household_id = ${ten2bHousehold.id})`;
      const hhBlocks = sql`(select id from program_blocks where household_id = ${ten2bHousehold.id})`;
      await tx.execute(sql`
        delete from entry_set_quantities where entry_set_id in (
          select id from entry_sets where entry_id in (
            select id from entries where profile_id in ${hhProfiles}))`);
      await tx.execute(sql`
        delete from entry_sets where entry_id in (
          select id from entries where profile_id in ${hhProfiles})`);
      await tx.execute(sql`delete from entries where profile_id in ${hhProfiles}`);
      await tx.execute(sql`
        delete from prescription_targets where prescription_id in (
          select id from prescriptions where block_id in ${hhBlocks})`);
      await tx.execute(sql`delete from prescriptions where block_id in ${hhBlocks}`);
      await tx.execute(sql`delete from movements where household_id = ${ten2bHousehold.id}`);
      assert.deepEqual(
        await tx
          .select({ id: schema.movements.id })
          .from(schema.movements)
          .where(eq(schema.movements.householdId, ten2bHousehold.id)),
        [],
        'TEN-2c PRICE PAID: …and `DELETE FROM movements WHERE household_id = H` (runbooks.md step 11) COMPLETES rather than aborting 23503 on another household’s reference. ⚠️ Inverted from TEN-2b’s expectRejectedBy(entries_movement_id_movements_id_fk, …); do NOT "fix" a failure here by restoring the expected rejection — it means a cross-household reference exists again',
      );
      throw new Error(PRICE_SENTINEL);
    });
    assert.fail('TEN-2c: the price transaction MUST roll back — it deletes real fixture rows');
  } catch (e) {
    if ((e as Error).message !== PRICE_SENTINEL) throw e;
  }
  // The rollback put everything back — otherwise every later assertion would run against a household
  // with no entries, no prescriptions and no movements, and pass for the wrong reason.
  assert.ok(
    (
      await db
        .select({ id: schema.movements.id })
        .from(schema.movements)
        .where(eq(schema.movements.householdId, ten2bHousehold.id))
    ).length > 0,
    'TEN-2c: …and the price transaction rolled back — household A still holds its movements',
  );

  console.log(
    '✓ TEN-2b/2c: the resolver is SCOPED — a global resolve attempts no insert (sequence unmoved); ' +
      'GLOBAL-FIRST now proved on the LIVE schema (the curated row wins over the household’s own; 2b ' +
      'could only prove it inside a rolled-back DROP CONSTRAINT transaction, because the non-partial ' +
      'constraint made the two orders indistinguishable); and the 23505 fallback’s PRICE is PAID OFF — ' +
      'runbooks.md pre-flight (d) reads ZERO across entries AND prescriptions, and step 11’s ' +
      'DELETE FROM movements completes instead of aborting 23503 (both assertions inverted)',
  );
}

// ── TEN-2c: the SEED'S SHADOW REPORT — all three directions, through the REAL `seed()` ──────────
//
// 🔴 **What this block used to prove, and why 0017 falsified it.** With the non-partial
// `movements_slug_unique` present, the seed's arbiter —
// `ON CONFLICT (slug) WHERE household_id IS NULL DO NOTHING` — let Postgres infer BOTH arbiters (the
// non-partial one's empty predicate is trivially implied by `WHERE household_id IS NULL`), so a
// global-UNIQUE collision was ABSORBED: `db:seed` reported success while the curated catalog row was
// never inserted, seed-twice idempotency stayed green, and every household then resolved that slug
// through the cross-household fallback. The failure was SILENCE, so the guard was the only detector
// and it REFUSED (`throw`) rather than adopting the household's free text.
//
// ✅ **TEN-2c demoted the guard to a REPORT, and BOTH halves had to move.** The guard was
// detect → **omit** → seed → throw, and `seed.ts` filtered the shadowed slugs out of the `VALUES`
// list *before* the arbiter was ever consulted. Demoting only the `throw` would have left the curated
// row still never inserted, forever, with nothing complaining loudly — a loud confidentiality guard
// turned into a silent, permanent gap in reference data, which is strictly WORSE than the behaviour it
// replaced. So (a) proves the absorb is gone, (b) proves the curated row now LANDS and that the
// warning still says the right things, and (c) is the unchanged positive direction.
//
// ⚠️ **No DDL left in this block.** It used to drop and re-`ADD` `movements_slug_unique` three times
// and had to be LAST in the file for that reason; it no longer mutates the schema at all. It still
// cannot run inside a transaction: `seed()` queries the module-level `db`, and PGlite has ONE
// connection, so calling it inside `db.transaction` would wait forever.
{
  const [guardHousehold] = await db
    .select({ id: schema.households.id })
    .from(schema.households)
    .where(eq(schema.households.publicId, SEED_HOUSEHOLD_PUBLIC_ID));
  assert.ok(guardHousehold, 'TEN-2b guard fixture: the seed household resolves');

  // ⚠️ **The shadowed seed row is CHOSEN AT RUNTIME, and it has to be.** (b) below DELETES the
  // curated row to prove the seed puts it back, and `entries.movement_id` / `prescriptions.movement_id`
  // would abort that delete `23503` — `MOVEMENT_SEED_ROWS[0]` (`box_jump`) is referenced by this
  // file's own fixtures, measured. So pick the first seed row nothing references, through the SHARED
  // census (`queries/movement-ownership.ts`) rather than a hand-written join: `householdRefs === 0`
  // is that module's definition of unreferenced, and it covers both referencing tables.
  const unreferencedGlobalIds = new Set(
    (await sharedMovementRows(asPg)).filter((r) => r.householdRefs === 0).map((r) => r.movementId),
  );
  const globalRowIds = await db
    .select({ id: schema.movements.id, publicId: schema.movements.publicId })
    .from(schema.movements)
    .where(movementIsGlobal());
  const shadowed = MOVEMENT_SEED_ROWS.find((m) => {
    const row = globalRowIds.find((g) => g.publicId === m.publicId);
    return row !== undefined && unreferencedGlobalIds.has(row.id);
  });
  assert.ok(
    shadowed,
    'TEN-2c guard fixture: at least one curated movement is referenced by nothing, so (b) can delete it and watch the seed restore it',
  );

  /**
   * Run `fn` with `console.warn` captured. The guard is a WARNING now, not a `throw`, so
   * `assert.rejects` cannot reach it — and the two things that must be true of its text (it names the
   * seed slug; it does NOT name the household's free text) are the privacy proof this PR was most at
   * risk of dropping on the floor. Restores the real `console.warn` in a `finally`, because
   * `findOrCreateMovement` also warns and a swallowed warning elsewhere would be its own defect.
   */
  const captureWarnings = async (fn: () => Promise<void>): Promise<string> => {
    const real = console.warn;
    const lines: string[] = [];
    console.warn = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
    try {
      await fn();
    } finally {
      console.warn = real;
    }
    return lines.join('\n');
  };

  // (a) 🔴 THE BASELINE, INVERTED — the absorb the guard existed to detect is GONE.
  // Until 0017 this asserted that a global catalog insert whose slug a household already owns is
  // SILENTLY ABSORBED (one row, the household's). With only `uq_movements_slug_global` left, the
  // household row is outside the arbiter's subset, so there is no collision and BOTH rows land —
  // which is the intended end state, since global-first then serves the curated one.
  const BASELINE_SLUG = 'ten2b_baseline_probe';
  await db.insert(schema.movements).values({
    publicId: '019826b4-0000-7000-8000-00000002b020',
    slug: BASELINE_SLUG,
    name: 'TEN-2b baseline probe',
    householdId: guardHousehold.id,
  });
  await db
    .insert(schema.movements)
    .values({
      publicId: '019826b4-0000-7000-8000-00000002b021',
      slug: BASELINE_SLUG,
      name: 'TEN-2b baseline global',
      pattern: 'squat',
      householdId: null,
    })
    .onConflictDoNothing({ target: schema.movements.slug, where: movementIsGlobal() });
  assert.deepEqual(
    (
      await db
        .select({ householdId: schema.movements.householdId })
        .from(schema.movements)
        .where(eq(schema.movements.slug, BASELINE_SLUG))
    )
      .map((r) => r.householdId)
      .sort(),
    [null, guardHousehold.id].sort(),
    'TEN-2c BASELINE — the absorb is GONE: a global catalog insert whose slug a household already owns now LANDS alongside it, because the only arbiter left is partial on `household_id IS NULL`. ⚠️ Inverted from TEN-2b’s "SILENTLY ABSORBED — no error, no row", which was the premise of the whole shadow guard',
  );
  await db.delete(schema.movements).where(eq(schema.movements.slug, BASELINE_SLUG));

  // (b) 🔴 THE GUARD REPORTS AND THE CURATED ROW LANDS — through the real `seed()`.
  // To prove the row LANDS the curated row has to be absent first, so this deletes it and lets the
  // seed put it back. That is the exact half the panel caught: with the `seedableMovements` filter
  // still in place, this assertion would fail — which is the point of making it.
  const SHADOW_NAME = 'TEN-2b shadow probe free text';
  await db.insert(schema.movements).values({
    publicId: '019826b4-0000-7000-8000-00000002b022',
    slug: shadowed.slug,
    name: SHADOW_NAME,
    householdId: guardHousehold.id,
  });
  await db
    .delete(schema.movements)
    .where(and(eq(schema.movements.slug, shadowed.slug), movementIsGlobal()));
  assert.deepEqual(
    await db
      .select({ publicId: schema.movements.publicId })
      .from(schema.movements)
      .where(and(eq(schema.movements.slug, shadowed.slug), movementIsGlobal())),
    [],
    'TEN-2c guard fixture: the curated row for the shadowed slug is absent before the seed runs — otherwise "the curated row lands" would hold because it never left',
  );
  const guardMessage = await captureWarnings(async () => {
    await seed(asPg);
  });
  assert.deepEqual(
    (
      await db
        .select({ publicId: schema.movements.publicId })
        .from(schema.movements)
        .where(and(eq(schema.movements.slug, shadowed.slug), movementIsGlobal()))
    ).map((r) => r.publicId),
    [shadowed.publicId],
    'TEN-2c SHADOW REPORT: `seed()` INSERTS the curated catalog row even though a household owns that slug — the `seedableMovements` filter is gone, so the guard suppresses no write. ⚠️ This is the half a `throw`-only demotion would have left broken FOREVER and silently: the curated row never inserted, with nothing complaining loudly',
  );
  assert.match(
    guardMessage,
    /ALSO owned by a household/,
    'TEN-2c SHADOW REPORT: …and it still REPORTS the shadowing, as a console.warn rather than a throw — `migrate.yml` seeds PRODUCTION on every push to `main`, where a throw turns the job red on every subsequent push and cannot clear itself by re-running',
  );
  assert.ok(
    guardMessage.includes(shadowed.slug),
    'TEN-2b: …and the warning NAMES the seed slug, so the operator knows which catalog row is shadowed',
  );
  // 🔴 Privacy: the message lands in a WORLD-READABLE Actions log (`migrate.yml` runs `db:seed`
  // against production on every push to `main`, in a public repo). Seed slugs come from a public
  // const; the colliding row's `name` is uncontrolled household free text and must never appear.
  // ⚠️ This assertion MOVED with the demotion (it used to read the thrown `Error.message`). Losing it
  // in the rewrite would have deleted a privacy proof while the gate stayed green.
  assert.ok(
    !guardMessage.includes(SHADOW_NAME),
    'TEN-2b: …and it does NOT contain the colliding row’s `name` — uncontrolled household free text, and this message is published to a public Actions log',
  );

  // (c) THE POSITIVE DIRECTION: with no shadow, `seed()` is still idempotent — a third run after
  // everything above, so the partial arbiter is exercised against a populated table.
  await db
    .delete(schema.movements)
    .where(eq(schema.movements.publicId, '019826b4-0000-7000-8000-00000002b022'));
  const quietMessage = await captureWarnings(async () => {
    await seed(asPg);
  });
  assert.equal(
    quietMessage,
    '',
    'TEN-2c: …and with no shadow the seed warns about NOTHING — the report is a report, not noise on every run',
  );
  assert.equal(
    (
      await db
        .select({ publicId: schema.movements.publicId })
        .from(schema.movements)
        .where(and(eq(schema.movements.slug, shadowed.slug), movementIsGlobal()))
    ).length,
    1,
    'TEN-2b: …leaving exactly ONE curated row for that slug — the partial arbiter is idempotent on a third run',
  );

  console.log(
    '✓ TEN-2c SEED SHADOW REPORT, three directions: the ABSORB IS GONE (a global catalog insert whose ' +
      'slug a household owns now lands alongside it — TEN-2b’s baseline, inverted), `seed()` INSERTS ' +
      'the curated row and WARNS instead of throwing (naming the seed slug, never the household’s free ' +
      'text, because that log is world-readable), and with no shadow it warns about nothing and stays ' +
      'idempotent. No DDL left in this block',
  );
}

// ───────────────────────────── AUTH-1 1b — `household_members`, all dark ─────────────────────────
//
// Nothing in the app reads this table yet, which is exactly why it needs proofs now: 1c's resolver is
// a ONE-WAY DOOR, and the constraints it will lean on have to be real before it leans on them.
{
  const CLERK_A = 'user_verify_a';
  const CLERK_B = 'user_verify_b';

  // The CHECK's literals are inlined in the DDL (a CHECK cannot import a const), so this is what
  // binds them back to @mat-plan/shared in BOTH directions. The sessions_day_role_check pattern.
  await assertCheckCoversConst('household_members_role_check', HOUSEHOLD_ROLES);

  // (1) The seed writes NO membership — behavioural, not a reading of seed.ts. `migrate.yml` runs
  // db:seed against prod on every push, so a seeded membership would bind a real family's household
  // to whatever id the seed names. The claim correction is the only writer.
  const seededMembers = await db.select().from(schema.householdMembers);
  assert.equal(
    seededMembers.length,
    0,
    'AUTH-1 1b: the seed writes NO household_members row — the claim correction is the only writer',
  );

  // (2) The happy path, through the scope capability rather than a raw household id.
  //
  // ⚠️ Claimed against household **B**, deliberately. The first version of this proof used A — whose
  // id is 1 — so a writer that ignored its scope and hardcoded `householdId: 1` passed, and
  // `db:mutations` caught it STAYING GREEN. Household B is the only id that distinguishes "used the
  // capability" from "guessed the only household there is".
  const PUBLIC_A = newId();
  await insertHouseholdMember(asPg, B_SCOPE, {
    publicId: PUBLIC_A,
    clerkUserId: CLERK_A,
    role: HOUSEHOLD_ROLE.owner,
  });
  assert.equal(
    (await membershipHousehold(asPg, CLERK_A))[0]?.householdId,
    verifyHh.id,
    'AUTH-1 1b: membershipHousehold resolves the CLAIMED household, not merely the first one',
  );
  assert.notEqual(
    verifyHh.id,
    households[0].id,
    'AUTH-1 1b: the proof above is only meaningful while B is not A (guards the guard)',
  );
  assert.equal(
    (await membershipHousehold(asPg, 'user_nobody')).length,
    0,
    'AUTH-1 1b: an unknown Clerk id resolves to null, never to "the only household"',
  );

  // (3) The four rejections. Each names the constraint 1c will depend on.
  await expectRejectedBy('household_members_role_check', async () =>
    insertHouseholdMember(asPg, B_SCOPE, {
      publicId: newId(),
      clerkUserId: 'user_bad_role',
      role: 'coach' as never, // COACH-1 is a cross-household grant, not a role string
    }),
  );
  await expectRejectedBy('uq_household_members_clerk_user', async () =>
    insertHouseholdMember(asPg, B_SCOPE, {
      publicId: newId(),
      clerkUserId: CLERK_A, // state D: one live household per Clerk account
      role: HOUSEHOLD_ROLE.owner,
    }),
  );
  await expectRejectedBy('household_members_public_id_unique', async () =>
    db.insert(schema.householdMembers).values({
      publicId: PUBLIC_A, // already taken by the row above
      householdId: verifyHh.id,
      clerkUserId: 'user_dup_public',
      role: HOUSEHOLD_ROLE.owner,
    }),
  );
  await expectRejectedBy('household_members_household_id_households_id_fk', async () =>
    db.insert(schema.householdMembers).values({
      publicId: newId(),
      householdId: 10_000_000, // no such household
      clerkUserId: 'user_bad_household',
      role: HOUSEHOLD_ROLE.owner,
    }),
  );

  // (4) A soft-deleted membership FREES the Clerk id — the partial predicate, proved rather than
  // assumed. This is what lets a household be re-claimed after a mistake without a hard delete.
  await db
    .update(schema.householdMembers)
    .set({ deletedAt: new Date() })
    .where(eq(schema.householdMembers.clerkUserId, CLERK_A));
  assert.equal(
    (await membershipHousehold(asPg, CLERK_A)).length,
    0,
    'AUTH-1 1b: a soft-deleted membership resolves to null — 1c must land such a user in state C',
  );
  await insertHouseholdMember(asPg, B_SCOPE, {
    publicId: newId(),
    clerkUserId: CLERK_A,
    role: HOUSEHOLD_ROLE.owner,
  });
  assert.equal(
    (await membershipHousehold(asPg, CLERK_A))[0]?.householdId,
    verifyHh.id,
    'AUTH-1 1b: the freed slot can be re-claimed',
  );

  // (4b) 🔴 A SOFT-DELETED HOUSEHOLD STOPS RESOLVING — the conjunct the first implementation of
  // `membershipHousehold` lost, and the one TEN-1 extracted `liveHouseholdIds` to protect. Without
  // `h.deleted_at IS NULL` a member of a deleted household keeps a working scope and can read its
  // profiles. ⚠️ This proof did not exist when the bug shipped (#308): the soft-deleted MEMBERSHIP
  // was covered, the soft-deleted HOUSEHOLD was not, so the suite passed on a wrong query.
  {
    const [tmpHh] = await asPg
      .insert(schema.households)
      .values({ publicId: newId(), name: 'verify 1b soft-deleted household' })
      .returning({ id: schema.households.id });
    const CLERK_D = 'user_verify_deleted_hh';
    await asPg.insert(schema.householdMembers).values({
      publicId: newId(),
      householdId: tmpHh!.id,
      clerkUserId: CLERK_D,
      role: HOUSEHOLD_ROLE.owner,
    });
    assert.equal(
      (await membershipHousehold(asPg, CLERK_D))[0]?.householdId,
      tmpHh!.id,
      'AUTH-1 1b: a live membership on a live household resolves (the baseline for the next line)',
    );

    await asPg
      .update(schema.households)
      .set({ deletedAt: new Date() })
      .where(eq(schema.households.id, tmpHh!.id));
    assert.equal(
      (await membershipHousehold(asPg, CLERK_D)).length,
      0,
      'AUTH-1 1b: a LIVE membership on a SOFT-DELETED household resolves to nothing — 1c must land ' +
        'that user in state C, never in a deleted household',
    );

    // (4b-bis) 🔴 **PROF-1 b-s — the ROLE comes from the SAME live row, and this is the case the
    // whole design rests on.** `uq_household_members_clerk_user` is partial on `deleted_at IS NULL`,
    // so ONE account can hold a **soft-deleted `owner` row in household X beside a live `member` row
    // in Y**. A role read by a second lookup keyed on `clerk_user_id` — or by one that forgot the
    // `deleted_at` conjunct — returns the DEAD owner row and silently makes a member an owner of
    // somebody else's household. Constructing that state and asserting `member` is the only way to
    // show the one-query design actually prevents it; prose cannot.
    {
      // 🔴 **BOTH households here are LIVE, and that is the whole sensitivity of this block.** The
      // first draft put the dead `owner` row in the soft-deleted `tmpHh` above, where
      // `households.deleted_at IS NULL` excluded it as well — so the assertions below held under
      // EITHER conjunct and could not fail when one regressed (proved: patches 07 and 09 each left
      // this block green). A negative fixture covered by two conjuncts proves neither. The state the
      // docblock names — an owner REMOVED from a household that still exists, who then joins another
      // — needs the dead row's household alive, so `household_members.deleted_at IS NULL` is the only
      // thing standing between the resolver and a dead owner row.
      const [bsDeadHh] = await asPg
        .insert(schema.households)
        .values({ publicId: newId(), name: 'B-s Dead-Row HH' })
        .returning({ id: schema.households.id });
      const [bsLiveHh] = await asPg
        .insert(schema.households)
        .values({ publicId: newId(), name: 'B-s Live HH' })
        .returning({ id: schema.households.id });
      const CLERK_BS = 'user_00000000000000000000000bs01';

      // The DEAD owner row — in a household that is itself LIVE (see above).
      await asPg.insert(schema.householdMembers).values({
        publicId: newId(),
        householdId: bsDeadHh!.id,
        clerkUserId: CLERK_BS,
        role: HOUSEHOLD_ROLE.owner,
        deletedAt: new Date(),
      });
      // …and the LIVE member row, elsewhere.
      await asPg.insert(schema.householdMembers).values({
        publicId: newId(),
        householdId: bsLiveHh!.id,
        clerkUserId: CLERK_BS,
        role: HOUSEHOLD_ROLE.member,
      });

      const resolved = await membershipHousehold(asPg, CLERK_BS);
      assert.equal(resolved.length, 1, 'PROF-1 b-s: only the LIVE membership resolves');
      assert.equal(
        resolved[0]?.householdId,
        bsLiveHh!.id,
        'PROF-1 b-s: …and it is the live household, not the dead one',
      );
      assert.equal(
        resolved[0]?.role,
        HOUSEHOLD_ROLE.member,
        'PROF-1 b-s: the role is MEMBER — read from the live row, never from the soft-deleted ' +
          'owner row the same account holds elsewhere',
      );
      assert.equal(
        ownerScope({ ...A_SCOPE, role: resolved[0]!.role }),
        null,
        'PROF-1 b-s: …so the narrowing refuses, and nothing can archive on a dead owner row',
      );

      await asPg
        .delete(schema.householdMembers)
        .where(eq(schema.householdMembers.clerkUserId, CLERK_BS));
      await asPg.delete(schema.households).where(eq(schema.households.id, bsLiveHh!.id));
      await asPg.delete(schema.households).where(eq(schema.households.id, bsDeadHh!.id));
    }

    // (4c) The LIMIT 2 ambiguity probe. Two live memberships for one account is a state the resolver
    // cannot represent, so the query must REPORT it rather than pick. `LIMIT 1` + no ORDER BY would
    // have returned whichever row the planner reached first — a cross-wire with nothing in the logs.
    const [tmpHh2] = await asPg
      .insert(schema.households)
      .values({ publicId: newId(), name: 'verify 1b ambiguity probe' })
      .returning({ id: schema.households.id });
    // The partial unique is on `clerk_user_id` alone, so a SECOND live membership for one account is
    // rejected by the DATABASE — which is the real guarantee. The probe exists for the shapes the
    // index cannot cover (a future COACH-1 widening), so assert the constraint, then the cap.
    await expectRejectedBy('uq_household_members_clerk_user', async () =>
      asPg.insert(schema.householdMembers).values({
        publicId: newId(),
        householdId: tmpHh2!.id,
        clerkUserId: CLERK_D,
        role: HOUSEHOLD_ROLE.member,
      }),
    );
    assert.ok(
      (await membershipHousehold(asPg, CLERK_D)).length <= 2,
      'AUTH-1 1b: the probe is capped at two — it reports ambiguity, it never pages',
    );

    await asPg
      .delete(schema.householdMembers)
      .where(eq(schema.householdMembers.clerkUserId, CLERK_D));
    await asPg.delete(schema.households).where(eq(schema.households.id, tmpHh!.id));
    await asPg.delete(schema.households).where(eq(schema.households.id, tmpHh2!.id));
  }

  // (5) 🔴 THE DELETION-ORDER PROOF — the one PRIV-3 predicted in writing.
  //
  // Isolated on its OWN household, deliberately: deleting the seeded household aborts on
  // `profiles_household_id_households_id_fk` FIRST, so it proves the runbook aborts somewhere and
  // says nothing about THIS table. A household whose only child is a membership names the FK that
  // runbooks.md step 13 exists for, and nothing else.
  const [lone] = await asPg
    .insert(schema.households)
    .values({ publicId: newId(), name: 'verify 1b deletion-order' })
    .returning({ id: schema.households.id });
  // Inserted DIRECTLY, not through `insertHouseholdMember`: the writer takes a `HouseholdScope`, and
  // minting a third one here is precisely what `scope.test.ts`'s "exactly two named scopes" guard
  // forbids — it caught this on the first run. The capability path is already proved at (2); what
  // this proof needs is a row, and the FK does not care how it arrived.
  await asPg.insert(schema.householdMembers).values({
    publicId: newId(),
    householdId: lone!.id,
    clerkUserId: CLERK_B,
    role: HOUSEHOLD_ROLE.member,
  });

  // Out of order: `households` before `household_members` → the NO ACTION FK aborts the transaction.
  await expectRejectedBy('household_members_household_id_households_id_fk', async () =>
    asPg.delete(schema.households).where(eq(schema.households.id, lone!.id)),
  );
  assert.equal(
    (
      await asPg
        .select()
        .from(schema.householdMembers)
        .where(eq(schema.householdMembers.householdId, lone!.id))
    ).length,
    1,
    'AUTH-1 1b: the aborted delete rolled back — the membership is still there',
  );

  // In the runbook's order (step 13 then 14): it commits, and leaves zero rows.
  await asPg
    .delete(schema.householdMembers)
    .where(eq(schema.householdMembers.householdId, lone!.id));
  await asPg.delete(schema.households).where(eq(schema.households.id, lone!.id));
  assert.equal(
    (await asPg.select().from(schema.households).where(eq(schema.households.id, lone!.id))).length,
    0,
    'AUTH-1 1b: in runbooks.md order the household deletion COMMITS and leaves nothing',
  );

  // (6) THE CLAIM CORRECTION, exercised rather than read. A correction nobody has run is a
  // correction nobody has tested, and this one performs the single write that 1c's whole resolver
  // depends on. Its `run` is called directly — the `nullRoutineToFull` precedent above — because the
  // runner needs a DATABASE_URL and PGlite has none.
  const claim = CORRECTIONS.find((c) => c.name === 'household-claim-2026-10-25');
  assert.ok(claim, 'AUTH-1 1b: the claim correction is in the registry');

  const CLERK_C = 'user_verify_claim';
  const envBefore = { h: process.env.HOUSEHOLD_PUBLIC_ID, u: process.env.CLERK_USER_ID };
  try {
    // (6a) Both targets are required, and neither may be a committed constant.
    delete process.env.HOUSEHOLD_PUBLIC_ID;
    delete process.env.CLERK_USER_ID;
    await assert.rejects(
      () => claim.run(asCorrectionDb, false),
      /HOUSEHOLD_PUBLIC_ID and CLERK_USER_ID/,
      'AUTH-1 1b: the claim correction refuses with no targets',
    );

    // (6b) A dev-shaped id that is not a Clerk id at all is refused BEFORE any write — the guard
    // against claiming production with something read off the wrong screen.
    process.env.HOUSEHOLD_PUBLIC_ID = VERIFY_HH_PUBLIC_ID;
    process.env.CLERK_USER_ID = 'not-a-clerk-id';
    await assert.rejects(
      () => claim.run(asCorrectionDb, false),
      /should look like/,
      'AUTH-1 1b: the claim correction refuses an id that is not Clerk-shaped',
    );

    // (6f) 🔴 **The fixture principal is refused against a non-local target — AUTH-1 1c-4a.**
    //
    // `corrections/target-url.test.ts` drives `fixtureBindIsAllowed` in isolation; nothing there
    // proves it is WIRED INTO this correction. Delete the `if (!fixtureBindIsAllowed(...)) throw`
    // from `registry.ts` and that unit suite stays green — which would leave the one control
    // standing between the committed fixture id and a production database unproven, in the chunk
    // that introduced it. This asserts the composition.
    //
    // The target is forced non-local by removing BOTH variables: `correctionTargetUrl()` then
    // resolves `undefined`, and the guard treats unknown as not-local. That is also the honest
    // shape of the case it exists for — a correction run with no target set is not a local one.
    const dbUrlBefore = {
      pooled: process.env.DATABASE_URL,
      unpooled: process.env.DATABASE_URL_UNPOOLED,
    };
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_URL_UNPOOLED;
    try {
      process.env.HOUSEHOLD_PUBLIC_ID = VERIFY_HH_PUBLIC_ID;
      process.env.CLERK_USER_ID = E2E_SESSION_BYPASS_USER;
      await assert.rejects(
        () => claim.run(asCorrectionDb, true),
        /refusing to bind the committed e2e fixture principal/,
        'AUTH-1 1c-4a: the fixture principal is refused against a non-local target',
      );
    } finally {
      if (dbUrlBefore.pooled === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = dbUrlBefore.pooled;
      if (dbUrlBefore.unpooled === undefined) delete process.env.DATABASE_URL_UNPOOLED;
      else process.env.DATABASE_URL_UNPOOLED = dbUrlBefore.unpooled;
    }

    // (6c) The dry run writes NOTHING (rule 1) and names the full id, so a human can check it against
    // the dashboard before the irreversible write.
    process.env.CLERK_USER_ID = CLERK_C;
    const before = (await asPg.select().from(schema.householdMembers)).length;
    const dry = await claim.run(asCorrectionDb, false);
    assert.equal(
      (await asPg.select().from(schema.householdMembers)).length,
      before,
      'AUTH-1 1b: the claim correction writes nothing without --apply',
    );
    assert.ok(
      dry.some((l) => l.includes(CLERK_C)),
      'AUTH-1 1b: the dry run names the FULL Clerk id — a truncated one cannot be checked',
    );

    // (6d) --apply writes once, and a SECOND run is an idempotent no-op rather than a 23505.
    await claim.run(asCorrectionDb, true);
    assert.equal(
      (await membershipHousehold(asPg, CLERK_C))[0]?.householdId,
      verifyHh.id,
      'AUTH-1 1b: --apply binds the account to the NAMED household',
    );
    const again = await claim.run(asCorrectionDb, true);
    assert.ok(
      again.some((l) => l.includes('already claimed')),
      'AUTH-1 1b: a re-run is an idempotent no-op, not a duplicate-key crash (rule 2)',
    );

    // (6e) 🔴 The case `INSERT … WHERE NOT EXISTS` could not have told apart: the SAME Clerk id
    // pointed at a DIFFERENT household must REFUSE, not silently no-op.
    process.env.HOUSEHOLD_PUBLIC_ID = households[0]!.publicId;
    await assert.rejects(
      () => claim.run(asCorrectionDb, true),
      /already bound to a DIFFERENT household/,
      'AUTH-1 1b: claiming a second household with one Clerk id refuses — the operator-error case',
    );
  } finally {
    if (envBefore.h === undefined) delete process.env.HOUSEHOLD_PUBLIC_ID;
    else process.env.HOUSEHOLD_PUBLIC_ID = envBefore.h;
    if (envBefore.u === undefined) delete process.env.CLERK_USER_ID;
    else process.env.CLERK_USER_ID = envBefore.u;
  }

  console.log(
    '✓ AUTH-1 1b: household_members — CHECK bound to HOUSEHOLD_ROLES, four rejections, the freed ' +
      'slot, the seed writes none, the runbook order both ways (step 13 before 14), and the six ' +
      'branches of the claim correction (the sixth is 1c-4a: the fixture principal is refused ' +
      'against a non-local target, proving the guard is WIRED and not merely unit-tested)',
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// PROF-1 a-0 — `profiles.client_id` is a NON-PARTIAL unique, and `archived_at` is not a soft delete.
//
// 🔴 THE PROPERTY UNDER TEST IS AN ABSENCE: `uq_profiles_client_id` has NO `WHERE` clause. An absence
// cannot be proved by reading the catalog alone — a `WHERE` that is present but wrong reads the same
// as absent to a naive check — so each case below makes the database REFUSE a real insert, with the
// first row in a state (`archived_at` set, then `deleted_at` set) that WOULD have freed the slot had
// the index been partial like every other `client_id` arbiter in this schema
// (docs/decisions/0008-deletion.md:127).
//
// Its own throwaway household (DB N3), so nothing here can be satisfied by another block's rows.
{
  const A0_HH = '019826b4-0000-7000-8000-00000003a000';
  const A0_P1 = '019826b4-0000-7000-8000-00000003a001';
  const A0_P2 = '019826b4-0000-7000-8000-00000003a002';
  const A0_P3 = '019826b4-0000-7000-8000-00000003a003';
  const A0_P4 = '019826b4-0000-7000-8000-00000003a004';
  const A0_CLIENT_ID = '019826b4-0000-7000-8000-00000003acc1';

  await db.insert(schema.households).values({ publicId: A0_HH, name: 'Verify PROF-1 a-0 HH' });
  const [a0Hh] = await db
    .select({ id: schema.households.id })
    .from(schema.households)
    .where(eq(schema.households.publicId, A0_HH));

  const addAthlete = (publicId: string, clientId: string | null) =>
    db.insert(schema.profiles).values({
      publicId,
      clientId,
      name: 'A0 Athlete',
      kind: PROFILE_KIND.kid,
      householdId: a0Hh.id,
    });

  // 1 · The ordinary case: the key is taken, so a replay-shaped second insert is refused.
  await addAthlete(A0_P1, A0_CLIENT_ID);
  await expectRejectedBy('uq_profiles_client_id', () => addAthlete(A0_P2, A0_CLIENT_ID));

  // 2 · ARCHIVED does not free the slot. This is the case PROF-1b depends on: archive the athlete,
  // retry the add, and get a refusal rather than a twin.
  await db
    .update(schema.profiles)
    .set({ archivedAt: new Date() })
    .where(eq(schema.profiles.publicId, A0_P1));
  await expectRejectedBy('uq_profiles_client_id', () => addAthlete(A0_P2, A0_CLIENT_ID));

  // 3 · SOFT-DELETED does not free it either — the half that distinguishes this index from every
  // other `client_id` arbiter. A partial `WHERE deleted_at IS NULL` would ACCEPT this insert, so a
  // pass here is the direct evidence that the predicate is absent.
  await db
    .update(schema.profiles)
    .set({ deletedAt: new Date() })
    .where(eq(schema.profiles.publicId, A0_P1));
  await expectRejectedBy('uq_profiles_client_id', () => addAthlete(A0_P2, A0_CLIENT_ID));

  // 4 · NULL keys coexist, which is what makes the column nullable usable at all: the seed and
  // `db:correct` create profiles with no client key, and NULLs are DISTINCT in a unique index. If
  // this ever fails, the column was made NOT NULL or the index gained a `coalesce`.
  await addAthlete(A0_P3, null);
  await addAthlete(A0_P4, null);
  const nullKeyed = await db
    .select({ publicId: schema.profiles.publicId })
    .from(schema.profiles)
    .where(and(eq(schema.profiles.householdId, a0Hh.id), isNull(schema.profiles.clientId)));
  assert.equal(
    nullKeyed.length,
    2,
    'PROF-1 a-0: two profiles with a NULL client_id coexist (NULLs are distinct in a unique index)',
  );

  // 5 · `archived_at` defaults to NULL — a new athlete is not born archived. Read off row 3, which
  // nothing above touched, so this measures the column DEFAULT rather than an UPDATE.
  const [freshRow] = await db
    .select({ archivedAt: schema.profiles.archivedAt })
    .from(schema.profiles)
    .where(eq(schema.profiles.publicId, A0_P3));
  assert.equal(
    freshRow.archivedAt,
    null,
    'PROF-1 a-0: an inserted profile that never named archived_at is NOT archived',
  );

  console.log(
    '✓ PROF-1 a-0: profiles.client_id is non-partial unique — the slot survives BOTH archived_at ' +
      'and deleted_at on the holder (the property every other client_id arbiter lacks), NULL keys ' +
      'coexist, and archived_at defaults to NULL',
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// PROF-1 a-r — rename, and the two refusals that ARE acceptance criterion 4.
//
// 🔴 THE PROPERTY UNDER TEST IS A ROW COUNT. Criterion 4 reads: "if a rename names a profile outside
// the session's household, the system shall respond as for an unknown profile and write nothing".
// "Write nothing" is not something an emitted-SQL assertion can report — `lib/dal/profiles.test.ts`
// proves the conjunct was APPENDED and bound to the resolved household, which is a different claim.
// Only a real database can answer "how many rows did that UPDATE touch, and did the OTHER
// household's name change". That is why `renameProfile` lives in `packages/db` rather than the app
// DAL, next to a `updateProfileRoutine` that reasonably does not.
//
// ⚠️ **It rides A_SCOPE and B_SCOPE, mints nothing, and UNWRAPS nothing** — `src/scope.test.ts` pins
// this file to exactly two named scopes (the TEN-1 plan's R5(1)) and, separately, pins the unwrap
// `scope.householdId` to one module. Both guards are right, so the fixture inserts below take the
// RAW ids the script already holds (`households[0].id`, `verifyHh.id`), exactly as every sibling
// fixture block does, and the two scopes appear only where they are the thing under test — in the
// `renameProfile` calls. 🔴 The first draft of this block unwrapped `A_SCOPE` with a `.householdId`
// and the guard STAYED GREEN: its regex was case-sensitive on `[Ss]cope`, so a SCREAMING_CASE
// constant walked past it. Found by the security lens on #350; the regex is now `/i` and this block
// is what proved the widening non-vacuous.
//
// The isolation comes from the ROWS: every profile below is inserted by this block, prefixed `A-r`,
// with public_ids in the `…04d0xx` range this block owns. A refusal here therefore cannot be
// satisfied by the absence of rows some earlier block happened to leave behind, and nothing seeded
// is renamed.
//
// 🔴 **That sentence was FALSE when it shipped (#350), and the range is the fix.** The block used
// `…04a001`, which `PROF-1 a-g` also uses (`AG_ADULT`) ~3,000 lines up — so "its own range" was a
// claim the ids did not support, and the insert succeeded only because a-g hard-deletes its row
// first (_"Leave no adult behind"_). A latent ordering dependency between two blocks that each
// believed they were independent. ⚠️ It would have failed LOUDLY, not silently —
// `profiles_public_id_unique` — which is why nothing was wrong with the proof, only with the
// comment and the coupling. Found by a review panel on the `DX-12` plan, 2026-11-07.
//
// **The convention this establishes, for the next block:** pick a suffix range nothing else in this
// file uses (`grep -oE '019826b4-[0-9a-f-]+' scripts/verify.ts | sort -u`), say which range is
// yours, and insert every row you assert on. Ad-hoc ids that happen not to clash today are how two
// blocks end up sharing one.
{
  const AR_A_P = '019826b4-0000-7000-8000-00000004d001';
  const AR_B_P = '019826b4-0000-7000-8000-00000004d0b1';
  const AR_A_DELETED = '019826b4-0000-7000-8000-00000004d002';
  const AR_A_ARCHIVED = '019826b4-0000-7000-8000-00000004d003';
  const AR_B_ORIGINAL = 'A-r Athlete B';

  const nameOf = async (publicId: string) => {
    const [row] = await db
      .select({ name: schema.profiles.name })
      .from(schema.profiles)
      .where(eq(schema.profiles.publicId, publicId));
    return row?.name;
  };

  await db.insert(schema.profiles).values([
    {
      publicId: AR_A_P,
      name: 'A-r Athlete A',
      kind: PROFILE_KIND.kid,
      householdId: households[0].id,
    },
    { publicId: AR_B_P, name: AR_B_ORIGINAL, kind: PROFILE_KIND.kid, householdId: verifyHh.id },
    {
      publicId: AR_A_DELETED,
      name: 'A-r Deleted',
      kind: PROFILE_KIND.kid,
      householdId: households[0].id,
      deletedAt: new Date(),
    },
    {
      publicId: AR_A_ARCHIVED,
      name: 'A-r Archived',
      kind: PROFILE_KIND.kid,
      householdId: households[0].id,
      archivedAt: new Date(),
    },
  ]);

  // PROF-1 a-1d-ren widened `renameProfile` to a discriminated result (it can now answer
  // `duplicate`). These a-r proofs assert the SUCCESS id, so they unwrap it here rather than each
  // growing a cast — and a `duplicate`/`refused` answer where the test expects success now fails
  // with the reason, which is more useful than `undefined !== <id>`.
  const renamedId = (r: Awaited<ReturnType<typeof renameProfile>>) =>
    r.ok ? r.publicId : `REFUSED:${r.reason}`;

  // 1 · The ordinary case: A renames A's own athlete, one row back, and the name really changed.
  const renamed = await renameProfile(asPg, A_SCOPE, AR_A_P, 'A-r Renamed');
  assert.equal(
    renamedId(renamed),
    AR_A_P,
    'PROF-1 a-r: renaming an own live athlete returns its id',
  );
  assert.equal(await nameOf(AR_A_P), 'A-r Renamed', 'PROF-1 a-r: the name is persisted');

  // 2 · 🔴 CRITERION 4. B tries to rename A's athlete: zero rows, `null`, and — the half a return
  // value alone would not catch — A's name is UNTOUCHED.
  assert.equal(
    renamedId(await renameProfile(asPg, B_SCOPE, AR_A_P, 'Renamed By The Wrong Household')),
    'REFUSED:refused',
    "PROF-1 a-r: household B renaming A's profile updates 0 rows",
  );
  assert.equal(
    await nameOf(AR_A_P),
    'A-r Renamed',
    "PROF-1 a-r: A's name survives B's attempt — the refusal wrote NOTHING",
  );

  // 2b · …and the same in the OTHER direction, which is this file's standing rule for a seam: a
  // predicate that happened to hard-code one household would pass case 2 and fail here.
  assert.equal(
    renamedId(await renameProfile(asPg, A_SCOPE, AR_B_P, 'Renamed By The Wrong Household')),
    'REFUSED:refused',
    "PROF-1 a-r: household A renaming B's profile updates 0 rows",
  );
  assert.equal(
    await nameOf(AR_B_P),
    AR_B_ORIGINAL,
    "PROF-1 a-r: B's name survives A's attempt, in both directions",
  );

  // 3 · A soft-deleted profile is not renameable, in its OWN household: `deleted_at IS NULL` is the
  // second conjunct, and it is the one a "scope the writes by household" refactor would drop.
  assert.equal(
    renamedId(await renameProfile(asPg, A_SCOPE, AR_A_DELETED, 'Renamed A Dead Row')),
    'REFUSED:refused',
    'PROF-1 a-r: a soft-deleted profile updates 0 rows even for its own household',
  );
  assert.equal(await nameOf(AR_A_DELETED), 'A-r Deleted', 'PROF-1 a-r: the dead row is untouched');

  // 4 · An unknown id is refused the same way, so the three refusals are one answer (ADR 0006).
  assert.equal(
    renamedId(await renameProfile(asPg, A_SCOPE, '019826b4-0000-7000-8000-00000004d0ff', 'Nobody')),
    'REFUSED:refused',
    'PROF-1 a-r: an unknown public id updates 0 rows',
  );

  // 5 · 🔴 AN ARCHIVED ATHLETE **CAN** BE RENAMED. The opposite direction from every case above, and
  // the "fix" a future author is most likely to reach for: archive is "not currently training", not
  // a lock (`schema.ts` → `profiles.archivedAt`), so a typo in an archived athlete's name must be
  // fixable without restoring them first. If this ever fails, a UX filter has been folded into the
  // ownership seam. Mutation patch `13-rename-locks-archived` is what proves this assertion can fail.
  assert.equal(
    renamedId(await renameProfile(asPg, A_SCOPE, AR_A_ARCHIVED, 'A-r Archived Renamed')),
    AR_A_ARCHIVED,
    'PROF-1 a-r: an ARCHIVED athlete is still renameable',
  );
  assert.equal(
    await nameOf(AR_A_ARCHIVED),
    'A-r Archived Renamed',
    'PROF-1 a-r: the archived athlete’s new name is persisted',
  );

  // 5b · 🔴 **The COLUMN accepts what the SCHEMA accepts.** `profiles.name` is unbounded `text` and
  // `PROFILE_NAME_MAX` is an app-input cap, so nothing else in the repo ties the two together — a
  // future `varchar(20)` would pass every unit test (they validate the schema, not the column) and
  // fail only in production. `packages/shared/src/profiles.ts` names `db:verify` as the consumer
  // that closes this; it was a claim before this assertion existed.
  const AT_CAP = 'W'.repeat(PROFILE_NAME_MAX);
  assert.equal(
    renamedId(await renameProfile(asPg, A_SCOPE, AR_A_P, AT_CAP)),
    AR_A_P,
    'PROF-1 a-r: a name at PROFILE_NAME_MAX is accepted by the column',
  );
  assert.equal(
    await nameOf(AR_A_P),
    AT_CAP,
    'PROF-1 a-r: …and stored in full, not silently truncated',
  );

  // ── PROF-1 a-1d-ren — the duplicate warning on RENAME ────────────────────────────────────────
  //
  // The add form's check, with one difference that is the whole chunk: a rename that does not change
  // the FOLD creates no new collision, so it must not warn. Two live athletes sharing a name is the
  // DESIGNED case, which is what makes the naive "exclude self" insufficient — see `renameProfile`.

  // Two live athletes under one folded name, exactly as "Add another" produces.
  await insertProfileOwnedBy(asPg, A_SCOPE, {
    clientId: newId(),
    name: 'Ren Twin',
    kind: PROFILE_KIND.kid,
  });
  const renTwinTwo = newId();
  await insertProfileOwnedBy(asPg, A_SCOPE, {
    clientId: renTwinTwo,
    name: 'Ren Twin',
    kind: PROFILE_KIND.kid,
  });
  const twinTwo = await profileByClientId(asPg, A_SCOPE, renTwinTwo);
  assert.ok(
    twinTwo,
    'PROF-1 a-1d-ren: the second Ren Twin exists (or the case below proves nothing)',
  );

  // A separate live athlete to collide WITH. ⚠️ Not one of the a-r fixtures: `AR_A_P` has been
  // renamed twice by the assertions above (last to `AT_CAP`), so a literal from earlier in this
  // block would silently match nobody and the collision case would pass by accident.
  await insertProfileOwnedBy(asPg, A_SCOPE, {
    clientId: newId(),
    name: 'Ren Other',
    kind: PROFILE_KIND.kid,
  });

  // 🔴 THE CASE THE WHOLE GUARD EXISTS FOR. Fixing the casing of one of two same-named athletes must
  // not warn about the other. ⚠️ Fold-EQUAL but string-DIFFERENT on purpose: `'Ren Twin'` unchanged
  // would pass on string equality and prove nothing about the fold.
  const casingFix = await renameProfile(asPg, A_SCOPE, twinTwo.publicId, 'REN TWIN');
  assert.equal(
    renamedId(casingFix),
    twinTwo.publicId,
    'PROF-1 a-1d-ren: a CASING fix on one of two same-named athletes does not warn — the fold is ' +
      'unchanged, so no new collision is created and excluding self would not have been enough',
  );
  assert.equal(
    await nameOf(twinTwo.publicId),
    'REN TWIN',
    'PROF-1 a-1d-ren: …and the casing fix is actually persisted',
  );

  // The real collision: renaming to a DIFFERENT live athlete's name warns, and writes nothing.
  const collide = await renameProfile(asPg, A_SCOPE, twinTwo.publicId, 'Ren Other');
  assert.equal(
    collide.ok === false && collide.reason,
    'duplicate',
    'PROF-1 a-1d-ren: renaming onto another live athlete’s name warns',
  );
  assert.equal(
    collide.ok === false && collide.reason === 'duplicate' && collide.match.name,
    'Ren Other',
    'PROF-1 a-1d-ren: …and the match carries the STORED spelling, so the copy cannot relabel them',
  );
  assert.equal(
    await nameOf(twinTwo.publicId),
    'REN TWIN',
    'PROF-1 a-1d-ren: …and NOTHING was written — the warning precedes the update',
  );

  // Acknowledged, the same name goes through: the warning is advisory, never a constraint.
  assert.equal(
    renamedId(
      await renameProfile(asPg, A_SCOPE, twinTwo.publicId, 'Ren Other', {
        acknowledgedDuplicate: foldName('Ren Other'),
      }),
    ),
    twinTwo.publicId,
    'PROF-1 a-1d-ren: an acknowledgement waves the collision through — advisory, not a constraint',
  );

  // An acknowledgement for a DIFFERENT folded name does not wave this one through.
  // ⚠️ Discriminated on `reason`, not on `.ok === false` alone: a writer that answered `refused` for
  // any reason would otherwise pass a test named for the acknowledgement, which is the shape
  // `db:mutations` exists to catch. The read-back is the other half — a warning must write nothing.
  const staleAck = await renameProfile(asPg, A_SCOPE, twinTwo.publicId, 'Ren Twin', {
    acknowledgedDuplicate: foldName('Somebody Else'),
  });
  assert.equal(
    staleAck.ok === false && staleAck.reason,
    'duplicate',
    'PROF-1 a-1d-ren: a stale acknowledgement does not wave a different name through',
  );
  assert.equal(
    await nameOf(twinTwo.publicId),
    'Ren Other',
    'PROF-1 a-1d-ren: …and the stale-acknowledgement attempt wrote nothing',
  );

  // 🔴 **THE TENANCY PROOF FOR THE NEW PRE-READ, and it needs a name household B HOLDS.**
  // `renameProfile` now reads the stored name first, through `isLiveProfile`. Every pre-existing
  // cross-household case renames to a name NOBODY holds, so an unscoped pre-read would still answer
  // `refused` — the UPDATE's own predicate refuses — and no assertion could go red. What an unscoped
  // read WOULD change is this: B renaming A's athlete to a name **B** holds would answer `duplicate`
  // instead of `refused`, which is a one-bit oracle on A's stored name, keyed on a public id. That is
  // exactly the "one answer" ADR 0006 exists to preserve.
  await insertProfileOwnedBy(asPg, B_SCOPE, {
    clientId: newId(),
    name: 'B Oracle',
    kind: PROFILE_KIND.kid,
  });
  assert.equal(
    renamedId(await renameProfile(asPg, B_SCOPE, AR_A_P, 'B Oracle')),
    'REFUSED:refused',
    'PROF-1 a-1d-ren: household B renaming A’s athlete to a name B HOLDS answers refused, never ' +
      'duplicate — the fold guard’s pre-read is scoped, and a leak here would be an oracle on A’s ' +
      'stored name',
  );

  console.log(
    '✓ PROF-1 a-1d-ren: renaming warns on another live athlete’s name and writes nothing, an ' +
      'acknowledgement waves it through, a stale one does not — and a CASING fix on one of two ' +
      'same-named athletes does NOT warn, which excluding self alone would not have achieved',
  );

  // 6 · The rename touches exactly ONE row. The seeded profile in household A is the witness: a
  // predicate that lost its `public_id` conjunct would rename every live profile in the household
  // and still return a row, so every assertion above would pass. This is the case that catches it.
  assert.equal(
    await nameOf(SEED_PROFILE_PUBLIC_ID),
    SEED_PROFILE_NAME,
    "PROF-1 a-r: household A's OTHER profiles were never touched — the UPDATE matched one row",
  );

  console.log(
    '✓ PROF-1 a-r: rename is scoped by public_id ∧ live ∧ household — the wrong household (BOTH ' +
      'directions), a soft-deleted row and an unknown id each update 0 rows and leave the stored ' +
      'name intact (criterion 4 as a row count), only ONE row is touched, an ARCHIVED athlete is ' +
      'still renameable, and the COLUMN stores a PROFILE_NAME_MAX name in full',
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// PROF-1 b-s — the owner conjunct, proved where the TYPE cannot reach.
//
// 🔴 **FIRST, WHAT THIS BLOCK DOES NOT PROVE.** `isOwnerOf` emits `$1 = $2` over the scope's OWN
// `role` field — it reads no column, and the database never re-checks `household_members`. These
// assertions are NOT a database-side authority check, and this header claimed they were ("the
// database-side half has to hold on its own"). A probe settled it, not an argument:
// `new PgDialect().sqlToQuery(isOwnerOf(forged))` → `{ sql: '$1 = $2', params: ['member','owner'] }`.
//
// **What they DO prove, which is narrower and still worth the block:** a scope whose role is
// honestly `member` but which was cast past `ownerScope()` matches **0 rows** instead of writing —
// the lost narrowing fails CLOSED, and fails as a row count that mutation patch `14` can redden. A
// forgery that *writes* `role: 'owner'` passes every assertion here, and the database cannot tell it
// from an honest owner; closing that needs the principal on the scope (`INVITE-1`).
//
// 🔴 THE CASE THE BRAND CANNOT STOP. `OwnerScope` makes a non-owner caller a COMPILE error, and
// `src/scope.test.ts`'s `@ts-expect-error` pin proves that half. What a type cannot stop is a cast —
// ONE word, `as OwnerScope`, not the `as unknown as OwnerScope` this header also claimed, since
// `OwnerScope` is a SUBTYPE. `src/scope.test.ts` now guards that cast lexically, and the forgery
// below is its one allowed appearance.
//
// ⚠️ Ships DARK — `isOwnerOf` has no caller until PROF-1 b's `archiveProfile`. This block is what
// stops it shipping as an untested decoration in the meantime.
{
  // Ids `…04e0xx` are THIS block's range. #352 landed that convention after a-r and b-s both reused
  // another block's `public_id` and collided on the UNIQUE; say which range is yours.
  const BS_P = '019826b4-0000-7000-8000-00000004e001';
  await db.insert(schema.profiles).values({
    publicId: BS_P,
    name: 'B-s Athlete',
    kind: PROFILE_KIND.kid,
    householdId: households[0].id,
  });

  const rowsMatching = async (scope: OwnerScope) =>
    (
      await asPg
        .select({ publicId: schema.profiles.publicId })
        .from(schema.profiles)
        .where(and(isLiveProfile(BS_P, scope), isOwnerOf(scope)))
    ).length;

  // 1 · A genuine owner scope matches the row.
  const ownerish = ownerScope(A_SCOPE);
  assert.ok(ownerish, 'PROF-1 b-s: the script scope defaults to owner, so it narrows');
  assert.equal(await rowsMatching(ownerish), 1, 'PROF-1 b-s: an OWNER scope matches its own row');

  // 2 · 🔴 The forged one does not. This is the whole block: same household, same profile, same
  // `isLiveProfile` — only the role differs, and the conjunct is what turns that into 0 rows.
  // ⚠️ **SPREAD from A_SCOPE, never minted — and that is better than a mint, not a workaround for
  // the two-scope guard.** The case under test is a FORGERY: `scope.ts` says a deliberate
  // `as unknown as` is the one way past the brand, "a visible, reviewable forgery, which is the
  // point". Constructing it with the real constructor would have tested a legitimately-made member
  // scope instead — a different, weaker thing. Spreading the owner scope and overwriting the role is
  // exactly the shape an attacker or a careless refactor produces.
  const forged = { ...A_SCOPE, role: HOUSEHOLD_ROLE.member } as OwnerScope;
  assert.equal(
    await rowsMatching(forged),
    0,
    'PROF-1 b-s: a FORGED owner scope (role=member) matches 0 rows — the conjunct, not the type',
  );

  // 3 · …and `ownerScope()` refuses to produce that value in the first place, so reaching case 2
  // requires the explicit cast. Both halves, stated: the narrowing refuses, the SQL refuses.
  assert.equal(
    ownerScope({ ...A_SCOPE, role: HOUSEHOLD_ROLE.member }),
    null,
    'PROF-1 b-s: ownerScope() refuses a member scope, so the forgery needs a deliberate cast',
  );

  await db.delete(schema.profiles).where(eq(schema.profiles.publicId, BS_P));

  console.log(
    '✓ PROF-1 b-s: the owner conjunct holds where the TYPE cannot — a forged OwnerScope carrying ' +
      'role=member matches 0 rows, and ownerScope() refuses to mint one without a cast',
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// PROF-1 b — archive and restore, through the REAL writers.
//
// Ids `…04f0xx` are this block's range (#352's rule: say which range is yours, because a-r and b-s
// each reused another block's `public_id` and collided on the UNIQUE).
//
// 🔴 **What makes this block different from b-s's.** b-s proved the owner conjunct against a FORGED
// scope and hand-built its SELECT. This one drives `archiveProfile` and `restoreProfile` themselves,
// and the refusal it cares most about comes from a **legitimately-minted member of the same
// household** (`A_MEMBER_SCOPE`) — the actor the resolver hands every non-owner on every request.
// A forgery is a cast nobody writes; a member is Tuesday.
{
  const B_P = '019826b4-0000-7000-8000-00000004f001';
  const B_OTHER = '019826b4-0000-7000-8000-00000004f002';
  await db.insert(schema.profiles).values([
    { publicId: B_P, name: 'B Athlete', kind: PROFILE_KIND.kid, householdId: households[0].id },
    { publicId: B_OTHER, name: 'B Other', kind: PROFILE_KIND.kid, householdId: households[0].id },
  ]);

  const idOf = async (publicId: string) =>
    (
      await asPg
        .select({ id: schema.profiles.id })
        .from(schema.profiles)
        .where(eq(schema.profiles.publicId, publicId))
    )[0]?.id;

  const archivedAtOf = async (publicId: string) =>
    (
      await asPg
        .select({ archivedAt: schema.profiles.archivedAt })
        .from(schema.profiles)
        .where(eq(schema.profiles.publicId, publicId))
    )[0]?.archivedAt ?? null;

  // 🔴 **B_P's entry is inserted BEFORE the archive, and that ordering is the whole point.** The
  // first version asserted the export path with `Array.isArray(...)` on an athlete who had logged
  // nothing — always true, and true even if someone folded `archived_at` into `isLiveProfile` and
  // the query started returning `[]`. A confirmation reviewer called it the fifth vacuous test in
  // this PR, and `write-path.md` invariant 10 had already been written to cite it as proof.
  await asPg.insert(schema.entries).values({
    publicId: '019826b4-0000-7000-8000-00000004f0a1',
    clientId: '019826b4-0000-7000-8000-00000004f0a2',
    profileId: (await idOf(B_P))!,
    activityDate: '2026-07-18',
    kind: 'bodyweight',
    unit: 'lb',
    valueNum: '101',
    activityTypeId: await activityTypeIdByKey('weigh_in'),
    metricKey: SEED_METRIC_KEYS.bodyweight,
  });

  const owner = ownerScope(A_SCOPE);
  assert.ok(
    owner,
    'PROF-1 b: A_SCOPE is the owner, so it narrows (the baseline for everything below)',
  );

  // (1) The happy path: the owner archives, and the column carries a date.
  const archived = await archiveProfile(asPg, owner, B_P);
  assert.equal(archived?.publicId, B_P, 'PROF-1 b: the owner archives their own athlete');
  assert.ok(
    archived?.archivedAt instanceof Date,
    'PROF-1 b: …and archived_at is a real timestamp, not null — the RETURNING proves the column was ' +
      'written rather than the row merely matched',
  );

  // (2) 🔴 REPLAY KEEPS THE FIRST DATE. One row matches either way, so the row count cannot tell a
  // replay from a first archive — only the date can. An offline flush or a double tap on the gym
  // floor must not rewrite when an athlete stopped training.
  // 🔴 **The stored date is PINNED to a fixed past value first, and that is the difference between a
  // proof and a coin flip.** The first version archived, immediately re-archived, and compared the
  // two `Date`s. A review lens ran it with `COALESCE` removed: **green in 2 of 3 runs**, because the
  // replay lands ~0.3ms later and JS `Date` carries milliseconds — two distinct `now()` values inside
  // one millisecond compare equal. Only a run that happened to cross a millisecond boundary went red.
  // A fixed stored value cannot be reproduced by `now()`, so this is sensitive on every run, and
  // mutation patch `18` holds it to that.
  const PINNED = new Date('2026-01-01T00:00:00.000Z');
  await asPg
    .update(schema.profiles)
    .set({ archivedAt: PINNED })
    .where(eq(schema.profiles.publicId, B_P));
  const replayed = await archiveProfile(asPg, owner, B_P);
  assert.equal(
    replayed?.publicId,
    B_P,
    'PROF-1 b: archiving an already-archived athlete still matches the row',
  );
  assert.deepEqual(
    await archivedAtOf(B_P),
    PINNED,
    'PROF-1 b: …and COALESCE kept the EXISTING archived_at — a replay must not move the date',
  );

  // (3) 🔴 A MEMBER OF THE SAME HOUSEHOLD ARCHIVES NOTHING. The case the whole authority split is
  // for, and the one b-s could only model with a forgery. `A_MEMBER_SCOPE` is minted the same way
  // every real request's scope is; `ownerScope()` refuses it, so reaching the writer needs the cast
  // below — and the predicate then matches 0 rows anyway.
  assert.equal(
    ownerScope(A_MEMBER_SCOPE),
    null,
    'PROF-1 b: a MEMBER scope does not narrow — the compile-time half of the authority',
  );
  assert.equal(
    await archiveProfile(asPg, A_MEMBER_SCOPE as unknown as OwnerScope, B_OTHER),
    null,
    'PROF-1 b: a MEMBER of the SAME household archives 0 rows even when cast past ownerScope() — ' +
      'the lost narrowing fails CLOSED',
  );
  assert.equal(
    await archivedAtOf(B_OTHER),
    null,
    'PROF-1 b: …and the other athlete in that household is untouched, so the refusal was a no-op',
  );

  // (4) The other household's owner archives nothing either — the tenancy half, unchanged.
  const bOwner = ownerScope(B_SCOPE);
  assert.ok(
    bOwner,
    'PROF-1 b: B_SCOPE narrows too (or the next assertion passes for the wrong reason)',
  );
  assert.equal(
    await archiveProfile(asPg, bOwner, B_P),
    null,
    "PROF-1 b: household B's OWNER cannot archive household A's athlete",
  );

  // (5) 🔴 AN ARCHIVED ATHLETE IS NOT HIDDEN FROM THE OWNERSHIP SEAM (criterion 5). `archived_at` is
  // deliberately absent from `isLiveProfile`, so the row still resolves, still renames and still
  // exports. If this goes red, someone folded archive into the ownership predicate and an archived
  // athlete's history just became unreachable.
  assert.ok(
    await renameProfile(asPg, A_SCOPE, B_P, 'B Athlete Renamed'),
    'PROF-1 b: an ARCHIVED athlete is still renameable — archive is not a lock',
  );
  assert.deepEqual(
    await loggedMonths(asPg, { profilePublicId: B_P, scope: A_SCOPE }),
    [{ month: '2026-07' }],
    'PROF-1 b: …and the export path still returns an ARCHIVED athlete’s months (criterion 5) — the ' +
      'month this athlete logged, not merely "an array": fold archived_at into isLiveProfile and ' +
      'this returns [] while an Array.isArray check would stay green',
  );

  // (6) RESTORE IS ANY-MEMBER (decision M1). The member who could not archive CAN restore, with no
  // cast and no narrowing — the signature is the permission.
  const restored = await restoreProfile(asPg, A_MEMBER_SCOPE, B_P);
  assert.equal(
    restored?.publicId,
    B_P,
    'PROF-1 b: a MEMBER restores — the recovery action needs no owner',
  );
  assert.equal(
    restored?.archivedAt,
    null,
    'PROF-1 b: …and archived_at is cleared, not merely matched',
  );

  // (7) Restoring a live athlete is a harmless no-op — the Undo path can fire twice.
  assert.ok(
    await restoreProfile(asPg, A_MEMBER_SCOPE, B_P),
    'PROF-1 b: restoring an already-live athlete is a no-op, not an error (Undo may replay)',
  );

  // (8) …and cross-household restore still refuses.
  assert.equal(
    await restoreProfile(asPg, B_SCOPE, B_P),
    null,
    "PROF-1 b: household B cannot restore household A's athlete",
  );

  // (9) 🔴 **`hasLiveEntries` returns the RIGHT VALUE, per profile.** Decision N3's control hangs on
  // it: `false` hides the export link and states a reason. The first version was an inline `sql`
  // template whose `profiles.id` reference drizzle STRIPPED to a bare `"id"` — binding it to
  // `entries.id` — so the predicate was "does any live entry have profile_id equal to its own id",
  // which in production (entry ids in the thousands, profile ids single-digit) is almost always
  // FALSE. Every archived athlete would have been told there was nothing to export, which is the
  // control the published notice promises. A type assertion cannot catch that — the column really is
  // a boolean — only two profiles in different entry states can.
  // B_P's LIVE entry already exists (inserted before the archive, so step 5 could assert the export
  // path on a real month). B_OTHER's only entry is SOFT-DELETED, so it must NOT count — the
  // `deleted_at` half of the predicate, which a correlation-only fix would have left unproved.
  await asPg.insert(schema.entries).values({
    publicId: '019826b4-0000-7000-8000-00000004f0b1',
    clientId: '019826b4-0000-7000-8000-00000004f0b2',
    profileId: (await idOf(B_OTHER))!,
    activityDate: '2026-07-18',
    kind: 'bodyweight',
    unit: 'lb',
    valueNum: '102',
    activityTypeId: await activityTypeIdByKey('weigh_in'),
    metricKey: SEED_METRIC_KEYS.bodyweight,
    deletedAt: new Date(),
  });
  const hasHistoryBy = Object.fromEntries(
    (await householdProfileRows(asPg, { scope: A_SCOPE })).map((r) => [r.publicId, r.hasEntries]),
  );
  assert.equal(
    hasHistoryBy[B_P],
    true,
    'PROF-1 b: an athlete with a LIVE entry has history — hasLiveEntries is correlated to THIS profile',
  );
  assert.equal(
    hasHistoryBy[B_OTHER],
    false,
    'PROF-1 b: …and one whose only entry is SOFT-DELETED does not, so the export control states a ' +
      'reason instead of handing back an empty zip (decision N3)',
  );

  await asPg
    .delete(schema.entries)
    .where(
      inArray(schema.entries.publicId, [
        '019826b4-0000-7000-8000-00000004f0a1',
        '019826b4-0000-7000-8000-00000004f0b1',
      ]),
    );
  await db.delete(schema.profiles).where(inArray(schema.profiles.publicId, [B_P, B_OTHER]));

  console.log(
    '✓ PROF-1 b: archive and restore through the real writers — the owner archives and a REPLAY ' +
      'keeps the first date, a legitimately-minted MEMBER of the same household archives 0 rows ' +
      '(cast or not) while the same member RESTORES, the other household refuses both directions, ' +
      'an archived athlete still renames and still exports, and hasLiveEntries is CORRELATED — a ' +
      'live entry counts, a soft-deleted one does not',
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// PROF-1 a-1w — createProfile: replay-first, scoped on BOTH reads, and capped.
//
// 🔴 **THE ASSERTION THIS BLOCK EXISTS FOR IS THE RETURNED VALUE, NOT A ROW COUNT.**
// `uq_profiles_client_id` is global and non-partial, so household B CAN replay a key A already used.
// If the scoped read loses `inHousehold`, B gets back **A's `public_id`** — which the action then
// redirects B to, putting a cross-household identifier in the other household's URL bar. **B still
// gains no row**, so the obvious proof ("B's count is 0") stays GREEN on the leak. The plan shipped
// with exactly that assertion and nothing else; a security lens found it before any code existed.
{
  // Ids `…045xxx` are THIS block's range — `4e0xx` belongs to b-s and `4f0xx` to b (#352's rule).
  // (`045xxx`, not `0450xx`: the fill keys are `451xx` and the overflow key `45999`.)
  // ⚠️ The first version wrote `…04g001` and `.replace('g','e')`'d it, which is not hex and resolved
  // byte-for-byte onto b-s's `BS_P`. A review lens caught it; the clever substitution is what hid it.
  const A_KEY = '019826b4-0000-7000-8000-000000045001';
  const countIn = async (hhId: number) =>
    (
      await asPg
        .select({ id: schema.profiles.id })
        .from(schema.profiles)
        .where(and(eq(schema.profiles.householdId, hhId), isNull(schema.profiles.deletedAt)))
    ).length;

  const nameFor = async (publicId: string) =>
    (
      await asPg
        .select({ name: schema.profiles.name })
        .from(schema.profiles)
        .where(eq(schema.profiles.publicId, publicId))
    )[0]?.name;

  const aBefore = await countIn(households[0].id);
  const bBefore = await countIn(verifyHh.id);

  // (1) The happy path lands in A, and the id that comes back is A's row.
  const created = await createProfile(asPg, A_SCOPE, {
    name: 'A-1 Athlete',
    kind: PROFILE_KIND.kid,
    clientId: A_KEY,
  });
  assert.ok(created.ok, 'PROF-1 a-1w: an athlete is created');
  const createdId = created.ok ? created.publicId : '';
  assert.equal(
    (
      await asPg
        .select({ hh: schema.profiles.householdId })
        .from(schema.profiles)
        .where(eq(schema.profiles.publicId, createdId))
    )[0]?.hh,
    households[0].id,
    'PROF-1 a-1w: …and the RETURNED public_id belongs to a row in the creating household',
  );
  assert.equal(
    await countIn(households[0].id),
    aBefore + 1,
    'PROF-1 a-1w: exactly one row appeared',
  );

  // (2) Replay. The same key returns the SAME id and mints nothing — a double tap, a replayed
  // pre-hydration POST and an offline flush all arrive this way.
  const replayed = await createProfile(asPg, A_SCOPE, {
    name: 'A-1 Athlete Again',
    kind: PROFILE_KIND.adult,
    clientId: A_KEY,
  });
  assert.deepEqual(
    replayed,
    { ok: true, publicId: createdId },
    'PROF-1 a-1w: a REPLAY returns the first row, not a twin — and ignores the new name and kind',
  );
  assert.equal(await countIn(households[0].id), aBefore + 1, 'PROF-1 a-1w: …and still one row');

  // (3) A replay still resolves after the athlete is ARCHIVED — archive is not a delete, and the
  // key is not freed by it.
  const owner = ownerScope(A_SCOPE);
  assert.ok(owner, 'PROF-1 a-1w: A_SCOPE narrows (or the archive below proves nothing)');
  const archivedRow = await archiveProfile(asPg, owner, createdId);
  // ⚠️ **Assert the archive LANDED.** `archiveProfile` returns `null` on 0 rows, so if its predicate
  // ever refused here the replay assertion below would pass against an un-archived row and prove the
  // claim it names for nothing.
  assert.ok(
    archivedRow?.archivedAt instanceof Date,
    'PROF-1 a-1w: the athlete really is archived before the replay below',
  );
  assert.deepEqual(
    await createProfile(asPg, A_SCOPE, {
      name: 'A-1 Athlete',
      kind: PROFILE_KIND.kid,
      clientId: A_KEY,
    }),
    { ok: true, publicId: createdId },
    'PROF-1 a-1w: a replay AFTER archiving still returns the same row',
  );

  // (4) 🔴 THE CROSS-HOUSEHOLD CASE. B replays A's key. Both halves are asserted, and the first is
  // the one a row count cannot make.
  const bResult = await createProfile(asPg, B_SCOPE, {
    name: 'B Tries A’s Key',
    kind: PROFILE_KIND.kid,
    clientId: A_KEY,
  });
  assert.deepEqual(
    bResult,
    { ok: false, reason: 'refused' },
    'PROF-1 a-1w: household B replaying A’s client_id is REFUSED — and is never handed A’s ' +
      'public_id, which is the leak a row count cannot see',
  );
  assert.equal(await countIn(verifyHh.id), bBefore, 'PROF-1 a-1w: …and B gains no row either');
  // 🔴 …and A's ROW IS UNTOUCHED. The conflict path is the one place B's request reaches A's row at
  // all: `DO UPDATE SET name` — the obvious "touch it on replay" refactor — would let B **rewrite**
  // A's athlete through it, with every scoped read still intact and the returned value still
  // `refused`. Mutation patch `21` makes that edit and this is the assertion that catches it.
  assert.equal(
    await nameFor(createdId),
    'A-1 Athlete',
    'PROF-1 a-1w: …and A’s row is UNCHANGED — B’s replay cannot write through the conflict path',
  );

  // (5) The quota. Fill B to the cap, then one more.
  const capKeys: string[] = [];
  const capIds = new Map<string, string>();
  for (let i = await countIn(verifyHh.id); i < MAX_HOUSEHOLD_ATHLETES; i += 1) {
    // `451xx`, inside this block's `045xxx` range — `45000 + i` would collide with `A_KEY`.
    const key = `019826b4-0000-7000-8000-0000000${String(45100 + i).padStart(5, '0')}`;
    capKeys.push(key);
    const r = await createProfile(asPg, B_SCOPE, {
      name: `Filler ${i}`,
      kind: PROFILE_KIND.kid,
      clientId: key,
    });
    assert.ok(r.ok, `PROF-1 a-1w: filling to the cap succeeds at ${i}`);
    capIds.set(key, r.publicId);
  }
  assert.equal(await countIn(verifyHh.id), MAX_HOUSEHOLD_ATHLETES, 'PROF-1 a-1w: B is at the cap');

  // 🔴 **ARCHIVED ROWS HOLD THEIR SLOT**, which `countProfilesIn`'s docblock claims and nothing
  // proved. Archive one of B's fillers and the 26th must STILL be refused — otherwise the cap is
  // bypassable by archiving in a loop, which is the exact bypass that docblock says is closed.
  const bOwner = ownerScope(B_SCOPE);
  assert.ok(bOwner, 'PROF-1 a-1w: B_SCOPE narrows (or the archive below proves nothing)');
  // ⚠️ The id comes from the FILL LOOP's own return value, never from `profileByClientId` — that
  // function is half the boundary under test here, so resolving the fixture through it would make
  // the archive step agree with whatever it does. Same rule the replay assertion below states.
  const archivedFillerId = capIds.get(capKeys[1]!);
  assert.ok(archivedFillerId, 'PROF-1 a-1w: the filler to archive exists');
  assert.ok(
    (await archiveProfile(asPg, bOwner, archivedFillerId))?.archivedAt instanceof Date,
    'PROF-1 a-1w: …and it really is archived',
  );

  const overflowKey = '019826b4-0000-7000-8000-000000045999';
  assert.deepEqual(
    await createProfile(asPg, B_SCOPE, {
      name: 'One Too Many',
      kind: PROFILE_KIND.kid,
      clientId: overflowKey,
    }),
    { ok: false, reason: 'full' },
    `PROF-1 a-1w: the ${MAX_HOUSEHOLD_ATHLETES + 1}th athlete is refused as FULL even though one of ` +
      'the 25 is ARCHIVED — archiving does not free a slot, or the cap is a loop away from useless',
  );
  assert.equal(
    await countIn(verifyHh.id),
    MAX_HOUSEHOLD_ATHLETES,
    'PROF-1 a-1w: …and no row appeared',
  );

  // 🔴 A REPLAY AT THE CAP STILL SUCCEEDS. The quota is checked after the replay lookup precisely so
  // a retry on a flaky connection is not refused for creating nothing.
  assert.deepEqual(
    await createProfile(asPg, B_SCOPE, {
      name: 'Filler 0',
      kind: PROFILE_KIND.kid,
      clientId: capKeys[0]!,
    }),
    // ⚠️ The expected id is the one the FILL returned, not one recomputed with the code under test.
    { ok: true, publicId: capIds.get(capKeys[0]!)! },
    'PROF-1 a-1w: a REPLAY at the cap still returns its row — the quota gates creation, not retries',
  );

  await asPg.delete(schema.profiles).where(inArray(schema.profiles.clientId, [A_KEY, ...capKeys]));

  console.log(
    '✓ PROF-1 a-1w: createProfile is replay-first and scoped on BOTH reads — a replay returns the ' +
      'first row (even once archived) and mints nothing, household B replaying A’s key is REFUSED ' +
      'and is never handed A’s public_id, and the per-household cap refuses the ' +
      `${MAX_HOUSEHOLD_ATHLETES + 1}th while still honouring a replay at the cap`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// PROF-1 a-1d — the duplicate-name warning: advisory, scoped, archived-aware, and NULL-key-safe.
//
// Ids `…046xxx` are THIS block's range (#352's rule); `045xxx` belongs to a-1w.
{
  const D = (n: string) => `019826b4-0000-7000-8000-0000000460${n}`;
  const nameOf = async (publicId: string) =>
    (
      await asPg
        .select({ name: schema.profiles.name })
        .from(schema.profiles)
        .where(eq(schema.profiles.publicId, publicId))
    )[0]?.name ?? null;

  // ── A live twin warns, and the warning carries the STORED spelling and kind ────────────────────
  const adaKey = D('01');
  const ada = await createProfile(asPg, A_SCOPE, {
    name: 'Ada',
    kind: PROFILE_KIND.kid,
    clientId: adaKey,
  });
  assert.ok(ada.ok, 'PROF-1 a-1d: the first Ada is created');

  const dup = await createProfile(asPg, A_SCOPE, {
    name: 'ada',
    kind: PROFILE_KIND.kid,
    clientId: D('02'),
  });
  assert.deepEqual(
    dup,
    {
      ok: false,
      reason: 'duplicate',
      match: { publicId: ada.publicId, name: 'Ada', kind: PROFILE_KIND.kid, archived: false },
      atCap: false,
    },
    'PROF-1 a-1d: a name that FOLDS equal warns, and returns the stored spelling, kind and id',
  );

  // ── 🔴 THE REGRESSION D2 EXISTS FOR: a replay of a SUCCESSFUL add is never "duplicate" ─────────
  assert.deepEqual(
    await createProfile(asPg, A_SCOPE, {
      name: 'Ada',
      kind: PROFILE_KIND.kid,
      clientId: adaKey,
    }),
    { ok: true, publicId: ada.publicId },
    'PROF-1 a-1d: a replay of a successful add returns ok with the SAME id, never duplicate — the ' +
      'client_id lookup runs before the fold',
  );

  // ── 🔴 C2: a match whose client_id is NULL must still warn ─────────────────────────────────────
  // Every athlete that predates a-1w has a NULL key — the seed writes none and 0020 backfilled
  // nothing. Written with a bare `ne()` the exclusion drops these rows and the feature is DEAD for
  // every household that exists, while every fixture built through createProfile still passes.
  const legacyId = D('03');
  await asPg.insert(schema.profiles).values({
    publicId: legacyId,
    name: 'Bea',
    kind: PROFILE_KIND.kid,
    householdId: households[0].id,
  });
  assert.equal(
    (
      (await createProfile(asPg, A_SCOPE, {
        name: 'bea',
        kind: PROFILE_KIND.kid,
        clientId: D('04'),
      })) as { reason?: string }
    ).reason,
    'duplicate',
    'PROF-1 a-1d: a LEGACY athlete with a NULL client_id still warns — the exclusion is null-safe',
  );

  // ── The acknowledgement skips the check, but only for the name it was issued for ───────────────
  assert.equal(
    (
      (await createProfile(asPg, A_SCOPE, {
        name: 'ada',
        kind: PROFILE_KIND.kid,
        clientId: D('05'),
        acknowledgedDuplicate: foldName('Bea'),
      })) as { reason?: string }
    ).reason,
    'duplicate',
    'PROF-1 a-1d: an acknowledgement for a DIFFERENT folded name does not wave this one through',
  );

  const acked = await createProfile(asPg, A_SCOPE, {
    name: 'ada',
    kind: PROFILE_KIND.kid,
    clientId: D('06'),
    acknowledgedDuplicate: foldName('ada'),
  });
  assert.ok(
    acked.ok,
    'PROF-1 a-1d: an acknowledgement matching the folded name really does insert the second Ada',
  );

  // ── 🔴 THE ORDERING, which only a SECOND same-name athlete can discriminate ───────────────────
  // With one Ada in the household, moving the fold above the replay lookup changes nothing — the
  // exclusion removes the caller's own row, so the fold finds nothing either way. That is why the
  // first attempt at a "fold before replay" patch stayed green. Once the acknowledged second Ada
  // exists, a replay of the FIRST Ada's key has a match the exclusion cannot remove, so the order is
  // the only thing keeping it an `ok`. This is also the real regression D2 names: a replay after a
  // cousin of the same name was added.
  assert.deepEqual(
    await createProfile(asPg, A_SCOPE, {
      name: 'Ada',
      kind: PROFILE_KIND.kid,
      clientId: adaKey,
    }),
    { ok: true, publicId: ada.publicId },
    'PROF-1 a-1d: a replay still returns ok once a SECOND Ada exists — the replay lookup runs ' +
      'before the fold, and here the exclusion cannot rescue it',
  );

  // ── Cross-household: B adding a name A holds must NOT warn (the oracle patch 26 attacks) ──────
  assert.equal(
    (
      (await createProfile(asPg, B_SCOPE, {
        name: 'Ada',
        kind: PROFILE_KIND.kid,
        clientId: D('07'),
      })) as { reason?: string }
    ).reason ?? 'ok',
    'ok',
    'PROF-1 a-1d: household B adding a name household A holds is NOT warned — the fold read is ' +
      'scoped, and an unscoped one is a cross-household oracle on athlete names',
  );

  // ── An ARCHIVED twin warns, with archived: true, so the UI can offer Restore ───────────────────
  const zoeKey = D('08');
  const zoe = await createProfile(asPg, A_SCOPE, {
    name: 'Zoë',
    kind: PROFILE_KIND.adult,
    clientId: zoeKey,
  });
  assert.ok(zoe.ok, 'PROF-1 a-1d: Zoë is created');
  const aOwner = ownerScope(A_SCOPE);
  assert.ok(aOwner, 'PROF-1 a-1d: A_SCOPE narrows (or the archive below proves nothing)');
  await archiveProfile(asPg, aOwner, zoe.publicId);

  assert.deepEqual(
    await createProfile(asPg, A_SCOPE, {
      name: 'zoe',
      kind: PROFILE_KIND.adult,
      clientId: D('09'),
    }),
    {
      ok: false,
      reason: 'duplicate',
      match: { publicId: zoe.publicId, name: 'Zoë', kind: PROFILE_KIND.adult, archived: true },
      atCap: false,
    },
    'PROF-1 a-1d: an ARCHIVED Zoë matches zoe and reports archived:true — otherwise Restore is ' +
      'unreachable and the parent is told to add a second one',
  );
  assert.equal(
    await nameOf(zoe.publicId),
    'Zoë',
    'PROF-1 a-1d: …and the match carries the STORED spelling, so Restore cannot relabel her',
  );

  // ── Live beats archived when both match ───────────────────────────────────────────────────────
  const liveZoe = await createProfile(asPg, A_SCOPE, {
    name: 'Zoe',
    kind: PROFILE_KIND.adult,
    clientId: D('0a'),
    acknowledgedDuplicate: foldName('Zoe'),
  });
  assert.ok(liveZoe.ok, 'PROF-1 a-1d: a live Zoe is added alongside the archived Zoë');
  assert.deepEqual(
    (
      (await createProfile(asPg, A_SCOPE, {
        name: 'zoë',
        kind: PROFILE_KIND.adult,
        clientId: D('0b'),
      })) as { match?: { publicId: string; archived: boolean } }
    ).match,
    { publicId: liveZoe.publicId, name: 'Zoe', kind: PROFILE_KIND.adult, archived: false },
    'PROF-1 a-1d: with a live AND an archived match, the LIVE one wins — offering Restore for ' +
      'somebody already on the picker is the worse answer',
  );

  // ── 🔴 `atCap` — the flag the whole duplicate-before-quota decision rests on ───────────────────
  // Nothing asserted it TRUE before this. Fill B to the cap, archive one, then add that name: the
  // warning must still arrive (so Restore stays reachable for a full household, which is the entire
  // reason the fold runs before the quota) AND it must say the household is full, so the screen can
  // hide "Add another" rather than offering a button the endpoint answers `full` to.
  /** This block's own live count — `countIn` above is scoped to the a-1w block. */
  const liveIn = async (hhId: number) =>
    (
      await asPg
        .select({ id: schema.profiles.id })
        .from(schema.profiles)
        .where(and(eq(schema.profiles.householdId, hhId), isNull(schema.profiles.deletedAt)))
    ).length;

  const capKeys2: string[] = [];
  // ⚠️ The loop starts at the household's CURRENT count, so the first row it makes is not
  // `Capfill 0` — capture whichever one it actually created first.
  let firstFillName = '';
  for (let i = await liveIn(verifyHh.id); i < MAX_HOUSEHOLD_ATHLETES; i += 1) {
    const key = `019826b4-0000-7000-8000-0000000${String(46200 + i).padStart(5, '0')}`;
    capKeys2.push(key);
    const fillName = `Capfill ${i}`;
    if (!firstFillName) firstFillName = fillName;
    const r = await createProfile(asPg, B_SCOPE, {
      name: fillName,
      kind: PROFILE_KIND.kid,
      clientId: key,
    });
    assert.ok(r.ok, `PROF-1 a-1d: filling B to the cap succeeds at ${i}`);
  }
  assert.ok(firstFillName, 'PROF-1 a-1d: the cap fill created at least one athlete to archive');
  const bOwner2 = ownerScope(B_SCOPE);
  assert.ok(bOwner2, 'PROF-1 a-1d: B_SCOPE narrows');
  const archivedAtCap = await findNameMatch(asPg, B_SCOPE, foldName(firstFillName));
  assert.ok(archivedAtCap, 'PROF-1 a-1d: the filler to archive exists');
  await archiveProfile(asPg, bOwner2, archivedAtCap.publicId);

  assert.deepEqual(
    await createProfile(asPg, B_SCOPE, {
      name: firstFillName,
      kind: PROFILE_KIND.kid,
      clientId: `019826b4-0000-7000-8000-000000046999`,
    }),
    {
      ok: false,
      reason: 'duplicate',
      match: {
        publicId: archivedAtCap.publicId,
        name: firstFillName,
        kind: PROFILE_KIND.kid,
        archived: true,
      },
      atCap: true,
    },
    'PROF-1 a-1d: a FULL household still gets the duplicate warning for an archived twin, with ' +
      'atCap TRUE — the fold runs before the quota precisely so Restore stays reachable, and the ' +
      'flag is what stops the screen offering an Add the endpoint would refuse',
  );

  assert.equal(
    (
      (await createProfile(asPg, B_SCOPE, {
        name: firstFillName,
        kind: PROFILE_KIND.kid,
        clientId: `019826b4-0000-7000-8000-000000046998`,
        acknowledgedDuplicate: foldName(firstFillName),
      })) as { reason?: string }
    ).reason,
    'full',
    'PROF-1 a-1d: …and acknowledging it at the cap answers FULL — the quota still gates creation',
  );

  await asPg.delete(schema.profiles).where(inArray(schema.profiles.clientId, capKeys2));

  // ── Several live matches: the warning names the FIRST Ada ─────────────────────────────────────
  // Two live cousins both named Ada is the DESIGNED case — "Add another" exists for it — so a third
  // Ada must be warned about a STABLE one, or "Open Ada" points at a different cousin between two
  // submits.
  //
  // ⚠️ **This asserts the CONTRACT, and it does NOT prove `orderBy(asc(id))` is load-bearing.**
  // Deleting that clause leaves this green: on PGlite the scan returns these rows in insertion
  // order anyway, and an UPDATE between them did not reliably move the tuple far enough to flip it.
  // 🔴 An earlier version of this comment claimed the clause was "probed by reversing the sort to
  // `desc`" — that only shows the assertion READS the sort, never that the sort is needed, which is
  // the same mistake twice over in this chunk. The clause stays because determinism should be a
  // contract rather than a property of today's heap, and it is cheap; what does not stay is a claim
  // that a test pins it.
  assert.deepEqual(
    (
      (await createProfile(asPg, A_SCOPE, {
        name: 'Ada',
        kind: PROFILE_KIND.kid,
        clientId: D('0d'),
      })) as { match?: { publicId: string } }
    ).match?.publicId,
    ada.publicId,
    'PROF-1 a-1d: with TWO live Adas, the warning names the FIRST one — the match is ordered by ' +
      'id, not by whatever order the heap happens to return',
  );

  // ── A soft-deleted twin does not warn ─────────────────────────────────────────────────────────
  await asPg
    .update(schema.profiles)
    .set({ deletedAt: new Date() })
    .where(eq(schema.profiles.publicId, legacyId));
  assert.equal(
    (
      (await createProfile(asPg, A_SCOPE, {
        name: 'Bea',
        kind: PROFILE_KIND.kid,
        clientId: D('0c'),
      })) as { reason?: string }
    ).reason ?? 'ok',
    'ok',
    'PROF-1 a-1d: a SOFT-DELETED twin does not warn — deleted is gone, unlike archived',
  );

  await asPg
    .delete(schema.profiles)
    .where(
      inArray(schema.profiles.publicId, [ada.publicId, zoe.publicId, liveZoe.publicId, legacyId]),
    );
  await asPg
    .delete(schema.profiles)
    .where(inArray(schema.profiles.clientId, [D('06'), D('07'), D('0c')]));

  console.log(
    '✓ PROF-1 a-1d: the duplicate warning folds names, is scoped to the household, survives a ' +
      'NULL client_id, reports archived matches so Restore is reachable, prefers a live match ' +
      'over an archived one, and never answers duplicate to a replay of a successful add',
  );
}

// ── V1-9b B0 — a hide no longer frees a `client_id` ───────────────────────────────────────────────
//
// 🔴 **The behavioural case comes FIRST, deliberately.** `db:verify` is fail-fast and the mutation
// runner matches the FIRST AssertionError, so a structural `pg_indexes` check placed above would be
// the assertion a mutation reddens — and "the index has no WHERE" is a restatement of the DDL, not
// of the behaviour anyone depends on. The behaviour is: a replay of a write whose row was hidden
// must NOT create a twin.
//
// Before B0 every one of the five arbiters was `WHERE deleted_at IS NULL`, so a soft-deleted row
// left the index, stopped being an `ON CONFLICT` target, and a replay INSERTED A SECOND ROW
// (ADR 0008 decision 3.4, `docs/decisions/0008-deletion.md:127`). V1-9b makes hiding a reachable
// action, which turns that from latent into live.
//
// ⚠️ **What a pass here proves, and the one thing it does not.** It proves the twin is impossible
// and that the live-row re-select refuses rather than attaching children to a dead row. It does NOT
// prove the app reports that refusal well — `B1-2` owns the envelope; today it is a throw.
{
  const B0_SESSION_CID = '019826b4-0000-7000-8000-00000000b000';
  const b0Args = {
    ...flatArgs,
    day: '2026-02-11',
    sessionClientId: B0_SESSION_CID,
    movements: [
      {
        movementName: 'Bench Press',
        unit: 'lb',
        movementId: movY.id,
        clientId: '019826b4-0000-7000-8000-00000000b001',
        sets: [{ reps: 8, weight: 95 }],
      },
    ],
  } as const;

  // 1 · Log it, then HIDE the entry the way V1-9b will: `deleted_at` on the row, nothing else.
  const b0 = await writeStrengthSession(asPg, b0Args);
  const [b0Session] = await db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(eq(schema.sessions.publicId, b0.sessionId));
  await db
    .update(schema.entries)
    .set({ deletedAt: new Date() })
    .where(eq(schema.entries.clientId, b0Args.movements[0].clientId));

  // 2 · Replay the SAME graph. The hidden entry is still in the (now non-partial) index, so the
  //     insert no-ops on conflict and the live re-select finds nothing — a refusal, not a twin.
  //     🔴 This is the assertion the mutation patch reddens: with the predicate back, the insert
  //     succeeds and this `rejects` never fires.
  await assert.rejects(
    () => writeStrengthSession(asPg, b0Args),
    /no live row for client_id/,
    'V1-9b B0: replaying a HIDDEN strength entry is refused, not duplicated — the hide no longer ' +
      'frees the client_id',
  );

  // 3 · And the count is the direct evidence: ONE row carries that client_id, hidden or not.
  const b0Rows = await db
    .select({ id: schema.entries.id, deletedAt: schema.entries.deletedAt })
    .from(schema.entries)
    .where(eq(schema.entries.clientId, b0Args.movements[0].clientId));
  assert.equal(b0Rows.length, 1, 'V1-9b B0: the hidden entry was not twinned by the replay');
  assert.ok(b0Rows[0].deletedAt !== null, 'V1-9b B0: …and it is still hidden');

  // 4 · The session row itself: same client_id, still one row, and the replay reached it. (The
  //     session was never hidden, so this is the ordinary replay path — it must keep working.)
  const b0Sessions = await db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(eq(schema.sessions.clientId, B0_SESSION_CID));
  assert.equal(b0Sessions.length, 1, 'V1-9b B0: the session was not twinned either');
  assert.equal(b0Sessions[0].id, b0Session.id, 'V1-9b B0: and it is the same session row');

  // 4b · 🔴 **The OTHER writer B0 changes, which the strength case cannot reach.**
  //      `insertBodyweightEntry` infers no target (`onConflictDoNothing()` — every unique
  //      arbitrates, V1-24 1e), so it has its own three-branch fallback. Post-B0 a replay of a
  //      HIDDEN weigh-in whose day slot has since been freed conflicts on the non-partial
  //      `uq_entries_client_id`, misses (a) because that row is not live, misses (b) because the day
  //      is free, and lands on the throw in (c). **Before B0 it inserted a twin** — the same defect,
  //      through the one writer with no arbiter to re-predicate.
  //
  //      ⚠️ **What this case is and is NOT proven by, probed three ways.** 1e reaches (c) by two
  //      other routes (a foreign metric's `client_id`, an evening-only day), and because `db:verify`
  //      is fail-fast and 1e runs first, every single-literal mutation that breaks this case breaks
  //      an earlier one too: restoring the index predicate reddens the strength case above;
  //      dropping (a)'s liveness guard reddens 1e's dead-row case; swallowing the (c) throw reddens
  //      1e's foreign-metric case. So this case is **not independently isolable today** — said
  //      plainly rather than implied.
  //
  //      What it does catch, and nothing else would: a future change that answers THIS route
  //      plausibly while leaving 1e's routes throwing — a fourth branch that looks up hidden rows
  //      and returns one's id, say, which is the exact "success reported, nothing saved" shape (a)'s
  //      liveness guard exists to prevent. It also pins the no-twin count for a writer the strength
  //      case never touches.
  // ⚠️ Ids in the `0000b9b0…` region because `…b0XX` is MINTED BY A GENERATOR elsewhere in this
  //    file: the first draft reused `…00000000b010`, which a pushups entry already held, and the
  //    target-less `DO NOTHING` swallowed that `public_id` conflict straight into the (c) throw —
  //    presenting as "the writer refuses a fresh weigh-in", which reads like a product bug. Pick a
  //    region, do not pick a number.
  const B0_BW_DAY = '2026-12-02';
  const b0WeighInType = await activityTypeIdByKey(SEED_ACTIVITY_TYPE_KEYS.weighIn);
  const b0BwArgs = {
    profileId: bwOwnerRow.id,
    unit: 'lb',
    notes: null,
    activityTypeId: b0WeighInType,
    kind: ENTRY_KIND.bodyweight,
    publicId: '019826b4-0000-7000-8000-0000b9b00001',
    clientId: '019826b4-0000-7000-8000-0000b9b00002',
    day: B0_BW_DAY,
    value: 81,
  };
  await insertBodyweightEntry(asPg, b0BwArgs);
  await db
    .update(schema.entries)
    .set({ deletedAt: new Date() })
    .where(eq(schema.entries.clientId, b0BwArgs.clientId));
  await assert.rejects(
    () =>
      insertBodyweightEntry(asPg, {
        ...b0BwArgs,
        publicId: '019826b4-0000-7000-8000-0000b9b00003',
      }),
    /a replay of a HIDDEN weigh-in whose day is now free/,
    'V1-9b B0: replaying a HIDDEN weigh-in onto its now-free day is REFUSED, not duplicated',
  );
  const b0BwRows = await db
    .select({ id: schema.entries.id })
    .from(schema.entries)
    .where(
      and(
        eq(schema.entries.profileId, bwOwnerRow.id),
        eq(schema.entries.activityDate, B0_BW_DAY),
        eq(schema.entries.metricKey, SEED_METRIC_KEYS.bodyweight),
      ),
    );
  assert.equal(b0BwRows.length, 1, 'V1-9b B0: …and the hidden weigh-in was not twinned');

  // 5 · The STRUCTURAL case, after the behaviour: none of the five indexes carries a predicate.
  //     Read from `pg_indexes`, so it measures the LIVE schema the migration produced rather than
  //     the TypeScript that generated it — the drift this would otherwise miss is a migration that
  //     was hand-edited after `generate`.
  const B0_INDEXES = [
    'uq_sessions_client_id',
    'uq_supersets_client_id',
    'uq_entries_client_id',
    'uq_entry_sets_client_id',
    'uq_entry_set_quantities_client_id',
  ] as const;
  const b0Defs = await db.execute<{ indexname: string; indexdef: string }>(
    sql`select indexname, indexdef from pg_indexes where indexname = any(${sql.param(
      B0_INDEXES as unknown as string[],
    )}::text[])`,
  );
  const b0Found = (b0Defs as unknown as { rows: { indexname: string; indexdef: string }[] }).rows;
  assert.equal(
    b0Found.length,
    B0_INDEXES.length,
    `V1-9b B0: all five client_id indexes exist (found ${b0Found.length})`,
  );
  for (const row of b0Found) {
    assert.ok(
      !/\bWHERE\b/i.test(row.indexdef),
      `V1-9b B0: ${row.indexname} is non-partial — it carries no WHERE (${row.indexdef})`,
    );
  }

  // 6 · …and FOUR of the arbiters that stay partial, so the structural case cannot be "passed" by
  //     dropping every predicate in the schema. A hide SHOULD free a slot; it should not free an
  //     identity, and that asymmetry is the whole decision.
  //
  //     ⚠️ **Four of TEN, and the comment used to say nine.** Counted off `0021_snapshot.json`:
  //     twelve partial unique indexes, ten of them on `deleted_at` (the ten below plus
  //     `uq_household_members_clerk_user`, which is a one-live-membership constraint rather than a
  //     slot) and two on `movements.household_id`. The plan's enumeration listed nine because it
  //     predates the Clerk-user index. Four named here is enough to defeat "drop every predicate";
  //     asserting the full count would redden on every unrelated new partial index, which is a
  //     maintenance tax for a weaker signal.
  const b0Partial = await db.execute<{ indexname: string; indexdef: string }>(
    sql`select indexname, indexdef from pg_indexes
        where indexname in ('uq_entries_superset_order', 'uq_entry_sets_entry_idx',
                            'uq_entry_set_quantities_set_slot', 'uq_entries_profile_day_bodyweight')`,
  );
  const b0PartialRows = (
    b0Partial as unknown as { rows: { indexname: string; indexdef: string }[] }
  ).rows;
  assert.equal(b0PartialRows.length, 4, 'V1-9b B0: all four named slot arbiters are present');
  for (const row of b0PartialRows) {
    assert.ok(
      /\bWHERE\b/i.test(row.indexdef),
      `V1-9b B0: ${row.indexname} is STILL partial — a hide frees a slot (${row.indexname})`,
    );
  }

  console.log(
    '✓ V1-9b B0: a hide no longer frees a client_id — replaying a hidden entry is REFUSED rather ' +
      'than twinned, the five identity arbiters carry no predicate on the live schema, and the ' +
      'slot arbiters still do',
  );
}

console.log('✓ verify passed');
