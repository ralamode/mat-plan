import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  foreignKey,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { DEFAULT_TRACKING_TYPE, PROGRAM_BLOCK_KIND, type RoutineConfig } from '@mat-plan/shared';

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
export const units = pgTable(
  'units',
  {
    code: text('code').primaryKey(),
    label: text('label').notNull(),
    /**
     * GAP-3 — what KIND of quantity this unit measures (`mass` / `length` / `time` / `instant` /
     * `count` / `boolean`; mirrors shared `UNIT_DIMENSIONS`, pinned by `db:verify`).
     *
     * This is what makes `lb` in a box-jump height **unrepresentable** rather than discouraged: a
     * measurement column FKs to `units(code)` and constrains the dimension alongside it, so the DB
     * rejects a mass unit in a length field. NOT NULL deliberately — a nullable dimension re-opens
     * exactly the hole the column exists to close.
     */
    dimension: text('dimension').notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    // text+CHECK, never a native pgEnum (AGENTS.md "don't" list). Kept in lockstep with the shared
    // UNIT_DIMENSIONS const by `db:verify`'s assertCheckCoversConst, in BOTH directions.
    check(
      'units_dimension_check',
      sql`${t.dimension} in ('mass', 'length', 'time', 'instant', 'count', 'boolean')`,
    ),
    // A measurement column that stores (unit, dimension) together needs this to FK against, so the
    // pair is validated as a pair rather than each half independently. Added now because the column
    // it serves arrives in GAP-3 PR 3, and adding it here keeps PR 3 free of units-table DDL.
    uniqueIndex('uq_units_code_dimension').on(t.code, t.dimension),
  ],
);

/**
 * GAP-3 — the vocabulary of measured-quantity ROLES, seeded from @mat-plan/shared
 * QUANTITY_SLOT_ROWS. FK target for `entry_set_quantities(slot, dimension)`.
 *
 * The PK is the **pair**, not the code: `primary` is legal at `mass` (back squat), `length` (broad
 * jump) and `time` (hollow-body hold), so a movement's primary quantity always has a home. Making
 * the pair the PK is also what lets `entry_set_quantities` FK against it — drizzle inlines a PK into
 * `CREATE TABLE`, whereas a `uniqueIndex` target is emitted AFTER the FK that references it and the
 * migration aborts (see docs/lessons.md).
 *
 * No `label` column: labels are a rendering concern and live in @mat-plan/shared. No `sort_order`:
 * field order comes from the MOVEMENT's declared slot set (GAP-3 §7.2c / V1-22), not a global one.
 */
export const quantitySlots = pgTable(
  'quantity_slots',
  {
    code: text('code').notNull(),
    dimension: text('dimension').notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    primaryKey({ columns: [t.code, t.dimension] }),
    // Mirrors shared UNIT_DIMENSIONS; pinned by db:verify's assertCheckCoversConst. Kept even though
    // the seed is the only writer — it is what makes a hand-written INSERT in psql fail too.
    check(
      'quantity_slots_dimension_check',
      sql`${t.dimension} in ('mass', 'length', 'time', 'instant', 'count', 'boolean')`,
    ),
  ],
);

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
 * `profiles.household_id` has a target; Clerk landed at Beta 0 (`AUTH-1`) and the
 * membership UI is `PROF-1`.
 */
export const households = pgTable('households', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  publicId: uuid('public_id').notNull().unique(), // UUIDv7, app-generated (anti-IDOR)
  name: text('name').notNull(),
  // TEN-1 chunk 1a, for OBS-2 (docs/plan.md → OBS-2). A synthetic-monitoring household will live in
  // PRODUCTION, and its rows must be excluded from every aggregate — adherence, streaks, export — or
  // the monitor pollutes the numbers it exists to protect. OBS-2 asks for the flag by name, so the
  // column lands while it is still a metadata-only ADD COLUMN.
  //
  // SHIPS DARK, END TO END: nothing in TEN-1 reads or writes it. It is deliberately NOT carried on
  // TEN-1's `HouseholdScope` — an authorization capability is the wrong carrier for an observability
  // flag — and keeping it off the scope means no PR between this one and OBS-2 names the column, so
  // there is no deploy-order window at all. OBS-2 adds the read and whatever honours it. This is
  // NEVER an authorization input.
  //
  // ⚠️ THE SEED MUST NEVER NAME THIS COLUMN. `migrate.yml` runs `db:seed` against prod on every push,
  // and on a FRESH or restored database the seed inserts the real household's row — so a seeded value
  // would label a real family's data a test fixture. `synthetic = true` is an assertion by whoever
  // creates a fixture, never a property inherited from a seed that also runs in production.
  //
  // ⚠️ A synthetic household must NOT exist in prod before AUTH-1: until then TEN-1's
  // `getHouseholdScope()` resolves THE single live household and THROWS on >= 2 live rows (it cannot
  // tell whose data it holds), so creating a second household took the app down.
  // ⚠️ **No longer true since `AUTH-1` 1c-4**, and the replacement is earlier rather than louder:
  // the resolver counts a principal's memberships now, so a second household is ordinary. What
  // stops one appearing by accident is `seed.ts` refusing to insert when a live household exists.
  synthetic: boolean('synthetic').notNull().default(false),
  ...timestamps,
});

/**
 * AUTH-1 1b — which Clerk account belongs to which household. **Ships DARK: nothing reads it.**
 * 1c's `getHouseholdScope()` is the first reader; the only writer is a maintainer-run correction.
 *
 * **No email column, deliberately.** The person's email and Google identifier live in Clerk — that is
 * the point of using Clerk — so storing the opaque account id and nothing else is the
 * data-minimisation answer (`docs/privacy/data-inventory.md` § 7).
 *
 * ⚠️ **`clerk_user_id` is a NEW identifier class for this database**: a stable third-party account id
 * for a named adult. And because § 5 of that document records that a soft-deleted row "stays in the
 * database indefinitely … Nothing purges them", **a soft-deleted membership retains that identifier
 * indefinitely** — the household deletion is its only purge. § 8 carries the retention row.
 *
 * 🔴 **This is the 19th per-household table, and the deletion runbook's order is hand-maintained.**
 * The FK is `ON DELETE NO ACTION` (drizzle's default), which is the runbook's stated safety property —
 * "a table this procedure missed would have aborted the transaction rather than silently orphaning
 * rows". So with a live membership, `DELETE FROM households` **aborts the whole transaction** until
 * step 4c names this table. `db:verify` proves the order commits and leaves zero rows.
 *
 * **No `client_id`**: the config-table idiom this file already states — a membership is never written
 * by an offline client.
 */
export const householdMembers = pgTable(
  'household_members',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    publicId: uuid('public_id').notNull().unique(), // UUIDv7, app-generated (anti-IDOR)
    householdId: bigint('household_id', { mode: 'number' })
      .notNull()
      .references(() => households.id),
    // Clerk's own user id (`user_…`). TEXT and no FK: there is no users table and will not be one in
    // Beta 0. ⚠️ Clerk instances are SEPARATE user pools — a development id is not the production id
    // for the same Google account, so the claim correction must be run with the id from the instance
    // that will be live when the resolver reads it.
    clerkUserId: text('clerk_user_id').notNull(),
    role: text('role').notNull(), // mirrors HOUSEHOLD_ROLES in @mat-plan/shared
    ...timestamps,
  },
  (t) => [
    index('idx_household_members_household').on(t.householdId), // covers the FK
    // BOTH the state-D constraint (one live household per Clerk account) AND the resolver's access
    // path — a partial unique index is a btree index, so a companion `idx_` on the same column with
    // the same predicate would buy nothing and cost a write on every insert and soft delete. The
    // ⚠️ Postgres has no partial UNIQUE *constraint*; this can only be an index.
    // ⚠️ This used to cite `uq_entries_client_id` as "the same shape". It no longer is — V1-9b B0
    // made every `client_id` unique NON-partial, for the reason written at that index. The shape
    // this one shares is with the SLOT uniques (an ordinal, a day, a position), not with an
    // offline identity.
    uniqueIndex('uq_household_members_clerk_user')
      .on(t.clerkUserId)
      .where(sql`${t.deletedAt} is null`),
    // Inlines the shared HOUSEHOLD_ROLES literals (a CHECK can't import a const); db:verify pins the
    // accepted set to HOUSEHOLD_ROLES via assertCheckCoversConst — the sessions_day_role_check
    // pattern, NOT profiles_kind_check, which is the one enum CHECK here with no such assertion.
    check('household_members_role_check', sql`${t.role} in ('owner','member')`),
  ],
);

