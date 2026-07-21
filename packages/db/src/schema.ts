import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Schema — v0 thin slice (units + profiles + entries + entry_sets) plus the V1-1a
 * ADDITIVE generalization toward the full activity model (spec.md §4): the
 * household + activity_type/movement/metric catalogs, session, and day_readiness.
 * V1-1a is expand-only — it does NOT touch `entries`/`entry_sets`; the entry
 * generalization (movement_id/metric_key + the at-most-one CHECK) is V1-1b and the
 * destructive contract is V1-1c. Conventions (AGENTS.md "Schema & migration"):
 * bigint identity PKs; UUIDv7 public_id; client_id for offline idempotency; all
 * timestamptz; soft delete; snake_case (Drizzle casing config); enums = reference
 * tables (units, activity_type_categories) or text+CHECK, never native pgEnum.
 */

// Shared audit/soft-delete columns. Centralizing the group keeps every table's
// LWW/soft-delete semantics identical (constants-convention: reuse, don't repeat).
const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // LWW compares CLIENT-supplied updated_at at sync time (v1.5); default now() for now.
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
};

/** Reference table for the `unit` enum — seeded from @mat-plan/shared UNITS. */
export const units = pgTable('units', {
  code: text('code').primaryKey(),
  label: text('label').notNull(),
  createdAt: timestamps.createdAt,
});

/**
 * Reference table for `activity_type.category` — seeded from @mat-plan/shared
 * ACTIVITY_CATEGORY_ROWS (spec.md §4). FK target for `activity_types.category`.
 */
export const activityTypeCategories = pgTable('activity_type_categories', {
  code: text('code').primaryKey(),
  label: text('label').notNull(),
  createdAt: timestamps.createdAt,
});

/**
 * Households — the authz root (spec.md §4): a Clerk operator owns one household and
 * every profile/log row is household-scoped for DAL ownership checks. Written now so
 * `profiles.household_id` has a target; membership UI lands with Clerk at v1.5.
 */
export const households = pgTable('households', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  publicId: uuid('public_id').notNull().unique(), // UUIDv7, app-generated (anti-IDOR)
  name: text('name').notNull(),
  ...timestamps,
});

export const profiles = pgTable(
  'profiles',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    publicId: uuid('public_id').notNull().unique(), // UUIDv7, app-generated (anti-IDOR)
    name: text('name').notNull(),
    kind: text('kind').notNull(), // mirrors PROFILE_KINDS in @mat-plan/shared
    // V1-1a additive: household_id is the authz root (spec.md §4). Kept NULLABLE at the
    // column level; the migration enforces NOT NULL via a CHECK (NOT VALID → backfill →
    // VALIDATE) so the one existing seed profile can be backfilled without a table rewrite.
    householdId: bigint('household_id', { mode: 'number' }).references(() => households.id),
    birthdate: date('birthdate'), // spec.md §2 — column only, no UI (PIN/profile fields deferred)
    avatar: text('avatar'),
    pinHash: text('pin_hash'), // PIN deferred; column reserved (spec.md §2)
    ...timestamps,
  },
  (t) => [
    check('profiles_kind_check', sql`${t.kind} in ('kid', 'adult')`),
    index('idx_profiles_household').on(t.householdId), // covering index for the household FK
  ],
);

