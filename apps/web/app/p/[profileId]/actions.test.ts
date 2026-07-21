import { BODYWEIGHT_UNITS, newId } from '@mat-plan/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// INTEGRATION TIER (see docs/definition-of-done.md → Test pyramid). These exercise
// the Server Actions end-to-end THROUGH their zod validation and typed-envelope
// contract down to the DAL boundary — the mandatory bad-body → zod-reject and
// happy-path + ownership cases — without a live Postgres. Mock the boundaries so
// the action runs as a plain async fn (AGENTS.md gotcha: Server Actions aren't
// HTTP routes — test the function, mock the DAL + cache). Real-DB coverage of the
// same write path lives in the Playwright smoke E2E (the `e2e` CI job, V0-11).
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/dal/entries', () => ({
  logBodyweight: vi.fn(async () => ({ id: 'entry-pub-id' })),
  logStrengthEntry: vi.fn(async () => ({ id: 'strength-pub-id' })),
}));
vi.mock('@/lib/dal/profiles', () => ({
  getProfileByPublicId: vi.fn(async () => ({
    id: PROFILE_ID,
    name: 'Liam',
    kind: 'kid',
    avatar: null,
  })),
}));

import { logBodyweight, logStrengthEntry } from '@/lib/dal/entries';
import { getProfileByPublicId } from '@/lib/dal/profiles';
import { revalidatePath } from 'next/cache';

import { logBodyweightAction, logStrengthAction, type ActionState } from './actions';

// A valid tile-supplied public id (UUIDv7). The DAL re-validates it server-side;
// the action must thread it through to both the ownership check and revalidate path.
const PROFILE_ID = '019826b4-0000-7000-8000-000000000001';

const initial: ActionState = { ok: false, error: null };

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
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

// Builds strength FormData with parallel repeated reps/weight fields.
function strengthForm(opts: {
  profileId?: string;
  movementName?: string;
  unit?: string;
  clientId?: string;
  sets?: Array<{ reps: string; weight: string }>;
}): FormData {
  const fd = new FormData();
  if (opts.profileId !== undefined) fd.append('profileId', opts.profileId);
  if (opts.movementName !== undefined) fd.append('movementName', opts.movementName);
  fd.append('unit', opts.unit ?? BODYWEIGHT_UNITS[0]);
  fd.append('clientId', opts.clientId ?? newId());
  for (const s of opts.sets ?? []) {
    fd.append('reps', s.reps);
    fd.append('weight', s.weight);
  }
  return fd;
}

describe('logStrengthAction — boundary (bad body → zod-reject)', () => {
  it('rejects a missing movement without touching the DAL', async () => {
    const res = await logStrengthAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        movementName: '',
        sets: [{ reps: '5', weight: '135' }],
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.movementName).toBeTruthy();
    expect(logStrengthEntry).not.toHaveBeenCalled();
  });

  it('rejects when there are no sets (blank rows dropped)', async () => {
    const res = await logStrengthAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        movementName: 'Back squat',
        sets: [{ reps: '', weight: '' }],
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.sets).toBeTruthy();
    expect(logStrengthEntry).not.toHaveBeenCalled();
  });

  it('rejects a non-integer rep count', async () => {
    const res = await logStrengthAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        movementName: 'Back squat',
        sets: [{ reps: '5.5', weight: '135' }],
      }),
    );
    expect(res.ok).toBe(false);
    expect(logStrengthEntry).not.toHaveBeenCalled();
  });

  it('rejects a missing profileId without touching the DAL', async () => {
    const res = await logStrengthAction(
      initial,
      strengthForm({ movementName: 'Back squat', sets: [{ reps: '5', weight: '135' }] }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.profileId).toBeTruthy();
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(logStrengthEntry).not.toHaveBeenCalled();
  });
});

describe('logStrengthAction — happy path (transactional nested write)', () => {
  it('passes movement + parsed sets to the DAL and revalidates the scoped Today', async () => {
    const clientId = newId();
    const res = await logStrengthAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        movementName: 'Back squat',
        clientId,
        sets: [
          { reps: '5', weight: '135' },
          { reps: '5', weight: '135' },
          { reps: '3', weight: '155' },
        ],
      }),
    );
    expect(res.ok).toBe(true);
    expect(getProfileByPublicId).toHaveBeenCalledWith(PROFILE_ID);
    expect(logStrengthEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        profilePublicId: PROFILE_ID,
        movementName: 'Back squat',
        unit: BODYWEIGHT_UNITS[0],
        clientId,
        sets: [
          { reps: 5, weight: 135 },
          { reps: 5, weight: 135 },
          { reps: 3, weight: 155 },
        ],
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith(`/p/${PROFILE_ID}`);
  });

  it('fails gracefully (no write) when the profile is unknown', async () => {
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce(null);
    const res = await logStrengthAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        movementName: 'Back squat',
        sets: [{ reps: '5', weight: '135' }],
      }),
    );
    expect(res.ok).toBe(false);
    expect(logStrengthEntry).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
