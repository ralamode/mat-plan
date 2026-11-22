import { ENTRY_STATUS, PROFILE_NOT_FOUND } from '@mat-plan/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// DAL-1 / TEN-1 1b: `listEntriesForDay` must scope by THE live-profile predicate — so a soft-deleted
// profile's entries never come back, and (since TEN-1) neither do another household's. The predicate
// itself is proven against a real database in `db:verify` (the TEN-1 read matrix, both directions);
// this pins that the read actually USES it. The app DAL cannot run under `db:verify` (it is
// `server-only` and imports the app's env), so the query runs through the real Drizzle builder over a
// recording pg client and the emitted SQL is asserted.
//
// The harness lives in `./recording-db` since TEN-1 1b: `profiles.test.ts` needed the identical
// client and a second copy is the occurrence AGENTS.md makes the trigger to extract.
const { recording } = await vi.hoisted(async () => {
  const { createRecordingDb } = await import('./recording-db');
  return { recording: createRecordingDb() };
});

vi.mock('./db', () => ({ db: recording.db }));
// AUTH-1 1c-4: the resolver consults the PRINCIPAL first, and under vitest `getCurrentUser()` has no
// Clerk keys and no bypass id — so without this every case falls to state B, the scope is `null`,
// and the query under test is never emitted. `./session` is the seam rather than the three-mock
// Clerk stack (`@clerk/nextjs`, `@/lib/clerk`, `@/lib/env`): `getCurrentUser`'s own contract is
// covered by `session.test.ts`, and this suite is not testing auth.
const FIXTURE_PRINCIPAL = 'user_recordingDbFixturePrincipal';
vi.mock('./session', () => ({ getCurrentUser: async () => ({ userId: FIXTURE_PRINCIPAL }) }));

import { ONE_HOUSEHOLD_ID, queryMatching, whereOf } from './recording-db';

import { listEntriesForDay, logCheckinEntries } from './entries';

const PROFILE = '019826b4-0000-7000-8000-000000000099';

beforeEach(() => {
  recording.queries.length = 0;
});

describe('listEntriesForDay — ownership scope (DAL-1 + TEN-1)', () => {
  it('carries profiles.deleted_at IS NULL, the public id, and the household conjunct', async () => {
    await listEntriesForDay(PROFILE, '2026-09-30');
    const entries = queryMatching(recording, /from "entries"/);
    const where = whereOf(entries);
    expect(where).toContain('"profiles"."deleted_at" is null');
    expect(where).toContain('"profiles"."public_id" = $');
    expect(where).toContain('"entries"."deleted_at" is null');
    // TEN-1: the third conjunct, bound to the household the resolver found — not merely present.
    expect(where).toContain('"profiles"."household_id" = $');
    expect(entries.values).toContain(PROFILE);
    expect(entries.values).toContain(ONE_HOUSEHOLD_ID);
  });

  it('emits NO entries query at all when no household resolves', async () => {
    // The dark-app path. `getHouseholdScope()` → null must short-circuit BEFORE the read, or a
    // zero-household database would run an unscoped query and the "dark, not leaky" claim is prose.
    const dark = (await import('./recording-db')).createRecordingDb(() => []);
    vi.doMock('./db', () => ({ db: dark.db }));
    vi.resetModules();
    const { listEntriesForDay: scoped } = await import('./entries');
    await expect(scoped(PROFILE, '2026-09-30')).resolves.toEqual([]);
    expect(dark.queries.filter((q) => /from "entries"/.test(q.text))).toEqual([]);
    vi.doUnmock('./db');
    vi.resetModules();
  });
});

