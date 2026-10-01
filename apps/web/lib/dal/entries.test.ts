import { createDb } from '@mat-plan/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// DAL-1: `listEntriesForDay` must scope by THE live-profile predicate, so a soft-deleted profile's
// entries never come back. The predicate itself is proven against a real database in `db:verify`
// (proof (j), `isLiveProfile`); this pins that the read actually USES it. The app DAL cannot run under
// `db:verify` (it is `server-only` and imports the app's env), so the query runs through the real
// Drizzle builder over a recording pg client and the emitted SQL is asserted.
const { queries, recordingPool } = vi.hoisted(() => {
  const queries: { text: string; values: unknown[] }[] = [];
  const recordingPool = {
    // node-postgres is called as query(config) or query(config, params); record both shapes.
    query: async (q: { text: string; values?: unknown[] }, params?: unknown[]) => {
      queries.push({ text: q.text, values: params ?? q.values ?? [] });
      return { rows: [], rowCount: 0, fields: [] };
    },
  };
  return { queries, recordingPool };
});

vi.mock('./db', () => ({
  db: createDb(recordingPool as unknown as Parameters<typeof createDb>[0]),
}));

import { listEntriesForDay } from './entries';

const PROFILE = '019826b4-0000-7000-8000-000000000099';

beforeEach(() => {
  queries.length = 0;
});

describe('listEntriesForDay — ownership scope (DAL-1)', () => {
  it('excludes a soft-deleted profile: the WHERE carries profiles.deleted_at IS NULL', async () => {
    await listEntriesForDay(PROFILE, '2026-09-30');
    expect(queries).toHaveLength(1);
    const { text, values } = queries[0];
    const where = text.slice(text.toLowerCase().indexOf(' where '));
    expect(where).toContain('"profiles"."deleted_at" is null');
    expect(where).toContain('"profiles"."public_id" = $');
    expect(where).toContain('"entries"."deleted_at" is null');
    expect(values).toContain(PROFILE);
  });
});
