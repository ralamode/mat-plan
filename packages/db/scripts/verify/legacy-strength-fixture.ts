import {
  ENTRY_STATUS,
  LEGACY_SESSION_TYPES,
  newId,
  QUANTITY_SLOT,
  type SetStatus,
  type Unit,
} from '@mat-plan/shared';
import { eq } from 'drizzle-orm';

import { schema } from '../../src/client';
import type { Executor } from '../../src/writers/executor';
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
 * - **`sessions`, `supersets`, `entries`: direct inserts, frozen.** Each sets exactly the columns
 *   the old writer set (`insertStrengthSessionRow`, `insertSupersetRow`, `writeSessionStrengthEntry`),
 *   and omits the rest so Postgres applies its defaults, as that writer did. ⚠️ Do not "update" the
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
 * session with no workout (all of them). Superset members as the old writer stamped them.
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
  /** A superset member: the `clientId` of one of the session's `supersets`, and its order. */
  superset?: { clientId: string; order: number };
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
    day: string;
    activityTypeId: number;
    /** Omitted → `LEGACY_SESSION_TYPES[0]` (`strength`), what every legacy proof logged. */
    sessionType?: (typeof LEGACY_SESSION_TYPES)[number];
    sessionClientId?: string;
    dayRole?: string;
    feel?: string;
    supersets?: readonly { clientId: string; label?: string }[];
    movements: readonly LegacyStrengthMovement[];
  },
): Promise<LegacyStrengthFixture> {
  // A fixture, so no household check: the caller names a profile it made.
  const [profile] = await exec
    .select({ id: schema.profiles.id })
    .from(schema.profiles)
    .where(eq(schema.profiles.publicId, args.profilePublicId))
    .limit(1);
  if (!profile) throw new Error(`legacyStrengthFixture: no profile ${args.profilePublicId}`);

  const [session] = await exec
    .insert(schema.sessions)
    .values({
      publicId: newId(),
      clientId: args.sessionClientId ?? newId(),
      profileId: profile.id,
      activityDate: args.day,
      sessionType: args.sessionType ?? LEGACY_SESSION_TYPES[0],
      dayRole: args.dayRole ?? null,
      feel: args.feel ?? null,
    })
    .returning({ id: schema.sessions.id, publicId: schema.sessions.publicId });

  const supersetIdByClientId = new Map<string, number>();
  for (const s of args.supersets ?? []) {
    const [row] = await exec
      .insert(schema.supersets)
      .values({
        publicId: newId(),
        clientId: s.clientId,
        sessionId: session.id,
        label: s.label ?? null,
      })
      .returning({ id: schema.supersets.id });
    supersetIdByClientId.set(s.clientId, row.id);
  }

  const entries: LegacyStrengthFixture['entries'] = [];
  for (const m of args.movements) {
    const supersetId = m.superset ? supersetIdByClientId.get(m.superset.clientId) : undefined;
    if (m.superset && supersetId === undefined) {
      throw new Error(`legacyStrengthFixture: no superset ${m.superset.clientId} in this session`);
    }
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
        supersetId: supersetId ?? null,
        supersetOrder: m.superset?.order ?? null,
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
