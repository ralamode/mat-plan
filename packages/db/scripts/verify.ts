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
  const [entry] = await db
    .insert(schema.entries)
    .values({
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
    })
    .onConflictDoNothing({
      target: schema.entries.clientId,
      where: isNull(schema.entries.deletedAt),
    })
    .returning({ id: schema.entries.id });
  const entryId =
    entry?.id ??
    (
      await db
        .select({ id: schema.entries.id })
        .from(schema.entries)
        .where(eq(schema.entries.clientId, cid))
    )[0].id;
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

/** Insert a session (idempotent by client_id). */
async function insertSession(tag: string, profileId: number): Promise<number> {
  const cid = `019826b4-0000-7000-8000-000000000d${tag}`;
  const [row] = await db
    .insert(schema.sessions)
    .values({
      publicId: `019826b4-0000-7000-8000-000000000e${tag}`,
      clientId: cid,
      profileId,
      activityDate: '2026-02-02',
      sessionType: 'strength',
    })
    .onConflictDoNothing({
      target: schema.sessions.clientId,
      where: isNull(schema.sessions.deletedAt),
    })
    .returning({ id: schema.sessions.id });
  return (
    row?.id ??
    (
      await db
        .select({ id: schema.sessions.id })
        .from(schema.sessions)
        .where(eq(schema.sessions.clientId, cid))
    )[0].id
  );
}

/** Insert a superset (idempotent by client_id). */
async function insertSuperset(tag: string, sessionId: number, label: string): Promise<number> {
  const cid = `019826b4-0000-7000-8000-000000000f${tag}`;
  const [row] = await db
    .insert(schema.supersets)
    .values({
      publicId: `019826b4-0000-7000-8000-0000000010${tag}`,
      clientId: cid,
      sessionId,
      label,
    })
    .onConflictDoNothing({
      target: schema.supersets.clientId,
      where: isNull(schema.supersets.deletedAt),
    })
    .returning({ id: schema.supersets.id });
  return (
    row?.id ??
    (
      await db
        .select({ id: schema.supersets.id })
        .from(schema.supersets)
        .where(eq(schema.supersets.clientId, cid))
    )[0].id
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

console.log('✓ verify passed');
