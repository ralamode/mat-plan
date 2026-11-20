import {
  ACTIVITY_TYPE_KEYS,
  BODYWEIGHT_UNITS,
  E2E_SESSION_BYPASS_USER,
  isoDayDiff,
  METRIC_KEYS,
  newId,
  ROUTINE_VERSION,
  PRACTICE_AMEND_REFUSAL,
  PRACTICE_MINUTES_MAX,
  PRACTICE_MINUTES_MIN,
  type EditPracticeInput,
} from '@mat-plan/shared';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// INTEGRATION TIER (see docs/definition-of-done.md → Test pyramid). These exercise
// the Server Actions end-to-end THROUGH their zod validation and typed-envelope
// contract down to the DAL boundary — the mandatory bad-body → zod-reject and
// happy-path + ownership cases — without a live Postgres. Mock the boundaries so
// the action runs as a plain async fn (AGENTS.md gotcha: Server Actions aren't
// HTTP routes — test the function, mock the DAL + cache). Real-DB coverage of the
// same write path lives in the Playwright smoke E2E (the `e2e` CI job, V0-11).
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
/**
 * 🔴 **`redirect` THROWS, exactly as Next's does, and that is not cosmetic.** A `vi.fn()` returning
 * `undefined` lets an action fall off the end and return `undefined` — so a `redirect` accidentally
 * placed inside a `try` would pass every test here while silently doing nothing in production. The
 * sentinel also means a refusal row can assert "the action returned an envelope" and know the
 * redirect did not fire.
 */
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
  RedirectType: { replace: 'replace', push: 'push' },
}));
// All three writers now resolve the active-tz today (getActiveLocalDay → cookies()) to bound
// the declared `day` ±1 (V1-6c). No `tz` cookie → DEFAULT_TIME_ZONE, so the harness's default
// `day` (localDayIso(DEFAULT_TIME_ZONE)) lands within bound. File-wide, not per-suite.
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock('@/lib/dal/entries', () => ({
  logBodyweight: vi.fn(async () => ({ id: 'entry-pub-id' })),
  // V1-24 PR 1b. Default: the amend matched. The refusal tests override to null and then drive the
  // three-way branch through `ownedBodyweightValue`.
  editBodyweight: vi.fn(async () => ({ entryId: 'bw-pub-id' })),
  ownedBodyweightValue: vi.fn(async () => null),
  // V1-24 3b-bw. Default: the row is today's and live, and a clear hides it.
  bodyweightRowDay: vi.fn(async () => ({ day: localDayIso(DEFAULT_TIME_ZONE) })),
  clearBodyweightEntry: vi.fn(async () => ({ cleared: true })),
  // V1-24 3b-life. Default: the practice is today's and live; an amend matches; a clear hides it.
  practiceRowDay: vi.fn(async () => ({ day: localDayIso(DEFAULT_TIME_ZONE) })),
  editPractice: vi.fn(async () => ({ entryId: 'pr-pub-id' })),
  ownedPracticeMinutes: vi.fn(async () => null),
  clearPracticeEntry: vi.fn(async () => ({ cleared: true })),
  // Default: every item was written. Individual tests override for the conflict case.
  logCheckinEntries: vi.fn(async ({ items }: { items: { clientId: string }[] }) =>
    items.map((i) => ({
      clientId: i.clientId,
      id: 'checkin-pub-id',
      created: true,
      outcome: 'created',
    })),
  ),
}));
// AUTH-1 1c-3b, and from 1d the ONLY boundary mock. Passes by default; the unauth suite flips it
// per action. ⚠️ The `@/lib/dal/gate` mock beside this was deleted with the module at 1d.
vi.mock('@/lib/dal/session', () => ({
  sessionUserOrNull: vi.fn(async () => ({ userId: PRINCIPAL })),
}));
// 🔴 The limiter is mocked so a REFUSAL is reachable. In the real module it fails open, and with no
// Upstash configured under vitest it answers `unconfigured` to everything — so without this mock the
// refusal branch in all five actions would be dead code that no test could enter.
// ⚠️ A PARTIAL mock since FAM-1 step 0b: `enterMutation` reads `MUTATION_RATE_LIMIT` for its default
// policy and the matrix compares the limiter call against that const, so the real module supplies
// the policies and only the check is replaced.
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  checkMutationLimit: vi.fn(async () => ({ allowed: true, reason: 'ok' })),
}));
vi.mock('@/lib/dal/profiles', () => ({
  getProfileByPublicId: vi.fn(async () => ({
    id: PROFILE_ID,
    name: 'Athlete One',
    kind: 'kid',
    avatar: null,
    routine: { version: 1, order: [] },
  })),
  // Default: the routine was persisted. The not-found test overrides to null.
  updateProfileRoutine: vi.fn(async () => ({ id: PROFILE_ID })),
  // ⚠️ The four athlete-management writers were mocked here while this file drove every module's
  // matrix. They went to `app/p/profile-actions.test.ts` with that module's matrix (FAM-1 step 0b):
  // `actions.ts` imports none of them, and a mock that does not define one refuses the first touch.
}));

import {
  bodyweightRowDay,
  clearBodyweightEntry,
  clearPracticeEntry,
  editBodyweight,
  editPractice,
  logBodyweight,
  logCheckinEntries,
  ownedBodyweightValue,
  ownedPracticeMinutes,
  practiceRowDay,
} from '@/lib/dal/entries';
import { getProfileByPublicId, updateProfileRoutine } from '@/lib/dal/profiles';
import { ROUTINE_CATALOG } from '@/lib/routine/catalog';
import { athletePath, athleteRoutinePath, DEFAULT_TIME_ZONE } from '@/lib/constants';
import { localDayIso } from '@/lib/date';
import { revalidatePath } from 'next/cache';

/** The day the harness declares by default — the active-tz today under the pinned default tz,
 *  so the ±1 bound accepts it. `offsetDays` builds a stale/near day for the bound tests. */
