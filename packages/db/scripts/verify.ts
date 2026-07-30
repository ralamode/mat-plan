import assert from 'node:assert/strict';
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
  SEED_ACTIVITY_TYPE_KEYS,
  SEED_ACTIVITY_TYPE_SC_LIFT_PUBLIC_ID,
  SEED_ACTIVITY_TYPE_WEIGH_IN_PUBLIC_ID,
  SEED_METRIC_BODYWEIGHT_PUBLIC_ID,
  SEED_METRIC_KEYS,
  UNIT_CODES,
  WEEK_LENGTH_DAYS,
} from '@mat-plan/shared';
import { and, eq, gte, inArray, isNull, lt, max, sql, sum } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import { schema } from '../src/client';
import { weeklyAdherenceRows } from '../src/queries/weekly-adherence';
import { updateStrengthSetById, writeStrengthSession } from '../src/writers/strength-session';
import {
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
 * The column set of a table, keyed by name → data_type — the `information_schema.columns` cast shape lives
 * ONCE here (the routine_config + entries checks both call it, plus the V1-10 tables).
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

// V1-18 (PR 1a): the per-kid routine_config column + the two-kid A≠B seed.
assert.equal(
  (await columnsOf('profiles')).get('routine_config'),
  'jsonb',
  'V1-18: profiles.routine_config is jsonb',
);
const liam = profiles.find((p) => p.publicId === SEED_PROFILE_PUBLIC_ID)!;
const scarlett = profiles.find((p) => p.publicId === SEED_PROFILE_2_PUBLIC_ID)!;
// A≠B on a fresh DB: Liam is NULL (→ the app's default routine, ships-dark), Scarlett is explicit.
assert.equal(liam.routineConfig, null, 'V1-18: Liam has no routine_config (resolves to default)');
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
// the config unchanged. Writes to Liam (was NULL) so it also exercises the NULL → set transition.
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
  await db
    .insert(schema.entrySets)
    .values({
      publicId: `019826b4-0000-7000-8000-000000000b${tag}`,
      clientId: `019826b4-0000-7000-8000-000000000c${tag}`,
      entryId,
      idx: 1,
      reps: 5,
      weightNum: '135',
      status: ENTRY_STATUS.done,
    })
    .onConflictDoNothing({
      target: schema.entrySets.clientId,
      where: isNull(schema.entrySets.deletedAt),
    });
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
assert.equal(s1sets.length, 3, 'V1-8-1: each session entry expands to an entry_set');

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
      movementName: 'Back Squat',
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
    weightNum: schema.entrySets.weightNum,
    updatedAt: schema.entrySets.updatedAt,
  })
  .from(schema.entrySets)
  .where(eq(schema.entrySets.publicId, editTarget.publicId));
assert.equal(afterEdit.reps, 7, 'V1-9: reps updated');
assert.equal(
  Number(afterEdit.weightNum),
  142.5,
  'V1-9: weight_num updated (precision-safe string)',
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

// (c) numeric-set-only guard — a labeled set (weight_label set) is not editable, even by its owner, so a
// crafted edit can't leave weight_num coexisting with a label. Matches the client's isEditableSet.
await db
  .update(schema.entrySets)
  .set({ weightLabel: 'BW' })
  .where(eq(schema.entrySets.publicId, editTarget.publicId));
const labeledEdit = await updateStrengthSetById(asPg, {
  profilePublicId: ssArgs.profilePublicId,
  setId: editTarget.publicId,
  reps: 4,
  weight: 4,
});
assert.equal(labeledEdit, null, 'V1-9: a labeled set is not editable (numeric-set-only guard)');
const [afterLabeled] = await db
  .select({ reps: schema.entrySets.reps })
  .from(schema.entrySets)
  .where(eq(schema.entrySets.publicId, editTarget.publicId));
assert.equal(afterLabeled.reps, 7, 'V1-9: the rejected labeled edit left the set unchanged');
await db
  .update(schema.entrySets)
  .set({ weightLabel: null })
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
    where pb.slug = 'kids_s&c_foundation'`)
).rows as unknown as {
  day_role: string;
  idx: number;
  target_reps: string;
  movement_slug: string;
  profile_public_id: string;
  load: string | null;
  reps: string | null;
}[];
// 3 days × 7 movements × 2 kids = 42 target rows; 21 distinct prescriptions.
assert.equal(
  realBlock.length,
  42,
  'V1-10: the seeded block has 42 per-kid targets (21 prescriptions × 2 kids)',
);
assert.equal(
  new Set(realBlock.map((r) => `${r.day_role}#${r.idx}`)).size,
  21,
  'V1-10: 21 distinct (day_role, idx) prescription slots',
);
const find = (dayRole: string, slug: string, profile: string) =>
  realBlock.find(
    (r) => r.day_role === dayRole && r.movement_slug === slug && r.profile_public_id === profile,
  );
// Spot-check the transcription: shared load, per-kid load, and a per-kid reps override.
assert.equal(
  find('strength_a', 'front_squat', SEED_PROFILE_PUBLIC_ID)?.load,
  '60',
  'V1-10: Liam front squat 60',
);
assert.equal(
  find('strength_a', 'front_squat', SEED_PROFILE_2_PUBLIC_ID)?.load,
  '65',
  'V1-10: Scarlett front squat 65',
);
assert.equal(
  find('strength_a', 'pull-up', SEED_PROFILE_2_PUBLIC_ID)?.reps,
  '5, last AMRAP',
  'V1-10: Scarlett’s per-kid pull-up reps override round-trips',
);
assert.equal(
  find('strength_a', 'pull-up', SEED_PROFILE_PUBLIC_ID)?.reps,
  '4',
  'V1-10: Liam’s per-kid pull-up reps override round-trips',
);
console.log('✓ V1-10: Ray’s real block seeded — 21 prescriptions, per-kid loads + reps intact');

// Drive a TEST-ONLY fixture through the REAL seedProgram (its own household/profile/block slug so a future
// real data-PR block can never collide). Proves resolve-by-slug + resolve-by-public_id + the arbiter.
const VERIFY_HH_PUBLIC_ID = '019826b4-0000-7000-8000-0000000000e0';
const VERIFY_PROFILE_PUBLIC_ID = '019826b4-0000-7000-8000-0000000000e1';
await db
  .insert(schema.households)
  .values({ publicId: VERIFY_HH_PUBLIC_ID, name: 'Verify Programming HH' });
const [verifyHh] = await db
  .select({ id: schema.households.id })
  .from(schema.households)
  .where(eq(schema.households.publicId, VERIFY_HH_PUBLIC_ID));
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

console.log('✓ verify passed');
