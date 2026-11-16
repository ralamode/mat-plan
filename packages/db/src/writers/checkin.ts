import { METRIC_KEYS } from '@mat-plan/shared';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';

import { schema } from '../client';
import type { Executor } from './executor';

/**
 * The check-in / life insert (V1-5), single-sourced HERE in `packages/db` so the app DAL and
 * `db:verify` prove the IDENTICAL statement — the `updateStrengthSetById` doctrine, and the reason
 * it cannot live in `apps/web/lib/dal`: `verify.ts` imports only `../src/*`, so a writer the app
 * keeps to itself is a writer no real database ever tests.
 *
 * 🔴 **Why it moved, and why that is a bug fix rather than a tidy-up (V1-9b B1-1, correctness 6).**
 * It lived in `apps/web/lib/dal/entries.ts`, where its only coverage was an emitted-SQL assertion —
 * the shape of the query, never its behaviour against rows. That was tolerable while the answer was
 * one boolean. It stopped being tolerable at **B0**: making the five `client_id` arbiters
 * non-partial means a hidden row no longer *shares* its `client_id`, it **holds** it, so a replay of
 * a hidden check-in now conflicts instead of inserting a twin. The old code read that conflict as
 * `created: false` and the action turned it into "already logged" — which is false twice over: the
 * row is not logged, it was deleted, and nothing tells the person that.
 *
 * ⚠️ **Not to be confused with the plan's accepted 500.** That Risks row — *"between B0 and B1-1 a
 * hidden row's replay throws instead of inserting"* — is the **strength** path, where
 * `reselectLiveByClientId` (`strength-session.ts`) refuses rather than attaching children to a dead
 * parent. This file does not close that; `B1-2` maps it to an envelope. What the check-in path does
 * today is quieter and in some ways worse: it answers `created: false`, which the action renders as
 * *"already logged"* — about a row that was deleted. Telling the four cases apart is the
 * prerequisite for `B1-2` saying so; nothing user-visible changes until then.
 *
 * **What it does NOT do:** resolve the catalog, or resolve the profile. Both stay with the caller,
 * exactly as `insertBodyweightEntry` has them — cached reads of immutable reference data, and an
 * ownership resolve the DAL already performs household-scoped through `isLiveProfile`. This writer
 * is handed an internal `profileId` it trusts, and its whole job is the insert and the honest
 * classification of what came back.
 */

/**
 * The practice day predicate: **the natural key of `PRACTICE_DAY_UNIQUE_INDEX`, as a reusable
 * conjunct** (V1-24 3b-0), the twin of `bodyweightSlot`. Here rather than in `single-value.ts`, which
 * imports `hide.ts`: 3b-life's clear and this writer's `day_taken` both read it, and a copy would be
 * free to drift from the index it mirrors.
 *
 * ⚠️ Like `bodyweightSlot`, it does **not** include `deleted_at IS NULL`. Callers add it: only a LIVE
 * row holds the day.
 */
export function practiceSlot(profileId: number, day: string) {
  return and(
    eq(schema.entries.profileId, profileId),
    eq(schema.entries.activityDate, day),
    eq(schema.entries.metricKey, METRIC_KEYS.practice_minutes),
  );
}

/**
 * What happened to ONE submitted check-in item.
 *
 * 🔴 **Five outcomes, because a non-insert has several meanings and the old boolean had one.** The
 * distinction that matters to a person is `own_hidden`: their own deleted row is holding this
 * `client_id`, so the write did not happen and **must never be reported as `ok`** (V1-9b criterion
 * 9). `B1-2` maps these to copy; this file only has to tell them apart.
 *
 * - `created` — the row was inserted. The only outcome that wrote anything.
 * - `replay` — this profile's own LIVE row already holds the id, **for the same metric and day**.
 *   Idempotent, and genuinely fine. (Pinned since 3b-0: an id reused under another metric or day is
 *   not this write, the hole `bodyweight.ts` closed for its own path.)
 * - `day_taken` — a practice, and another live practice already holds this athlete's day
 *   (`PRACTICE_DAY_UNIQUE_INDEX`, V1-24 3b-0). Nothing was written.
 * - `own_hidden` — this profile's own HIDDEN row holds the id. Not fine, not `ok`, not a twin.
 * - `conflict` — another profile's row holds the id, or this profile's live row holds it for another
 *   metric or day. A client-id collision, which should not happen with UUIDv7 and is therefore worth
 *   a distinct answer rather than a shrug.
 *
 * ⚠️ **The order is the contract** (plan 3b-0 Z4), proved in `verify/single-values.ts`: replay, then
 * `day_taken`, then `own_hidden`, then `conflict`. The day decides before `own_hidden`, as the
 * bodyweight writer's slot does: a hidden row holding the id cannot be restored into a day that is
 * held, so "the day is taken" is the true answer.
 */
export type CheckinWriteResult =
  | { clientId: string; outcome: 'created'; publicId: string }
  | { clientId: string; outcome: 'replay'; publicId: string }
  | { clientId: string; outcome: 'day_taken' }
  | { clientId: string; outcome: 'own_hidden' }
  | { clientId: string; outcome: 'conflict' };

/** One ready-to-insert check-in row: the catalog is resolved, the unit is the resolved row's. */
export type CheckinInsertValue = {
  publicId: string;
  clientId: string;
  activityDate: string;
  unit: string;
  /** Stringified for `numeric`; ALWAYS set — the shape CHECK requires it. */
  valueNum: string;
  activityTypeId: number;
  /** NULL for a bare habit → the "neither source" shape of the tagged-union CHECK. */
  metricKey: string | null;
  /** V1-7 timing (wake). `undefined` omits the column → NULL. */
  eventAt?: Date;
  status: string;
};

