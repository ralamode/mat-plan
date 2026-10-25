import assert from 'node:assert/strict';

import {
  ENTRY_STATUS,
  HOUSEHOLD_ROLE,
  MOVEMENT_SEED_PUBLIC_IDS,
  newId,
  SEED_METRIC_KEYS,
  type Unit,
} from '@mat-plan/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

import { SEED_FULL_ROUTINE, SEED_HOUSEHOLD_PUBLIC_ID } from '../../src/seed';
import type { Database } from '../../src/client';
// TEN-2c: the one definition of "a movement is REFERENCED", shared with `db:verify`,
// `runbooks.md` pre-flight (d) and (by requirement) TEN-2b-2's correction + TEN-2c-1's split.
import {
  crossHouseholdMovementRefs,
  sharedMovementRows,
} from '../../src/queries/movement-ownership';
import type { HouseholdScope } from '../../src/scope';
import * as schema from '../../src/schema';
import { householdScopeForScript } from '../../src/writers/household-scope-script';
import { inHousehold, insertHouseholdMember, isLiveProfile } from '../../src/writers/ownership';

/**
 * One guarded, idempotent correction to live data.
 *
 * `run` MUST be safe to call twice: every `WHERE` includes the value being corrected *from*, so a
 * second run matches nothing and reports 0. That is what makes `--apply` re-runnable after a partial
 * failure, and what stops a correction becoming a second, wrong write.
 */
export type Correction = {
  name: string;
  /** One line, in the past tense — what was wrong. */
  what: string;
  /** The backlog row that fixes the CAUSE. A correction treats data; the bug still needs a PR. */
  issue: string;
  /**
   * `'report'` — this entry **only reads**, with or without `--apply`, and its output is a census
   * rather than a list of pending writes. Absent means the ordinary thing: it writes under `--apply`.
   *
   * ⚠️ **It exists because `correct.ts` otherwise LIES about a reporter.** The runner prints
   * *"No matching rows — already corrected, or the guard did not match"* on an empty result, which for
   * a reporter is the **good** outcome reported as the wrong thing, and *"Re-run with --apply to write
   * them"* on a non-empty one, which a reporter can never do. One discriminator, three strings
   * branched — see `scripts/correct.ts`. (Added at TEN-2c, which brought the first reporter.)
   *
   * ⚠️ **Rules 2, 4, 5 and 7 below are VACUOUS for a reporter**, not merely satisfied: there is no
   * value being corrected *from*, no `updated_at` to touch, no resurrection to avoid and no write to
   * wrap in a transaction. Rules 1, 3, 6, 8, 9 and 10 all still bind, and rule 9 binds harder — a
   * census is output-only, so what it prints is the whole surface.
   */
  kind?: 'report';
  /** Returns a human-readable line per row it would change (dry run) or did change (`--apply`). */
  run: (db: Database, apply: boolean) => Promise<string[]>;
};

/**
 * The scope of a LIVE household named by its stable `public_id` — README rule 3 (never an internal
 * id from outside this database). `null` when this database has no such household, so each caller
 * decides what that means: a correction that cannot find its target must refuse, never guess.
 *
 * Extracted at its SECOND consumer, not speculatively (the `ownership.ts` rule): TEN-1 1b's scoped
 * `isLiveProfile` needs a NAMED household for a correction, which has no request to derive one
 * from, and `nullRoutineToFull` already resolved one this way. The lookup also carries
 * `deleted_at IS NULL`, which only makes it stricter — a soft-deleted household reports "not in
 * this database" instead of matching.
 *
 * ⚠️ **It returns the SCOPE, not the id** (TEN-1 1d, all three remaining predicates converted). A
 * correction now never holds a raw `household_id`, so ADR 0006's forward requirement 1 — the scope
 * stays a *capability* and is unwrapped in exactly one place (`ownership.ts` → `inHousehold`) —
 * holds in this script too, not only in the app. `householdScopeForScript` is the constructor
 * `packages/db/src/index.ts` deliberately does not re-export, so the app can never reach the one
 * that takes an id as an argument.
 */
async function liveHouseholdScope(db: Database, publicId: string): Promise<HouseholdScope | null> {
  const [row] = await db
    .select({ id: schema.households.id })
    .from(schema.households)
    .where(and(eq(schema.households.publicId, publicId), isNull(schema.households.deletedAt)))
    .limit(1);
  return row ? householdScopeForScript(row.id) : null;
}

/**
 * `liveHouseholdScope`, for a correction whose target household MUST be here: it throws rather than
 * returning `null`, so a correction that cannot find its household refuses instead of guessing.
 * Extracted at its second consumer (`kbSwingsLoadRepsSwap`, `bodyweightDuplicates`), which carried
 * the same refusal block word for word. `nullRoutineToFull` keeps the nullable form on purpose — a
 * database without the seeded household is "nothing to do" for it, not an error.
 */
async function requireLiveHouseholdScope(db: Database, publicId: string): Promise<HouseholdScope> {
  const scope = await liveHouseholdScope(db, publicId);
  if (scope === null) {
    throw new Error(`household ${publicId} is missing or soft-deleted here — wrong target?`);
  }
  return scope;
}