export const profiles = pgTable(
  'profiles',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    publicId: uuid('public_id').notNull().unique(), // UUIDv7, app-generated (anti-IDOR)
    /**
     * PROF-1 a-0 — offline/replay idempotency for "add an athlete", UNIQUE via
     * `uq_profiles_client_id` below, **non-partial** (see that index's note).
     *
     * 🔴 **NULLABLE, unlike every other `client_id` in this schema**, and deliberately: the seed and
     * `db:correct` corrections create profiles server-side with no client to mint a key. NOT NULL
     * would need a backfill plus the `NOT VALID` -> `VALIDATE` split — two more migrations — to store
     * a fabricated UUID that means nothing. NULLs are distinct in a unique index, so seeded rows
     * coexist without colliding. `addAthleteSchema` requires it for every app-created row, so this is
     * a server-side-creator allowance, not an opening in the write path.
     */
    clientId: uuid('client_id'),
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
    /**
     * PROF-1 b — archive an athlete. **Archive is NOT deletion and NOT a security boundary**:
     * `deleted_at` is the soft delete; this is "not currently training". An archived athlete keeps
     * every row, still exports, and is still reachable by anyone who opens their link — only the
     * picker drops them (`listProfiles`). The privacy notice says so in those terms.
     *
     * ⚠️ **Never add this to `isLiveProfile`'s predicate** (`writers/ownership.ts`). That predicate is
     * the ownership seam; folding a UX filter into it would turn "archived" into a 404 and make
     * archive silently irreversible from the athlete's own page. Archive is a LIST filter —
     * `docs/features/write-path.md` carries the invariant.
     */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check('profiles_kind_check', sql`${t.kind} in ('kid', 'adult')`),
    index('idx_profiles_household').on(t.householdId), // covering index for the household FK
    /**
     * 🔴 **NON-PARTIAL.** ADR 0008 decision 3.4
     * applied at birth rather than retrofitted. Every older arbiter is `WHERE deleted_at IS NULL`, so
     * a soft-deleted row stops being an `ON CONFLICT` target and a replay inserts a TWIN
     * (`docs/decisions/0008-deletion.md:127`). ✅ **V1-9b B0 re-predicated those five**, so this is no
     * longer the only one — it is the one that was right first, and the others cite it. With no
     * predicate, an archived — or later deleted — profile keeps its slot, so a retried "add" resolves
     * to the same athlete instead of minting a second one.
     *
     * ⚠️ The consequence, stated so nobody "fixes" it: a `client_id` can never be reused for a
     * different athlete, even after the first is gone. That is the point, not an oversight.
     */
    uniqueIndex('uq_profiles_client_id').on(t.clientId),
  ],
);

/**
 * The bodyweight one-per-day unique index (V1-24 PR 1d, migration 0012), named once for the schema
 * below. The insert does NOT name it: since 1e its arbiter is target-less (every unique index
 * arbitrates; see `writers/bodyweight.ts`). The one runtime match is `hide.ts`'s restore, which reads
 * a `23505`'s constraint name against `RESTORE_SLOT_INDEXES`. Renaming it means a new migration too.
 */
export const BODYWEIGHT_DAY_UNIQUE_INDEX = 'uq_entries_profile_day_bodyweight';

/**
 * The practice one-per-day unique index (V1-24 3b-0), the bodyweight index's twin without a slot.
 * Like it, the insert never names it (`writers/checkin.ts` is target-less since 3b-0) and restore
 * matches it by name. Renaming it means a new migration too.
 */
export const PRACTICE_DAY_UNIQUE_INDEX = 'uq_entries_profile_day_practice';

/**
 * V1-9b B2-0: `entries.hide_reason` holds only a `HIDE_REASONS` value (`db:verify` pins the literal to
 * the const). Named so the proofs reference it rather than re-typing it.
 */
export const ENTRY_HIDE_REASON_CHECK = 'entries_hide_reason_check';

/**
 * V1-9b B2-0: a LIVE entry never carries a hide reason. 🔴 So every un-hide clears `hide_reason` in
 * the same statement as `deleted_at` (`UNHIDE` in `writers/hide.ts`); one that forgets fails `23514`
 * here, loudly, rather than leaving a live row the "Day cleared" banner would count.
 */
export const ENTRY_HIDE_REASON_HIDDEN_CHECK = 'entries_hide_reason_hidden_check';

/**
 * FAM-1 4a-ii's three arbiters (ADR 0007 A2 §6, A3), named once so code that must name one matches it
 * by const, as it matches `BODYWEIGHT_DAY_UNIQUE_INDEX`. Renaming one means a new migration too.
 * ⚠️ Step 11b's row writer infers the session and superset arbiters with a bare `ON CONFLICT`, so today
 * only `ENTRY_PRESCRIPTION_SET_UNIQUE_INDEX` has a code consumer (`hide.ts`'s restore list); the other
 * two are kept for a restore check or an explicit target, not because anything reads them yet.
 */
export const SESSION_WORKOUT_DAY_UNIQUE_INDEX = 'uq_sessions_profile_day_workout';
export const SUPERSET_PRESCRIPTION_GROUP_UNIQUE_INDEX = 'uq_supersets_session_prescription_group';
export const ENTRY_PRESCRIPTION_SET_UNIQUE_INDEX = 'uq_entries_session_prescription_set';

/**
 * A household's block slug key, named once so lane P's program writers (`writers/program/program-name.ts`,
 * `lostSlugRace`) recognise a lost slug race by const. Renaming it means a new migration too.
 */
export const PROGRAM_BLOCK_SLUG_UNIQUE_INDEX = 'uq_program_blocks_household_slug';

/**
 * FAM-1 step 5's three assignment keys, named once so lane P's put-on, take-off and reorder writers
 * (6c, 6d) recognise a 23505 by const. Renaming one means a new migration too. See `programAssignments`.
 */
export const ASSIGNMENT_START_UNIQUE_INDEX = 'uq_program_assignments_profile_block_from';
export const ASSIGNMENT_OPEN_UNIQUE_INDEX = 'uq_program_assignments_profile_block_open';
export const ASSIGNMENT_ORDER_UNIQUE_INDEX = 'uq_program_assignments_profile_idx';

/**
 * FAM-1 4b's two template-prescription keys and the quantity slot key, named once so step 6a's
 * save-workout and shift-band writers match a 23505 by const. Renaming one means a new migration too.
 */
export const PRESCRIPTION_WORKOUT_CLIENT_ID_UNIQUE_INDEX = 'uq_prescriptions_workout_client_id';
export const PRESCRIPTION_WORKOUT_SLOT_UNIQUE_INDEX = 'uq_prescriptions_workout_idx';
export const PRESCRIPTION_QUANTITY_SLOT_UNIQUE_INDEX =
  'uq_prescription_quantities_prescription_slot';

