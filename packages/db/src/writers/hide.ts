import { RESTORE_REASON, SEED_METRIC_KEYS, type RestoreReason } from '@mat-plan/shared';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

import { schema } from '../client';
import type { HouseholdScope } from '../scope';
import { BODYWEIGHT_DAY_UNIQUE_INDEX } from '../schema';
import { bodyweightSlot } from './bodyweight';
import type { Executor } from './executor';
import { isLiveProfile } from './ownership';

/**
 * V1-9b — **the only RUNTIME writer of `entries.deleted_at`** (ADR 0008 decision 3.3).
 *
 * ⚠️ "The only writer" would be false, and a privacy lens caught it: the bodyweight de-dup
 * correction (`scripts/corrections/registry.ts`) writes it too — as an operator action, and it has
 * run in production — and `screenshot-ephemeral.ts` does on a throwaway database. What is true, and
 * what makes "every reader is audited" a finite claim, is that nothing the APP can reach writes that
 * column except this module. 🔴 The consequence for `B1-3`: `hiddenEntriesForDay` cannot tell a
 * correction-hidden row from a person-hidden one, and production holds some of the former. See
 * [delete-and-restore.md](../../../../docs/features/delete-and-restore.md) invariant 1.
 *
 * A hide is a tombstone, not a deletion: the row stays, keeps its `client_id` (non-partial since B0)
 * and is restorable **indefinitely** — nothing purges a hidden row, and `PRIV-3`, which owns the
 * purge, has no plan yet.
 *
 * ## The event token is TEXT, and never a `Date`
 *
 * A hide event is `(profile, day, deleted_at)`. `deleted_at` is `timestamptz`, which Postgres stores
 * to **microseconds**, while a JavaScript `Date` holds **milliseconds** — so a token that passes
 * through drizzle's date mapping comes back rounded and compares unequal to the row it came from. The
 * repo has already paid for that trap (`registry.ts:209-212`). So:
 *
 * - the read emits `to_char(deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` — one
 *   fixed format, independent of the session `DateStyle`/`TimeZone` that `::text` would follow;
 * - the writer compares `deleted_at = $token::timestamptz`, a **bound parameter**, never `sql.raw`.
 *
 * ## One transaction, one `now()`
 *
 * `now()` is the transaction's start time, so every row hidden in one call shares one token — which
 * is what makes a folded row, a clear and a swap's hide each ONE event. `clock_timestamp()` would
 * give each statement its own and silently split an event in two. `db:verify` pins the difference.
 */

/** One `uuid[]`-shaped bound parameter, so a list of ids is one placeholder rather than N. */
const uuidArray = (ids: readonly string[]) => sql`${sql.param(ids)}::uuid[]`;

/**
 * `deleted_at`, rendered as the fixed-format UTC text a token is.
 *
 * ⚠️ Used for both the SELECT that produces a token and the UPDATE that returns one, so the two can
 * never disagree about the format.
 */