/**
 * 2026-09-28 — an athlete's KB swings were logged `20 × BW` when the session was **10 reps × 20 lb**,
 * five sets.
 *
 * Two app bugs produced it, both V1-24: the strength form offered a BW toggle on a movement the
 * catalog declares as loaded (`kb_swings` is seeded `isBodyweight: false, unitDefault: 'lb'`), and
 * `isEditableSet` refuses to edit a bodyweight set — which, with no delete action anywhere in the
 * app, made it **unrecoverable through the UI**. Hence a correction.
 *
 * The fix, per set: `reps 20 → 10`, clear `is_bodyweight`, and add the `primary` mass quantity of
 * 20 lb that should have been there. Note the quantity is an INSERT, not an update — a bodyweight set
 * has no quantity row at all, which is exactly why the read line said `20 × BW`.
 */
const kbSwingsLoadRepsSwap: Correction = {
  name: 'kb-swings-2026-09-28',
  what: '5 KB-swing sets logged `20 × BW`; they were `10 reps × 20 lb`',
  issue: 'V1-24',
  async run(db, apply) {
    const TARGET_PROFILE_PUBLIC_ID = '019826b4-0000-7000-8000-000000000001';
    const DAY = '2026-09-28';

    // TEN-1 1d: the owner half of this WHERE used to be a hand-typed
    // `eq(profiles.public_id, …) ∧ profiles.deleted_at IS NULL` — the last copy of the predicate in
    // this file. It is `isLiveProfile` now, which adds the household conjunct. That is STRICTLY
    // NARROWER than what shipped, and the narrowing is the point: a correction aimed at a profile
    // in some other household would be the worst version of this tool — an irreversible write to a
    // family that never reported a problem. The row set is unchanged, because this profile is in
    // the seeded household (and this correction was applied on 2026-09-30, so the `is_bodyweight`
    // guard already makes a re-run a no-op either way).
    const scope = await requireLiveHouseholdScope(db, SEED_HOUSEHOLD_PUBLIC_ID);

    // Target by (profile public_id, day, movement slug) — never an internal id, which differs
    // between environments. The `is_bodyweight` predicate is the GUARD: once corrected, it matches
    // nothing.
    const sets = await db
      .select({
        id: schema.entrySets.id,
        publicId: schema.entrySets.publicId,
        idx: schema.entrySets.idx,
        reps: schema.entrySets.reps,
      })
      .from(schema.entrySets)
      .innerJoin(schema.entries, eq(schema.entries.id, schema.entrySets.entryId))
      .innerJoin(schema.profiles, eq(schema.profiles.id, schema.entries.profileId))
      .innerJoin(schema.movements, eq(schema.movements.id, schema.entries.movementId))
      .where(
        and(
          isLiveProfile(TARGET_PROFILE_PUBLIC_ID, scope),
          eq(schema.entries.activityDate, DAY),
          eq(schema.movements.slug, 'kb_swings'),
          eq(schema.entrySets.isBodyweight, true), // ← the guard: already-fixed rows don't match
          isNull(schema.entrySets.deletedAt),
          isNull(schema.entries.deletedAt),
        ),
      )
      .orderBy(schema.entrySets.idx);

    const changes = sets.map(
      (s) => `set ${s.idx} (${s.publicId}): reps ${s.reps} → 10, BW → 20 lb primary`,
    );
    if (!apply || sets.length === 0) return changes;

    // One transaction: a set left half-corrected (reps fixed, still bodyweight, no quantity) is a
    // worse state than the bug — it would read `10 × BW` and look deliberate.
    await db.transaction(async (tx) => {
      for (const s of sets) {
        await tx
          .update(schema.entrySets)
          .set({ reps: 10, isBodyweight: false, updatedAt: sql`now()` })
          .where(eq(schema.entrySets.id, s.id));

        // INSERT, not update — a bodyweight set carries no quantity row at all.
        await tx.insert(schema.entrySetQuantities).values({
          clientId: crypto.randomUUID(),
          entrySetId: s.id,
          slot: 'primary',
          dimension: 'mass',
          unit: 'lb',
          valueNum: '20',
        });
      }
    });
    return changes;
  },
};

