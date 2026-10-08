import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_INPUT_SHAPES,
  ACTIVITY_METRIC_MAP,
  ACTIVITY_TYPE_SEED_ROWS,
  activityTypeSeedRowSchema,
  assertRollupAggregation,
  CALISTHENICS_METRIC_KEYS,
  DEFAULT_BODYWEIGHT_CONTEXT,
  ENTRY_STATUS,
  foldAggregation,
  METRIC_AGGREGATION,
  type MetricAggregation,
  METRIC_AGGREGATIONS,
  METRIC_DEFINITION_SEED_ROWS,
  METRIC_KEYS,
  METRIC_VALUE_TYPES,
  metricDefinitionSeedRowSchema,
  MOVEMENT_PATTERNS,
  MOVEMENT_SEED_ROWS,
  movementSeedRowSchema,
  movementSlug,
  movementSlugMatchesName,
  PROFILE_KIND,
  DAY_ROLES,
  newId,
  PROGRAM_SEED,
  type ProgramBlockSeedRow,
  type RoutineConfig,
  routineConfigSchema,
  ROUTINE_VERSION,
  SESSION_TYPES,
  ENTRY_KIND,
  SEED_ACTIVITY_TYPE_KEYS,
  SEED_ACTIVITY_TYPE_SC_LIFT_PUBLIC_ID,
  SEED_ACTIVITY_TYPE_WEIGH_IN_PUBLIC_ID,
  SEED_METRIC_BODYWEIGHT_PUBLIC_ID,
  SEED_METRIC_KEYS,
  QUANTITY_SLOT,
  QUANTITY_SLOT_ROWS,
  UNIT_CODES,
  UNIT_DIMENSION,
  UNIT_DIMENSION_BY_CODE,
  UNITS,
  UNIT_DIMENSIONS,
  WEEK_LENGTH_DAYS,
} from '@mat-plan/shared';
import { and, eq, gte, inArray, isNull, lt, max, sql, sum } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import { schema } from '../src/client';
import { bodyweightMonthRows, loggedMonths, strengthMonthRows } from '../src/queries/export-month';
import { programDayRows } from '../src/queries/program-day';
import { weeklyAdherenceRows } from '../src/queries/weekly-adherence';
import {
  findAmendableBodyweight,
  insertBodyweightEntry,
  updateBodyweightEntryById,
} from '../src/writers/bodyweight';
import { updateStrengthSetById, writeStrengthSession } from '../src/writers/strength-session';
import {
  SEED_FULL_ROUTINE,
  SEED_HOUSEHOLD_PUBLIC_ID,
  SEED_PROFILE_2_PUBLIC_ID,
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

/**
 * Assert `fn` rejects with a Postgres error whose violated constraint is `constraintName`,
 * read off `cause.constraint` (the node-postgres / PGlite error shape). Extracted from the two
 * inline copies this file grew (V1-1c's activity_type_id guard + V1-5's shape-CHECK trap) and
 * reused for the V1-6b-1 ramp_targets rejections — one idiom, so a rename fails in one place.
 */
async function expectRejectedBy(constraintName: string, fn: () => Promise<unknown>): Promise<void> {
  let violated: string | undefined;
  try {
    await fn();
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
 * cannot express, so a check that needs them queries `information_schema.columns` for itself (see
 * the TEN-1 1a readback) rather than widening this Map and churning its four existing callers.
 */
async function columnsOf(tableName: string): Promise<Map<string, string>> {
  const res = await db.execute(
    sql`select column_name, data_type from information_schema.columns where table_name = ${tableName}`,
  );
  const rows = (res as unknown as { rows: { column_name: string; data_type: string }[] }).rows;
  return new Map(rows.map((r) => [r.column_name, r.data_type]));
}

await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
console.log('✓ migration applied to PGlite');

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
// V1-3: two kid profiles (Liam + Scarlett), stable by public_id across re-seeds.
assert.equal(profiles.length, 2, 'exactly two profiles after two seed runs');
const seededProfileIds = profiles.map((p) => p.publicId).sort();
assert.deepEqual(
  seededProfileIds,
  [SEED_PROFILE_PUBLIC_ID, SEED_PROFILE_2_PUBLIC_ID].sort(),
  'both seed profiles stable by public_id',
);
assert.deepEqual(
  profiles.map((p) => p.name).sort(),
  ['Liam', 'Scarlett'],
  'seed profiles are Liam + Scarlett',
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

// V1-1a: every seed profile must be scoped to the root household (household_id NOT NULL
// enforced by the migration's CHECK; the migration backfill + seed both set it).
for (const p of profiles) {
  assert.equal(p.householdId, households[0].id, 'seed profile scoped to root household');
  assert.ok(p.householdId != null, 'profile.household_id is non-null (CHECK-enforced)');
}
console.log('✓ profiles scoped to root household (household_id NOT NULL)');

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
const [syntheticCol] = (
  (await db.execute(
    sql`select is_nullable, column_default from information_schema.columns
        where table_name = 'households' and column_name = 'synthetic'`,
  )) as unknown as { rows: { is_nullable: string; column_default: string | null }[] }
).rows;
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
const liam = profiles.find((p) => p.publicId === SEED_PROFILE_PUBLIC_ID)!;
const scarlett = profiles.find((p) => p.publicId === SEED_PROFILE_2_PUBLIC_ID)!;
// A≠B on a fresh DB, and since ONB-0 BOTH are explicit.
//
// Liam used to be NULL here, deliberately, to demonstrate "NULL → the default routine". ONB-0 narrowed
// that default to `['strength']`, so NULL now means the NEUTRAL first-run routine — and a fixture that
// rode it would lose the habits and the brush-teeth metrics that `e2e/global.setup.ts` and the V0-11
// smoke both drive on this profile. So the seed writes the full catalog explicitly, and what gets proved
// here is the stronger property: no seeded fixture depends on a read-time default at all.
assert.ok(liam.routineConfig != null, 'ONB-0: profile 1 has an explicit routine_config (was NULL)');
assert.deepEqual(
  liam.routineConfig,
  SEED_FULL_ROUTINE,
  'ONB-0: profile 1 is seeded with the explicit pre-ONB-0 full-catalog routine',
);
assert.ok(scarlett.routineConfig != null, 'V1-18: Scarlett has an explicit routine_config');
assert.notDeepEqual(
  liam.routineConfig,
  scarlett.routineConfig,
  'V1-18: the two seeded routines differ (A≠B, fresh DB)',
);
// Prove the stored config is GRAMMAR-VALID (a bad seed key fails loudly here, not silently on read).
assert.ok(
  routineConfigSchema.safeParse(scarlett.routineConfig).success,
  'V1-18: Scarlett’s seeded routine_config parses against routineConfigSchema',
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
  ON CONFLICT ("slug") DO NOTHING`);
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
}): Promise<void> {
  const tag = (0x10 + entryProbe++).toString(16); // f-block probe ids
  await db.insert(schema.entries).values({
    publicId: `019826b4-0000-7000-8000-0000000001${tag}`,
    clientId: `019826b4-0000-7000-8000-0000000002${tag}`,
    profileId: rampTestProfile.id,
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
  return (
    row?.id ??
    (await db.select({ id: table.id }).from(table).where(eq(table.clientId, clientId)))[0].id
  );
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
  });
  assert.equal(adjacent.length, 0, 'V1-13b: an adjacent month sees none of these rows');

  // BOLA: the same month for a different profile must be empty.
  const otherProfile = await strengthMonthRows(asPg, {
    profilePublicId: '019826b4-0000-7000-8000-0000000009b0',
    month: '2026-03',
  });
  assert.equal(otherProfile.length, 0, 'V1-13b: the export read is profile-scoped');

  const months = await loggedMonths(asPg, {
    profilePublicId: '019826b4-0000-7000-8000-0000000009a0',
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
  const read = await strengthMonthRows(asPg, { profilePublicId: V130_PROFILE, month: '2026-05' });
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
const bwExport = await bodyweightMonthRows(asPg, { profilePublicId: bwOwner, month: '2026-09' });
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
  seenValue: 84.5, // the row is 85.2 now
});
assert.equal(staleAmend, null, 'V1-24 1b: a stale seenValue matches no row');

// (e) The unit is a GUARD: claiming kg to slip a value past the lb bound matches nothing.
const wrongUnit = await updateBodyweightEntryById(asPg, {
  profilePublicId: bwOwner,
  entryId: bwTarget.publicId,
  value: 200,
  unit: 'kg',
  seenValue: 85.2,
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
});
assert.equal(textAmend, null, 'V1-24 1b: a text-valued entry is not amendable');

// (i) The re-read the action branches on shares the UPDATE's shape and ownership: it sees the owner's
// amendable row, and NOTHING the UPDATE could not have written.
assert.deepEqual(
  await findAmendableBodyweight(asPg, { profilePublicId: bwOwner, entryId: bwTarget.publicId }),
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
    await findAmendableBodyweight(asPg, { profilePublicId, entryId }),
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
});
const deadProfileEdit = await updateStrengthSetById(asPg, {
  profilePublicId: bwOwner,
  setId: editTarget.publicId,
  reps: 99,
  weight: 99,
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
const liamA = await programDayRows(asPg, {
  profilePublicId: SEED_PROFILE_PUBLIC_ID,
  dayRole: 'strength_a',
});
assert.equal(liamA.length, 7, 'YDP: programDayRows returns Day A’s 7 movements');
assert.deepEqual(
  liamA.map((r) => r.movementName),
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

// Day B swaps the rotating pair for the swing — 6 movements, and the athlete does a jump OR a swing
// every day while each individual movement lands every other session.
const liamB = await programDayRows(asPg, {
  profilePublicId: SEED_PROFILE_PUBLIC_ID,
  dayRole: 'strength_b',
});
assert.equal(liamB.length, 6, 'YDP: programDayRows returns Day B’s 6 movements');
assert.ok(
  liamB.some((r) => r.movementName === 'KB Swings'),
  'YDP: Day B carries the swing',
);
assert.ok(!liamB.some((r) => r.movementName === 'Box Jump'), 'YDP: Day B does NOT carry the jump');

// (b) Per-kid isolation — the SAME prescription yields each kid their own row. The YDP prescribes no
// loads at all, so what this proves is that BOTH kids get a row per movement (a WHERE-scoped join
// would drop one), not that the loads differ.
const scarlettA = await programDayRows(asPg, {
  profilePublicId: SEED_PROFILE_2_PUBLIC_ID,
  dayRole: 'strength_a',
});
assert.equal(scarlettA.length, 7, 'YDP: the sibling gets her own 7 Day-A rows');
assert.ok(
  liamA.every((r) => r.load === null) && scarlettA.every((r) => r.load === null),
  'YDP: no authored loads reach the card — the athlete logs what they did',
);

// (b2) V1-26 PR-A — the MOVEMENT's declaration rides out of the shipped query.
//
// This is the column pair that feeds the log form's Unit select and its BW-tap warning, and the seed
// is the real catalog, so this proves the actual movements the athletes log against — not a fixture.
// `KB Swings` is the 2026-09-28 movement: declared loaded, in pounds, and logged `20 × BW`.
const kbSwings = liamB.find((r) => r.movementName === 'KB Swings');
assert.equal(kbSwings?.movementUnitDefault, 'lb', 'V1-26: KB Swings declares a pound default');
assert.equal(kbSwings?.movementIsBodyweight, false, 'V1-26: ...and is NOT a bodyweight movement');

const pushUps = liamA.find((r) => r.movementName === 'Push-Ups');
assert.equal(pushUps?.movementIsBodyweight, true, 'V1-26: Push-Ups declares bodyweight');
assert.equal(pushUps?.movementUnitDefault, null, 'V1-26: ...and declares no unit');

// ⚠️ The declaration is the MOVEMENT's, never the coach's. `load` stays null on every YDP row (asserted
// just above), so widening the query did not open a path for an authored magnitude to reach an input.
assert.ok(
  liamA.every((r) => r.load === null),
  'V1-26: widening the select did not let a prescribed load through',
);

// The one fixed prescription in the program survives the read.
const hipThrust = liamA.find((r) => r.movementName === 'Single-Leg Hip Thrusts');
assert.equal(hipThrust?.sets, 3, 'YDP: hip thrusts keep their fixed 3 sets');
assert.equal(hipThrust?.targetReps, '10 per side', 'YDP: ...and their per-side prescription');

// (c) A day with no prescriptions → zero rows (the page renders no card). Strength B exists; 'skill' doesn't.
assert.equal(
  (await programDayRows(asPg, { profilePublicId: SEED_PROFILE_PUBLIC_ID, dayRole: 'skill' }))
    .length,
  0,
  'V1-10: an unprogrammed day_role returns no rows',
);

// (d) BOLA, probed in BOTH directions. The two households program DISJOINT day_roles — Ray's block only
// has strength_a/b/c, the verify block only has plain 'strength' — so each direction is a real leak test:
// whichever household you ask from, the OTHER household's day_role must come back empty. (Asking only one
// way would pass even with the household scoping deleted, since the globally-newest block happens to be
// the verify one — the assertion would then be proving fixture ordering, not ownership.)
assert.equal(
  (await programDayRows(asPg, { profilePublicId: VERIFY_PROFILE_PUBLIC_ID, dayRole: 'strength_a' }))
    .length,
  0,
  'V1-10: another household’s profile cannot read the kids’ strength_a (BOLA)',
);
assert.equal(
  (await programDayRows(asPg, { profilePublicId: SEED_PROFILE_PUBLIC_ID, dayRole: 'strength' }))
    .length,
  0,
  'V1-10: …and a kid cannot read the other household’s plain-strength day (BOLA, reverse)',
);
const otherHouseholdOwn = await programDayRows(asPg, {
  profilePublicId: VERIFY_PROFILE_PUBLIC_ID,
  dayRole: 'strength',
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
  (await programDayRows(asPg, { profilePublicId: VERIFY_PROFILE_PUBLIC_ID, dayRole: 'skill' }))[0]
    ?.targetReps,
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
const sdArgs = { profilePublicId: VERIFY_SD_PROFILE_PUBLIC_ID, dayRole: 'core' } as const;
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

// --- a comma survives the column (the CSV quotes it; `prescribed` is in csv/row.ts's QUOTABLE) ----
await insertSnapshot('movement', SNAP_COMMA);
console.log('✓ V1-22 chunk 1: a comma-bearing prescription stores verbatim');

console.log('✓ verify passed');
