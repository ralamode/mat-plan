import { BODYWEIGHT_UNITS, newId } from '@mat-plan/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the boundaries so the action runs as a plain async fn (AGENTS.md gotcha:
// Server Actions aren't HTTP routes — test the function, mock the DAL + cache).
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/dal/entries', () => ({
  logBodyweight: vi.fn(async () => ({ id: 'entry-pub-id' })),
}));
vi.mock('@/lib/dal/profiles', () => ({
  getDefaultProfile: vi.fn(async () => ({
    id: 'profile-pub-id',
    name: 'Athlete One',
    kind: 'kid',
  })),
}));

import { logBodyweight } from '@/lib/dal/entries';
import { getDefaultProfile } from '@/lib/dal/profiles';
import { revalidatePath } from 'next/cache';

import { logBodyweightAction, type ActionState } from './actions';

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
