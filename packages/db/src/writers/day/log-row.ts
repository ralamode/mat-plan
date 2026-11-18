import {
  entryUnitFor,
  fillRowValues,
  hasSetRows,
  newId,
  type RestoreReason,
  ROW_REFUSAL,
  type RowRefusal,
  type RowResult,
  type RowRetick,
  type RowUntick,
  type RowValues,
  type RowWrite,
  SESSION_TYPE,
  TRACKING_TYPE_FIELDS,
} from '@mat-plan/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { Schema } from '../../client';
import { schema } from '../../client';
import { prescriptionTerms } from '../../queries/day/prescription-terms';
import {
  programRowOf,
  programRowSlot,
  workoutSessionSlot,
  workoutSupersetSlot,
} from '../../queries/day/program-rows';
import { rowDayOpen } from '../../queries/day/day-window';
import { isOnProgramThatDay, isScheduledOn } from '../../queries/day/scheduled';
import type { HouseholdScope } from '../../scope';
import type { Executor } from '../executor';
import { hideEntries, restoreHidden } from '../hide';
import { athleteTemplateBlockIn, workoutIsLive } from '../ownership';
import { insertEntrySetRows } from '../session-rows';
import {
  type ById,
  fitsItsType,
  openProfile,
  refuse,
  rowItem,
  rowTransaction,
  storedValues,
} from './row-steps';

/**
 * FAM-1 step 11b — **the row writer**: a ✓ on any row of a program workout, for all seven tracking
 * types (`logRow`), and its un-tick and re-tick (`untickRow`, `retickRow`). The plan is
 * [fam-1-11b-row-writer.md](../../../../../docs/plans/fam-1-11b-row-writer.md) (§ The contract, in
 * order); the invariants are in [day-writers.md](../../../../../docs/features/day-writers.md).
 *
 * - **Every writer runs in ONE transaction and answers a typed `RowResult`.** An expected case is
 *   never thrown at the caller; an unexpected database error is. `retry` is never answered here: it
 *   is the client's answer to a transport failure.
 * - 🔴 **A refusal leaves by a sentinel throw** (`RowRefused`, the `ItemRefused` pattern of
 *   `writers/hide.ts`), caught at the transaction's edge. So a refusal reached after the first insert
 *   (the session) commits nothing that write began.
 * - **The check order is the contract**, and `db:verify` proves each step with its own mutation
 *   (`verify/day.ts`): profile → window → replay (pinned) → workout → prescription → movement →
 *   scheduled → on the program that day → set → values → writes.
 * - The caller supplies `today` (the athlete's active-timezone day) and the `workout_item` activity
 *   type id (resolved app-side, before the transaction), as SCALE-1 requires; nothing here reads a
 *   clock.
 */

// The named conjuncts (`programRowOf`, `workoutSessionSlot`, `workoutSupersetSlot`,
// `programRowSlot`) live in `queries/day/program-rows.ts` since 12a: a read does not import a writer.

// ── The shared steps ────────────────────────────────────────────────────────────────────────────────

/**
 * Steps 1 and 2, the same for all three writers: the profile, by `public_id` inside the scope
 * (`isLiveProfile`) → else `not_found`; archived → `closed_day` (its day page is read-only, as
 * `dayPageFlags` has it); a day outside the writable window (today and yesterday, never a day after
 * today, D32) → `closed_day`. Returns the profile's internal id.
 */
async function openRowDay(
  exec: Executor,
  args: { scope: HouseholdScope; today: string; profilePublicId: string; day: string },
): Promise<number> {
  const profile = await openProfile(exec, args);
  // Archived, or outside the window: the one rule the day resolver's `writable` reads too.
  if (!rowDayOpen(args.day, args.today, profile.archivedAt)) refuse(ROW_REFUSAL.closed_day);
  return profile.id;
}

/** Who holds a write's `client_id`, and whether it is THIS write. */
export type RowHolder =
  | { held: false }
  | { held: true; pinned: boolean; live: boolean; entryId: number; entryPublicId: string };

