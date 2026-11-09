import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * TEN-1 1b — the app DAL's two profile-resolution reads carry the household conjunct, **bound to the
 * household the resolver found**.
 *
 * ⚠️ **This is the SECOND vehicle, not the picker's proof.** An emitted-SQL assertion proves the
 * builder appended a conjunct; it says nothing about which rows come back. ADR 0006's named
 * obligation for the picker is a real database with two households × two profiles, and that lives in
 * `db:verify` (`householdProfileRows`, both directions). This file catches the different mistake:
 * a DAL function that resolves a scope and then forgets to use it, or uses a different one.
 *
 * The harness (`./recording-db`) answers the households probe with one row, because every scoped
 * read now resolves `getHouseholdScope()` first — a pool that answered every query with zero rows
 * would short-circuit the function and the query under test would never be emitted at all.
 */
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

import { PROFILE_KIND } from '@mat-plan/shared';

import { ONE_HOUSEHOLD_ID, queryMatching, whereOf } from './recording-db';

import {
  createAthlete,
  getProfileByPublicId,
  listProfiles,
  renameAthlete,
  updateProfileRoutine,
} from './profiles';

const PROFILE = '019826b4-0000-7000-8000-000000000099';
/** A device-generated key, distinct from `PROFILE` so "returned the public id" cannot pass by accident. */
const CLIENT_ID = '019826b4-0000-7000-8000-0000000000c1';
const ADD_INPUT = { name: 'Ada', kind: PROFILE_KIND.kid, clientId: CLIENT_ID } as const;

beforeEach(() => {
  recording.queries.length = 0;
});

describe('listProfiles — the picker is the whole isolation boundary (ADR 0006, option A)', () => {
  it('scopes by household_id, bound to the resolved household', async () => {
    await listProfiles();
    const picker = queryMatching(recording, /from "profiles"/);
    const where = whereOf(picker);
    expect(where).toContain('"profiles"."household_id" = $');
    expect(where).toContain('"profiles"."deleted_at" is null');
    expect(picker.values).toContain(ONE_HOUSEHOLD_ID);
  });

  it('resolves the household BEFORE reading profiles', async () => {
    // Order matters: a read that ran first and filtered after would have already left the database
    // with every household's rows.
    //
    // ⚠️ The resolver's probe is the MEMBERSHIP lookup since `AUTH-1` 1c-4 — `from
    // "household_members" inner join "households"`. Matching `from "households"` finds nothing and
    // this reads as "the household was never resolved", which is a confusing way to be told the
    // regex is stale.
    await listProfiles();
    const householdsAt = recording.queries.findIndex((q) =>
      /from "household_members"/.test(q.text),
    );
    const profilesAt = recording.queries.findIndex((q) => /from "profiles"/.test(q.text));
    expect(householdsAt).toBeGreaterThanOrEqual(0);
    expect(householdsAt).toBeLessThan(profilesAt);
  });
});

describe('getProfileByPublicId — the gate', () => {
  it('scopes by public_id, soft-delete AND household, bound to the resolved household', async () => {
    await getProfileByPublicId(PROFILE);
    const gate = queryMatching(recording, /from "profiles"/);
    const where = whereOf(gate);
    expect(where).toContain('"profiles"."public_id" = $');
    expect(where).toContain('"profiles"."deleted_at" is null');
    expect(where).toContain('"profiles"."household_id" = $');
    expect(gate.values).toContain(PROFILE);
    expect(gate.values).toContain(ONE_HOUSEHOLD_ID);
  });

  it('a non-UUID id emits NO query at all (a garbage segment is a 404, never a 500)', async () => {
    await expect(getProfileByPublicId('not-a-uuid')).resolves.toBeNull();
    expect(recording.queries).toEqual([]);
  });
});

describe('updateProfileRoutine — the write uses the SAME predicate as the read', () => {
  it('scopes the UPDATE by household_id too', async () => {
    await updateProfileRoutine(PROFILE, { version: 1, order: [{ key: 'strength' }] });
    const update = queryMatching(recording, /^update "profiles"/i);
    const where = whereOf(update);
    expect(where).toContain('"profiles"."public_id" = $');
    expect(where).toContain('"profiles"."deleted_at" is null');
    expect(where).toContain('"profiles"."household_id" = $');
    expect(update.values).toContain(ONE_HOUSEHOLD_ID);
  });
});

