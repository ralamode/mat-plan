import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { RoutineConfig } from '@mat-plan/shared';

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
    // V1-18: the per-kid routine (ordered activity keys). NULLABLE → the app resolves NULL to the default
    // routine (ships dark). JSONB is a knowing exception to the typed-columns rule (nothing queries INTO
    // it — see docs/tech-debt.md + the promotion trigger). `.$type` is a compile cast only; every read
    // zod-parses via `resolveRoutine` (the value is untrusted).
    routineConfig: jsonb('routine_config').$type<RoutineConfig>(),
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
    // V1-1c: kind relaxed to NULLABLE so metric-only / boolean check-in entries insert (a
    // check-in has no kind). The legacy dual-writer (logBodyweight/logStrengthEntry) still WRITES
    // kind, and entries_kind_check/entries_shape_check stay as guards on it — they don't block a
    // kind-less check-in (see the entries_shape_check note below re: value_num). Dropped in V1-1d.
    kind: text('kind'), // mirrors ENTRY_KINDS (nullable since V1-1c)
    unit: text('unit')
      .notNull()
      .references(() => units.code),
    movementName: text('movement_name'), // strength only (no movement catalog until V1-1)
    valueNum: numeric('value_num', { precision: 8, scale: 3 }), // bodyweight value
    rawLoad: text('raw_load'), // verbatim legacy strings → lossless CSV export
    rawReps: text('raw_reps'),
    // ── V1-1b generalized columns (additive; legacy kind/movement_name dropped in V1-1d) ──
    // All NULLABLE at the column level. The at-most-one tagged-union guard
    // (`movement_id IS NULL OR metric_key IS NULL`) is a HAND-ADDED CHECK in the migration,
    // NOT declared here — so the drizzle drift snapshot stays trivially clean (same pattern
    // as V1-1a's profiles NOT-NULL CHECK). `activity_type_id` is the discriminant invariant:
    // it becomes NOT NULL at V1-1c via a hand-added CHECK (NOT VALID → VALIDATE), mirroring
    // household_id — the drizzle column stays nullable so the snapshot stays simple.
    sessionId: bigint('session_id', { mode: 'number' }).references(() => sessions.id),
    activityTypeId: bigint('activity_type_id', { mode: 'number' }).references(
      () => activityTypes.id,
    ),
    movementId: bigint('movement_id', { mode: 'number' }).references(() => movements.id),
    metricKey: text('metric_key').references(() => metricDefinitions.key),
    // V1-8: superset grouping. A member movement is tagged with its superset + its order WITHIN that
    // superset (both NULL for a non-superset entry). The paired-nullability + member-is-a-movement
    // CHECKs are HAND-ADDED in the migration (not here), keeping the drizzle snapshot clean — same
    // pattern as entries_value_source_check / entries_activity_type_id_not_null.
    supersetId: bigint('superset_id', { mode: 'number' }).references(() => supersets.id),
    supersetOrder: integer('superset_order'),
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
    index('idx_entries_superset').on(t.supersetId), // covering index for the superset FK (V1-8)
    // Deterministic order WITHIN a superset — two members can't claim the same slot (V1-8). Mirrors
    // uq_entry_sets_entry_idx (the ordinal-within-parent idiom).
    uniqueIndex('uq_entries_superset_order')
      .on(t.supersetId, t.supersetOrder)
      .where(sql`${t.deletedAt} is null`),
    uniqueIndex('uq_entries_client_id')
      .on(t.clientId)
      .where(sql`${t.deletedAt} is null`),
    check('entries_kind_check', sql`${t.kind} in ('bodyweight', 'strength')`),
    check('entries_status_check', sql`${t.status} in ('done', 'skipped', 'sub_failure')`),
    // Legacy tagged-union shape guard (V0): bodyweight carries value_num (no movement); strength
    // names a movement. RETAINED past V1-1c — it (and entries_kind_check) still guard the live
    // `kind` dual-writer. On a kind=NULL check-in it passes AS LONG AS value_num is populated:
    // 3-valued logic makes the whole CHECK NULL (→ pass) when kind is NULL, but a NULL value_num
    // turns `value_num is not null` FALSE (→ reject). Every seeded metric is numeric (→ value_num),
    // so metric-only check-ins pass; a future text-only metric would need V1-1d's drop. Dropped in
    // V1-1d with the kind/movement_name columns. The generalized at-most-one CHECK
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
 * superset — groups 2+ movements performed ALTERNATING within a session (spec.md §4). Each member
 * movement still logs its own entry → entry_set, tagged by `entries.superset_id` + `superset_order`.
 * Built to carry ARBITRARY N-movement adult PPL pairings from day one (v2 reuses it — no kids-only
 * shortcut, no arity cap). Member order lives on `entries.superset_order`; a superset's session-level
 * position is insertion order (`entries.created_at`/`id`), so there is deliberately NO `position`
 * column. The "≥2 members" and same-session-membership invariants are enforced by the writer (a member
 * entry sets `session_id = superset.session_id`), not the schema — matching how `entry.profile_id`
 * vs `session.profile_id` is already handled. See docs/decisions/0003-superset-log-grouping.md.
 */