/**
 * **Is this `client_id` already held, and is the holder this write?** Step 3, and again after an
 * entry insert that did not insert.
 *
 * 🔴 **Unguarded on purpose** (the classifier pattern of `writers/checkin.ts`): a HIDDEN holder is
 * exactly the answer it exists to report (D18, `own_hidden`), so it must not filter tombstones.
 *
 * 🔴 **Pinned**: the holder is this write only if it is a program row of this profile on this day
 * (`programRowOf`), for this set, against this prescription, in a session of this workout. A
 * `client_id` reused for anything else answers `not_found`, never `ok` with another row's values.
 * `verify/day.ts` 3c–3h prove each condition with its own mutation, except the program-row
 * condition's `prescription_set IS NOT NULL`: `prescription_set = write.set` alone already makes it
 * non-null, so dropping it changes no answer (3d has no patch of its own).
 */
export async function classifyRowHolder(
  exec: Executor,
  profileId: number,
  write: RowWrite,
): Promise<RowHolder> {
  const [holder] = await exec
    .select({
      id: schema.entries.id,
      publicId: schema.entries.publicId,
      deletedAt: schema.entries.deletedAt,
      pinned: sql<boolean>`coalesce(${and(
        programRowOf(profileId, write.day),
        eq(schema.entries.prescriptionSet, write.set),
        eq(schema.prescriptions.publicId, write.prescriptionPublicId),
        eq(schema.workouts.publicId, write.workoutPublicId),
      )}, false)`,
    })
    .from(schema.entries)
    .leftJoin(schema.prescriptions, eq(schema.prescriptions.id, schema.entries.prescriptionId))
    .leftJoin(schema.sessions, eq(schema.sessions.id, schema.entries.sessionId))
    .leftJoin(schema.workouts, eq(schema.workouts.id, schema.sessions.workoutId))
    .where(eq(schema.entries.clientId, write.clientId))
    .limit(1);
  if (!holder) return { held: false };
  return {
    held: true,
    pinned: holder.pinned === true,
    live: holder.deletedAt === null,
    entryId: holder.id,
    entryPublicId: holder.publicId,
  };
}

/**
 * A held `client_id`'s answer: `ok` with what it stores, `own_hidden` (D18), or `not_found`.
 *
 * ⚠️ **The pin decides before liveness**: a HIDDEN row of another household holding the id answers
 * `not_found`, never `own_hidden`, which would say "your deleted row" about someone else's
 * (`verify/day.ts` 3i).
 */
async function answerHolder(
  exec: Executor,
  holder: Extract<RowHolder, { held: true }>,
): Promise<RowResult> {
  if (!holder.pinned) refuse(ROW_REFUSAL.not_found);
  if (!holder.live) refuse(ROW_REFUSAL.own_hidden);
  return {
    ok: true,
    entryPublicId: holder.entryPublicId,
    values: await storedValues(exec, holder.entryId),
  };
}

/** The workout `rowWorkout` found, and whether it and its block are live. */
export type RowWorkout = { id: number; blockId: number; name: string; live: boolean };

/**
 * Step 4: **the workout a write names (by `public_id`, or by internal id for Change), if this athlete
 * may log it** — a workout on a template block
 * of the scope AND of the profile's own household (`athleteTemplateBlockIn`: `templateBlockIn` ∧
 * `programBlockOfProfile`).
 * `null` for foreign, missing, and hidden-and-foreign alike: the scope is in the WHERE and liveness
 * is read off the row, so another household's hidden workout is never told apart from a missing one.
 *
 * Exported so `db:verify` proves the two household conjuncts apart, where profile and scope disagree
 * (`verify/day.ts` 4d, 4e).
 */
export async function rowWorkout(
  exec: Executor,
  profileId: number,
  scope: HouseholdScope,
  workout: ById,
): Promise<RowWorkout | null> {
  const [row] = await exec
    .select({
      id: schema.workouts.id,
      blockId: schema.workouts.blockId,
      name: schema.workouts.name,
      live: workoutIsLive(),
    })
    .from(schema.workouts)
    .innerJoin(schema.programBlocks, eq(schema.programBlocks.id, schema.workouts.blockId))
    .where(
      and(
        'publicId' in workout
          ? eq(schema.workouts.publicId, workout.publicId)
          : eq(schema.workouts.id, workout.id),
        athleteTemplateBlockIn(scope, profileId),
      ),
    )
    .limit(1);
  if (!row) return null;
  return { id: row.id, blockId: row.blockId, name: row.name, live: row.live === true };
}

