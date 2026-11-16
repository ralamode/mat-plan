import { localWeekday } from '@mat-plan/shared';
import { and, eq, exists, gte, isNull, lte, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { schema } from '../client';

/**
 * 🔴 **The ONE spelling of "an assignment is on day D"** (FAM-1 step 5; ADR 0007 A2 §7): live, started,
 * and not past its INCLUSIVE last day. Every reader of `program_assignments` (6c's program view, 11b,
 * 12a's Today) builds on this predicate rather than re-typing the range, because `active_to` is the
 * last day ON the program, not the day after, and a hand-written `<` is the off-by-one that drops a
 * program on the day it was taken off. `db:verify` → FAM-1 5 proves both boundaries against literals.
 *
 * `day` is an ISO date (`YYYY-MM-DD`), the household's local day: a `date` column compares as a date.
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
 * "Due on D": on D (`assignmentOnDay`) AND a live weekday row for D's weekday, through `localWeekday`'s
 * `0 = Sunday` origin, which `WEEKDAYS` and the weekday CHECK share. A lookup, never arithmetic (ADR
 * 0007 decision 1). A hidden assignment is never due, whatever weekday rows it still holds (a program
 * taken off before it started is soft-deleted with its seven rows live).
 *
 * Takes the database so the weekday lookup is a correlated subquery on the caller's handle (the
 * `db:verify` harness passes its transaction).
 */
export function assignmentDueOn(db: NodePgDatabase<typeof schema>, day: string) {
  const a = schema.programAssignments;
  const w = schema.programAssignmentWeekdays;
  return and(
    assignmentOnDay(day),
    exists(
      db
        .select({ one: sql`1` })
        .from(w)
        .where(
          and(eq(w.assignmentId, a.id), eq(w.weekday, localWeekday(day)), isNull(w.deletedAt)),
        ),
    ),
  );
}
