import { type SQL, sql } from 'drizzle-orm';
import { getTableConfig, type PgColumn, type PgTable } from 'drizzle-orm/pg-core';

import * as schema from '../schema';
import type { HouseholdScope } from '../scope';
import {
  householdMemberInHousehold,
  householdRowIs,
  inHousehold,
  movementInHousehold,
  programBlockInHousehold,
} from '../writers/ownership';

/**
 * The household graph (`PRIV-3` PR 1): every table that holds a household's data, in the order a
 * delete must walk it, each with the predicate that selects one household's rows.
 *
 * **What it is for.** Erasing a household, or one athlete inside it, is a sequence of `DELETE`s that
 * must name every table and must run child before parent, or a foreign key aborts it. That list was a
 * hand table in `docs/runbooks.md`; this is the list as code, so a proof can hold it against the
 * catalog. `OPS-3`'s restore walks the same list: forward to extract, reversed to re-insert.
 *
 * **What proves it** (`db:verify`, `scripts/verify/erasure.ts`):
 *
 * - P1: every table in `public` is in exactly one of `HOUSEHOLD_GRAPH` and `REFERENCE_TABLES`, and
 *   every table with a `household_id` or `profile_id` column is in the graph;
 * - P2: every foreign key into a graph table comes from a graph table at a LOWER index (child before
 *   parent), and the keys whose delete rule is neither `NO ACTION` nor `RESTRICT` are exactly
 *   `NON_ABORTING_EDGES`;
 * - P7: the predicates partition the households — no row is matched by two of them, and a row that
 *   straddles two households is matched by neither;
 * - P8: at athlete grain, the household form selects the same rows as `ATHLETE_GRAPH`'s scopes.
 *   ⚠️ Only on data with no straddling row: an athlete's target or assignment on another
 *   household's program is taken by the per-profile scope and left by the `AND`. "Erase one
 *   athlete"'s pre-flight 2 refuses such a row before any delete, which is what makes the two agree.
 *
 * **Why two rows use `AND`.** `prescription_targets` and `program_assignments` each point at a
 * profile AND at a program, and the two can belong to different households (no writer makes one, but
 * the schema allows it). The predicate requires both to be the household's. A straddling row is then
 * matched by neither household and is left behind, so the delete of the parent it points into aborts
 * with `23503`: the erasure fails closed instead of taking another family's row. `OR` would delete it.
 *
 * **Never a `deleted_at` conjunct.** A hidden row is still a row the erasure removes
 * (`scripts/corrections/README.md`, the deletion rules).
 *
 * Not re-exported from `src/index.ts`: nothing in the app erases a household.
 */

/** One table of the graph and the rows of it that belong to a household. */
export type HouseholdGraphTable = {
  readonly table: PgTable & { id: PgColumn };
  /** The household's rows of `table`. Hidden rows included; never a `deleted_at` conjunct. */
  readonly householdRows: (scope: HouseholdScope) => SQL;
};

/** The table's SQL name, from drizzle's own config, so no name is re-typed beside its table. */
export function graphTableName(t: PgTable): string {
  return getTableConfig(t).name;
}

// ── The athlete grain: one profile's rows (FAM-1 step 5) ─────────────────────────────────────────

/**
 * 🔴 **"Erase one athlete" as ONE ordered list** (FAM-1 step 5; ADR 0007 A2 §8, §10): child before
 * parent; a hidden row is still erased, so no `deleted_at` filter anywhere. Each scope selects one
 * profile's rows by its internal id. `db:verify` reads the runbook's step-4 table and step-3 count
 * block and requires both to be exactly this list, in this order, and P2 requires it to be
 * `HOUSEHOLD_GRAPH`'s athlete-grain tables in graph order.
 *
 * ⚠️ Verify-only until `PRIV-3` PR 3; a caller outside `scripts/verify` must first resolve `p` from a
 * `public_id` inside a `HouseholdScope`. The scopes take an internal id and check no household.
 */
const P_ENTRIES = (p: number) => sql`(SELECT id FROM entries WHERE profile_id = ${p})`;
const P_SESSIONS = (p: number) => sql`(SELECT id FROM sessions WHERE profile_id = ${p})`;
const P_ASSIGNMENTS = (p: number) =>
  sql`(SELECT id FROM program_assignments WHERE profile_id = ${p})`;