/**
 * The one live row an insert-then-reselect must find, or a throw: a broken natural key (two live
 * rows, or none after the insert) fails whatever the row order, never by picking one.
 */
function exactlyOneLive<T extends { id: number }>(rows: readonly T[], what: string): T {
  if (rows.length !== 1) throw new Error(`expected one live ${what}, found ${rows.length}`);
  return rows[0];
}

// ── logRow ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * ✓ on a row: store it once, and answer with what was stored.
 *
 * `write` is parsed by `rowWriteSchema` in the action (12b). The steps, in order, are the plan's
 * (§ The contract, in order); each comment names its step.
 */
export async function logRow(
  db: NodePgDatabase<Schema>,
  args: {
    scope: HouseholdScope;
    /** The athlete's today, from the action; never computed here. */
    today: string;
    /** `ACTIVITY_TYPE_KEYS.workout_item`, resolved app-side before the transaction. */
    activityTypeId: number;
    write: RowWrite;
  },
): Promise<RowResult> {
  const { scope, write } = args;
  return rowTransaction(db, async (tx) => {
    // 1 · 2 — the profile, archived, and the window.
    const profileId = await openRowDay(tx, {
      scope,
      today: args.today,
      profilePublicId: write.profilePublicId,
      day: write.day,
    });

    // 3 — a replay, pinned. Before the program checks, so a replay answers as the first call did
    //     after the program changed.
    const earlier = await classifyRowHolder(tx, profileId, write);
    if (earlier.held) return answerHolder(tx, earlier);

    // 4 — the workout.
    const workout = await rowWorkout(tx, profileId, scope, { publicId: write.workoutPublicId });
    if (!workout) refuse(ROW_REFUSAL.not_found);
    if (!workout.live) refuse(ROW_REFUSAL.program_changed);

    // 5 · 6 — the prescription, IN this workout, and its movement (`rowItem`, shared with Change).
    const { prescription, quantities, movement, trackingType } = await rowItem(tx, scope, {
      prescription: { publicId: write.prescriptionPublicId },
      workoutId: workout.id,
    });

    // 7 — on the workout's week on this day.
    if (!(await isScheduledOn(tx, workout.blockId, workout.id, write.day))) {
      refuse(ROW_REFUSAL.not_scheduled);
    }

    // 8 — the athlete is on this program on this day (step 5's assignment) → else `program_changed`,
    //     which is how the fake answers a workout missing from the athlete's day.
    if (!(await isOnProgramThatDay(tx, profileId, workout.blockId, write.day))) {
      refuse(ROW_REFUSAL.program_changed);
    }

    // 9 — a set past 1 only on a type with set rows.
    if (write.set > 1 && !hasSetRows(trackingType)) refuse(ROW_REFUSAL.bad_value);

    // 10 — the values: the prescription fits its type, then the one fill rule.
    if (!fitsItsType(trackingType, quantities)) refuse(ROW_REFUSAL.bad_value);
    const fields = TRACKING_TYPE_FIELDS[trackingType];
    // The unit, target and text: `prescriptionTerms` (E5), the one function the day resolver's
    // heading also reads, so the snapshot below and the page cannot diverge.
    const { unit, target, text } = prescriptionTerms({
      trackingType,
      sets: prescription.sets,
      targetReps: prescription.targetReps,
      quantities,
    });
    const values = fillRowValues({ trackingType, unit }, write.values, target);
    if (!values) refuse(ROW_REFUSAL.bad_value);

    // 11 — the writes. The session: one live per (profile, day, workout), arbitrated by
    //      `SESSION_WORKOUT_DAY_UNIQUE_INDEX`; the re-select must find exactly one.
    await tx
      .insert(schema.sessions)
      .values({
        publicId: newId(),
        clientId: newId(),
        profileId,
        activityDate: write.day,
        sessionType: SESSION_TYPE.workout,
        workoutId: workout.id,
        workoutName: workout.name,
        dayRole: null,
      })
      .onConflictDoNothing();
    const { id: sessionId } = exactlyOneLive(
      await tx
        .select({ id: schema.sessions.id })
        .from(schema.sessions)
        .where(
          and(
            workoutSessionSlot(profileId, write.day, workout.id),
            isNull(schema.sessions.deletedAt),
          ),
        ),
      `session for workout ${workout.id}`,
    );

    // The superset, when the prescription is in a group: one live per (session, group).
    let supersetId: number | null = null;
    if (prescription.supersetLabel !== null) {
      await tx
        .insert(schema.supersets)
        .values({
          publicId: newId(),
          clientId: newId(),
          sessionId,
          prescriptionGroup: prescription.supersetLabel,
        })
        .onConflictDoNothing();
      supersetId = exactlyOneLive(
        await tx
          .select({ id: schema.supersets.id })
          .from(schema.supersets)
          .where(
            and(
              workoutSupersetSlot(sessionId, prescription.supersetLabel),
              isNull(schema.supersets.deletedAt),
            ),
          ),
        'superset for a group',
      ).id;
    }

    // The entry. Bare `ON CONFLICT DO NOTHING`: the `client_id` and the row arbiter
    // (`ENTRY_PRESCRIPTION_SET_UNIQUE_INDEX`) both skip it, and the branch below asks which.
    const insertEntry = () =>
      tx
        .insert(schema.entries)
        .values({
          publicId: newId(),
          clientId: write.clientId,
          profileId,
          activityDate: write.day,
          unit: entryUnitFor(trackingType, unit),
          movementName: movement.name,
          activityTypeId: args.activityTypeId,
          movementId: prescription.movementId,
          sessionId,
          supersetId,
          supersetOrder: supersetId === null ? null : prescription.supersetOrder,
          prescriptionId: prescription.id,
          prescriptionSet: write.set,
          // What the row was logged against, frozen (D7). `''` is a real value (a Check) and stays
          // `''`. The quantities are the target's, so a range renders as the day page shows it.
          prescribedSnapshot: text,
        })
        .onConflictDoNothing()
        .returning({ id: schema.entries.id, publicId: schema.entries.publicId });
    let [entry] = await insertEntry();

    if (!entry) {
      // Nothing inserted. The `client_id` is held (a concurrent first call), or the set is.
      const holder = await classifyRowHolder(tx, profileId, write);
      if (holder.held) return answerHolder(tx, holder);
      const [taken] = await tx
        .select({ id: schema.entries.id })
        .from(schema.entries)
        .where(
          and(
            programRowSlot(sessionId, prescription.id, write.set),
            isNull(schema.entries.deletedAt),
          ),
        )
        .limit(1);
      if (taken) refuse(ROW_REFUSAL.slot_taken);
      // 🔴 **Neither held nor taken: retried ONCE** (lane S's #578 pattern). The insert and these
      // reads are separate statements, so the entry that held the set can be un-ticked or cleared by
      // another phone between them: nothing holds the set by the time it is read, and the same ✓
      // inserts on a second try. Every other cause of this miss conflicts again, and still throws.
      [entry] = await insertEntry();
      if (!entry) {
        throw new Error(
          `row client_id ${write.clientId} neither inserted nor held, and its set is free`,
        );
      }
    }

    // The set row: one per ✓ (D3).
    await insertEntrySetRows(tx, { entryId: entry.id, sets: [values] });

    // 12 — answered from the stored row, read the one way a replay reads it: `numeric(8,3)` rounds
    //      (40.12345 is stored 40.123), so `values` itself would differ from the replay's answer.
    return { ok: true, entryPublicId: entry.publicId, values: await storedValues(tx, entry.id) };
  });
}