/**
 * PROF-1 a-r. ⚠️ **This is the SECOND vehicle, exactly as this file's header says.** The emitted-SQL
 * assertion proves the builder appended the conjunct bound to the resolved household; what it cannot
 * prove is which rows a real Postgres then updates. Acceptance criterion 4 is a ROW COUNT ("write
 * nothing"), so its proof is `db:verify` → "PROF-1 a-r", which runs `renameProfile` against two real
 * households. Neither alone is the claim.
 */
describe('renameAthlete — the rename uses the SAME predicate as the read', () => {
  it('scopes the UPDATE by public_id, live, AND household_id', async () => {
    await renameAthlete(PROFILE, 'Renamed');
    const update = queryMatching(recording, /^update "profiles"/i);
    const where = whereOf(update);
    expect(where).toContain('"profiles"."public_id" = $');
    expect(where).toContain('"profiles"."deleted_at" is null');
    expect(where).toContain('"profiles"."household_id" = $');
    expect(update.values).toContain(ONE_HOUSEHOLD_ID);
  });

  /**
   * 🔴 **`archived_at` must NOT be a conjunct.** An archived athlete can still be renamed — archive
   * is "not currently training", not a lock (`schema.ts` → `profiles.archivedAt`). If this appears,
   * a typo in an archived athlete's name has become unfixable without restoring them first, and
   * `isLiveProfile` has quietly grown a UX filter.
   */
  it('does not filter on archived_at', async () => {
    await renameAthlete(PROFILE, 'Renamed');
    expect(whereOf(queryMatching(recording, /^update "profiles"/i))).not.toContain('archived_at');
  });

  /** It writes the name and the server-side `updated_at`, and nothing else — not `kind`. */
  it('sets name and updated_at, and never kind', async () => {
    await renameAthlete(PROFILE, 'Renamed');
    const update = queryMatching(recording, /^update "profiles"/i);
    const setClause = update.text.slice(0, update.text.toLowerCase().indexOf(' where '));
    expect(setClause).toContain('"name" = $');
    expect(setClause).toContain('"updated_at" = now()');
    expect(setClause).not.toContain('"kind"');
    expect(update.values).toContain('Renamed');
  });

  /** The returned shape is the public id only — never a row the caller could render as a name. */
  it('returns the public id, not a row', async () => {
    await renameAthlete(PROFILE, 'Renamed');
    expect(queryMatching(recording, /^update "profiles"/i).text).toMatch(/returning "public_id"/i);
  });
});

/**
 * PROF-1 a-1w — `createAthlete`, the first athlete write with **no id to resolve**.
 *
 * ⚠️ **What this tier can and cannot say.** `scoped.test.ts` already proves `createAthlete` resolves
 * a scope at all (removing the `getHouseholdScope()` await makes it name `profiles.ts#createAthlete`
 * — probed, not assumed). `db:verify`'s two-household block proves which ROWS come back, and
 * mutation patches `20`–`23` prove each conjunct is load-bearing. What is left for this file is the
 * mistake neither can see: a scope resolved and then used in only SOME of the four queries, or an
 * INSERT that takes a tenant or a `public_id` from the caller.
 */
