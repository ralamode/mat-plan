import {
  ACTIVITY_TYPE_KEYS,
  BODYWEIGHT_UNITS,
  FREE_TEXT_NOTE_MAX,
  METRIC_KEYS,
  newId,
  ROUTINE_VERSION,
} from '@mat-plan/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// INTEGRATION TIER (see docs/definition-of-done.md → Test pyramid). These exercise
// the Server Actions end-to-end THROUGH their zod validation and typed-envelope
// contract down to the DAL boundary — the mandatory bad-body → zod-reject and
// happy-path + ownership cases — without a live Postgres. Mock the boundaries so
// the action runs as a plain async fn (AGENTS.md gotcha: Server Actions aren't
// HTTP routes — test the function, mock the DAL + cache). Real-DB coverage of the
// same write path lives in the Playwright smoke E2E (the `e2e` CI job, V0-11).
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// All three writers now resolve the active-tz today (getActiveLocalDay → cookies()) to bound
// the declared `day` ±1 (V1-6c). No `tz` cookie → DEFAULT_TIME_ZONE, so the harness's default
// `day` (localDayIso(DEFAULT_TIME_ZONE)) lands within bound. File-wide, not per-suite.
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock('@/lib/dal/entries', () => ({
  logBodyweight: vi.fn(async () => ({ id: 'entry-pub-id' })),
  logStrengthSession: vi.fn(async () => ({ sessionId: 'session-pub-id' })),
  // Default: the set was found + edited. The not-found test overrides to null.
  editStrengthSet: vi.fn(async () => ({ setId: 'set-pub-id' })),
  // V1-24 PR 1b. Default: the amend matched. The refusal tests override to null and then drive the
  // three-way branch through `ownedBodyweightValue`.
  editBodyweight: vi.fn(async () => ({ entryId: 'bw-pub-id' })),
  ownedBodyweightValue: vi.fn(async () => null),
  // Default: every item was written. Individual tests override for the conflict case.
  logCheckinEntries: vi.fn(async ({ items }: { items: { clientId: string }[] }) =>
    items.map((i) => ({ clientId: i.clientId, id: 'checkin-pub-id', created: true })),
  ),
}));
vi.mock('@/lib/dal/profiles', () => ({
  getProfileByPublicId: vi.fn(async () => ({
    id: PROFILE_ID,
    name: 'Liam',
    kind: 'kid',
    avatar: null,
    routine: { version: 1, order: [] },
  })),
  // Default: the routine was persisted. The not-found test overrides to null.
  updateProfileRoutine: vi.fn(async () => ({ id: PROFILE_ID })),
}));

import { CHECKIN_FIELDS, clientIdInputName, valueInputName } from '@/lib/checkins/checkin-fields';
import {
  editBodyweight,
  editStrengthSet,
  logBodyweight,
  logCheckinEntries,
  logStrengthSession,
  ownedBodyweightValue,
} from '@/lib/dal/entries';
import { getProfileByPublicId, updateProfileRoutine } from '@/lib/dal/profiles';
import { ROUTINE_CATALOG } from '@/lib/routine/catalog';
import { DEFAULT_TIME_ZONE } from '@/lib/constants';
import { isoDayDiff, localDayIso } from '@/lib/date';
import { DEFAULT_PRACTICE_MINUTES } from '@/lib/life/life-activities';
import { revalidatePath } from 'next/cache';

/** The day the harness declares by default — the active-tz today under the pinned default tz,
 *  so the ±1 bound accepts it. `offsetDays` builds a stale/near day for the bound tests. */