// ── untickRow ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Un-tick: hide a logged program row through `hideEntries`, and answer with its token. Un-ticking a
 * row already hidden answers its existing token (`hideEntries` reads it the one way).
 */
export async function untickRow(
  db: NodePgDatabase<Schema>,
  args: { scope: HouseholdScope; today: string; input: RowUntick },
): Promise<RowResult> {
  const { scope, input } = args;
  return rowTransaction(db, async (tx) => {
    // 1 · 2
    const profileId = await openRowDay(tx, {
      scope,
      today: args.today,
      profilePublicId: input.profilePublicId,
      day: input.day,
    });

    // 3 — a program row of this athlete on this day, live or hidden.
    const [entry] = await tx
      .select({
        id: schema.entries.id,
        deletedAt: schema.entries.deletedAt,
        workoutId: schema.workouts.id,
        blockId: schema.workouts.blockId,
      })
      .from(schema.entries)
      .leftJoin(schema.sessions, eq(schema.sessions.id, schema.entries.sessionId))
      .leftJoin(schema.workouts, eq(schema.workouts.id, schema.sessions.workoutId))
      .where(
        and(eq(schema.entries.publicId, input.entryPublicId), programRowOf(profileId, input.day)),
      )
      .limit(1);
    if (!entry) refuse(ROW_REFUSAL.not_found);

    // 4 — a live row whose workout left the week that day (or was purged) is not un-ticked.
    if (entry.deletedAt === null) {
      const scheduled =
        entry.workoutId !== null &&
        entry.blockId !== null &&
        (await isScheduledOn(tx, entry.blockId, entry.workoutId, input.day));
      if (!scheduled) refuse(ROW_REFUSAL.not_scheduled);
    }

    // 5 — the hide, then the numbers it hid. Read AFTER `hideEntries` takes the entry's lock, so an
    //     un-tick racing a Change (11c-i) answers the numbers it actually hid, which are what a
    //     re-tick brings back.
    const hidden = await hideEntries(tx, {
      profilePublicId: input.profilePublicId,
      scope,
      day: input.day,
      entryPublicIds: [input.entryPublicId],
    });
    if ('notFound' in hidden) refuse(ROW_REFUSAL.not_found);
    const values = await storedValues(tx, entry.id);
    return { ok: true, entryPublicId: input.entryPublicId, values, hiddenAt: hidden.hiddenAt };
  });
}