function localDay(offsetDays = 0): string {
  const base = localDayIso(DEFAULT_TIME_ZONE);
  if (offsetDays === 0) return base;
  const shifted = new Date(`${base}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + offsetDays);
  return shifted.toISOString().slice(0, 10);
}

// `NO_PROFILE_LOG` / `NO_PROFILE_SAVE` are no longer imported here: they reach this suite through
// the registry (`./actions.registry.ts`), which is the single source for both the action names and
// their refusal copy.
import { AMEND_ERROR_COPY, BODYWEIGHT_COPY, PRACTICE_COPY } from '@/lib/constants';
import { type ActionState } from './action-state';
import {
  editBodyweightAction,
  editPracticeAction,
  editRoutineAction,
  logBodyweightAction,
  logLifeActivitiesAction,
} from './actions';
// ⚠️ `app/p/profile-actions.ts`'s four actions were imported here from PROF-1 a-r until FAM-1 step
// 0b, because this file's matrices ran over every module. Each module's own test runs them now, so
// this file imports only the module it sits beside. The cross-module checks at the end read the
// merged registry and the source on disk, never another module's functions.
import { ACTION_REGISTRY } from './actions.registry';
import { excludedActionNames } from './mutating-actions';
import { describeActionMatrices } from '@/test/action-matrix';
import { MUTATING_ACTIONS, REGISTRY_SHARDS, registryFilesOnDisk } from '@/test/action-registry';
import {
  code,
  exportedActionNames,
  serverActionModules,
  USE_SERVER_RE,
  WEB_DIR,
} from '@/test/source-scan';

// A valid tile-supplied public id (UUIDv7). The DAL re-validates it server-side;
// the action must thread it through to both the ownership check and revalidate path.
const PROFILE_ID = '019826b4-0000-7000-8000-000000000001';

/** The principal the session mock answers with; the limiter row asserts the check is keyed on it. */
const PRINCIPAL = E2E_SESSION_BYPASS_USER;

/** A real call of the shared matrices, as a module's sibling test must make. */
const MATRIX_CALL = /\bdescribeActionMatrices\s*\(\s*\{/;

const initial: ActionState = { ok: false, error: null };

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  // Default the declared `day` to the active-tz today (bodyweight/strength thread it now, V1-6c);
  // an explicit `day` in `fields` overrides. Boundary tests that omit other fields still reject at
  // zod BEFORE the day check, so a valid default day is harmless to them.
  const withDay: Record<string, string> = { day: localDay(), ...fields };
  for (const [k, v] of Object.entries(withDay)) fd.append(k, v);
  return fd;
}

beforeEach(() => vi.clearAllMocks());

/**
 * 🔴 **The boundary matrices for THIS module's five actions** — unauth, rate-limited, wrong
 * household, and the byte-identical refusals (AGENTS.md → Backend / API PR rules).
 *
 * The suites themselves are `describeActionMatrices` in `@/test/action-matrix` since FAM-1 step 0b.
 * They used to be written out in this file over one table that held every module's actions, so each
 * new action in any module edited this file. Now every Server Action module's own test calls the
 * same suites over its own registry (`./actions.registry.ts` here), and
 * `app/p/profile-actions.test.ts` runs the athlete-management four that this table used to carry.
 *
 * What stays here is what only this module's author knows: which mocked writer each action reaches,
 * and a body that gets each one as far as its ownership check.
 *
 * Because `bindings` is keyed by the registry's names, **forgetting an entry is a TYPE error**, not a
 * quietly thinner suite; so is a missing body.
 */
describeActionMatrices({
  testFile: import.meta.url,
  registry: ACTION_REGISTRY,
  profileId: PROFILE_ID,
  principal: PRINCIPAL,
  bindings: {
    logBodyweightAction: { fn: logBodyweightAction, writers: [logBodyweight] },
    logLifeActivitiesAction: { fn: logLifeActivitiesAction, writers: [logCheckinEntries] },
    editBodyweightAction: {
      fn: editBodyweightAction,
      writers: [editBodyweight, clearBodyweightEntry],
    },
    editPracticeAction: { fn: editPracticeAction, writers: [editPractice, clearPracticeEntry] },
    editRoutineAction: { fn: editRoutineAction, writers: [updateProfileRoutine] },
  },
  // ⚠️ Thunks, so each may use a form helper declared further down this file.
  validBody: {
    logBodyweightAction: () =>
      form({ profileId: PROFILE_ID, value: '180', unit: 'lb', clientId: newId() }),
    logLifeActivitiesAction: () =>
      lifeForm({ activityKey: ACTIVITY_TYPE_KEYS.wrestling_practice, day: localDay() }),
    editBodyweightAction: () => amendForm(),
    editPracticeAction: () => practiceInput(),
    editRoutineAction: () => routineForm({ profileId: PROFILE_ID, order: [{ key: ROUTINE_K1 }] }),
  },
});

describe('logBodyweightAction — boundary (bad body → zod-reject)', () => {
  it('rejects a non-numeric weight without touching the DAL', async () => {
    const res = await logBodyweightAction(
      initial,
      form({ profileId: PROFILE_ID, value: 'abc', unit: 'lb', clientId: newId() }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.value).toBeTruthy();
    expect(logBodyweight).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects a non-positive weight', async () => {
    const res = await logBodyweightAction(
      initial,
      form({ profileId: PROFILE_ID, value: '0', unit: 'lb', clientId: newId() }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.value).toBeTruthy();
    expect(logBodyweight).not.toHaveBeenCalled();
  });

  it('rejects a unit outside the allowed set', async () => {
    const res = await logBodyweightAction(
      initial,
      form({ profileId: PROFILE_ID, value: '180', unit: 'stone', clientId: newId() }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.unit).toBeTruthy();
    expect(logBodyweight).not.toHaveBeenCalled();
  });

  it('rejects a non-UUID clientId', async () => {
    const res = await logBodyweightAction(
      initial,
      form({ profileId: PROFILE_ID, value: '180', unit: 'lb', clientId: 'not-a-uuid' }),
    );
    expect(res.ok).toBe(false);
    expect(logBodyweight).not.toHaveBeenCalled();
  });

  it('rejects a missing profileId without touching the DAL', async () => {
    const res = await logBodyweightAction(
      initial,
      form({ value: '180', unit: 'lb', clientId: newId() }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.profileId).toBeTruthy();
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(logBodyweight).not.toHaveBeenCalled();
  });

  it('rejects a malformed (non-UUID) profileId', async () => {
    const res = await logBodyweightAction(
      initial,
      form({ profileId: 'not-a-uuid', value: '180', unit: 'lb', clientId: newId() }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.profileId).toBeTruthy();
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(logBodyweight).not.toHaveBeenCalled();
  });
});

describe('logBodyweightAction — happy path + ownership', () => {
  it('writes a valid entry via the DAL and revalidates the scoped Today', async () => {
    const clientId = newId();
    const res = await logBodyweightAction(
      initial,
      form({ profileId: PROFILE_ID, value: '182.5', unit: BODYWEIGHT_UNITS[0], clientId }),
    );
    expect(res.ok).toBe(true);
    expect(getProfileByPublicId).toHaveBeenCalledWith(PROFILE_ID);
    expect(logBodyweight).toHaveBeenCalledWith(
      expect.objectContaining({
        profilePublicId: PROFILE_ID,
        value: 182.5,
        unit: BODYWEIGHT_UNITS[0],
        clientId,
        day: localDay(), // the write lands on the day the page rendered (V1-6c)
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith(athletePath(PROFILE_ID));
  });

  it('fails gracefully (no write) when the profile is unknown', async () => {
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce(null);
    const res = await logBodyweightAction(
      initial,
      form({ profileId: PROFILE_ID, value: '180', unit: 'lb', clientId: newId() }),
    );
    expect(res.ok).toBe(false);
    expect(logBodyweight).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  // V1-24 1d: the one-per-day index refused a second weigh-in (another device got there first).
  // Expected, so a typed envelope — never error.tsx — and the page revalidates to show the row that
  // landed.
  it('a day that already holds a weigh-in returns the typed envelope, not a throw', async () => {
    vi.mocked(logBodyweight).mockResolvedValueOnce({ dayTaken: true });
    const res = await logBodyweightAction(
      initial,
      form({ profileId: PROFILE_ID, value: '180', unit: 'lb', clientId: newId() }),
    );
    expect(res).toEqual({ ok: false, error: BODYWEIGHT_COPY.dayTaken });
    expect(revalidatePath).toHaveBeenCalledWith(athletePath(PROFILE_ID));
  });

  it('any OTHER write failure still throws (error.tsx), never a misleading envelope', async () => {
    vi.mocked(logBodyweight).mockRejectedValueOnce(new Error('connection lost'));
    await expect(
      logBodyweightAction(
        initial,
        form({ profileId: PROFILE_ID, value: '180', unit: 'lb', clientId: newId() }),
      ),
    ).rejects.toThrow('connection lost');
  });
});

describe('declared-day ±1 bound (shared across writers)', () => {
  const bwForm = (day: string) =>
    form({ profileId: PROFILE_ID, value: '180', unit: 'lb', clientId: newId(), day });
  // FAM-1 12f PR 3: the life form joins here, so the shared bound still holds two writers once the
  // check-ins and strength-session actions are gone (plan review row Ar-14).
  const prForm = (day: string) => lifeForm({ day });

  it.each([-1, 0])('accepts today and yesterday (offset %s)', async (offset) => {
    const day = localDay(offset);
    expect((await logBodyweightAction(initial, bwForm(day))).ok).toBe(true);
    expect((await logLifeActivitiesAction(initial, prForm(day))).ok).toBe(true);
    // Sanity: the offset day is yesterday or today in the active-tz.
    expect(isoDayDiff(day, localDay())).toBeLessThanOrEqual(0);
  });

  it.each([1, 2])(
    'rejects a day after today (offset %s) on every writer (FAM-1 D32)',
    async (offset) => {
      const day = localDay(offset);
      const bw = await logBodyweightAction(initial, bwForm(day));
      const pr = await logLifeActivitiesAction(initial, prForm(day));
      for (const res of [bw, pr]) expect(res.ok).toBe(false);
      expect(logBodyweight).not.toHaveBeenCalled();
      expect(logCheckinEntries).not.toHaveBeenCalled();
    },
  );

  it('rejects a malformed day on both writers (after zod, before the DAL)', async () => {
    expect((await logBodyweightAction(initial, bwForm('not-a-date'))).ok).toBe(false);
    expect((await logLifeActivitiesAction(initial, prForm('2026-13-99'))).ok).toBe(false);
    expect(logBodyweight).not.toHaveBeenCalled();
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });
});

// ── V1-7: life activities — practice only, typed minutes since V1-24 3b-life-b ────────────
// V1-24 3b-life-b: the life action logs PRACTICE only, in typed minutes.
const lifeForm = (fields: Record<string, string>) =>
  form({
    profileId: PROFILE_ID,
    clientId: newId(),
    activityKey: ACTIVITY_TYPE_KEYS.wrestling_practice,
    day: localDay(),
    minutes: '45',
    ...fields,
  });
const loggedItem = () => vi.mocked(logCheckinEntries).mock.calls[0]![0].items[0]!;

describe('logLifeActivitiesAction — boundary', () => {
  it.each([
    ['Wake (not loggable: the tap time is not the wake time)', ACTIVITY_TYPE_KEYS.wake],
    ['a real activity that is not a life one', ACTIVITY_TYPE_KEYS.sc_lift],
  ])('refuses %s, never trusting the body', async (_what, activityKey) => {
    const res = await logLifeActivitiesAction(initial, lifeForm({ activityKey }));
    expect(res.ok).toBe(false);
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });

  it('refuses a missing activityKey', async () => {
    const fd = lifeForm({});
    fd.delete('activityKey');
    expect((await logLifeActivitiesAction(initial, fd)).ok).toBe(false);
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });

  it('a tab on the one-tap bundle (no minutes posted) is told to reload, with no write', async () => {
    const fd = lifeForm({});
    fd.delete('minutes');
    expect(await logLifeActivitiesAction(initial, fd)).toEqual({
      ok: false,
      error: PRACTICE_COPY.reloadToLog,
    });
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });

  it.each([
    ['blank', '  ', (): string => PRACTICE_COPY.blankLog],
    ['an hours-shaped 2', '2', (): string => PRACTICE_COPY.hoursNotMinutes('2')],
    ['a decimal 1.5', '1.5', (): string => PRACTICE_COPY.hoursNotMinutes('1.5')],
    ['above the ceiling', String(PRACTICE_MINUTES_MAX + 1), (): string => PRACTICE_COPY.outOfRange],
    ['text', 'abc', (): string => PRACTICE_COPY.outOfRange],
  ])('refuses %s minutes on the field, with no write', async (_what, minutes, copy) => {
    const res = await logLifeActivitiesAction(initial, lifeForm({ minutes }));
    expect(res).toEqual({ ok: false, error: copy(), fieldErrors: { minutes: [copy()] } });
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });

  it('rejects a missing/malformed profileId or clientId without touching the DAL', async () => {
    for (const over of [{ profileId: 'nope' }, { clientId: 'nope' }] as Record<string, string>[]) {
      // Valid minutes, so the page itself is stale or crafted: a reload, not "fix the errors below".
      expect(await logLifeActivitiesAction(initial, lifeForm(over))).toEqual({
        ok: false,
        error: PRACTICE_COPY.reloadToLog,
      });
    }
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });

  it('rejects a stale day (day-grain, bounded ±1)', async () => {
    const res = await logLifeActivitiesAction(initial, lifeForm({ day: localDay(-5) }));
    expect(res.ok).toBe(false);
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });

  it('fails gracefully (no write) when the profile is unknown', async () => {
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce(null);
    const res = await logLifeActivitiesAction(initial, lifeForm({}));
    expect(res.ok).toBe(false);
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });
});

describe('logLifeActivitiesAction — the minutes and the outcomes (3b-life-b B5)', () => {
  it('logs the typed minutes as practice_minutes, inclusive of both bounds', async () => {
    for (const minutes of [PRACTICE_MINUTES_MIN, PRACTICE_MINUTES_MAX]) {
      vi.mocked(logCheckinEntries).mockClear();
      expect(
        await logLifeActivitiesAction(initial, lifeForm({ minutes: String(minutes) })),
      ).toEqual({ ok: true, error: null });
      expect(loggedItem()).toMatchObject({
        activityKey: ACTIVITY_TYPE_KEYS.wrestling_practice,
        metricKey: METRIC_KEYS.practice_minutes,
        value: minutes,
      });
      expect(loggedItem().eventAt).toBeUndefined();
    }
  });

  it('passes the posted client id, the declared day (±1) and the resolved profile, then revalidates', async () => {
    // The idempotency key and the day reach the writer untouched: a minted id would break "one write
    // per replay", a fixed day would file yesterday's practice under another (the Wake test covered
    // these on main; they are practice's own now).
    const clientId = newId();
    const day = localDay(-1);
    await logLifeActivitiesAction(initial, lifeForm({ clientId, day }));
    expect(vi.mocked(logCheckinEntries).mock.calls[0]![0]).toMatchObject({
      profilePublicId: PROFILE_ID,
      day,
      items: [{ clientId, value: 45 }],
    });
    expect(revalidatePath).toHaveBeenCalledWith(athletePath(PROFILE_ID));
  });

  it('no result for the one item sent is "not saved", never ok', async () => {
    vi.mocked(logCheckinEntries).mockResolvedValueOnce([]);
    expect(await logLifeActivitiesAction(initial, lifeForm({}))).toEqual({
      ok: false,
      error: PRACTICE_COPY.notSaved,
    });
  });

  it('a replay of the same write is ok', async () => {
    vi.mocked(logCheckinEntries).mockResolvedValueOnce([
      { clientId: 'x', id: 'p', created: false, outcome: 'replay' },
    ]);
    expect((await logLifeActivitiesAction(initial, lifeForm({}))).ok).toBe(true);
  });

  it.each([
    ['day_taken', (): string => PRACTICE_COPY.dayTaken(45)],
    ['own_hidden', (): string => PRACTICE_COPY.clearedEarlier],
    ['conflict', (): string => PRACTICE_COPY.notSaved],
  ] as const)('%s is a refusal with its own copy, never ok', async (outcome, copy) => {
    vi.mocked(logCheckinEntries).mockResolvedValueOnce([
      { clientId: 'x', id: null, created: false, outcome },
    ]);
    // ' 045 ' so the copy is built from the PARSED minutes, not the raw text.
    expect(await logLifeActivitiesAction(initial, lifeForm({ minutes: ' 045 ' }))).toEqual({
      ok: false,
      error: copy(),
      ...(outcome === 'day_taken' ? { dayTaken: true } : {}),
    });
  });
});

// ── V1-18 PR 2: the coach routine editor ─────────────────────────────────────────
// The routine rides as ONE hidden `routine` JSON field (an ordered variable-length list, the
// strength-form idiom). `validateRoutineForWrite` is the trust boundary — it REJECTS an empty /
// non-catalog / duplicate order against the REAL ROUTINE_CATALOG (no drop-and-store). Two real catalog
// keys keep these tests bound to the live catalog, not re-typed strings.
const [ROUTINE_K1, ROUTINE_K2] = ROUTINE_CATALOG; // 'strength', then Wrestling practice (FAM-1 12f PR 5)
function routineForm(opts: { profileId?: string; routineRaw?: string; order?: unknown }): FormData {
  const fd = new FormData();
  if (opts.profileId !== undefined) fd.append('profileId', opts.profileId);
  if (opts.routineRaw !== undefined) fd.append('routine', opts.routineRaw);
  else if (opts.order !== undefined)
    fd.append('routine', JSON.stringify({ version: ROUTINE_VERSION, order: opts.order }));
  return fd;
}

describe('editRoutineAction — boundary (bad body → reject, no write)', () => {
  it('rejects a malformed routine JSON body without touching the DAL', async () => {
    const res = await editRoutineAction(
      initial,
      routineForm({ profileId: PROFILE_ID, routineRaw: '{not valid json' }),
    );
    expect(res.ok).toBe(false);
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(updateProfileRoutine).not.toHaveBeenCalled();
  });

  it('rejects an EMPTY order (an empty routine is not authorable — it would revert to the default)', async () => {
    const res = await editRoutineAction(initial, routineForm({ profileId: PROFILE_ID, order: [] }));
    expect(res.ok).toBe(false);
    expect(updateProfileRoutine).not.toHaveBeenCalled();
  });

  it('rejects a duplicate key (the strict write matches resolveRoutine — no store-then-diverge)', async () => {
    const res = await editRoutineAction(
      initial,
      routineForm({ profileId: PROFILE_ID, order: [{ key: ROUTINE_K1 }, { key: ROUTINE_K1 }] }),
    );
    expect(res.ok).toBe(false);
    expect(updateProfileRoutine).not.toHaveBeenCalled();
  });

  it('rejects a key not in the catalog (grammar-valid but not a live activity)', async () => {
    const res = await editRoutineAction(
      initial,
      routineForm({ profileId: PROFILE_ID, order: [{ key: 'finisher:sprints' }] }),
    );
    expect(res.ok).toBe(false);
    expect(updateProfileRoutine).not.toHaveBeenCalled();
  });

  it('rejects a missing profileId AFTER a valid routine (no owner to save against)', async () => {
    const res = await editRoutineAction(initial, routineForm({ order: [{ key: ROUTINE_K1 }] }));
    expect(res.ok).toBe(false);
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(updateProfileRoutine).not.toHaveBeenCalled();
  });
});

describe('editRoutineAction — happy path + ownership', () => {
  it('persists a valid routine and revalidates BOTH Today and the editor', async () => {
    const res = await editRoutineAction(
      initial,
      routineForm({ profileId: PROFILE_ID, order: [{ key: ROUTINE_K2 }, { key: ROUTINE_K1 }] }),
    );
    expect(res.ok).toBe(true);
    expect(getProfileByPublicId).toHaveBeenCalledWith(PROFILE_ID);
    expect(updateProfileRoutine).toHaveBeenCalledWith(PROFILE_ID, {
      version: ROUTINE_VERSION,
      order: [{ key: ROUTINE_K2 }, { key: ROUTINE_K1 }],
    });
    expect(revalidatePath).toHaveBeenCalledWith(athletePath(PROFILE_ID));
    expect(revalidatePath).toHaveBeenCalledWith(athleteRoutinePath(PROFILE_ID));
  });

  it('PRESERVES the opaque conditional marker through to the write (the V1-10 down-payment)', async () => {
    await editRoutineAction(
      initial,
      routineForm({
        profileId: PROFILE_ID,
        order: [{ key: ROUTINE_K1, conditional: true }, { key: ROUTINE_K2 }],
      }),
    );
    expect(updateProfileRoutine).toHaveBeenCalledWith(
      PROFILE_ID,
      expect.objectContaining({
        order: [{ key: ROUTINE_K1, conditional: true }, { key: ROUTINE_K2 }],
      }),
    );
  });

  it('fails gracefully (no write) when the profile is unknown', async () => {
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce(null);
    const res = await editRoutineAction(
      initial,
      routineForm({ profileId: PROFILE_ID, order: [{ key: ROUTINE_K1 }] }),
    );
    expect(res.ok).toBe(false);
    expect(updateProfileRoutine).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

// ── V1-24 PR 1b: the bodyweight amend ───────────────────────────────────────────────────────────
const ENTRY_ID = '019826b4-0000-7000-8000-0000000000aa';
const amendForm = (over: Record<string, string> = {}): FormData =>
  form({
    profileId: PROFILE_ID,
    entryId: ENTRY_ID,
    value: '85.2',
    unit: 'lb',
    seenValue: '84.5',
    ...over,
  });

describe('editBodyweightAction — boundary (bad body → zod-reject)', () => {
  it.each([
    ['a non-numeric value', { value: 'abc' }, 'value'],
    ['a non-UUID entryId', { entryId: 'not-a-uuid' }, 'entryId'],
    ['a non-UUID profileId', { profileId: 'nope' }, 'profileId'],
    ['an unknown unit', { unit: 'stone' }, 'unit'],
  ])('rejects %s without touching the DAL', async (_name, over, field) => {
    const res = await editBodyweightAction(initial, amendForm(over));
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.[field]).toBeTruthy();
    expect(editBodyweight).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ The amend is the one path that writes a CORRECTED weight, so it must run the same
   * plausibility bound as the create path. The plan's first draft reached for
   * `logBodyweightSchema.pick()`, which would have dropped the refinement — and, in this zod, throws
   * at module load. Both schemas now share one refiner.
   */
  it('rejects an implausible corrected weight — the bound is not a create-only rule', async () => {
    const res = await editBodyweightAction(initial, amendForm({ value: '845' }));
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.value).toBeTruthy();
    expect(editBodyweight).not.toHaveBeenCalled();
  });
});

describe('editBodyweightAction — the three-way refusal branch', () => {
  it('amends via the DAL and revalidates the scoped Today', async () => {
    const res = await editBodyweightAction(initial, amendForm());
    expect(res.ok).toBe(true);
    expect(editBodyweight).toHaveBeenCalledWith({
      profilePublicId: PROFILE_ID,
      entryId: ENTRY_ID,
      value: 85.2,
      unit: 'lb',
      seenValue: 84.5,
    });
    expect(revalidatePath).toHaveBeenCalledWith(athletePath(PROFILE_ID));
  });

  it('rejects an unknown profile before writing (ownership seam)', async () => {
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce(null);
    const res = await editBodyweightAction(initial, amendForm());
    expect(res.ok).toBe(false);
    expect(editBodyweight).not.toHaveBeenCalled();
  });

  /**
   * (a) Wrong owner, stale id and wrong shape all land here, and all get the SAME message on
   * purpose: a crafted cross-profile id must learn nothing a stale id wouldn't.
   */
  it('a refusal with no readable row → one not-found message', async () => {
    vi.mocked(editBodyweight).mockResolvedValueOnce(null);
    vi.mocked(ownedBodyweightValue).mockResolvedValueOnce(null);
    const res = await editBodyweightAction(initial, amendForm());
    expect(res.ok).toBe(false);
    expect(res.error).toBe(AMEND_ERROR_COPY.notFound(BODYWEIGHT_COPY.noun));
    // Revalidated, so the receipt drops a value that no longer exists and the copy is true.
    expect(revalidatePath).toHaveBeenCalledWith(athletePath(PROFILE_ID));
  });

  /**
   * ⚠️ (b) THE REPLAY CASE (AGENTS.md: replay → one effect, identical response). Save on gym wifi,
   * the write lands, the response is lost, the POST retries. `seenValue` no longer matches — but the
   * row already holds exactly what was asked for, so this is success, not a conflict with nobody.
   */
  it('a replay of a write that already landed → ok, not a phantom conflict', async () => {
    vi.mocked(editBodyweight).mockResolvedValueOnce(null);
    vi.mocked(ownedBodyweightValue).mockResolvedValueOnce({ value: 85.2, unit: 'lb' });
    const res = await editBodyweightAction(initial, amendForm());
    expect(res.ok).toBe(true);
    expect(res.error).toBeNull();
  });

  /** Same number, different unit: NOT the write that was asked for, so it is not a replay. */
  it('a re-read with the same value in another unit → stale, not ok', async () => {
    vi.mocked(editBodyweight).mockResolvedValueOnce(null);
    vi.mocked(ownedBodyweightValue).mockResolvedValueOnce({ value: 85.2, unit: 'kg' });
    const res = await editBodyweightAction(initial, amendForm());
    expect(res.ok).toBe(false);
    expect(res.error).toBe(AMEND_ERROR_COPY.staleWrite);
  });

  /** (c) Someone else got there first — recoverable, and the page revalidates to show what won. */
  it('a genuinely stale write → the stale message, and a revalidate', async () => {
    vi.mocked(editBodyweight).mockResolvedValueOnce(null);
    vi.mocked(ownedBodyweightValue).mockResolvedValueOnce({ value: 70, unit: 'lb' });
    const res = await editBodyweightAction(initial, amendForm());
    expect(res.ok).toBe(false);
    expect(res.error).toBe(AMEND_ERROR_COPY.staleWrite);
    expect(revalidatePath).toHaveBeenCalledWith(athletePath(PROFILE_ID));
  });
});

describe('editBodyweightAction — a blank clears, bounded by the row’s own day (V1-24 3b-bw)', () => {
  it('a blank value clears through the pinned writer, never the amend', async () => {
    for (const blank of ['', '   ']) {
      vi.mocked(clearBodyweightEntry).mockClear();
      const res = await editBodyweightAction(initial, amendForm({ value: blank }));
      expect(res).toEqual({ ok: true, error: null });
      expect(clearBodyweightEntry).toHaveBeenCalledWith({
        profilePublicId: PROFILE_ID,
        entryId: ENTRY_ID,
        unit: 'lb',
        seenValue: 84.5,
      });
      expect(editBodyweight).not.toHaveBeenCalled();
    }
    expect(revalidatePath).toHaveBeenCalledWith(athletePath(PROFILE_ID));
  });

  it('an ABSENT value calls neither writer — a clear is never a missing field', async () => {
    const fd = amendForm();
    fd.delete('value');
    const res = await editBodyweightAction(initial, fd);
    expect(res.ok).toBe(false);
    expect(clearBodyweightEntry).not.toHaveBeenCalled();
    expect(editBodyweight).not.toHaveBeenCalled();
  });

  it('a stale clear (another phone changed it) → the stale message, revalidated', async () => {
    vi.mocked(clearBodyweightEntry).mockResolvedValueOnce({ stale: true });
    const res = await editBodyweightAction(initial, amendForm({ value: '' }));
    expect(res).toEqual({ ok: false, error: AMEND_ERROR_COPY.staleWrite });
    expect(revalidatePath).toHaveBeenCalledWith(athletePath(PROFILE_ID));
  });

  it('a clear of a row that is not theirs → the one not-found message', async () => {
    vi.mocked(clearBodyweightEntry).mockResolvedValueOnce({ notFound: true });
    const res = await editBodyweightAction(initial, amendForm({ value: '' }));
    expect(res).toEqual({ ok: false, error: AMEND_ERROR_COPY.notFound(BODYWEIGHT_COPY.noun) });
  });

  it('a clear never consults the amend’s re-read (the writer answers its own replay)', async () => {
    vi.mocked(clearBodyweightEntry).mockResolvedValueOnce({ cleared: true });
    const res = await editBodyweightAction(initial, amendForm({ value: '' }));
    expect(res).toEqual({ ok: true, error: null });
    expect(ownedBodyweightValue).not.toHaveBeenCalled();
  });

  /**
   * Acceptance 5, the server half: a weigh-in on a day before yesterday is read-only. The bound is
   * the ROW's day, so a POST that also forges `day=<today>` changes nothing.
   */
  it.each([
    ['a change', '85.2'],
    ['a clear', ''],
  ])('%s of a row two days back is refused, even with a forged day', async (_name, value) => {
    vi.mocked(bodyweightRowDay).mockResolvedValueOnce({ day: localDay(-2) });
    const fd = amendForm({ value });
    fd.set('day', localDay());
    const res = await editBodyweightAction(initial, fd);
    expect(res).toEqual({ ok: false, error: AMEND_ERROR_COPY.dayReadOnly(BODYWEIGHT_COPY.noun) });
    expect(editBodyweight).not.toHaveBeenCalled();
    expect(clearBodyweightEntry).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith(athletePath(PROFILE_ID));
  });

  it('a row the pre-read cannot see → not found, and no writer runs', async () => {
    vi.mocked(bodyweightRowDay).mockResolvedValueOnce(null);
    const res = await editBodyweightAction(initial, amendForm());
    expect(res).toEqual({ ok: false, error: AMEND_ERROR_COPY.notFound(BODYWEIGHT_COPY.noun) });
    expect(editBodyweight).not.toHaveBeenCalled();
  });

  it('an archived athlete’s blank is refused: there is no empty field to re-enter into', async () => {
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce({
      ...(await vi.mocked(getProfileByPublicId)(PROFILE_ID))!,
      archived: true,
    });
    const res = await editBodyweightAction(initial, amendForm({ value: '' }));
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.value).toEqual([BODYWEIGHT_COPY.blankSave]);
    expect(clearBodyweightEntry).not.toHaveBeenCalled();
  });
});

/**
 * AUTH-1 1b-bis. The bindings being keyed by the registry's names means a module's matrix cannot
 * SKIP an action in its registry — that is a type error. This closes the other direction: an action
 * added to a Server Action module and never added to a registry would be invisible to every
 * boundary suite, which is exactly the hole `docs/features/write-path.md` invariant 1 admitted in
 * writing ("only if you add it to that suite: do").
 *
 * It reads each module's SOURCE rather than its exports because `actions.ts` is mocked to the
 * eyeballs in this file — importing it for reflection would return the mocks, not the real surface.
 */
/**
 * 🔴 **The registry matches EVERY Server Action module on disk, not just this one (WP-1).**
 *
 * Until WP-1 this `describe` hard-coded `actions.ts` in its own directory. That made the whole
 * refusal apparatus single-module by construction: `ALL_ACTIONS` is built from the registry's keys,
 * every `it.each(ALL_ACTIONS)` iterates it, and nothing forced a SECOND module's exports into the
 * registry. So a new `app/p/*-actions.ts` could be added, pass the pinned module list, pass the
 * source-text boundary guard — and face **no** unauth, rate-limit, wrong-household or
 * byte-identical-refusal test at all. The source guard proves the call is PRESENT, not that it runs
 * before the DAL, so that was the only thing covering it.
 *
 * Reading the scan instead closes it, and does so in the direction that matters: an exported action
 * missing from the registry fails here, and once it is in the registry `ActionBindings` forces a
 * binding, and every matrix runs it. **Detecting an unlisted module would NOT have been enough** —
 * that is bookkeeping, and the action would still be untested. This is why PROF-1 a-r was gated on
 * WP-1: it registered `renameAthleteAction` while that function lives in `app/p/profile-actions.ts`,
 * which would have made the old assertion fail with 8 keys against 7 exports.
 *
 * 🔴 **FAM-1 step 0b: the registry is COMPOSED now, and the chain above has one more link.**
 * `MUTATING_ACTIONS` is the merge of each module's own `*.registry.ts`
 * (`@/test/action-registry`), and the matrices run in each module's own test rather than in this
 * file. So "once it is in the registry, every matrix runs it" holds only if the module's test really
 * calls the matrices over that registry. Three things carry that, and the last `it`s below are the
 * part that is new:
 *
 * 1. the equality here — every exported action is in the merged registry;
 * 2. the type at each `describeActionMatrices` call — every registry entry has a binding and a body;
 * 3. **every module has its registry beside it and a test beside it that calls
 *    `describeActionMatrices`** — a source guard, because one test file cannot observe that another
 *    ran. The call takes the module from the test's own path and checks the registry it is handed
 *    is the sibling file's object, so the presence of the call is all this needs to establish.
 */
describe('the registry matches every Server Action module on disk (WP-1)', () => {
  const modules = serverActionModules();

  it('the scan finds at least one module, so nothing below is vacuous', () => {
    expect(modules.length).toBeGreaterThan(0);
  });

  it('every scanned module really carries the directive', () => {
    for (const m of modules) expect(USE_SERVER_RE.test(code(m))).toBe(true);
  });

  it('the exported actions across all modules are exactly the registry keys', () => {
    const onDisk = modules.flatMap((m) => exportedActionNames(m)).sort();
    expect(onDisk).toEqual(Object.keys(MUTATING_ACTIONS).sort());
  });

  it('the detector is not vacuous — it finds a name that is really there', () => {
    expect(modules.flatMap((m) => exportedActionNames(m))).toContain('logBodyweightAction');
  });

  /**
   * ⚠️ Pinned EMPTY, the `ALLOWLIST` idiom. Exclusion is a member of the registry union, so a
   * household-addressed action cannot be excluded as a matter of type — but nothing stops a
   * `profile` one being excused, so the list is asserted rather than assumed. Every future entry is
   * an edit to this line, read by a human.
   */
  it('no action is excluded from the matrices', () => {
    expect(excludedActionNames(MUTATING_ACTIONS)).toEqual([]);
  });

  /**
   * A name exported by two modules would make the registry ambiguous and silently drop one from the
   * sorted equality above. Cheap to pin, impossible to debug if it ever happens.
   */
  it('no action name is exported by two modules', () => {
    const names = modules.flatMap((m) => exportedActionNames(m));
    expect(names.length).toBe(new Set(names).size);
  });

  /**
   * The same hazard on the registry side, new with the merge: `MUTATING_ACTIONS` is a plain
   * `Object.assign` of the modules' registries, so a name two registries both carry would collapse
   * to one entry, the later one's refusal and scope winning without a word.
   */
  it('no action name is registered by two modules', () => {
    const counted = REGISTRY_SHARDS.reduce((n, s) => n + Object.keys(s.registry ?? {}).length, 0);
    expect(counted).toBe(Object.keys(MUTATING_ACTIONS).length);
  });

  describe('each module carries its own registry and runs the matrices over it (FAM-1 step 0b)', () => {
    it('the shards are the scanned modules, one for one', () => {
      expect(REGISTRY_SHARDS.map((s) => join(WEB_DIR, s.module)).sort()).toEqual(
        [...modules].sort(),
      );
      expect(REGISTRY_SHARDS.length).toBeGreaterThan(1);
    });

    it('every module has its registry file beside it, exporting ACTION_REGISTRY', () => {
      expect(
        REGISTRY_SHARDS.filter((s) => s.registry === null).map((s) => s.registryFile),
        'a Server Action module with no registry: add this file beside it, exporting ' +
          '`ACTION_REGISTRY` (the rule is in app/p/[profileId]/mutating-actions.ts)',
      ).toEqual([]);
    });

    it('no registry file is left without a module (it would register nothing, silently)', () => {
      const expected = new Set(REGISTRY_SHARDS.map((s) => s.registryFile));
      expect(registryFilesOnDisk().length).toBeGreaterThan(1);
      expect(registryFilesOnDisk().filter((f) => !expected.has(f))).toEqual([]);
    });

    /**
     * 🔴 The link the merge added. An action in a registry is driven only if its module's test
     * calls the matrices, and no assertion in this file can see another file's tests run. So each
     * module's sibling test is read: it must exist, call `describeActionMatrices`, and hand it the
     * registry imported from the sibling file. Comments are stripped, so a call in a docblock
     * (this file has one) satisfies nothing.
     */
    it.each(REGISTRY_SHARDS.map((s) => [s.module, s] as const))(
      '%s — the test beside it runs the matrices over its registry',
      (_module, shard) => {
        const testFile = join(WEB_DIR, shard.testFile);
        expect(existsSync(testFile), `${shard.testFile} must exist`).toBe(true);
        const src = code(testFile);
        expect(src, `${shard.testFile} must call describeActionMatrices`).toMatch(MATRIX_CALL);
        expect(
          src,
          `${shard.testFile} must pass its own path, so the module is not a choice`,
        ).toMatch(/\btestFile:\s*import\.meta\.url\b/);
        const registryModule = `./${basename(shard.registryFile).replace(/\.ts$/, '')}`;
        expect(
          src.includes(`import { ACTION_REGISTRY } from '${registryModule}'`),
          `${shard.testFile} must import ACTION_REGISTRY from '${registryModule}'`,
        ).toBe(true);
        expect(src, `${shard.testFile} must drive that registry`).toMatch(
          /\bregistry:\s*ACTION_REGISTRY\b/,
        );
      },
    );

    it('the call detector is not vacuous: it sees this file’s call, and an import is not a call', () => {
      expect(code(fileURLToPath(import.meta.url))).toMatch(MATRIX_CALL);
      expect("import { describeActionMatrices } from '@/test/action-matrix';").not.toMatch(
        MATRIX_CALL,
      );
    });
  });
});

// ── V1-24 3b-life A5: editPracticeAction, the FAM-1 contract's shape ──────────────────────────────
const PRACTICE_ENTRY_ID = '019826b4-0000-7000-8000-0000000000ab';
const practiceInput = (over: Partial<EditPracticeInput> = {}): EditPracticeInput => ({
  profilePublicId: PROFILE_ID,
  entryId: PRACTICE_ENTRY_ID,
  value: '45',
  seenValue: 90,
  ...over,
});

describe('editPracticeAction — the typed refusals', () => {
  it('saves a whole number in range through the guarded UPDATE', async () => {
    // The DAL gets the profile RESOLVED by ownership, not the one posted: the resolver answers a
    // different id here, so passing the posted one through would fail this.
    const RESOLVED = '019826b4-0000-7000-8000-0000000000ac';
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce({
      ...(await getProfileByPublicId(PROFILE_ID))!,
      id: RESOLVED,
    });
    expect(await editPracticeAction(practiceInput())).toEqual({ ok: true });
    expect(vi.mocked(editPractice).mock.calls[0]![0]).toMatchObject({
      profilePublicId: RESOLVED,
      entryId: PRACTICE_ENTRY_ID,
      minutes: 45,
      seenValue: 90,
    });
    expect(clearPracticeEntry).not.toHaveBeenCalled();
  });

  it.each([
    ['below the floor', { value: String(PRACTICE_MINUTES_MIN - 1) }],
    ['above the ceiling', { value: String(PRACTICE_MINUTES_MAX + 1) }],
    ['a decimal', { value: '45.5' }],
    ['text', { value: 'abc' }],
    ['a non-UUID entry', { entryId: 'not-a-uuid' }],
  ])('refuses %s as invalid, touching nothing', async (_name, over) => {
    expect(await editPracticeAction(practiceInput(over))).toEqual({
      ok: false,
      reason: PRACTICE_AMEND_REFUSAL.bad_value,
    });
    expect(practiceRowDay).not.toHaveBeenCalled();
    expect(editPractice).not.toHaveBeenCalled();
    expect(clearPracticeEntry).not.toHaveBeenCalled();
  });

  it('refuses an absent value: a crafted call cannot clear by omission', async () => {
    const withoutValue: Partial<EditPracticeInput> = practiceInput();
    delete withoutValue.value;
    const res = await editPracticeAction(withoutValue as EditPracticeInput);
    expect(res).toEqual({ ok: false, reason: PRACTICE_AMEND_REFUSAL.bad_value });
    expect(clearPracticeEntry).not.toHaveBeenCalled();
  });

  it('a blank clears through clearPracticeEntry, never the UPDATE', async () => {
    expect(await editPracticeAction(practiceInput({ value: '  ' }))).toEqual({ ok: true });
    expect(vi.mocked(clearPracticeEntry).mock.calls[0]![0]).toMatchObject({
      profilePublicId: PROFILE_ID,
      entryId: PRACTICE_ENTRY_ID,
      seenValue: 90,
    });
    expect(editPractice).not.toHaveBeenCalled();
  });

  it('an archived athlete cannot clear', async () => {
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce({
      ...(await getProfileByPublicId(PROFILE_ID))!,
      archived: true,
    });
    expect(await editPracticeAction(practiceInput({ value: '' }))).toEqual({
      ok: false,
      reason: PRACTICE_AMEND_REFUSAL.archived_blank,
    });
    expect(clearPracticeEntry).not.toHaveBeenCalled();
  });

  it('a clear of a row that is gone is not_found', async () => {
    vi.mocked(clearPracticeEntry).mockResolvedValueOnce({ notFound: true });
    expect(await editPracticeAction(practiceInput({ value: '' }))).toEqual({
      ok: false,
      reason: PRACTICE_AMEND_REFUSAL.not_found,
    });
  });

  it('a stale clear refuses', async () => {
    vi.mocked(clearPracticeEntry).mockResolvedValueOnce({ stale: true });
    expect(await editPracticeAction(practiceInput({ value: '' }))).toEqual({
      ok: false,
      reason: PRACTICE_AMEND_REFUSAL.stale,
    });
  });

  it('a row that is not theirs, or not a practice, is not_found, with no write', async () => {
    vi.mocked(practiceRowDay).mockResolvedValueOnce(null);
    expect(await editPracticeAction(practiceInput())).toEqual({
      ok: false,
      reason: PRACTICE_AMEND_REFUSAL.not_found,
    });
    expect(editPractice).not.toHaveBeenCalled();
  });

  it("a practice on a day before yesterday is read-only: the row's day bounds it, never a posted one", async () => {
    for (const value of ['45', '']) {
      vi.mocked(practiceRowDay).mockResolvedValueOnce({ day: localDay(-2) });
      // A crafted call posting TODAY is ignored: the schema has no day, and the row's day bounds it.
      const forged = { ...practiceInput({ value }), day: localDay(0) } as EditPracticeInput;
      expect(await editPracticeAction(forged)).toEqual({
        ok: false,
        reason: PRACTICE_AMEND_REFUSAL.closed_day,
      });
    }
    expect(editPractice).not.toHaveBeenCalled();
    expect(clearPracticeEntry).not.toHaveBeenCalled();
  });

  it('the three-way branch: gone → not_found; already holds it → replay ok; else stale', async () => {
    vi.mocked(editPractice).mockResolvedValueOnce(null);
    vi.mocked(ownedPracticeMinutes).mockResolvedValueOnce(null);
    expect(await editPracticeAction(practiceInput())).toEqual({
      ok: false,
      reason: PRACTICE_AMEND_REFUSAL.not_found,
    });
    vi.mocked(editPractice).mockResolvedValueOnce(null);
    vi.mocked(ownedPracticeMinutes).mockResolvedValueOnce({ minutes: 45 });
    expect(await editPracticeAction(practiceInput())).toEqual({ ok: true });
    vi.mocked(editPractice).mockResolvedValueOnce(null);
    vi.mocked(ownedPracticeMinutes).mockResolvedValueOnce({ minutes: 60 });
    expect(await editPracticeAction(practiceInput())).toEqual({
      ok: false,
      reason: PRACTICE_AMEND_REFUSAL.stale,
    });
  });
});
