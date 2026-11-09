import { HOUSEHOLD_ROLE } from '@mat-plan/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PROF-1 b — **the refusal ORDER inside `archiveAthlete`, which nothing else proves.**
 *
 * 🔴 **Why this file exists, stated as the failure it prevents.** `archiveAthlete` does three things
 * in a fixed sequence: resolve the id through the ownership seam, narrow the scope to an
 * `OwnerScope`, then write. **Swap the first two and the action becomes an existence oracle** — a
 * member would get the distinct `OWNER_ONLY_ATHLETE` for an id in *another* household or for one that
 * does not exist, which is precisely the case ADR 0006:348 permits a 403 for *only* when the id is
 * inside the caller's own household.
 *
 * A security lens found that swap passing every suite in the repo:
 *
 * - `db:verify` drives `archiveProfile` — the SQL — and never `archiveAthlete`, the order.
 * - `app/p/profile-actions.test.ts` mocks `archiveAthlete` wholesale, so it proves the action MAPS
 *   `not_owner`, not that the DAL produces it only for an in-household id.
 * - the action's own pre-resolve is a second copy of the check, not a proof of this function's order.
 *
 * So the order is asserted here, at the tier where it lives, by **which of the two refusals comes
 * back** and **whether the writer and the telemetry were reached at all**.
 *
 * The harness is `household.test.ts`'s: a mutable `state` the recording pool reads per query, so one
 * file can be an owner, a member, or a caller whose id resolves to nothing.
 */
const { state, recording, captureMessage } = await vi.hoisted(async () => {
  const { createRecordingDb } = await import('./recording-db');
  const { HOUSEHOLD_ROLE: ROLE } = await import('@mat-plan/shared');
  const state = {
    /** The caller's role, as the membership row reports it. */
    role: ROLE.owner as 'owner' | 'member',
    /**
     * A DISTINCT principal per test. `reportAuthorityRefusal` is bounded once per principal **per
     * process** (it reuses `shouldReportUnresolved`'s module-level Set), so a shared id would make
     * every assertion after the first one depend on test order — the first version did exactly that
     * and two cases failed for the wrong reason.
     */
    principal: 'user_authorityFixture0',
    /** Whether the scoped `profiles` lookup finds the athlete. `false` is unknown/foreign/deleted. */
    profileFound: true,
  };
  const recording = createRecordingDb((sql) => {
    if (/from "household_members"/.test(sql)) return [[4242, state.role]];
    // The profile resolve. ⚠️ Column order is the order of `getProfileByPublicId`'s `.select({…})`:
    // public_id, name, kind, avatar, routine_config, created_at, archived_at, hasEntries.
    if (/from "profiles"/.test(sql) && /select/i.test(sql.slice(0, 20))) {
      return state.profileFound
        ? [
            [
              '019826b4-0000-7000-8000-000000000099',
              'An Athlete',
              'kid',
              null,
              null,
              new Date(),
              null,
              false,
            ],
          ]
        : [];
    }
    // The UPDATE's RETURNING. Reaching it at all is what some assertions below are about.
    return state.profileFound ? [['019826b4-0000-7000-8000-000000000099', new Date()]] : [];
  });
  const { vi: v } = await import('vitest');
  return { state, recording, captureMessage: v.fn() };
});

vi.mock('./db', () => ({ db: recording.db }));
vi.mock('@sentry/nextjs', () => ({ captureMessage }));
vi.mock('./session', () => ({
  getCurrentUser: async () => ({ userId: state.principal }),
}));

/**
 * ⚠️ **`captureMessage` is shared with `reportScopeMiss`**, which `getProfileByPublicId` calls on
 * every miss — so a bare `not.toHaveBeenCalled()` would fail for the wrong reason on the
 * unresolvable-id cases. These two helpers filter by the message each function emits.
 */
const authorityEvents = () =>
  captureMessage.mock.calls.filter(([m]) => m === 'athlete authority refused');
const scopeMissEvents = () =>
  captureMessage.mock.calls.filter(([m]) => String(m).startsWith('profile scope miss'));

import { archiveAthlete, restoreAthlete } from './profiles';

const PROFILE = '019826b4-0000-7000-8000-000000000099';

/** Did the UPDATE run? The scope probe and the resolve are SELECTs; the writer is the only UPDATE. */
const updated = () => recording.queries.some((q) => /^\s*update\s+"profiles"/i.test(q.text));

beforeEach(() => {
  recording.queries.length = 0;
  captureMessage.mockClear();
  state.role = HOUSEHOLD_ROLE.owner;
  state.profileFound = true;
  // A fresh principal, so the per-process report cap cannot leak between cases.
  state.principal = `user_authorityFixture${++principalSeq}`;
});