export const supersets = pgTable(
  'supersets',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    publicId: uuid('public_id').notNull().unique(), // UUIDv7, app-generated (anti-IDOR)
    // No natural key (label is free text) → client_id + partial UNIQUE is the idempotency arbiter for
    // the offline replay graph — the sessions/entries idiom (NOT ramp_targets, which has none).
    clientId: uuid('client_id').notNull(),
    sessionId: bigint('session_id', { mode: 'number' })
      .notNull()
      .references(() => sessions.id),
    label: text('label'), // "DB Bench + Overhead Press" / "light superset"
    note: text('note'),
    ...timestamps,
  },
  (t) => [
    index('idx_supersets_session').on(t.sessionId), // covering index for the session FK
    uniqueIndex('uq_supersets_client_id')
      .on(t.clientId)
      .where(sql`${t.deletedAt} is null`),
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

/**
 * ramp_target — per-profile, per-week TARGET value for a calisthenics metric (V1-6b; spec.md
 * §4: adherence is "modeled as target rows so it is computable in SQL"). A coach-authored
 * weekly calendar (week N = a set target, ramping to a cap) — NOT algorithmic performance-gated
 * advancement (that is the V2 progression engine's ladder/rung model). Config data, so there is
 * NO `client_id`: idempotency is the natural key `(profile_id, metric_key, week_start)`, mirroring
 * `day_readiness`. `metric_key` FKs the metric catalog; `target_value` reuses the `entries`
 * numeric(8,3) domain. See ADR 0002 for `ramp_target` vs `goal`/`prescription_target`.
 */
export const rampTargets = pgTable(
  'ramp_targets',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    publicId: uuid('public_id').notNull().unique(), // UUIDv7, app-generated (anti-IDOR)
    profileId: bigint('profile_id', { mode: 'number' })
      .notNull()
      .references(() => profiles.id),
    metricKey: text('metric_key')
      .notNull()
      .references(() => metricDefinitions.key),
    weekStart: date('week_start').notNull(), // ISO-week Monday (UTC)
    targetValue: numeric('target_value', { precision: 8, scale: 3 }).notNull(),
    ...timestamps,
  },
  (t) => [
    index('idx_ramp_targets_profile').on(t.profileId), // covering index for the profile FK
    index('idx_ramp_targets_metric_key').on(t.metricKey), // covering index for the metric_key FK
    // Natural-key UNIQUE, partial (WHERE deleted_at is null) — the idempotency arbiter, so a
    // soft-deleted target doesn't block re-inserting the same profile/metric/week (like day_readiness).
    uniqueIndex('uq_ramp_targets_profile_metric_week')
      .on(t.profileId, t.metricKey, t.weekStart)
      .where(sql`${t.deletedAt} is null`),
    check('ramp_targets_target_value_check', sql`${t.targetValue} >= 0`),
  ],
);

/**
 * program_block — a household's named training plan (V1-10; spec.md §4). Household-scoped AUTHORED content
 * (the profiles idiom), not a global reference catalog. Config data → NO client_id; idempotency = the
 * partial-unique natural key `(household_id, slug)` (like ramp_targets/day_readiness). `slug` (not raw
 * `name`) is the identity so a re-seed can't duplicate a block on whitespace/casing (the movements.slug
 * idiom); the seed sets slug = movementSlug(name).
 */
