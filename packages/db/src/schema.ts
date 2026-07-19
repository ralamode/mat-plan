import { sql } from 'drizzle-orm';
import {
  bigint,
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
 * v0 thin-slice schema (V0-5): units + profiles + entries + entry_sets.
 * Deliberately minimal — the household/activity_type/movement/metric catalogs and
 * their generalization land at V1-1 via a forward-migration. Conventions (AGENTS.md
 * "Schema & migration"): bigint identity PKs; UUIDv7 public_id; client_id for offline
 * idempotency; all timestamptz; soft delete; snake_case (Drizzle casing config).
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

export const profiles = pgTable(
  'profiles',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    publicId: uuid('public_id').notNull().unique(), // UUIDv7, app-generated (anti-IDOR)
    name: text('name').notNull(),
    kind: text('kind').notNull(), // mirrors PROFILE_KINDS in @mat-plan/shared
    ...timestamps,
  },
  (t) => [check('profiles_kind_check', sql`${t.kind} in ('kid', 'adult')`)],
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
    status: text('status').notNull().default('done'), // mirrors ENTRY_STATUSES
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    index('idx_entries_profile_date').on(t.profileId, t.activityDate), // hot path: Today view
    index('idx_entries_unit').on(t.unit), // covering index for the unit FK
    uniqueIndex('uq_entries_client_id')
      .on(t.clientId)
      .where(sql`${t.deletedAt} is null`),
    check('entries_kind_check', sql`${t.kind} in ('bodyweight', 'strength')`),
    check('entries_status_check', sql`${t.status} in ('done', 'skipped', 'sub_failure')`),
    // Tagged-union shape guard: bodyweight carries value_num (no movement); strength names a movement.
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