export const entries = pgTable(
  'entries',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    publicId: uuid('public_id').notNull().unique(),
    clientId: uuid('client_id').notNull(), // offline idempotency; UNIQUE (non-partial since V1-9b B0) via the index below
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
    // V1-22 chunk 1: the PLAN as asked, rendered to one string and frozen at log time, so a later
    // prescription edit cannot rewrite a past month's `prescribed` CSV column (ADR 0005 decision 5).
    // Deliberately NOT named `raw_prescribed`: `raw_*` on this table is what the athlete PERFORMED;
    // this is what was ASKED. The authored side already names by meaning, not prefix — compare
    // `prescriptions.target_reps` and `prescription_targets.load`, whose docblocks say "like
    // entries.raw_reps/raw_load" and still take meaning-names.
    // `''` and NULL are DISTINCT and both meaningful: `''` is the frozen rendering of a movement-only
    // prescription (11 of 13 live prescriptions render empty), NULL means "never snapshotted" and is
    // the only state that falls back to the live (day_role, movement) match. So the read predicate is
    // `IS NULL`, never `coalesce(…,'') = ''`, and the DAL fallback is `snapshot ?? live`, never `||`.
    // The movement-arm guard (`entries_prescribed_snapshot_movement_check`) is HAND-ADDED in migration
    // 0013, not declared here — the same idiom as entries_value_source_check and the superset pair,
    // which keeps the drizzle drift snapshot trivially clean.
    prescribedSnapshot: text('prescribed_snapshot'),
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
    // FAM-1 4a-ii (ADR 0007 Amendment 3): the prescription a row was logged against, and which of its
    // set rows (1-based). Set only by step 11b's row writer; NULL on every other row.
    //
    // ⚠️ Invariants the schema cannot hold, owed by the writer (11b, with a boundary test) and the
    // audits (household here; "the prescription belongs to the session's workout" at 4b, which adds
    // `prescriptions.workout_id`): the prescription is in the entry profile's household, and in the
    // workout its session names. Without the second, the row arbiter below cannot stop a twin logged
    // under another session.
    //
    // ⚠️ **"Logged in a program" is `prescription_set IS NOT NULL`, not `prescription_id`**: an
    // ADR 0008 purge's `ON DELETE SET NULL` clears the id and keeps the set, so a reader that keys on
    // the id loses that history (PREVIOUS, the export).
    prescriptionId: bigint('prescription_id', { mode: 'number' }).references(
      (): AnyPgColumn => prescriptions.id,
      { onDelete: 'set null' },
    ),
    prescriptionSet: integer('prescription_set'),
    valueText: text('value_text'), // free-text / non-numeric metric readings
    context: text('context'), // e.g. warmup/working/amrap qualifier
    scheme: text('scheme'), // e.g. set/rep scheme label
    status: text('status').notNull().default('done'), // mirrors ENTRY_STATUSES
    notes: text('notes'),
    // V1-9b B2-0: why a hidden row was hidden; NULL on every live row and on every hide that is not a
    // clear. Written by `clearDay` only, cleared by every un-hide (`UNHIDE`). Not personal data.
    hideReason: text('hide_reason'), // mirrors HIDE_REASONS (nullable)
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
    // Deterministic order WITHIN a superset — two members can't claim the same slot (V1-8), for
    // rows NOT logged against a prescription set. Since FAM-1 4a-ii (D3, A3) a row logged from a
    // template workout is one entry per ✓ set, so every set of one member shares the place: those rows
    // (`prescription_set IS NOT NULL`) are kept unique by `ENTRY_PRESCRIPTION_SET_UNIQUE_INDEX`
    // instead. The predicate is on the SET, which a purge never clears; on `prescription_id` a purge's
    // SET NULL would drop two logged sets of one member into this index together and fail.
    // ⚠️ So two DIFFERENT linked members may share a `superset_order`; nothing here stops it.
    uniqueIndex('uq_entries_superset_order')
      .on(t.supersetId, t.supersetOrder)
      .where(sql`${t.deletedAt} is null and ${t.prescriptionSet} is null`),
    // FAM-1 4a-ii: covers the prescription FK (partial: only linked rows carry one, and the SET NULL
    // lookup is an equality, which implies NOT NULL).
    index('idx_entries_prescription')
      .on(t.prescriptionId)
      .where(sql`${t.prescriptionId} is not null`),
    // The row arbiter (A3): one live entry per (session, prescription, set). A second device's ✓
    // on the same row conflicts here and returns the first; a hidden row frees its place.
    uniqueIndex(ENTRY_PRESCRIPTION_SET_UNIQUE_INDEX)
      .on(t.sessionId, t.prescriptionId, t.prescriptionSet)
      .where(sql`${t.prescriptionId} is not null and ${t.deletedAt} is null`),
    // 1-based, at most a prescription's set count (MAX_SETS_PER_MOVEMENT, pinned by db:verify).
    check(
      'entries_prescription_set_check',
      sql`${t.prescriptionSet} is null or (${t.prescriptionSet} >= 1 and ${t.prescriptionSet} <= 20)`,
    ),
    // V1-9b B2-0. Literals, as every text CHECK here (a const renders as `$1`); NULL passes `IN`.
    check(ENTRY_HIDE_REASON_CHECK, sql`${t.hideReason} in ('clear_day')`), // mirrors HIDE_REASONS
    check(
      ENTRY_HIDE_REASON_HIDDEN_CHECK,
      sql`${t.hideReason} is null or ${t.deletedAt} is not null`,
    ),
    // One-way on purpose (A3): a purge's SET NULL clears only prescription_id.
    check(
      'entries_prescription_needs_set_check',
      sql`${t.prescriptionId} is null or ${t.prescriptionSet} is not null`,
    ),
    // A linked row has a session, so the row arbiter always applies (NULLs are distinct).
    check(
      'entries_prescription_needs_session_check',
      sql`${t.prescriptionId} is null or ${t.sessionId} is not null`,
    ),
    // 🔴 **NON-partial since V1-9b B0** (ADR 0008 decision 3.4). A `client_id` is the OFFLINE
    // IDENTITY of one write, not a slot: freeing it on a hide makes a soft-deleted row stop being an
    // `ON CONFLICT` target, so a replay from a phone that never saw the hide inserts a TWIN instead
    // of being recognised as the write it already made. The asymmetry with the partial uniques
    // above is the point — those free an ordinal, a day or a position, which is exactly what a hide
    // should free. The reasoning in full, including the consequence that an id can never be reused,
    // is at `uq_profiles_client_id`, which `PROF-1` a-0 got right at birth; B0 is that precedent
    // applied to the five older arbiters. `write-path.md` invariant 6.
    uniqueIndex('uq_entries_client_id').on(t.clientId),
    // V1-24 PR 1d: ONE live weigh-in per (profile, day, slot). Scoped to bodyweight — a check-in or a
    // calisthenics bout may repeat on a day. Slot-ready for V1-32 (plan amendment, 2026-09-30).
    // - `coalesce(context, 'morning')`, not `context`: no writer sets `context` until 1e, and NULLs
    //   are distinct in a unique index, so a bare `context` key would let every NULL row escape — and
    //   a backfilled 'morning' row would never collide with a new NULL one. Coalescing makes NULL and
    //   the default slot the SAME slot, with no backfill and no deploy race.
    // - The predicate and the slot are SQL LITERALS, never `SEED_METRIC_KEYS.bodyweight` /
    //   `DEFAULT_BODYWEIGHT_CONTEXT`: drizzle-kit renders an interpolated const as `$1` in the DDL and
    //   the CREATE INDEX fails (precedent: entries_kind_check below). Tests pin both values.
    uniqueIndex(BODYWEIGHT_DAY_UNIQUE_INDEX)
      .on(t.profileId, t.activityDate, sql`coalesce(${t.context}, 'morning')`)
      .where(sql`${t.deletedAt} is null and ${t.metricKey} = 'bodyweight'`),
    // V1-24 3b-0: ONE live wrestling practice per (profile, day), so a second phone's ✓ cannot double
    // the day's minutes (`practice_minutes` aggregates by sum). No slot, so no `coalesce(context)`.
    // The metric is a SQL LITERAL for the reason above; `verify/single-values.ts` pins it against
    // `METRIC_KEYS.practice_minutes`. Live rows only, so a cleared day can be logged again.
    uniqueIndex(PRACTICE_DAY_UNIQUE_INDEX)
      .on(t.profileId, t.activityDate)
      .where(sql`${t.deletedAt} is null and ${t.metricKey} = 'practice_minutes'`),
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
    // GAP-3: every measured quantity (weight, vest, distance, duration...) moved to the typed child
    // `entry_set_quantities`. `weight_num`/`weight_label`/`seconds` were DROPPED in migration 0011 —
    // `weight_label` is the free-text load the whole of GAP-3 exists to kill, and `seconds` never had
    // a reader or a writer, so it is superseded by a ('primary','time') quantity.
    //
    // These two stay BOOLEANS on the set, deliberately (GAP-3 §7.2b): neither is a quantity. A band
    // has no number, and bodyweight is a MODE, not a load. Modelling them as rows with NULL values
    // would be the EAV smell the child table avoids. `BW+8 (vest)` is is_bodyweight=true PLUS one
    // ('vest','mass') row — the shape ADR 0004 called "not representable today".
    isBodyweight: boolean('is_bodyweight').notNull().default(false),
    isBand: boolean('is_band').notNull().default(false),
    status: text('status').notNull().default('done'),
    ...timestamps,
  },
  (t) => [
    index('idx_entry_sets_entry').on(t.entryId),
    uniqueIndex('uq_entry_sets_entry_idx')
      .on(t.entryId, t.idx)
      .where(sql`${t.deletedAt} is null`),
    // 🔴 **NON-partial since V1-9b B0** (ADR 0008 decision 3.4). A `client_id` is the OFFLINE
    // IDENTITY of one write, not a slot: freeing it on a hide makes a soft-deleted row stop being an
    // `ON CONFLICT` target, so a replay from a phone that never saw the hide inserts a TWIN instead
    // of being recognised as the write it already made. The asymmetry with the partial uniques
    // above is the point — those free an ordinal, a day or a position, which is exactly what a hide
    // should free. The reasoning in full, including the consequence that an id can never be reused,
    // is at `uq_profiles_client_id`, which `PROF-1` a-0 got right at birth; B0 is that precedent
    // applied to the five older arbiters. `write-path.md` invariant 6.
    uniqueIndex('uq_entry_sets_client_id').on(t.clientId),
    check('entry_sets_status_check', sql`${t.status} in ('done', 'skipped', 'sub_failure')`),
  ],
);

/**
 * GAP-3 — every measured quantity of a logged SET, typed and unit-guarded.
 *
 * Replaces the free-text `entry_sets.weight_label` the census found encoding three different physical
 * quantities. One row per (set, role): a back squat writes one `('primary','mass')`; a sled push
 * writes `('primary','mass')` + `('distance','length')`; a vested push-up writes `('vest','mass')`
 * alongside `entry_sets.is_bodyweight`.
 *
 * **NOT EAV.** EAV is a key/value table whose value is untyped text with no constraint on valid keys.
 * Here the value is `numeric`, the unit is FK'd, and the key comes from a reference table.
 *
 * **The unit guard — the reason this design was chosen over fixed columns.** `dimension` is stored on
 * the row and is the SHARED column of two composite FKs: the slot pins which dimensions it accepts,
 * and the unit must agree with the one stored. So `('primary','mass','in')` fails the units FK and
 * `('distance','mass','lb')` fails the slot FK — there is no third spelling that gets a mass unit
 * into a length quantity. A CHECK cannot read another table; this is what replaces the convention.
 *
 * **`client_id`, no `public_id`** (AGENTS.md; the `entry_sets` idiom, NOT the config-table one): a
 * quantity is client-written log data in the offline replay graph. ⚠️ **This sentence was inverted
 * by V1-9b B0 and is corrected here:** it used to read "the partial UNIQUE below does NOT dedupe a
 * replay that straddles a soft-delete", which was true of a partial index — such a replay twinned.
 * The index is non-partial now, so it DOES collide across a soft-delete, and this insert carries no
 * `ON CONFLICT` at all. That would be a raw `23505` were it reachable; it is not, because every
 * quantity's `client_id` is server-minted per insert (`newId()`) and these rows are written only
 * when the parent entry was freshly created. Nothing addresses a quantity directly — a set's
 * `public_id` plus its slot is the address — so there is no `public_id`.
 *
 * ⚠️ `ON DELETE CASCADE` is hard-delete only, and the app only ever SOFT-deletes. Every reader must
 * join through a live `entry_sets` (`deleted_at IS NULL`) or it will count quantities whose set is
 * gone.
 */