function localDay(offsetDays = 0): string {
  const base = localDayIso(DEFAULT_TIME_ZONE);
  if (offsetDays === 0) return base;
  const shifted = new Date(`${base}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + offsetDays);
  return shifted.toISOString().slice(0, 10);
}

import { AMEND_ERROR_COPY } from '@/lib/constants';
import { type ActionState } from './action-state';
import {
  editBodyweightAction,
  editRoutineAction,
  editStrengthSetAction,
  logBodyweightAction,
  logCheckinsAction,
  logLifeActivitiesAction,
  logStrengthSessionAction,
} from './actions';

// A valid tile-supplied public id (UUIDv7). The DAL re-validates it server-side;
// the action must thread it through to both the ownership check and revalidate path.
const PROFILE_ID = '019826b4-0000-7000-8000-000000000001';

const initial: ActionState = { ok: false, error: null };

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  // Default the declared `day` to the active-tz today (bodyweight/strength thread it now, V1-6c);
  // an explicit `day` in `fields` overrides. Boundary tests that omit other fields still reject at
  // zod BEFORE the day check, so a valid default day is harmless to them.
  const withDay: Record<string, string> = { day: localDay(), ...fields };
  for (const [k, v] of Object.entries(withDay)) fd.append(k, v);
  return fd;
}

beforeEach(() => vi.clearAllMocks());

describe('logBodyweightAction — boundary (bad body → zod-reject)', () => {
  it('rejects a non-numeric weight without touching the DAL', async () => {
    const res = await logBodyweightAction(
      initial,
      form({ profileId: PROFILE_ID, value: 'abc', unit: 'lb', clientId: newId() }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.value).toBeTruthy();
    expect(logBodyweight).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects a non-positive weight', async () => {
    const res = await logBodyweightAction(
      initial,
      form({ profileId: PROFILE_ID, value: '0', unit: 'lb', clientId: newId() }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.value).toBeTruthy();
    expect(logBodyweight).not.toHaveBeenCalled();
  });

  it('rejects a unit outside the allowed set', async () => {
    const res = await logBodyweightAction(
      initial,
      form({ profileId: PROFILE_ID, value: '180', unit: 'stone', clientId: newId() }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.unit).toBeTruthy();
    expect(logBodyweight).not.toHaveBeenCalled();
  });

  it('rejects a non-UUID clientId', async () => {
    const res = await logBodyweightAction(
      initial,
      form({ profileId: PROFILE_ID, value: '180', unit: 'lb', clientId: 'not-a-uuid' }),
    );
    expect(res.ok).toBe(false);
    expect(logBodyweight).not.toHaveBeenCalled();
  });

  it('rejects a missing profileId without touching the DAL', async () => {
    const res = await logBodyweightAction(
      initial,
      form({ value: '180', unit: 'lb', clientId: newId() }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.profileId).toBeTruthy();
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(logBodyweight).not.toHaveBeenCalled();
  });

  it('rejects a malformed (non-UUID) profileId', async () => {
    const res = await logBodyweightAction(
      initial,
      form({ profileId: 'not-a-uuid', value: '180', unit: 'lb', clientId: newId() }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.profileId).toBeTruthy();
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(logBodyweight).not.toHaveBeenCalled();
  });
});

describe('logBodyweightAction — happy path + ownership', () => {
  it('writes a valid entry via the DAL and revalidates the scoped Today', async () => {
    const clientId = newId();
    const res = await logBodyweightAction(
      initial,
      form({ profileId: PROFILE_ID, value: '182.5', unit: BODYWEIGHT_UNITS[0], clientId }),
    );
    expect(res.ok).toBe(true);
    expect(getProfileByPublicId).toHaveBeenCalledWith(PROFILE_ID);
    expect(logBodyweight).toHaveBeenCalledWith(
      expect.objectContaining({
        profilePublicId: PROFILE_ID,
        value: 182.5,
        unit: BODYWEIGHT_UNITS[0],
        clientId,
        day: localDay(), // the write lands on the day the page rendered (V1-6c)
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith(`/p/${PROFILE_ID}`);
  });

  it('fails gracefully (no write) when the profile is unknown', async () => {
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce(null);
    const res = await logBodyweightAction(
      initial,
      form({ profileId: PROFILE_ID, value: '180', unit: 'lb', clientId: newId() }),
    );
    expect(res.ok).toBe(false);
    expect(logBodyweight).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

// Builds strength-session FormData: the movement cards serialized into ONE hidden `movements` JSON
// field (V1-8-2), plus the session-level profileId/clientId/day. `sessionType` is deliberately never
// submitted (the schema default fires). `movementsRaw` injects a raw string for the malformed-JSON test.
function strengthForm(opts: {
  profileId?: string;
  clientId?: string;
  day?: string;
  feel?: string;
  dayRole?: string;
  movements?: Array<{
    movementName?: string;
    unit?: string;
    clientId?: string;
    status?: string;
    sets: Array<{ reps: string; weight: string }>;
  }>;
  movementsRaw?: string;
}): FormData {
  const fd = new FormData();
  if (opts.profileId !== undefined) fd.append('profileId', opts.profileId);
  fd.append('clientId', opts.clientId ?? newId());
  fd.append('day', opts.day ?? localDay());
  if (opts.feel !== undefined) fd.append('feel', opts.feel);
  if (opts.dayRole !== undefined) fd.append('dayRole', opts.dayRole);
  if (opts.movementsRaw !== undefined) {
    fd.append('movements', opts.movementsRaw);
  } else if (opts.movements !== undefined) {
    fd.append(
      'movements',
      JSON.stringify(
        opts.movements.map((m) => ({
          movementName: m.movementName ?? 'Back squat',
          unit: m.unit ?? BODYWEIGHT_UNITS[0],
          clientId: m.clientId ?? newId(),
          // Omitted unless the test sets it, so every existing case still exercises the
          // status-absent path that must default to `done` (GAP-1 P1-1a).
          ...(m.status !== undefined ? { status: m.status } : {}),
          sets: m.sets,
        })),
      ),
    );
  }
  return fd;
}

describe('logStrengthSessionAction — boundary (bad body → zod-reject)', () => {
  it('rejects a movement with a blank name without touching the DAL', async () => {
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        movements: [{ movementName: '', sets: [{ reps: '5', weight: '135' }] }],
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.movements).toBeTruthy();
    expect(logStrengthSession).not.toHaveBeenCalled();
  });

  it('rejects a movement with no sets', async () => {
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        movements: [{ movementName: 'Back squat', sets: [] }],
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.movements).toBeTruthy();
    expect(logStrengthSession).not.toHaveBeenCalled();
  });

  it('rejects an empty movements array (a session needs ≥1 movement)', async () => {
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({ profileId: PROFILE_ID, movements: [] }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.movements).toBeTruthy();
    expect(logStrengthSession).not.toHaveBeenCalled();
  });

  it('rejects a non-integer rep count', async () => {
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        movements: [{ movementName: 'Back squat', sets: [{ reps: '5.5', weight: '135' }] }],
      }),
    );
    expect(res.ok).toBe(false);
    expect(logStrengthSession).not.toHaveBeenCalled();
  });

  it('rejects a blank weight (must not coerce to 0)', async () => {
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        movements: [{ movementName: 'Back squat', sets: [{ reps: '5', weight: '' }] }],
      }),
    );
    expect(res.ok).toBe(false);
    expect(logStrengthSession).not.toHaveBeenCalled();
  });

  it('rejects two movements sharing a clientId (would silently drop one)', async () => {
    const dupId = '019826b4-0000-7000-8000-0000000000aa';
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        movements: [
          { movementName: 'Back squat', clientId: dupId, sets: [{ reps: '5', weight: '135' }] },
          { movementName: 'Bench press', clientId: dupId, sets: [{ reps: '8', weight: '95' }] },
        ],
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.movements).toBeTruthy();
    expect(logStrengthSession).not.toHaveBeenCalled();
  });

  it('rejects a malformed movements JSON body without touching the DAL', async () => {
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({ profileId: PROFILE_ID, movementsRaw: '{not valid json' }),
    );
    expect(res.ok).toBe(false);
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(logStrengthSession).not.toHaveBeenCalled();
  });

  it('rejects a crafted superset order without a superset id (bad body → zod-reject)', async () => {
    // `supersetOrder` rides in the forwarded movements JSON, so this reaches the schema — the pairing
    // superRefine must reject it as a typed envelope, not let it hit the DB CHECK as a raw 500 (V1-8-3c).
    const badMovements = JSON.stringify([
      {
        movementName: 'Back squat',
        unit: 'lb',
        clientId: newId(),
        sets: [{ reps: '5', weight: '135' }],
        supersetOrder: 5,
      },
    ]);
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({ profileId: PROFILE_ID, movementsRaw: badMovements }),
    );
    expect(res.ok).toBe(false);
    expect(logStrengthSession).not.toHaveBeenCalled();
  });

  it('rejects a missing profileId without touching the DAL', async () => {
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({
        movements: [{ movementName: 'Back squat', sets: [{ reps: '5', weight: '135' }] }],
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.profileId).toBeTruthy();
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(logStrengthSession).not.toHaveBeenCalled();
  });
});

describe('logStrengthSessionAction — happy path (multi-movement session)', () => {
  it('passes the parsed movements + defaulted sessionType to the DAL and revalidates', async () => {
    const clientId = newId();
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        clientId,
        movements: [
          {
            movementName: 'Back squat',
            sets: [
              { reps: '5', weight: '135' },
              { reps: '3', weight: '155' },
            ],
          },
          { movementName: 'Bench press', sets: [{ reps: '8', weight: '95' }] },
        ],
      }),
    );
    expect(res.ok).toBe(true);
    expect(getProfileByPublicId).toHaveBeenCalledWith(PROFILE_ID);
    expect(logStrengthSession).toHaveBeenCalledWith(
      expect.objectContaining({
        profilePublicId: PROFILE_ID,
        sessionType: 'strength', // the schema default (never submitted) — panel B3
        clientId,
        day: localDay(), // threaded from the rendered day (V1-6c)
        movements: [
          expect.objectContaining({
            movementName: 'Back squat',
            unit: BODYWEIGHT_UNITS[0],
            sets: [
              { reps: 5, weight: 135 }, // coerced to numbers by the schema
              { reps: 3, weight: 155 },
            ],
          }),
          expect.objectContaining({
            movementName: 'Bench press',
            sets: [{ reps: 8, weight: 95 }],
          }),
        ],
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith(`/p/${PROFILE_ID}`);
  });

  // GAP-1 P0-1 regression. `dayRole` was parsed and then DROPPED on the way to the DAL, so
  // `sessions.day_role` was never written from the app — the whole point of the column. Nothing
  // caught it: `LogStrengthSessionArgs.dayRole` is optional so `tsc` was clean, `db:verify` drives
  // the writer directly (bypassing this action), and the happy-path assertion above uses
  // `objectContaining`, which is BLIND to a key that is simply absent. Hence asserting the VALUE.
  it('threads the declared dayRole to the DAL (it was parsed but never forwarded)', async () => {
    await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        dayRole: 'strength_a',
        movements: [{ movementName: 'Back squat', sets: [{ reps: '5', weight: '135' }] }],
      }),
    );
    expect(vi.mocked(logStrengthSession).mock.calls[0]![0]).toMatchObject({
      dayRole: 'strength_a',
    });
  });

  it('sends dayRole: undefined when the day is not a programmed one', async () => {
    // The "Not a programmed day" option submits '', which `optionalDayRoleSchema` normalises to
    // undefined — it must NOT reach the DAL as '' and land in a CHECK-constrained column.
    await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        dayRole: '',
        movements: [{ movementName: 'Back squat', sets: [{ reps: '5', weight: '135' }] }],
      }),
    );
    expect(vi.mocked(logStrengthSession).mock.calls[0]![0].dayRole).toBeUndefined();
  });

  // GAP-1 P1-1a. The action forwards `parsed.data.movements` wholesale, so `status` threads itself —
  // but "it threads itself" is exactly the assumption that made #98's `dayRole` silently inert. Assert
  // the VALUE reaching the DAL, and via mock.calls rather than `objectContaining`, which cannot see a
  // field going missing. This test is the guard on that whole class of bug.
  it('threads a skipped movement (status + zero sets) through to the DAL', async () => {
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        movements: [
          { movementName: 'Bulgarian split squat', status: 'skipped', sets: [] },
          { movementName: 'Back squat', sets: [{ reps: '5', weight: '135' }] },
        ],
      }),
    );
    expect(res.ok).toBe(true);
    const arg = vi.mocked(logStrengthSession).mock.calls[0]![0];
    expect(arg.movements[0]).toMatchObject({ status: 'skipped', sets: [] });
    // The sibling still logs normally, and an omitted status defaults to `done` on the wire.
    expect(arg.movements[1]).toMatchObject({ status: 'done' });
    expect(arg.movements[1]!.sets).toHaveLength(1);
  });

  it('threads a session feel to the DAL', async () => {
    await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        feel: 'strong',
        movements: [{ movementName: 'Back squat', sets: [{ reps: '5', weight: '135' }] }],
      }),
    );
    expect(logStrengthSession).toHaveBeenCalledWith(expect.objectContaining({ feel: 'strong' }));
  });

  it('normalizes a blank/whitespace feel to undefined (stored NULL, not empty string)', async () => {
    await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        feel: '   ',
        movements: [{ movementName: 'Back squat', sets: [{ reps: '5', weight: '135' }] }],
      }),
    );
    expect(logStrengthSession).toHaveBeenCalledWith(expect.objectContaining({ feel: undefined }));
  });

  it('rejects an over-length feel from a direct POST (bad body → zod-reject)', async () => {
    // The client maxLength is bypassable; the schema `.max` is the real guard.
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        feel: 'x'.repeat(FREE_TEXT_NOTE_MAX + 1),
        movements: [{ movementName: 'Back squat', sets: [{ reps: '5', weight: '135' }] }],
      }),
    );
    expect(res.ok).toBe(false);
    expect(logStrengthSession).not.toHaveBeenCalled();
  });

  it('derives supersets from the tagged movements and threads them to the DAL (V1-8-3d)', async () => {
    const ss = newId();
    // Two movements tagged into one superset; the action derives `supersets: [{clientId: ss}]`.
    const raw = JSON.stringify([
      {
        movementName: 'Bench',
        unit: 'lb',
        clientId: newId(),
        sets: [{ reps: '8', weight: '40' }],
        supersetClientId: ss,
        supersetOrder: 1,
      },
      {
        movementName: 'OHP',
        unit: 'lb',
        clientId: newId(),
        sets: [{ reps: '8', weight: '30' }],
        supersetClientId: ss,
        supersetOrder: 2,
      },
    ]);
    await logStrengthSessionAction(
      initial,
      strengthForm({ profileId: PROFILE_ID, movementsRaw: raw }),
    );
    expect(logStrengthSession).toHaveBeenCalledWith(
      expect.objectContaining({
        supersets: [{ clientId: ss }],
        movements: expect.arrayContaining([
          expect.objectContaining({ supersetClientId: ss, supersetOrder: 1 }),
        ]),
      }),
    );
  });

  it('rejects a lone superset member (≥2) with a locatable superset error (V1-8-3d)', async () => {
    const ss = newId();
    const raw = JSON.stringify([
      {
        movementName: 'Bench',
        unit: 'lb',
        clientId: newId(),
        sets: [{ reps: '8', weight: '40' }],
        supersetClientId: ss,
        supersetOrder: 1,
      },
      {
        movementName: 'Squat',
        unit: 'lb',
        clientId: newId(),
        sets: [{ reps: '5', weight: '135' }],
      }, // standalone → ss has 1 member
    ]);
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({ profileId: PROFILE_ID, movementsRaw: raw }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.supersets).toBeTruthy(); // surfaced, not a locked banner
    expect(logStrengthSession).not.toHaveBeenCalled();
  });

  it('fails gracefully (no write) when the profile is unknown', async () => {
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce(null);
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        movements: [{ movementName: 'Back squat', sets: [{ reps: '5', weight: '135' }] }],
      }),
    );
    expect(res.ok).toBe(false);
    expect(logStrengthSession).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

// ── V1-5: check-ins / habits ────────────────────────────────────────────────────
//
// These drive REAL FormData objects on purpose. A checkbox submits the STRING "1",
// never the number 1 — a `z.literal(1)` validator would reject every checkbox and
// make the happy path unreachable, and a hand-built object fixture would hide it.

const HABIT = CHECKIN_FIELDS.find((f) => f.metricKey === null)!;
const BOOL_METRIC = CHECKIN_FIELDS.find((f) => f.valueType === 'bool')!;
const SCALE_METRIC = CHECKIN_FIELDS.find((f) => f.valueType === 'scale_10')!;

/** Build check-in FormData: one `v:`/`c:` pair per submitted field. */
function checkinForm(opts: {
  profileId?: string;
  day?: string;
  values?: Record<string, string>;
  clientIds?: Record<string, string>;
  extra?: Record<string, string>;
}): FormData {
  const fd = new FormData();
  if (opts.profileId !== undefined) fd.append('profileId', opts.profileId);
  fd.append('day', opts.day ?? localDay());
  for (const [key, value] of Object.entries(opts.values ?? {})) {
    fd.append(valueInputName(key), value);
    fd.append(clientIdInputName(key), opts.clientIds?.[key] ?? newId());
  }
  for (const [k, v] of Object.entries(opts.extra ?? {})) fd.append(k, v);
  return fd;
}

describe('logCheckinsAction — boundary (bad body → zod-reject)', () => {
  it('rejects a missing profileId without touching the DAL', async () => {
    const res = await logCheckinsAction(initial, checkinForm({ values: { [HABIT.key]: '1' } }));
    expect(res.ok).toBe(false);
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(logCheckinEntries).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects a malformed (non-UUID) profileId', async () => {
    const res = await logCheckinsAction(
      initial,
      checkinForm({ profileId: 'not-a-uuid', values: { [HABIT.key]: '1' } }),
    );
    expect(res.ok).toBe(false);
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });

  it('rejects an empty submission (nothing checked)', async () => {
    const res = await logCheckinsAction(initial, checkinForm({ profileId: PROFILE_ID }));
    expect(res.ok).toBe(false);
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });

  it('IGNORES an unknown field key — the action walks the registry, not the body', async () => {
    const res = await logCheckinsAction(
      initial,
      checkinForm({
        profileId: PROFILE_ID,
        values: { [HABIT.key]: '1' },
        extra: { 'v:evil_key': '1', 'c:evil_key': newId(), unit: 'lb', activityKey: 'sc_lift' },
      }),
    );
    expect(res.ok).toBe(true);
    const items = vi.mocked(logCheckinEntries).mock.calls[0]![0].items;
    expect(items).toHaveLength(1);
    expect(items[0]!.activityKey).toBe(HABIT.activityKey);
  });

  it('rejects a checkbox value other than "1"', async () => {
    const res = await logCheckinsAction(
      initial,
      checkinForm({ profileId: PROFILE_ID, values: { [HABIT.key]: '2' } }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.[HABIT.key]).toBeTruthy();
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });

  it.each(['0', '11', 'abc'])('rejects an out-of-range scale_10 value (%s)', async (bad) => {
    const res = await logCheckinsAction(
      initial,
      checkinForm({ profileId: PROFILE_ID, values: { [SCALE_METRIC.key]: bad } }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.[SCALE_METRIC.key]).toBeTruthy();
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });

  it('reports EVERY invalid field, not just the first', async () => {
    const res = await logCheckinsAction(
      initial,
      checkinForm({
        profileId: PROFILE_ID,
        values: { [HABIT.key]: '2', [SCALE_METRIC.key]: '99' },
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.[HABIT.key]).toBeTruthy();
    expect(res.fieldErrors?.[SCALE_METRIC.key]).toBeTruthy();
  });

  it('rejects a non-UUID clientId', async () => {
    const fd = checkinForm({ profileId: PROFILE_ID });
    fd.append(valueInputName(HABIT.key), '1');
    fd.append(clientIdInputName(HABIT.key), 'not-a-uuid');
    const res = await logCheckinsAction(initial, fd);
    expect(res.ok).toBe(false);
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });

  // todayIso() is UTC and check-ins are evening activities, so the form submits the day
  // it rendered; a day far from the server's today means a stale tab, not a valid log.
  it('rejects a stale day (more than ±1 from today)', async () => {
    const res = await logCheckinsAction(
      initial,
      checkinForm({ profileId: PROFILE_ID, day: '2020-01-01', values: { [HABIT.key]: '1' } }),
    );
    expect(res.ok).toBe(false);
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });
});

describe('logCheckinsAction — happy path + ownership', () => {
  it('parses the checkbox STRING "1" to numeric 1 and writes via the DAL', async () => {
    const clientId = newId();
    const res = await logCheckinsAction(
      initial,
      checkinForm({
        profileId: PROFILE_ID,
        values: { [HABIT.key]: '1' },
        clientIds: { [HABIT.key]: clientId },
      }),
    );
    expect(res.ok).toBe(true);
    expect(getProfileByPublicId).toHaveBeenCalledWith(PROFILE_ID);
    expect(logCheckinEntries).toHaveBeenCalledWith(
      expect.objectContaining({
        profilePublicId: PROFILE_ID,
        day: localDay(),
        items: [{ activityKey: HABIT.activityKey, metricKey: null, value: 1, clientId }],
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith(`/p/${PROFILE_ID}`);
  });

  it('writes a mixed batch: a habit, a bool metric, and a rated metric', async () => {
    const res = await logCheckinsAction(
      initial,
      checkinForm({
        profileId: PROFILE_ID,
        values: { [HABIT.key]: '1', [BOOL_METRIC.key]: '1', [SCALE_METRIC.key]: '7' },
      }),
    );
    expect(res.ok).toBe(true);
    const items = vi.mocked(logCheckinEntries).mock.calls[0]![0].items;
    expect(items).toHaveLength(3);
    // A bare habit carries NEITHER source column — the shape V1-5 introduces.
    expect(items.find((i) => i.activityKey === HABIT.activityKey)!.metricKey).toBeNull();
    expect(items.find((i) => i.metricKey === BOOL_METRIC.metricKey)!.value).toBe(1);
    expect(items.find((i) => i.metricKey === SCALE_METRIC.metricKey)!.value).toBe(7);
    // `unit` is never on the wire — the DAL resolves it from the seeded catalog.
    for (const i of items) expect(i).not.toHaveProperty('unit');
  });

  it('fails gracefully (no write) when the profile is unknown', async () => {
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce(null);
    const res = await logCheckinsAction(
      initial,
      checkinForm({ profileId: PROFILE_ID, values: { [HABIT.key]: '1' } }),
    );
    expect(res.ok).toBe(false);
    expect(logCheckinEntries).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  // client_id UNIQUE is GLOBAL, not profile-scoped: a colliding id writes nothing.
  // Reporting success there would mask a lost write.
  it('reports failure when every item conflicted (nothing written)', async () => {
    vi.mocked(logCheckinEntries).mockResolvedValueOnce([
      { clientId: 'x', id: null, created: false },
    ]);
    const res = await logCheckinsAction(
      initial,
      checkinForm({ profileId: PROFILE_ID, values: { [HABIT.key]: '1' } }),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already logged/i);
  });
});

// ── V1-6a: calisthenics (accumulating count metrics) ─────────────────────────────
const CALIS = CHECKIN_FIELDS.find((f) => f.activityKey === 'calisthenics')!;

describe('logCheckinsAction — calisthenics counts', () => {
  it('logs a filled counter via the DAL (rides the V1-5 count path)', async () => {
    const clientId = newId();
    const res = await logCheckinsAction(
      initial,
      checkinForm({
        profileId: PROFILE_ID,
        values: { [CALIS.key]: '20' },
        clientIds: { [CALIS.key]: clientId },
      }),
    );
    expect(res.ok).toBe(true);
    const items = vi.mocked(logCheckinEntries).mock.calls[0]![0].items;
    expect(items).toEqual([
      { activityKey: 'calisthenics', metricKey: CALIS.metricKey, value: 20, clientId },
    ]);
  });

  it.each(['-1', '100000.5', 'abc'])(
    'rejects an out-of-range / non-int count (%s)',
    async (bad) => {
      const res = await logCheckinsAction(
        initial,
        checkinForm({ profileId: PROFILE_ID, values: { [CALIS.key]: bad } }),
      );
      expect(res.ok).toBe(false);
      expect(res.fieldErrors?.[CALIS.key]).toBeTruthy();
      expect(logCheckinEntries).not.toHaveBeenCalled();
    },
  );

  it('ignores a blank counter (not submitted)', async () => {
    const res = await logCheckinsAction(
      initial,
      checkinForm({ profileId: PROFILE_ID, values: { [CALIS.key]: '   ' } }),
    );
    expect(res.ok).toBe(false); // nothing submitted at all
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });
});

// ── V1-6c: the shared declared-day ±1 bound applies to ALL THREE writers ──────────
// resolveDeclaredDay bounds the rendered `day` to the active-tz today ±1, so a write lands
// on the day the user saw (even across local midnight) but a stale tab is rejected.
describe('declared-day ±1 bound (shared across writers)', () => {
  const bwForm = (day: string) =>
    form({ profileId: PROFILE_ID, value: '180', unit: 'lb', clientId: newId(), day });
  const strForm = (day: string) =>
    strengthForm({
      profileId: PROFILE_ID,
      movements: [{ movementName: 'Back squat', sets: [{ reps: '5', weight: '135' }] }],
      day,
    });
  const ciForm = (day: string) =>
    checkinForm({ profileId: PROFILE_ID, day, values: { [HABIT.key]: '1' } });

  it.each([-1, 0, 1])('accepts a day within ±1 (offset %s)', async (offset) => {
    const day = localDay(offset);
    expect((await logBodyweightAction(initial, bwForm(day))).ok).toBe(true);
    expect((await logStrengthSessionAction(initial, strForm(day))).ok).toBe(true);
    expect((await logCheckinsAction(initial, ciForm(day))).ok).toBe(true);
    // Sanity: the offset day is exactly ±1 (or 0) from the active-tz today.
    expect(Math.abs(isoDayDiff(day, localDay()))).toBeLessThanOrEqual(1);
  });

  it('rejects a day more than +1 ahead (stale/forward tab) on every writer', async () => {
    const day = localDay(2);
    const bw = await logBodyweightAction(initial, bwForm(day));
    const str = await logStrengthSessionAction(initial, strForm(day));
    const ci = await logCheckinsAction(initial, ciForm(day));
    for (const res of [bw, str, ci]) expect(res.ok).toBe(false);
    expect(logBodyweight).not.toHaveBeenCalled();
    expect(logStrengthSession).not.toHaveBeenCalled();
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });

  it('rejects a malformed day on bodyweight/strength (after zod, before the DAL)', async () => {
    expect((await logBodyweightAction(initial, bwForm('not-a-date'))).ok).toBe(false);
    expect((await logStrengthSessionAction(initial, strForm('2026-13-99'))).ok).toBe(false);
    expect(logBodyweight).not.toHaveBeenCalled();
    expect(logStrengthSession).not.toHaveBeenCalled();
  });
});

// ── V1-7: life activities (wake = timing event, wrestling_practice = one-tap duration) ──────
const lifeForm = (fields: Record<string, string>) =>
  form({ profileId: PROFILE_ID, clientId: newId(), ...fields });

describe('logLifeActivitiesAction — boundary', () => {
  it('rejects an activityKey not in the trusted life set (never trust the body)', async () => {
    const res = await logLifeActivitiesAction(
      initial,
      lifeForm({ activityKey: 'sc_lift' }), // a real activity, but not a life one
    );
    expect(res.ok).toBe(false);
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });

  it('rejects a missing/absent activityKey', async () => {
    const res = await logLifeActivitiesAction(
      initial,
      form({ profileId: PROFILE_ID, clientId: newId() }),
    );
    expect(res.ok).toBe(false);
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });

  it('rejects a missing/malformed profileId or clientId without touching the DAL', async () => {
    expect(
      (
        await logLifeActivitiesAction(
          initial,
          form({ activityKey: ACTIVITY_TYPE_KEYS.wake, clientId: newId() }),
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await logLifeActivitiesAction(
          initial,
          lifeForm({ activityKey: ACTIVITY_TYPE_KEYS.wake, clientId: 'nope' }),
        )
      ).ok,
    ).toBe(false);
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });

  it('rejects a stale day on wrestling practice (day-grain, bounded ±1)', async () => {
    const res = await logLifeActivitiesAction(
      initial,
      lifeForm({ activityKey: ACTIVITY_TYPE_KEYS.wrestling_practice, day: '2020-01-01' }),
    );
    expect(res.ok).toBe(false);
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });

  it('IGNORES the declared day for wake (a "now" event stamps its own day, no ±1 rejection)', async () => {
    // Wake derives day/minutes/event_at from now, so even a wildly stale rendered `day` still logs
    // (on today) — the cross-midnight-wrong-day bug the review caught can't happen.
    const res = await logLifeActivitiesAction(
      initial,
      lifeForm({ activityKey: ACTIVITY_TYPE_KEYS.wake, day: '2020-01-01' }),
    );
    expect(res.ok).toBe(true);
    expect(vi.mocked(logCheckinEntries).mock.calls[0]![0].day).toBe(localDay());
  });

  it('fails gracefully (no write) when the profile is unknown', async () => {
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce(null);
    const res = await logLifeActivitiesAction(
      initial,
      lifeForm({ activityKey: ACTIVITY_TYPE_KEYS.wrestling_practice }),
    );
    expect(res.ok).toBe(false);
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });
});

describe('logLifeActivitiesAction — happy path', () => {
  it('logs wake as a timing event: metricKey null, eventAt a Date, value = local minutes (0–1439)', async () => {
    const clientId = newId();
    const res = await logLifeActivitiesAction(
      initial,
      lifeForm({ activityKey: ACTIVITY_TYPE_KEYS.wake, clientId }),
    );
    expect(res.ok).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith(`/p/${PROFILE_ID}`);
    const { items, day } = vi.mocked(logCheckinEntries).mock.calls[0]![0];
    expect(day).toBe(localDay());
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.activityKey).toBe(ACTIVITY_TYPE_KEYS.wake);
    expect(item.metricKey).toBeNull();
    expect(item.clientId).toBe(clientId);
    expect(item.eventAt).toBeInstanceOf(Date);
    expect(item.value).toBeGreaterThanOrEqual(0);
    expect(item.value).toBeLessThanOrEqual(1439);
    expect(Number.isInteger(item.value)).toBe(true);
  });

  it('logs wrestling practice one-tap: practice_minutes at the default, no eventAt', async () => {
    const res = await logLifeActivitiesAction(
      initial,
      lifeForm({ activityKey: ACTIVITY_TYPE_KEYS.wrestling_practice }),
    );
    expect(res.ok).toBe(true);
    const item = vi.mocked(logCheckinEntries).mock.calls[0]![0].items[0]!;
    expect(item.activityKey).toBe(ACTIVITY_TYPE_KEYS.wrestling_practice);
    expect(item.metricKey).toBe(METRIC_KEYS.practice_minutes);
    expect(item.value).toBe(DEFAULT_PRACTICE_MINUTES);
    expect(item.eventAt).toBeUndefined();
  });

  it('treats an idempotent replay (client_id conflict) as SUCCESS, not a destructive error', async () => {
    // A one-tap double-tap reuses the same fixed client_id → ON CONFLICT dedupe → created:false. The
    // end state is identical (the activity is logged), so it must return ok:true — never a red
    // "already logged" alert for an operation that in fact succeeded (review finding).
    vi.mocked(logCheckinEntries).mockResolvedValueOnce([
      { clientId: 'x', id: null, created: false },
    ]);
    const res = await logLifeActivitiesAction(
      initial,
      lifeForm({ activityKey: ACTIVITY_TYPE_KEYS.wake }),
    );
    expect(res.ok).toBe(true);
  });
});

// A fresh set id (UUIDv7) for the edit tests — the DAL is mocked, so it just needs to pass uuidSchema.
function editForm(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

describe('editStrengthSetAction — boundary (bad body → zod-reject)', () => {
  it('rejects a non-numeric reps without touching the DAL', async () => {
    const res = await editStrengthSetAction(
      initial,
      editForm({ profileId: PROFILE_ID, setId: newId(), reps: 'abc', weight: '135' }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.reps).toBeTruthy();
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(editStrengthSet).not.toHaveBeenCalled();
  });

  it('rejects a blank weight (blank must not slip past as 0)', async () => {
    const res = await editStrengthSetAction(
      initial,
      editForm({ profileId: PROFILE_ID, setId: newId(), reps: '5', weight: '' }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.weight).toBeTruthy();
    expect(editStrengthSet).not.toHaveBeenCalled();
  });

  it('rejects a non-UUID setId', async () => {
    const res = await editStrengthSetAction(
      initial,
      editForm({ profileId: PROFILE_ID, setId: 'not-a-uuid', reps: '5', weight: '135' }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.setId).toBeTruthy();
    expect(editStrengthSet).not.toHaveBeenCalled();
  });

  it('rejects a malformed profileId without touching the DAL', async () => {
    const res = await editStrengthSetAction(
      initial,
      editForm({ profileId: 'not-a-uuid', setId: newId(), reps: '5', weight: '135' }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.profileId).toBeTruthy();
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(editStrengthSet).not.toHaveBeenCalled();
  });
});

describe('editStrengthSetAction — happy path + not-found', () => {
  it('edits a valid set via the DAL and revalidates the scoped Today', async () => {
    const setId = newId();
    const res = await editStrengthSetAction(
      initial,
      editForm({ profileId: PROFILE_ID, setId, reps: '7', weight: '142.5' }),
    );
    expect(res.ok).toBe(true);
    expect(getProfileByPublicId).toHaveBeenCalledWith(PROFILE_ID);
    expect(editStrengthSet).toHaveBeenCalledWith(
      expect.objectContaining({ profilePublicId: PROFILE_ID, setId, reps: 7, weight: 142.5 }),
    );
    expect(revalidatePath).toHaveBeenCalledWith(`/p/${PROFILE_ID}`);
  });

  it('maps a not-found set (wrong owner / stale id) to a typed error, no revalidate', async () => {
    // The guarded UPDATE matched no row → the DAL returns null. That is an EXPECTED outcome, so the
    // action returns { ok:false }, never a throw to error.tsx.
    vi.mocked(editStrengthSet).mockResolvedValueOnce(null);
    const res = await editStrengthSetAction(
      initial,
      editForm({ profileId: PROFILE_ID, setId: newId(), reps: '7', weight: '142.5' }),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

// ── V1-18 PR 2: the coach routine editor ─────────────────────────────────────────
// The routine rides as ONE hidden `routine` JSON field (an ordered variable-length list, the
// strength-form idiom). `validateRoutineForWrite` is the trust boundary — it REJECTS an empty /
// non-catalog / duplicate order against the REAL ROUTINE_CATALOG (no drop-and-store). Two real catalog
// keys keep these tests bound to the live catalog, not re-typed strings.
const [ROUTINE_K1, ROUTINE_K2] = ROUTINE_CATALOG; // 'strength', then the first check-in key
function routineForm(opts: { profileId?: string; routineRaw?: string; order?: unknown }): FormData {
  const fd = new FormData();
  if (opts.profileId !== undefined) fd.append('profileId', opts.profileId);
  if (opts.routineRaw !== undefined) fd.append('routine', opts.routineRaw);
  else if (opts.order !== undefined)
    fd.append('routine', JSON.stringify({ version: ROUTINE_VERSION, order: opts.order }));
  return fd;
}

describe('editRoutineAction — boundary (bad body → reject, no write)', () => {
  it('rejects a malformed routine JSON body without touching the DAL', async () => {
    const res = await editRoutineAction(
      initial,
      routineForm({ profileId: PROFILE_ID, routineRaw: '{not valid json' }),
    );
    expect(res.ok).toBe(false);
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(updateProfileRoutine).not.toHaveBeenCalled();
  });

  it('rejects an EMPTY order (an empty routine is not authorable — it would revert to the default)', async () => {
    const res = await editRoutineAction(initial, routineForm({ profileId: PROFILE_ID, order: [] }));
    expect(res.ok).toBe(false);
    expect(updateProfileRoutine).not.toHaveBeenCalled();
  });

  it('rejects a duplicate key (the strict write matches resolveRoutine — no store-then-diverge)', async () => {
    const res = await editRoutineAction(
      initial,
      routineForm({ profileId: PROFILE_ID, order: [{ key: ROUTINE_K1 }, { key: ROUTINE_K1 }] }),
    );
    expect(res.ok).toBe(false);
    expect(updateProfileRoutine).not.toHaveBeenCalled();
  });

  it('rejects a key not in the catalog (grammar-valid but not a live activity)', async () => {
    const res = await editRoutineAction(
      initial,
      routineForm({ profileId: PROFILE_ID, order: [{ key: 'finisher:sprints' }] }),
    );
    expect(res.ok).toBe(false);
    expect(updateProfileRoutine).not.toHaveBeenCalled();
  });

  it('rejects a missing profileId AFTER a valid routine (no owner to save against)', async () => {
    const res = await editRoutineAction(initial, routineForm({ order: [{ key: ROUTINE_K1 }] }));
    expect(res.ok).toBe(false);
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(updateProfileRoutine).not.toHaveBeenCalled();
  });
});

describe('editRoutineAction — happy path + ownership', () => {
  it('persists a valid routine and revalidates BOTH Today and the editor', async () => {
    const res = await editRoutineAction(
      initial,
      routineForm({ profileId: PROFILE_ID, order: [{ key: ROUTINE_K2 }, { key: ROUTINE_K1 }] }),
    );
    expect(res.ok).toBe(true);
    expect(getProfileByPublicId).toHaveBeenCalledWith(PROFILE_ID);
    expect(updateProfileRoutine).toHaveBeenCalledWith(PROFILE_ID, {
      version: ROUTINE_VERSION,
      order: [{ key: ROUTINE_K2 }, { key: ROUTINE_K1 }],
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/p/${PROFILE_ID}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/p/${PROFILE_ID}/routine`);
  });

  it('PRESERVES the opaque conditional marker through to the write (the V1-10 down-payment)', async () => {
    await editRoutineAction(
      initial,
      routineForm({
        profileId: PROFILE_ID,
        order: [{ key: ROUTINE_K1, conditional: true }, { key: ROUTINE_K2 }],
      }),
    );
    expect(updateProfileRoutine).toHaveBeenCalledWith(
      PROFILE_ID,
      expect.objectContaining({
        order: [{ key: ROUTINE_K1, conditional: true }, { key: ROUTINE_K2 }],
      }),
    );
  });

  it('fails gracefully (no write) when the profile is unknown', async () => {
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce(null);
    const res = await editRoutineAction(
      initial,
      routineForm({ profileId: PROFILE_ID, order: [{ key: ROUTINE_K1 }] }),
    );
    expect(res.ok).toBe(false);
    expect(updateProfileRoutine).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

// ── V1-24 PR 1b: the bodyweight amend ───────────────────────────────────────────────────────────
const ENTRY_ID = '019826b4-0000-7000-8000-0000000000aa';
const amendForm = (over: Record<string, string> = {}): FormData =>
  editForm({
    profileId: PROFILE_ID,
    entryId: ENTRY_ID,
    value: '85.2',
    unit: 'lb',
    seenValue: '84.5',
    ...over,
  });

describe('editBodyweightAction — boundary (bad body → zod-reject)', () => {
  it.each([
    ['a non-numeric value', { value: 'abc' }, 'value'],
    ['a non-UUID entryId', { entryId: 'not-a-uuid' }, 'entryId'],
    ['a non-UUID profileId', { profileId: 'nope' }, 'profileId'],
    ['an unknown unit', { unit: 'stone' }, 'unit'],
  ])('rejects %s without touching the DAL', async (_name, over, field) => {
    const res = await editBodyweightAction(initial, amendForm(over));
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.[field]).toBeTruthy();
    expect(editBodyweight).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ The amend is the one path that writes a CORRECTED weight, so it must run the same
   * plausibility bound as the create path. The plan's first draft reached for
   * `logBodyweightSchema.pick()`, which would have dropped the refinement — and, in this zod, throws
   * at module load. Both schemas now share one refiner.
   */
  it('rejects an implausible corrected weight — the bound is not a create-only rule', async () => {
    const res = await editBodyweightAction(initial, amendForm({ value: '845' }));
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.value).toBeTruthy();
    expect(editBodyweight).not.toHaveBeenCalled();
  });
});

describe('editBodyweightAction — the three-way refusal branch', () => {
  it('amends via the DAL and revalidates the scoped Today', async () => {
    const res = await editBodyweightAction(initial, amendForm());
    expect(res.ok).toBe(true);
    expect(editBodyweight).toHaveBeenCalledWith({
      profilePublicId: PROFILE_ID,
      entryId: ENTRY_ID,
      value: 85.2,
      unit: 'lb',
      seenValue: 84.5,
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/p/${PROFILE_ID}`);
  });

  it('rejects an unknown profile before writing (ownership seam)', async () => {
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce(null);
    const res = await editBodyweightAction(initial, amendForm());
    expect(res.ok).toBe(false);
    expect(editBodyweight).not.toHaveBeenCalled();
  });

  /**
   * (a) Wrong owner, stale id and wrong shape all land here, and all get the SAME message on
   * purpose: a crafted cross-profile id must learn nothing a stale id wouldn't.
   */
  it('a refusal with no readable row → one not-found message', async () => {
    vi.mocked(editBodyweight).mockResolvedValueOnce(null);
    vi.mocked(ownedBodyweightValue).mockResolvedValueOnce(null);
    const res = await editBodyweightAction(initial, amendForm());
    expect(res.ok).toBe(false);
    expect(res.error).toBe(AMEND_ERROR_COPY.notFound('weight'));
  });

  /**
   * ⚠️ (b) THE REPLAY CASE (AGENTS.md: replay → one effect, identical response). Save on gym wifi,
   * the write lands, the response is lost, the POST retries. `seenValue` no longer matches — but the
   * row already holds exactly what was asked for, so this is success, not a conflict with nobody.
   */
  it('a replay of a write that already landed → ok, not a phantom conflict', async () => {
    vi.mocked(editBodyweight).mockResolvedValueOnce(null);
    vi.mocked(ownedBodyweightValue).mockResolvedValueOnce({ value: 85.2, unit: 'lb' });
    const res = await editBodyweightAction(initial, amendForm());
    expect(res.ok).toBe(true);
    expect(res.error).toBeNull();
  });

  /** (c) Someone else got there first — recoverable, and the page revalidates to show what won. */
  it('a genuinely stale write → the stale message, and a revalidate', async () => {
    vi.mocked(editBodyweight).mockResolvedValueOnce(null);
    vi.mocked(ownedBodyweightValue).mockResolvedValueOnce({ value: 70, unit: 'lb' });
    const res = await editBodyweightAction(initial, amendForm());
    expect(res.ok).toBe(false);
    expect(res.error).toBe(AMEND_ERROR_COPY.staleWrite);
    expect(revalidatePath).toHaveBeenCalledWith(`/p/${PROFILE_ID}`);
  });
});