export const ATHLETE_GRAPH = [
  {
    table: 'entry_set_quantities',
    scope: (p: number) =>
      sql`entry_set_id IN (SELECT id FROM entry_sets WHERE entry_id IN ${P_ENTRIES(p)})`,
  },
  { table: 'entry_sets', scope: (p: number) => sql`entry_id IN ${P_ENTRIES(p)}` },
  { table: 'entries', scope: (p: number) => sql`profile_id = ${p}` },
  { table: 'supersets', scope: (p: number) => sql`session_id IN ${P_SESSIONS(p)}` },
  { table: 'sessions', scope: (p: number) => sql`profile_id = ${p}` },
  { table: 'day_readiness', scope: (p: number) => sql`profile_id = ${p}` },
  { table: 'ramp_targets', scope: (p: number) => sql`profile_id = ${p}` },
  { table: 'prescription_targets', scope: (p: number) => sql`profile_id = ${p}` },
  {
    table: 'program_assignment_weekdays',
    scope: (p: number) => sql`assignment_id IN ${P_ASSIGNMENTS(p)}`,
  },
  { table: 'program_assignments', scope: (p: number) => sql`profile_id = ${p}` },
  { table: 'profiles', scope: (p: number) => sql`id = ${p}` },
] as const;
export const ATHLETE_GRAPH_TABLES = ATHLETE_GRAPH.map((r) => r.table);

/** Whether a graph table is athlete grain: one of `ATHLETE_GRAPH`'s tables. Derived, never stored. */
export function isAthleteGrain(name: string): boolean {
  return (ATHLETE_GRAPH_TABLES as readonly string[]).includes(name);
}

// ── The household grain: every row of one household ──────────────────────────────────────────────

// The id sets the predicates reach through. Each is the parent's own predicate, so a child can never
// be scoped by a weaker rule than its parent. A two-part predicate carries its own parentheses:
// drizzle's `and()` does not wrap its operands, so a caller's `and(eq(id, n), householdRows(s))`
// must not be able to re-associate it.
const profilesOf = (s: HouseholdScope) =>
  sql`(SELECT ${schema.profiles.id} FROM ${schema.profiles} WHERE ${inHousehold(s)})`;
const blocksOf = (s: HouseholdScope) =>
  sql`(SELECT ${schema.programBlocks.id} FROM ${schema.programBlocks} WHERE ${programBlockInHousehold(s)})`;
const entryRows = (s: HouseholdScope) => sql`${schema.entries.profileId} IN ${profilesOf(s)}`;
const entriesOf = (s: HouseholdScope) =>
  sql`(SELECT ${schema.entries.id} FROM ${schema.entries} WHERE ${entryRows(s)})`;
const entrySetRows = (s: HouseholdScope) => sql`${schema.entrySets.entryId} IN ${entriesOf(s)}`;
const sessionRows = (s: HouseholdScope) => sql`${schema.sessions.profileId} IN ${profilesOf(s)}`;
const prescriptionRows = (s: HouseholdScope) =>
  sql`${schema.prescriptions.blockId} IN ${blocksOf(s)}`;
const prescriptionsOf = (s: HouseholdScope) =>
  sql`(SELECT ${schema.prescriptions.id} FROM ${schema.prescriptions} WHERE ${prescriptionRows(s)})`;
const assignmentRows = (s: HouseholdScope) =>
  sql`(${schema.programAssignments.profileId} IN ${profilesOf(s)} AND ${schema.programAssignments.blockId} IN ${blocksOf(s)})`;

/**
 * 🔴 **The 19 tables, child before parent.** Order is step 4 of the runbook's "Delete a household",
 * renumbered; P2 holds it against `pg_constraint`. Filtered to athlete grain it is `ATHLETE_GRAPH`.
 */