export const entrySetQuantities = pgTable(
  'entry_set_quantities',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    clientId: uuid('client_id').notNull(), // offline idempotency; UNIQUE (non-partial since V1-9b B0) via the index below
    entrySetId: bigint('entry_set_id', { mode: 'number' })
      .notNull()
      .references(() => entrySets.id, { onDelete: 'cascade' }),
    slot: text('slot').notNull(), // mirrors QUANTITY_SLOT_CODES; FK'd as a PAIR with dimension
    dimension: text('dimension').notNull(), // denormalized on purpose — see the composite FKs below
    unit: text('unit').notNull(),
    valueNum: numeric('value_num', { precision: 8, scale: 3 }).notNull(),
    ...timestamps,
  },
  (t) => [
    // The pair guard. Both parents' target columns are PKs and all three child columns are NOT NULL,
    // so MATCH SIMPLE never short-circuits and neither FK can be satisfied vacuously.
    foreignKey({
      name: 'entry_set_quantities_slot_dimension_fkey',
      columns: [t.slot, t.dimension],
      foreignColumns: [quantitySlots.code, quantitySlots.dimension],
    }),
    foreignKey({
      name: 'entry_set_quantities_unit_dimension_fkey',
      columns: [t.unit, t.dimension],
      foreignColumns: [units.code, units.dimension],
    }),
    index('idx_entry_set_quantities_set').on(t.entrySetId), // covering index for the parent FK
    index('idx_entry_set_quantities_slot').on(t.slot, t.dimension), // covers the composite FK
    index('idx_entry_set_quantities_unit').on(t.unit, t.dimension), // covers the composite FK
    // The arity rule: nothing can write fourteen vest rows. PARTIAL, so an edit can soft-delete a
    // quantity and write a replacement — which means an upsert arbiter MUST repeat this predicate
    // (`onConflictDoUpdate({ targetWhere: isNull(deletedAt) })`) or Postgres rejects it outright.
    uniqueIndex('uq_entry_set_quantities_set_slot')
      .on(t.entrySetId, t.slot)
      .where(sql`${t.deletedAt} is null`),
    // 🔴 **NON-partial since V1-9b B0** (ADR 0008 decision 3.4). A `client_id` is the OFFLINE
    // IDENTITY of one write, not a slot: freeing it on a hide makes a soft-deleted row stop being an
    // `ON CONFLICT` target, so a replay from a phone that never saw the hide inserts a TWIN instead
    // of being recognised as the write it already made. The asymmetry with the partial uniques
    // above is the point — those free an ordinal, a day or a position, which is exactly what a hide
    // should free. The reasoning in full, including the consequence that an id can never be reused,
    // is at `uq_profiles_client_id`, which `PROF-1` a-0 got right at birth; B0 is that precedent
    // applied to the five older arbiters. `write-path.md` invariant 6.
    uniqueIndex('uq_entry_set_quantities_client_id').on(t.clientId),
    // `weight_num` never had this (enforced only in parseLoad); the typed column gets it in the DB.
    check('entry_set_quantities_value_num_check', sql`${t.valueNum} >= 0`),
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
 * The two partial unique indexes that carry `movements`' two-namespace invariant (TEN-2a, migration
 * 0015), named once here so `verify.ts` and TEN-2b's conflict targets import rather than re-type them
 * — the `BODYWEIGHT_DAY_UNIQUE_INDEX` precedent. Renaming one means a new migration too.
 *
 * ⚠️ **Names are consts; the PREDICATES stay SQL literals below.** A name is a string matched at
 * runtime (an `ON CONFLICT` target, an `expectRejectedBy` assertion, `pg_indexes`), so a typo is a
 * silent miss that a const turns into a compile error. Hoisting a predicate into a const would hide
 * the invariant one indirection away from the index that states it, and still not stop a drifting
 * copy in a migration nobody may edit.
 *
 * 🔴 **TEN-2b corrected the reason this docblock used to give.** It said *"a predicate is not matched
 * by anything: it is read by the planner from the catalog"* — **false** as of TEN-2b. An
 * `ON CONFLICT … WHERE <predicate>` arbiter must **imply** the partial index's predicate, or Postgres
 * cannot infer the index at all and the statement fails `42P10`. So the predicates below ARE matched,
 * by two arbiters (`writers/ownership.ts` → `insertMovementOwnedBy`, and `seed.ts`'s movements
 * upsert), which build them from drizzle's `isNull` / `isNotNull` and render byte-identically to the
 * literals here (measured). What keeps the two in sync is not a shared const but a **proof**:
 * `db:verify` exercises both arbiters, and a mismatch is a `42P10`, i.e. a red build.
 */
export const MOVEMENT_SLUG_GLOBAL_UNIQUE_INDEX = 'uq_movements_slug_global';
export const MOVEMENT_HOUSEHOLD_SLUG_UNIQUE_INDEX = 'uq_movements_household_slug';

/**
 * The CHECK that keeps the GLOBAL namespace reference data (TEN-2c, migration 0017) — named here for
 * the same reason as the two index names above: `db:verify` matches it by string.
 *
 * **Predicate-descriptive on purpose, like `movements_pattern_check` and
 * `profiles_household_id_not_null`.** An earlier draft called it `movements_owned_or_seeded`, which
 * names an intent the predicate does not test — a global row with a hand-typed `pattern` satisfies it
 * while being neither owned nor seeded. A name stating the intent is how a later reader concludes the
 * database enforces seededness and deletes `db:verify`'s exact set-membership proof as redundant. The
 * intent, and that gap, live in 0017's header and in `docs/plans/ten-2c-drop-global-slug-unique.md`.
 *
 * ⚠️ **Shipped `NOT VALID`; the `VALIDATE` is `TEN-2d`.** drizzle's `check()` emits a VALIDATED
 * constraint, so the `NOT VALID` is a **hand-edit of 0017** — the same hand-edit class as 0015's FK.
 * `db:verify` captures `convalidated` **immediately after `migrate()`** because nothing else catches
 * the hand-edit being lost on a rebase, and because `verify.ts` itself drops and re-adds this
 * constraint around the V1-1b backfill simulation (a later read would measure that re-add).
 *
 * 🔴 **`MOVEMENT_SLUG_UNIQUE_CONSTRAINT` used to live here and TEN-2c DELETED it**, as the const's own
 * docblock promised it would. Migration `0017` drops the constraint, so a const in the module that
 * DECLARES the live schema would now name something the schema does not have. The one surviving
 * matcher is `movement-catalog.ts`'s deploy-race `catch` (`TEN-2d` deletes it), which carries the
 * historical literal module-privately and says why.
 */
export const MOVEMENT_GLOBAL_ROW_HAS_PATTERN_CHECK = 'movements_global_row_has_pattern';

/**
 * movement — the exercise catalog (spec.md §4): slug/name + optional movement pattern,
 * default unit, bodyweight flag, and coaching media. `pattern` is a text+CHECK enum.
 *
 * ── TEN-2a: `household_id`, and the two namespaces ───────────────────────────────────────────────
 *
 * **`household_id IS NULL` is a VALUE, not missing data.** It means _reference data owned by no
 * household_ — the curated `MOVEMENT_SEED_ROWS`, each with a `pattern`, a `unit_default` and an
 * `is_bodyweight` a human chose. A non-NULL `household_id` means _this household typed this name_.
 * Two kinds of row in one table, and NULL is the honest encoding of the first — which is why the
 * column is **nullable FOREVER**: TEN-2c did NOT contract it to `NOT NULL` (that would assert some
 * household owns `Box Jump`, and inventing a sentinel household to satisfy the constraint would put
 * a fiction in the table every scoped query then has to exclude). What 2c contracted to instead is
 * `movements_global_row_has_pattern` — `CHECK (household_id IS NOT NULL OR pattern IS NOT NULL)`,
 * `NOT VALID`, at the foot of this table.
 *
 * The resolution rule the two namespaces depend on is **GLOBAL-FIRST**, and it is TEN-2b's to
 * implement: resolve `slug` against `household_id IS NULL` first, and only then `(scope, slug)`.
 * Reasoning (nothing in the app can author movement metadata, so a household row would always be
 * strictly worse than the seeded row it shadowed), the seed-growth hazard and the TEN-2b→2c window:
 * `docs/plans/ten-2a-household-movements.md`. This table states what the indexes MEAN; it does not
 * design 2b.
 *
 * ⚠️ **`ON DELETE NO ACTION` IS LOAD-BEARING — never `SET NULL`.** `SET NULL` would silently promote
 * every row of a deleted household into the **global reference namespace**, where global-first then
 * serves it to every other household. The correct response to a household delete blocked by this FK
 * is to **DELETE the rows** (`docs/runbooks.md` → the PRIV-1 procedure, step 11), never to null the
 * column.
 *
 * 🔴 **Cross-household references are WRITER-enforced, not schema-enforced.** Nothing here stops an
 * `entries.movement_id` of household H pointing at a movement owned by ¬H. TEN-2a said global-first
 * *"prevents it by construction"*; that was **wrong**, and TEN-2b measured it — while the non-partial
 * `movements_slug_unique` lived, two households could not both hold a row for one slug, so
 * `findOrCreateMovement`'s `23505` fallback handed the second household the first's row and the entry
 * it then wrote was exactly this reference.
 *
 * ✅ **TEN-2c removed the writer that produced them.** With the constraint dropped, step 3 inserts
 * into the asking household's own namespace and the fallback is unreachable, so no NEW cross-household
 * reference can be minted. The `catch` survives one more PR for the deploy race (`movement-catalog.ts`;
 * `TEN-2d` deletes it). **Pre-TEN-2c references are data, not a code path:** `runbooks.md` step 3
 * pre-flights them and step 11 carries the repair, because the symptom is a mid-transaction abort of
 * the household deletion (`23503` on step 11). `db:verify` asserts the count is zero and that step 11
 * now succeeds.
 *
 * ⚠️ **NO plain `idx_movements_household`, and this is the FIRST break in an 11-for-11 idiom in this
 * file** — so do not "fix" it. `uq_movements_household_slug` leads on `household_id` and its
 * predicate is **implied** by any `household_id = $1` lookup, so it already serves the FK's
 * referential check and every household-scoped read. `idx_program_blocks_household` exists only
 * because its partial sibling's predicate is `WHERE deleted_at IS NULL`, which `household_id = $1`
 * does **not** imply. (A planner claim, stated as reasoning: on a 35-row table PGlite seq-scans, so
 * `db:verify` cannot exercise it.)
 *
 * ⚠️ **Neither index carries `deleted_at IS NULL`**, diverging from every other natural key here, and
 * for a reason: `findOrCreateMovement`'s `SELECT … WHERE slug = $1 LIMIT 1` has **no `deleted_at`
 * filter and no `ORDER BY`**, so a tombstone-ignoring natural key would let a live row and a tombstone
 * share a slug and let the resolver hand back the tombstone. The repo's partial-on-`deleted_at` idiom
 * is for tables whose WRITERS filter tombstones; this one does not.
 * **Hard constraint until that changes: nothing may set `movements.deleted_at`.** The PR that first
 * soft-deletes a movement must do **three** things in one change — add `deleted_at IS NULL` to both
 * indexes, add a `deleted_at` filter to the resolver, **and** add the plain `idx_movements_household`,
 * because the moment the predicate becomes `… AND deleted_at IS NULL` it stops being implied by
 * `household_id = $1` and the FK loses its index.
 */
