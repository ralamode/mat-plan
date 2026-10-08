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

import { ONE_HOUSEHOLD_ID, queryMatching, whereOf } from './recording-db';

import { getProfileByPublicId, listProfiles, updateProfileRoutine } from './profiles';

const PROFILE = '019826b4-0000-7000-8000-000000000099';

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
    await listProfiles();
    const householdsAt = recording.queries.findIndex((q) => /from "households"/.test(q.text));
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

describe('no household → dark, not leaky', () => {
  it('every one of the three emits no profiles query and answers empty', async () => {
    const dark = (await import('./recording-db')).createRecordingDb(() => []);
    vi.doMock('./db', () => ({ db: dark.db }));
    vi.resetModules();
    const scoped = await import('./profiles');

    await expect(scoped.listProfiles()).resolves.toEqual([]);
    await expect(scoped.getProfileByPublicId(PROFILE)).resolves.toBeNull();
    await expect(
      scoped.updateProfileRoutine(PROFILE, { version: 1, order: [{ key: 'strength' }] }),
    ).resolves.toBeNull();

    // The ONLY profiles read allowed with no scope is the miss-path probe (ADR 0006 obligation 3),
    // which is an existence check that returns void. Everything else must not have run.
    const profileQueries = dark.queries.filter((q) => /"profiles"/.test(q.text));
    expect(
      profileQueries.every((q) => /select [\s\S]*"public_id"[\s\S]* limit/i.test(q.text)),
    ).toBe(true);
    expect(dark.queries.some((q) => /^update "profiles"/i.test(q.text))).toBe(false);

    vi.doUnmock('./db');
    vi.resetModules();
  });
});