/**
 * 2026-09-30 — an athlete's weigh-in was logged **three times** on one day, and nothing in the app can
 * remove the two extra rows.
 *
 * The bug is V1-24 S1: `bodyweight-form.tsx` resets *and rotates the `client_id`* on success, while
 * `logBodyweight` dedupes on `client_id` alone — so a corrected typo writes a second row instead of
 * replacing the first. PR 1a closed that path through the UI; two concurrent mounts can still do it
 * until **1d**'s scoped unique index. Hence a correction: there is no delete action anywhere in the
 * app, so the extra rows are unreachable.
 *
 * **Which row survives is Ray's call, not this script's** (asked with all three values on screen,
 * 2026-09-30): the **12:17 morning weigh-in**. Two of the three rows hold the same value and the
 * 19:46 pair was six seconds apart, so the only thing that distinguishes them is time of day — which
 * for a bodyweight reading is the whole point.
 *
 * ## Why there is no value in the guard
 *
 * `.github/SECURITY.md` classifies kid bodyweight as privileged — *"never returned outside the
 * household operator, never logged"* — and this repo is **public**, so the from-value a guard would
 * normally carry (README rule 2) cannot be committed. The `updated_at` token does rule 2's job
 * instead: it is per-row, any write bumps it, and a mismatch means the row changed since the read.
 * `deleted_at IS NULL` is what makes a second run a no-op. See the plan's Decision 20.
 *
 * ⚠️ **The token is NOT the mechanism 1b's amend uses.** Decision 11 deleted that token — 1b guards
 * on the value, because a token crossing a DTO, a form field and drizzle's `Date` mapping loses the
 * microseconds Postgres stores. Here it is a literal cast in SQL (`::timestamptz`), so it never
 * round-trips through a `Date` and the precision survives.
 *
 * ⚠️ **Soft-deleting these rows frees their `client_id` slots.** `uq_entries_client_id` is partial
 * (`WHERE deleted_at IS NULL`), so a retried POST from a tab left open since 19:46 would no longer
 * conflict and would insert a *new* row — re-creating the duplicate 1d aborts on. That is why 1d is
 * gated on re-running the duplicate query just before it merges, not on this correction having run.
 *
 * (1d's index is slot-ready since the plan's 2026-09-30 amendment — `(profile_id, activity_date,
 * coalesce(context, 'morning'))` for V1-32, so a NULL context IS the default slot — which changes
 * nothing here: every row in prod today is slot-less.)
 */
// The profile id is a **literal and not `SEED_PROFILE_PUBLIC_ID`** on purpose: that const means "the
// profile the seed creates", while this is "the profile that owned these rows in prod on 2026-09-30".
// A correction is a frozen record and must not follow a symbol that could be re-pointed (Decision 21).
const DUP_TARGET_PROFILE_PUBLIC_ID = '019826b4-0000-7000-8000-000000000001';
const DUP_DAY = '2026-09-30';
const DUP_UNIT: Unit = 'lb';

/** One row as the read captured it: which row, and the token proving it has not moved since. */
type CapturedRow = { readonly publicId: string; readonly token: string };

// Deliberately NOT `as const`: literal types would make the assert below a tautology the compiler
// rejects (TS2367) — and an assertion that cannot fail is this repo's recurring failure mode.
const KEEPER: CapturedRow = {
  publicId: '01a0f23f-428e-720a-b704-41468c2ad38c',
  token: '2026-09-30 12:17:07.217351+00',
};

const LOSERS: readonly CapturedRow[] = [
  { publicId: '01a0f3db-08b6-75a6-b0c7-5195e090d5fe', token: '2026-09-30 19:46:53.241117+00' },
  { publicId: '01a0f3db-1f7a-75fd-9d67-a1c79cfac928', token: '2026-09-30 19:46:59.068208+00' },
];

// Free, and worth having: after Decision 20 dropped the value, a loser differs from the keeper by
// `public_id` and token alone, so a copy-paste slip would otherwise be invisible. Nothing
// typechecks `packages/db/scripts/**` (DX-7), so this is a runtime check on purpose.
assert(
  !LOSERS.some((l) => l.publicId === KEEPER.publicId),
  'a loser must never be the keeper — check the ids against the plan',
);

/** The shape pins every read and the UPDATE share, so they cannot drift into matching other rows. */
const bodyweightShapeOn = (day: string) =>
  and(
    eq(schema.entries.metricKey, SEED_METRIC_KEYS.bodyweight), // constant, never an argument
    eq(schema.entries.activityDate, day),
    eq(schema.entries.unit, DUP_UNIT),
    eq(schema.entries.status, ENTRY_STATUS.done),
    isNull(schema.entries.deletedAt),
  );

/** One loser's full guard: the shape pins + its own id + the token that says it has not moved. */
const loserGuard = (loser: { publicId: string; token: string }) =>
  and(
    eq(schema.entries.publicId, loser.publicId),
    sql`${schema.entries.updatedAt} = ${loser.token}::timestamptz`,
    bodyweightShapeOn(DUP_DAY),
  );

/**
 * Every live bodyweight row for one profile-day, whatever its unit, status or slot. Deliberately NOT
 * `bodyweightShapeOn`: the post-write invariant must count what 1d's index will govern, not what this
 * correction happens to target.
 *
 * ⚠️ **It is NOT 1d's predicate verbatim any more.** The plan's 2026-09-30 amendment made 1d
 * slot-ready for V1-32: the index keys on `(profile_id, activity_date, coalesce(context, 'morning'))`
 * — a NULL context and 'morning' are the SAME slot — so the general rule becomes one weigh-in per SLOT. That does not weaken this check — every row in prod today is
 * slot-less, this correction's day must end with exactly one weight either way, and counting without
 * `context` is the stricter of the two.
 */
const liveBodyweightOn = (profileId: number, day: string) =>
  and(
    eq(schema.entries.profileId, profileId),
    eq(schema.entries.activityDate, day),
    eq(schema.entries.metricKey, SEED_METRIC_KEYS.bodyweight),
    isNull(schema.entries.deletedAt),
  );