export const movements = pgTable(
  'movements',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    publicId: uuid('public_id').notNull().unique(),
    // TEN-2c: NO `.unique()`. The non-partial `UNIQUE (slug)` drizzle generated from it
    // (`movements_slug_unique`) is DROPPED by migration 0017 — it dominated both partial indexes
    // below, so while it lived at most one row per slug existed table-wide and the two namespaces
    // were declared but not in effect. The arbiters are the two `uniqueIndex`es at the foot of this
    // table now, and nothing else.
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    // TEN-2a: nullable FOREVER (NULL = reference data owned by no household — see the docblock).
    // Mirrors `profiles.householdId`'s shape, and NO ACTION is load-bearing, not mimicry.
    householdId: bigint('household_id', { mode: 'number' }).references(() => households.id),
    pattern: text('pattern'), // mirrors MOVEMENT_PATTERNS (nullable)
    unitDefault: text('unit_default').references(() => units.code),
    isBodyweight: boolean('is_bodyweight').notNull().default(false),
    // FAM-1 step 3 (plan D1, D25): how the item is logged; mirrors shared TRACKING_TYPES (pinned by
    // db:verify). Set ONCE: built-ins by migration 0022's typing, a new item when it is made
    // (`findOrCreateTypedMovement`). Nothing retypes a row. The default is what an item made in the old
    // strength form gets.
    trackingType: text('tracking_type').notNull().default(DEFAULT_TRACKING_TYPE),
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
    check(
      'movements_tracking_type_check',
      sql`${t.trackingType} in ('check', 'count', 'reps', 'weight_reps', 'duration', 'time_sets', 'distance')`,
    ),
    // TEN-2c: a GLOBAL row must carry a `pattern` — i.e. it must be the kind of row only a human
    // curating `MOVEMENT_SEED_ROWS` can author, because `findOrCreateMovement` writes neither
    // `pattern` nor `unit_default` and never can. It blocks the realistic way into the forbidden
    // state: an operator hand-running `UPDATE movements SET household_id = NULL` to unwedge a
    // household delete the FK aborted. Shipped `NOT VALID` (0017, hand-edited); the `VALIDATE` is
    // `TEN-2d`. Layer 2 of the same invariant — exact set membership in `MOVEMENT_SEED_PUBLIC_IDS` —
    // lives in `db:verify`, because `db:verify` never runs against production and this does.
    check(
      MOVEMENT_GLOBAL_ROW_HAS_PATTERN_CHECK,
      sql`${t.householdId} is not null or ${t.pattern} is not null`,
    ),
    // The global reference namespace: one row per slug among rows owned by no household. Declared at
    // TEN-2a, in effect from TEN-2c: until 0017 dropped the non-partial `movements_slug_unique`, the
    // broader constraint already forbade everything this narrower one does.
    uniqueIndex(MOVEMENT_SLUG_GLOBAL_UNIQUE_INDEX)
      .on(t.slug)
      .where(sql`${t.householdId} is null`),
    // Each household's own namespace — AND the covering index for the household FK above.
    uniqueIndex(MOVEMENT_HOUSEHOLD_SLUG_UNIQUE_INDEX)
      .on(t.householdId, t.slug)
      .where(sql`${t.householdId} is not null`),
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
    clientId: uuid('client_id').notNull(), // offline idempotency; UNIQUE (non-partial since V1-9b B0) via the index below
    profileId: bigint('profile_id', { mode: 'number' })
      .notNull()
      .references(() => profiles.id),
    activityDate: date('activity_date').notNull(), // declared date (not device clock)
    loggedAt: timestamp('logged_at', { withTimezone: true }), // device clock, informational
    sessionType: text('session_type'), // mirrors SESSION_TYPES (nullable); 'workout' since FAM-1 step 3 (D6)
    // GAP-1 P0-1: WHICH PROGRAMMED DAY this session was (mirrors shared DAY_ROLES). Distinct from
    // `session_type` on purpose — session_type is what a session IS, day_role is which program day it
    // fulfilled — and DAY_ROLES is a superset of LEGACY_SESSION_TYPES carrying strength_a/b/c, which
    // session_type cannot express (and session_type's 'workout', FAM-1 step 3, is no day role).
    //
    // PROVENANCE IS THE POINT: a non-null value means A HUMAN ASSERTED IT (the log form's day-role
    // select). It is deliberately NOT derived from the weekday at write time: `DAY_ROLE_BY_WEEKDAY` is a
    // documented stopgap, and a derivation persisted here would be frozen into rows forever, whereas one
    // applied at EXPORT time re-corrects every historical row when the map is replaced.
    //
    // INVARIANT (writer/action-enforced, not schema): DAY_ROLE_TO_SESSION_TYPE[day_role] === session_type.
    // Deliberately NOT a DB CHECK — folding role↔type pairs into the CHECK below would inject extra
    // literals and break db:verify's exact-set assertCheckCoversConst assertion.
    dayRole: text('day_role'),
    // FAM-1 4a-ii (ADR 0007 A2 §6): the template workout this session logged. IDENTITY only, for
    // MOT-1's swap and verdict; nothing displays through it. `ON DELETE SET NULL`, so a purged
    // workout leaves the session. It must name a workout in the session profile's household (writer,
    // plus the audit db:verify proves and the runbook's pre-flight (f) runs on real rows). A
    // template session's `day_role` stays NULL (A2 §6; audited, not a CHECK).
    workoutId: bigint('workout_id', { mode: 'number' }).references((): AnyPgColumn => workouts.id, {
      onDelete: 'set null',
    }),
    // The workout's name FROZEN at log time: the display, so a rename never rewrites history. It
    // outlives the workout's rename, hide and purge (the pairing CHECK is one-way). Bounded by
    // WORKOUT_NAME_MAX like its source.
    workoutName: text('workout_name'),
    status: text('status').notNull().default('done'), // mirrors SESSION_STATUSES
    source: text('source'),
    feel: text('feel'), // session-grain feel/soreness (spec.md §4)
    ...timestamps,
  },
  (t) => [
    index('idx_sessions_profile_date').on(t.profileId, t.activityDate), // covers the profile FK + hot path
    // 🔴 **NON-partial since V1-9b B0** (ADR 0008 decision 3.4). A `client_id` is the OFFLINE
    // IDENTITY of one write, not a slot: freeing it on a hide makes a soft-deleted row stop being an
    // `ON CONFLICT` target, so a replay from a phone that never saw the hide inserts a TWIN instead
    // of being recognised as the write it already made. The asymmetry with the partial uniques
    // above is the point — those free an ordinal, a day or a position, which is exactly what a hide
    // should free. The reasoning in full, including the consequence that an id can never be reused,
    // is at `uq_profiles_client_id`, which `PROF-1` a-0 got right at birth; B0 is that precedent
    // applied to the five older arbiters. `write-path.md` invariant 6.
    uniqueIndex('uq_sessions_client_id').on(t.clientId),
    index('idx_sessions_workout').on(t.workoutId), // covering index for the workout FK (FAM-1 4a-ii)
    // The append arbiter (A2 §6): one live session per (profile, day, workout), so step 11b appends
    // later sets to the workout's session that day instead of twinning it. A hidden session frees
    // its place: ⚠️ a session hide must hide its entries too, or the old session's live rows twin
    // against the new one's (no session hide exists today).
    uniqueIndex(SESSION_WORKOUT_DAY_UNIQUE_INDEX)
      .on(t.profileId, t.activityDate, t.workoutId)
      .where(sql`${t.workoutId} is not null and ${t.deletedAt} is null`),
    check(
      'sessions_workout_name_length_check',
      sql`${t.workoutName} is null or (char_length(btrim(${t.workoutName})) >= 1 and char_length(${t.workoutName}) <= 30)`,
    ),
    // One-way (a purge's SET NULL clears the id, keeps the name), like 4a-i's copy provenance.
    check(
      'sessions_workout_named_check',
      sql`${t.workoutId} is null or ${t.workoutName} is not null`,
    ),
    check(
      'sessions_session_type_check',
      sql`${t.sessionType} in ('strength', 'conditioning', 'skill', 'push', 'pull', 'legs', 'core', 'workout')`,
    ),
    check('sessions_status_check', sql`${t.status} in ('done', 'skipped', 'sub_failure')`),
    // Inlines the shared DAY_ROLES literals (a CHECK can't import a const); db:verify pins the accepted
    // set to DAY_ROLES via assertCheckCoversConst. NULL passes (`NULL in (...)` is NULL, and a CHECK
    // fails only on FALSE) — the same mechanism that makes session_type nullable today.
    check(
      'sessions_day_role_check',
      sql`${t.dayRole} in ('strength', 'conditioning', 'skill', 'push', 'pull', 'legs', 'core', 'strength_a', 'strength_b', 'strength_c')`,
    ),
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
    // No natural key (label is free text) → client_id + UNIQUE is the idempotency arbiter for the
    // offline replay graph — the sessions/entries idiom (NOT ramp_targets, which has none).
    // Non-partial since V1-9b B0; see this table's index below.
    clientId: uuid('client_id').notNull(),
    sessionId: bigint('session_id', { mode: 'number' })
      .notNull()
      .references(() => sessions.id),
    label: text('label'), // "DB Bench + Overhead Press" / "light superset"
    note: text('note'),
    // FAM-1 4a-ii (A2 §6): the prescription's group (`superset_label`, step 4b) this superset was
    // logged under, so a workout's later sets append to the same superset. NULL on legacy rows.
    prescriptionGroup: text('prescription_group'),
    ...timestamps,
  },
  (t) => [
    index('idx_supersets_session').on(t.sessionId), // covering index for the session FK
    // 🔴 **NON-partial since V1-9b B0** (ADR 0008 decision 3.4). A `client_id` is the OFFLINE
    // IDENTITY of one write, not a slot: freeing it on a hide makes a soft-deleted row stop being an
    // `ON CONFLICT` target, so a replay from a phone that never saw the hide inserts a TWIN instead
    // of being recognised as the write it already made. The asymmetry with the partial uniques
    // above is the point — those free an ordinal, a day or a position, which is exactly what a hide
    // should free. The reasoning in full, including the consequence that an id can never be reused,
    // is at `uq_profiles_client_id`, which `PROF-1` a-0 got right at birth; B0 is that precedent
    // applied to the five older arbiters. `write-path.md` invariant 6.
    uniqueIndex('uq_supersets_client_id').on(t.clientId),
    // The append arbiter for a workout's superset (A2 §6): one live superset per (session, group).
    uniqueIndex(SUPERSET_PRESCRIPTION_GROUP_UNIQUE_INDEX)
      .on(t.sessionId, t.prescriptionGroup)
      .where(sql`${t.prescriptionGroup} is not null and ${t.deletedAt} is null`),
    // Bounded like the group label it copies (SLOT_LABEL_MAX, pinned by db:verify); never blank.
    check(
      'supersets_prescription_group_length_check',
      sql`${t.prescriptionGroup} is null or (char_length(btrim(${t.prescriptionGroup})) >= 1 and char_length(${t.prescriptionGroup}) <= 30)`,
    ),
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
    // FAM-1 4a-i (ADR 0007 A2 §1): mirrors shared PROGRAM_BLOCK_KINDS (pinned by db:verify). `legacy`
    // is today's day_role block, the default, which the seed's insert omits; `template` is a block a
    // household builds, set EXPLICITLY by `insertProgramBlockOwnedBy`, never by default.
    kind: text('kind').notNull().default(PROGRAM_BLOCK_KIND.legacy),
    // FAM-1 4a-i (A2 §5): a template block's offline identity. NULL on the seeded/legacy blocks, which
    // a server-side creator (the seed) writes with no client. Scoped to the household, never global.
    clientId: uuid('client_id'),
    ...timestamps,
  },
  (t) => [
    index('idx_program_blocks_household').on(t.householdId), // covering index for the household FK
    uniqueIndex(PROGRAM_BLOCK_SLUG_UNIQUE_INDEX)
      .on(t.householdId, t.slug)
      .where(sql`${t.deletedAt} is null`),
    check('program_blocks_kind_check', sql`${t.kind} in ('legacy', 'template')`),
    // A template block is always built by a device, so it always carries the id a replay matches on.
    check(
      'program_blocks_template_client_id_check',
      sql`${t.kind} <> 'template' or ${t.clientId} is not null`,
    ),
    // NON-partial (ADR 0008 3.4): a hidden block still owns its client_id, so a replay from a device
    // that never saw the hide is recognised instead of twinned. Household-scoped, so one household
    // cannot probe another's ids (A2 §2).
    uniqueIndex('uq_program_blocks_household_client_id').on(t.householdId, t.clientId),
  ],
);

