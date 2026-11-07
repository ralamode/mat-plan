import { PROFILE_NAME_MAX } from '@mat-plan/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * INTEGRATION TIER — `renameAthleteAction` as a plain async function, with its boundaries mocked
 * (AGENTS.md: Server Actions aren't HTTP routes). PROF-1 a-r.
 *
 * 🔴 **This file is NOT where the boundary matrices live, and that is the WP-1 convention.** The
 * mandatory unauth / rate-limit / wrong-household / byte-identical-refusal suites run over the
 * REGISTRY, in `app/p/[profileId]/actions.test.ts`, so they cover every module at once and a new
 * action cannot be added without entering them. What belongs here is the per-action behaviour those
 * matrices cannot express: which bodies zod refuses, what a success returns, and which paths are
 * revalidated.
 */
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/dal/session', () => ({
  sessionUserOrNull: vi.fn(async () => ({ userId: PRINCIPAL })),
}));
// The limiter fails open and is `null` under vitest, so a refusal is only reachable through a mock.
vi.mock('@/lib/rate-limit', () => ({
  checkMutationLimit: vi.fn(async () => ({ allowed: true, reason: 'ok' })),
}));
vi.mock('@/lib/dal/profiles', () => ({
  getProfileByPublicId: vi.fn(async () => ({
    id: PROFILE_ID,
    name: 'Athlete One',
    kind: 'kid',
    avatar: null,
    routine: { version: 1, order: [] },
    firstDay: '2026-01-01',
  })),
  renameAthlete: vi.fn(async () => ({ id: PROFILE_ID })),
}));

import { revalidatePath } from 'next/cache';

import {
  APP_HOME_PATH,
  athleteEditPath,
  athletePath,
  NO_ATHLETE_SAVE,
  RATE_LIMITED,
} from '@/lib/constants';
import { getProfileByPublicId, renameAthlete } from '@/lib/dal/profiles';
import { checkMutationLimit } from '@/lib/rate-limit';

import type { ActionState } from './[profileId]/action-state';
import { renameAthleteAction } from './profile-actions';

const PRINCIPAL = 'user_000000000000000000000000e2e';
const PROFILE_ID = '019826b4-0000-7000-8000-000000000001';
const initial: ActionState = { ok: false, error: null };

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

beforeEach(() => vi.clearAllMocks());

