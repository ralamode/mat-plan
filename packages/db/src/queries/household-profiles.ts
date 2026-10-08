import { and, asc, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { schema } from '../client';
import type { HouseholdScope } from '../scope';
import { inHousehold } from '../writers/ownership';

/**
 * The profile-picker read (TEN-1 1b), single-sourced here so the app DAL (`listProfiles`) and the
 * `db:verify` proof run the **IDENTICAL** query — the `weeklyAdherenceRows` / `programDayRows`
 * precedent, and `and(isNull(deletedAt), inHousehold(scope))` is the whole predicate, so there is
 * nothing for a second copy to drift on.
 *
 * ## Why this one query earned its own module
 *
 * ADR 0006 chose **option A (session-only)**: `/p` is byte-identical for every household on earth,
 * so the picker has **no second factor at all** — no id in the address to disagree with the session.
 * That makes this query the entire isolation boundary for the app's front door, which is why the ADR
 * names it as a **named obligation**: _"the picker returns only the session household's profiles,
 * proved by a `db:verify` case with two households and two profiles each."_
 *
 * The emitted-SQL assertion in `apps/web/lib/dal/profiles.test.ts` is a **second** vehicle, not the
 * only one: it proves the builder appended a conjunct, never which rows come back. Only a real
 * database with two households in it can prove that, and only if the proof runs this function rather
 * than a re-typed lookalike. Hence the extraction.
 *
 * Shape notes, both load-bearing:
 * - **`household_id` is the ONLY tenancy factor**, via `inHousehold` — the one place that reads
 *   `scope.householdId`. The picker takes no profile id, so `isLiveProfile` does not apply; this is
 *   its list-shaped sibling and it must not grow a second rule.
 * - **Stable tile order** — earliest-created first (`asc(profiles.id)`), the seed order. The order is
 *   part of the UI contract (the e2e specs index tiles), not an incidental.
 */
export function householdProfileRows(
  db: NodePgDatabase<typeof schema>,
  args: { scope: HouseholdScope },
) {
  return db
    .select({
      publicId: schema.profiles.publicId,
      name: schema.profiles.name,
      kind: schema.profiles.kind,
      avatar: schema.profiles.avatar,
    })
    .from(schema.profiles)
    .where(and(isNull(schema.profiles.deletedAt), inHousehold(args.scope)))
    .orderBy(asc(schema.profiles.id));
}

/** One raw picker row (drizzle-inferred). The DAL maps this → its `ProfileDTO`. */
export type HouseholdProfileRow = Awaited<ReturnType<typeof householdProfileRows>>[number];