/**
 * workout — one named workout in a TEMPLATE block (FAM-1 4a-i; ADR 0007 Amendment 2 §2). Only
 * template blocks own workouts (`insertWorkoutOwnedBy` refuses any other; `db:verify` proves its audit
 * query finds a planted violation).
 * Its items are prescriptions with `workout_id` set (step 4b); the week places it on weekdays
 * (`block_day_workouts`).
 *
 * - `client_id`: NOT NULL, unique within its block, non-partial: a workout has no natural key, and a
 *   hidden workout keeps its id so a replayed save is recognised (ADR 0008 3.4).
 * - Copy provenance (step 10b): `copied_from_workout_id` is identity, `ON DELETE SET NULL`, and must
 *   name a workout in the SAME household (writer; the runbook's pre-flight (e) checks real rows, and
 *   `db:verify` proves that query). `copied_from_program_name`
 *   is the source program's name FROZEN at copy time, so a rename or purge of the source never
 *   changes "Copied from …". The id never outlives the name (the CHECK below); the name may outlive
 *   the id, which is what a purge leaves.
 * - Text bounds are CHECKs pinned to the shared consts by `db:verify` (maintainer, 2026-11-16):
 *   `WORKOUT_NAME_MAX`, `FREE_TEXT_NOTE_MAX`, `PROGRAM_NAME_MAX`. Blank-after-trim is refused too,
 *   because the read schemas refuse it.
 */
export const workouts = pgTable(
  'workouts',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    publicId: uuid('public_id').notNull().unique(), // UUIDv7, app-generated (anti-IDOR)
    clientId: uuid('client_id').notNull(),
    blockId: bigint('block_id', { mode: 'number' })
      .notNull()
      .references(() => programBlocks.id),
    name: text('name').notNull(),
    description: text('description'),
    copiedFromWorkoutId: bigint('copied_from_workout_id', { mode: 'number' }).references(
      (): AnyPgColumn => workouts.id,
      { onDelete: 'set null' },
    ),
    copiedFromProgramName: text('copied_from_program_name'),
    ...timestamps,
  },
  (t) => [
    // The composite-FK target for the week (and prescriptions, step 4b). A CONSTRAINT, not a unique
    // index: the FK is created first, and Postgres needs the key to exist (docs/lessons.md, 0011).
    unique('workouts_id_block_id_unique').on(t.id, t.blockId),
    // Also the covering index for the block FK (leading column).
    uniqueIndex('uq_workouts_block_client_id').on(t.blockId, t.clientId),
    index('idx_workouts_copied_from_workout').on(t.copiedFromWorkoutId), // covers the self-FK
    check(
      'workouts_name_length_check',
      sql`char_length(btrim(${t.name})) >= 1 and char_length(${t.name}) <= 30`,
    ),
    check(
      'workouts_description_length_check',
      sql`${t.description} is null or (char_length(btrim(${t.description})) >= 1 and char_length(${t.description}) <= 500)`,
    ),
    check(
      'workouts_copied_from_program_name_length_check',
      sql`${t.copiedFromProgramName} is null or (char_length(btrim(${t.copiedFromProgramName})) >= 1 and char_length(${t.copiedFromProgramName}) <= 60)`,
    ),
    check(
      'workouts_copied_from_pairing_check',
      sql`${t.copiedFromWorkoutId} is null or ${t.copiedFromProgramName} is not null`,
    ),
  ],
);

/**
 * block_day_workouts — the week template: which workouts a TEMPLATE block runs on each weekday, in
 * order (FAM-1 4a-i; ADR 0007 Amendment 2 §3). A rest day has no rows.
 *
 * - `weekday`: 0 = Sunday … 6, pinned to shared `WEEKDAYS` by `assertCheckCoversIntConst`.
 * - The slot key `(block_id, weekday, idx)` is PARTIAL on live rows, so removing a slot frees its
 *   place; a workout runs at most once a day (`(block_id, weekday, workout_id)`, also partial).
 * - `(workout_id, block_id)` is a composite FK to `workouts(id, block_id)`, so one block's week can
 *   never name another block's workout.
 * - No `public_id` or `client_id`: a week is saved whole (`saveWeek`), and its rows are never
 *   addressed from outside the server.
 * - `label` is bounded by `SLOT_LABEL_MAX` (pinned by `db:verify`).
 */
export const blockDayWorkouts = pgTable(
  'block_day_workouts',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    blockId: bigint('block_id', { mode: 'number' })
      .notNull()
      .references(() => programBlocks.id),
    weekday: integer('weekday').notNull(),
    idx: integer('idx').notNull(),
    workoutId: bigint('workout_id', { mode: 'number' }).notNull(),
    label: text('label'),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: 'block_day_workouts_workout_block_fkey',
      columns: [t.workoutId, t.blockId],
      foreignColumns: [workouts.id, workouts.blockId],
    }),
    // NON-partial, so it covers hidden rows too. ONE index serves both FKs: the block FK by its
    // leading column, and the composite FK, whose lookups are equality on both columns.
    index('idx_block_day_workouts_block_workout').on(t.blockId, t.workoutId),
    uniqueIndex('uq_block_day_workouts_slot')
      .on(t.blockId, t.weekday, t.idx)
      .where(sql`${t.deletedAt} is null`),
    uniqueIndex('uq_block_day_workouts_once_per_day')
      .on(t.blockId, t.weekday, t.workoutId)
      .where(sql`${t.deletedAt} is null`),
    check('block_day_workouts_weekday_check', sql`${t.weekday} in (0, 1, 2, 3, 4, 5, 6)`),
    check('block_day_workouts_idx_check', sql`${t.idx} >= 0`),
    check(
      'block_day_workouts_label_length_check',
      sql`${t.label} is null or (char_length(btrim(${t.label})) >= 1 and char_length(${t.label}) <= 30)`,
    ),
  ],
);

