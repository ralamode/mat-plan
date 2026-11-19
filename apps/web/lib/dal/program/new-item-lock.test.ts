import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The order `newItem` takes its household lock in: `lock_timeout` first, in the same transaction.
 * `db:verify` proves the setting is set (mutation 448); only the emitted SQL shows it comes BEFORE
 * the lock, and a timeout set after the wait bounds nothing. The athlete add is pinned the same way
 * in `../profiles.test.ts`.
 */
const { recording } = await vi.hoisted(async () => {
  const { createRecordingDb } = await import('../recording-db');
  return { recording: createRecordingDb() };
});

vi.mock('../db', () => ({ db: recording.db }));
// The scope resolver reads the principal first; `../session` is the seam (see `../profiles.test.ts`).
vi.mock('../session', () => ({
  getCurrentUser: async () => ({ userId: 'user_recordingDbFixturePrincipal' }),
}));

import { LOCK_TIMEOUT } from '@mat-plan/db';
import { TRACKING_TYPE } from '@mat-plan/shared';

import { newHouseholdItem } from './writes';

beforeEach(() => {
  recording.queries.length = 0;
});

describe('newItem — the lock wait is bounded before it starts', () => {
  it('sets lock_timeout (transaction-local) after begin and before the household-items lock', async () => {
    // The recording pool answers the item reads with no rows, so the add goes on to insert against a
    // fake; how it ends is not this test's question, only the order of what it emitted on the way.
    await newHouseholdItem({ name: 'Order Probe Drill', trackingType: TRACKING_TYPE.reps }).catch(
      () => undefined,
    );
    const at = (re: RegExp) => recording.queries.findIndex((q) => re.test(q.text));
    const begin = at(/^begin/i);
    const timeout = at(/set_config\('lock_timeout', \$1, true\)/);
    const lock = at(/pg_advisory_xact_lock/);
    expect(begin, 'no transaction was opened').toBeGreaterThanOrEqual(0);
    expect(lock, 'no lock was taken').toBeGreaterThan(begin);
    expect(timeout, 'no transaction-local lock_timeout was set').toBeGreaterThan(begin);
    expect(timeout, 'lock_timeout was set after the lock').toBeLessThan(lock);
    expect(recording.queries[timeout]!.values).toEqual([LOCK_TIMEOUT]);
  });
});
