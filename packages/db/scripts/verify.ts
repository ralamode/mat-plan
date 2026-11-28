import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ACTIVITY_TYPE_KEYS,
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
  HOUSEHOLD_DEFAULT_NAME,
  HOUSEHOLD_ROLE,
  HOUSEHOLD_ROLES,
  MAX_HOUSEHOLD_ATHLETES,
  METRIC_AGGREGATION,
  METRIC_AGGREGATIONS,
  METRIC_DEFINITION_SEED_ROWS,
  METRIC_KEYS,
  PRACTICE_UNIT,
  METRIC_VALUE_TYPES,
  MODALITY,
  MOVEMENT_PATTERNS,
  MOVEMENT_SEED_PUBLIC_IDS,
  MOVEMENT_SEED_ROWS,
  PROFILE_KIND,
  PROFILE_NAME_MAX,
  PROGRAM_BLOCK_KIND,
  LEGACY_PROGRAM_FIXTURE,
  QUANTITY_SLOT,
  QUANTITY_SLOT_ROWS,
  ROUTINE_VERSION,
  SEED_ACTIVITY_TYPE_KEYS,
  SEED_ACTIVITY_TYPE_SC_LIFT_PUBLIC_ID,
  SEED_ACTIVITY_TYPE_WEIGH_IN_PUBLIC_ID,
  SEED_METRIC_BODYWEIGHT_PUBLIC_ID,
  SEED_METRIC_KEYS,
  SEED_PUBLIC_ID_PREFIX,
  SEED_PUBLIC_IDS,
  SESSION_TYPES,
  UNITS,
  UNIT_CODES,
  UNIT_DIMENSION,
  UNIT_DIMENSIONS,
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
import { CATALOG_FIXTURE } from '@mat-plan/shared/catalog/fixture';
import { FIXTURE_ITEMS } from '@mat-plan/shared/program/fixtures';
import { and, eq, gte, inArray, isNotNull, isNull, lt, max, sql, sum } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/pglite/migrator';

import { type Database, schema } from '../src/client';
import { writeCheckinEntries } from '../src/writers/checkin';
import { SEED_PROGRAM_CLIENT_IDS } from '../src/writers/program/seed-fixtures';
import { hideEntries, restoreHidden } from '../src/writers/hide';
import { hiddenDayCounts, hiddenEntriesForDay } from '../src/queries/hidden-entries';
import {
  bodyweightMonthRows,
  checkinMonthRows,
  loggedMonths,
  strengthMonthRows,
} from '../src/queries/export-month';
import { householdProfileRows } from '../src/queries/household-profiles';
import { liveHouseholdIds } from '../src/queries/household-scope';
// TEN-2c: the ONE definition of "a movement is referenced", shared with `runbooks.md` pre-flight (d),
// the report-only correction, and (by requirement) TEN-2b-2's orphan correction + TEN-2c-1's split.
// This file hand-wrote the `entries` half of it before 2c and missed `prescriptions` entirely.
import { crossHouseholdMovementRefs, sharedMovementRows } from '../src/queries/movement-ownership';
import { programDayRows } from '../src/queries/program-day';
import { ownerScope, type HouseholdScope, type OwnerScope } from '../src/scope';
import {
  findAmendableBodyweight,
  insertBodyweightEntry,
  updateBodyweightEntryById,
} from '../src/writers/bodyweight';
// TEN-1 1b: imported by RELATIVE path on purpose — `src/index.ts` does not re-export it, so the app
// cannot reach the constructor that takes a household id as an argument at all (module resolution
// fails on a deep bare import). A script has no request to derive a scope from, so it NAMES one.
import { householdScopeForScript } from '../src/writers/household-scope-script';
// TEN-1 1d: the REAL find-or-create, a one-line wrapper over `findOrCreateTypedMovement`, the core
// `newItem` (`src/writers/program/new-item.ts`) calls. The app's DAL modules are `server-only` and
// import the app's env, so the catalog verdict at the end of this file can only run the code the
// app runs because that core lives here (write-path.md invariant 3).
import { findOrCreateMovement } from '../src/writers/movement-catalog';
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
// TEN-1 1d: the corrections registry itself, so the bulk household predicate is proved by running
// the correction's own dry run rather than a lookalike of its SQL.
import { CREATE_HOUSEHOLD_ACCOUNTS_ENV } from './corrections/accounts';
import {
  CORRECTIONS,
  CREATE_HOUSEHOLD_NAME,
  NULL_ROUTINE_TO_FULL_NAME,
} from './corrections/registry';
import { isNote, lineText } from './corrections/summary';
import {
  SEED_FULL_ROUTINE,
  SEED_HOUSEHOLD_PUBLIC_ID,
  SEED_PROFILE_2_PUBLIC_ID,
  SEED_PROFILE_NAME,
  SEED_PROFILE_PUBLIC_ID,
  seed,
  seedProgram,
} from '../src/seed';
// FAM-1 step 0c: the database and the proof helpers this file used to define live in the harness, so
// the lanes' proof modules beside it can import the same ones. Bodies unchanged; see harness.ts.
import {
  assertGlobalCheckMatchesMigration,
  verifyCatalogMigrationFacts,
  verifyCatalogSeedOnAFreshDatabase,
  verifyCatalogTables,
} from './verify/catalog';
import { verifyDay } from './verify/day';
import { verifySeedLeavesHouseholdsAlone, verifySeedOnAFreshDatabase } from './verify/seed';
import { verifyErasure } from './verify/erasure';
import {
  asDb,
  asPg,
  assertCheckCoversConst,
  captureOutput,
  assertRefTableMatches,
  asTx,
  columnCatalogShape,
  columnsOf,
  db,
  expectRejectedBy,
  lockTimeoutSetBy,
  orFail,
  asOwner,
  rolledBack,
  type VerifyContext,
} from './verify/harness';
import { legacyStrengthFixture } from './verify/legacy-strength-fixture';

/**
 * CAT-3 A2-ii (plan D3, D4): the shared verify database is a fixtures database, so its library rows
 * are the test library's. A library row is curated reference data by an EXACT test: global, a
 * modality, and a `CATALOG_FIXTURE` slug. `movementIsCatalog()` alone (a modality) is not enough.
 */
const FIXTURE_LIBRARY_SLUGS: ReadonlySet<string> = new Set(CATALOG_FIXTURE.map((e) => e.slug));
function isFixtureLibraryRow(m: {
  householdId: number | null;
  modality: string | null;
  slug: string;
}): boolean {
  return m.householdId === null && m.modality !== null && FIXTURE_LIBRARY_SLUGS.has(m.slug);
}
import { ADVISORY_LOCK } from '../src/writers/locks';
import { verifyProgram } from './verify/program';
import { verifySchema } from './verify/schema';
import { verifySingleValues } from './verify/single-values';

/**
 * Verifies the migration + seed against an in-process Postgres (PGlite) — no
 * Docker needed locally. Proves: the migration applies cleanly, the seed is
 * idempotent (run twice → identical), and the tagged-union CHECK is enforced.
 * The real DB gates (Docker PG + Neon branch) land at V0-11 in CI.
 */
await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
console.log('✓ migration applied to PGlite');

// ── 🔴 TEN-2c: TWO CATALOG FACTS THAT MUST BE READ *HERE*, AND NOWHERE ELSE ────────────────────────
//
// ⚠️ **DO NOT MOVE THESE DOWN THE FILE. They are only true of the MIGRATION at this point.** A
// fixture below mutates exactly this object, so a later read measures `verify.ts` instead of 0017:
// the V1-1b backfill simulation (~550 lines down) **drops and re-adds**
// `movements_global_row_has_pattern` itself, because that CHECK post-dates 0002's backfill and the
// simulation is faithful to the DEPLOY ORDER. Its re-add is `NOT VALID`, so a `convalidated` read
// taken after it would measure the simulation, not the migration. Since CAT-3 A1 the constraint here
// is 0032's (re-added validated, with a weaker predicate), and `drizzle-kit`'s drift guard diffs
// `schema.ts` against the snapshot, not the SQL, so a 0032 that lost its validation or its predicate
// is caught only here and by `verifyCatalogMigrationFacts` just below this block.
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
    `TEN-2c: ${CHECK} exists in pg_constraint, exactly once — a count of 0 means 0017 did not apply, or 0032 dropped it without re-adding it`,
  );
  assert.equal(
    checkRows[0].convalidated,
    true,
    `TEN-2d / CAT-3 A1: …and it is VALIDATED. 0018 validated 0017's NOT VALID constraint (that VALIDATE is what scanned production); CAT-3 A1's 0032 drops it and re-adds it validated in place, with a weaker predicate. A false here means 0032 re-added it NOT VALID`,
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
    `✓ TEN-2c: movements_slug_unique is absent from pg_constraint, and ${CHECK} exists, validated ` +
      '(both read HERE, before any fixture re-adds either — see the note above)',
  );
}

// CAT-3 A1: S5 proved on 0032's own constraint, and its definition kept for the comparison after the
// V1-1b re-add below. HERE for the same reason as the block above: from the V1-1b simulation on, the
// constraint in the database is this file's, not the migration's.
const migratedGlobalCheckDef = await verifyCatalogMigrationFacts();

// CAT-3 A2-i E1: the catalog writer on a database with no global movement yet, all rolled back.
await verifyCatalogSeedOnAFreshDatabase();

// OPS-2 Proof A: production's seed on a fork's first run, before any fixture seed below.
await verifySeedOnAFreshDatabase();

// The 1c-4 seed guard's proof is BELOW, after the idempotency block it depends on — see
// "AUTH-1 1c-4: the seed refuses a household it does not own".

// Seed twice → must be idempotent. The second run is asserted, so a seed that cannot run twice fails
// on a named line (FAM-1 6c-i: the fixture programs are written once, then left alone).
await seed(asPg, { fixtures: true }).catch((e: unknown) =>
  assert.fail(`FAM-1 6c-i: the first seed run succeeds (${String(e)})`),
);
await seed(asPg, { fixtures: true }).catch((e: unknown) =>
  assert.fail(`FAM-1 6c-i: a second seed run succeeds (${String(e)})`),
);

// 🔴 CAT-3 A2-ii, E4 (A2): a fixtures seed writes the test library (and, since F1-i, no legacy row),
// then the household fixtures, and EVERY fixture program. Here, before any other proof reads the shared state.
// (Since F1-i a fixtures seed that writes the wrong library, mutation 599, fails even earlier: the
// legacy program fixture's test-library slugs do not resolve, so the first seed run above throws.) Every program:
// since #763 each name the world shares with the test library logs the same way, and a program with
// one item whose library row logs another way would be skipped whole (`seedProgramFixtures`).
{
  const globalRows = await db
    .select({
      publicId: schema.movements.publicId,
      householdId: schema.movements.householdId,
      slug: schema.movements.slug,
      modality: schema.movements.modality,
    })
    .from(schema.movements)
    .where(isNull(schema.movements.householdId));
  assert.deepEqual(
    {
      library: globalRows
        .filter(isFixtureLibraryRow)
        .map((m) => m.slug)
        .sort(),
      legacy: globalRows.filter((m) => MOVEMENT_SEED_PUBLIC_IDS.has(m.publicId)).length,
      other: globalRows.filter(
        (m) => !isFixtureLibraryRow(m) && !MOVEMENT_SEED_PUBLIC_IDS.has(m.publicId),
      ).length,
    },
    { library: [...FIXTURE_LIBRARY_SLUGS].sort(), legacy: 0, other: 0 },
    'CAT-3 A2-ii A2: seed({ fixtures: true }) writes the test library and no other global row, no legacy row among them (F1-i)',
  );
  const programs = await db
    .select({ clientId: schema.programBlocks.clientId })
    .from(schema.programBlocks)
    .where(inArray(schema.programBlocks.clientId, [...SEED_PROGRAM_CLIENT_IDS]));
  assert.deepEqual(
    programs.map((p) => p.clientId).sort(),
    [...SEED_PROGRAM_CLIENT_IDS].sort(),
    'CAT-3 A2-ii A2: …and every fixture program, none skipped for an item the test library logs another way',
  );
  console.log(
    '✓ CAT-3 A2-ii A2: a fixtures seed writes the test library, no legacy row, and every fixture program',
  );
}

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
// archive e2e specs — see `SEED_PROFILE_3_PUBLIC_ID`'s docblock for why archive cannot share one —
// and FAM-1 a FOURTH, owned by the Change e2e (`SEED_PROFILE_4_PUBLIC_ID`).
//
// 🔴 **PRIV-3 RC, D7: what the seed writes, stated once.** This used to be a hand-written list of the
// three profile ids; it is now equality with `SEED_PUBLIC_IDS`, the set `household-claim-…` refuses
// on production. Sorted arrays, not sets, so it holds in BOTH directions and a duplicate fails too:
// an extra seeded athlete, or a member of the set the seed no longer writes, goes red here. Here and
// not in `verify/erasure.ts`, because this is the last point where the database is the seed's alone.
assert.deepEqual(
  [...households, ...profiles].map((r) => r.publicId).sort(),
  [...SEED_PUBLIC_IDS].sort(),
  'PRIV-3 RC: the seeded household and profile public_ids equal SEED_PUBLIC_IDS, in both directions',
);
// The literal is deliberate and lives here exactly once (AGENTS.md -> constants: "a contract test that
// pins the const's value"). This is the OSS-1 guard: it fails if anyone puts a real first name back into
// SEED_PROFILE_NAME / SEED_PROFILE_2_NAME, which asserting against the consts could never catch.
assert.deepEqual(
  profiles.map((p) => p.name).sort(),
  ['Athlete Four', 'Athlete One', 'Athlete Three', 'Athlete Two'],
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
      () => seed(asPg, { fixtures: true }),
      /refusing to seed into a household this seed does not own/,
      'AUTH-1 1c-4: a live household under a foreign public_id makes the seed REFUSE, by the message it throws — not by a TypeError',
    );
    // 🔴 CAT-3 A2-ii (plan D2, A3): that refusal comes BEFORE any write. The fixture library is global
    // and would stay; so a stale unit label, which `seedReference` would rewrite, must still be stale
    // after the refused run (mutation 603 moves the check back after `seedReference`).
    await rolledBack(async (tx) => {
      const [first] = UNITS;
      await tx
        .update(schema.units)
        .set({ label: 'CAT-3 A2-ii stale' })
        .where(eq(schema.units.code, first.code));
      // The test library's rows retired in this transaction (a slug of their own, and `deleted_at`),
      // so a seed that wrote before refusing would leave fresh ones on its slugs.
      await tx
        .update(schema.movements)
        .set({ slug: sql`'a2ii_retired_' || ${schema.movements.id}`, deletedAt: sql`now()` })
        .where(and(isNull(schema.movements.householdId), isNotNull(schema.movements.modality)));
      await assert.rejects(
        () => seed(asDb(tx), { fixtures: true }),
        /refusing to seed into a household this seed does not own/,
        'CAT-3 A2-ii A3: the fixtures seed refuses a database it does not own',
      );
      const written = await tx
        .select({ slug: schema.movements.slug })
        .from(schema.movements)
        .where(
          and(
            isNull(schema.movements.householdId),
            inArray(schema.movements.slug, [...FIXTURE_LIBRARY_SLUGS]),
          ),
        );
      assert.deepEqual(
        written,
        [],
        'CAT-3 A2-ii A3: a refused fixtures seed writes no test-library row',
      );
      const [unit] = await tx
        .select({ label: schema.units.label })
        .from(schema.units)
        .where(eq(schema.units.code, first.code));
      assert.equal(
        unit.label,
        'CAT-3 A2-ii stale',
        'CAT-3 A2-ii A3: a refused fixtures seed writes nothing first: ownership is checked before seedReference',
      );
    });
    // OPS-2 Proof C: production's seed never refuses: the refusal is the fixtures' alone (`327`).
    // Rolled back since CAT-3 A2-ii: it writes the real library, and the shared database stays a
    // fixtures database (plan D3).
    await rolledBack(async (tx) => {
      await assert.doesNotReject(
        () => seed(asDb(tx), { fixtures: false }),
        'OPS-2 C: with a live household under a foreign public_id, seed({ fixtures: false }) resolves',
      );
    });

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
// The positive read through A_SCOPE, kept beside its definition (LEGACY-1 PR B): a seed profile
// resolves under `isLiveProfile`, the predicate every scoped read below rides. It is the control
// `02-wrong-scope-everywhere.patch` reddens first, so that patch no longer depends on a proof
// elsewhere in the file staying where it is.
assert.equal(
  (
    await db
      .select({ id: schema.profiles.id })
      .from(schema.profiles)
      .where(isLiveProfile(profiles[0].publicId, A_SCOPE))
  ).length,
  1,
  'TEN-1 1b: A_SCOPE resolves a seed profile of its own household (the positive control for every A_SCOPE read)',
);

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
// A household id no row will ever carry: the "household is gone" case of `createProfile`'s lock (an
// erasure mid-call). Far above any id this file's inserts can reach.
const GONE_SCOPE = householdScopeForScript(2_000_000_000);

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
await seed(asPg, { fixtures: true });
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
await seed(asPg, { fixtures: true });
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
// CAT-3 A2-ii (plan D3): the shared database is a fixtures database, as every fresh e2e one is:
// the test library, exactly once, and since F1-i no legacy row (production's state after the fresh start).
assert.deepEqual(
  {
    legacy: movements.filter(
      (m) => m.householdId === null && MOVEMENT_SEED_PUBLIC_IDS.has(m.publicId),
    ).length,
    library: movements.filter((m) => isFixtureLibraryRow(m)).length,
    other: movements.filter(
      (m) =>
        m.householdId === null &&
        !MOVEMENT_SEED_PUBLIC_IDS.has(m.publicId) &&
        !isFixtureLibraryRow(m),
    ).length,
  },
  { legacy: 0, library: FIXTURE_LIBRARY_SLUGS.size, other: 0 },
  'movements: the test library seeded from its shared const, exactly once, and no legacy row (CAT-3 F1-i)',
);
// The seed writes household items only through the fixture programs (FAM-1 6c-i): each one in the
// seed household, and each named for a fixture item the catalog does not already have.
{
  const [seedHousehold] = await db
    .select({ id: schema.households.id })
    .from(schema.households)
    .where(eq(schema.households.publicId, SEED_HOUSEHOLD_PUBLIC_ID));
  const fixtureNames = new Set(FIXTURE_ITEMS.map((item) => item.name));
  const owned = movements.filter((m) => m.householdId !== null);
  assert.ok(
    owned.length > 0 &&
      owned.every((m) => m.householdId === seedHousehold?.id && fixtureNames.has(m.name)),
    'movements: the seed writes household items only for the fixture programs, in the seed household',
  );
}
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
// CAT-3 F1-i: a test-library row, since a fixtures database holds no old built-in (was `front_squat`).
const [liftMovement] = await db
  .select({ id: schema.movements.id })
  .from(schema.movements)
  .where(and(eq(schema.movements.slug, 'goblet_squat'), isNull(schema.movements.householdId)));