/**
 * prescription — one movement in a block's day (V1-10; spec.md §4). `day_role` (text+CHECK ∈ shared
 * DAY_ROLES — its OWN vocabulary, a superset of LEGACY_SESSION_TYPES incl. strength_a/strength_b) + `idx` order it
 * within the day; `sets`/`target_reps` are the prescription shared across kids (per-kid loads live in
 * `prescription_targets`). Config → no client_id; natural key `(block_id, day_role, idx)` is a SLOT arbiter
 * (a movement may legitimately appear twice in a day — warm-up + working — so the key is NOT movement_id),
 * which means a re-seed is INSERT-ONLY (onConflictDoNothing never reorders/replaces a slot — the ramp_targets
 * precedent; block edits are a future authoring path, not re-seed). `target_reps` is TEXT (lossless "8-12"/
 * "AMRAP", like entries.raw_reps).
 *
 * **FAM-1 4b (ADR 0007 A2 §4, Amendment 3; plan D2, D14, D19): a row is LEGACY or TEMPLATE, never both.**
 * A legacy row names a `day_role` on the seeded block; a template row names a `workout_id` (and,
 * through the composite FK, the workout's own block), always has a `client_id` (the editor's card
 * identity, D19: a save matches rows by it, so a reorder never detaches a logged row and a replay adds
 * nothing), and may carry the author's `notes`, a superset place (`superset_label` + `superset_order`)
 * and, on a group's last item, `rest_after`. The "config → no client_id" sentence above holds for
 * legacy rows only.
 *
 * 🔴 **The XOR cannot see the block's kind**: a row with a `day_role` on a TEMPLATE block is legal
 * here, and only the writer (6a) refuses it; `db:verify` flags it
 * (`prescriptionsWithoutAWorkoutOnTemplateBlocks`).
 *
 * ⚠️ **The template-only bounds are scoped `workout_id is null or …` on purpose.** Production still
 * holds an archived block whose `target_reps` run to 32 characters (the seed is insert-only, and the
 * block #151 replaced was never deleted), so an all-rows CHECK would fail its validating scan. A legacy
 * row is bounded by nothing new.
 *
 * Nothing writes a template row until step 6a's save-workout writer; the stay-dark test pins that.
 */
export const prescriptions = pgTable(
  'prescriptions',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    publicId: uuid('public_id').notNull().unique(),
    blockId: bigint('block_id', { mode: 'number' })
      .notNull()
      .references(() => programBlocks.id),
    // mirrors shared DAY_ROLES (pinned by db:verify). NULL on a template row since FAM-1 4b (the XOR).
    dayRole: text('day_role'),
    movementId: bigint('movement_id', { mode: 'number' })
      .notNull()
      .references(() => movements.id),
    idx: integer('idx').notNull(), // 0-based order within the day (matches entry_sets.idx idiom)
    sets: integer('sets'), // prescribed set count (nullable — a movement-only prescription)
    targetReps: text('target_reps'), // verbatim/lossless: "3", "8-12", "AMRAP"
    // FAM-1 4b. The workout this row belongs to; NULL on every legacy row. FK'd with `block_id` as a
    // PAIR, so the block is the workout's own (MATCH SIMPLE skips legacy rows).
    workoutId: bigint('workout_id', { mode: 'number' }),
    // FAM-1 4b (A3, D19): the editor's card identity, device-minted per item. Set exactly on template
    // rows (the two-way CHECK below). Returned to the household's own devices from 6a; never exported.
    clientId: uuid('client_id'),
    notes: text('notes'), // the author's instructions for this item (FREE_TEXT_NOTE_MAX); free text
    restAfter: text('rest_after'), // a superset group's rest, on its LAST item only (D14; writer)
    supersetLabel: text('superset_label'), // the group key 11b copies to supersets.prescription_group
    supersetOrder: integer('superset_order'), // 1-based place in the group (12a orders by it, then idx)
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
      sql`${t.dayRole} in ('strength', 'conditioning', 'skill', 'push', 'pull', 'legs', 'core', 'strength_a', 'strength_b', 'strength_c')`,
    ),
    check('prescriptions_idx_check', sql`${t.idx} >= 0`),
    check('prescriptions_sets_check', sql`${t.sets} is null or ${t.sets} > 0`),
    // ── FAM-1 4b ──
    foreignKey({
      name: 'prescriptions_workout_block_fkey',
      columns: [t.workoutId, t.blockId],
      foreignColumns: [workouts.id, workouts.blockId],
    }),
    // NON-partial (ADR 0008 3.4): a hidden holder keeps its id, so a replay never twins it. Leading on
    // `workout_id`, it is also the covering index for the composite FK, hidden rows included (0023's
    // `uq_workouts_block_client_id` does the same for the block FK), so there is no separate one.
    uniqueIndex(PRESCRIPTION_WORKOUT_CLIENT_ID_UNIQUE_INDEX).on(t.workoutId, t.clientId),
    // The template slot key. The legacy key above never fires on a template row (NULL day_role).
    // ⚠️ Partial on TWO conjuncts: an upsert that targets it must repeat both (`targetWhere` for
    // DoUpdate, `where` for DoNothing), or Postgres cannot infer it (docs/lessons.md, 42P10).
    uniqueIndex(PRESCRIPTION_WORKOUT_SLOT_UNIQUE_INDEX)
      .on(t.workoutId, t.idx)
      .where(sql`${t.workoutId} is not null and ${t.deletedAt} is null`),
    check(
      'prescriptions_day_role_xor_workout_check',
      sql`num_nonnulls(${t.dayRole}, ${t.workoutId}) = 1`,
    ),
    // Two-way: neither column is ever SET NULL, so a purge cannot break it.
    check(
      'prescriptions_template_client_id_check',
      sql`(${t.workoutId} is null) = (${t.clientId} is null)`,
    ),
    // The template-only bounds (see the docblock for why they are scoped).
    check(
      'prescriptions_target_reps_length_check',
      sql`${t.workoutId} is null or ${t.targetReps} is null or (char_length(btrim(${t.targetReps})) >= 1 and char_length(${t.targetReps}) <= 20)`,
    ),
    check(
      'prescriptions_sets_max_check',
      sql`${t.workoutId} is null or ${t.sets} is null or ${t.sets} <= 20`,
    ),
    // New columns: NULL on every legacy row, so these bound every row.
    check(
      'prescriptions_notes_length_check',
      sql`${t.notes} is null or (char_length(btrim(${t.notes})) >= 1 and char_length(${t.notes}) <= 500)`,
    ),
    check(
      'prescriptions_rest_after_length_check',
      sql`${t.restAfter} is null or (char_length(btrim(${t.restAfter})) >= 1 and char_length(${t.restAfter}) <= 30)`,
    ),
    // 🔴 EXACTLY `supersets_prescription_group_length_check`'s form: 11b copies this label there, so a
    // looser bound here would fail the ✓ with 23514. db:verify compares the two definitions.
    check(
      'prescriptions_superset_label_length_check',
      sql`${t.supersetLabel} is null or (char_length(btrim(${t.supersetLabel})) >= 1 and char_length(${t.supersetLabel}) <= 30)`,
    ),
    check(
      'prescriptions_superset_order_check',
      sql`${t.supersetOrder} is null or (${t.supersetOrder} >= 1 and ${t.supersetOrder} <= 30)`,
    ),
    // A label and its order travel together (entries' 0005 pairing idiom).
    check(
      'prescriptions_superset_pair_check',
      sql`(${t.supersetLabel} is null) = (${t.supersetOrder} is null)`,
    ),
    // D14's row-local half: a rest note belongs to a group. "Last item only" is the writer's.
    check(
      'prescriptions_rest_after_needs_superset_check',
      sql`${t.restAfter} is null or ${t.supersetLabel} is not null`,
    ),
  ],
);

/**
 * prescription_quantity — a TEMPLATE prescription's typed target (FAM-1 4b; plan D2; ADR 0007 A2 §4),
 * mirroring `entry_set_quantities` so step 11b's ✓ copies rows to rows. One row per (prescription,
 * slot): a Weight × reps item writes `('primary','mass','lb', …)`; a carry writes a mass and a
 * distance. `value_min` NULL means "log in this unit, no target"; a range sets both.
 *
 * The unit guard is `entry_set_quantities`': `dimension` is stored and shared by two composite FKs,
 * so no unit of the wrong dimension and no slot of the wrong dimension can be written.
 *
 * HUMAN-AUTHORED: a mass row is a prescribed LOAD, which the LLM never authors (AGENTS.md), as
 * `prescription_targets`' docblock says. Once step 5 assigns a program to one athlete, it is that
 * athlete's prescribed load.
 *
 * **No `client_id` (and, like `entry_set_quantities`, no `public_id`).** This is config, not log data:
 * its address is (prescription, slot), a PLACE, so the partial key frees on a hide (the
 * `block_day_workouts` precedent), and a replayed save is arbitrated by the prescription's
 * `client_id`. An upsert MUST repeat the partial predicate (`targetWhere` for DoUpdate, `where` for
 * DoNothing; docs/lessons.md, 42P10).
 *
 * OWNERSHIP: no `household_id`; the scope path is prescription → block → household, like
 * `prescription_targets`. Readers join through a LIVE prescription. 6a owes the wrong-owner test.
 * The FK is NO ACTION: the household delete and ADR 0008's purge delete these rows first.
 */