export const programBlocks = pgTable(
  'program_blocks',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    publicId: uuid('public_id').notNull().unique(), // UUIDv7, app-generated (anti-IDOR)
    householdId: bigint('household_id', { mode: 'number' })
      .notNull()
      .references(() => households.id),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    index('idx_program_blocks_household').on(t.householdId), // covering index for the household FK
    uniqueIndex('uq_program_blocks_household_slug')
      .on(t.householdId, t.slug)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/**
 * prescription — one movement in a block's day (V1-10; spec.md §4). `day_role` (text+CHECK ∈ shared
 * DAY_ROLES — its OWN vocabulary, a superset of SESSION_TYPES incl. strength_a/strength_b) + `idx` order it
 * within the day; `sets`/`target_reps` are the prescription shared across kids (per-kid loads live in
 * `prescription_targets`). Config → no client_id; natural key `(block_id, day_role, idx)` is a SLOT arbiter
 * (a movement may legitimately appear twice in a day — warm-up + working — so the key is NOT movement_id),
 * which means a re-seed is INSERT-ONLY (onConflictDoNothing never reorders/replaces a slot — the ramp_targets
 * precedent; block edits are a future authoring path, not re-seed). `target_reps` is TEXT (lossless "8-12"/
 * "AMRAP", like entries.raw_reps).
 */
export const prescriptions = pgTable(
  'prescriptions',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    publicId: uuid('public_id').notNull().unique(),
    blockId: bigint('block_id', { mode: 'number' })
      .notNull()
      .references(() => programBlocks.id),
    dayRole: text('day_role').notNull(), // mirrors shared DAY_ROLES (pinned by db:verify)
    movementId: bigint('movement_id', { mode: 'number' })
      .notNull()
      .references(() => movements.id),
    idx: integer('idx').notNull(), // 0-based order within the day (matches entry_sets.idx idiom)
    sets: integer('sets'), // prescribed set count (nullable — a movement-only prescription)
    targetReps: text('target_reps'), // verbatim/lossless: "3", "8-12", "AMRAP"
    ...timestamps,
  },
  (t) => [
    index('idx_prescriptions_block').on(t.blockId), // covering index for the block FK
    index('idx_prescriptions_movement').on(t.movementId), // covering index for the movement FK
    uniqueIndex('uq_prescriptions_block_day_role_idx')
      .on(t.blockId, t.dayRole, t.idx)
      .where(sql`${t.deletedAt} is null`),
    // Inlines the shared DAY_ROLES literals (a CHECK can't import a const); db:verify pins the accepted set
    // to DAY_ROLES via assertCheckCoversConst so this frozen list can't silently drift from shared.
    check(
      'prescriptions_day_role_check',
      sql`${t.dayRole} in ('strength', 'conditioning', 'skill', 'push', 'pull', 'legs', 'core', 'strength_a', 'strength_b')`,
    ),
    check('prescriptions_idx_check', sql`${t.idx} >= 0`),
    check('prescriptions_sets_check', sql`${t.sets} is null or ${t.sets} > 0`),
  ],
);

/**
 * prescription_target — a per-profile SUGGESTED LOAD on a prescription (V1-10; spec.md §4: "per-profile
 * loads, a real table not jsonb"). HUMAN-AUTHORED — the LLM never authors loads (AGENTS.md). `load` is
 * verbatim/lossless TEXT ("65"/"BW"/"50ft", like entries.raw_load). Config → no client_id; natural key
 * `(prescription_id, profile_id)`. INVARIANT (writer-enforced, not schema — the supersets precedent): the
 * target's profile must belong to the block's household; the slice-2 DAL scopes reads by that household join
 * (BOLA), and the data-PR seed resolves profiles within the block's household. A composite-FK hardening
 * (denormalized household_id) is a future option if a writer ever needs schema-level enforcement.
 */
export const prescriptionTargets = pgTable(
  'prescription_targets',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    publicId: uuid('public_id').notNull().unique(),
    prescriptionId: bigint('prescription_id', { mode: 'number' })
      .notNull()
      .references(() => prescriptions.id),
    profileId: bigint('profile_id', { mode: 'number' })
      .notNull()
      .references(() => profiles.id),
    load: text('load'), // per-kid suggested load, verbatim (nullable)
    ...timestamps,
  },
  (t) => [
    index('idx_prescription_targets_prescription').on(t.prescriptionId), // covering index for the FK
    index('idx_prescription_targets_profile').on(t.profileId), // covering index for the profile FK
    uniqueIndex('uq_prescription_targets_prescription_profile')
      .on(t.prescriptionId, t.profileId)
      .where(sql`${t.deletedAt} is null`),
  ],
);