/** Rendered in UTC explicitly — `::text` renders in the SESSION zone, which differs on a laptop. */
const utc = (col: PgColumn, format: string) =>
  sql<string>`to_char(${col} at time zone 'UTC', ${format})`;

const bodyweightDuplicates: Correction = {
  name: 'bodyweight-duplicates-2026-09-30',
  what: '3 weigh-ins logged on one day; the 12:17 morning row is the one to keep',
  issue: 'V1-24',
  async run(db, apply) {
    // ── 1. the owner ────────────────────────────────────────────────────────────────────────────
    // `isLiveProfile` is THE live-profile predicate (V1-24 PR 1b, writers/ownership.ts), so this is
    // not a 12th hand-typed copy. The reuse lens asked for it when #192 was still open and the answer
    // was "not until it is on main"; #192 merged while this PR was in flight, so it is imported.
    //
    // TEN-1 1b: that predicate now REQUIRES a household scope, and a correction has no request to
    // derive one from — so it NAMES the household, resolved by `public_id` beside the profile. A
    // correction that matched a profile in some other household would be the worst possible version
    // of this tool: an irreversible write to a family that never reported a problem. The scope is
    // `householdScopeForScript`, which `packages/db/src/index.ts` deliberately does not re-export,
    // so the app can never reach the constructor that takes an id as an argument.
    const scope = await requireLiveHouseholdScope(db, SEED_HOUSEHOLD_PUBLIC_ID);
    const [profile] = await db
      .select({ id: schema.profiles.id })
      .from(schema.profiles)
      .where(isLiveProfile(DUP_TARGET_PROFILE_PUBLIC_ID, scope));

    if (!profile) {
      throw new Error(
        `profile ${DUP_TARGET_PROFILE_PUBLIC_ID} is missing or soft-deleted in this database — wrong target?`,
      );
    }

    // ── 2. the keeper, read LIVE, in both modes ─────────────────────────────────────────────────
    // The dry run is the only gate a human reads before an irreversible write, so it must report the
    // row as it is now rather than a constant from this file.
    const [keeper] = await db
      .select({
        value: schema.entries.valueNum,
        unit: schema.entries.unit,
        loggedAt: utc(schema.entries.createdAt, 'HH24:MI:SS'),
        amended: sql<boolean>`${schema.entries.updatedAt} <> ${KEEPER.token}::timestamptz`,
      })
      .from(schema.entries)
      .where(
        and(
          eq(schema.entries.publicId, KEEPER.publicId),
          eq(schema.entries.profileId, profile.id),
          eq(schema.entries.activityDate, DUP_DAY),
          eq(schema.entries.metricKey, SEED_METRIC_KEYS.bodyweight),
          isNull(schema.entries.deletedAt),
        ),
      );

    if (!keeper) {
      throw new Error(
        `the keeper ${KEEPER.publicId} is gone (soft-deleted, or never in this database). ` +
          `Deleting the other rows would leave ${DUP_DAY} with no weight at all, which is worse ` +
          `than the duplicate. Re-read the day before running this again.`,
      );
    }

    // The value is privileged (SECURITY.md) and this repo is public, so it is printed ONCE, on its own
    // marked line, and never inside the per-change lines — a pasted diff then carries no value.
    const keeping =
      `keeping ${KEEPER.publicId} (logged ${keeper.loggedAt} UTC` +
      `${keeper.amended ? ', amended since the read' : ''})`;

    // ── 3. classify every named loser ───────────────────────────────────────────────────────────
    const doomed: { publicId: string; token: string; loggedAt: string }[] = [];

    for (const loser of LOSERS) {
      const [matched] = await db
        .select({ loggedAt: utc(schema.entries.createdAt, 'HH24:MI:SS') })
        .from(schema.entries)
        .where(loserGuard(loser));

      if (matched) {
        doomed.push({ ...loser, loggedAt: matched.loggedAt });
        continue;
      }

      // No match: either it is already done, or something moved. Those are opposite situations and
      // `correct.ts` prints the same line for both, so the difference has to be made here.
      const [raw] = await db
        .select({ deleted: sql<boolean>`${schema.entries.deletedAt} is not null` })
        .from(schema.entries)
        .where(eq(schema.entries.publicId, loser.publicId));

      if (!raw) {
        throw new Error(
          `${loser.publicId} does not exist in this database — wrong target, or the wrong ids.`,
        );
      }
      if (raw.deleted) continue; // already corrected; a resumed run proceeds with the rest

      throw new Error(
        `${loser.publicId} is still live but no longer matches its guard — its updated_at or its ` +
          `shape has changed since the read. Nothing was written. Re-run the duplicate query and ` +
          `re-derive the ids before trying again.`,
      );
    }

    // ── 3b. the day's live count, in BOTH modes ────────────────────────────────────────────────
    // The dry run must check everything the apply checks, and the 0-change re-run is the proof the
    // runbook relies on: the day must hold exactly the keeper plus what is still to delete. A FOURTH
    // live row (logged after the read) is refused here instead of only at the apply's invariant.
    const [{ live: liveNow }] = await db
      .select({ live: sql<number>`count(*)::int` })
      .from(schema.entries)
      .where(liveBodyweightOn(profile.id, DUP_DAY));

    if (liveNow !== doomed.length + 1) {
      throw new Error(
        `${liveNow} live bodyweight rows on ${DUP_DAY}, expected ${doomed.length + 1} (the keeper + ` +
          `${doomed.length} still to delete). Another row was logged since the read. Nothing was ` +
          `written; re-run the duplicate query.`,
      );
    }

    if (doomed.length === 0) return [];

    console.log(`  keeper value (privileged, do not paste): ${keeper.value} ${keeper.unit}\n`);

    const changes = doomed.map(
      (l) => `soft-delete ${l.publicId} (logged ${l.loggedAt} UTC) — ${keeping}`,
    );
    if (!apply) return changes;

    // ── 4. one transaction ──────────────────────────────────────────────────────────────────────
    await db.transaction(async (tx) => {
      // `createDbPool` sets only connectionTimeoutMillis, so without these a blocked row lock waits
      // forever. A correction is DDL-adjacent ops work; AGENTS.md takes the same posture for DDL.
      await tx.execute(sql`set local lock_timeout = '5s'`);
      await tx.execute(sql`set local statement_timeout = '30s'`);

      // Re-check the keeper under a row lock. A plain SELECT takes no lock under READ COMMITTED, so
      // doing this inside the transaction narrows the window but does not close it — the lock does.
      const [locked] = await tx
        .select({ id: schema.entries.id })
        .from(schema.entries)
        .where(
          and(
            eq(schema.entries.publicId, KEEPER.publicId),
            eq(schema.entries.profileId, profile.id),
            eq(schema.entries.activityDate, DUP_DAY),
            eq(schema.entries.metricKey, SEED_METRIC_KEYS.bodyweight),
            isNull(schema.entries.deletedAt),
          ),
        )
        .for('update');

      if (!locked) {
        throw new Error(
          `the keeper ${KEEPER.publicId} was deleted while this ran — rolled back, nothing written.`,
        );
      }

      for (const loser of doomed) {
        const deleted = await tx
          .update(schema.entries)
          .set({ deletedAt: sql`now()`, updatedAt: sql`now()` }) // README rule 4
          .where(loserGuard(loser)) // the SAME guard the read used
          .returning({ publicId: schema.entries.publicId });

        if (deleted.length !== 1) {
          throw new Error(
            `expected to soft-delete exactly 1 row for ${loser.publicId}, matched ` +
              `${deleted.length} — rolled back, nothing written.`,
          );
        }
      }

      // The invariant 1d will enforce, asserted here while it can still be rolled back. This is the
      // only check that sees a FOURTH row logged after the read.
      const [{ live }] = await tx
        .select({ live: sql<number>`count(*)::int` })
        .from(schema.entries)
        .where(liveBodyweightOn(profile.id, DUP_DAY));

      if (live !== 1) {
        throw new Error(
          `${live} live bodyweight rows remain on ${DUP_DAY} after the deletes — expected exactly ` +
            `1. Another row was logged since the read. Rolled back; re-run the duplicate query.`,
        );
      }
    });

    return changes;
  },
};

