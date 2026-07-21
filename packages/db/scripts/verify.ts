import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_INPUT_SHAPES,
  ACTIVITY_METRIC_MAP,
  ACTIVITY_TYPE_SEED_ROWS,
  activityTypeSeedRowSchema,
  METRIC_AGGREGATIONS,
  METRIC_DEFINITION_SEED_ROWS,
  METRIC_VALUE_TYPES,
  metricDefinitionSeedRowSchema,
  MOVEMENT_PATTERNS,
  MOVEMENT_SEED_ROWS,
  movementSeedRowSchema,
  movementSlug,
  movementSlugMatchesName,
  SEED_ACTIVITY_TYPE_KEYS,
  SEED_ACTIVITY_TYPE_SC_LIFT_PUBLIC_ID,
  SEED_ACTIVITY_TYPE_WEIGH_IN_PUBLIC_ID,
  SEED_METRIC_BODYWEIGHT_PUBLIC_ID,
  SEED_METRIC_KEYS,
  UNIT_CODES,
} from '@mat-plan/shared';
import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import { schema } from '../src/client';
import {
  SEED_HOUSEHOLD_PUBLIC_ID,
  SEED_PROFILE_2_PUBLIC_ID,
  SEED_PROFILE_PUBLIC_ID,
  seed,
} from '../src/seed';

/**
 * Verifies the migration + seed against an in-process Postgres (PGlite) — no
 * Docker needed locally. Proves: the migration applies cleanly, the seed is
 * idempotent (run twice → identical), and the tagged-union CHECK is enforced.
 * The real DB gates (Docker PG + Neon branch) land at V0-11 in CI.
 */
const db = drizzle(new PGlite(), { schema, casing: 'snake_case' });
const asPg = db as unknown as NodePgDatabase<typeof schema>;

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
// NB: the legacy V0 `entries_shape_check` (dropped at V1-1c) still forces kind∈{bodyweight,
// strength} + value_num/movement_name; that guard is incidental here — the assertion is on the
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
const entryColsRes = await db.execute(sql`
  SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'entries'`);
const entryCols = (
  entryColsRes as unknown as { rows: { column_name: string; data_type: string }[] }
).rows;
for (const c of entryCols) {
  assert.ok(
    c.data_type !== 'json' && c.data_type !== 'jsonb',
    `entries.${c.column_name} is not json/jsonb (no EAV)`,
  );
}
const entryColNames = new Set(entryCols.map((c) => c.column_name));
for (const key of Object.keys(ACTIVITY_METRIC_MAP)) {
  assert.ok(!entryColNames.has(key), `no bespoke per-activity column named '${key}'`);
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

// CHECK ↔ shared-const parity: each DB text-enum CHECK definition must list EVERY member of
// its shared const (pins the schema CHECKs to the single source of truth — one can't drift
// from the other without this failing). V1-2 extends this from input_shape to the movement
// pattern + metric value_type/aggregation CHECKs (their columns are now catalog-populated).
async function assertCheckCoversConst(conname: string, values: readonly string[]): Promise<void> {
  const res = await db.execute(sql`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${conname}`);
  const rows = (res as unknown as { rows: { def: string }[] }).rows;
  assert.equal(rows.length, 1, `${conname} exists`);
  for (const value of values) {
    assert.ok(
      rows[0].def.includes(`'${value}'`),
      `${conname} includes shared const member '${value}'`,
    );
  }
}
await assertCheckCoversConst('activity_types_input_shape_check', ACTIVITY_INPUT_SHAPES);
await assertCheckCoversConst('movements_pattern_check', MOVEMENT_PATTERNS);
await assertCheckCoversConst('metric_definitions_value_type_check', METRIC_VALUE_TYPES);
await assertCheckCoversConst('metric_definitions_aggregation_check', METRIC_AGGREGATIONS);
console.log(
  '✓ schema-CHECK ↔ shared-const parity (input_shape, movement pattern, metric value_type + aggregation)',
);

console.log('✓ verify passed');
