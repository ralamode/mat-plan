import { ENTRY_STATUS } from '@mat-plan/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HOUSEHOLD_ROLE } from '@mat-plan/shared';

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
      .rejects.toThrow('Profile not found');
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
    ).rejects.toThrow('Profile not found');
    expect(dark.queries.filter((q) => /from "profiles"/.test(q.text))).toEqual([]);
    vi.doUnmock('./db');
    vi.resetModules();
  });
});

// TEN-1 1d review: `db:verify`'s "refused write survives" case is a FIXTURE — it calls
// `findOrCreateMovement` itself before the refused `writeStrengthSession`, so it shows what that call
// order does to the database but cannot fail if the DAL's order changed. This pins the order where the
// DAL actually runs: the movement INSERT is emitted before the session transaction BEGINs (so a
// ROLLBACK cannot take it back), and the in-transaction profile resolve — the household seam — then
// refuses. `TEN-2b-1` may move the find-or-create inside the transaction, after the resolve; this
// test is what has to change then, deliberately — TEN-2b itself did NOT move it.
describe('logStrengthSession — catalog write order (TEN-1 1d)', () => {
  it('find-or-create runs, and commits, before the refused write', async () => {
    // ⚠️ TEN-2b: the resolver now issues THREE `movements` selects — the global-namespace lookup,
    // this household's own, then the re-resolve after the INSERT. A stub that answers the FIRST one
    // with an id makes the resolver short-circuit at step 1, emit no INSERT, and this test's whole
    // point (`insertMovement` ≥ 0, and `BEGIN` after it) silently stops being exercised. So the two
    // namespace lookups MISS and only the post-INSERT re-resolve resolves.
    // ⚠️ Do NOT "fix" a failure here by dropping the `insertMovement` assertion: it is the only test
    // in the repo pinning that the catalog write COMMITS before the session transaction opens, which
    // `db:verify` cannot prove (its version is a fixture that calls find-or-create itself).
    let movementSelects = 0;
    const rows = (await import('./recording-db')).createRecordingDb((sql) => {
      // The resolver's probe since 1c-4 — see `recording-db.ts`'s `oneHouseholdThenEmpty`.
      // Both columns the membership query selects — a one-column row mints `role: undefined`,
      // which `makeHouseholdScope` now rejects outright (PROF-1 b-s).
      if (/from "household_members"/.test(sql)) return [[ONE_HOUSEHOLD_ID, HOUSEHOLD_ROLE.owner]];
      if (/from "activity_types"/.test(sql)) return [[1, null]]; // { id, defaultUnit }
      if (/^select .* from "movements"/.test(sql)) {
        movementSelects += 1;
        return movementSelects >= 3 ? [[77]] : []; // 1 = global miss, 2 = household miss, 3 = found
      }
      return []; // …and the in-transaction profile resolve finds nothing → the seam refuses
    });
    vi.doMock('./db', () => ({ db: rows.db }));
    vi.resetModules();
    const { logStrengthSession: write } = await import('./entries');

    await expect(
      write({
        profilePublicId: PROFILE,
        sessionType: 'strength',
        clientId: '019826b4-0000-7000-8000-00000000b001',
        day: '2026-09-30',
        movements: [
          {
            movementName: 'TEN-1 Refused Lift',
            unit: 'lb',
            clientId: '019826b4-0000-7000-8000-00000000b002',
            status: ENTRY_STATUS.done,
            sets: [{ reps: 5, weight: 100 }],
          },
        ],
      }),
    ).rejects.toThrow('Profile not found');

    const texts = rows.queries.map((q) => q.text.toLowerCase());
    const insertMovement = texts.findIndex((t) => t.startsWith('insert into "movements"'));
    const begin = texts.findIndex((t) => t === 'begin');
    const resolve = texts.findIndex((t, i) => i > begin && /from "profiles"/.test(t));
    expect(insertMovement, 'findOrCreateMovementId was called').toBeGreaterThanOrEqual(0);
    expect(begin, 'writeStrengthSession opened its transaction').toBeGreaterThan(insertMovement);
    expect(resolve, 'the in-transaction profile resolve ran after it').toBeGreaterThan(begin);
    expect(texts, 'the refused session rolled back').toContain('rollback');
    vi.doUnmock('./db');
    vi.resetModules();
  });
});