/**
 * 2026-10-07 (ONB-0) — every live profile whose `routine_config` is **NULL** was riding the old
 * read-time default, which was the ENTIRE `ROUTINE_CATALOG`.
 *
 * ONB-0 narrowed that fallback to `['strength']`, so that a brand-new household stops inheriting this
 * household's ~17 controls (3 habits, 7 `brush_teeth` drill metrics, 4 calisthenics counters, 2 life
 * controls) as its first screen. For a NEW profile that is the fix. For a profile that already exists on
 * NULL it would be a silent regression: its Today would quietly lose the habits and every brush-teeth
 * control, with no data changed and nothing to point at. The app has no way to repair that — the routine
 * editor can re-author it, but nobody would know they had to.
 *
 * So this writes the pre-ONB-0 default EXPLICITLY onto those rows: same rendering as today, now stated in
 * the row instead of inherited from a default that is changing underneath it.
 *
 * **Run it BEFORE the deploy.** It writes the routine the current code already renders, so on today's
 * build it is a no-op from the household's point of view, and after the deploy nothing has moved. Run it
 * after and the household sees a narrowed Today in between.
 *
 * Idempotent by the guard rather than by a flag: `routine_config IS NULL` is the value being corrected
 * FROM (README rule 2), so a second run matches nothing and reports 0. `updated_at = now()` (rule 4),
 * `deleted_at IS NULL` (rule 5), one transaction (rule 7). Nothing it prints is privileged — a routine is
 * a list of activity keys, not a measurement (rule 8).
 *
 * ⚠️ **SCOPED TO THE SEEDED HOUSEHOLD, and that scope is the whole safety argument.** `IS NULL` alone is
 * idempotent per ROW but not per ERA. After ONB-0, leaving `routine_config` NULL is the *correct* thing
 * for a profile creator to do — it is how a profile asks for the neutral default. So once PROF-1 ships
 * athlete creation, an unscoped `IS NULL` would make any later `--apply` stamp this household's full
 * routine, `brush_teeth` and all, onto somebody else's brand-new athlete: a write with no delete action
 * and a URL-only editor behind it, i.e. exactly the unrecoverable class this system exists to repair
 * rather than cause. The household predicate makes the correction expire on its own.
 */