describe("createAthlete — all THREE of the create's queries carry the resolved household", () => {
  it('the client_id read is scoped, and bound to the household the resolver found', async () => {
    await createAthlete(ADD_INPUT);
    const read = queryMatching(recording, /select "public_id" from "profiles"/i);
    expect(whereOf(read)).toMatch(/"household_id" = \$\d/i);
    expect(read.values).toContain(ONE_HOUSEHOLD_ID);
  });

  it('the quota count is scoped too — an unscoped count would be the GLOBAL athlete count', async () => {
    await createAthlete(ADD_INPUT);
    const count = queryMatching(recording, /select "id" from "profiles"/i);
    expect(whereOf(count)).toMatch(/"household_id" = \$\d/i);
    expect(count.values).toContain(ONE_HOUSEHOLD_ID);
  });

  it('the INSERT binds the RESOLVED household, which never arrives in the input', async () => {
    await createAthlete(ADD_INPUT);
    const insert = queryMatching(recording, /^insert into "profiles"/i);
    expect(insert.text).toMatch(/"household_id"/i);
    expect(insert.values).toContain(ONE_HOUSEHOLD_ID);
    // The input has no household field at all; the only way the id is here is the resolver.
    expect(Object.keys(ADD_INPUT)).not.toContain('householdId');
  });

  it("mints public_id server-side — a crafted body cannot choose an athlete's URL", async () => {
    await createAthlete(ADD_INPUT);
    const insert = queryMatching(recording, /^insert into "profiles"/i);
    expect(insert.text).toMatch(/"public_id"/i);
    // Every submitted value is in `ADD_INPUT`; the public id is the one bound value that is not.
    const minted = insert.values.filter(
      (v) => typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v) && v !== CLIENT_ID,
    );
    expect(minted).toHaveLength(1);
    expect(minted[0]).not.toBe(CLIENT_ID);
  });

  it('names client_id as the conflict target — never a bare do-nothing', async () => {
    await createAthlete(ADD_INPUT);
    // A bare `onConflictDoNothing()` would swallow a `public_id` collision too, and the re-select
    // would report it to a parent as "couldn’t add this athlete".
    expect(queryMatching(recording, /^insert into "profiles"/i).text).toMatch(
      /on conflict \("client_id"\) do nothing/i,
    );
  });

  it('the client_id never comes back out — the caller is handed the public id', async () => {
    const rec = (await import('./recording-db')).createRecordingDb((sql) =>
      /from "household_members"/.test(sql)
        ? [[ONE_HOUSEHOLD_ID, 'owner']]
        : /select "public_id" from "profiles"/i.test(sql)
          ? [[PROFILE]]
          : [],
    );
    vi.doMock('./db', () => ({ db: rec.db }));
    vi.resetModules();
    const scoped = await import('./profiles');

    // The replay path: the key is spent, so the existing row's public id is the answer.
    await expect(scoped.createAthlete(ADD_INPUT)).resolves.toEqual({ ok: true, id: PROFILE });

    vi.doUnmock('./db');
    vi.resetModules();
  });
});

describe('no household → dark, not leaky', () => {
  it('every one of the FIVE emits no profiles query and answers empty', async () => {
    const dark = (await import('./recording-db')).createRecordingDb(() => []);
    vi.doMock('./db', () => ({ db: dark.db }));
    vi.resetModules();
    const scoped = await import('./profiles');

    await expect(scoped.listProfiles()).resolves.toEqual([]);
    await expect(scoped.getProfileByPublicId(PROFILE)).resolves.toBeNull();
    await expect(
      scoped.updateProfileRoutine(PROFILE, { version: 1, order: [{ key: 'strength' }] }),
    ).resolves.toBeNull();
    // PROF-1 a-r: a rename with no resolved household must not reach the database either. Without
    // this the new writer would be the one path in the file that fails OPEN of the scope check.
    await expect(scoped.renameAthlete(PROFILE, 'Renamed')).resolves.toBeNull();
    // PROF-1 a-1w: the create has NO id to resolve, so the scope check is its only authorization
    // decision — the one function in the file where failing open would insert a row owned by
    // nobody. `scoped.test.ts` proves the resolve happens; this proves it REFUSES on a miss.
    await expect(scoped.createAthlete(ADD_INPUT)).resolves.toEqual({
      ok: false,
      reason: 'no_scope',
    });

    // The ONLY profiles read allowed with no scope is the miss-path probe (ADR 0006 obligation 3),
    // which is an existence check that returns void. Everything else must not have run.
    const profileQueries = dark.queries.filter((q) => /"profiles"/.test(q.text));
    expect(
      profileQueries.every((q) => /select [\s\S]*"public_id"[\s\S]* limit/i.test(q.text)),
    ).toBe(true);
    expect(dark.queries.some((q) => /^update "profiles"/i.test(q.text))).toBe(false);
    expect(dark.queries.some((q) => /^insert into "profiles"/i.test(q.text))).toBe(false);

    vi.doUnmock('./db');
    vi.resetModules();
  });
});
