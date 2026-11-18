import { and, asc, isNull } from 'drizzle-orm';

import { schema } from '../../client';
import type { HouseholdScope } from '../../scope';
import type { Executor } from '../../writers/executor';
import { inHousehold } from '../../writers/ownership';
import { currentPrograms, type ProgramOnDay } from '../day/day-plan';
import { dayAssignments, type DayAssignment } from '../day/scheduled';

/** One of the household's athletes, with their current programs in their own order. */
export type AthleteOnPrograms = {
  id: number;
  publicId: string;
  name: string;
  /** Their live assignment rows, in `(idx, id)` order (`dayAssignments`). */
  assignments: DayAssignment[];
  /** Each program they are on now or start later, once, in their order (`currentPrograms`). */
  current: ProgramOnDay[];
};

/**
 * The household's live, not archived athletes, earliest made first (`householdProfileRows`' order,
 * the switcher's), each with the programs they are on as of `today`.
 *
 * The program order is the day page's own: `dayAssignments` and `currentPrograms` (FAM-1 12a), which
 * lane E exported for this second consumer, so the program page and the day page never disagree on
 * which programs an athlete is on, or in what order. An archived athlete is left out, as the day
 * page's switcher leaves them out (C18) and `putOn` refuses them.
 *
 * One read per athlete: a household holds at most `MAX_HOUSEHOLD_ATHLETES`.
 *
 * ⚠️ A second household-profile list beside `householdProfileRows` (`queries/household-profiles.ts`),
 * which asks that its consumers filter rather than add a rule: this one needs the internal id and an
 * `Executor`, which that read does not give, and its `archived_at` conjunct is the program pages'
 * rule, not the picker's. Both keep the same tenancy predicate (`inHousehold` and live).
 */
export async function athletesOnPrograms(
  exec: Executor,
  scope: HouseholdScope,
  today: string,
): Promise<AthleteOnPrograms[]> {
  const profiles = await exec
    .select({
      id: schema.profiles.id,
      publicId: schema.profiles.publicId,
      name: schema.profiles.name,
    })
    .from(schema.profiles)
    .where(
      and(
        isNull(schema.profiles.deletedAt),
        isNull(schema.profiles.archivedAt),
        inHousehold(scope),
      ),
    )
    .orderBy(asc(schema.profiles.id));
  const athletes: AthleteOnPrograms[] = [];
  for (const profile of profiles) {
    const assignments = await dayAssignments(exec, scope, profile.id, { day: today, today });
    athletes.push({ ...profile, assignments, current: currentPrograms(assignments, today) });
  }
  return athletes;
}