// PICK-1 PR 2 — **ids before inserts**, pinned where the DAL actually runs it.
//
// `db:verify` proves the REFUSAL (case (a): zero new rows across two households) against a real
// database. What it cannot see is the emitted statement ORDER inside one request, which is the thing
// a later refactor would break silently: phase 2 is the only phase that writes, so if the two phases
// swapped, a session naming one bad id plus one novel typed name would leave that name's catalog row
// behind for ever with no session to explain it. These two tests are the order's only unit-level pin.
describe('logStrengthSession — ids resolve before any insert (PICK-1 PR 2)', () => {
  const idMovement = (movementPublicId: string, clientId: string) => ({
    movementPublicId,
    movementName: 'A label the id overrides',
    unit: 'lb' as const,
    clientId,
    status: ENTRY_STATUS.done,
    sets: [{ reps: 5, weight: 100 }],
  });

  /**
   * A recording db whose `movements` answers are split by WHICH lookup is asking:
   * the public-id resolve (its WHERE names `public_id`) vs the slug lookups find-or-create makes.
   * `publicIdRow` `null` is the refusal case.
   *
   * 🔴 **The slug lookups MISS twice and then resolve**, exactly as the TEN-1 order test above sets
   * them up: the two namespace lookups miss so find-or-create reaches its INSERT, and the
   * post-insert re-resolve succeeds so it RETURNS rather than throwing "movement not found after
   * upsert". That matters for what a failure says. Probed: with the two phases swapped, this shape
   * reddens the `INSERT INTO "movements"` assertion — the thing the test is for — whereas a stub
   * whose slug lookups always miss reddens the `rejects.toThrow` first, with a message about an
   * upsert, telling the next reader the wrong cause.
   */
  const dbWithMovements = async (publicIdRow: unknown[] | null) => {
    let slugLookups = 0;
    return (await import('./recording-db')).createRecordingDb((sql) => {
      if (/from "household_members"/.test(sql)) return [[ONE_HOUSEHOLD_ID, HOUSEHOLD_ROLE.owner]];
      if (/from "activity_types"/.test(sql)) return [[1, null]];
      if (/^select .* from "movements"/.test(sql)) {
        if (/"public_id"/.test(sql)) return publicIdRow === null ? [] : [publicIdRow];
        slugLookups += 1;
        return slugLookups >= 3 ? [[88]] : []; // 1 = global miss, 2 = own miss, 3 = found after INSERT
      }
      return [];
    });
  };

  it('a refused id commits no typed sibling: no INSERT, no BEGIN', async () => {
    const rows = await dbWithMovements(null);
    vi.doMock('./db', () => ({ db: rows.db }));
    vi.resetModules();
    const { logStrengthSession: write } = await import('./entries');
    const { MOVEMENT_NOT_AVAILABLE } = await import('@mat-plan/db');

    await expect(
      write({
        profilePublicId: PROFILE,
        sessionType: 'strength',
        clientId: '019826b4-0000-7000-8000-00000000c001',
        day: '2026-09-30',
        movements: [
          idMovement(
            '019826b4-0000-7000-8000-00000000c0ff',
            '019826b4-0000-7000-8000-00000000c002',
          ),
          {
            // A name that slugs to no seeded row, so phase 2 would genuinely insert.
            movementName: 'PICK-1 Novel Typed Sibling',
            unit: 'lb',
            clientId: '019826b4-0000-7000-8000-00000000c003',
            status: ENTRY_STATUS.done,
            sets: [{ reps: 5, weight: 100 }],
          },
        ],
      }),
    ).rejects.toThrow(MOVEMENT_NOT_AVAILABLE);

    const texts = rows.queries.map((q) => q.text.toLowerCase());
    expect(
      texts.filter((t) => t.startsWith('insert into "movements"')),
      'a refused id must not commit the typed sibling',
    ).toHaveLength(0);
    expect(texts, 'and no session transaction opened').not.toContain('begin');
  });

  it('an id-only session reaches find-or-create not at all (criterion 17)', async () => {
    const rows = await dbWithMovements([77, 'Back Squat', 'back_squat']);
    vi.doMock('./db', () => ({ db: rows.db }));
    vi.resetModules();
    const { logStrengthSession: write } = await import('./entries');

    // The profile resolve inside the transaction finds nothing (the stub's fallthrough), so the write
    // is refused — irrelevant here: the assertion is about the CATALOG, which ran first.
    await expect(
      write({
        profilePublicId: PROFILE,
        sessionType: 'strength',
        clientId: '019826b4-0000-7000-8000-00000000c011',
        day: '2026-09-30',
        movements: [
          idMovement(
            '019826b4-0000-7000-8000-00000000c0aa',
            '019826b4-0000-7000-8000-00000000c012',
          ),
        ],
      }),
    ).rejects.toThrow();

    const texts = rows.queries.map((q) => q.text.toLowerCase());
    expect(
      texts.filter((t) => t.startsWith('insert into "movements"')),
      'the id path must never mint a catalog row',
    ).toHaveLength(0);
    // And it asked the public-id resolver exactly once — not a slug lookup wearing a different hat.
    expect(
      texts.filter((t) => /^select .* from "movements"/.test(t) && /"public_id"/.test(t)),
    ).toHaveLength(1);
  });

  afterEach(() => {
    vi.doUnmock('./db');
    vi.resetModules();
  });
});