/** Exported for `verify.ts`, which runs this entry's dry run as its cross-household proof. */
export const NULL_ROUTINE_TO_FULL_NAME = 'null-routine-to-full-2026-10-07';

const nullRoutineToFull: Correction = {
  name: NULL_ROUTINE_TO_FULL_NAME,
  what: "the seeded household's NULL `routine_config` rode the whole-catalog default ONB-0 narrowed",
  issue: 'ONB-0 (which narrows what NULL MEANS; the NULL itself came from `seed.ts`)',
  async run(db, apply) {
    const changes: string[] = [];

    // The seeded household, resolved by its stable public_id — never an internal id (README rule 3).
    const scope = await liveHouseholdScope(db, SEED_HOUSEHOLD_PUBLIC_ID);

    if (scope === null) {
      return ['the seeded household is not in this database — nothing to do'];
    }

    // `IS NULL` is the per-row guard (once corrected, a row stops matching); the household predicate is
    // the per-era guard (see the ⚠️ above — this must never reach a PROF-1-created athlete elsewhere).
    //
    // TEN-1 1d: this read has **no `public_id` half** — it is the one bulk shape in this file, a
    // whole household's profiles — so it takes `inHousehold(scope)` rather than `isLiveProfile`,
    // which is the same split `seed.ts`'s `seedProgram` made in 1c (`inArray` where `isLiveProfile`
    // has `eq`). Identical SQL to the hand-written conjunct it replaces; the difference is that the
    // household half now comes from the one function allowed to unwrap the scope.
    const targets = await db
      .select({ publicId: schema.profiles.publicId, name: schema.profiles.name })
      .from(schema.profiles)
      .where(
        and(
          inHousehold(scope),
          isNull(schema.profiles.routineConfig),
          isNull(schema.profiles.deletedAt),
        ),
      );

    if (targets.length === 0) {
      return ['no live profile in the seeded household has routine_config = NULL — nothing to do'];
    }

    for (const t of targets) {
      // ⚠️ LOAD-BEARING: parsed by verify.ts — keep the `profile <uuid>` shape. Its cross-household
      // proof reads the public ids out of these dry-run lines with a regex.
      changes.push(
        `profile ${t.publicId} (${t.name}): routine_config NULL → the explicit pre-ONB-0 default ` +
          `(${SEED_FULL_ROUTINE.order.length} items)`,
      );
    }

    if (!apply) return changes;

    await db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '5s'`);
      await tx.execute(sql`set local statement_timeout = '30s'`);

      for (const t of targets) {
        const updated = await tx
          .update(schema.profiles)
          .set({ routineConfig: SEED_FULL_ROUTINE, updatedAt: sql`now()` }) // README rule 4
          .where(
            // The SAME guards the read used, now through the shared predicate (TEN-1 1d):
            // `isLiveProfile` IS `public_id ∧ deleted_at IS NULL ∧ household_id = scope`, so this
            // emits exactly the four conjuncts the hand-written version did.
            and(isLiveProfile(t.publicId, scope), isNull(schema.profiles.routineConfig)),
          )
          .returning({ publicId: schema.profiles.publicId });

        if (updated.length !== 1) {
          throw new Error(
            `expected to update exactly 1 row for ${t.publicId}, matched ${updated.length} — ` +
              `it was authored while this ran. Rolled back, nothing written; re-run the dry run.`,
          );
        }
      }
    });

    return changes;
  },
};

/**
 * 2026-10-11 (TEN-2c) — **a REPORT, not a correction: it never writes, with or without `--apply`.**
 *
 * TEN-2c drops the non-partial `movements_slug_unique`, which closes the 2b→2c cross-household
 * **denial** primitive completely and closes **nothing** of the pre-existing **read** leak: a row
 * already sitting at `household_id IS NULL` that is not a curated catalog row is still resolved by
 * global-first for every household. `TEN-2c-1` (the split backfill) is what closes that, and
 * `TEN-2d` runs the `VALIDATE` on `movements_global_row_has_pattern`.
 *
 * ⚠️ **Why it ships in TEN-2c rather than in the PR that consumes it.** The whole isolation argument
 * rests on a **dated** zero — `ten-2a`'s plan measured zero app-authored `movements` rows in
 * production on 2026-10-09 and wrote the expiry itself: *"the count is re-measured immediately before
 * the invite, because 'zero' is a dated fact, not an invariant."* A measurement taken **after** the
 * verdict flips is not evidence for it. So this runs against production **before TEN-2c merges**, its
 * counts go in the PR body, and a non-zero count is a merge blocker on TEN-2c.
 *
 * ⚠️ **DELIBERATELY UNSCOPED, and stated so the next reader does not "fix" it.** Every other entry in
 * this file is household-scoped, and the scope is the safety argument. This one must not be: the
 * question is precisely *"does any row cross a household boundary, and is the global namespace
 * exactly the curated catalog"*, and a `HouseholdScope` can only ever answer it for one side.
 * Scoping this would not make it safer; it would **blind** it. Everything it reads comes from
 * `src/queries/movement-ownership.ts`, the one definition of *referenced* that `TEN-2b-2` and
 * `TEN-2c-1` must also use.
 *
 * 🔴 **AGGREGATE COUNTS ONLY — no `slug`, no `name`, no `public_id`.** `registry.ts`'s own
 * `nullRoutineToFull` prints `profile <uuid> (<name>)`, and that is the precedent **not** to follow
 * here: `movements.name` is the one free-text box the privacy notice warns people may put a person's
 * name into, a `slug` is derived from it character for character, and these counts are pasted into a
 * PR body on a **public** repo (README rule 9). A count is enough to decide whether TEN-2c-1 has work
 * to do; naming the rows is the operator's job, at the console, when it does.
 */
export const MOVEMENTS_OWNERSHIP_REPORT_NAME = 'movements-ownership-2026-10-11';

const movementsOwnershipReport: Correction = {
  name: MOVEMENTS_OWNERSHIP_REPORT_NAME,
  kind: 'report',
  what: 'census of the movements rows TEN-2c does NOT fix — aggregate counts only, never a name or slug',
  issue: 'TEN-2c-1 (the split backfill) · TEN-2b-2 (the orphan removal) · TEN-2d (the VALIDATE)',
  async run(db) {
    // (1) The namespaces, by exact set membership in the curated catalog — never a slug test and
    // never a `public_id` PREFIX test. Both were tried in this arc and both were wrong: the seed list
    // has grown three times, and `SEED_PUBLIC_ID_PREFIX` is the GLOBAL seed namespace shared by every
    // seeded table, so a `movements` row carrying the household's own seed id would pass it.
    const rows = await db
      .select({
        id: schema.movements.id,
        publicId: schema.movements.publicId,
        householdId: schema.movements.householdId,
        pattern: schema.movements.pattern,
      })
      .from(schema.movements);
    const global = rows.filter((r) => r.householdId === null);
    const curated = global.filter((r) => MOVEMENT_SEED_PUBLIC_IDS.has(r.publicId));
    const residual = global.filter((r) => !MOVEMENT_SEED_PUBLIC_IDS.has(r.publicId));

    // (2) Who references the global rows — the shared definition, covering `entries` AND
    // `prescriptions`. `>= 1` household is TEN-2c-1's clone/split work; `0` is TEN-2b-2's orphan.
    const refsByMovementId = new Map(
      (await sharedMovementRows(db)).map((r) => [r.movementId, r.householdRefs]),
    );
    const residualShared = residual.filter((r) => (refsByMovementId.get(r.id) ?? 0) > 1);
    const residualSingle = residual.filter((r) => (refsByMovementId.get(r.id) ?? 0) === 1);
    const residualOrphan = residual.filter((r) => (refsByMovementId.get(r.id) ?? 0) === 0);

    // (3) `runbooks.md` pre-flight (d) — the count that must be zero before a household deletion.
    const crossRefs = await crossHouseholdMovementRefs(db);

    // (4) What `TEN-2d`'s `VALIDATE` will hit. `NOT VALID` scanned nothing, so TEN-2c cannot fail on
    // a pre-existing violation — it would wedge 2d with a `23514`, and `db:verify` cannot see it
    // because it never runs against production.
    const checkViolations = global.filter((r) => r.pattern === null);

    return [
      `movements rows: ${rows.length} total — ${global.length} global (household_id IS NULL), ${rows.length - global.length} household-owned`,
      `global rows: ${curated.length} curated (exact members of MOVEMENT_SEED_PUBLIC_IDS), ${residual.length} NOT curated`,
      `TEN-2c-1 input (the read leak's residual): ${residual.length} — of which ${residualShared.length} referenced by MORE THAN ONE household (clone + split), ${residualSingle.length} by exactly one (repoint), ${residualOrphan.length} referenced by NO household`,
      `TEN-2b-2 input (global, non-curated, unreferenced): ${residualOrphan.length}`,
      `runbooks.md pre-flight (d) — references crossing a household boundary: ${crossRefs.total} (${crossRefs.entries} entries, ${crossRefs.prescriptions} prescriptions)`,
      `TEN-2d blocker — global rows with pattern IS NULL (movements_global_row_has_pattern would reject on VALIDATE): ${checkViolations.length}`,
      'EXPECTED, every line: zero in every residual/blocker count. A non-zero count blocks TEN-2c’s merge (ten-2a measured zero on 2026-10-09, and a dated zero is not an invariant).',
    ];
  },
};