export const prescriptionQuantities = pgTable(
  'prescription_quantities',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    prescriptionId: bigint('prescription_id', { mode: 'number' })
      .notNull()
      .references(() => prescriptions.id),
    slot: text('slot').notNull(), // mirrors QUANTITY_SLOT_CODES; FK'd as a PAIR with dimension
    dimension: text('dimension').notNull(), // denormalized on purpose — the composite FKs below
    unit: text('unit').notNull(),
    valueMin: numeric('value_min', { precision: 8, scale: 3 }), // NULL: this unit, no target
    valueMax: numeric('value_max', { precision: 8, scale: 3 }), // NULL: a single value, not a range
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: 'prescription_quantities_slot_dimension_fkey',
      columns: [t.slot, t.dimension],
      foreignColumns: [quantitySlots.code, quantitySlots.dimension],
    }),
    foreignKey({
      name: 'prescription_quantities_unit_dimension_fkey',
      columns: [t.unit, t.dimension],
      foreignColumns: [units.code, units.dimension],
    }),
    index('idx_prescription_quantities_prescription').on(t.prescriptionId), // covers the FK, hidden rows too
    index('idx_prescription_quantities_slot').on(t.slot, t.dimension), // covers the composite FK
    index('idx_prescription_quantities_unit').on(t.unit, t.dimension), // covers the composite FK
    uniqueIndex(PRESCRIPTION_QUANTITY_SLOT_UNIQUE_INDEX)
      .on(t.prescriptionId, t.slot)
      .where(sql`${t.deletedAt} is null`),
    // `'NaN'::numeric >= 0` is TRUE in Postgres, so NaN is refused by name.
    check(
      'prescription_quantities_value_min_check',
      sql`${t.valueMin} is null or (${t.valueMin} >= 0 and ${t.valueMin} <> 'NaN')`,
    ),
    // Tighter than D2's text (which passes a max with no min, `x >= NULL` being NULL): a range has
    // both ends, and a max alone is refused here rather than only by the writer.
    check(
      'prescription_quantities_value_max_check',
      sql`${t.valueMax} is null or (${t.valueMin} is not null and ${t.valueMax} >= ${t.valueMin} and ${t.valueMax} <> 'NaN')`,
    ),
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
    // V1-10 PR 1b: per-kid REPS override. null → use prescriptions.target_reps (the common case); non-null →
    // this kid deviates (Ray's kids differ on some pull/chin sets). Verbatim/lossless text, like target_reps.
    reps: text('reps'),
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

/**
 * program_assignment — "this athlete is on this program, from this day, through this day" (FAM-1
 * step 5; ADR 0007 decision 1 and Amendment 2 §1, §7; SCHED-1 1c as revised). The one link between a
 * household-built (TEMPLATE) block and an athlete: a template block reaches nobody except through a
 * row here (A2 §1). Nothing reads or writes it until lane P's put-on (6c); the stay-dark test pins that.
 *
 * **Three words, used exactly** (readers in 6c, 6d, 11b and 12a depend on them):
 * - **open**: `active_to IS NULL`. An INDEX notion only: the two partial keys below are on open rows.
 * - **on day D**: live (`deleted_at IS NULL`) and `active_from <= D` and (`active_to IS NULL` or
 *   `D <= active_to`). ⚠️ `active_to` is the INCLUSIVE last day: a program taken off today is still on
 *   today, and is no longer open. `queries/program-assignments.ts` → `assignmentOnDay` is the ONE
 *   spelling; due adds a live weekday row for `localWeekday(D)` (`assignmentDueOn`).
 * - **current as of T**: live and (`active_to IS NULL` or `T <= active_to`): on today, or starting later
 *   (`assignmentCurrentAsOf`). ⚠️ **Current is a property of a PROGRAM, not a row**: `DayPlan.currentPrograms`
 *   and `ProgramOrder` list each program ONCE (the schema refuses a repeat), placed by its open or
 *   upcoming row's `idx`, or by the closed row's when it has no other; a reorder writes the place onto
 *   that row. Amendment 4's writers leave at most one current row per program (a same-day put-on
 *   reopens), so "once" is defensive: the schema itself allows two (`db:verify` shows the shape). Readers order by `(idx, id)` (A2 §7): on the
 *   take-off day a closed row and another program's open row may share an `idx`, because the order key
 *   covers open rows only.
 *
 * **Keys.** `public_id` is the row's address (ASSIGN-1's version guard names it; `(profile, block)` is
 * ambiguous once closed rows exist). NO `client_id`: put-on carries none (`assignDraftSchema`); the
 * natural key is `(profile, block, active_from)`. ⚠️ **A hit on it is a replay ONLY if the row it hit is
 * still open.** 🔴 **Off and on again the same day: the keys do not decide it, ADR 0007 Amendment 4
 * does** _(maintainer, 2026-11-16)_. Take off removes a start dated today when the athlete has logged
 * nothing live in it today (a hide, which frees all three keys); otherwise it closes the row through
 * today. A put-on that finds this athlete's row of this program with `active_to = today` **reopens it**
 * (clears `active_to` on the same row, one stretch with no gap) and retakes a place through the band,
 * since take off freed the old one. 6c must therefore look for that row FIRST, whatever day it started:
 * - a blind insert `from = today` after a take-off of a program that started today hits the start key
 *   on the closed row, and a blind `ON CONFLICT DO NOTHING` would answer ok and leave the athlete off;
 * - one that started earlier (the usual case) is refused by NO key: it inserts a second row and the
 *   program is due twice today.
 * `db:verify` proves both shapes at the schema level and `assignmentsOverlapping` flags the second, so
 * a writer that skips the reopen is caught. A second OPEN row for one (profile, block) is refused by
 * the open key; any other later row must start after the earlier one's `active_to`.
 *
 * ⚠️ **WRITER-ENFORCED, not schema-enforced** (a choice: a carried `household_id` and composite FKs would
 * enforce the first two, at the cost of `UNIQUE (id, household_id)` on `profiles` and `program_blocks`;
 * ADR 0007 chose the writer): the block is a TEMPLATE block (A2 §1: refused by 6c, flagged here by
 * `db:verify`); the block and the profile are in ONE household; two live rows for one (profile, block)
 * never cover the same day; every live assignment has at least one live weekday row (FAM-1's put-on
 * writes all seven). `db:verify` flags each. A reader joins BOTH `profile_id` and `block_id` to the scope:
 * a stray cross-household row would otherwise show another household's program text on Today.
 *
 * PERSONAL DATA (A2 §8): which child is on which program, from and to which day. Both FKs are NO
 * ACTION: the household delete and the per-athlete erasure delete these rows first (`runbooks.md`
 * steps 9c, 9d; "Erase one athlete"). Take off is NOT a soft delete (the closed row stays as history); a
 * program that has not started, or started today with nothing logged in it (Amendment 4), is
 * soft-deleted instead.
 */
export const programAssignments = pgTable(
  'program_assignments',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    publicId: uuid('public_id').notNull().unique(), // UUIDv7, app-generated (anti-IDOR)
    blockId: bigint('block_id', { mode: 'number' })
      .notNull()
      .references(() => programBlocks.id),
    profileId: bigint('profile_id', { mode: 'number' })
      .notNull()
      .references(() => profiles.id),
    idx: integer('idx').notNull(), // the athlete's program order, 0-based (D8); written by the band
    // NOT NULL: a nullable start would let two identical open rows through the natural key (NULLs are
    // distinct in a unique index).
    activeFrom: date('active_from').notNull(),
    activeTo: date('active_to'), // the INCLUSIVE last day; NULL while open
    ...timestamps,
  },
  (t) => [
    index('idx_program_assignments_block').on(t.blockId), // covers the block FK, hidden rows too
    index('idx_program_assignments_profile').on(t.profileId), // covers the profile FK, hidden rows too
    uniqueIndex(ASSIGNMENT_START_UNIQUE_INDEX)
      .on(t.profileId, t.blockId, t.activeFrom)
      .where(sql`${t.deletedAt} is null`),
    // At most one OPEN row per program (A2 §7). Partial on both conjuncts: an upsert targeting it must
    // repeat both (docs/lessons.md, 42P10).
    uniqueIndex(ASSIGNMENT_OPEN_UNIQUE_INDEX)
      .on(t.profileId, t.blockId)
      .where(sql`${t.activeTo} is null and ${t.deletedAt} is null`),
    // One open program per place in the athlete's order (A2 §7); a closed row frees its place.
    uniqueIndex(ASSIGNMENT_ORDER_UNIQUE_INDEX)
      .on(t.profileId, t.idx)
      .where(sql`${t.activeTo} is null and ${t.deletedAt} is null`),
    check('program_assignments_idx_check', sql`${t.idx} >= 0`),
    check(
      'program_assignments_active_range_check',
      sql`${t.activeTo} is null or ${t.activeTo} >= ${t.activeFrom}`,
    ),
  ],
);

/**
 * program_assignment_weekday — WHICH DAYS an assignment is due, as rows (ADR 0007 decision 1). Due on D
 * is a lookup (a live row with `weekday = localWeekday(D)`), never arithmetic. FAM-1's put-on writes all
 * SEVEN (A2 §7); an athlete's own days are ASSIGN-1's, which owes this table a privacy re-read, because
 * it then becomes a child's weekly schedule.
 *
 * `weekday` is `0 = Sunday … 6 = Saturday`, `localWeekday`'s origin (`WEEKDAYS`); the CHECK inlines the
 * members and `db:verify` pins it to `WEEKDAYS` both ways, and proves the origin against literals.
 * No `public_id` (the `block_day_workouts` precedent: nothing outside the server addresses one); its
 * address is (assignment, weekday). The FK is named explicitly because drizzle's generated name is 67
 * bytes and Postgres truncates at 63.
 */
export const programAssignmentWeekdays = pgTable(
  'program_assignment_weekdays',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    assignmentId: bigint('assignment_id', { mode: 'number' }).notNull(),
    weekday: integer('weekday').notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: 'program_assignment_weekdays_assignment_fkey',
      columns: [t.assignmentId],
      foreignColumns: [programAssignments.id],
    }),
    index('idx_program_assignment_weekdays_assignment').on(t.assignmentId), // covers the FK, hidden rows too
    uniqueIndex('uq_program_assignment_weekdays_assignment_weekday')
      .on(t.assignmentId, t.weekday)
      .where(sql`${t.deletedAt} is null`),
    check('program_assignment_weekdays_weekday_check', sql`${t.weekday} in (0, 1, 2, 3, 4, 5, 6)`),
  ],
);
