import { PROFILE_KIND } from '@mat-plan/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PROF-1 a-1d — the DAL's duplicate passthrough, in its own file.
 *
 * 🔴 **This exists because the `atCap` wiring had no test between the writer and the screen.**
 * `db:verify` proves `createProfile` computes the flag (patch `31` breaks it) and a form test proves
 * the UI hides "Add another" when handed one — but nothing covered the three lines in between.
 * Forcing `atCap: false` here left **every tier green** while the screen offered a button the
 * endpoint answers `full` to, which is the one invariant this chunk kept claiming.
 *
 * ⚠️ **Its own file, not `profiles.test.ts`.** That suite drives the REAL writers through
 * `recording-db`; mocking `@mat-plan/db` there would hollow out every other test in it.
 */
const createProfile = vi.fn();
vi.mock('@mat-plan/db', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  createProfile: (...args: unknown[]) => createProfile(...args),
}));
vi.mock('./db', () => ({ db: {} }));

const getHouseholdScope = vi.fn();
vi.mock('./household', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getHouseholdScope: () => getHouseholdScope(),
}));

const { createAthlete } = await import('./profiles');

const INPUT = {
  name: 'Ada',
  kind: PROFILE_KIND.kid,
  clientId: '019826b4-0000-7000-8000-0000000000c1',
};
const MATCH = {
  publicId: 'p-match',
  name: 'Ada',
  kind: PROFILE_KIND.kid,
  archived: true,
};

beforeEach(() => {
  createProfile.mockReset();
  getHouseholdScope.mockReset();
  getHouseholdScope.mockResolvedValue({ householdId: 1, role: 'owner' });
});

describe('createAthlete — the duplicate passthrough (PROF-1 a-1d)', () => {
  it('passes `match` and `atCap` through UNCHANGED', async () => {
    createProfile.mockResolvedValue({ ok: false, reason: 'duplicate', match: MATCH, atCap: true });
    // 🔴 `atCap` is what the screen uses to hide "Add another". Dropping or hard-coding it here is
    // invisible to the writer's proofs and to the form's, because each mocks the other side.
    expect(await createAthlete(INPUT)).toEqual({
      ok: false,
      reason: 'duplicate',
      match: MATCH,
      atCap: true,
    });
  });

  it('…including when the household is NOT full', async () => {
    createProfile.mockResolvedValue({ ok: false, reason: 'duplicate', match: MATCH, atCap: false });
    expect(await createAthlete(INPUT)).toMatchObject({ atCap: false, match: MATCH });
  });

  it('still maps the non-duplicate refusals, which carry no match', async () => {
    for (const reason of ['refused', 'full'] as const) {
      createProfile.mockResolvedValue({ ok: false, reason });
      expect(await createAthlete(INPUT)).toEqual({ ok: false, reason });
    }
  });

  it('refuses with no_scope BEFORE reaching the writer', async () => {
    getHouseholdScope.mockResolvedValue(null);
    expect(await createAthlete(INPUT)).toEqual({ ok: false, reason: 'no_scope' });
    expect(createProfile).not.toHaveBeenCalled();
  });
});