export async function writeCheckinEntries(
  exec: Executor,
  args: {
    /** INTERNAL id of a profile the caller has already resolved as LIVE and owned. */
    profileId: number;
    values: readonly CheckinInsertValue[];
  },
): Promise<CheckinWriteResult[]> {
  if (args.values.length === 0) return [];

  const inserted = await exec
    .insert(schema.entries)
    .values(args.values.map((v) => ({ ...v, profileId: args.profileId })))
    // ⚠️ READ COMMITTED autocommit only (`logCheckinEntries`): under REPEATABLE READ a target-less
    // DO NOTHING against a row the snapshot cannot see raises 40001 (write-path.md's caveats).
    // 🔴 **Target-less since V1-24 3b-0: EVERY unique index arbitrates**, the `client_id` one and
    // `PRACTICE_DAY_UNIQUE_INDEX` alike, so a second live practice on a day is skipped like a replay
    // instead of raising a bare `23505`. Target-less also skips PER ROW: a habit in the same batch
    // as a taken practice still inserts, where a `client_id` target would lose the whole statement
    // to the practice index. The cost is that a non-insert no longer says WHY; the classifier below
    // re-asks, in a fixed order. `bodyweight.ts` made the same trade at 1e. `write-path.md`
    // invariant 6.
    .onConflictDoNothing()
    .returning({ publicId: schema.entries.publicId, clientId: schema.entries.clientId });

  const createdByClientId = new Map(inserted.map((r) => [r.clientId, r.publicId]));

  // 🔴 **The re-select is over the client_ids that did NOT insert, and it is deliberately NOT
  // guarded by `deleted_at IS NULL`** — which is the opposite of `reselectLiveByClientId` in
  // `strength-session.ts`, for a reason worth stating so neither is "corrected" into the other.
  // That helper must return a LIVE parent or refuse, because it is about to attach children to the
  // row it returns. This one is a CLASSIFIER: a hidden row holding the id is precisely the answer
  // it exists to report, so filtering tombstones here would collapse `own_hidden` back into the
  // silence this file was written to remove.
  const unresolved = args.values
    .map((v) => v.clientId)
    .filter((clientId) => !createdByClientId.has(clientId));

  const holders =
    unresolved.length === 0
      ? []
      : await exec
          .select({
            clientId: schema.entries.clientId,
            publicId: schema.entries.publicId,
            profileId: schema.entries.profileId,
            metricKey: schema.entries.metricKey,
            activityDate: schema.entries.activityDate,
            deletedAt: schema.entries.deletedAt,
          })
          .from(schema.entries)
          .where(inArray(schema.entries.clientId, unresolved));

  const holderByClientId = new Map(holders.map((r) => [r.clientId, r]));

  // The days a LIVE practice already holds, for the unresolved practice items only. One query, not
  // one per item, built from `practiceSlot` so it is the index's own key (a submit carries one day,
  // so the `or` has one arm in practice).
  const practiceDays = [
    ...new Set(
      args.values
        .filter(
          (v) => !createdByClientId.has(v.clientId) && v.metricKey === METRIC_KEYS.practice_minutes,
        )
        .map((v) => v.activityDate),
    ),
  ];
  const takenDays = new Set(
    practiceDays.length === 0
      ? []
      : (
          await exec
            .select({ day: schema.entries.activityDate })
            .from(schema.entries)
            .where(
              and(
                or(...practiceDays.map((day) => practiceSlot(args.profileId, day))),
                isNull(schema.entries.deletedAt),
              ),
            )
        ).map((r) => r.day),
  );

  return args.values.map((v) => {
    const createdId = createdByClientId.get(v.clientId);
    if (createdId !== undefined) {
      return { clientId: v.clientId, outcome: 'created' as const, publicId: createdId };
    }

    const holder = holderByClientId.get(v.clientId);
    const own = holder !== undefined && holder.profileId === args.profileId;

    // 1 · replay: this profile's LIVE row holds the id, for the same metric and day.
    if (
      own &&
      holder.deletedAt === null &&
      holder.metricKey === v.metricKey &&
      holder.activityDate === v.activityDate
    ) {
      return { clientId: v.clientId, outcome: 'replay' as const, publicId: holder.publicId };
    }
    // 2 · day_taken: a practice whose day a live practice already holds.
    if (v.metricKey === METRIC_KEYS.practice_minutes && takenDays.has(v.activityDate)) {
      return { clientId: v.clientId, outcome: 'day_taken' as const };
    }
    // 3 · own_hidden: this profile's HIDDEN row holds the id, and the day is free.
    if (own && holder.deletedAt !== null) {
      return { clientId: v.clientId, outcome: 'own_hidden' as const };
    }
    // 4 · conflict: another profile's row holds the id, or this profile's live row holds it for
    //     another metric or day.
    if (holder !== undefined) {
      return { clientId: v.clientId, outcome: 'conflict' as const };
    }
    // No insert, no holder and no taken day. Two ways to get here, neither an outcome to invent:
    // - the insert collided on another unique (a reused `public_id`), which no app path sends;
    // - since 3b-0, a RACE: the live practice that skipped this insert was hidden before the
    //   held-day lookup ran (three autocommit statements, READ COMMITTED). Reachable since V1-24
    //   3b-life-a ships the practice clear; ACCEPTED, as bodyweight's twin is (`tech-debt.md`).
    // Either way, say so rather than guess — `reselectLiveByClientId`'s judgement about its own
    // impossible branch.
    throw new Error(`check-in client_id ${v.clientId} neither inserted nor held by any row`);
  });
}