assert.ok(liftMovement, 'goblet_squat (the test library) movement is seeded');

// set_list → movement_id (metric_key NULL)
await db.insert(schema.entries).values({
  publicId: '019826b4-0000-7000-8000-0000000000d0',
  clientId: '019826b4-0000-7000-8000-0000000000d1',
  profileId: profiles[0].id,
  activityDate: '2026-07-21',
  kind: 'strength', // legacy guard: strength needs movement_name
  unit: 'lb',
  movementName: 'Goblet squat',
  activityTypeId: await activityTypeIdByKey('sc_lift'),
  movementId: liftMovement.id,
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
// CAT-3 A1: the predicate is the exported fragment, not a hand-typed copy, and the re-add is compared
// with the migration's definition (read right after `migrate()`).
await db.execute(
  sql`ALTER TABLE "movements" ADD CONSTRAINT ${sql.identifier(schema.MOVEMENT_GLOBAL_ROW_HAS_PATTERN_CHECK)} CHECK (${schema.movementGlobalRowHasPattern(schema.movements)}) NOT VALID`,
);
await assertGlobalCheckMatchesMigration(migratedGlobalCheckDef);

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
  // `primary` at several dimensions is the whole point of the composite PK: a back squat's mass, a broad
  // jump's length and a hold's duration are all "the thing this movement measures" — and, since FAM-1
  // step 3, a Count item's plain number.
  assert.equal(
    slots.filter((r) => r.code === QUANTITY_SLOT.primary).length,
    4,
    'primary is legal at mass, length, time AND count (the panel finding that killed a mass-pinned primary; count since FAM-1 step 3)',
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

// OPS-2 PR 1 (D4): the seed's ramp expansion is gone, so there is no "empty schedule seeds zero
// rows" to assert; OPS-2's Proof A counts `ramp_targets` among every household table instead.

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

// ── V1-6b-2: its proof deleted by LEGACY-1; one constant stays ────────────────────────────────
// `weeklyAdherenceRows`, the read this section proved, has had no caller since the old Today card
// went, and LEGACY-1 retires it. The ramp-test profile's public id stays for the TEN-1 1b read
// matrix's `ownedEntryIds` row. The second profile's target and bout, the scoping decoy, had no
// other reader and went with the proof.
const RAMP_TEST_PROFILE_PUBLIC_ID = '019826b4-0000-7000-8000-0000000000f0'; // rampTestProfile above

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
  .returning({ id: schema.profiles.id, publicId: schema.profiles.publicId });
const [sessionProfileB] = await db
  .insert(schema.profiles)
  .values({
    publicId: '019826b4-0000-7000-8000-0000000009b0',
    name: 'Session Kid B',
    kind: PROFILE_KIND.kid,
    householdId: households[0].id,
  })
  .returning({ id: schema.profiles.id, publicId: schema.profiles.publicId });

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
  // 🔴 **`deleted_at IS NULL`, and a throw on a miss — the guard the old strength writer's
  // `reselectLiveByClientId` carried (retired with that writer by LEGACY-1), not a shortcut.**
  // Before V1-9b B0 the partial UNIQUE kept a hidden row out of the index, so a conflict implied a
  // LIVE row and an unguarded re-select was merely sloppy. B0 puts hidden rows back in the index,
  // so a conflict can now be WITH a hidden row — and this re-select would hand its id back and
  // attach children to a dead parent.
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

// ── V1-13b: the month-scoped export reads, against rows the legacy writer left ──────────────────────
// The formatters have golden vectors; these prove the READS — ordering, the soft-delete filters, the
// skipped-movement LEFT JOIN, and that a month boundary is half-open. Run through the shipped
// `strengthMonthRows`, so the DAL and this proof cannot diverge. The rows are the legacy strength
// writer's shapes, which production still holds (a multi-set entry, a skipped movement with zero
// sets), written by `legacyStrengthFixture` (LEGACY-1).
{
  await legacyStrengthFixture(asPg, {
    profilePublicId: '019826b4-0000-7000-8000-0000000009a0',
    scope: A_SCOPE,
    day: '2026-03-11',
    activityTypeId: scLiftActivityId,
    movements: [
      {
        movementName: movX.name,
        unit: 'lb',
        movementId: movX.id,
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
    scope: asOwner(A_SCOPE, 'V1-13 loggedMonths'),
  });
  assert.ok(
    months.some((m) => m.month === '2026-03'),
    'V1-13b: loggedMonths finds the month just written',
  );

  console.log('✓ V1-13b: export reads — skipped LEFT JOIN, quantities, half-open month, BOLA');
}

// ── V1-30: a newly loggable unit round-trips from a stored legacy row to the export read ───────────
// The CSV tests build rows by hand; this proves the stored side. Before V1-30 the session schema
// refused `m` outright and a `kg` set made the export throw. This asserts on what the fold and the CSV
// builder consume: the quantity row's (dimension, unit) and `strengthMonthRows`' unit + value; the
// bytes `20m`/`85kg` are pinned by the strength-log CSV tests over those same fields. (Since FAM-1 14a
// the fold, `foldStrengthMonth`, sits beside the query, and lane E's `verifyExport` asserts the
// program rows' bytes through it.) The rows are `legacyStrengthFixture`'s (LEGACY-1); the quantities
// go through the live `insertEntrySetRows`, which derives each one's dimension from its unit.
{
  const V130_PROFILE = '019826b4-0000-7000-8000-0000000009a0';
  await legacyStrengthFixture(asPg, {
    profilePublicId: V130_PROFILE,
    scope: A_SCOPE,
    day: '2026-05-14',
    activityTypeId: scLiftActivityId,
    movements: [
      {
        movementName: movX.name,
        unit: 'kg',
        movementId: movX.id,
        sets: [{ reps: 5, weight: 85 }],
      },
      {
        movementName: movY.name,
        unit: 'm',
        movementId: movY.id,
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
  console.log('✓ V1-30: kg and m round-trip from a stored row to the export read');
}

// ── GAP-3: the composite-FK unit guard, and the shapes fixed columns could not hold ────────────────
// This is the block that justifies the design. `lb` in a box-jump height is rejected BY THE DATABASE,
// not by review — there is no third spelling that gets a mass unit into a length quantity, because
// `dimension` is the shared column of two composite FKs against two PRIMARY KEYS.
{
  // The rows: a legacy hold (`legacyStrengthFixture`, LEGACY-1), the shape the old writer's
  // labeled-movement proof logged before LEGACY-1 deleted it. Its first two sets are bodyweight and
  // carry NO quantity, so each slot below is free to be written; the third is 30 seconds.
  const {
    entries: [qtyEntry],
  } = await legacyStrengthFixture(asPg, {
    profilePublicId: '019826b4-0000-7000-8000-0000000009a0', // sessionProfileA
    scope: A_SCOPE,
    day: '2026-02-10',
    activityTypeId: scLiftActivityId,
    movements: [
      {
        movementName: movX.name,
        unit: 'sec',
        movementId: movX.id,
        sets: [
          { reps: 5, weight: null, isBodyweight: true },
          { reps: 3, weight: null, isBodyweight: true },
          { reps: 1, weight: 30 },
        ],
      },
    ],
  });
  const qtySetId = (
    (
      await db.execute(sql`
        select es.id from entry_sets es
        where es.entry_id = ${qtyEntry.id} order by es.idx limit 1`)
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
  // `primary` is legal at mass/length/time/count (count since FAM-1 step 3, whose proof is in
  // verify/schema.ts) but NOT at instant — a slot is bounded by its declared set.
  await expectRejectedBy('entry_set_quantities_slot_dimension_fkey', () =>
    insertQty(QUANTITY_SLOT.primary, UNIT_DIMENSION.instant, 'timing'),
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
        select es.id from entry_sets es
        where es.entry_id = ${qtyEntry.id} order by es.idx offset 1 limit 1`)
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
// (The old strength writer's day_role round-trips were deleted by LEGACY-1, which retires that
// writer; no live writer sets the column. The CHECK still holds for the rows production carries.)
await assertCheckCoversConst('sessions_day_role_check', DAY_ROLES);

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
console.log('✓ GAP-1: sessions.day_role — CHECK parity, bad-literal reject');

// ── GAP-1 P1-1b: a SET can be marked sub_failure ──────────────────────────────────────────────────
// The mix matters: one `done` set and one `sub_failure` set on the SAME movement, which is the
// realistic shape ("3 sets, the last one failed") and the one entry-level storage could never
// express. The rows are `legacyStrengthFixture`'s (LEGACY-1), whose sets go through the live
// `insertEntrySetRows`. The old edit path's refusal of a sub-failure set was deleted with the rest
// of that path's proofs (LEGACY-1).
const {
  entries: [sfEntry],
} = await legacyStrengthFixture(asPg, {
  profilePublicId: '019826b4-0000-7000-8000-0000000009a0',
  scope: A_SCOPE,
  day: '2026-03-06',
  activityTypeId: scLiftActivityId,
  movements: [
    {
      movementName: movX.name,
      unit: 'lb',
      movementId: movX.id,
      sets: [
        { reps: 5, weight: 60 }, // status omitted → DB default
        { reps: 3, weight: 60, status: ENTRY_STATUS.sub_failure },
      ],
    },
  ],
});
assert.ok(sfEntry, 'GAP-1 P1-1b: the movement was written');
const sfSets = await db
  .select({
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
console.log('✓ GAP-1 P1-1b: per-set sub_failure — status + reps persisted, count intact');

// ── V1-24 PR 1b: the bodyweight amend writer, and every pin in its guard ────────────────────────
// The app DAL and this proof call the SAME `updateBodyweightEntryById`, so the shipped WHERE is what
// gets exercised. It reuses the V1-8-1 block's already-seeded profiles rather than minting a third.

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

const bwOwner = sessionProfileA.publicId;
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

// (j) THE profile half of `isLiveProfile`: a soft-deleted profile owns nothing. (a)–(i) did not
// cover this. Restored straight after.
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
await db
  .update(schema.profiles)
  .set({ deletedAt: null })
  .where(eq(schema.profiles.id, bwOwnerRow.id));
assert.equal(deadProfileAmend, null, 'V1-24 1b: a soft-deleted profile cannot amend a bodyweight');

console.log(
  '✓ V1-24 1b: bodyweight amend — persists; cross-profile, wrong metric, stale value, wrong unit, soft-deleted, non-done, text-valued and dead-profile all refused; the re-read shares the guard',
);

// ── V1-24 PR 1d: one live weigh-in per (profile, day, slot) ─────────────────────────────────────
// `uq_entries_profile_day_bodyweight` keys on (profile_id, activity_date, coalesce(context,'morning'))
// for live bodyweight rows. Each case uses its own day so the cases cannot interfere.
{
  const UQ = schema.BODYWEIGHT_DAY_UNIQUE_INDEX;
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
      await tx.execute(sql`DROP INDEX ${sql.identifier(schema.BODYWEIGHT_DAY_UNIQUE_INDEX)}`);
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
// DB-only, ships dark. Prove the SCHEMA (columns, CHECK↔const parity, FK/unique/CHECK rejections) AND the
// seed RESOLVER — a test-only fixture driven through the REAL seedProgram, so the resolve-by-slug/public_id
// + ON CONFLICT arbiter is exercised beyond LEGACY_PROGRAM_FIXTURE's one block (CAT-3 F1-i).

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

// The seed is now POPULATED with the maintainer's authored block (V1-10 PR 1b) — prove it seeded + resolved end-to-end.
assert.ok(
  LEGACY_PROGRAM_FIXTURE.length >= 1,
  'V1-10: LEGACY_PROGRAM_FIXTURE is populated (the legacy test block)',
);
const seededBlocks = (
  (
    await db.execute(
      sql`select count(*)::int as count from program_blocks where kind = ${PROGRAM_BLOCK_KIND.legacy}`,
    )
  ).rows as unknown as {
    count: number;
  }[]
)[0].count;
// EXACT count (not just ≥1): the DB must hold precisely the LEGACY blocks LEGACY_PROGRAM_FIXTURE declares — nothing
// extra (an accidental / LLM-drafted block would fail here, the safety the old `== 0` empty-guard
// provided). Since FAM-1 6c-i the seed also writes the fixture TEMPLATE programs, so a stray template
// block is caught by `verify/schema.ts`'s 4a-i kind check, which names the fixture programs alone.
assert.equal(
  seededBlocks,
  LEGACY_PROGRAM_FIXTURE.length,
  'V1-10: exactly LEGACY_PROGRAM_FIXTURE’s blocks are seeded (no unexpected extras)',
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

// The core four run on BOTH days; the rotating pair is A-only and the chest pass is B-only: the old
// block's shape, over test-library slugs since CAT-3 F1-i (LEGACY_PROGRAM_FIXTURE).
const slugsOn = (role: string) =>
  new Set(realBlock.filter((r) => r.day_role === role).map((r) => r.movement_slug));
const dayA = slugsOn('strength_a');
const dayB = slugsOn('strength_b');
for (const core of ['incline_push-up', 'chin-up', 'reverse_lunge', 'dead_hang']) {
  assert.ok(dayA.has(core) && dayB.has(core), `YDP: '${core}' runs every session`);
}
assert.ok(dayA.has('squat_jump') && !dayB.has('squat_jump'), 'YDP: squat jumps are Day A only');
assert.ok(dayA.has('dumbbell_row') && !dayB.has('dumbbell_row'), 'YDP: dumbbell rows are A only');
assert.ok(
  dayB.has('medicine_ball_chest_pass') && !dayA.has('medicine_ball_chest_pass'),
  'YDP: medicine-ball chest passes are Day B only',
);

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
// BOLA scoping and the per-kid LEFT JOIN — is what gets exercised.

// (a) The YOUTH DAILY PROGRAM: Day A is 7 movements, in the coach's authored `idx` order.
const athleteOneDayA = await programDayRows(asPg, {
  scope: A_SCOPE,
  profilePublicId: SEED_PROFILE_PUBLIC_ID,
  dayRole: 'strength_a',
});
assert.equal(athleteOneDayA.length, 7, 'YDP: programDayRows returns Day A’s 7 movements');
assert.deepEqual(
  athleteOneDayA.map((r) => r.movementName),
  // CAT-3 F1-i: LEGACY_PROGRAM_FIXTURE's Day A, the test library's names.
  [
    'Incline push-up',
    'Chin-up',
    'Reverse lunge',
    'Dead hang',
    'Squat jump',
    'Dumbbell row',
    'Single-leg Romanian deadlift',
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

// Day B swaps the rotating pair for the chest pass — 6 movements (LEGACY_PROGRAM_FIXTURE, CAT-3 F1-i).
const athleteOneDayB = await programDayRows(asPg, {
  scope: A_SCOPE,
  profilePublicId: SEED_PROFILE_PUBLIC_ID,
  dayRole: 'strength_b',
});
assert.equal(athleteOneDayB.length, 6, 'YDP: programDayRows returns Day B’s 6 movements');
assert.ok(
  athleteOneDayB.some((r) => r.movementName === 'Medicine ball chest pass'),
  'YDP: Day B carries the chest pass',
);
assert.ok(
  !athleteOneDayB.some((r) => r.movementName === 'Squat jump'),
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
// This is the column pair that feeds the log form's Unit select and its BW-tap warning. Since CAT-3
// F1-i the block's movements are test-library rows: one loaded in pounds, one bodyweight.
const loaded = athleteOneDayB.find((r) => r.movementName === 'Single-leg Romanian deadlift');
assert.equal(
  loaded?.movementUnitDefault,
  'lb',
  'V1-26: Single-leg Romanian deadlift declares a pound default',
);
assert.equal(loaded?.movementIsBodyweight, false, 'V1-26: ...and is NOT a bodyweight movement');

const pushUps = athleteOneDayA.find((r) => r.movementName === 'Incline push-up');
assert.equal(pushUps?.movementIsBodyweight, true, 'V1-26: Incline push-up declares bodyweight');
assert.equal(pushUps?.movementUnitDefault, null, 'V1-26: ...and declares no unit');

// ⚠️ The declaration is the MOVEMENT's, never the coach's. `load` stays null on every YDP row (asserted
// just above), so widening the query did not open a path for an authored magnitude to reach an input.
assert.ok(
  athleteOneDayA.every((r) => r.load === null),
  'V1-26: widening the select did not let a prescribed load through',
);

// The one fixed prescription in the program survives the read.
const fixedOne = athleteOneDayA.find((r) => r.movementName === 'Single-leg Romanian deadlift');
assert.equal(fixedOne?.sets, 3, 'YDP: the single-leg RDL keeps its fixed 3 sets');
assert.equal(fixedOne?.targetReps, '10 per side', 'YDP: ...and their per-side prescription');

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

// ── V1-22 chunk 2: the EXPORT reads the frozen prescription as it was stored ──────────────────────
// The writer half of this section (the old strength writer freezing a snapshot) was deleted by
// LEGACY-1, which retires that writer. The live writer's freeze is `verify/day.ts` "9: the frozen
// prescription" (mutation 129). What stays is the export's read of the column, over rows production
// holds.
const SNAP2_PROFILE_PUBLIC_ID = '019826b4-0000-7000-8000-0000000000e5';
await db.insert(schema.profiles).values({
  publicId: SNAP2_PROFILE_PUBLIC_ID,
  name: 'Verify Snapshot Kid',
  kind: 'kid',
  householdId: verifyHh.id,
});
// 🔴 **The READ side, through the query the export actually ships.** `coalesce(…, '')` or
// `nullif(…, '')` on that select — one word — would survive every other gate: the pure tests run on
// hand-built rows, a direct `select` of the column cannot see the read, and the e2e exports under
// an unchanged program where frozen and live bytes coincide.
//
// Its rows are the two shapes production holds, written by `legacyStrengthFixture` (LEGACY-1): a
// `day_role` session whose entry froze `''`, and a session with no day role whose entry was never
// snapshotted (NULL).
const snapReadMovement = { movementId: movX.id, movementName: movX.name, unit: 'lb' } as const;
const {
  entries: [snapReadEmpty],
} = await legacyStrengthFixture(asPg, {
  profilePublicId: SNAP2_PROFILE_PUBLIC_ID,
  scope: B_SCOPE,
  day: '2026-03-09',
  activityTypeId: scLiftActivityId,
  dayRole: 'skill',
  movements: [{ ...snapReadMovement, prescribedSnapshot: '', sets: [{ reps: 5, weight: 50 }] }],
});
const {
  entries: [snapReadNull],
} = await legacyStrengthFixture(asPg, {
  profilePublicId: SNAP2_PROFILE_PUBLIC_ID,
  scope: B_SCOPE,
  day: '2026-03-10',
  activityTypeId: scLiftActivityId,
  movements: [{ ...snapReadMovement, sets: [{ reps: 5, weight: 50 }] }],
});
const snapExportRows = await strengthMonthRows(asPg, {
  profilePublicId: SNAP2_PROFILE_PUBLIC_ID,
  month: '2026-03',
  scope: B_SCOPE,
});
// Keyed on the entry: the query returns no `client_id`, and the fixture returned each entry's id.
// A row the read did not return reads `undefined`, which neither assertion accepts.
const snapReadOf = (entryId: number) =>
  snapExportRows.find((r) => r.entryId === entryId)?.prescribedSnapshot;
assert.equal(
  snapReadOf(snapReadEmpty.id),
  '',
  "V1-22 chunk 2: the EXPORT query returns '' as '' — a nullif(…, '') here would send every open() row back to today's program",
);
assert.equal(
  snapReadOf(snapReadNull.id),
  null,
  "V1-22 chunk 2: the EXPORT query returns NULL as NULL — a coalesce(…, '') here would make every never-snapshotted row look frozen",
);

console.log('✓ V1-22 chunk 2: the export reads a frozen prescription as stored, NULL as NULL');

// --- a comma survives the column (the CSV quotes it: csv/row.ts quotes any field, FAM-1 14a) -----
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
// `LIMIT 2` ambiguity probe, and its one surviving caller (this file) refuses rather than picks when
// it returns 2.
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
// The letters skip (b) on purpose: LEGACY-1 deleted that fixture (the adherence read's) with its
// proof. Nothing is missing.
// (a) a weigh-in → the bodyweight amend + its re-read
const bTarget = await insertBodyweightProbe({
  profileId: verifyProfileRow.id,
  value: 70.5,
  activityDate: '2026-03-03',
});

// (c) a strength session as production holds it (`legacyStrengthFixture`, LEGACY-1) → the export's
// strength read below
await legacyStrengthFixture(asPg, {
  profilePublicId: VERIFY_PROFILE_PUBLIC_ID,
  scope: B_SCOPE,
  day: '2026-03-03',
  activityTypeId: scLiftActivityId,
  movements: [
    {
      movementName: 'Verify Lift',
      unit: 'lb',
      movementId: movX.id,
      sets: [{ reps: 5, weight: 95 }],
    },
  ],
});
// …and the mirror for household A, from the same builder, so the read's positive directions both
// find a row this block created.
await legacyStrengthFixture(asPg, {
  profilePublicId: sessionProfileA.publicId,
  scope: A_SCOPE,
  day: '2026-03-03',
  activityTypeId: scLiftActivityId,
  movements: [
    {
      movementName: 'Tenancy Lift',
      unit: 'lb',
      movementId: movX.id,
      sets: [{ reps: 5, weight: 135 }],
    },
  ],
});

// (d) TEN-1 1c: a weigh-in for household A in the SAME month as B's, so `bodyweightMonthRows` has a
// row to wrongly find in both directions. B's is `bTarget` (2026-03-03); A's goes on a day no other
// probe owns — `uq_entries_profile_day_bodyweight` allows one live weigh-in per (profile, day, slot),
// and (4a) below claims 2026-03-04.
const aBwExportTarget = await insertBodyweightProbe({
  profileId: bwOwnerRow.id,
  value: 88.2,
  activityDate: '2026-03-02',
});

// (f) FAM-1 14b: a check-in for each household in that same March, so `checkinMonthRows` has a row to
// wrongly find in both directions too.
{
  const practiceId = await activityTypeIdByKey(ACTIVITY_TYPE_KEYS.wrestling_practice);
  for (const profileId of [bwOwnerRow.id, verifyProfileRow.id]) {
    await db.insert(schema.entries).values({
      publicId: newId(),
      clientId: newId(),
      profileId,
      activityDate: '2026-03-05',
      unit: PRACTICE_UNIT,
      valueNum: '60',
      activityTypeId: practiceId,
      metricKey: METRIC_KEYS.practice_minutes,
      status: ENTRY_STATUS.done,
    });
  }
}

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
// programmed-day card and the four month reads behind the CSV export.
//
// Each row names **its own pair of profiles**. The reads need different fixtures — the export reads
// need logged sessions, the program read needs a block — and one
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
    sessionProfileA.publicId,
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
    'checkinMonthRows (the CSV export’s check-ins)',
    bwOwner,
    VERIFY_PROFILE_PUBLIC_ID,
    (profilePublicId, scope) =>
      checkinMonthRows(asPg, { profilePublicId, month: '2026-03', scope }),
  ],
  [
    'loggedMonths (which months the export writes at all)',
    bwOwner,
    VERIFY_PROFILE_PUBLIC_ID,
    // FAM-1 export follow-up: narrowed inside the lambda, so the row still reads household B's
    // owner against A's profile (zero months by `isLiveProfile`, not by the owner gate).
    (profilePublicId, scope) =>
      loggedMonths(asPg, { profilePublicId, scope: asOwner(scope, 'TEN-1 loggedMonths') }),
  ],
];

await ten1ReadMatrix(TEN1_READS_1B);
console.log(
  `✓ TEN-1 1b: the READ matrix — ${TEN1_READS_1B.length} scoped read (ownedEntryIds), ` +
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

console.log(
  '✓ TEN-1 1b: the WRITE matrix — bodyweight amend and amend re-read, each refused across the household seam in BOTH directions, with no side effect',
);

// ── (4b) TEN-1 1c's READS and its seed resolver — ordered AFTER every 1b proof above ────────────
// Deliberately down here, not beside 1b's: `03-undo-1c-predicates.patch` claims that under it every
// 1b assertion holds and the first failure is a 1c one. `db:verify` is fail-fast, so that was only
// provable with 1b's proofs ahead of 1c's — otherwise the 1b rows below a 1c failure are unreached
// rather than green, and the gate was being credited with showing something it could not. This is the
// follow-up 1c's own review recorded for 1d.
await ten1ReadMatrix(TEN1_READS_1C);
console.log(
  `✓ TEN-1 1c: the READ matrix — ${TEN1_READS_1C.length} scoped reads (programDayRows, the four ` +
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
const nullRoutineRaw = await nullRoutineCorrection.run(asCorrectionDb, false);
assert.ok(
  nullRoutineRaw.length > 0 && !nullRoutineRaw.some(isNote),
  'TEN-1 1d: the routine dry run returns CHANGES, so the runner counts them (2026-11-19)',
);
const nullRoutineDryRun = nullRoutineRaw.map(lineText);
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
// The function under test is `findOrCreateMovement`, a one-line wrapper over
// `findOrCreateTypedMovement`, the REAL core `newItem` calls (single-sourced in `packages/db` in 1d
// exactly so this proof can run it; the app's DAL is `server-only` and cannot execute here).

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
// `Squat jump` is in the test library as `is_bodyweight: true`; `findOrCreateMovement` can only ever
// write `false`. So a free-text name that happens to slug onto a catalog row inherits the catalog's
// declaration wholesale — which is the benign half of the same mechanism as (d). CAT-3 F1-i: a
// test-library row, since a fixtures database holds no old built-in (this was `box_jump`).
const seededJump = CATALOG_FIXTURE.find((m) => m.slug === 'squat_jump');
assert.ok(
  seededJump?.isBodyweight,
  'TEN-1 1d fixture: squat_jump is a test-library bodyweight movement',
);
const [seededJumpRow] = await db
  .select({ publicId: schema.movements.publicId })
  .from(schema.movements)
  .where(and(eq(schema.movements.slug, seededJump.slug), isNull(schema.movements.householdId)));
const jumpId = await findOrCreateMovement(asPg, A_SCOPE, seededJump.name);
const jump = await movementRow(jumpId);
assert.equal(
  jump.publicId,
  seededJumpRow?.publicId,
  'TEN-1 1d READ: free text matching a catalog slug resolves to the SEEDED row, not a new one',
);
// TEN-2b fact 1: now resolved GLOBAL-FIRST and explicitly, rather than by accident of there being
// only one namespace — and it must hold from the OTHER household's scope too, or a household could
// shadow curated metadata with a row this writer is incapable of authoring properly.
assert.equal(
  jump.householdId,
  null,
  'TEN-2b: …and the seeded row it resolved to is still GLOBAL (household_id IS NULL) — global-first returned reference data, it did not clone it into a household',
);
assert.equal(
  await findOrCreateMovement(asPg, B_SCOPE, seededJump.name),
  jumpId,
  'TEN-2b: …and household B resolves the SAME seeded row — a household cannot shadow a curated movement, which is the direction household-first would have broken',
);
assert.equal(
  jump.isBodyweight,
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

// TEN-2b: the ids the REAL resolver returned in this run — one curated global resolve (squat_jump),
// one owned insert, and the leak's row. The re-taken dark gate in the TEN-2a/2b section below
// asserts over exactly these, because they are the only rows a resolver touched; V1-1b's raw-SQL
// backfill fixture also writes `movements`, and nothing scopes those.
const TEN2B_RESOLVER_IDS: number[] = [
  aMovementId,
  bMovementId,
  jumpId,
  poisonedId,
  // TEN-2c: the two rows 0017 made reachable — household A's own row for a slug B typed first, and
  // (via `bMovementId` above) B's own row for a slug A typed first. They are the inverted
  // assertions' subjects, so they belong in the end-state membership proof too.
  unpoisonedId,
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
    'curated library row (squat_jump on a fixtures database since CAT-3 F1-i). ✅ ALREADY CLOSED at TEN-2b: seedProgram REFUSES a prescription naming another ' +
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
  // with a GLOBAL row". `squat_jump` is a seeded (`household_id IS NULL`) test-library row (CAT-3
  // F1-i: it was the old built-in `box_jump`), so the insert now SUCCEEDS and the two rows coexist.
  //
  // ⚠️ **It is OUTSIDE any transaction, so the row must be DELETED, and that is load-bearing in two
  // directions.** (4)'s dark gate and (5)'s discriminator read the WHOLE table a few lines down, and
  // the snapshot is taken AFTER this. A committed app-authored row owned by a household is tolerable
  // there; a committed app-authored row carrying a non-NULL `pattern` would redden discriminator 2/3,
  // which is also why `movementRowValues` must NOT grow a `pattern` and only the GLOBAL probes below
  // pass one. Deleting it is simpler than reasoning about either.
  await db
    .insert(schema.movements)
    .values(movementRowValues('02', 'squat_jump', ten2aHousehold.id));
  const jumpNamespaces = await db
    .select({ householdId: schema.movements.householdId })
    .from(schema.movements)
    .where(eq(schema.movements.slug, 'squat_jump'));
  assert.deepEqual(
    jumpNamespaces.map((r) => r.householdId).sort(),
    [null, ten2aHousehold.id].sort(),
    'TEN-2c: a household now holds its OWN row for a SEEDED slug, alongside the curated global one — the state movements_slug_unique forbade, asserted on committed rows rather than inside a rolled-back transaction. ⚠️ Inverted from TEN-2a’s expectRejectedBy(movements_slug_unique, …); do NOT "fix" a failure here by restoring the rejection',
  );
  // …and gone again, before (4) and (5) read the table. See the ⚠️ above.
  await db
    .delete(schema.movements)
    .where(eq(schema.movements.publicId, movementRowValues('02', 'squat_jump', null).publicId));
  assert.deepEqual(
    await db
      .select({ householdId: schema.movements.householdId })
      .from(schema.movements)
      .where(eq(schema.movements.slug, 'squat_jump')),
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
      slug: schema.movements.slug,
      modality: schema.movements.modality,
      pattern: schema.movements.pattern,
    })
    .from(schema.movements);
  // CAT-3 A2-ii (plan D4): curated is a legacy seed row OR a library row of the library in effect
  // (here the test library), by an exact test: a modality and one of its slugs.
  const appAuthored = allMovements.filter(
    (m) => !MOVEMENT_SEED_PUBLIC_IDS.has(m.publicId) && !isFixtureLibraryRow(m),
  );
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
      slug: schema.movements.slug,
      modality: schema.movements.modality,
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
      (m) =>
        m.householdId === null &&
        !MOVEMENT_SEED_PUBLIC_IDS.has(m.publicId) &&
        !isFixtureLibraryRow(m),
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
  //
  // CAT-3 F1-i: a fixtures database holds no old built-in, so the set has no member here and the
  // curated rows are the test library's alone. (1/4) is re-aimed at those rows.
  const seeded = allMovements.filter((m) => MOVEMENT_SEED_PUBLIC_IDS.has(m.publicId));
  assert.equal(
    seeded.length,
    0,
    'TEN-2a: no old built-in is on a fixtures database (CAT-3 F1-i): the curated rows are the test library’s',
  );
  const curated = allMovements.filter(isFixtureLibraryRow);
  assert.ok(
    curated.length > 0 &&
      curated.every((m) => m.pattern !== null || m.modality !== MODALITY.strength),
    'TEN-2a discriminator (1/4): a curated row (a test-library row since CAT-3 F1-i) has a `pattern`, or a modality other than strength — what the CHECK requires of a global row',
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
      .filter((m) => !isFixtureLibraryRow(m))
      .map((m) => m.publicId)
      .filter((id) => !MOVEMENT_SEED_PUBLIC_IDS.has(id))
      .sort(),
    [],
    'TEN-2c END-STATE MEMBERSHIP (4/4): every GLOBAL row the resolver returned is a member of MOVEMENT_SEED_PUBLIC_IDS — exact set membership, not a slug test and not a public_id-prefix test (both were tried in this arc and both were wrong). This is layer 2 of movements_global_row_has_pattern, which can only require a `pattern` (or, since CAT-3 A1, a non-strength modality)',
  );
  // CAT-3 F1-i: "every curated row carries the `pattern` the CHECK requires" read the old built-ins,
  // of which a fixtures database holds none; (1/4) above proves it over the test library's rows.
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
  // CAT-3 F1-i: a test-library row, since a fixtures database holds no old built-in.
  const seededForSeq = CATALOG_FIXTURE[0]!;
  const [seededForSeqRow] = await db
    .select({ publicId: schema.movements.publicId })
    .from(schema.movements)
    .where(and(eq(schema.movements.slug, seededForSeq.slug), isNull(schema.movements.householdId)));
  const seqResolved = await findOrCreateMovement(asPg, A_SCOPE, seededForSeq.name);
  assert.equal(
    (await movementRow(seqResolved)).publicId,
    seededForSeqRow?.publicId,
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
      await tx.execute(sql`
        delete from prescription_quantities where prescription_id in (
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
// cannot run inside a transaction AS WRITTEN: it calls `seed(asPg, …)`, the module-level `db`, and
// PGlite has ONE connection, so calling that inside `db.transaction` would wait forever. (`seed(tx)`
// with the transaction's own handle does run inside one: `verify/schema.ts`' FAM-1 step-1 proof.)
{
  const [guardHousehold] = await db
    .select({ id: schema.households.id })
    .from(schema.households)
    .where(eq(schema.households.publicId, SEED_HOUSEHOLD_PUBLIC_ID));
  assert.ok(guardHousehold, 'TEN-2b guard fixture: the seed household resolves');

  // ⚠️ **The shadowed library row is CHOSEN AT RUNTIME, and it has to be.** (b) below DELETES the
  // curated row to prove the seed puts it back, and `entries.movement_id` / `prescriptions.movement_id`
  // would abort that delete `23503` — this file's own fixtures and the fixture programs reference
  // several. So pick the first test-library row nothing references, through the SHARED census
  // (`queries/movement-ownership.ts`) rather than a hand-written join: `householdRefs === 0` is that
  // module's definition of unreferenced, and it covers both referencing tables.
  //
  // CAT-3 F1-i: a test-library row, where this used to be an old built-in. No seed writes those any
  // more, so "the seed restores it" holds only of the library, and the report counts the household
  // row as sharing a LIBRARY slug. Production's seed still takes the legacy-slug count (`verify/seed.ts`
  // B4 proves that one).
  const unreferencedGlobalIds = new Set(
    (await sharedMovementRows(asPg)).filter((r) => r.householdRefs === 0).map((r) => r.movementId),
  );
  const globalRowIds = await db
    .select({ id: schema.movements.id, slug: schema.movements.slug })
    .from(schema.movements)
    .where(movementIsGlobal())
    .orderBy(schema.movements.id);
  // The first by id, and never a legacy slug, so the "1 share a library slug" pin cannot miscount.
  const legacySlugs = new Set<string>(MOVEMENT_SEED_ROWS.map((m) => m.slug));
  const shadowedRow = globalRowIds.find(
    (g) =>
      FIXTURE_LIBRARY_SLUGS.has(g.slug) &&
      !legacySlugs.has(g.slug) &&
      unreferencedGlobalIds.has(g.id),
  );
  const shadowed = shadowedRow && { id: shadowedRow.id, slug: shadowedRow.slug };
  assert.ok(
    shadowed,
    'TEN-2c guard fixture: at least one curated movement is referenced by nothing, so (b) can delete it and watch the seed restore it',
  );

  // `captureOutput` lives in the harness since OPS-2 PR 1 (its second caller, `verify/seed.ts`).

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
  const SHADOW_PUBLIC_ID = '019826b4-0000-7000-8000-00000002b022';
  await db.insert(schema.movements).values({
    publicId: SHADOW_PUBLIC_ID,
    slug: shadowed.slug,
    name: SHADOW_NAME,
    householdId: guardHousehold.id,
  });
  // A library row carries join rows (CAT-3 A2-i), which the seed writes again with the row.
  await db
    .delete(schema.movementEquipment)
    .where(eq(schema.movementEquipment.movementId, shadowed.id));
  await db.delete(schema.movementMuscles).where(eq(schema.movementMuscles.movementId, shadowed.id));
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
  const guardMessage = await captureOutput(async () => {
    await seed(asPg, { fixtures: true });
  });
  assert.deepEqual(
    (
      await db
        .select({
          householdId: schema.movements.householdId,
          modality: schema.movements.modality,
          slug: schema.movements.slug,
        })
        .from(schema.movements)
        .where(and(eq(schema.movements.slug, shadowed.slug), movementIsGlobal()))
    ).map(isFixtureLibraryRow),
    [true],
    'TEN-2c SHADOW REPORT: `seed()` INSERTS the curated catalog row even though a household owns that slug — the `seedableMovements` filter is gone, so the guard suppresses no write. ⚠️ This is the half a `throw`-only demotion would have left broken FOREVER and silently: the curated row never inserted, with nothing complaining loudly',
  );
  // CAT-3 F1-i: the restored row is a library row, so the seed writes join rows beside it: never
  // onto the household's own row on the same slug.
  assert.equal(
    (
      await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.movementEquipment)
        .innerJoin(schema.movements, eq(schema.movements.id, schema.movementEquipment.movementId))
        .where(eq(schema.movements.publicId, SHADOW_PUBLIC_ID))
    )[0]?.n,
    0,
    "TEN-2c SHADOW REPORT: …and the seed writes no join row for a household's movement on that slug (CAT-3 F1-i)",
  );
  assert.match(
    guardMessage,
    /share a legacy seed slug/,
    'TEN-2c SHADOW REPORT: …and it still REPORTS the shadowing, as a console.warn rather than a throw — `migrate.yml` seeds PRODUCTION on every push to `main`, where a throw turns the job red on every subsequent push and cannot clear itself by re-running',
  );
  // CAT-3 A2-i (spec rule 7): the report is COUNTS ONLY. It used to name the seed slug, but that slug
  // is also the household's own row's slug, which says what they typed. The operator lists the rows
  // from their own console (docs/runbooks.md → "the seed's shadow guard fired").
  assert.ok(
    /share a legacy seed slug and 1 share a library slug/.test(guardMessage),
    'TEN-2c SHADOW REPORT: …it COUNTS the shadowed row (CAT-3 A2-i: counts only)',
  );
  assert.ok(
    !guardMessage.includes(shadowed.slug),
    'TEN-2b / CAT-3 A2-i: …and the report does NOT name the slug — a slug a household also holds says what that household typed, and this log is public',
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
  await db.delete(schema.movements).where(eq(schema.movements.publicId, SHADOW_PUBLIC_ID));
  const quietMessage = await captureOutput(async () => {
    await seed(asPg, { fixtures: true });
  });
  // What the test means, not "prints nothing": since CAT-3 A2-i the seed also prints its catalog
  // counts, which A2-ii's fixture seed will do on every run. ⚠️ CAT-3 F1-i: the fixture world's own
  // items now include rows on old built-in slugs (no global row holds those any more), so a fixtures
  // seed's legacy-slug count is never 0 here; CAT-3 PR 3 retires that count. The library count is the
  // one this probe moved.
  assert.ok(
    !/and [1-9]\d* share a library slug/.test(quietMessage),
    'TEN-2c: …and with no shadow the seed counts no household row on a library slug — the probe row is gone from the report (CAT-3 F1-i)',
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
      'the curated row and WARNS instead of throwing (as counts only, never a slug or the household’s free ' +
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
  // to whatever id the seed names. The two account corrections (`household-claim-…` and, since
  // PRIV-3 RC, `create-household-…`) are the only writers.
  const seededMembers = await db.select().from(schema.householdMembers);
  assert.equal(
    seededMembers.length,
    0,
    'AUTH-1 1b: the seed writes NO household_members row — the two account corrections are the only writers',
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

  // (5) The deletion-order proof that stood here (memberships before the household row) is
  // subsumed by `verify/erasure.ts` (PRIV-3 2a): P2 holds every FK into the graph child before
  // parent against `pg_constraint`, and P3 runs the whole delete in that order.

  // (6) THE CLAIM CORRECTION, exercised rather than read. A correction nobody has run is a
  // correction nobody has tested, and this one performs the single write that 1c's whole resolver
  // depends on. Its `run` is called directly — the `nullRoutineToFull` precedent above — because the
  // runner needs a DATABASE_URL and PGlite has none.
  const claim = CORRECTIONS.find((c) => c.name === 'household-claim-2026-10-25');
  assert.ok(claim, 'AUTH-1 1b: the claim correction is in the registry');

  // Letters and digits only after `user_`: the claim checks `CLERK_USER_ID_PATTERN` since PRIV-3 RC.
  const CLERK_C = 'user_verifyclaim';
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
      dry.some((l) => lineText(l).includes(CLERK_C)),
      'AUTH-1 1b: the dry run names the FULL Clerk id — a truncated one cannot be checked',
    );
    assert.ok(
      dry.length > 0 && !dry.some(isNote),
      'AUTH-1 1b: the claim dry run is a CHANGE, so the runner counts it (2026-11-19)',
    );

    // (6d) --apply writes once, and a SECOND run is an idempotent no-op rather than a 23505.
    const claimed = await claim.run(asCorrectionDb, true);
    assert.ok(
      claimed.length > 0 && !claimed.some(isNote),
      'AUTH-1 1b: the claim --apply is a CHANGE, so the runner counts the write (2026-11-19)',
    );
    assert.equal(
      (await membershipHousehold(asPg, CLERK_C))[0]?.householdId,
      verifyHh.id,
      'AUTH-1 1b: --apply binds the account to the NAMED household',
    );
    const again = await claim.run(asCorrectionDb, true);
    assert.ok(
      again.some((l) => lineText(l).includes('already claimed')),
      'AUTH-1 1b: a re-run is an idempotent no-op, not a duplicate-key crash (rule 2)',
    );
    assert.ok(
      again.length > 0 && again.every(isNote),
      'AUTH-1 1b: …and the re-run returns notes only, so the runner counts no change (2026-11-19)',
    );

    // (6e) 🔴 The case `INSERT … WHERE NOT EXISTS` could not have told apart: the SAME Clerk id
    // pointed at a DIFFERENT household must REFUSE, not silently no-op.
    // ⚠️ A second NON-seed household, not the seed's (PRIV-3 RC, D6): the claim refuses a seed id
    // outside a local or preview database, and CI runs this with no database URL at all, so a seed
    // id here would prove D6's refusal in CI and this one locally.
    const OTHER_HH_PUBLIC_ID = newId();
    await asPg
      .insert(schema.households)
      .values({ publicId: OTHER_HH_PUBLIC_ID, name: 'verify 1b second household' });
    process.env.HOUSEHOLD_PUBLIC_ID = OTHER_HH_PUBLIC_ID;
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

  // ── PRIV-3 RC — the seed-household refusal and `create-household-…`, exercised (D9) ──────────
  //
  // Each case pins the environment through `withEnv` and restores it in a `finally`, so a failing
  // case cannot leak a target into the next. Both database URLs are REMOVED where a case needs a
  // non-local target: `correctionTargetUrl()` then resolves `undefined`, which every guard treats as
  // not local and not the preview — the (6f) idiom. A run expected to succeed goes through `orFail`;
  // a run expected to refuse goes through `assert.rejects` with a message regex and a message, so
  // either way a thrown error fails a NAMED assertion (the mutations README's rule).
  //
  // With a `consoleSink`, `console.log` / `info` / `warn` / `error` push into it instead of printing
  // for the length of `fn`, and are restored in the same `finally`: a correction that logged an
  // account itself, rather than returning it, would otherwise reach the terminal unseen by (6k).
  const CONSOLE_METHODS = ['log', 'info', 'warn', 'error'] as const;
  const withEnv = async <T>(
    vars: Readonly<Record<string, string | undefined>>,
    fn: () => Promise<T>,
    consoleSink?: string[],
  ): Promise<T> => {
    const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    const consoleBefore = CONSOLE_METHODS.map((m) => console[m]);
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (consoleSink) {
      for (const m of CONSOLE_METHODS) {
        console[m] = (...args: unknown[]) => {
          consoleSink.push(args.map(String).join(' '));
        };
      }
    }
    try {
      return await fn();
    } finally {
      CONSOLE_METHODS.forEach((m, i) => {
        console[m] = consoleBefore[i]!;
      });
      for (const [k, v] of Object.entries(before)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };
  const NO_TARGET = { DATABASE_URL: undefined, DATABASE_URL_UNPOOLED: undefined } as const;

  // (6g) 🔴 The claim refuses a SEED household id on a target that is neither local nor the preview
  // (D6). `target-url.test.ts` drives the predicate; this proves it is WIRED into the correction.
  // A dry run on purpose: without the refusal it returns a line instead of throwing.
  await withEnv(
    {
      ...NO_TARGET,
      HOUSEHOLD_PUBLIC_ID: SEED_HOUSEHOLD_PUBLIC_ID,
      CLERK_USER_ID: 'user_verifyseedclaim',
    },
    () =>
      assert.rejects(
        () => claim.run(asCorrectionDb, false),
        /whose public_id is one the seed writes/,
        'PRIV-3 RC (6g): the claim correction refuses a seed household id on a non-local, non-preview target',
      ),
  );

  const create = CORRECTIONS.find((c) => c.name === CREATE_HOUSEHOLD_NAME);
  assert.ok(create, 'PRIV-3 RC: the create-household correction is in the registry');

  // Visibly synthetic accounts, never read off a dashboard.
  const RC_A = 'user_rcfixture000a';
  const RC_B = 'user_rcfixture000b';
  const RC_C = 'user_rcfixture000c';
  const RC_D = 'user_rcfixture000d';
  const RC_MALFORMED = 'someone@example.com';
  /** Everything (6h)–(6n) returned, logged or threw, for (6k). */
  const rcOutput: string[] = [];
  const captured = (re: RegExp) => (e: unknown) => {
    const err = e as Error;
    rcOutput.push(err.message, String(err.cause ?? ''), err.stack ?? '');
    return re.test(err.message);
  };
  const householdCount = async () => (await asPg.select().from(schema.households)).length;
  const memberCount = async () => (await asPg.select().from(schema.householdMembers)).length;

  await withEnv(
    { ...NO_TARGET, [CREATE_HOUSEHOLD_ACCOUNTS_ENV]: `${RC_A} ${RC_B}` },
    async () => {
      // (6h) The dry run writes nothing and says how many it would create and bind; --apply then
      // creates exactly one household and one OWNER membership per account, none with a seed id.
      const householdsBefore = await householdCount();
      const membersBefore = await memberCount();
      const dryRaw = await orFail('PRIV-3 RC (6h): the create-household dry run completes', () =>
        create.run(asCorrectionDb, false),
      );
      assert.ok(
        dryRaw.length > 0 && !dryRaw.some(isNote),
        'PRIV-3 RC (6h): the create-household dry run is a CHANGE, so the runner counts it',
      );
      const dry = dryRaw.map(lineText);
      rcOutput.push(...dry);
      assert.ok(
        dry.length === 1 && dry[0]!.startsWith('would create 1 household with 2 account(s)'),
        'PRIV-3 RC (6h): the dry run prints one line, the household and account counts',
      );
      assert.deepEqual(
        [await householdCount(), await memberCount()],
        [householdsBefore, membersBefore],
        'PRIV-3 RC (6h): the create-household dry run writes nothing',
      );

      const appliedRaw = await orFail(
        'PRIV-3 RC (6h): the create-household --apply completes',
        () => create.run(asCorrectionDb, true),
      );
      assert.ok(
        appliedRaw.length > 0 && !appliedRaw.some(isNote),
        'PRIV-3 RC (6h): the create-household --apply is a CHANGE, so the runner counts the write',
      );
      const applied = appliedRaw.map(lineText);
      rcOutput.push(...applied);
      const members = await asPg
        .select({
          publicId: schema.householdMembers.publicId,
          householdId: schema.householdMembers.householdId,
          role: schema.householdMembers.role,
        })
        .from(schema.householdMembers)
        .where(
          and(
            inArray(schema.householdMembers.clerkUserId, [RC_A, RC_B]),
            isNull(schema.householdMembers.deletedAt),
          ),
        );
      const [created] = await asPg
        .select({ publicId: schema.households.publicId, name: schema.households.name })
        .from(schema.households)
        .where(eq(schema.households.id, members[0]?.householdId ?? -1));
      assert.ok(
        (await householdCount()) === householdsBefore + 1 &&
          members.length === 2 &&
          new Set(members.map((m) => m.householdId)).size === 1 &&
          members.every((m) => m.role === HOUSEHOLD_ROLE.owner) &&
          created?.name === HOUSEHOLD_DEFAULT_NAME,
        'PRIV-3 RC (6h): --apply creates exactly one household and binds both accounts to it as owner',
      );
      assert.ok(
        ![created!.publicId, ...members.map((m) => m.publicId)].some((id) =>
          SEED_PUBLIC_IDS.has(id),
        ),
        'PRIV-3 RC (6h): no public_id the correction mints is in SEED_PUBLIC_IDS',
      );

      // (6i) A second --apply with the same accounts is a refusal that writes nothing (D4).
      await assert.rejects(
        () => create.run(asCorrectionDb, true),
        captured(/^2 of 2 accounts already have a live membership; nothing written/),
        'PRIV-3 RC (6i): a second create-household --apply refuses with the live-membership count',
      );
      assert.deepEqual(
        [await householdCount(), await memberCount()],
        [householdsBefore + 1, membersBefore + 2],
        'PRIV-3 RC (6i): the refused second run wrote nothing',
      );
    },
    rcOutput,
  );

  // (6i) continued — the "this step is done" hint is given ONLY when every account is bound and all
  // to one household. A partial overlap, or accounts in different households, gets the count alone.
  await withEnv(
    { ...NO_TARGET, [CREATE_HOUSEHOLD_ACCOUNTS_ENV]: `${RC_A} ${RC_D}` },
    () =>
      assert.rejects(
        () => create.run(asCorrectionDb, true),
        captured(
          /^1 of 2 accounts already have a live membership \(in 1 household\(s\)\); nothing written$/,
        ),
        'PRIV-3 RC (6i): a partial overlap refuses with its count and no "this step is done" hint',
      ),
    rcOutput,
  );
  await withEnv(
    { ...NO_TARGET, [CREATE_HOUSEHOLD_ACCOUNTS_ENV]: `${RC_A} ${CLERK_C}` },
    () =>
      assert.rejects(
        () => create.run(asCorrectionDb, true),
        captured(
          /^2 of 2 accounts already have a live membership \(in 2 household\(s\)\); nothing written$/,
        ),
        'PRIV-3 RC (6i): accounts bound in two households refuse with no "this step is done" hint',
      ),
    rcOutput,
  );

  // (6j) A real-shaped account beside the committed fixture principal, on a non-local target: refused
  // at position 2, before any write (D2). --apply on purpose, so "writes nothing" means something.
  await withEnv(
    { ...NO_TARGET, [CREATE_HOUSEHOLD_ACCOUNTS_ENV]: `${RC_C} ${E2E_SESSION_BYPASS_USER}` },
    async () => {
      const before = [await householdCount(), await memberCount()];
      await assert.rejects(
        () => create.run(asCorrectionDb, true),
        captured(/^account 2 of 2 is the committed e2e fixture principal/),
        'PRIV-3 RC (6j): create-household refuses the fixture principal on a non-local target, at its position',
      );
      assert.deepEqual(
        [await householdCount(), await memberCount()],
        before,
        'PRIV-3 RC (6j): the refused run created no household and no membership',
      );
    },
    rcOutput,
  );

  /** A refused --apply of `accounts` under `vars`: it must match `re` and write nothing. */
  const refusedApply = (
    label: string,
    vars: Readonly<Record<string, string | undefined>>,
    re: RegExp,
    what: string,
  ) =>
    withEnv(
      vars,
      async () => {
        const before = [await householdCount(), await memberCount()];
        await assert.rejects(
          () => create.run(asCorrectionDb, true),
          captured(re),
          `PRIV-3 RC (${label}): ${what}`,
        );
        assert.deepEqual(
          [await householdCount(), await memberCount()],
          before,
          `PRIV-3 RC (${label}): the refused run created no household and no membership`,
        );
      },
      rcOutput,
    );

  // (6l) The preview database is refused as a target (D5), even with every account well-formed and
  // free. Only the unpooled string is set: it is what the runner connects with.
  await refusedApply(
    '6l',
    {
      DATABASE_URL: undefined,
      DATABASE_URL_UNPOOLED: 'postgres://u@ep-x.invalid/mat_plan_preview',
      [CREATE_HOUSEHOLD_ACCOUNTS_ENV]: `${RC_C} ${RC_D}`,
    },
    /^the target is the preview database/,
    'create-household refuses the preview database as its target',
  );

  // (6m) A malformed account is refused at its position, without echoing it (most likely a pasted
  // email address).
  await refusedApply(
    '6m',
    { ...NO_TARGET, [CREATE_HOUSEHOLD_ACCOUNTS_ENV]: `${RC_C} ${RC_MALFORMED}` },
    /^account 2 of 2 is not shaped/,
    'create-household refuses a malformed account, at its position',
  );

  // (6n) A repeated account is refused by position: binding it once would hide the one that is missing.
  await refusedApply(
    '6n',
    { ...NO_TARGET, [CREATE_HOUSEHOLD_ACCOUNTS_ENV]: `${RC_C} ${RC_C}` },
    /^account 2 of 2 repeats account 1/,
    'create-household refuses a repeated account, at its position',
  );

  // (6k) 🔴 Nothing (6h)–(6n) returned, logged, threw, caused or stacked names an input account.
  assert.ok(
    rcOutput.length >= 23,
    'PRIV-3 RC (6k): non-vacuity — the dry run, the apply and all seven refusals were captured',
  );
  assert.ok(
    !rcOutput.some((text) =>
      [RC_A, RC_B, RC_C, RC_D, RC_MALFORMED, CLERK_C, E2E_SESSION_BYPASS_USER].some((id) =>
        text.includes(id),
      ),
    ),
    'PRIV-3 RC (6k): nothing create-household printed or threw names an input account',
  );

  console.log(
    '✓ PRIV-3 RC: the claim refuses a seed household off local and preview (6g); create-household ' +
      'dry-runs, creates one household with two owners and no seed id (6h), refuses a second run ' +
      '(6i, with the "done" hint only when it is), the fixture principal (6j), the preview (6l), ' +
      'a malformed (6m) and a repeated (6n) account, and names no account on any path, console ' +
      'included (6k)',
  );

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
  /** The name a form showing this row would carry as `seenName`: the stored one (any for a missing row). */
  const seenNameOf = async (publicId: string) => (await nameOf(publicId)) ?? 'Nobody Stored';

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
  const renamed = await renameProfile(
    asPg,
    A_SCOPE,
    AR_A_P,
    'A-r Renamed',
    await seenNameOf(AR_A_P),
  );
  assert.equal(
    renamedId(renamed),
    AR_A_P,
    'PROF-1 a-r: renaming an own live athlete returns its id',
  );
  assert.equal(await nameOf(AR_A_P), 'A-r Renamed', 'PROF-1 a-r: the name is persisted');

  // 2 · 🔴 CRITERION 4. B tries to rename A's athlete: zero rows, `null`, and — the half a return
  // value alone would not catch — A's name is UNTOUCHED.
  assert.equal(
    renamedId(
      await renameProfile(
        asPg,
        B_SCOPE,
        AR_A_P,
        'Renamed By The Wrong Household',
        await seenNameOf(AR_A_P),
      ),
    ),
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
    renamedId(
      await renameProfile(
        asPg,
        A_SCOPE,
        AR_B_P,
        'Renamed By The Wrong Household',
        await seenNameOf(AR_B_P),
      ),
    ),
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
    renamedId(
      await renameProfile(
        asPg,
        A_SCOPE,
        AR_A_DELETED,
        'Renamed A Dead Row',
        await seenNameOf(AR_A_DELETED),
      ),
    ),
    'REFUSED:refused',
    'PROF-1 a-r: a soft-deleted profile updates 0 rows even for its own household',
  );
  assert.equal(await nameOf(AR_A_DELETED), 'A-r Deleted', 'PROF-1 a-r: the dead row is untouched');

  // 4 · An unknown id is refused the same way, so the three refusals are one answer (ADR 0006).
  assert.equal(
    renamedId(
      await renameProfile(
        asPg,
        A_SCOPE,
        '019826b4-0000-7000-8000-00000004d0ff',
        'Nobody',
        await seenNameOf('019826b4-0000-7000-8000-00000004d0ff'),
      ),
    ),
    'REFUSED:refused',
    'PROF-1 a-r: an unknown public id updates 0 rows',
  );

  // 5 · 🔴 AN ARCHIVED ATHLETE **CAN** BE RENAMED. The opposite direction from every case above, and
  // the "fix" a future author is most likely to reach for: archive is "not currently training", not
  // a lock (`schema.ts` → `profiles.archivedAt`), so a typo in an archived athlete's name must be
  // fixable without restoring them first. If this ever fails, a UX filter has been folded into the
  // ownership seam. Mutation patch `13-rename-locks-archived` is what proves this assertion can fail.
  assert.equal(
    renamedId(
      await renameProfile(
        asPg,
        A_SCOPE,
        AR_A_ARCHIVED,
        'A-r Archived Renamed',
        await seenNameOf(AR_A_ARCHIVED),
      ),
    ),
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
    renamedId(await renameProfile(asPg, A_SCOPE, AR_A_P, AT_CAP, await seenNameOf(AR_A_P))),
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
  const casingFix = await renameProfile(
    asPg,
    A_SCOPE,
    twinTwo.publicId,
    'REN TWIN',
    await seenNameOf(twinTwo.publicId),
  );
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
  const collide = await renameProfile(
    asPg,
    A_SCOPE,
    twinTwo.publicId,
    'Ren Other',
    await seenNameOf(twinTwo.publicId),
  );
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
      await renameProfile(
        asPg,
        A_SCOPE,
        twinTwo.publicId,
        'Ren Other',
        await seenNameOf(twinTwo.publicId),
        {
          acknowledgedDuplicate: foldName('Ren Other'),
        },
      ),
    ),
    twinTwo.publicId,
    'PROF-1 a-1d-ren: an acknowledgement waves the collision through — advisory, not a constraint',
  );

  // An acknowledgement for a DIFFERENT folded name does not wave this one through.
  // ⚠️ Discriminated on `reason`, not on `.ok === false` alone: a writer that answered `refused` for
  // any reason would otherwise pass a test named for the acknowledgement, which is the shape
  // `db:mutations` exists to catch. The read-back is the other half — a warning must write nothing.
  const staleAck = await renameProfile(
    asPg,
    A_SCOPE,
    twinTwo.publicId,
    'Ren Twin',
    await seenNameOf(twinTwo.publicId),
    {
      acknowledgedDuplicate: foldName('Somebody Else'),
    },
  );
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
    renamedId(await renameProfile(asPg, B_SCOPE, AR_A_P, 'B Oracle', await seenNameOf(AR_A_P))),
    'REFUSED:refused',
    'PROF-1 a-1d-ren: household B renaming A’s athlete to a name B HOLDS answers refused, never ' +
      'duplicate — the fold guard’s pre-read is scoped, and a leak here would be an oracle on A’s ' +
      'stored name',
  );

  // ── The stale-rename fix: a rename applies only if the stored name is still the one the form
  //    showed (`seenName`, the `seenValue` idiom), a replay is `ok`, and a stale one beats the
  //    duplicate warning (plan: docs/plans/td-stale-rename-refused.md). Its own two athletes, so the
  //    a-r ids above keep their histories.
  const ST_P = '019826b4-0000-7000-8000-00000004d005';
  const ST_RIVAL_NAME = 'Stale Rival Athlete';
  await db.insert(schema.profiles).values([
    { publicId: ST_P, name: 'Stale Start', kind: PROFILE_KIND.kid, householdId: households[0].id },
    {
      publicId: '019826b4-0000-7000-8000-00000004d006',
      name: ST_RIVAL_NAME,
      kind: PROFILE_KIND.kid,
      householdId: households[0].id,
    },
  ]);

  // (a) Stale: the form showed another name. Refused with the stored one, and nothing written.
  assert.deepEqual(
    await renameProfile(asPg, A_SCOPE, ST_P, 'Stale Try', 'Shown Elsewhere'),
    { ok: false, reason: 'stale', current: 'Stale Start' },
    'stale rename: a form showing an out-of-date name is refused with the stored name',
  );
  assert.equal(await nameOf(ST_P), 'Stale Start', 'stale rename: and nothing is written');

  // (b) Stale beats duplicate: the new name collides too, unacknowledged. Mutation 428 (the
  //     pre-read's classification skipped) answers `duplicate` here.
  assert.deepEqual(
    await renameProfile(asPg, A_SCOPE, ST_P, ST_RIVAL_NAME, 'Shown Elsewhere'),
    { ok: false, reason: 'stale', current: 'Stale Start' },
    'stale rename: a stale form whose new name also collides is answered stale, before the duplicate warning',
  );

  // (c) The replay: the Save already landed (stored = the new name), the form still says the old
  //     one. `ok`, no write. Mutation 429 (the replay arm dropped) answers `stale`.
  assert.deepEqual(
    await renameProfile(asPg, A_SCOPE, ST_P, 'Stale Landed', 'Stale Start'),
    { ok: true, publicId: ST_P },
    'stale rename: a fresh rename applies',
  );
  assert.deepEqual(
    await renameProfile(asPg, A_SCOPE, ST_P, 'Stale Landed', 'Stale Start'),
    { ok: true, publicId: ST_P },
    'stale rename: a replay of a Save that landed answers ok, not stale',
  );

  // (d) The race, on one connection: a rival rename runs just before the writer's own UPDATE (after
  //     its pre-read and duplicate guard). The UPDATE's `name = seenName` conjunct matches 0 rows and
  //     the re-read answers stale. Mutation 430 (the conjunct dropped) overwrites and answers `ok`.
  const rivalBeforeUpdate = (rival: () => Promise<unknown>) => {
    let fired = false;
    const builder = (b: object): object =>
      new Proxy(b, {
        get(target, prop, receiver) {
          const v = Reflect.get(target, prop, receiver) as unknown;
          if (prop === 'then') {
            const then = (v as (ok: unknown, err: unknown) => unknown).bind(target);
            return (ok: unknown, err: unknown) => {
              const go = fired ? Promise.resolve() : ((fired = true), rival());
              return go.then(() => then(ok, err), err as never);
            };
          }
          return typeof v === 'function'
            ? (...args: unknown[]) => {
                const out = (v as (...a: unknown[]) => unknown).apply(target, args);
                return out && typeof out === 'object' ? builder(out) : out;
              }
            : v;
        },
      });
    return new Proxy(asPg, {
      get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver) as unknown;
        if (prop === 'update') {
          return (...args: unknown[]) =>
            builder((v as (...a: unknown[]) => object).apply(target, args));
        }
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    }) as typeof asPg;
  };
  const setStoredName = (name: string) => () =>
    db.update(schema.profiles).set({ name }).where(eq(schema.profiles.publicId, ST_P));
  assert.deepEqual(
    await renameProfile(
      rivalBeforeUpdate(setStoredName('Stale Rival')),
      A_SCOPE,
      ST_P,
      'Stale Mine',
      'Stale Landed',
    ),
    { ok: false, reason: 'stale', current: 'Stale Rival' },
    'stale rename: a rename committed between the pre-read and the UPDATE is not overwritten',
  );
  assert.equal(await nameOf(ST_P), 'Stale Rival', 'stale rename: the rival name stands');
  // …and a rival that wrote the SAME name answers ok through the 0-row re-read.
  assert.deepEqual(
    await renameProfile(
      rivalBeforeUpdate(setStoredName('Stale Same')),
      A_SCOPE,
      ST_P,
      'Stale Same',
      'Stale Rival',
    ),
    { ok: true, publicId: ST_P },
    'stale rename: a rival that chose the same name answers ok after the 0-row re-read',
  );

  // …and a row soft-deleted between the read and the write answers refused through the re-read
  // (its own throwaway row, so ST_P's tenancy checks below keep theirs).
  const ST_GONE = '019826b4-0000-7000-8000-00000004d007';
  await db.insert(schema.profiles).values({
    publicId: ST_GONE,
    name: 'Stale Gone',
    kind: PROFILE_KIND.kid,
    householdId: households[0].id,
  });
  const goneUnderUs = rivalBeforeUpdate(() =>
    db
      .update(schema.profiles)
      .set({ deletedAt: new Date() })
      .where(eq(schema.profiles.publicId, ST_GONE)),
  );
  assert.deepEqual(
    await renameProfile(goneUnderUs, A_SCOPE, ST_GONE, 'Stale Gone Renamed', 'Stale Gone'),
    { ok: false, reason: 'refused' },
    'stale rename: a row deleted between the pre-read and the UPDATE answers refused',
  );

  // (e) Tenancy, both ways: another household never learns the name, whatever it sends.
  assert.deepEqual(
    await renameProfile(asPg, B_SCOPE, ST_P, 'B Probe', 'Wrong Seen'),
    { ok: false, reason: 'refused' },
    'stale rename: another household with a wrong seen name is refused, never told the stored name',
  );
  assert.deepEqual(
    await renameProfile(asPg, B_SCOPE, ST_P, 'Stale Same', 'Stale Same'),
    { ok: false, reason: 'refused' },
    'stale rename: another household sending the stored name is refused, never ok',
  );
  assert.equal(await nameOf(ST_P), 'Stale Same', 'stale rename: and B wrote nothing');

  console.log(
    '✓ stale rename: a rename applies only if the stored name is still the one the form showed; a ' +
      'replay is ok; a stale form beats the duplicate warning; a rename between the read and the ' +
      'write is not overwritten; another household learns nothing',
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
  // It answers `ok`, not merely a truthy result object (every arm of `RenameProfileResult` is
  // truthy, which made this assertion unable to fail once the result became discriminated).
  assert.deepEqual(
    await renameProfile(asPg, A_SCOPE, B_P, 'B Athlete Renamed', 'B Athlete'),
    { ok: true, publicId: B_P },
    'PROF-1 b: an ARCHIVED athlete is still renameable — archive is not a lock',
  );
  assert.deepEqual(
    await loggedMonths(asPg, { profilePublicId: B_P, scope: asOwner(A_SCOPE, 'PROF-1 b') }),
    [{ month: '2026-07' }],
    'PROF-1 b: …and the export path still returns an ARCHIVED athlete’s months (criterion 5) — the ' +
      'month this athlete logged, not merely "an array": fold archived_at into isLiveProfile and ' +
      'this returns [] while an Array.isArray check would stay green',
  );

  // (5b) 🔴 THE EXPORT IS THE OWNER'S (FAM-1 export follow-up, plan PR B; the maintainer's Q1,
  // 2026-11-19). `loggedMonths` takes an `OwnerScope` and its WHERE carries `isOwnerOf`, so the real
  // member scope pushed past the type by a cast reads NO months, and the DAL builds no file. The
  // cast is the archive proof's (`A_MEMBER_SCOPE as unknown as OwnerScope`): it is the only way in.
  assert.deepEqual(
    await loggedMonths(asPg, {
      profilePublicId: B_P,
      scope: A_MEMBER_SCOPE as unknown as OwnerScope,
    }),
    [],
    'FAM-1 export: a member scope cast past the type reads no months, so no export file is built',
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

  // The household row is read FOR KEY SHARE, so an erasure mid-call answers `refused`, never a 23503.
  // Waiting is unprovable on PGlite's one connection; the lock MODE is not: a locking read takes
  // RowShareLock on the table and a plain SELECT does not. 🔴 A fresh transaction, and a REPLAY (no
  // insert): any insert of a row that references `households` runs a foreign-key check that takes
  // RowShareLock too and would hide a missing lock (mutation 591).
  await rolledBack(async (tx) => {
    const again = await createProfile(asTx(tx), A_SCOPE, {
      name: 'A-1 Athlete Lock Probe',
      kind: PROFILE_KIND.kid,
      clientId: A_KEY,
    });
    assert.deepEqual(
      again,
      { ok: true, publicId: createdId },
      'PROF-1 a-1w: the lock proof is a replay (no insert takes a foreign-key lock)',
    );
    const modes = (
      await tx.execute(
        sql`select mode from pg_locks where locktype = 'relation' and relation = 'households'::regclass and pid = pg_backend_pid()`,
      )
    ).rows as Array<{ mode: string }>;
    assert.ok(
      modes.some((l) => l.mode === 'RowShareLock'),
      'PROF-1 a-1w: the household row is read FOR KEY SHARE, so an erasure mid-call is refused',
    );
  });

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

// ── TD: the athlete cap holds under concurrent adds (plan: docs/plans/td-athlete-cap-lock.md) ────────
// `createProfile` takes `pg_advisory_xact_lock(ADVISORY_LOCK.householdAthletes, …)` before it counts,
// as `newItem` does (#605). Waiting cannot be shown on PGlite's single connection; the lock and its
// key can. Every case runs in `rolledBack`, so nothing here changes what later blocks count.
await rolledBack(async (tx) => {
  // (1) The lock, keyed by the household. `asTx(tx)`, never `asPg`: on one connection a query on the
  //     pool inside this transaction would wait forever. createProfile's own transaction is a
  //     savepoint here, and an xact lock taken in a savepoint is held until the outer one ends.
  const { set: timeoutSet } = await lockTimeoutSetBy(tx, () =>
    createProfile(asTx(tx), A_SCOPE, {
      name: 'TD Cap Lock Probe',
      kind: PROFILE_KIND.kid,
      clientId: newId(),
    }),
  );
  const [key] = (await tx.execute(sql`select hashint8(${households[0].id}::bigint) as k`))
    .rows as Array<{ k: number }>;
  const locks = (
    await tx.execute(
      sql`select classid::bigint as c, objid::bigint as o from pg_locks where locktype = 'advisory' and objsubid = 2`,
    )
  ).rows as Array<{ c: string | number; o: string | number }>;
  assert.ok(
    locks.some(
      (l) =>
        Number(l.c) === ADVISORY_LOCK.householdAthletes &&
        Number(l.o) === (Number(key!.k) + 2 ** 32) % 2 ** 32,
    ),
    'TD athlete cap: createProfile holds the household-athletes advisory lock, keyed by its household',
  );
  assert.ok(
    timeoutSet,
    'TD lock timeout: createProfile sets lock_timeout before it waits on the household-athletes lock',
  );
});

await rolledBack(async (tx) => {
  // (2) A household that is gone takes no lock, so nothing is counted or written: `refused`.
  const goneKey = newId();
  assert.deepEqual(
    await createProfile(asTx(tx), GONE_SCOPE, {
      name: 'TD Cap Orphan',
      kind: PROFILE_KIND.kid,
      clientId: goneKey,
    }).catch((e: unknown) => ({ threw: String(e).slice(0, 80) })),
    { ok: false, reason: 'refused' },
    'TD athlete cap: createProfile for a household that is gone is refused, never counted unlocked',
  );
  const [stray] = await tx
    .select({ id: schema.profiles.id })
    .from(schema.profiles)
    .where(eq(schema.profiles.clientId, goneKey));
  assert.equal(stray, undefined, 'TD athlete cap: …and writes nothing');
});

await rolledBack(async (tx) => {
  // (3) `findNameMatch`'s exclusion compares in one case: an upper-cased id still excludes its own
  //     row (the stored `uuid` reads back lower-case). Defence in depth: through `createProfile` the
  //     SQL replay lookup ignores case and returns first.
  const key = newId();
  const made = await createProfile(asTx(tx), A_SCOPE, {
    name: 'TD Case Probe',
    kind: PROFILE_KIND.kid,
    clientId: key,
  });
  assert.ok(made.ok, 'TD athlete cap: the case probe athlete is added');
  assert.equal(
    await findNameMatch(asTx(tx), A_SCOPE, foldName('TD Case Probe'), {
      excludeClientId: key.toUpperCase(),
    }),
    null,
    'TD athlete cap: an upper-cased client id still excludes its own row from the name match',
  );
});
console.log(
  '✓ TD athlete cap: createProfile counts under the household lock; a gone household is refused; the exclusion ignores case',
);

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
// for the weigh-in writer, whose refusal is a throw. It does NOT prove the app reports that refusal
// well — `B1-2` owns the envelope. (The old strength writer's case, steps 1–4, was deleted by
// LEGACY-1, which retires that writer; the live row writer's hidden-replay answers are
// `verify/day.ts` 3–3i.)
{
  // The steps run 0, 5, 6 on purpose: 1–4 were the old strength writer's case, deleted by LEGACY-1.
  // Nothing is missing.
  // 0 · 🔴 **The weigh-in writer, the one B0 changes with no arbiter to re-predicate.**
  //      `insertBodyweightEntry` infers no target (`onConflictDoNothing()` — every unique
  //      arbitrates, V1-24 1e), so it has its own three-branch fallback. Post-B0 a replay of a
  //      HIDDEN weigh-in whose day slot has since been freed conflicts on the non-partial
  //      `uq_entries_client_id`, misses (a) because that row is not live, misses (b) because the day
  //      is free, and lands on the throw in (c). **Before B0 it inserted a twin** — the same defect,
  //      through the one writer with no arbiter to re-predicate.
  //
  //      ⚠️ **What this case is and is NOT proven by, probed three ways.** 1e reaches (c) by two
  //      other routes (a foreign metric's `client_id`, an evening-only day), and `db:verify` is
  //      fail-fast with 1e running first, so two of the three single-literal mutations that break
  //      this case break an earlier one too: dropping (a)'s liveness guard reddens 1e's dead-row
  //      case; swallowing the (c) throw reddens 1e's foreign-metric case. The third is this case's
  //      own: restoring the index predicate (`39-client-id-partial-again.patch`) passes every 1e
  //      route, and this assertion is the first it reddens.
  //
  //      What it does catch, and nothing else would: a future change that answers THIS route
  //      plausibly while leaving 1e's routes throwing — a fourth branch that looks up hidden rows
  //      and returns one's id, say, which is the exact "success reported, nothing saved" shape (a)'s
  //      liveness guard exists to prevent. It also pins the no-twin count.
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
                            'uq_entry_set_quantities_set_slot', ${schema.BODYWEIGHT_DAY_UNIQUE_INDEX})`,
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
    '✓ V1-9b B0: a hide no longer frees a client_id — replaying a hidden weigh-in is REFUSED ' +
      'rather than twinned, the five identity arbiters carry no predicate on the live schema, and the ' +
      'slot arbiters still do',
  );
}

// ── V1-9b B1-1 — the check-in writer tells four outcomes apart ────────────────────────────────────
//
// 🔴 **This section is the reason the insert moved out of `apps/web/lib/dal/entries.ts`**
// (correctness 6). Its only coverage there was an emitted-SQL assertion — the SHAPE of the query,
// never its behaviour against rows — and `verify.ts` imports only `../src/*`, so a writer the app
// keeps to itself is a writer no real database ever tests.
//
// What changed to make a boolean insufficient: **B0** made the five `client_id` arbiters
// non-partial, so a hidden row no longer *shares* its `client_id`, it **holds** it. A replay of a
// hidden check-in therefore conflicts instead of twinning — and the old code read that conflict as
// `created: false`, which the action renders as "already logged" about a row that was deleted.
//
// ⚠️ Four outcomes, and the only one that is a behaviour change is `own_hidden`. `created` and
// `replay` are what the boolean already distinguished; `conflict` and `own_hidden` are the two
// meanings it collapsed into one. Nothing user-visible moves until `B1-2` maps them.
{
  const CI_DAY = '2026-02-19';
  const ciActivityId = await activityTypeIdByKey('brush_teeth');
  // The two session fixtures already in scope, rather than a third pair re-queried by public id —
  // `conflict` only means anything if these are genuinely different rows, so that is asserted.
  const ciProfile = sessionProfileA;
  const otherProfile = sessionProfileB;
  assert.notEqual(
    ciProfile.id,
    otherProfile.id,
    'V1-9b B1-1: the two profile fixtures are different rows, or `conflict` cannot be distinguished',
  );

  const ciValue = (clientId: string) => ({
    publicId: newId(),
    clientId,
    activityDate: CI_DAY,
    unit: 'count',
    valueNum: '1',
    activityTypeId: ciActivityId,
    metricKey: null,
    status: ENTRY_STATUS.done,
  });

  const CID_CREATED = '019826b4-0000-7000-8000-00000000c101';
  const CID_HIDDEN = '019826b4-0000-7000-8000-00000000c102';
  const CID_FOREIGN = '019826b4-0000-7000-8000-00000000c103';

  // 1 · `created` — the ordinary path, and the only outcome that writes.
  const first = await writeCheckinEntries(asPg, {
    profileId: ciProfile.id,
    values: [ciValue(CID_CREATED), ciValue(CID_HIDDEN)],
  });
  assert.deepEqual(
    first.map((r) => r.outcome),
    ['created', 'created'],
    'V1-9b B1-1: a first write creates every row',
  );

  // 2 · Hide one of them the way V1-9b will — `deleted_at` on the row, nothing else.
  await db
    .update(schema.entries)
    .set({ deletedAt: new Date() })
    .where(eq(schema.entries.clientId, CID_HIDDEN));

  // 3 · Another profile takes a third id, so the same submit can meet a foreign holder.
  await db.insert(schema.entries).values({ ...ciValue(CID_FOREIGN), profileId: otherProfile.id });

  // 4 · Replay all three in ONE call: a live row, a hidden row, and another profile's row.
  //     🔴 This is the assertion the mutation patch reddens. Collapse `own_hidden` into `replay`
  //     (or drop the `deleted_at` branch) and the middle element changes.
  const replay = await writeCheckinEntries(asPg, {
    profileId: ciProfile.id,
    values: [ciValue(CID_CREATED), ciValue(CID_HIDDEN), ciValue(CID_FOREIGN)],
  });
  assert.deepEqual(
    replay.map((r) => r.outcome),
    ['replay', 'own_hidden', 'conflict'],
    "V1-9b B1-1: a live row replays, this profile's hidden row is own_hidden, and another " +
      "profile's row is a conflict — never all three as one boolean",
  );

  // 5 · The hidden row STAYS hidden, and was not twinned. The whole point of B0, re-proved one
  //     level up: the refusal must not have written anything.
  const hiddenRows = await db
    .select({ id: schema.entries.id, deletedAt: schema.entries.deletedAt })
    .from(schema.entries)
    .where(eq(schema.entries.clientId, CID_HIDDEN));
  assert.equal(hiddenRows.length, 1, 'V1-9b B1-1: the hidden check-in was not twinned by a replay');
  assert.ok(hiddenRows[0].deletedAt !== null, 'V1-9b B1-1: …and it is still hidden');

  // 6 · `replay` carries the ORIGINAL row's public id, not a fresh one. A caller that re-linked a
  //     receipt to a newly minted id would point at a row that does not exist.
  const [liveRow] = await db
    .select({ publicId: schema.entries.publicId })
    .from(schema.entries)
    .where(and(eq(schema.entries.clientId, CID_CREATED), isNull(schema.entries.deletedAt)));
  const replayed = replay[0];
  assert.ok(replayed.outcome === 'replay', 'V1-9b B1-1: the live id replayed');
  assert.equal(
    replayed.publicId,
    liveRow.publicId,
    'V1-9b B1-1: a replay returns the EXISTING row public id',
  );

  // 7 · An empty submit writes nothing and asks the database nothing.
  assert.deepEqual(
    await writeCheckinEntries(asPg, { profileId: ciProfile.id, values: [] }),
    [],
    'V1-9b B1-1: an empty item list is a no-op',
  );

  console.log(
    '✓ V1-9b B1-1: the check-in writer distinguishes created / replay / own_hidden / conflict — a ' +
      "replay of this profile's HIDDEN row is never reported as logged, and never twinned",
  );
}

// ── V1-9b B1-1b — hide and restore, and every reader that must not see a tombstone ────────────────
//
// 🔴 **The reader audit comes first, because it is the claim with the widest blast radius.** ADR 0008
// decision 2 says a hidden row is invisible everywhere except the surface built to show it. That is
// a statement about EVERY query in the app, so it is proved one reader at a time rather than
// asserted in a docblock. `docs/features/delete-and-restore.md` carries the table; this is its proof.
//
// ⚠️ **The trap this section exists for:** `ON DELETE CASCADE` is hard-delete only. Hiding an entry
// leaves its `entry_sets` and `entry_set_quantities` rows with `deleted_at IS NULL` — live children
// of a dead parent — so a reader that filters only its own table still returns them. Every reader
// below therefore has to reach ownership through the PARENT, and that is what is asserted.
{
  const HIDE_DAY = '2026-08-04';
  const hideScope = A_SCOPE;
  const hideProfilePublicId = '019826b4-0000-7000-8000-0000000009a0'; // sessionProfileA
  const bwActivityId = await activityTypeIdByKey('weigh_in');

  const uuidArrayOf = (ids: readonly string[]) => sql`${sql.param(ids)}::uuid[]`;

  const bwEntry = async (publicId: string, day: string, value: number) => {
    const [row] = await db
      .insert(schema.entries)
      .values({
        publicId,
        clientId: newId(),
        profileId: sessionProfileA.id,
        activityDate: day,
        kind: ENTRY_KIND.bodyweight,
        unit: 'lb',
        valueNum: String(value),
        activityTypeId: bwActivityId,
        metricKey: SEED_METRIC_KEYS.bodyweight,
        status: ENTRY_STATUS.done,
      })
      .returning({ id: schema.entries.id });
    return row;
  };

  // ── 1 · A hide is one event, and its token survives six fractional digits ──────────────────────
  //
  // The token is TEXT end to end. Postgres stores microseconds; a JS `Date` holds milliseconds, so a
  // token that round-trips through drizzle's date mapping comes back ROUNDED and no longer matches
  // its own row. Mutation 41 maps it through `new Date(...).toISOString()` and this goes red.
  const E1 = '019826b4-0000-7000-8000-00000000d101';
  const E2 = '019826b4-0000-7000-8000-00000000d102';
  await bwEntry(E1, HIDE_DAY, 60);

  // Three ids hidden in ONE transaction share ONE token — `now()`, not `clock_timestamp()`.
  const M1 = '019826b4-0000-7000-8000-00000000d201';
  const M2 = '019826b4-0000-7000-8000-00000000d202';
  const M3 = '019826b4-0000-7000-8000-00000000d203';
  const MULTI_DAY = '2026-08-05';
  for (const [i, id] of [M1, M2, M3].entries()) {
    await db.insert(schema.entries).values({
      publicId: id,
      clientId: newId(),
      profileId: sessionProfileA.id,
      activityDate: MULTI_DAY,
      unit: 'count',
      valueNum: String(i + 1),
      activityTypeId: await activityTypeIdByKey('brush_teeth'),
      metricKey: null,
      status: ENTRY_STATUS.done,
    });
  }
  // 🔴 **TWO hide statements, 10 ms apart, in ONE transaction.** The first version hid all three ids
  // in a single UPDATE and slept *after* it — which proves nothing: `now()` is stable within one
  // statement no matter what, so a `clock_timestamp()` mutation stayed green. A db-safety lens
  // measured PGlite's `clock_timestamp()` at millisecond resolution, so 10 ms between two statements
  // is what makes the transaction-scoped property observable here. This is also the shape a swap
  // relies on: hide the holder and restore the item in one transaction, one event.
  const multi = await db.transaction(async (tx) => {
    const first = await hideEntries(asTx(tx), {
      profilePublicId: hideProfilePublicId,
      scope: hideScope,
      day: MULTI_DAY,
      entryPublicIds: [M1],
    });
    await tx.execute(sql`select pg_sleep(0.01)`);
    const rest = await hideEntries(asTx(tx), {
      profilePublicId: hideProfilePublicId,
      scope: hideScope,
      day: MULTI_DAY,
      entryPublicIds: [M2, M3],
    });
    assert.ok('hiddenAt' in first && 'hiddenAt' in rest, 'V1-9b B1-1b: both hides succeed');
    assert.equal(
      first.hiddenAt,
      rest.hiddenAt,
      'V1-9b B1-1b: 🔴 two statements 10ms apart in ONE transaction share ONE token — this is the ' +
        'assertion `clock_timestamp()` breaks, and a single-statement hide could never have shown it',
    );
    return rest;
  });
  assert.ok('hiddenAt' in multi, 'V1-9b B1-1b: hiding three ids in one call succeeds');
  const multiTokens = await db
    .select({
      t: sql<string>`to_char(${schema.entries.deletedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(schema.entries)
    .where(
      sql`${schema.entries.publicId} = any(array[${sql.join(
        [M1, M2, M3].map((i) => sql`${i}`),
        sql`, `,
      )}]::uuid[])`,
    );
  assert.equal(
    new Set(multiTokens.map((r) => r.t)).size,
    1,
    'V1-9b B1-1b: three rows hidden in ONE transaction share ONE token — now(), not clock_timestamp()',
  );
  assert.match(
    multi.hiddenAt,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/,
    'V1-9b B1-1b: the token is fixed-format UTC text with six fractional digits',
  );

  // 🔴 **The microsecond case needs a hand-written `deleted_at`, and finding that out is the point.**
  // The first version of this proof restored by the token `now()` had just produced and called that
  // the round-trip test. It was **vacuous**: PGlite's `now()` resolves to MILLISECONDS, so a token
  // mapped through a JS `Date` loses nothing and mutation 41 stayed green. `db:verify` runs on
  // PGlite, so the trap this guards cannot be reproduced from the clock at all — the plan's own test
  // plan says to set the fixture's `deleted_at` to six fractional digits, and this is why.
  await db
    .update(schema.entries)
    .set({ deletedAt: sql`timestamptz '2026-08-05 12:00:00.123456+00'` })
    .where(sql`${schema.entries.publicId} = any(${uuidArrayOf([M1, M2, M3])})`);
  const [microToken] = await db
    .select({
      t: sql<string>`to_char(${schema.entries.deletedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(schema.entries)
    .where(eq(schema.entries.publicId, M1));
  assert.equal(
    microToken.t,
    '2026-08-05T12:00:00.123456Z',
    'V1-9b B1-1b: the read emits all six fractional digits (a truncating format would pass every ' +
      'other assertion here)',
  );

  // Restoring BY that token succeeds only if the writer compared the TEXT. Mutation 41 maps it
  // through `new Date(...)`, which truncates `.123456` to `.123000`, matches zero rows, and reports
  // `changed` — an item the person cannot get back, with no error anywhere.
  const restoredByToken = await db.transaction((tx) =>
    restoreHidden(asTx(tx), {
      profilePublicId: hideProfilePublicId,
      scope: hideScope,
      day: MULTI_DAY,
      hiddenAt: microToken.t,
      entryPublicIds: [M1, M2, M3],
    }),
  );
  assert.deepEqual(
    restoredByToken.map((r) => r.reason),
    ['ok', 'ok', 'ok'],
    'V1-9b B1-1b: the six-digit token matches its own rows — a Date round-trip would not',
  );

  // ── 2 · All or nothing, and a replay ──────────────────────────────────────────────────────────
  const foreignHide = await db.transaction((tx) =>
    hideEntries(asTx(tx), {
      profilePublicId: hideProfilePublicId,
      scope: hideScope,
      day: HIDE_DAY,
      entryPublicIds: [E1, E2], // E2 was never created
    }),
  );
  assert.deepEqual(
    foreignHide,
    { notFound: true },
    'V1-9b B1-1b: one unknown id makes the WHOLE hide notFound — never a partial hide',
  );
  const [stillLive] = await db
    .select({ deletedAt: schema.entries.deletedAt })
    .from(schema.entries)
    .where(eq(schema.entries.publicId, E1));
  assert.equal(stillLive.deletedAt, null, 'V1-9b B1-1b: …and the valid id stayed live');

  const hide1 = await db.transaction((tx) =>
    hideEntries(asTx(tx), {
      profilePublicId: hideProfilePublicId,
      scope: hideScope,
      day: HIDE_DAY,
      entryPublicIds: [E1],
    }),
  );
  assert.ok('hiddenAt' in hide1, 'V1-9b B1-1b: the weigh-in hides');
  const hide1Replay = await db.transaction((tx) =>
    hideEntries(asTx(tx), {
      profilePublicId: hideProfilePublicId,
      scope: hideScope,
      day: HIDE_DAY,
      entryPublicIds: [E1],
    }),
  );
  assert.deepEqual(
    hide1Replay,
    hide1,
    'V1-9b B1-1b: hiding an already-hidden entry is a REPLAY with the same token, not notFound ' +
      '(the row count of the UPDATE is zero — reading that as the answer is the obvious bug)',
  );

  // ── 2b · A MIXED hide, and the retry that used to answer notFound ─────────────────────────────
  //
  // 🔴 **The regression test for a real bug, found by a correctness lens and not by any gate.** Two
  // devices render the same day. Device 2 hides X. Device 1 taps Delete on [X, Y]: X is already
  // hidden, Y is not, so a NEW event covers Y. If the response is lost and the client retries the
  // identical call, every id is now hidden under two different tokens — and the first version of
  // this writer demanded a single shared token, so it answered `notFound` for rows that exist, are
  // owned, and are hidden. The fix returns the NEWEST token, so the retry repeats the first answer.
  {
    const MX = '019826b4-0000-7000-8000-00000000d801';
    const MY = '019826b4-0000-7000-8000-00000000d802';
    const MIX_DAY = '2026-08-08';
    await bwEntry(MX, MIX_DAY, 64);
    await db.insert(schema.entries).values({
      publicId: MY,
      clientId: newId(),
      profileId: sessionProfileA.id,
      activityDate: MIX_DAY,
      unit: 'count',
      valueNum: '1',
      activityTypeId: await activityTypeIdByKey('brush_teeth'),
      metricKey: null,
      status: ENTRY_STATUS.done,
    });

    const hideX = await db.transaction((tx) =>
      hideEntries(asTx(tx), {
        profilePublicId: hideProfilePublicId,
        scope: hideScope,
        day: MIX_DAY,
        entryPublicIds: [MX],
      }),
    );
    assert.ok('hiddenAt' in hideX, 'V1-9b B1-1b: the first device hides X');
    // ⚠️ PGlite's clock is millisecond-resolution, so two events inside one tick share a token and
    // the "new event" assertion below would fail for a reason that is not the writer's.
    await db.execute(sql`select pg_sleep(0.01)`);

    const mixed = await db.transaction((tx) =>
      hideEntries(asTx(tx), {
        profilePublicId: hideProfilePublicId,
        scope: hideScope,
        day: MIX_DAY,
        entryPublicIds: [MX, MY],
      }),
    );
    assert.ok(
      'hiddenAt' in mixed,
      'V1-9b B1-1b: a mixed hide succeeds and mints a new event for Y',
    );
    assert.notEqual(mixed.hiddenAt, hideX.hiddenAt, '…a NEW token, since Y was hidden just now');

    const retried = await db.transaction((tx) =>
      hideEntries(asTx(tx), {
        profilePublicId: hideProfilePublicId,
        scope: hideScope,
        day: MIX_DAY,
        entryPublicIds: [MX, MY],
      }),
    );
    assert.deepEqual(
      retried,
      mixed,
      'V1-9b B1-1b: 🔴 retrying the mixed call returns the SAME answer — it used to answer ' +
        'notFound about rows that exist, are owned and are hidden',
    );
  }

  // ── 3 · slot_taken, and the swap in both bad orders (Decision 8) ───────────────────────────────
  const B_WEIGH = '019826b4-0000-7000-8000-00000000d301';
  await bwEntry(B_WEIGH, HIDE_DAY, 61); // B now holds the day's slot, live

  const refused = await db.transaction((tx) =>
    restoreHidden(asTx(tx), {
      profilePublicId: hideProfilePublicId,
      scope: hideScope,
      day: HIDE_DAY,
      hiddenAt: hide1.hiddenAt,
      entryPublicIds: [E1],
    }),
  );
  assert.equal(refused[0].reason, 'slot_taken', 'V1-9b B1-1b: restoring into a taken slot refuses');
  assert.equal(
    refused[0].heldBy?.entryPublicId,
    B_WEIGH,
    'V1-9b B1-1b: …and names the holder, so the screen can offer "Use {value} instead"',
  );
  const [aStillHidden] = await db
    .select({ deletedAt: schema.entries.deletedAt })
    .from(schema.entries)
    .where(eq(schema.entries.publicId, E1));
  assert.ok(aStillHidden.deletedAt !== null, 'V1-9b B1-1b: A stays hidden after a refusal');
  const [bUntouched] = await db
    .select({ deletedAt: schema.entries.deletedAt })
    .from(schema.entries)
    .where(eq(schema.entries.publicId, B_WEIGH));
  assert.equal(bUntouched.deletedAt, null, 'V1-9b B1-1b: …and B was never touched');

  // Bad order 1: the item is not hidden under THIS token. The holder must not be touched.
  const badToken = await db.transaction((tx) =>
    restoreHidden(asTx(tx), {
      profilePublicId: hideProfilePublicId,
      scope: hideScope,
      day: HIDE_DAY,
      hiddenAt: '2020-01-01T00:00:00.000000Z',
      entryPublicIds: [E1],
      keepInsteadOf: B_WEIGH,
    }),
  );
  assert.equal(badToken[0].reason, 'changed', 'V1-9b B1-1b: a stale token answers changed');
  const [bAfterBadToken] = await db
    .select({ deletedAt: schema.entries.deletedAt })
    .from(schema.entries)
    .where(eq(schema.entries.publicId, B_WEIGH));
  assert.equal(
    bAfterBadToken.deletedAt,
    null,
    'V1-9b B1-1b: 🔴 the holder is NOT hidden when the item is not hidden under the token — this ' +
      'is Decision 8 ORDERING (step 3 returns before step 4), which is what this assertion proves. ' +
      'The savepoint covers a different path — holder hidden, then the restore fails — which cannot ' +
      'be produced in-process because the row is locked; that one rests on reading drizzle, and the ' +
      'guide says so rather than claiming this proves it',
  );

  // Bad order 2: the named holder is not the row holding the slot.
  const wrongHolder = await db.transaction((tx) =>
    restoreHidden(asTx(tx), {
      profilePublicId: hideProfilePublicId,
      scope: hideScope,
      day: HIDE_DAY,
      hiddenAt: hide1.hiddenAt,
      entryPublicIds: [E1],
      keepInsteadOf: '019826b4-0000-7000-8000-00000000dead',
    }),
  );
  assert.equal(
    wrongHolder[0].reason,
    'slot_taken',
    'V1-9b B1-1b: naming a holder that does not hold the slot refuses rather than guessing',
  );

  // The swap, correctly ordered: A comes back live and B goes hidden under a NEW token.
  const swap = await db.transaction((tx) =>
    restoreHidden(asTx(tx), {
      profilePublicId: hideProfilePublicId,
      scope: hideScope,
      day: HIDE_DAY,
      hiddenAt: hide1.hiddenAt,
      entryPublicIds: [E1],
      keepInsteadOf: B_WEIGH,
    }),
  );
  assert.equal(swap[0].reason, 'ok', 'V1-9b B1-1b: the swap succeeds');
  const swapped = await db
    .select({ publicId: schema.entries.publicId, deletedAt: schema.entries.deletedAt })
    .from(schema.entries)
    .where(sql`${schema.entries.publicId} = any(array[${sql`${E1}`}, ${sql`${B_WEIGH}`}]::uuid[])`);
  const a = swapped.find((r) => r.publicId === E1);
  const b = swapped.find((r) => r.publicId === B_WEIGH);
  assert.equal(a?.deletedAt, null, 'V1-9b B1-1b: A is live after the swap');
  assert.ok(b?.deletedAt !== null, 'V1-9b B1-1b: …and B is hidden under its own new event');

  // A replay of the swap is `ok` with no further change (the item is already live).
  const swapReplay = await db.transaction((tx) =>
    restoreHidden(asTx(tx), {
      profilePublicId: hideProfilePublicId,
      scope: hideScope,
      day: HIDE_DAY,
      hiddenAt: hide1.hiddenAt,
      entryPublicIds: [E1],
      keepInsteadOf: B_WEIGH,
    }),
  );
  assert.equal(swapReplay[0].reason, 'ok', 'V1-9b B1-1b: replaying the swap is ok, with no change');

  // ── 4 · The TEN-1 matrix, both directions ─────────────────────────────────────────────────────
  const BW_HOUSE_B = '019826b4-0000-7000-8000-00000000d401';
  await bwEntry(BW_HOUSE_B, '2026-08-06', 62);
  const crossHide = await db.transaction((tx) =>
    hideEntries(asTx(tx), {
      profilePublicId: hideProfilePublicId,
      scope: B_SCOPE, // household B asking about household A's athlete
      day: '2026-08-06',
      entryPublicIds: [BW_HOUSE_B],
    }),
  );
  assert.deepEqual(
    crossHide,
    { notFound: true },
    "V1-9b B1-1b: household B cannot hide household A's entry — the SAME answer as unknown",
  );
  const crossRead = await hiddenEntriesForDay(asPg, {
    profilePublicId: hideProfilePublicId,
    scope: B_SCOPE,
    day: HIDE_DAY,
  });
  assert.deepEqual(
    crossRead,
    [],
    "V1-9b B1-1b: …and cannot READ A's hidden rows either (the read is scoped too)",
  );

  // ── 5 · The reader audit: a hidden parent hides its live children everywhere ───────────────────
  const AUDIT_DAY = '2027-03-07'; // a month NOTHING else in this file occupies — see below
  // A strength entry as production holds it (`legacyStrengthFixture`, LEGACY-1): an entry with a set
  // and its quantity, which is what makes the live-children trap below observable.
  const {
    entries: [auditEntry],
  } = await legacyStrengthFixture(asPg, {
    profilePublicId: hideProfilePublicId,
    scope: hideScope,
    day: AUDIT_DAY,
    activityTypeId: scLiftActivityId,
    sessionClientId: '019826b4-0000-7000-8000-00000000d500',
    movements: [
      {
        movementName: 'Bench Press',
        unit: 'lb',
        movementId: movY.id,
        clientId: '019826b4-0000-7000-8000-00000000d501',
        sets: [{ reps: 5, weight: 100 }],
      },
    ],
  });
  const monthOf = (day: string) => day.slice(0, 7);

  const beforeStrength = await strengthMonthRows(asPg, {
    profilePublicId: hideProfilePublicId,
    scope: hideScope,
    month: monthOf(AUDIT_DAY),
  });
  const hideOwner = asOwner(hideScope, 'V1-9b B1-1b');
  const beforeMonths = await loggedMonths(asPg, {
    profilePublicId: hideProfilePublicId,
    scope: hideOwner,
  });
  assert.ok(beforeStrength.length > 0, 'V1-9b B1-1b: the audit fixture is in the export');

  const auditHide = await db.transaction((tx) =>
    hideEntries(asTx(tx), {
      profilePublicId: hideProfilePublicId,
      scope: hideScope,
      day: AUDIT_DAY,
      entryPublicIds: [auditEntry.publicId],
    }),
  );
  assert.ok('hiddenAt' in auditHide, 'V1-9b B1-1b: the strength entry hides');

  // 🔴 Its SETS are still `deleted_at IS NULL` — live children of a dead parent. That is the trap.
  const liveChildren = await db
    .select({ id: schema.entrySets.id })
    .from(schema.entrySets)
    .innerJoin(schema.entries, eq(schema.entrySets.entryId, schema.entries.id))
    .where(
      and(eq(schema.entries.publicId, auditEntry.publicId), isNull(schema.entrySets.deletedAt)),
    );
  assert.ok(
    liveChildren.length > 0,
    'V1-9b B1-1b: the hidden entry still has LIVE children — ON DELETE CASCADE is hard-delete only, ' +
      'so every reader must reach ownership through the PARENT',
  );

  assert.deepEqual(
    await strengthMonthRows(asPg, {
      profilePublicId: hideProfilePublicId,
      scope: hideScope,
      month: monthOf(AUDIT_DAY),
    }),
    beforeStrength.filter((r) => r.date !== AUDIT_DAY),
    'V1-9b B1-1b: strengthMonthRows drops the hidden entry AND its live sets',
  );

  // 🔴 **Criterion 16's first half, which nothing asserted.** The audit fixture is the only thing in
  // `2026-09`, so hiding it must make the month DISAPPEAR from `loggedMonths`. The earlier version
  // put this fixture in a month holding five other rows, so the "unchanged again" assertion below
  // was comparing a list that never moved — it could not fail. A correctness lens caught it.
  const hasAuditMonth = (rows: typeof beforeMonths) =>
    rows.some((r) => r.month === monthOf(AUDIT_DAY));
  assert.ok(hasAuditMonth(beforeMonths), 'V1-9b B1-1b: the audit month is in loggedMonths before');
  assert.ok(
    !hasAuditMonth(
      await loggedMonths(asPg, { profilePublicId: hideProfilePublicId, scope: hideOwner }),
    ),
    "V1-9b B1-1b: 🔴 hide the month's only entry and loggedMonths DROPS the month (criterion 16)",
  );

  // Criterion 16: hide a month, and the month leaves `loggedMonths`; restore, and it is deep-equal.
  const restoredAudit = await db.transaction((tx) =>
    restoreHidden(asTx(tx), {
      profilePublicId: hideProfilePublicId,
      scope: hideScope,
      day: AUDIT_DAY,
      hiddenAt: auditHide.hiddenAt,
      entryPublicIds: [auditEntry.publicId],
    }),
  );
  assert.equal(restoredAudit[0].reason, 'ok', 'V1-9b B1-1b: the strength entry restores');
  assert.deepEqual(
    await strengthMonthRows(asPg, {
      profilePublicId: hideProfilePublicId,
      scope: hideScope,
      month: monthOf(AUDIT_DAY),
    }),
    beforeStrength,
    'V1-9b B1-1b: 🔴 restore brings the export back DEEP-EQUAL — public_id, created_at and every ' +
      'value preserved (criterion 16, the self-serve half)',
  );
  assert.deepEqual(
    await loggedMonths(asPg, { profilePublicId: hideProfilePublicId, scope: hideOwner }),
    beforeMonths,
    'V1-9b B1-1b: …and loggedMonths has the month back',
  );

  // ── 5b · The rest of the reader audit, because the guide's table claims one case PER ROW ──────
  //
  // 🔴 **This block exists because a security lens caught the PR claiming a six-reader audit that
  // exercised two.** The code was right — every reader does filter — but a guide cell pointing at a
  // proof that is not there is worse than an empty cell: the next author trusts it. These are the
  // four that were cited and missing.
  {
    // (a) `bodyweightMonthRows` — a hidden weigh-in leaves the bodyweight export. `B_WEIGH` is
    //     hidden at this point (the swap put it there).
    const bwMonth = await bodyweightMonthRows(asPg, {
      profilePublicId: hideProfilePublicId,
      month: '2026-08',
      scope: hideScope,
    });
    assert.ok(
      bwMonth.every((r) => r.value !== '61.000'),
      'V1-9b B1-1b: a hidden weigh-in is absent from bodyweightMonthRows',
    );
    assert.ok(
      bwMonth.some((r) => r.value === '60.000'),
      '…and the live one it was swapped for IS present (so the filter is not just an empty read)',
    );

    // (b) was `weeklyAdherence` (Q7), the old Today card's read, retired by LEGACY-1.
    // (c) The amends ride `ownedEntryIds`, which filters tombstones — so amending a HIDDEN weigh-in
    //     answers notFound, and leaves `deleted_at` alone.
    const amendHidden = await updateBodyweightEntryById(asPg, {
      profilePublicId: hideProfilePublicId,
      scope: hideScope,
      entryId: B_WEIGH,
      value: 99,
      unit: 'lb',
      seenValue: 61,
    });
    // `null` is this amend's "not found" — the same answer a foreign id gets (`V1-24` 1b), which is
    // the point: a hidden entry is indistinguishable from one that was never yours.
    assert.equal(
      amendHidden,
      null,
      'V1-9b B1-1b: amending a HIDDEN entry answers notFound (ownedEntryIds filters tombstones)',
    );
    const [afterAmend] = await db
      .select({ deletedAt: schema.entries.deletedAt, value: schema.entries.valueNum })
      .from(schema.entries)
      .where(eq(schema.entries.publicId, B_WEIGH));
    assert.ok(afterAmend.deletedAt !== null, '…and it is still hidden');
    assert.equal(afterAmend.value, '61.000', '…with its value untouched');

    // (d) `movement-ownership.ts` carries NO `deleted_at` conjunct, deliberately: a tombstoned row
    //     still holds its FK, so it still blocks a household delete and must still be counted.
    //
    // 🔴 **Asserted as the FK itself, not as the census, and the difference is why this case was
    // rewritten.** The first version compared `crossHouseholdMovementRefs` before and after a hide —
    // but that census reads `{0, 0, 0}` across this whole fixture by design (TEN-2c's "price paid"),
    // so it compared zero to zero and would have passed with a `deleted_at` conjunct added. A
    // verification pass caught it. What actually carries the invariant is that the hidden row keeps
    // its `movement_id`: that is why a tombstone is still a reference, and why the census must not
    // filter them out.
    const auditHide2 = await db.transaction((tx) =>
      hideEntries(asTx(tx), {
        profilePublicId: hideProfilePublicId,
        scope: hideScope,
        day: AUDIT_DAY,
        entryPublicIds: [auditEntry.publicId],
      }),
    );
    assert.ok('hiddenAt' in auditHide2, 'V1-9b B1-1b: re-hide the audit entry');

    const [hiddenRef] = await db
      .select({ movementId: schema.entries.movementId, deletedAt: schema.entries.deletedAt })
      .from(schema.entries)
      .where(eq(schema.entries.publicId, auditEntry.publicId));
    assert.ok(hiddenRef.deletedAt !== null, 'V1-9b B1-1b: the audit entry is hidden');
    assert.equal(
      hiddenRef.movementId,
      movY.id,
      'V1-9b B1-1b: 🔴 a HIDDEN entry still holds its movement_id — the reference survives the ' +
        'tombstone, which is exactly why movement-ownership.ts carries no deleted_at conjunct and ' +
        'why a household delete is still blocked by it',
    );

    await db.transaction((tx) =>
      restoreHidden(asTx(tx), {
        profilePublicId: hideProfilePublicId,
        scope: hideScope,
        day: AUDIT_DAY,
        hiddenAt: auditHide2.hiddenAt,
        entryPublicIds: [auditEntry.publicId],
      }),
    );
  }

  // ── 5c · The boundary cases restore had none of ─────────────────────────────────────────────────
  //
  // 🔴 `restoreOne` is the one function here that writes a tombstone onto a LIVE row it was not asked
  // about (the holder hide). Its only ownership check is the locked SELECT — and nothing exercised
  // it. A security lens pointed out that the highest-blast-radius write in the PR had no boundary
  // proof at all.
  {
    const crossRestore = await db.transaction((tx) =>
      restoreHidden(asTx(tx), {
        profilePublicId: hideProfilePublicId,
        scope: B_SCOPE, // household B, naming household A's athlete
        day: HIDE_DAY,
        hiddenAt: hide1.hiddenAt,
        entryPublicIds: [B_WEIGH],
        keepInsteadOf: E1, // …and naming A's LIVE row as the one to hide
      }),
    );
    assert.deepEqual(
      crossRestore.map((r) => r.reason),
      ['not_found'],
      "V1-9b B1-1b: household B cannot restore household A's row",
    );
    const [e1AfterCross] = await db
      .select({ deletedAt: schema.entries.deletedAt })
      .from(schema.entries)
      .where(eq(schema.entries.publicId, E1));
    assert.equal(
      e1AfterCross.deletedAt,
      null,
      "V1-9b B1-1b: 🔴 …and naming A's live row as `keepInsteadOf` did NOT hide it — the holder " +
        'write is reached only through the scoped lock',
    );

    const unknownId = await db.transaction((tx) =>
      restoreHidden(asTx(tx), {
        profilePublicId: hideProfilePublicId,
        scope: hideScope,
        day: HIDE_DAY,
        hiddenAt: hide1.hiddenAt,
        entryPublicIds: ['019826b4-0000-7000-8000-00000000dea0'],
      }),
    );
    assert.deepEqual(
      unknownId.map((r) => r.reason),
      ['not_found'],
      'V1-9b B1-1b: an unknown id gets the SAME answer as a wrong household — one message, as the ' +
        'shipped amends do',
    );

    assert.deepEqual(
      await hiddenDayCounts(asPg, {
        profilePublicId: hideProfilePublicId,
        scope: B_SCOPE,
        exceptDay: HIDE_DAY,
      }),
      [],
      "V1-9b B1-1b: household B cannot count A's hidden days either",
    );
  }

  // ── 6 · The hidden read, which is the ONE reader that must see tombstones ──────────────────────
  const hiddenNow = await hiddenEntriesForDay(asPg, {
    profilePublicId: hideProfilePublicId,
    scope: hideScope,
    day: HIDE_DAY,
  });
  assert.deepEqual(
    hiddenNow.map((r) => r.entryPublicId),
    [B_WEIGH],
    'V1-9b B1-1b: the hidden read returns the swapped-out weigh-in, and only it',
  );
  // Hide a row on a day nothing else in this file touches, so the POSITIVE case is ours and not an
  // accident of fixture ordering 300 lines up.
  const COUNT_DAY = '2026-08-09';
  const COUNT_ID = '019826b4-0000-7000-8000-00000000d901';
  await bwEntry(COUNT_ID, COUNT_DAY, 63);
  await db.transaction((tx) =>
    hideEntries(asTx(tx), {
      profilePublicId: hideProfilePublicId,
      scope: hideScope,
      day: COUNT_DAY,
      entryPublicIds: [COUNT_ID],
    }),
  );

  const otherDays = await hiddenDayCounts(asPg, {
    profilePublicId: hideProfilePublicId,
    scope: hideScope,
    exceptDay: HIDE_DAY,
  });
  // 🔴 **A positive assertion first.** Both checks below are `every(...)`, and `[].every(...)` is
  // `true` — so with only those, inverting the reader's `isNotNull` to `isNull` left this green. A
  // db-safety lens and a correctness lens both caught it.
  assert.deepEqual(
    otherDays.find((d) => d.day === COUNT_DAY),
    { day: COUNT_DAY, hidden: 1 },
    'V1-9b B1-1b: hiddenDayCounts REPORTS a day with a hidden item, and counts it',
  );
  assert.ok(
    otherDays.every((d) => d.day !== HIDE_DAY),
    'V1-9b B1-1b: …excludes the day being viewed',
  );
  assert.ok(
    otherDays.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.day)),
    'V1-9b B1-1b: …and returns the day as TEXT, never a Date that would pick up a timezone',
  );

  console.log(
    '✓ V1-9b B1-1b: a hide is ONE event carried as six-digit UTC text; all-or-nothing, replay-safe ' +
      'and household-scoped; the swap never half-commits; and a hidden parent disappears from every ' +
      'reader while its live children survive, restoring deep-equal',
  );
}

// ── SCALE-3: the migrating role carries a 15 s statement timeout ──────────────────────────────────
// A "migration applied" check, and a guard against a later migration resetting the value. It cannot
// prove the runtime is bounded: PGlite is one connection, and a role default is applied only when a
// backend starts. That is the runbook's check (docs/runbooks.md → "The runtime statement timeout").
{
  const rows = await db.execute<{ rolconfig: string[] | null }>(
    sql`select rolconfig from pg_roles where rolname = current_user`,
  );
  assert.deepEqual(
    rows.rows[0]?.rolconfig?.filter((c) => c.startsWith('statement_timeout=')),
    ['statement_timeout=15s'],
    'SCALE-3: the migrating role has exactly one statement_timeout default, 15s',
  );
  console.log('✓ SCALE-3: the migrating role defaults to a 15s statement timeout');
}

// ── FAM-1 step 0c: the lanes' proof modules. Each is called exactly ONCE, here, and LAST ─────────
// Last on purpose (`verify/harness.ts` → `VerifyContext` has the reasoning): nothing in this file
// runs after them, so rows a lane writes cannot change what an assertion above counts, and a lane's
// proof cannot become the FIRST failure under one of `mutations/*.patch`, whose `.expect` names it.
// A lane adds proofs inside its own module; it does not add a call here. The fifth module, PRIV-3's
// erasure graph, runs after the four lanes' (roadmap thread, the harness owner, 2026-11-17): its
// proofs read only the catalog and its own rolled-back fixture, so it cannot change what they count.
// The sixth, CAT-3 A1's catalog tables, runs after erasure for the same reason: rolled-back rows only.
const verifyContext: VerifyContext = { A_SCOPE, A_MEMBER_SCOPE, B_SCOPE };
await verifySchema(verifyContext);
await verifyProgram(verifyContext);
await verifyDay(verifyContext);
await verifySingleValues(verifyContext);
await verifyErasure(verifyContext);
await verifyCatalogTables(verifyContext);
await verifySeedLeavesHouseholdsAlone(verifyContext);

console.log('✓ verify passed');
