import {
  ENTRY_STATUS,
  LEGACY_SESSION_TYPES,
  newId,
  QUANTITY_SLOT,
  type SetStatus,
  type Unit,
} from '@mat-plan/shared';
import { and, eq } from 'drizzle-orm';

import { schema } from '../../src/client';
import type { HouseholdScope } from '../../src/scope';
import type { Executor } from '../../src/writers/executor';
import { isLiveProfile, movementIsAvailableTo } from '../../src/writers/ownership';
import { insertEntrySetRows } from '../../src/writers/session-rows';

/**
 * **Rows written before LEGACY-1**: a strength session as the old strength writer
 * (`writeStrengthSession`, retired by LEGACY-1) left it in the database, for the `db:verify` proofs
 * that read such rows. Plan: `docs/plans/legacy-1-retire-strength-path.md` → "The legacy-row builder".
 *
 * Production still holds these rows and the export still reads them, so the proofs over them stay
 * after the writer goes. This builder is how they get their rows: it is a FIXTURE, never a writer.
 *
 * ## What is frozen, and what is live
 *
 * - **`sessions` and `entries`: direct inserts, frozen.** Each sets exactly the columns the old
 *   writer set (`insertStrengthSessionRow`, `writeSessionStrengthEntry`), and omits the rest so Postgres applies its defaults, as that writer did. ⚠️ Do not "update" the
 *   lists to what a live writer writes today: what they describe is history.
 *   - No `workout_id` or `workout_name` (every legacy session has no workout), no
 *     `prescription_id` or `prescription_set` (no legacy entry is a program row).
 *   - `kind` and `metric_key` unset: the decoupled strength shape, `movement_id` + `movement_name`.
 *   - `status` and `prescribed_snapshot` are omitted when the caller says nothing. An omitted
 *     snapshot is NULL ("never snapshotted"); `''` is a real value and is written as `''`.
 * - **`entry_sets` and `entry_set_quantities`: the live `insertEntrySetRows`**, as
 *   `verify/day-plan.ts`'s seeder writes them. A set's `weight` becomes its one PRIMARY quantity in
 *   the movement's unit, and a set without one (bodyweight, a band) has none: the old writer's
 *   mapping.
 * - **No `ON CONFLICT`.** The old writer's replay handling is not a property of the rows; a proof
 *   that needs a replay uses a live writer.
 *
 * ## The shapes it can write
 *
 * A NULL snapshot (omit `prescribedSnapshot`), a `''` one, a skipped movement with zero sets
 * (`status: ENTRY_STATUS.skipped, sets: []`), a multi-set entry, a session with a `dayRole`, and a
 * session with no workout (all of them). Only these: no superset, no `feel`, one session type.
 *
 * ## Household correctness, through the live predicates
 *
 * The caller passes the `scope` of the profile's household (never minted here). The profile is
 * resolved with `isLiveProfile(profilePublicId, scope)` and every movement checked with
 * `movementIsAvailableTo(scope)`, as the writers do, so a fixture can never plant a row no writer
 * could have written: another household's profile, or another household's movement. Either throws.
 *
 * 🔴 **Never an old built-in movement by slug or seed id.** A fixtures database holds none once the
 * old catalog leaves the seed, so a caller passes a movement it already holds: a test-library row or
 * one a household made. 🔴 **Never `logRow` in its place**: `logRow` writes none of these shapes,
 * and a fixture call through it would make every `log-row.ts` mutation fail on the wrong assertion.
 */

/** A set as the old writer took it: reps, an optional weight, its two modes and its status. */
export type LegacyStrengthSet = {
  reps: number;
  weight?: number | null;
  isBodyweight?: boolean;
  isBand?: boolean;
  status?: SetStatus;
};

/** One logged movement: an `entries` row and its sets. */
export type LegacyStrengthMovement = {
  movementId: number;
  movementName: string;
  /** The movement's unit: the entry's `unit` and every set's PRIMARY quantity unit. */
  unit: Unit;
  /** Minted when omitted. */
  clientId?: string;
  /** Omitted → the column default (`done`). */
  status?: typeof ENTRY_STATUS.done | typeof ENTRY_STATUS.skipped;
  /** Omitted → NULL. `''` is written as `''`. */
  prescribedSnapshot?: string;
  sets: readonly LegacyStrengthSet[];
};

export type LegacyStrengthFixture = {
  session: { id: number; publicId: string };
  /** In the order the movements were given. */
  entries: { id: number; publicId: string; clientId: string }[];
};

export async function legacyStrengthFixture(
  exec: Executor,
  args: {
    profilePublicId: string;
    /** The household the profile belongs to. Accepted, never minted. */
    scope: HouseholdScope;
    day: string;
    activityTypeId: number;
    sessionClientId?: string;
    dayRole?: string;
    movements: readonly LegacyStrengthMovement[];
  },
): Promise<LegacyStrengthFixture> {
  const [profile] = await exec
    .select({ id: schema.profiles.id })
    .from(schema.profiles)
    .where(isLiveProfile(args.profilePublicId, args.scope))
    .limit(1);
  if (!profile) {
    throw new Error(`legacyStrengthFixture: no live profile ${args.profilePublicId} in this scope`);
  }
  for (const m of args.movements) {
    const [available] = await exec
      .select({ id: schema.movements.id })
      .from(schema.movements)
      .where(and(eq(schema.movements.id, m.movementId), movementIsAvailableTo(args.scope)))
      .limit(1);
    if (!available) {
      throw new Error(
        `legacyStrengthFixture: movement ${m.movementId} is not available to this scope`,
      );
    }
  }

  const [session] = await exec
    .insert(schema.sessions)
    .values({
      publicId: newId(),
      clientId: args.sessionClientId ?? newId(),
      profileId: profile.id,
      activityDate: args.day,
      // The old writer took other session types and a `feel` too; no proof reads those values.
      sessionType: LEGACY_SESSION_TYPES[0],
      dayRole: args.dayRole ?? null,
      feel: null,
    })
    .returning({ id: schema.sessions.id, publicId: schema.sessions.publicId });

  const entries: LegacyStrengthFixture['entries'] = [];
  for (const m of args.movements) {
    const clientId = m.clientId ?? newId();
    const [entry] = await exec
      .insert(schema.entries)
      .values({
        publicId: newId(),
        clientId,
        profileId: profile.id,
        activityDate: args.day,
        unit: m.unit,
        movementName: m.movementName,
        activityTypeId: args.activityTypeId,
        movementId: m.movementId,
        sessionId: session.id,
        ...(m.status !== undefined ? { status: m.status } : {}),
        ...(m.prescribedSnapshot !== undefined ? { prescribedSnapshot: m.prescribedSnapshot } : {}),
        supersetId: null,
        supersetOrder: null,
      })
      .returning({ id: schema.entries.id, publicId: schema.entries.publicId });
    await insertEntrySetRows(exec, {
      entryId: entry.id,
      sets: m.sets.map(({ weight, ...set }) => ({
        ...set,
        quantities:
          weight === null || weight === undefined
            ? []
            : [{ slot: QUANTITY_SLOT.primary, unit: m.unit, value: weight }],
      })),
    });
    entries.push({ ...entry, clientId });
  }

  return { session, entries };
}