/**
 * AUTH-1 1b — bind the maintainer's Clerk account to their household, so 1c's resolver has something
 * to resolve. **This is the only writer of `household_members`.**
 *
 * ```
 * HOUSEHOLD_PUBLIC_ID=<uuid> CLERK_USER_ID=user_… \
 *   pnpm --filter @mat-plan/db db:correct household-claim-2026-10-25          # dry run
 * … --apply
 * ```
 *
 * **Both targets come from the ENVIRONMENT, not from a committed constant** (rule 3 forbids an
 * internal id; a committed Clerk id would also publish a named adult's account id in a public repo).
 *
 * ⚠️ **Why env and not `--household` / `--user` flags** _(maintainer, 2026-10-25)_. README **rule 8**
 * already assigns the flag to `PRIV-3` — _"a runner change, with its own plan"_ — and this is a
 * MIGRATION PR: a reviewer checking `0019`'s DDL should not also be reviewing argv parsing. There is
 * a second reason that runs the other way from the obvious one: a process's **command line is broadly
 * visible via `ps`, while its environment is readable only by its owner**, and the value here is a
 * stable third-party account id for a named adult (`data-inventory.md` §1a). So env is the quieter
 * channel, not merely the cheaper one.
 * 🔴 **`PRIV-3` converts this entry when it lands the flag**, so the repo does not keep two input
 * channels. Named here because that obligation is invisible from `PRIV-3`'s own row.
 *
 * **The guard is a READ-THEN-BRANCH, not `INSERT … WHERE NOT EXISTS`.** The single statement cannot
 * tell the two cases apart: "already claimed by me" (the idempotent re-run rule 2 wants) and "already
 * claimed by SOMEONE ELSE" (an operator error) would both be a silent 0-row no-op. And the uniqueness
 * is on `clerk_user_id`, not `household_id`, so the realistic second-run typo — same Clerk id, a
 * different household `public_id` — would sail past a `household_id` guard and die on a bare `23505`
 * mid-transaction instead of refusing cleanly.
 */