// Tech debt "Two reads of a logged row's live sets": the day read's sets come through `readLiveSets`,
// the read mutation 172 guards in `db:verify`. `db:verify` cannot run this DAL, so these pin from the
// emitted SQL that the read here IS that one (its live-set filter, then quantities of the returned
// set ids) and that no other module imports it.
describe('listEntriesForDay — sets through readLiveSets', () => {
  const ENTRY_ID = 77;
  const SET_ID = 901;
  const SET_PUBLIC_ID = '019826b4-0000-7000-8000-0000000000aa';

  it('reads live sets by the entry ids, then quantities of those set ids, into the DTO', async () => {
    const shared = await import('./recording-db');
    const withSet = shared.createRecordingDb((sql) => {
      // Rows are arrays in `.select({…})` order: the entry's internal id first, `movementId` sixth.
      if (/from "entries"/.test(sql)) {
        const row: unknown[] = Array.from({ length: 22 }, () => null);
        row[0] = ENTRY_ID;
        row[1] = '019826b4-0000-7000-8000-0000000000e1';
        row[3] = 'count';
        row[5] = 5;
        row[7] = ENTRY_STATUS.done;
        return [row];
      }
      if (/from "entry_sets"/.test(sql)) {
        return [[SET_ID, ENTRY_ID, SET_PUBLIC_ID, 0, 5, false, false, ENTRY_STATUS.done]];
      }
      return shared.oneHouseholdThenEmpty(sql);
    });
    vi.doMock('./db', () => ({ db: withSet.db }));
    vi.resetModules();
    const { listEntriesForDay: read } = await import('./entries');
    const [entry] = await read(PROFILE, '2026-09-30');

    const sets = queryMatching(withSet, /from "entry_sets"/);
    expect(whereOf(sets)).toContain('"entry_sets"."deleted_at" is null');
    expect(sets.values).toContain(ENTRY_ID);
    const quantities = queryMatching(withSet, /from "entry_set_quantities"/);
    expect(whereOf(quantities)).toContain('"entry_set_quantities"."deleted_at" is null');
    expect(quantities.values).toContain(SET_ID);
    expect(entry?.sets).toEqual([
      {
        publicId: SET_PUBLIC_ID,
        idx: 0,
        reps: 5,
        isBodyweight: false,
        isBand: false,
        quantities: [],
        status: ENTRY_STATUS.done,
      },
    ]);
    vi.doUnmock('./db');
    vi.resetModules();
  });
});

// TEN-1 1c: `logCheckinEntries` resolves the profile itself (it is not behind a `packages/db` write
// core), so its predicate is an app-DAL site `db:verify` cannot execute — the same case as
// `listEntriesForDay`, proved the same way. The predicate it uses, `isLiveProfile`, IS proved against
// a real database in both directions by the TEN-1 matrix (via `ownedEntryIds`, which is the same
// function); what these two cases pin is that the check-in writer actually calls it.
describe('logCheckinEntries — ownership scope (TEN-1 1c)', () => {
  const ITEMS = [
    {
      clientId: '019826b4-0000-7000-8000-00000000a001',
      activityKey: 'sleep',
      metricKey: null,
      value: 1,
    },
  ] as const;

  it('resolves the profile through the household-scoped predicate', async () => {
    // The profile resolve is the FIRST query after the households probe, and the only one that can
    // run: the recording pool answers it with zero rows, so the writer throws before the INSERT.
    await expect(logCheckinEntries({ profilePublicId: PROFILE, day: '2026-09-30', items: ITEMS })) //
      .rejects.toThrow(PROFILE_NOT_FOUND);
    const resolve = queryMatching(recording, /from "profiles"/);
    const where = whereOf(resolve);
    expect(where).toContain('"profiles"."public_id" = $');
    expect(where).toContain('"profiles"."deleted_at" is null');
    // TEN-1: the third conjunct, bound to the household the resolver found — not merely present.
    expect(where).toContain('"profiles"."household_id" = $');
    expect(resolve.values).toContain(PROFILE);
    expect(resolve.values).toContain(ONE_HOUSEHOLD_ID);
  });

  it('emits NO profiles query at all when no household resolves', async () => {
    // The dark-app path: an unresolvable scope must take the SAME path as an unknown profile, and it
    // must do so BEFORE the read — a zero-household database running an unscoped resolve is exactly
    // the "dark, not leaky" claim being prose.
    const dark = (await import('./recording-db')).createRecordingDb(() => []);
    vi.doMock('./db', () => ({ db: dark.db }));
    vi.resetModules();
    const { logCheckinEntries: scoped } = await import('./entries');
    await expect(
      scoped({ profilePublicId: PROFILE, day: '2026-09-30', items: ITEMS }),
    ).rejects.toThrow(PROFILE_NOT_FOUND);
    expect(dark.queries.filter((q) => /from "profiles"/.test(q.text))).toEqual([]);
    vi.doUnmock('./db');
    vi.resetModules();
  });
});

// 🔴 **Retired deliberately (LEGACY-1 PR C1, 2026-11-21): the catalog-write-order test.** It pinned
// that `logStrengthSession`'s find-or-create INSERT committed before the legacy session transaction
// opened, and `TEN-2b-1` said it "must be changed deliberately, never deleted". It guarded that one
// creator alone, and the creator is gone: FAM-1 12f removed its last caller and LEGACY-1 deletes it.
// The live creator, `newItem` (`packages/db/src/writers/program/new-item.ts`), creates in ONE
// transaction and returns every refusal before its insert, so it has no created-then-refused row to
// order. `TEN-2b-1` closes as overtaken; the reasoning is the plan's
// (docs/plans/legacy-1-retire-strength-path.md, "The rows this settles"). The PICK-1 PR 2
// ids-before-inserts pins went with the same function.
