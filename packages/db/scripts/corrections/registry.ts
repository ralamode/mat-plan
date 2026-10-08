import assert from 'node:assert/strict';

import { ENTRY_STATUS, SEED_METRIC_KEYS, type Unit } from '@mat-plan/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

import { SEED_FULL_ROUTINE, SEED_HOUSEHOLD_PUBLIC_ID } from '../../src/seed';
import type { Database } from '../../src/client';
import * as schema from '../../src/schema';
import { householdScopeForScript } from '../../src/writers/household-scope-script';
import { isLiveProfile } from '../../src/writers/ownership';

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
  /** Returns a human-readable line per row it would change (dry run) or did change (`--apply`). */
  run: (db: Database, apply: boolean) => Promise<string[]>;
};

/**
 * The internal id of a LIVE household named by its stable `public_id` — README rule 3 (never an
 * internal id from outside this database). `null` when this database has no such household, so each
 * caller decides what that means: a correction that cannot find its target must refuse, never guess.
 *
 * Extracted at its SECOND consumer, not speculatively (the `ownership.ts` rule): TEN-1 1b's scoped
 * `isLiveProfile` needs a NAMED household for a correction, which has no request to derive one
 * from, and `nullRoutineToFull` already resolved one this way. The lookup also gains
 * `deleted_at IS NULL` here, which only makes it stricter — a soft-deleted household now reports
 * "not in this database" instead of matching.
 */
async function liveHouseholdId(db: Database, publicId: string): Promise<number | null> {
  const [row] = await db
    .select({ id: schema.households.id })
    .from(schema.households)
    .where(and(eq(schema.households.publicId, publicId), isNull(schema.households.deletedAt)))
    .limit(1);
  return row?.id ?? null;
}

/**
 * 2026-09-28 — Liam's KB swings were logged `20 × BW` when the session was **10 reps × 20 lb**,
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
const liamKbSwings: Correction = {
  name: 'liam-kb-swings-2026-09-28',
  what: '5 KB-swing sets logged `20 × BW`; they were `10 reps × 20 lb`',
  issue: 'V1-24',
  async run(db, apply) {
    const LIAM = '019826b4-0000-7000-8000-000000000001';
    const DAY = '2026-09-28';

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
          eq(schema.profiles.publicId, LIAM),
          eq(schema.entries.activityDate, DAY),
          eq(schema.movements.slug, 'kb_swings'),
          eq(schema.entrySets.isBodyweight, true), // ← the guard: already-fixed rows don't match
          isNull(schema.entrySets.deletedAt),
          isNull(schema.entries.deletedAt),
          isNull(schema.profiles.deletedAt),
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
 * 2026-09-30 — Liam's weigh-in was logged **three times** on one day, and nothing in the app can
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
const LIAM_PUBLIC_ID = '019826b4-0000-7000-8000-000000000001';
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

const liamBodyweightDuplicates: Correction = {
  name: 'liam-bodyweight-duplicates-2026-09-30',
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
    const scopedHouseholdId = await liveHouseholdId(db, SEED_HOUSEHOLD_PUBLIC_ID);
    if (scopedHouseholdId === null) {
      throw new Error(
        `household ${SEED_HOUSEHOLD_PUBLIC_ID} is missing or soft-deleted here — wrong target?`,
      );
    }
    const scope = householdScopeForScript(scopedHouseholdId);
    const [profile] = await db
      .select({ id: schema.profiles.id })
      .from(schema.profiles)
      .where(isLiveProfile(LIAM_PUBLIC_ID, scope));

    if (!profile) {
      throw new Error(
        `profile ${LIAM_PUBLIC_ID} is missing or soft-deleted in this database — wrong target?`,
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
const nullRoutineToFull: Correction = {
  name: 'null-routine-to-full-2026-10-07',
  what: "the seeded household's NULL `routine_config` rode the whole-catalog default ONB-0 narrowed",
  issue: 'ONB-0 (which narrows what NULL MEANS; the NULL itself came from `seed.ts`)',
  async run(db, apply) {
    const changes: string[] = [];

    // The seeded household, resolved by its stable public_id — never an internal id (README rule 3).
    const householdId = await liveHouseholdId(db, SEED_HOUSEHOLD_PUBLIC_ID);

    if (householdId === null) {
      return ['the seeded household is not in this database — nothing to do'];
    }

    // `IS NULL` is the per-row guard (once corrected, a row stops matching); the household predicate is
    // the per-era guard (see the ⚠️ above — this must never reach a PROF-1-created athlete elsewhere).
    const targets = await db
      .select({ publicId: schema.profiles.publicId, name: schema.profiles.name })
      .from(schema.profiles)
      .where(
        and(
          eq(schema.profiles.householdId, householdId),
          isNull(schema.profiles.routineConfig),
          isNull(schema.profiles.deletedAt),
        ),
      );

    if (targets.length === 0) {
      return ['no live profile in the seeded household has routine_config = NULL — nothing to do'];
    }

    for (const t of targets) {
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
            and(
              eq(schema.profiles.publicId, t.publicId),
              eq(schema.profiles.householdId, householdId), // the SAME guards the read used
              isNull(schema.profiles.routineConfig),
              isNull(schema.profiles.deletedAt),
            ),
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

export const CORRECTIONS: readonly Correction[] = [
  liamKbSwings,
  liamBodyweightDuplicates,
  nullRoutineToFull,
];