const householdClaim: Correction = {
  name: 'household-claim-2026-10-25',
  what: "no Clerk account was bound to the household, so 1c's resolver had nothing to resolve",
  issue: 'AUTH-1 1b',
  async run(db, apply) {
    const householdPublicId = process.env.HOUSEHOLD_PUBLIC_ID;
    const clerkUserId = process.env.CLERK_USER_ID;

    if (!householdPublicId || !clerkUserId) {
      throw new Error(
        'set HOUSEHOLD_PUBLIC_ID and CLERK_USER_ID in the environment — both are targets, and ' +
          'neither may be a committed constant (README rule 3; a Clerk id is personal data and this ' +
          'repo is public).',
      );
    }
    // ⚠️ Clerk instances are SEPARATE user pools: a development `user_…` is NOT the production id for
    // the same Google account. Claiming production with a dev id lands the maintainer in state C at
    // 1c — locked out of their own household by the chunk meant to bind them to it.
    assert.ok(
      clerkUserId.startsWith('user_'),
      `CLERK_USER_ID should look like 'user_…'; got '${clerkUserId}'. Read it from the dashboard of ` +
        'the instance that will be LIVE when the resolver reads it.',
    );

    const scope = await requireLiveHouseholdScope(db, householdPublicId);

    // ── the read, before any branch ──────────────────────────────────────────────────────────────
    const [existing] = await db
      .select({
        householdId: schema.householdMembers.householdId,
        publicId: schema.householdMembers.publicId,
      })
      .from(schema.householdMembers)
      .where(
        and(
          eq(schema.householdMembers.clerkUserId, clerkUserId),
          isNull(schema.householdMembers.deletedAt),
        ),
      );

    if (existing) {
      // Already bound HERE → idempotent no-op (rule 2). Already bound ELSEWHERE → refuse; this is an
      // operator error and the two must not read alike.
      const sameHousehold = await db
        .select({ id: schema.households.id })
        .from(schema.households)
        .where(
          and(
            eq(schema.households.publicId, householdPublicId),
            eq(schema.households.id, existing.householdId),
          ),
        );

      if (sameHousehold.length > 0) {
        return [
          `already claimed by this Clerk account (membership ${existing.publicId}) — no change`,
        ];
      }
      throw new Error(
        `that Clerk account is already bound to a DIFFERENT household (membership ` +
          `${existing.publicId}). Refusing rather than moving it: see docs/runbooks.md → the AUTH-1 ` +
          'checklist. Soft-delete the existing membership first if the move is intended.',
      );
    }

    // The FULL id is printed, and only locally: the dry run is the one gate a human reads before an
    // irreversible write, and a truncated id cannot be checked against the Clerk dashboard. It must
    // NOT reach the Applied table (rule 6 / rule 8's reasoning) — that is a public file.
    const line = `claim household ${householdPublicId} for ${clerkUserId} as ${HOUSEHOLD_ROLE.owner}`;
    if (!apply) return [line];

    await insertHouseholdMember(db, scope, {
      publicId: newId(),
      clerkUserId,
      role: HOUSEHOLD_ROLE.owner,
    });
    return [line];
  },
};

export const CORRECTIONS: readonly Correction[] = [
  kbSwingsLoadRepsSwap,
  bodyweightDuplicates,
  nullRoutineToFull,
  movementsOwnershipReport,
  householdClaim,
];
