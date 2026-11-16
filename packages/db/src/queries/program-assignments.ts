import { localWeekday } from '@mat-plan/shared';
import { and, gte, isNull, lte, or, sql } from 'drizzle-orm';

import { schema } from '../client';

/**
 * 🔴 **The ONE spelling of "an assignment is on day D"** (FAM-1 step 5; ADR 0007 A2 §7): live, started,
 * and not past its INCLUSIVE last day. Every reader of `program_assignments` (6c's program view, 11b,
 * 12a's Today) builds on this predicate rather than re-typing the range, because `active_to` is the
 * last day ON the program, not the day after, and a hand-written `<` is the off-by-one that drops a
 * program on the day it was taken off. `db:verify` → FAM-1 5 proves both boundaries against literals.
 *
 * `day` is an ISO date (`YYYY-MM-DD`), the household's local day: a `date` column compares as a date.
 *
 * ⚠️ **It judges the assignment row only.** A reader ANDs it with its live parents and its scope: the
 * block (`liveTemplateBlockIn(scope)`) and the athlete (`isLiveProfile`), both joined to the scope,
 * because a hidden program or a hidden athlete is not on anything, and a stray cross-household row
 * must not show another household's program (`writers/ownership.ts`; write-path.md invariant 7).
 */
export function assignmentOnDay(day: string) {
  const a = schema.programAssignments;
  return and(
    isNull(a.deletedAt),
    lte(a.activeFrom, day),
    or(isNull(a.activeTo), gte(a.activeTo, day)),
  );
}

/**
 * "Current as of T": live and not past its last day (on T, or starting later). `DayPlan.currentPrograms`
 * and `ProgramOrder` are built from these rows. ⚠️ **Several rows of ONE program can be current at
 * once**: taken off today and back on from tomorrow leaves the closed row (through today) and the new
 * one (from tomorrow). A reader lists each PROGRAM once, placed by its open or upcoming row's `idx`,
 * or by the closed row's when it has no other (`schema.ts` → `programAssignments`). The same live
 * parent and scope rule as `assignmentOnDay` applies.
 */
export function assignmentCurrentAsOf(today: string) {
  const a = schema.programAssignments;
  return and(isNull(a.deletedAt), or(isNull(a.activeTo), gte(a.activeTo, today)));
}

/**
 * "Due on D": on D (`assignmentOnDay`) AND a live weekday row for D's weekday, through `localWeekday`'s
 * `0 = Sunday` origin, which `WEEKDAYS` and the weekday CHECK share. A lookup, never arithmetic (ADR
 * 0007 decision 1). A hidden assignment is never due, whatever weekday rows it still holds (a program
 * taken off before it started is soft-deleted with its seven rows live).
 *
 * ⚠️ The weekday lookup is a correlated subquery on `program_assignments.id`: the outer query's FROM
 * must be `program_assignments` itself, UNALIASED (an alias or a self-join would correlate to the wrong
 * row). It runs on whatever handle runs the outer query.
 */
export function assignmentDueOn(day: string) {
  const a = schema.programAssignments;
  const w = schema.programAssignmentWeekdays;
  return and(
    assignmentOnDay(day),
    sql`exists (select 1 from ${w} where ${w.assignmentId} = ${a.id} and ${w.weekday} = ${localWeekday(day)} and ${w.deletedAt} is null)`,
  );
}