let principalSeq = 0;

describe('archiveAthlete — the order is the oracle guard (PROF-1 b)', () => {
  it('an OWNER with a live athlete writes', async () => {
    await expect(archiveAthlete(PROFILE)).resolves.toEqual({ ok: true, id: PROFILE });
    expect(updated(), 'the owner path must reach the UPDATE').toBe(true);
    expect(authorityEvents(), 'a successful archive is not a refusal event').toHaveLength(0);
  });

  /**
   * 🔴 **The oracle case.** A member asking about an id that does not resolve in their household —
   * unknown, soft-deleted, or another household's — must get `not_found`, the SAME answer an
   * unauthenticated caller gets. If the role branch ran first they would get `not_owner`, which says
   * "that id is real, it just isn't yours".
   */
  it('a MEMBER with an UNRESOLVABLE id gets not_found — never not_owner', async () => {
    state.role = HOUSEHOLD_ROLE.member;
    state.profileFound = false;
    await expect(archiveAthlete(PROFILE)).resolves.toEqual({ ok: false, reason: 'not_found' });
    expect(updated()).toBe(false);
    expect(
      authorityEvents(),
      'an unresolvable id is not an authority refusal — emitting one would mean the role check ran',
    ).toHaveLength(0);
    // It IS a scope miss, which is the event that path already owed (ADR 0006 obligation 3).
    expect(scopeMissEvents().length, 'the miss still reports as a scope miss').toBeGreaterThan(0);
  });

  it('a MEMBER with their OWN live athlete gets not_owner, and the writer is never reached', async () => {
    state.role = HOUSEHOLD_ROLE.member;
    await expect(archiveAthlete(PROFILE)).resolves.toEqual({ ok: false, reason: 'not_owner' });
    expect(updated(), 'the refusal must happen BEFORE the UPDATE').toBe(false);
  });

  /**
   * The event's payload, pinned the way `household.test.ts` pins `reportScopeMiss`'s. The four
   * omissions are the whole privacy argument for this event existing at all, and they were prose
   * only — a later `contexts: { profileId }` would have shipped unnoticed.
   */
  it('the refusal event carries two tags and NOTHING else', async () => {
    state.role = HOUSEHOLD_ROLE.member;
    await archiveAthlete(PROFILE);
    expect(authorityEvents()).toHaveLength(1);
    const [message, options] = authorityEvents()[0]!;
    expect(message, 'a FIXED string, so Sentry groups these instead of one issue per athlete').toBe(
      'athlete authority refused',
    );
    expect(options).toStrictEqual({
      level: 'warning',
      tags: { authority_outcome: 'owner_only', authority_action: 'archive_profile' },
    });
    // Named individually so a failure says WHICH one leaked.
    const serialised = JSON.stringify(options);
    for (const forbidden of ['An Athlete', PROFILE, '4242', state.principal]) {
      expect(serialised, `the event must not carry ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('is BOUNDED per principal — a second refusal emits nothing', async () => {
    state.role = HOUSEHOLD_ROLE.member;
    await archiveAthlete(PROFILE);
    await archiveAthlete(PROFILE);
    await archiveAthlete(PROFILE);
    expect(
      authorityEvents(),
      'the limiter allows ~24 archives/min per principal, which would drain the quota and bury cross_household',
    ).toHaveLength(1);
  });
});

describe('restoreAthlete — any member, and no authority branch to get wrong', () => {
  it('a MEMBER restores', async () => {
    state.role = HOUSEHOLD_ROLE.member;
    await expect(restoreAthlete(PROFILE)).resolves.toEqual({ ok: true, id: PROFILE });
    expect(updated()).toBe(true);
    expect(authorityEvents(), 'restore has no owner-only refusal to report').toHaveLength(0);
  });

  it('an unresolvable id is not_found, with no write', async () => {
    state.profileFound = false;
    await expect(restoreAthlete(PROFILE)).resolves.toEqual({ ok: false, reason: 'not_found' });
    expect(updated()).toBe(false);
  });

  /** `not_owner` is unreachable here by construction: there is no narrowing in this path. */
  it('never answers not_owner, whatever the role', async () => {
    for (const role of [HOUSEHOLD_ROLE.owner, HOUSEHOLD_ROLE.member] as const) {
      state.role = role;
      const res = await restoreAthlete(PROFILE);
      expect(res.ok ? 'ok' : res.reason).not.toBe('not_owner');
    }
  });
});