export const entries = pgTable(
  'entries',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    publicId: uuid('public_id').notNull().unique(),
    clientId: uuid('client_id').notNull(), // offline idempotency; UNIQUE via partial index below
    profileId: bigint('profile_id', { mode: 'number' })
      .notNull()
      .references(() => profiles.id),
    activityDate: date('activity_date').notNull(), // declared date (not device clock)
    eventAt: timestamp('event_at', { withTimezone: true }), // timing activities (future)
    kind: text('kind').notNull(), // mirrors ENTRY_KINDS
    unit: text('unit')
      .notNull()
      .references(() => units.code),
    movementName: text('movement_name'), // strength only (no movement catalog until V1-1)
    valueNum: numeric('value_num', { precision: 8, scale: 3 }), // bodyweight value
    rawLoad: text('raw_load'), // verbatim legacy strings → lossless CSV export
    rawReps: text('raw_reps'),
    // ── V1-1b generalized columns (additive; legacy kind/movement_name stay until V1-1c) ──
    // All NULLABLE now. The at-most-one tagged-union guard
    // (`movement_id IS NULL OR metric_key IS NULL`) is a HAND-ADDED CHECK in the migration,
    // NOT declared here — so the drizzle drift snapshot stays trivially clean (same pattern
    // as V1-1a's profiles NOT-NULL CHECK). `activity_type_id` becomes NOT NULL at V1-1c.
    sessionId: bigint('session_id', { mode: 'number' }).references(() => sessions.id),
    activityTypeId: bigint('activity_type_id', { mode: 'number' }).references(
      () => activityTypes.id,
    ),
    movementId: bigint('movement_id', { mode: 'number' }).references(() => movements.id),
    metricKey: text('metric_key').references(() => metricDefinitions.key),
    valueText: text('value_text'), // free-text / non-numeric metric readings
    context: text('context'), // e.g. warmup/working/amrap qualifier
    scheme: text('scheme'), // e.g. set/rep scheme label
    status: text('status').notNull().default('done'), // mirrors ENTRY_STATUSES
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    index('idx_entries_profile_date').on(t.profileId, t.activityDate), // hot path: Today view
    index('idx_entries_unit').on(t.unit), // covering index for the unit FK
    index('idx_entries_session').on(t.sessionId), // covering index for the session FK
    index('idx_entries_activity_type').on(t.activityTypeId), // covering index for the activity_type FK
    index('idx_entries_movement').on(t.movementId), // covering index for the movement FK
    index('idx_entries_metric_key').on(t.metricKey), // covering index for the metric_key FK
    uniqueIndex('uq_entries_client_id')
      .on(t.clientId)
      .where(sql`${t.deletedAt} is null`),
    check('entries_kind_check', sql`${t.kind} in ('bodyweight', 'strength')`),
    check('entries_status_check', sql`${t.status} in ('done', 'skipped', 'sub_failure')`),
    // Legacy tagged-union shape guard (V0): bodyweight carries value_num (no movement); strength
    // names a movement. Kept until V1-1c; the generalized at-most-one CHECK
    // (entries_value_source_check) is hand-added in the V1-1b migration alongside it.
    check(
      'entries_shape_check',
      sql`(${t.kind} = 'bodyweight' and ${t.valueNum} is not null and ${t.movementName} is null)
          or (${t.kind} = 'strength' and ${t.movementName} is not null)`,
    ),
  ],
);

export const entrySets = pgTable(
  'entry_sets',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    publicId: uuid('public_id').notNull().unique(),
    clientId: uuid('client_id').notNull(),
    entryId: bigint('entry_id', { mode: 'number' })
      .notNull()
      .references(() => entries.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(), // 1-based set order within the entry
    reps: integer('reps'),
    seconds: integer('seconds'),
    weightNum: numeric('weight_num', { precision: 7, scale: 3 }),
    weightLabel: text('weight_label'), // 'BW', '50ft', etc.
    status: text('status').notNull().default('done'),
    ...timestamps,
  },
  (t) => [
    index('idx_entry_sets_entry').on(t.entryId),
    uniqueIndex('uq_entry_sets_entry_idx')
      .on(t.entryId, t.idx)
      .where(sql`${t.deletedAt} is null`),
    uniqueIndex('uq_entry_sets_client_id')
      .on(t.clientId)
      .where(sql`${t.deletedAt} is null`),
    check('entry_sets_status_check', sql`${t.status} in ('done', 'skipped', 'sub_failure')`),
  ],
);

// ── V1-1a additive catalog + log tables (spec.md §4) ────────────────────────────
// All expand-only: created now, populated later (catalogs seeded at V1-2; sessions
// first written at V1-8). Every FK gets a covering index; text-enum columns get a
// CHECK mirroring the @mat-plan/shared const list (coverage test lands at V1-2).

/**
 * activity_type — what makes the logger portable (spec.md §4): wake, weigh_in,
 * wrestling_practice, calisthenics, sc_lift, … are rows, not code. `category` FKs the
 * reference table; `input_shape` is a text+CHECK structural enum; `default_unit` FKs units.
 */
export const activityTypes = pgTable(
  'activity_types',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    publicId: uuid('public_id').notNull().unique(),
    key: text('key').notNull().unique(), // stable identifier (e.g. 'weigh_in')
    label: text('label').notNull(),
    category: text('category')
      .notNull()
      .references(() => activityTypeCategories.code),
    inputShape: text('input_shape').notNull(), // mirrors ACTIVITY_INPUT_SHAPES
    defaultUnit: text('default_unit').references(() => units.code),
    icon: text('icon'),
    ...timestamps,
  },
  (t) => [
    index('idx_activity_types_category').on(t.category), // covering index for the category FK
    index('idx_activity_types_default_unit').on(t.defaultUnit), // covering index for the unit FK
    check(
      'activity_types_input_shape_check',
      sql`${t.inputShape} in ('set_list', 'single_metric', 'boolean', 'timing')`,
    ),
  ],
);

