import { BODYWEIGHT_DAY_UNIQUE_INDEX, createDb } from '@mat-plan/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// V1-24 1d: the same-day unique index can refuse a CONCURRENT replay of this very submit (it passed
// the client_id arbiter before the original committed). That must still answer success. The DAL
// runs the real Drizzle statements over a programmable pg client.
const { state, pool } = vi.hoisted(() => {
  const state = { insertThrows: false, ownRow: false };
  const pool = {
    query: async (q: { text: string }) => {
      const sql = q.text.toLowerCase();
      if (sql.startsWith('select') && sql.includes('from "profiles"'))
        return { rows: [[1]], rowCount: 1, fields: [] };
      if (sql.startsWith('insert into "entries"')) {
        if (state.insertThrows) {
          throw Object.assign(new Error('duplicate key'), {
            code: '23505',
            constraint: 'uq_entries_profile_day_bodyweight',
          });
        }
        return { rows: [], rowCount: 0, fields: [] };
      }
      if (sql.startsWith('select') && sql.includes('from "entries"')) {
        return state.ownRow
          ? { rows: [['own-public-id']], rowCount: 1, fields: [] }
          : { rows: [], rowCount: 0, fields: [] };
      }
      return { rows: [], rowCount: 0, fields: [] };
    },
  };
  return { state, pool };
});

vi.mock('./db', () => ({ db: createDb(pool as unknown as Parameters<typeof createDb>[0]) }));
vi.mock('./catalog', () => ({
  getActivityTypeIdByKey: async () => 1,
  assertMetricKeyExists: async (k: string) => k,
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
  state.insertThrows = false;
  state.ownRow = false;
});

describe('logBodyweight — the same-day index (V1-24 1d)', () => {
  it('pins the constraint name the fake throws', () => {
    expect(BODYWEIGHT_DAY_UNIQUE_INDEX).toBe('uq_entries_profile_day_bodyweight');
  });

  it("another device's weight → dayTaken", async () => {
    state.insertThrows = true;
    await expect(logBodyweight(ARGS)).resolves.toEqual({ dayTaken: true });
  });

  it('a concurrent replay of THIS submit (its own row exists) → success, not dayTaken', async () => {
    state.insertThrows = true;
    state.ownRow = true;
    await expect(logBodyweight(ARGS)).resolves.toEqual({ id: 'own-public-id' });
  });
});
