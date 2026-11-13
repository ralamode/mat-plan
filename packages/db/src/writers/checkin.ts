import { inArray, isNull } from 'drizzle-orm';

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
 * What happened to ONE submitted check-in item.
 *
 * 🔴 **Four outcomes, because a non-insert has four meanings and the old boolean had one.** The
 * distinction that matters to a person is `own_hidden`: their own deleted row is holding this
 * `client_id`, so the write did not happen and **must never be reported as `ok`** (V1-9b criterion
 * 9). `B1-2` maps these to copy; this file only has to tell them apart.
 *
 * - `created` — the row was inserted. The only outcome that wrote anything.
 * - `replay` — this profile's own LIVE row already holds the id. Idempotent, and genuinely fine.
 * - `own_hidden` — this profile's own HIDDEN row holds the id. Not fine, not `ok`, not a twin.
 * - `conflict` — another profile's row holds the id. A client-id collision across profiles, which
 *   should not happen with UUIDv7 and is therefore worth a distinct answer rather than a shrug.
 */
export type CheckinWriteResult =
  | { clientId: string; outcome: 'created'; publicId: string }
  | { clientId: string; outcome: 'replay'; publicId: string }
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
    // ⚠️ The `client_id` UNIQUE is NON-partial since V1-9b B0; the predicate is kept here for
    // deploy-order safety (a supplied predicate still infers against a non-partial index, so the
    // index and the arbiter can change in either order). Do not tidy it — `write-path.md`
    // invariant 6.
    .onConflictDoNothing({
      target: schema.entries.clientId,
      where: isNull(schema.entries.deletedAt),
    })
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
            deletedAt: schema.entries.deletedAt,
          })
          .from(schema.entries)
          .where(inArray(schema.entries.clientId, unresolved));

  const holderByClientId = new Map(holders.map((r) => [r.clientId, r]));

  return args.values.map((v) => {
    const createdId = createdByClientId.get(v.clientId);
    if (createdId !== undefined) {
      return { clientId: v.clientId, outcome: 'created' as const, publicId: createdId };
    }

    const holder = holderByClientId.get(v.clientId);
    // No insert and no holder is not a shape the database can produce: the insert either wrote the
    // row or conflicted with one that exists. Rather than invent an outcome, say so — the same
    // judgement `reselectLiveByClientId` makes about its own impossible branch.
    if (!holder) {
      throw new Error(`check-in client_id ${v.clientId} neither inserted nor held by any row`);
    }
    if (holder.profileId !== args.profileId) {
      return { clientId: v.clientId, outcome: 'conflict' as const };
    }
    if (holder.deletedAt !== null) {
      return { clientId: v.clientId, outcome: 'own_hidden' as const };
    }
    return { clientId: v.clientId, outcome: 'replay' as const, publicId: holder.publicId };
  });
}