export const HOUSEHOLD_GRAPH: readonly HouseholdGraphTable[] = [
  {
    table: schema.entrySetQuantities,
    householdRows: (s) =>
      sql`${schema.entrySetQuantities.entrySetId} IN (SELECT ${schema.entrySets.id} FROM ${schema.entrySets} WHERE ${entrySetRows(s)})`,
  },
  { table: schema.entrySets, householdRows: entrySetRows },
  { table: schema.entries, householdRows: entryRows },
  {
    table: schema.supersets,
    householdRows: (s) =>
      sql`${schema.supersets.sessionId} IN (SELECT ${schema.sessions.id} FROM ${schema.sessions} WHERE ${sessionRows(s)})`,
  },
  { table: schema.sessions, householdRows: sessionRows },
  {
    table: schema.dayReadiness,
    householdRows: (s) => sql`${schema.dayReadiness.profileId} IN ${profilesOf(s)}`,
  },
  {
    table: schema.rampTargets,
    householdRows: (s) => sql`${schema.rampTargets.profileId} IN ${profilesOf(s)}`,
  },
  {
    // AND: a target of H's athlete on another household's prescription is matched by neither.
    table: schema.prescriptionTargets,
    householdRows: (s) =>
      sql`(${schema.prescriptionTargets.profileId} IN ${profilesOf(s)} AND ${schema.prescriptionTargets.prescriptionId} IN ${prescriptionsOf(s)})`,
  },
  {
    table: schema.prescriptionQuantities,
    householdRows: (s) =>
      sql`${schema.prescriptionQuantities.prescriptionId} IN ${prescriptionsOf(s)}`,
  },
  { table: schema.prescriptions, householdRows: prescriptionRows },
  {
    table: schema.blockDayWorkouts,
    householdRows: (s) => sql`${schema.blockDayWorkouts.blockId} IN ${blocksOf(s)}`,
  },
  {
    table: schema.workouts,
    householdRows: (s) => sql`${schema.workouts.blockId} IN ${blocksOf(s)}`,
  },
  {
    table: schema.programAssignmentWeekdays,
    householdRows: (s) =>
      sql`${schema.programAssignmentWeekdays.assignmentId} IN (SELECT ${schema.programAssignments.id} FROM ${schema.programAssignments} WHERE ${assignmentRows(s)})`,
  },
  // AND: an assignment of H's athlete to another household's block is matched by neither.
  { table: schema.programAssignments, householdRows: assignmentRows },
  { table: schema.programBlocks, householdRows: (s) => programBlockInHousehold(s) },
  { table: schema.movements, householdRows: (s) => movementInHousehold(s) },
  { table: schema.profiles, householdRows: (s) => inHousehold(s) },
  { table: schema.householdMembers, householdRows: (s) => householdMemberInHousehold(s) },
  { table: schema.households, householdRows: (s) => householdRowIs(s) },
];

/**
 * The reference data: owned by no household, never erased, and what a restore target must already
 * hold before `OPS-3` re-inserts a household into it (with every `household_id IS NULL` movement the
 * household references).
 */
export const REFERENCE_TABLES: readonly PgTable[] = [
  schema.units,
  schema.quantitySlots,
  schema.activityTypeCategories,
  schema.activityTypes,
  schema.metricDefinitions,
];

/**
 * Every foreign key into a graph table whose delete rule is neither `NO ACTION` nor `RESTRICT`, with
 * what makes it safe. Those two abort a delete that would orphan a row, which is the fail-closed
 * default; these do not, so each needs a reason the erasure cannot silently lose or keep a row.
 *
 * - `cascade`: the child is in the graph, below its parent, so the cascade removes only rows the walk
 *   removes anyway;
 * - `e`, `f`, `g`: `SET NULL` keys, each refused first by the runbook pre-flight of that letter
 *   ("Delete a household", step 3): (e) a workout copied from H's workout into another household,
 *   (f) another household's session of H's workout, (g) another household's entry on H's
 *   prescription.
 */
export const NON_ABORTING_EDGES = [
  { fk: 'entries_prescription_id_prescriptions_id_fk', guard: 'g' },
  { fk: 'entry_set_quantities_entry_set_id_entry_sets_id_fk', guard: 'cascade' },
  { fk: 'entry_sets_entry_id_entries_id_fk', guard: 'cascade' },
  { fk: 'sessions_workout_id_workouts_id_fk', guard: 'f' },
  { fk: 'workouts_copied_from_workout_id_workouts_id_fk', guard: 'e' },
] as const;
