import { type SQL, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

import { movementRefsIntoHousehold } from '../queries/movement-ownership';
import * as schema from '../schema';
import type { HouseholdScope } from '../scope';
import { HOUSEHOLD_GRAPH } from './graph';

/**
 * The household erasure's pre-flights (a)–(h) (`PRIV-3` PR 2a; `docs/runbooks.md` → "Delete a
 * household", step 3; `docs/plans/priv-3-guarded-deletion.md` D3).
 *
 * **One join per shape, two views of it.** Each shape below is the join the runbook's pre-flight of
 * that letter runs, written once, with the rows it is about passed in as a condition. Two views
 * read it:
 *
 * - the **census**, unscoped: "does any row anywhere have this shape". `db:verify` asserts it reads
 *   zero on the fixture world (`scripts/verify/schema.ts` re-exports these under their old names, so
 *   its call sites and `verify/day.ts` are unchanged);
 * - the **household check**, `householdPreflights(exec, scope)`: the same join, narrowed to rows that
 *   touch the household. The erasure core re-runs it inside its transaction, under the parent locks,
 *   and refuses on any non-zero count.
 *
 * Step 5's athlete pre-flights (`verify/schema.ts`, interim until `PRIV-3` PR 3) are a third view of
 * the (a), (b), (c) and (h) shapes, narrowed to one profile.
 *
 * **Which checks are the only guard.** (a), (b), (c), (d) and (h) find a row the delete would abort
 * on (`23503`) and name it first. **(e), (f) and (g) are the only thing that stops a silent loss**:
 * each guards an `ON DELETE SET NULL` key (`graph.ts` → `NON_ABORTING_EDGES`), so without the check
 * the delete would null another household's pointer and leave the household's typed text on that
 * family's row.
 *
 * **No `deleted_at` filter anywhere.** A hidden row still holds its foreign key.
 *
 * Every predicate on the household is the graph's own `householdRows`, so a check can never select
 * the household's rows by a different rule than the delete that follows it.
 */

/** The pre-flight letters, in the runbook's order. */
export const PREFLIGHT_CHECKS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
export type PreflightCheck = (typeof PREFLIGHT_CHECKS)[number];

/** Anything that can run a query: a db handle, a transaction, or `db:verify`'s PGlite transaction. */
export type Reads = { execute: (query: SQL) => Promise<unknown> };

/** A condition on a column expression: "this id is one of the rows the check is about". */
export type IdIn = (id: SQL) => SQL;

const everyRow: IdIn = () => sql`true`;

async function ids(exec: Reads, query: SQL): Promise<number[]> {
  const res = (await exec.execute(sql`${query} ORDER BY 1`)) as { rows: { id: number | string }[] };
  return res.rows.map((r) => Number(r.id));
}

async function countOf(exec: Reads, query: SQL): Promise<number> {
  const res = (await exec.execute(sql`SELECT count(*)::int AS n FROM (${query}) q`)) as {
    rows: { n: number }[];
  };
  return res.rows[0].n;
}

// ── The shapes ───────────────────────────────────────────────────────────────────────────────────

/**
 * (a) A prescription target whose athlete and prescription are in different households. `about`
 * receives the target's profile and the prescription's block.
 */
export const targetsAcrossHouseholds = (about: (profile: SQL, block: SQL) => SQL) => sql`
  SELECT t.id FROM prescription_targets t
    JOIN prescriptions x ON x.id = t.prescription_id
    JOIN program_blocks b ON b.id = x.block_id
    JOIN profiles pr ON pr.id = t.profile_id
   WHERE b.household_id <> pr.household_id AND ${about(sql`t.profile_id`, sql`b.id`)}`;

/** (h) An assignment whose athlete and program are in different households. */
export const assignmentsAcross = (about: (profile: SQL, block: SQL) => SQL) => sql`
  SELECT a.id FROM program_assignments a
    JOIN profiles pr ON pr.id = a.profile_id
    JOIN program_blocks b ON b.id = a.block_id
   WHERE pr.household_id <> b.household_id AND ${about(sql`a.profile_id`, sql`b.id`)}`;

/** (b) An entry of an athlete OUTSIDE `athletes` in a session of an athlete inside it. */
export const strayEntriesInSessions = (athletes: IdIn) => sql`
  SELECT e.id FROM entries e
   WHERE NOT ${athletes(sql`e.profile_id`)}
     AND e.session_id IN (SELECT s.id FROM sessions s WHERE ${athletes(sql`s.profile_id`)})`;

/** (c) An entry of an athlete OUTSIDE `athletes` in a superset of an athlete inside it. */
export const strayEntriesInSupersets = (athletes: IdIn) => sql`
  SELECT e.id FROM entries e
   WHERE NOT ${athletes(sql`e.profile_id`)}
     AND e.superset_id IN (SELECT ss.id FROM supersets ss
                             JOIN sessions s ON s.id = ss.session_id
                            WHERE ${athletes(sql`s.profile_id`)})`;

/** (e) A workout copied from a workout in ANOTHER household. `source` receives the source's block. */
const workoutCopiesAcross = (source: IdIn) => sql`
  SELECT w.id FROM workouts w
    JOIN program_blocks b ON b.id = w.block_id
    JOIN workouts src ON src.id = w.copied_from_workout_id
    JOIN program_blocks sb ON sb.id = src.block_id
   WHERE b.household_id <> sb.household_id AND ${source(sql`sb.id`)}`;

/** (f) A session whose workout is in another household than its athlete. `program` gets the block. */
const sessionsOnForeign = (program: IdIn) => sql`
  SELECT s.id FROM sessions s
    JOIN profiles p ON p.id = s.profile_id
    JOIN workouts w ON w.id = s.workout_id
    JOIN program_blocks b ON b.id = w.block_id
   WHERE p.household_id <> b.household_id AND ${program(sql`b.id`)}`;

/** (g) An entry whose prescription is in another household than its athlete. */
const entriesOnForeign = (program: IdIn) => sql`
  SELECT e.id FROM entries e
    JOIN profiles p ON p.id = e.profile_id
    JOIN prescriptions pr ON pr.id = e.prescription_id
    JOIN program_blocks b ON b.id = pr.block_id
   WHERE p.household_id <> b.household_id AND ${program(sql`b.id`)}`;

// ── The censuses (unscoped; `db:verify` asserts each reads zero on the fixture world) ────────────

/** Workouts copied from a workout in ANOTHER household (A2 §2, §8). Pre-flight (e), unscoped. */
export const crossHouseholdWorkoutCopies = (exec: Reads) =>
  ids(exec, workoutCopiesAcross(everyRow));
/** Sessions whose workout is in ANOTHER household than the session's profile (A2 §6). (f), unscoped. */
export const sessionsOnForeignWorkouts = (exec: Reads) => ids(exec, sessionsOnForeign(everyRow));
/** Entries whose prescription is in ANOTHER household than the entry's profile (A3). (g), unscoped. */
export const entriesOnForeignPrescriptions = (exec: Reads) => ids(exec, entriesOnForeign(everyRow));
/** Assignments whose athlete and program are in different households. (h), unscoped. */
export const assignmentsAcrossHouseholds = (exec: Reads) =>
  ids(
    exec,
    assignmentsAcross(() => sql`true`),
  );
/** The ids an id-select shape returns, ascending: how step 5's athlete views read a shape. */
export const shapeIds = ids;

// ── The household check ──────────────────────────────────────────────────────────────────────────

/** `id IN (the household's rows of t)`, by the graph's own predicate. */
function householdIdsOf(t: PgTable & { id: unknown }, scope: HouseholdScope): IdIn {
  const g = HOUSEHOLD_GRAPH.find((x) => x.table === t);
  if (!g) throw new Error('PRIV-3: preflight asked for a table outside HOUSEHOLD_GRAPH');
  return (id) =>
    sql`${id} IN (SELECT ${g.table.id} FROM ${g.table} WHERE ${g.householdRows(scope)})`;
}

/**
 * Every pre-flight for one household, as counts. Zero everywhere is the only state the core erases
 * from. (d) counts only the direction that aborts: another household's row on H's movement. H's row
 * on another household's movement is deleted with H, and is not refused.
 */
export async function householdPreflights(
  exec: Reads,
  scope: HouseholdScope,
): Promise<Record<PreflightCheck, number>> {
  const athletes = householdIdsOf(schema.profiles, scope);
  const blocks = householdIdsOf(schema.programBlocks, scope);
  // Either side in H: the target or assignment of H's athlete on another program, or of another
  // household's athlete on H's program. Both are left by the `AND` predicate and abort later.
  const eitherSide = (profile: SQL, block: SQL) => sql`(${athletes(profile)} OR ${blocks(block)})`;
  return {
    a: await countOf(exec, targetsAcrossHouseholds(eitherSide)),
    b: await countOf(exec, strayEntriesInSessions(athletes)),
    c: await countOf(exec, strayEntriesInSupersets(athletes)),
    d: await movementRefsIntoHousehold(exec, scope),
    e: await countOf(exec, workoutCopiesAcross(blocks)),
    f: await countOf(exec, sessionsOnForeign(blocks)),
    g: await countOf(exec, entriesOnForeign(blocks)),
    h: await countOf(exec, assignmentsAcross(eitherSide)),
  };
}