// ── retickRow ───────────────────────────────────────────────────────────────────────────────────────

/**
 * A restore's answer as a row's. A `Record` over every `RestoreReason`, so a new restore reason is a
 * compile error here rather than a silent `ok`. `null` is `ok`.
 */
const RETICK_REFUSAL: Record<RestoreReason, RowRefusal | null> = {
  ok: null,
  slot_taken: ROW_REFUSAL.slot_taken,
  changed: ROW_REFUSAL.not_found,
  not_found: ROW_REFUSAL.not_found,
};

/**
 * Re-tick in the same page visit: restore the row hidden under `hiddenAt`, through `restoreHidden`.
 *
 * It does not check the schedule, unlike `untickRow`, matching the fake: a re-tick only puts back
 * what was there a moment before.
 */
export async function retickRow(
  db: NodePgDatabase<Schema>,
  args: { scope: HouseholdScope; today: string; input: RowRetick },
): Promise<RowResult> {
  const { scope, input } = args;
  return rowTransaction(db, async (tx) => {
    // 1 · 2
    const profileId = await openRowDay(tx, {
      scope,
      today: args.today,
      profilePublicId: input.profilePublicId,
      day: input.day,
    });

    // 3 — a program row, so a hidden weigh-in is never restored through the row action.
    const [entry] = await tx
      .select({ id: schema.entries.id })
      .from(schema.entries)
      .where(
        and(eq(schema.entries.publicId, input.entryPublicId), programRowOf(profileId, input.day)),
      )
      .limit(1);
    if (!entry) refuse(ROW_REFUSAL.not_found);

    // 4 — the restore. A set ticked again meanwhile hits the row arbiter: `slot_taken`
    //     (`hide.ts` → `RESTORE_SLOT_INDEXES`).
    const [restored] = await restoreHidden(tx, {
      profilePublicId: input.profilePublicId,
      scope,
      day: input.day,
      hiddenAt: input.hiddenAt,
      entryPublicIds: [input.entryPublicId],
    });
    const refusal = RETICK_REFUSAL[restored.reason];
    if (refusal !== null) refuse(refusal);
    return {
      ok: true,
      entryPublicId: input.entryPublicId,
      values: await storedValues(tx, entry.id),
    };
  });
}
