import { BODYWEIGHT_UNITS, newId } from '@mat-plan/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the boundaries so the action runs as a plain async fn (AGENTS.md gotcha:
// Server Actions aren't HTTP routes — test the function, mock the DAL + cache).
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/dal/entries', () => ({
  logBodyweight: vi.fn(async () => ({ id: 'entry-pub-id' })),
  logStrengthEntry: vi.fn(async () => ({ id: 'strength-pub-id' })),
}));
vi.mock('@/lib/dal/profiles', () => ({
  getDefaultProfile: vi.fn(async () => ({
    id: 'profile-pub-id',
    name: 'Athlete One',
    kind: 'kid',
  })),
}));

import { logBodyweight, logStrengthEntry } from '@/lib/dal/entries';
import { getDefaultProfile } from '@/lib/dal/profiles';
import { revalidatePath } from 'next/cache';

import { logBodyweightAction, logStrengthAction, type ActionState } from './actions';

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
      form({ value: 'abc', unit: 'lb', clientId: newId() }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.value).toBeTruthy();
    expect(logBodyweight).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects a non-positive weight', async () => {
    const res = await logBodyweightAction(
      initial,
      form({ value: '0', unit: 'lb', clientId: newId() }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.value).toBeTruthy();
    expect(logBodyweight).not.toHaveBeenCalled();
  });

  it('rejects a unit outside the allowed set', async () => {
    const res = await logBodyweightAction(
      initial,
      form({ value: '180', unit: 'stone', clientId: newId() }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.unit).toBeTruthy();
    expect(logBodyweight).not.toHaveBeenCalled();
  });

  it('rejects a non-UUID clientId', async () => {
    const res = await logBodyweightAction(
      initial,
      form({ value: '180', unit: 'lb', clientId: 'not-a-uuid' }),
    );
    expect(res.ok).toBe(false);
    expect(logBodyweight).not.toHaveBeenCalled();
  });
});

describe('logBodyweightAction — happy path + ownership', () => {
  it('writes a valid entry via the DAL and revalidates Today', async () => {
    const clientId = newId();
    const res = await logBodyweightAction(
      initial,
      form({ value: '182.5', unit: BODYWEIGHT_UNITS[0], clientId }),
    );
    expect(res.ok).toBe(true);
    expect(logBodyweight).toHaveBeenCalledWith(
      expect.objectContaining({
        profilePublicId: 'profile-pub-id',
        value: 182.5,
        unit: BODYWEIGHT_UNITS[0],
        clientId,
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith('/');
  });

  it('fails gracefully when there is no profile to log against', async () => {
    vi.mocked(getDefaultProfile).mockResolvedValueOnce(null);
    const res = await logBodyweightAction(
      initial,
      form({ value: '180', unit: 'lb', clientId: newId() }),
    );
    expect(res.ok).toBe(false);
    expect(logBodyweight).not.toHaveBeenCalled();
  });
});

// Builds strength FormData with parallel repeated reps/weight fields.
function strengthForm(opts: {
  movementName?: string;
  unit?: string;
  clientId?: string;
  sets?: Array<{ reps: string; weight: string }>;
}): FormData {
  const fd = new FormData();
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
      strengthForm({ movementName: '', sets: [{ reps: '5', weight: '135' }] }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.movementName).toBeTruthy();
    expect(logStrengthEntry).not.toHaveBeenCalled();
  });

  it('rejects when there are no sets (blank rows dropped)', async () => {
    const res = await logStrengthAction(
      initial,
      strengthForm({ movementName: 'Back squat', sets: [{ reps: '', weight: '' }] }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.sets).toBeTruthy();
    expect(logStrengthEntry).not.toHaveBeenCalled();
  });

  it('rejects a non-integer rep count', async () => {
    const res = await logStrengthAction(
      initial,
      strengthForm({ movementName: 'Back squat', sets: [{ reps: '5.5', weight: '135' }] }),
    );
    expect(res.ok).toBe(false);
    expect(logStrengthEntry).not.toHaveBeenCalled();
  });
});

describe('logStrengthAction — happy path (transactional nested write)', () => {
  it('passes movement + parsed sets to the DAL and revalidates', async () => {
    const clientId = newId();
    const res = await logStrengthAction(
      initial,
      strengthForm({
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
    expect(logStrengthEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        profilePublicId: 'profile-pub-id',
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
    expect(revalidatePath).toHaveBeenCalledWith('/');
  });
});
