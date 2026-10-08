import { ENTRY_KIND } from '@mat-plan/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `logBodyweight` is now a pass-through to `insertBodyweightEntry` (V1-24 1e), which `db:verify` proves
// against a real database. This pins the DAL half: the profile is resolved as LIVE first, and the writer
// receives the mapped arguments — or is never called for an unknown profile.
const { state, insertBodyweightEntry } = vi.hoisted(() => ({
  state: { profileRows: [] as { id: number }[], scope: null as unknown },
  insertBodyweightEntry: vi.fn(async (_exec: unknown, _args: Record<string, unknown>) => ({
    id: 'written-public-id',
  })),
}));

vi.mock('./db', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => state.profileRows }) }) }),
  },
}));
// TEN-1 1b: `logBodyweight` resolves the household scope itself and threads it into
// `isLiveProfile`. Mocked explicitly rather than left to the `db` stub below, so the "unknown
// profile" case and the "no household" case stay DISTINGUISHABLE here — they share an error message
// on purpose, and a test that cannot tell them apart would not notice if one stopped happening.
vi.mock('./household', () => ({ getHouseholdScope: async () => state.scope }));
vi.mock('./catalog', () => ({
  getActivityTypeIdByKey: async () => 7,
  assertMetricKeyExists: async (k: string) => k,
}));
vi.mock('@mat-plan/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mat-plan/db')>()),
  insertBodyweightEntry,
}));

import { logBodyweight } from './entries';

const ARGS = {
  profilePublicId: '019826b4-0000-7000-8000-000000000099',
  clientId: '019826b4-0000-7000-8000-0000000000aa',
  day: '2026-10-01',
  value: 84.5,
  unit: 'lb' as const,
};

beforeEach(() => {
  state.profileRows = [];
  state.scope = { householdId: 1 };
  insertBodyweightEntry.mockClear();
});

describe('logBodyweight — the DAL half of the create path (V1-24 1e)', () => {
  it('maps the arguments onto the writer for a live profile', async () => {
    state.profileRows = [{ id: 42 }];
    await expect(logBodyweight({ ...ARGS, notes: 'after practice' })).resolves.toEqual({
      id: 'written-public-id',
    });
    expect(insertBodyweightEntry).toHaveBeenCalledTimes(1);
    expect(insertBodyweightEntry.mock.calls[0][1]).toMatchObject({
      profileId: 42,
      clientId: ARGS.clientId,
      day: ARGS.day,
      unit: 'lb',
      value: 84.5,
      notes: 'after practice',
      activityTypeId: 7,
      kind: ENTRY_KIND.bodyweight,
    });
  });

  it('missing notes become null, not undefined', async () => {
    state.profileRows = [{ id: 42 }];
    await logBodyweight(ARGS);
    expect(insertBodyweightEntry.mock.calls[0][1]).toMatchObject({ notes: null });
  });

  it('an unknown (or soft-deleted, or foreign-household) profile rejects and never reaches the writer', async () => {
    await expect(logBodyweight(ARGS)).rejects.toThrow('Profile not found');
    expect(insertBodyweightEntry).not.toHaveBeenCalled();
  });

  it('TEN-1: no resolvable household rejects BEFORE the profile query, with the same message', async () => {
    // Same message on purpose — the caller already re-checked ownership through
    // `getProfileByPublicId`, so reaching here with no scope is a caller bug, and the refusal must
    // not describe the server's state to a crafted POST.
    state.scope = null;
    state.profileRows = [{ id: 42 }];
    await expect(logBodyweight(ARGS)).rejects.toThrow('Profile not found');
    expect(insertBodyweightEntry).not.toHaveBeenCalled();
  });
});