const hiddenAtText = sql<string>`to_char(${schema.entries.deletedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export type HideEntriesResult = { hiddenAt: string } | { notFound: true };

/**
 * Hide the named entries of one athlete on one day, as one event.
 *
 * 🔴 **All or nothing** (Decision 5). Every id must be an owned entry of that profile on that day —
 * live, or already hidden. One that is foreign, stale or on another day makes the whole call
 * `notFound`, and the caller rolls the transaction back: a partial hide would leave a row the person
 * cannot see and cannot restore as one event.
 *
 * **An already-hidden id is a replay**, not an error (Decision 6, state-keyed idempotency as the
 * shipped amends are). ⚠️ So the count below is of ids **found**, not of rows **updated** — the
 * `UPDATE` touches only the live ones, and a replay updates zero rows while still being `ok`. Reading
 * the update's row count as the answer is the obvious mistake here and would turn every replay into
 * `notFound`.
 */
export async function hideEntries(
  exec: Executor,
  args: {
    profilePublicId: string;
    scope: HouseholdScope;
    day: string;
    entryPublicIds: readonly string[];
  },
): Promise<HideEntriesResult> {
  // Ownership is `isLiveProfile` itself — an inner join to `profiles` plus its conjunct — never a
  // copy of them (the seam: a PUBLIC id from the request, resolved inside the scope). Matching on the day too is what makes a
  // wrong-day id indistinguishable from a foreign one, which is the single message Decision 5 wants.
  const owned = await exec
    .select({
      id: schema.entries.id,
      publicId: schema.entries.publicId,
      deletedAt: schema.entries.deletedAt,
    })
    .from(schema.entries)
    .innerJoin(schema.profiles, eq(schema.entries.profileId, schema.profiles.id))
    .where(
      and(
        isLiveProfile(args.profilePublicId, args.scope),
        eq(schema.entries.activityDate, args.day),
        sql`${schema.entries.publicId} = any(${uuidArray(args.entryPublicIds)})`,
      ),
    )
    // 🔴 **`FOR UPDATE`, and it is not defensive — without it a double tap THROWS.** Two concurrent
    // hides of the same ids both see them live, so neither takes the replay branch; the first
    // commits, and the second's `UPDATE … AND deleted_at IS NULL` matches **zero** rows under READ
    // COMMITTED. A review lens traced it. The lock makes the second transaction wait, re-read the
    // rows with their new `deleted_at`, and take the replay branch below — which is what Decision 6
    // says a replay is. `OF entries` so only entry rows lock, never `profiles`: locking a profile
    // would serialise every write for that athlete.
    .for('update', { of: schema.entries });

  if (owned.length !== args.entryPublicIds.length) return { notFound: true };

  // Internal ids of rows the SELECT above proved owned. Every later statement keys on these, never
  // on the request's public ids — see the UPDATE for why that matters.
  const ownedIds = owned.map((r) => r.id);

  // The token the owned rows already share, or `null` if they do not share one. Used by the
  // all-hidden branch and by the zero-row UPDATE below, which are the same situation reached two
  // ways: everything was already hidden when we looked, or it became so while we waited for the lock.
  const newestExistingToken = async (): Promise<string | null> => {
    const tokens = (
      await exec
        .select({ hiddenAt: hiddenAtText })
        .from(schema.entries)
        .where(and(inArray(schema.entries.id, ownedIds), isNotNull(schema.entries.deletedAt)))
    ).map((r) => r.hiddenAt);
    // 🔴 **The NEWEST, not "exactly one".** An earlier version demanded a single shared token and
    // returned `notFound` otherwise — which made a retry of a MIXED call fail after it had already
    // succeeded: hide [X, Y] where X was already hidden under T0 mints T1 for Y, and the retry then
    // sees {T0, T1} and refuses rows that exist, are owned, and are hidden. A correctness lens
    // traced it.
    //
    // ⚠️ **"Newest" is the latest transaction START, not provably "the event this call created."**
    // `now()` is the transaction clock, so a caller whose transaction began earlier but committed
    // later mints the OLDER token, and its retry then answers with the other caller's newer one.
    // That is still a success carrying a valid token, and the ids under the older event answer
    // `changed` on a restore — Decision 3's table — so the behaviour is right either way. The
    // precise claim is: a retry never refuses rows that exist, are owned and are hidden.
    //
    // Lexicographic order is chronological here because the format is fixed-width in every field
    // (`YYYY-MM-DD"T"HH24:MI:SS.US"Z"`, no `FM`), which the six-digit assertion in `db:verify` pins.
    return tokens.length === 0 ? null : tokens.sort()[tokens.length - 1];
  };

  const alreadyHidden = owned.filter((r) => r.deletedAt !== null);
  if (alreadyHidden.length === owned.length) {
    // A pure replay: every id is already hidden. Return the token they share, so the caller's
    // response is identical to the first call's. ⚠️ If they do NOT share one — a caller naming items
    // from two different events — that is `changed`, not a hide; restore is where that is settled,
    // and hiding again would mint a third event over rows that are already tombstoned.
    const token = await newestExistingToken();
    return token === null ? { notFound: true } : { hiddenAt: token };
  }

  // `now()`, never `clock_timestamp()` — one transaction, one event. `.returning` gives the token
  // back in the same fixed format the read uses, so the caller never formats it itself.
  // 🔴 **Keyed on INTERNAL ids of rows the SELECT already proved owned, never on the request's
  // public ids.** `ownership.ts` records the repo's convention — every guarded UPDATE proves parent
  // ownership rather than inheriting it from an earlier statement — and this was the first write
  // core to depart from it. It is not exploitable today (the all-or-nothing count refuses household
  // B before any UPDATE runs), which is exactly why it would be easy to break later: relax Decision
  // 5 to "hide what you can" and an unkeyed UPDATE becomes a cross-household write with no
  // in-statement check left.
  const updated = await exec
    .update(schema.entries)
    .set({ deletedAt: sql`now()` })
    .where(and(inArray(schema.entries.id, ownedIds), isNull(schema.entries.deletedAt)))
    .returning({ hiddenAt: hiddenAtText });

  const tokens = new Set(updated.map((r) => r.hiddenAt));

  // ⚠️ **Zero rows is a REPLAY, not a failure** — the earlier version threw here with a message
  // blaming `now()` for what was a locking gap.
  //
  // With the `FOR UPDATE` above this branch is in fact **unreachable**: a transaction that waited
  // re-reads the winner's committed version, so every already-hidden row is caught by the
  // all-hidden branch one statement earlier. It is kept as defence rather than deleted, because the
  // cost is one comparison and the failure it would otherwise produce is a throw on a successful
  // replay. A verification pass established the unreachability; the comment says so rather than
  // implying this is a live path.
  if (tokens.size === 0) {
    const token = await newestExistingToken();
    return token === null ? { notFound: true } : { hiddenAt: token };
  }

  // More than one token WOULD mean `now()` was not the transaction's clock. That is a contract
  // violation worth failing loudly rather than returning one of them arbitrarily.
  if (tokens.size > 1) {
    throw new Error(`hideEntries produced ${tokens.size} tokens in one transaction`);
  }
  return { hiddenAt: [...tokens][0] };
}

/** What happened to ONE item a restore named. `heldBy` is present only for `slot_taken`. */
export type RestoreItemResult = {
  entryPublicId: string;
  reason: RestoreReason;
  heldBy?: { entryPublicId: string; value: string | null; hiddenAt: string | null };
};

/**
 * Restore the items of one hide event, per item.
 *
 * Each item is processed **inside its own savepoint**, in Decision 8's order, so one item's refusal
 * never rolls back another's restore and a half-swap never commits:
 *
 * 1. Lock the item (`FOR UPDATE`), scoped to the owned profile and the day.
 * 2. If the item is already live, answer `ok` — a replay.
 * 3. If it is not hidden under **this** token, classify it (`changed` / `not_found`) and **never
 *    touch the holder**. This ordering is the decision: touching the holder first and then
 *    discovering the item moved would hide a live weigh-in for nothing.
 * 4. Only then, for a bodyweight item whose slot is taken: either refuse with `slot_taken`, or — if
 *    `keepInsteadOf` names that holder — hide the holder.
 * 5. Restore the item.
 */
export async function restoreHidden(
  exec: Executor,
  args: {
    profilePublicId: string;
    scope: HouseholdScope;
    day: string;
    hiddenAt: string;
    entryPublicIds: readonly string[];
    keepInsteadOf?: string;
  },
): Promise<RestoreItemResult[]> {
  const results: RestoreItemResult[] = [];

  // ⚠️ **Sorted, so two concurrent restores of the same items cannot deadlock.** Items are locked one
  // at a time and each lock is held to the outer commit, so `restoreHidden([A, C])` racing
  // `restoreHidden([C, A])` is a lock cycle and a `40P01`. The caller controls the order (every
  // action is a public endpoint), and the results are keyed by `entryPublicId`, so a fixed order is
  // free.
  for (const entryPublicId of [...args.entryPublicIds].sort()) {
    // 🔴 **One SAVEPOINT per item, and it is load-bearing for the swap.** A nested
    // `exec.transaction()` issues `SAVEPOINT` / `ROLLBACK TO SAVEPOINT`, so a non-`ok` answer undoes
    // whatever that item already did — specifically the holder's hide in step 4. Without this, a
    // swap whose restore then failed would commit a HIDDEN holder and a still-hidden item: the
    // person loses the weigh-in they kept as well as the one they were restoring. Returning the
    // result normally would commit it, so a refusal has to leave by `throw`.
    try {
      results.push(
        await exec.transaction(async (tx) => {
          const result = await restoreOne(tx, args, entryPublicId);
          if (result.reason !== RESTORE_REASON.ok) throw new ItemRefused(result);
          return result;
        }),
      );
    } catch (error) {
      if (error instanceof ItemRefused) {
        results.push(error.result);
        continue;
      }
      // 🔴 **The slot can be taken between the holder lookup and the restore, and the plan said so.**
      // `restoreOne` reads the holder without locking a row that may not exist yet, so another device
      // inserting a weigh-in for the same (profile, day, slot) in that window makes the restore's
      // `deleted_at = NULL` hit `BODYWEIGHT_DAY_UNIQUE_INDEX`. The savepoint has already rolled back,
      // so nothing is half-written — but rethrowing would lose every OTHER item's result in the same
      // call and surface as `error.tsx`. The plan's file table promised this mapping and the first
      // implementation silently dropped it; a db-safety lens and a correctness lens both caught it.
      //
      // ⚠️ **Verified by READING the drivers, not by a test.** The error shape was traced through
      // drizzle's `DrizzleQueryError` (`cause`), node-postgres' `DatabaseError` (`code`,
      // `constraint`) and PGlite's equivalent — all three carry what this matches. It has no
      // `db:verify` case because the race needs two connections and PGlite has one.
      if (isBodyweightSlotConflict(error)) {
        results.push({ entryPublicId, reason: RESTORE_REASON.slot_taken });
        continue;
      }
      throw error;
    }
  }

  return results;
}

/**
 * Did this error come from the day's weigh-in slot being taken while we were restoring into it?
 *
 * ⚠️ Narrow on purpose: it matches the ONE constraint whose violation has a meaningful answer. Any
 * other `23505` is a genuine surprise and keeps propagating, because turning every unique violation
 * into `slot_taken` would tell a person the wrong story about a bug.
 */
function isBodyweightSlotConflict(error: unknown): boolean {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  const { code, constraint } = (cause ?? {}) as { code?: string; constraint?: string };
  return code === '23505' && constraint === BODYWEIGHT_DAY_UNIQUE_INDEX;
}

/**
 * A refusal, thrown so the item's savepoint rolls back, then unwrapped by the loop.
 *
 * ⚠️ It is NOT an error condition — `slot_taken`, `changed` and `not_found` are answers the caller
 * renders. The throw is purely the mechanism that discards the item's partial work; anything that is
 * not an `ItemRefused` is a real failure and keeps propagating.
 */
class ItemRefused extends Error {
  constructor(readonly result: RestoreItemResult) {
    super(`restore refused: ${result.reason}`);
    this.name = 'ItemRefused';
  }
}

async function restoreOne(
  exec: Executor,
  args: Parameters<typeof restoreHidden>[1],
  entryPublicId: string,
): Promise<RestoreItemResult> {
  // Names every answer, `ok` included, so no branch builds the shape by hand.
  const answer = (reason: RestoreReason, heldBy?: RestoreItemResult['heldBy']) => ({
    entryPublicId,
    reason,
    ...(heldBy ? { heldBy } : {}),
  });

  // 1 · Lock the item, scoped. `FOR UPDATE` on the entries row only — the join to `profiles` is the
  //     ownership seam and locking a profile row would serialise every write for that athlete.
  const [item] = await exec
    .select({
      id: schema.entries.id,
      profileId: schema.entries.profileId,
      metricKey: schema.entries.metricKey,
      deletedAt: schema.entries.deletedAt,
      hiddenAt: hiddenAtText,
    })
    .from(schema.entries)
    .innerJoin(schema.profiles, eq(schema.entries.profileId, schema.profiles.id))
    .where(
      and(
        isLiveProfile(args.profilePublicId, args.scope),
        eq(schema.entries.activityDate, args.day),
        eq(schema.entries.publicId, entryPublicId),
      ),
    )
    .for('update', { of: schema.entries })
    .limit(1);

  // Not an owned entry of this athlete on this day — one answer for foreign, stale and wrong-day.
  if (!item) return answer(RESTORE_REASON.not_found);

  // 2 · Already live. A replay: one effect, identical response.
  if (item.deletedAt === null) return answer(RESTORE_REASON.ok);

  // 3 · Hidden, but under a different event. Something happened between the read and the tap, so the
  //     holder is NOT touched.
  if (item.hiddenAt !== args.hiddenAt) return answer(RESTORE_REASON.changed);

  // 4 · A weigh-in restoring into a day whose slot is now held by a live row.
  const isBodyweight = item.metricKey === SEED_METRIC_KEYS.bodyweight;
  if (isBodyweight) {
    const [holder] = await exec
      .select({
        id: schema.entries.id,
        publicId: schema.entries.publicId,
        value: schema.entries.valueNum,
      })
      .from(schema.entries)
      .where(and(bodyweightSlot(item.profileId, args.day), isNull(schema.entries.deletedAt)))
      .limit(1);

    if (holder) {
      // No "use this one instead" was asked for, or it names a different row than the one actually
      // holding the slot — refuse, and say who holds it so the screen can offer the swap.
      if (args.keepInsteadOf !== holder.publicId) {
        return answer(RESTORE_REASON.slot_taken, {
          entryPublicId: holder.publicId,
          value: holder.value,
          hiddenAt: null,
        });
      }

      // The swap. The holder must still be owned, in this slot, and LIVE — zero rows means it moved
      // under us, which is `changed` and rolls this item back.
      const hidden = await exec
        .update(schema.entries)
        .set({ deletedAt: sql`now()` })
        .where(
          and(
            eq(schema.entries.id, holder.id),
            bodyweightSlot(item.profileId, args.day),
            isNull(schema.entries.deletedAt),
          ),
        )
        .returning({ id: schema.entries.id });
      if (hidden.length !== 1) return answer(RESTORE_REASON.changed);
    }
  }

  // 5 · Restore, with the token repeated in the WHERE.
  //     ⚠️ **This is belt-and-braces, not the concurrency guard an earlier comment claimed.** The row
  //     has been locked since step 1 and was read after the lock, so a concurrent re-hide between
  //     there and here is impossible. It is kept because it is cheap and because it is the line
  //     `41-token-through-date.patch` mutates — the proof that the comparison is TEXT lives on it.
  const restored = await exec
    .update(schema.entries)
    .set({ deletedAt: null })
    .where(
      and(
        eq(schema.entries.id, item.id),
        isNotNull(schema.entries.deletedAt),
        sql`${schema.entries.deletedAt} = ${args.hiddenAt}::timestamptz`,
      ),
    )
    .returning({ id: schema.entries.id });

  if (restored.length !== 1) return answer(RESTORE_REASON.changed);
  return answer(RESTORE_REASON.ok);
}