/**
 * movement — the exercise catalog (spec.md §4): slug/name + optional movement pattern,
 * default unit, bodyweight flag, and coaching media. `pattern` is a text+CHECK enum.
 */
export const movements = pgTable(
  'movements',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    publicId: uuid('public_id').notNull().unique(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    pattern: text('pattern'), // mirrors MOVEMENT_PATTERNS (nullable)
    unitDefault: text('unit_default').references(() => units.code),
    isBodyweight: boolean('is_bodyweight').notNull().default(false),
    videoUrl: text('video_url'),
    cues: text('cues'),
    ...timestamps,
  },
  (t) => [
    index('idx_movements_unit_default').on(t.unitDefault), // covering index for the unit FK
    check(
      'movements_pattern_check',
      sql`${t.pattern} in ('squat', 'hinge', 'horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull', 'lunge', 'jump', 'core', 'carry', 'isolation')`,
    ),
  ],
);

/**
 * metric_definition — typed metrics (spec.md §4): bodyweight, shot (canonical),
 * pullup_max (aggregation=max), habit check-ins, … `value_type` + `aggregation` are
 * text+CHECK structural enums; `unit` FKs the units reference table.
 */
export const metricDefinitions = pgTable(
  'metric_definitions',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    publicId: uuid('public_id').notNull().unique(),
    key: text('key').notNull().unique(),
    label: text('label').notNull(),
    unit: text('unit')
      .notNull()
      .references(() => units.code),
    valueType: text('value_type').notNull(), // mirrors METRIC_VALUE_TYPES
    aggregation: text('aggregation').notNull(), // mirrors METRIC_AGGREGATIONS
    ...timestamps,
  },
  (t) => [
    index('idx_metric_definitions_unit').on(t.unit), // covering index for the unit FK
    check(
      'metric_definitions_value_type_check',
      sql`${t.valueType} in ('number', 'count', 'scale_10', 'bool', 'duration', 'text')`,
    ),
    check(
      'metric_definitions_aggregation_check',
      sql`${t.aggregation} in ('sum', 'last', 'max', 'avg')`,
    ),
  ],
);

/**
 * session — a training session grouping entries (spec.md §4): declared activity_date +
 * informational logged_at, optional session_type, session-grain feel. Mutable/LWW,
 * client_id for offline idempotency. First written at V1-8.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    publicId: uuid('public_id').notNull().unique(),
    clientId: uuid('client_id').notNull(), // offline idempotency; UNIQUE via partial index below
    profileId: bigint('profile_id', { mode: 'number' })
      .notNull()
      .references(() => profiles.id),
    activityDate: date('activity_date').notNull(), // declared date (not device clock)
    loggedAt: timestamp('logged_at', { withTimezone: true }), // device clock, informational
    sessionType: text('session_type'), // mirrors SESSION_TYPES (nullable)
    status: text('status').notNull().default('done'), // mirrors SESSION_STATUSES
    source: text('source'),
    feel: text('feel'), // session-grain feel/soreness (spec.md §4)
    ...timestamps,
  },
  (t) => [
    index('idx_sessions_profile_date').on(t.profileId, t.activityDate), // covers the profile FK + hot path
    uniqueIndex('uq_sessions_client_id')
      .on(t.clientId)
      .where(sql`${t.deletedAt} is null`),
    check(
      'sessions_session_type_check',
      sql`${t.sessionType} in ('strength', 'conditioning', 'skill', 'push', 'pull', 'legs', 'core')`,
    ),
    check('sessions_status_check', sql`${t.status} in ('done', 'skipped', 'sub_failure')`),
  ],
);

/**
 * day_readiness — per-day readiness gate (spec.md §4: readiness is per-day, not
 * per-session). One row per profile per day; `gate_color` is a text+CHECK enum.
 */
export const dayReadiness = pgTable(
  'day_readiness',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    publicId: uuid('public_id').notNull().unique(),
    profileId: bigint('profile_id', { mode: 'number' })
      .notNull()
      .references(() => profiles.id),
    readinessDate: date('readiness_date').notNull(),
    gateColor: text('gate_color').notNull(), // mirrors GATE_COLORS
    note: text('note'),
    ...timestamps,
  },
  (t) => [
    index('idx_day_readiness_profile').on(t.profileId), // covering index for the profile FK
    uniqueIndex('uq_day_readiness_profile_date')
      .on(t.profileId, t.readinessDate)
      .where(sql`${t.deletedAt} is null`),
    check('day_readiness_gate_color_check', sql`${t.gateColor} in ('green', 'yellow', 'red')`),
  ],
);