describe('renameAthleteAction — boundary (bad body → zod-reject, nothing written)', () => {
  it.each([
    ['a blank name', { profileId: PROFILE_ID, name: '' }],
    ['a whitespace-only name', { profileId: PROFILE_ID, name: '   ' }],
    ['a name one over the cap', { profileId: PROFILE_ID, name: 'a'.repeat(PROFILE_NAME_MAX + 1) }],
    ['a name that folds to nothing', { profileId: PROFILE_ID, name: '́̂' }],
    ['an interior line break', { profileId: PROFILE_ID, name: 'Ada\nMae' }],
  ])('refuses %s as a FIELD error and never reaches the DAL', async (_label, fields) => {
    const res = await renameAthleteAction(initial, form(fields));

    expect(res.ok).toBe(false);
    // A field error, not a page-level alert: the input is what the parent has to fix.
    expect(res.fieldErrors?.name?.length).toBeGreaterThan(0);
    expect(res.error).toBeNull();
    // 🔴 The zod parse comes BEFORE the ownership read, so neither the read nor the write ran.
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(renameAthlete).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('refuses a missing name field (no `name` in the body at all)', async () => {
    const res = await renameAthleteAction(initial, form({ profileId: PROFILE_ID }));
    expect(res.ok).toBe(false);
    expect(renameAthlete).not.toHaveBeenCalled();
  });

  /**
   * 🔴 A malformed `profileId` answers with the NOT-FOUND refusal, not a field error — the id is a
   * hidden field, so a `fieldErrors.name` the form would render as an invalid name input is the wrong
   * answer, and answering differently from an unknown id would make a bad id an oracle for "that one
   * was at least shaped like an athlete".
   */
  it('answers a non-uuid profileId exactly as an unknown athlete', async () => {
    const res = await renameAthleteAction(initial, form({ profileId: 'new', name: 'Ada' }));
    expect(res).toEqual({ ok: false, error: NO_ATHLETE_SAVE });
    expect(res.fieldErrors).toBeUndefined();
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(renameAthlete).not.toHaveBeenCalled();
  });
});

describe('renameAthleteAction — happy path', () => {
  it('stores the collapsed, trimmed name and revalidates the three surfaces that render it', async () => {
    const res = await renameAthleteAction(
      initial,
      form({ profileId: PROFILE_ID, name: '  Ada   Mae  ' }),
    );

    expect(res).toEqual({ ok: true, error: null });
    // 🔴 The name reaching the DAL is the SCHEMA's output, not the raw field: whitespace-collapsed,
    // so the stored name matches what `foldName` will compare and what a-1d's warning will quote.
    expect(renameAthlete).toHaveBeenCalledWith(PROFILE_ID, 'Ada Mae');
    // The ownership seam ran first, on the id from the body.
    expect(getProfileByPublicId).toHaveBeenCalledWith(PROFILE_ID);

    const paths = vi.mocked(revalidatePath).mock.calls.map(([p]) => p);
    expect(paths).toEqual([APP_HOME_PATH, athletePath(PROFILE_ID), athleteEditPath(PROFILE_ID)]);
  });

  /**
   * The action threads the id the DAL RESOLVED, never the one from the body. They are equal here, so
   * this asserts the plumbing rather than a difference — which is exactly what would silently break
   * if a future edit revalidated `parsed.data.profileId` instead.
   */
  it('revalidates using the id the DAL returned', async () => {
    const OTHER = '019826b4-0000-7000-8000-0000000000ff';
    vi.mocked(renameAthlete).mockResolvedValueOnce({ id: OTHER });
    await renameAthleteAction(initial, form({ profileId: PROFILE_ID, name: 'Ada' }));
    const paths = vi.mocked(revalidatePath).mock.calls.map(([p]) => p);
    expect(paths).toContain(athletePath(OTHER));
  });

  /** An accent is stored as typed — folding is for comparison only, never for storage. */
  it('stores a name with combining marks as typed', async () => {
    await renameAthleteAction(initial, form({ profileId: PROFILE_ID, name: 'Zoë' }));
    expect(renameAthlete).toHaveBeenCalledWith(PROFILE_ID, 'Zoë');
  });
});

describe('renameAthleteAction — the DAL refuses', () => {
  /**
   * `renameAthlete` returns `null` when the UPDATE matched 0 rows — the id raced a soft delete
   * between the read and the write. The read passing and the write refusing is a real interleaving,
   * not a redundant branch, and it must answer with the same bytes as every other refusal.
   */
  it('maps a 0-row UPDATE to the same refusal, with no revalidation', async () => {
    vi.mocked(renameAthlete).mockResolvedValueOnce(null);
    const res = await renameAthleteAction(initial, form({ profileId: PROFILE_ID, name: 'Ada' }));
    expect(res).toEqual({ ok: false, error: NO_ATHLETE_SAVE });
    // A refusal must not even confirm which path exists.
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('refuses when the profile does not resolve, before any write', async () => {
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce(null);
    const res = await renameAthleteAction(initial, form({ profileId: PROFILE_ID, name: 'Ada' }));
    expect(res).toEqual({ ok: false, error: NO_ATHLETE_SAVE });
    expect(renameAthlete).not.toHaveBeenCalled();
  });

  /**
   * The rate-limit refusal is the one with something to do about it, so it does NOT borrow
   * `NO_ATHLETE_SAVE` — that would lie to the parent and blur the 404-never-403 argument. The
   * registry matrix asserts the copy; this asserts that the DAL is untouched, which it cannot see.
   */
  it('a rate-limited call writes nothing', async () => {
    vi.mocked(checkMutationLimit).mockResolvedValueOnce({ allowed: false, reason: 'limited' });
    const res = await renameAthleteAction(initial, form({ profileId: PROFILE_ID, name: 'Ada' }));
    expect(res).toEqual({ ok: false, error: RATE_LIMITED });
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(renameAthlete).not.toHaveBeenCalled();
  });
});
