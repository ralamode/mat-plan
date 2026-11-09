import {
  PROFILE_KIND,
  ACTIVITY_TYPE_KEYS,
  BLANK_SET_MESSAGE,
  BODYWEIGHT_UNITS,
  FREE_TEXT_NOTE_MAX,
  LOGGABLE_DIMENSION_NOUNS,
  METRIC_KEYS,
  modeNotApplicableBlankMessage,
  modeNotApplicableMessage,
  newId,
  ROUTINE_VERSION,
} from '@mat-plan/shared';
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
  logStrengthSession: vi.fn(async () => ({ sessionId: 'session-pub-id' })),
  // Default: the set was found + edited. The not-found test overrides to null.
  editStrengthSet: vi.fn(async () => ({ setId: 'set-pub-id' })),
  // V1-24 PR 1b. Default: the amend matched. The refusal tests override to null and then drive the
  // three-way branch through `ownedBodyweightValue`.
  editBodyweight: vi.fn(async () => ({ entryId: 'bw-pub-id' })),
  ownedBodyweightValue: vi.fn(async () => null),
  // Default: every item was written. Individual tests override for the conflict case.
  logCheckinEntries: vi.fn(async ({ items }: { items: { clientId: string }[] }) =>
    items.map((i) => ({ clientId: i.clientId, id: 'checkin-pub-id', created: true })),
  ),
}));
// AUTH-1 1c-3b, and from 1d the ONLY boundary mock. Passes by default; the unauth suite flips it
// per action. ⚠️ The `@/lib/dal/gate` mock beside this was deleted with the module at 1d.
vi.mock('@/lib/dal/session', () => ({
  sessionUserOrNull: vi.fn(async () => ({ userId: 'user_000000000000000000000000e2e' })),
}));
// 🔴 The limiter is mocked so a REFUSAL is reachable. In the real module it fails open, and with no
// Upstash configured under vitest it answers `unconfigured` to everything — so without this mock the
// refusal branch in all seven actions would be dead code that no test could enter.
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
  })),
  // Default: the routine was persisted. The not-found test overrides to null.
  updateProfileRoutine: vi.fn(async () => ({ id: PROFILE_ID })),
  // PROF-1 a-r. Default: the rename matched a live profile in this household.
  renameAthlete: vi.fn(async () => ({ id: PROFILE_ID })),
  // PROF-1 b. ⚠️ **The DISCRIMINATED result, not `{ id }`** — these two own the refusal ORDER, so
  // their shape is `{ ok: true, id } | { ok: false, reason }`. A mock returning the old shape would
  // make the action read `result.ok` as `undefined` and refuse every call, which is a test that
  // passes for the wrong reason on the unauth rows and fails confusingly on the happy ones.
  archiveAthlete: vi.fn(async () => ({ ok: true, id: PROFILE_ID })),
  // PROF-1 a-1w — the household-addressed writer.
  createAthlete: vi.fn(async () => ({ ok: true, id: PROFILE_ID })),
  restoreAthlete: vi.fn(async () => ({ ok: true, id: PROFILE_ID })),
}));

import { CHECKIN_FIELDS, clientIdInputName, valueInputName } from '@/lib/checkins/checkin-fields';
import {
  editBodyweight,
  editStrengthSet,
  logBodyweight,
  logCheckinEntries,
  logStrengthSession,
  ownedBodyweightValue,
} from '@/lib/dal/entries';
import { sessionUserOrNull } from '@/lib/dal/session';
import { checkMutationLimit } from '@/lib/rate-limit';
import {
  archiveAthlete,
  createAthlete,
  getProfileByPublicId,
  renameAthlete,
  restoreAthlete,
  updateProfileRoutine,
} from '@/lib/dal/profiles';
import { ROUTINE_CATALOG } from '@/lib/routine/catalog';
import { athletePath, athleteRoutinePath, DEFAULT_TIME_ZONE, RATE_LIMITED } from '@/lib/constants';
import { isoDayDiff, localDayIso } from '@/lib/date';
import { DEFAULT_PRACTICE_MINUTES } from '@/lib/life/life-activities';
import { revalidatePath } from 'next/cache';
import { redirect, RedirectType } from 'next/navigation';

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
// `MUTATING_ACTIONS`, which is now the single source for both the action names and their refusal copy.
import { AMEND_ERROR_COPY, BODYWEIGHT_COPY } from '@/lib/constants';
import { type ActionState } from './action-state';
import {
  editBodyweightAction,
  editRoutineAction,
  editStrengthSetAction,
  logBodyweightAction,
  logCheckinsAction,
  logLifeActivitiesAction,
  logStrengthSessionAction,
} from './actions';
// 🔴 PROF-1 a-r — the first action imported here from a DIFFERENT module. Every matrix below is keyed
// by the registry, not by this file's directory, so `renameAthleteAction` enters the unauth,
// rate-limit, wrong-household and byte-identical-refusal suites exactly like the seven above. Its
// own per-action behaviour lives beside it, in `app/p/profile-actions.test.ts` (WP-1's convention).
import {
  addAthleteAction,
  archiveAthleteAction,
  renameAthleteAction,
  restoreAthleteAction,
} from '@/app/p/profile-actions';
import {
  ACTION_SCOPE,
  MUTATING_ACTIONS,
  excludedActionNames,
  matrixEntry,
  type ActionScope,
  type MatrixActionName,
} from './mutating-actions';
import { code, exportedActionNames, serverActionModules, USE_SERVER_RE } from '@/test/source-scan';

// A valid tile-supplied public id (UUIDv7). The DAL re-validates it server-side;
// the action must thread it through to both the ownership check and revalidate path.
const PROFILE_ID = '019826b4-0000-7000-8000-000000000001';

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

// MANDATORY unauth → reject (AGENTS.md → Backend / API PR rules; SEC-1). A Server Action is a public
// POST and the proxy is not the auth boundary: SEC-1's scar was a matcher that let prefetch-flagged
// requests skip the check entirely. Each action must refuse a caller with no session BEFORE anything
// else runs, with the same copy as not-found (so the refusal says nothing about the profile).
/**
 * ALL SEVEN ACTIONS and the refusal each returns, enumerated once and shared by the unauth suite and
 * TEN-1's wrong-household suite below.
 *
 * The copy comes from `@/lib/constants` rather than a re-typed literal (it was typed out seven times
 * here before TEN-1 1b, and the wrong-household suite would have made it fourteen). That matters
 * beyond tidiness: the security argument for 404-never-403 is that the refusal is **byte-identical**
 * across no-session, unknown, soft-deleted and foreign-household — so a crafted cross-household id
 * learns nothing a stale id wouldn't. Asserting through the const makes that identity structural;
 * asserting through two copies of a string only makes it likely.
 */
type ActionFn = (s: ActionState, f: FormData) => Promise<ActionState>;

/**
 * AUTH-1 1b-bis: the NAMES and the refusal copy come from `MUTATING_ACTIONS`, so this list cannot
 * silently fall behind the modules on disk. Because it is keyed by `MatrixActionName`, **forgetting
 * an entry is a TYPE error**, not a quietly thinner suite — and an action marked `excluded` in the
 * registry cannot be given one. The filesystem cross-check below closes the remaining direction.
 *
 * 🔴 **ONE table per action, not three (WP-1).** `ACTION_FNS`, the hand-written `ALL_WRITERS` array
 * and the `VALID_BODY` map were three structures keyed by the same names, so a new action had three
 * places to be forgotten and `updateProfileRoutine` was asserted by hand beside the array it was
 * missing from. `writers` is a **non-empty tuple at the type level**, so a binding cannot claim an
 * action writes nothing.
 */
/**
 * ⚠️ `Writer` is deliberately loose, not `Mock`. These are the REAL DAL imports — `vi.mock` replaces
 * them at runtime but their static types stay the originals, so annotating `Mock` does not compile.
 * `(...a: never[]) => unknown` accepts any of them contravariantly while keeping the part that
 * matters: a **non-empty tuple**, so a binding cannot claim an action writes nothing.
 */
type Writer = (...a: never[]) => unknown;

/**
 * What a matrix row needs to drive one action.
 *
 * 🔴 **`scopeMiss` is required for a HOUSEHOLD-addressed action and meaningless for a
 * profile-addressed one** — which is why this is a discriminated union rather than two optional
 * fields. A profile action is made to miss by mocking `getProfileByPublicId` to `null`, the one lever
 * that works for every one of them. A household action has **no `profileId` to make foreign**, so the
 * suite has to reach into its DAL function instead, and only the action's own author knows which one.
 *
 * WP-1's plan accepted both this and `succeeded` (R1, R7) and shipped neither, saying so: *"the suite
 * is still owed, by `PROF-1` a-1."* Until now the only matrix rows reaching a household action would
 * have been unauth and rate-limit — no wrong-owner proof at all, which AGENTS.md calls mandatory.
 */
type BindingBase = {
  readonly fn: ActionFn;
  readonly writers: readonly [Writer, ...Writer[]];
  /**
   * Assert what a SUCCESSFUL call did, beyond `result.ok`. Optional; when absent the suite asserts
   * `ok` itself (see the happy row) —
   * `addAthleteAction` needs it because its success is a `redirect`, which throws and therefore
   * returns no envelope to inspect.
   */
  readonly succeeded?: (result: ActionState) => void;
};

/**
 * 🔴 **Keyed on the ACTION'S OWN SCOPE, so the compiler enforces what the guide claims.** The first
 * version was a plain union (`{ scopeMiss?: never } | { scopeMiss: () => void }`), which TypeScript
 * satisfies with the first arm for **any** entry — so a household action could omit `scopeMiss`
 * while `write-path.md` invariant 13 said it was required. A review lens caught the gap between the
 * type and the sentence. `MUTATING_ACTIONS` is `as const`, so each name's `scope` is known at the
 * type level and the requirement can actually be expressed.
 */
type BindingFor<N extends MatrixActionName> = (typeof MUTATING_ACTIONS)[N] extends {
  scope: typeof ACTION_SCOPE.household;
}
  ? BindingBase & { readonly scopeMiss: () => void }
  : BindingBase & { readonly scopeMiss?: never };

const ACTION_BINDINGS: { [N in MatrixActionName]: BindingFor<N> } = {
  logBodyweightAction: { fn: logBodyweightAction, writers: [logBodyweight] },
  logCheckinsAction: { fn: logCheckinsAction, writers: [logCheckinEntries] },
  logStrengthSessionAction: { fn: logStrengthSessionAction, writers: [logStrengthSession] },
  // Shares `logCheckinEntries` with check-ins — the writer is the entry batch, not the screen.
  logLifeActivitiesAction: { fn: logLifeActivitiesAction, writers: [logCheckinEntries] },
  editStrengthSetAction: { fn: editStrengthSetAction, writers: [editStrengthSet] },
  editBodyweightAction: { fn: editBodyweightAction, writers: [editBodyweight] },
  editRoutineAction: { fn: editRoutineAction, writers: [updateProfileRoutine] },
  renameAthleteAction: { fn: renameAthleteAction, writers: [renameAthlete] },
  // PROF-1 b. The DAL functions, not the `packages/db` writers: `archiveAthlete` owns the refusal
  // ORDER (resolve → narrow → write), which is the thing a wrong-household row must not reach past.
  archiveAthleteAction: { fn: archiveAthleteAction, writers: [archiveAthlete] },
  restoreAthleteAction: { fn: restoreAthleteAction, writers: [restoreAthlete] },
  addAthleteAction: {
    fn: addAthleteAction,
    writers: [createAthlete],
    // The household equivalent of "make the id foreign": the DAL reports that no household resolved.
    scopeMiss: () =>
      vi.mocked(createAthlete).mockResolvedValueOnce({ ok: false, reason: 'no_scope' }),
    // ⚠️ Success THROWS here (`redirect`), so there is no envelope. The thrown sentinel is the
    // assertion — see the household suite for why the mock must throw rather than return undefined.
    succeeded: () => {
      expect(vi.mocked(redirect)).toHaveBeenCalledWith(
        athletePath(PROFILE_ID),
        RedirectType.replace,
      );
    },
  },
};

/**
 * 🔴 **One assertion ties each registration to the function it names (WP-1).** Shorthand properties
 * hide a copy-paste: `fooAction: { fn: logBodyweightAction, … }` would pass every matrix below while
 * the real `fooAction` was never called. Viable because every action is a plain
 * `export async function` with the Sentry wrapper inside its body, so `.name` survives the build.
 */
describe('the bindings name the functions they claim', () => {
  it.each(Object.keys(ACTION_BINDINGS) as MatrixActionName[])('%s binds its own function', (n) => {
    expect(ACTION_BINDINGS[n].fn.name).toBe(n);
  });
});

const MATRIX_NAMES = Object.keys(ACTION_BINDINGS) as MatrixActionName[];

const ALL_ACTIONS: [string, ActionFn, string][] = MATRIX_NAMES.map((name) => [
  name,
  ACTION_BINDINGS[name].fn,
  matrixEntry(name).refusal,
]);

/** Matrix rows for one addressing mode — `profile` today; `household` fills at PROF-1 a-1. */
const actionsScoped = (scope: ActionScope): [string, ActionFn, string][] =>
  MATRIX_NAMES.filter((n) => matrixEntry(n).scope === scope).map((name) => [
    name,
    ACTION_BINDINGS[name].fn,
    matrixEntry(name).refusal,
  ]);

const PROFILE_ACTIONS = actionsScoped(ACTION_SCOPE.profile);
const HOUSEHOLD_ACTIONS = actionsScoped(ACTION_SCOPE.household);

const NEW_CLIENT_ID = '019826b4-0000-7000-8000-0000000000c1';

/**
 * A body that reaches each action's ownership check, keyed by name.
 *
 * ⚠️ **Hoisted to module scope at a-1w**, because the HOUSEHOLD matrix needs the same thing the
 * wrong-household one does and a second copy would be two lists to keep in step.
 */
const VALID_BODY: Record<string, () => FormData> = {
  logBodyweightAction: () =>
    form({ profileId: PROFILE_ID, value: '180', unit: 'lb', clientId: newId() }),
  logCheckinsAction: () => checkinForm({ profileId: PROFILE_ID, values: { [HABIT.key]: '1' } }),
  logStrengthSessionAction: () =>
    strengthForm({
      profileId: PROFILE_ID,
      movements: [{ movementName: 'Back squat', sets: [{ reps: '5', weight: '135' }] }],
    }),
  logLifeActivitiesAction: () =>
    lifeForm({ activityKey: ACTIVITY_TYPE_KEYS.wrestling_practice, day: localDay() }),
  editStrengthSetAction: () =>
    editForm({ profileId: PROFILE_ID, setId: newId(), reps: '5', weight: '135' }),
  editBodyweightAction: () => amendForm(),
  editRoutineAction: () => routineForm({ profileId: PROFILE_ID, order: [{ key: ROUTINE_K1 }] }),
  renameAthleteAction: () => form({ profileId: PROFILE_ID, name: 'Renamed Athlete' }),
  archiveAthleteAction: () => form({ profileId: PROFILE_ID }),
  restoreAthleteAction: () => form({ profileId: PROFILE_ID }),
};

VALID_BODY.addAthleteAction = () =>
  form({ name: 'Added Athlete', kind: PROFILE_KIND.kid, clientId: NEW_CLIENT_ID });

/**
 * Every writer any binding declares — **derived, never hand-listed**. The old array omitted
 * `updateProfileRoutine`, which is why each refusal case carried a separate
 * `expect(updateProfileRoutine).not.toHaveBeenCalled()`; a writer no binding declares is now
 * asserted by construction.
 */
const ALL_WRITERS = [...new Set(MATRIX_NAMES.flatMap((n) => ACTION_BINDINGS[n].writers))];

/**
 * 🔴 **The MANDATORY unauth suite (AGENTS.md → Backend / API PR rules), and at `1d` it is the only
 * one.** `1c-3b` added the session BESIDE the gate, so there were two suites — one flipping each
 * conjunct — and either going green alone would have meant the AND had quietly become an OR.
 *
 * ⚠️ **`1d` deleted the gate suite rather than keeping both, and that is not a narrowing of
 * coverage.** With one conjunct left, a second suite would have been the SAME test with a different
 * mock name: duplicate, and duplicate in the way that rots, because the next author updates one.
 * 🔴 What must never happen here is widening to an alternation — asserting that a caller is refused
 * when EITHER check fails would pass a build where the surviving check does nothing.
 */
describe('every Server Action — unauth → reject before any DAL call (SEC-1, AUTH-1 1c-3b)', () => {
  it.each(ALL_ACTIONS)('%s refuses a caller with no session', async (_name, action, notFound) => {
    vi.mocked(sessionUserOrNull).mockResolvedValueOnce(null);
    const res = await action(initial, form({ profileId: PROFILE_ID }));
    // 🔴 The SAME bytes as every other refusal, deliberately: a caller must not be able to tell
    // "no session" from "another household" from "no such profile". ADR 0006's 404-never-403.
    expect(res).toEqual({ ok: false, error: notFound });
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    for (const write of ALL_WRITERS) expect(write).not.toHaveBeenCalled();
    expect(updateProfileRoutine).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

/**
 * AUTH-1 1c-3b — the mutation limiter, which is otherwise untestable.
 *
 * It fails OPEN and is `unconfigured` under vitest, so a call placed after the write, or one whose
 * result is ignored, would be invisible to every other test in this file. These are the only cases
 * that can distinguish "the limiter is wired" from "the limiter is imported".
 */
describe('every Server Action — rate limited → reject before any DAL call (AUTH-1 1c-3b)', () => {
  it.each(ALL_ACTIONS)('%s refuses when the limiter says so', async (_name, action) => {
    vi.mocked(checkMutationLimit).mockResolvedValueOnce({ allowed: false, reason: 'limited' });
    const res = await action(initial, form({ profileId: PROFILE_ID }));
    // ⚠️ NOT the not-found copy. A rate limit is the one refusal with something to do about it, and
    // borrowing `NO_PROFILE_*` would both lie to the user and blur the 404-never-403 argument above.
    expect(res).toEqual({ ok: false, error: RATE_LIMITED });
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    for (const write of ALL_WRITERS) expect(write).not.toHaveBeenCalled();
    expect(updateProfileRoutine).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each(ALL_ACTIONS)('%s keys the limiter on the principal', async (_name, action) => {
    await action(initial, form({ profileId: PROFILE_ID }));
    // The id comes from `auth()`, never from the request — so it cannot be forged or enumerated.
    expect(checkMutationLimit).toHaveBeenCalledWith('user_000000000000000000000000e2e');
  });
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

// Builds strength-session FormData: the movement cards serialized into ONE hidden `movements` JSON
// field (V1-8-2), plus the session-level profileId/clientId/day. `sessionType` is deliberately never
// submitted (the schema default fires). `movementsRaw` injects a raw string for the malformed-JSON test.
function strengthForm(opts: {
  profileId?: string;
  clientId?: string;
  day?: string;
  feel?: string;
  dayRole?: string;
  movements?: Array<{
    movementName?: string;
    unit?: string;
    clientId?: string;
    status?: string;
    sets: Array<{ reps: string; weight?: string; isBodyweight?: boolean; isBand?: boolean }>;
  }>;
  movementsRaw?: string;
}): FormData {
  const fd = new FormData();
  if (opts.profileId !== undefined) fd.append('profileId', opts.profileId);
  fd.append('clientId', opts.clientId ?? newId());
  fd.append('day', opts.day ?? localDay());
  if (opts.feel !== undefined) fd.append('feel', opts.feel);
  if (opts.dayRole !== undefined) fd.append('dayRole', opts.dayRole);
  if (opts.movementsRaw !== undefined) {
    fd.append('movements', opts.movementsRaw);
  } else if (opts.movements !== undefined) {
    fd.append(
      'movements',
      JSON.stringify(
        opts.movements.map((m) => ({
          movementName: m.movementName ?? 'Back squat',
          unit: m.unit ?? BODYWEIGHT_UNITS[0],
          clientId: m.clientId ?? newId(),
          // Omitted unless the test sets it, so every existing case still exercises the
          // status-absent path that must default to `done` (GAP-1 P1-1a).
          ...(m.status !== undefined ? { status: m.status } : {}),
          sets: m.sets,
        })),
      ),
    );
  }
  return fd;
}

describe('logStrengthSessionAction — boundary (bad body → zod-reject)', () => {
  it('rejects a movement with a blank name without touching the DAL', async () => {
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        movements: [{ movementName: '', sets: [{ reps: '5', weight: '135' }] }],
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.movements).toBeTruthy();
    expect(logStrengthSession).not.toHaveBeenCalled();
  });

  it('rejects a movement with no sets', async () => {
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        movements: [{ movementName: 'Back squat', sets: [] }],
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.movements).toBeTruthy();
    expect(logStrengthSession).not.toHaveBeenCalled();
  });

  it('rejects an empty movements array (a session needs ≥1 movement)', async () => {
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({ profileId: PROFILE_ID, movements: [] }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.movements).toBeTruthy();
    expect(logStrengthSession).not.toHaveBeenCalled();
  });

  // V1-30: the form offers every LOGGABLE unit; the server must accept each, and the DAL must receive
  // the unit the athlete chose. Before the fix only lb/kg got through.
  it('accepts lb, kg, sec and m movements and hands each unit to the DAL', async () => {
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        movements: [
          { unit: 'lb', sets: [{ reps: '5', weight: '135' }] },
          { unit: 'kg', sets: [{ reps: '5', weight: '60' }] },
          { unit: 'sec', sets: [{ reps: '1', weight: '30' }] },
          { unit: 'm', sets: [{ reps: '1', weight: '20' }] },
        ],
      }),
    );
    expect(res.ok).toBe(true);
    expect(vi.mocked(logStrengthSession).mock.calls[0]![0]).toMatchObject({
      movements: [{ unit: 'lb' }, { unit: 'kg' }, { unit: 'sec' }, { unit: 'm' }],
    });
  });

  it('rejects a unit no form offers (count) without touching the DAL', async () => {
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        movements: [{ unit: 'count', sets: [{ reps: '5', weight: '5' }] }],
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.movements?.[0]).toMatch(/^Back squat: /);
    expect(logStrengthSession).not.toHaveBeenCalled();
  });

  it('names the movement AND the set when BW is tapped on a timed hold', async () => {
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        movements: [
          { unit: 'lb', sets: [{ reps: '5', weight: '135' }] },
          {
            movementName: 'Plank',
            unit: 'sec',
            sets: [
              { reps: '1', weight: '30' },
              { reps: '1', isBodyweight: true },
            ],
          },
        ],
      }),
    );
    expect(res.ok).toBe(false);
    // The time is blank too, so the copy names both fixes (one round trip, not two).
    expect(res.fieldErrors?.movements).toEqual([
      `Plank, set 2: ${modeNotApplicableBlankMessage(LOGGABLE_DIMENSION_NOUNS.time!)}`,
    ]);
    expect(logStrengthSession).not.toHaveBeenCalled();
  });

  it('lists errors in FORM order, whichever check raised them', async () => {
    // The set check (blank) runs before the session check (BW on a time), so without the sort set 2
    // would be listed above set 1.
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        movements: [
          {
            movementName: 'Plank',
            unit: 'sec',
            sets: [
              { reps: '3', isBodyweight: true },
              { reps: '3', weight: '' },
            ],
          },
        ],
      }),
    );
    expect(res.fieldErrors?.movements).toEqual([
      `Plank, set 1: ${modeNotApplicableBlankMessage(LOGGABLE_DIMENSION_NOUNS.time!)}`,
      `Plank, set 2: ${BLANK_SET_MESSAGE}`,
    ]);
  });

  it('names the faulty card by its movement, not its index in the submitted list', async () => {
    // On screen: 1 Squat, 2 Pull-up, 3 RDL (untouched → dropped by the form), 4 Plank. The server sees
    // three movements, so an index would say "Movement 3" — the RDL card. The name says Plank.
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        movements: [
          { movementName: 'Squat', unit: 'lb', sets: [{ reps: '5', weight: '135' }] },
          { movementName: 'Pull-up', unit: 'lb', sets: [{ reps: '5', weight: '0' }] },
          {
            movementName: 'Plank',
            unit: 'sec',
            sets: [{ reps: '1', weight: '30', isBodyweight: true }],
          },
        ],
      }),
    );
    expect(res.fieldErrors?.movements).toEqual([
      `Plank, set 1: ${modeNotApplicableMessage(LOGGABLE_DIMENSION_NOUNS.time!)}`,
    ]);
  });

  it('falls back to the movement number only when the name is empty', async () => {
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        movements: [
          { movementName: 'Squat', unit: 'lb', sets: [{ reps: '5', weight: '135' }] },
          { movementName: '  ', unit: 'lb', sets: [{ reps: '5', weight: '135' }] },
        ],
      }),
    );
    expect(res.fieldErrors?.movements?.[0]).toMatch(/^Movement 2: /);
  });

  it('rejects a non-integer rep count', async () => {
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        movements: [{ movementName: 'Back squat', sets: [{ reps: '5.5', weight: '135' }] }],
      }),
    );
    expect(res.ok).toBe(false);
    expect(logStrengthSession).not.toHaveBeenCalled();
  });

  it('rejects a blank weight (must not coerce to 0)', async () => {
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        movements: [{ movementName: 'Back squat', sets: [{ reps: '5', weight: '' }] }],
      }),
    );
    expect(res.ok).toBe(false);
    expect(logStrengthSession).not.toHaveBeenCalled();
  });

  it('rejects two movements sharing a clientId (would silently drop one)', async () => {
    const dupId = '019826b4-0000-7000-8000-0000000000aa';
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        movements: [
          { movementName: 'Back squat', clientId: dupId, sets: [{ reps: '5', weight: '135' }] },
          { movementName: 'Bench press', clientId: dupId, sets: [{ reps: '8', weight: '95' }] },
        ],
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.movements).toBeTruthy();
    expect(logStrengthSession).not.toHaveBeenCalled();
  });

  it('rejects a malformed movements JSON body without touching the DAL', async () => {
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({ profileId: PROFILE_ID, movementsRaw: '{not valid json' }),
    );
    expect(res.ok).toBe(false);
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(logStrengthSession).not.toHaveBeenCalled();
  });

  it('rejects a crafted superset order without a superset id (bad body → zod-reject)', async () => {
    // `supersetOrder` rides in the forwarded movements JSON, so this reaches the schema — the pairing
    // superRefine must reject it as a typed envelope, not let it hit the DB CHECK as a raw 500 (V1-8-3c).
    const badMovements = JSON.stringify([
      {
        movementName: 'Back squat',
        unit: 'lb',
        clientId: newId(),
        sets: [{ reps: '5', weight: '135' }],
        supersetOrder: 5,
      },
    ]);
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({ profileId: PROFILE_ID, movementsRaw: badMovements }),
    );
    expect(res.ok).toBe(false);
    expect(logStrengthSession).not.toHaveBeenCalled();
  });

  it('rejects a missing profileId without touching the DAL', async () => {
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({
        movements: [{ movementName: 'Back squat', sets: [{ reps: '5', weight: '135' }] }],
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.profileId).toBeTruthy();
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(logStrengthSession).not.toHaveBeenCalled();
  });
});

describe('logStrengthSessionAction — happy path (multi-movement session)', () => {
  // V1-24 3a-ii: the island announces and focuses the save from `savedId`, the session's PUBLIC id —
  // and a replay (same client_id) must return the SAME id, or a retried submit focuses nothing.
  // The REPLAY id is proven against a real DB in packages/db/scripts/verify.ts ("same id"); here the
  // DAL is mocked, so this pins that the action forwards whatever id the DAL returns, on every call.
  it("returns the DAL's session id as savedId, and passes the same clientId on a retry", async () => {
    const clientId = newId();
    const form = () =>
      strengthForm({
        profileId: PROFILE_ID,
        clientId,
        movements: [{ movementName: 'Back squat', sets: [{ reps: '5', weight: '135' }] }],
      });
    const first = await logStrengthSessionAction(initial, form());
    const replay = await logStrengthSessionAction(initial, form());
    expect(first).toMatchObject({ ok: true, savedId: 'session-pub-id' });
    expect(replay).toMatchObject({ ok: true, savedId: first.savedId });
    expect(vi.mocked(logStrengthSession).mock.calls.map((c) => c[0].clientId)).toEqual([
      clientId,
      clientId,
    ]);
  });

  it('passes the parsed movements + defaulted sessionType to the DAL and revalidates', async () => {
    const clientId = newId();
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        clientId,
        movements: [
          {
            movementName: 'Back squat',
            sets: [
              { reps: '5', weight: '135' },
              { reps: '3', weight: '155' },
            ],
          },
          { movementName: 'Bench press', sets: [{ reps: '8', weight: '95' }] },
        ],
      }),
    );
    expect(res.ok).toBe(true);
    expect(getProfileByPublicId).toHaveBeenCalledWith(PROFILE_ID);
    expect(logStrengthSession).toHaveBeenCalledWith(
      expect.objectContaining({
        profilePublicId: PROFILE_ID,
        sessionType: 'strength', // the schema default (never submitted) — panel B3
        clientId,
        day: localDay(), // threaded from the rendered day (V1-6c)
        movements: [
          expect.objectContaining({
            movementName: 'Back squat',
            unit: BODYWEIGHT_UNITS[0],
            sets: [
              { reps: 5, weight: 135 }, // coerced to numbers by the schema
              { reps: 3, weight: 155 },
            ],
          }),
          expect.objectContaining({
            movementName: 'Bench press',
            sets: [{ reps: 8, weight: 95 }],
          }),
        ],
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith(athletePath(PROFILE_ID));
  });

  // GAP-1 P0-1 regression. `dayRole` was parsed and then DROPPED on the way to the DAL, so
  // `sessions.day_role` was never written from the app — the whole point of the column. Nothing
  // caught it: `LogStrengthSessionArgs.dayRole` is optional so `tsc` was clean, `db:verify` drives
  // the writer directly (bypassing this action), and the happy-path assertion above uses
  // `objectContaining`, which is BLIND to a key that is simply absent. Hence asserting the VALUE.
  it('threads the declared dayRole to the DAL (it was parsed but never forwarded)', async () => {
    await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        dayRole: 'strength_a',
        movements: [{ movementName: 'Back squat', sets: [{ reps: '5', weight: '135' }] }],
      }),
    );
    expect(vi.mocked(logStrengthSession).mock.calls[0]![0]).toMatchObject({
      dayRole: 'strength_a',
    });
  });

  it('sends dayRole: undefined when the day is not a programmed one', async () => {
    // The "Not a programmed day" option submits '', which `optionalDayRoleSchema` normalises to
    // undefined — it must NOT reach the DAL as '' and land in a CHECK-constrained column.
    await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        dayRole: '',
        movements: [{ movementName: 'Back squat', sets: [{ reps: '5', weight: '135' }] }],
      }),
    );
    expect(vi.mocked(logStrengthSession).mock.calls[0]![0].dayRole).toBeUndefined();
  });

  // GAP-1 P1-1a. The action forwards `parsed.data.movements` wholesale, so `status` threads itself —
  // but "it threads itself" is exactly the assumption that made #98's `dayRole` silently inert. Assert
  // the VALUE reaching the DAL, and via mock.calls rather than `objectContaining`, which cannot see a
  // field going missing. This test is the guard on that whole class of bug.
  it('threads a skipped movement (status + zero sets) through to the DAL', async () => {
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        movements: [
          { movementName: 'Bulgarian split squat', status: 'skipped', sets: [] },
          { movementName: 'Back squat', sets: [{ reps: '5', weight: '135' }] },
        ],
      }),
    );
    expect(res.ok).toBe(true);
    const arg = vi.mocked(logStrengthSession).mock.calls[0]![0];
    expect(arg.movements[0]).toMatchObject({ status: 'skipped', sets: [] });
    // The sibling still logs normally, and an omitted status defaults to `done` on the wire.
    expect(arg.movements[1]).toMatchObject({ status: 'done' });
    expect(arg.movements[1]!.sets).toHaveLength(1);
  });

  it('threads a session feel to the DAL', async () => {
    await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        feel: 'strong',
        movements: [{ movementName: 'Back squat', sets: [{ reps: '5', weight: '135' }] }],
      }),
    );
    expect(logStrengthSession).toHaveBeenCalledWith(expect.objectContaining({ feel: 'strong' }));
  });

  it('normalizes a blank/whitespace feel to undefined (stored NULL, not empty string)', async () => {
    await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        feel: '   ',
        movements: [{ movementName: 'Back squat', sets: [{ reps: '5', weight: '135' }] }],
      }),
    );
    expect(logStrengthSession).toHaveBeenCalledWith(expect.objectContaining({ feel: undefined }));
  });

  it('rejects an over-length feel from a direct POST (bad body → zod-reject)', async () => {
    // The client maxLength is bypassable; the schema `.max` is the real guard.
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        feel: 'x'.repeat(FREE_TEXT_NOTE_MAX + 1),
        movements: [{ movementName: 'Back squat', sets: [{ reps: '5', weight: '135' }] }],
      }),
    );
    expect(res.ok).toBe(false);
    expect(logStrengthSession).not.toHaveBeenCalled();
  });

  it('derives supersets from the tagged movements and threads them to the DAL (V1-8-3d)', async () => {
    const ss = newId();
    // Two movements tagged into one superset; the action derives `supersets: [{clientId: ss}]`.
    const raw = JSON.stringify([
      {
        movementName: 'Bench',
        unit: 'lb',
        clientId: newId(),
        sets: [{ reps: '8', weight: '40' }],
        supersetClientId: ss,
        supersetOrder: 1,
      },
      {
        movementName: 'OHP',
        unit: 'lb',
        clientId: newId(),
        sets: [{ reps: '8', weight: '30' }],
        supersetClientId: ss,
        supersetOrder: 2,
      },
    ]);
    await logStrengthSessionAction(
      initial,
      strengthForm({ profileId: PROFILE_ID, movementsRaw: raw }),
    );
    expect(logStrengthSession).toHaveBeenCalledWith(
      expect.objectContaining({
        supersets: [{ clientId: ss }],
        movements: expect.arrayContaining([
          expect.objectContaining({ supersetClientId: ss, supersetOrder: 1 }),
        ]),
      }),
    );
  });

  it('rejects a lone superset member (≥2) with a locatable superset error (V1-8-3d)', async () => {
    const ss = newId();
    const raw = JSON.stringify([
      {
        movementName: 'Bench',
        unit: 'lb',
        clientId: newId(),
        sets: [{ reps: '8', weight: '40' }],
        supersetClientId: ss,
        supersetOrder: 1,
      },
      {
        movementName: 'Squat',
        unit: 'lb',
        clientId: newId(),
        sets: [{ reps: '5', weight: '135' }],
      }, // standalone → ss has 1 member
    ]);
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({ profileId: PROFILE_ID, movementsRaw: raw }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.supersets).toBeTruthy(); // surfaced, not a locked banner
    expect(logStrengthSession).not.toHaveBeenCalled();
  });

  it('fails gracefully (no write) when the profile is unknown', async () => {
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce(null);
    const res = await logStrengthSessionAction(
      initial,
      strengthForm({
        profileId: PROFILE_ID,
        movements: [{ movementName: 'Back squat', sets: [{ reps: '5', weight: '135' }] }],
      }),
    );
    expect(res.ok).toBe(false);
    expect(logStrengthSession).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

// ── V1-5: check-ins / habits ────────────────────────────────────────────────────
//
// These drive REAL FormData objects on purpose. A checkbox submits the STRING "1",
// never the number 1 — a `z.literal(1)` validator would reject every checkbox and
// make the happy path unreachable, and a hand-built object fixture would hide it.

const HABIT = CHECKIN_FIELDS.find((f) => f.metricKey === null)!;
const BOOL_METRIC = CHECKIN_FIELDS.find((f) => f.valueType === 'bool')!;
const SCALE_METRIC = CHECKIN_FIELDS.find((f) => f.valueType === 'scale_10')!;

/** Build check-in FormData: one `v:`/`c:` pair per submitted field. */
function checkinForm(opts: {
  profileId?: string;
  day?: string;
  values?: Record<string, string>;
  clientIds?: Record<string, string>;
  extra?: Record<string, string>;
}): FormData {
  const fd = new FormData();
  if (opts.profileId !== undefined) fd.append('profileId', opts.profileId);
  fd.append('day', opts.day ?? localDay());
  for (const [key, value] of Object.entries(opts.values ?? {})) {
    fd.append(valueInputName(key), value);
    fd.append(clientIdInputName(key), opts.clientIds?.[key] ?? newId());
  }
  for (const [k, v] of Object.entries(opts.extra ?? {})) fd.append(k, v);
  return fd;
}

describe('logCheckinsAction — boundary (bad body → zod-reject)', () => {
  it('rejects a missing profileId without touching the DAL', async () => {
    const res = await logCheckinsAction(initial, checkinForm({ values: { [HABIT.key]: '1' } }));
    expect(res.ok).toBe(false);
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(logCheckinEntries).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects a malformed (non-UUID) profileId', async () => {
    const res = await logCheckinsAction(
      initial,
      checkinForm({ profileId: 'not-a-uuid', values: { [HABIT.key]: '1' } }),
    );
    expect(res.ok).toBe(false);
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });

  it('rejects an empty submission (nothing checked)', async () => {
    const res = await logCheckinsAction(initial, checkinForm({ profileId: PROFILE_ID }));
    expect(res.ok).toBe(false);
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });

  it('IGNORES an unknown field key — the action walks the registry, not the body', async () => {
    const res = await logCheckinsAction(
      initial,
      checkinForm({
        profileId: PROFILE_ID,
        values: { [HABIT.key]: '1' },
        extra: { 'v:evil_key': '1', 'c:evil_key': newId(), unit: 'lb', activityKey: 'sc_lift' },
      }),
    );
    expect(res.ok).toBe(true);
    const items = vi.mocked(logCheckinEntries).mock.calls[0]![0].items;
    expect(items).toHaveLength(1);
    expect(items[0]!.activityKey).toBe(HABIT.activityKey);
  });

  it('rejects a checkbox value other than "1"', async () => {
    const res = await logCheckinsAction(
      initial,
      checkinForm({ profileId: PROFILE_ID, values: { [HABIT.key]: '2' } }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.[HABIT.key]).toBeTruthy();
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });

  it.each(['0', '11', 'abc'])('rejects an out-of-range scale_10 value (%s)', async (bad) => {
    const res = await logCheckinsAction(
      initial,
      checkinForm({ profileId: PROFILE_ID, values: { [SCALE_METRIC.key]: bad } }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.[SCALE_METRIC.key]).toBeTruthy();
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });

  it('reports EVERY invalid field, not just the first', async () => {
    const res = await logCheckinsAction(
      initial,
      checkinForm({
        profileId: PROFILE_ID,
        values: { [HABIT.key]: '2', [SCALE_METRIC.key]: '99' },
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.[HABIT.key]).toBeTruthy();
    expect(res.fieldErrors?.[SCALE_METRIC.key]).toBeTruthy();
  });

  it('rejects a non-UUID clientId', async () => {
    const fd = checkinForm({ profileId: PROFILE_ID });
    fd.append(valueInputName(HABIT.key), '1');
    fd.append(clientIdInputName(HABIT.key), 'not-a-uuid');
    const res = await logCheckinsAction(initial, fd);
    expect(res.ok).toBe(false);
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });

  // todayIso() is UTC and check-ins are evening activities, so the form submits the day
  // it rendered; a day far from the server's today means a stale tab, not a valid log.
  it('rejects a stale day (more than ±1 from today)', async () => {
    const res = await logCheckinsAction(
      initial,
      checkinForm({ profileId: PROFILE_ID, day: '2020-01-01', values: { [HABIT.key]: '1' } }),
    );
    expect(res.ok).toBe(false);
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });
});

describe('logCheckinsAction — happy path + ownership', () => {
  it('parses the checkbox STRING "1" to numeric 1 and writes via the DAL', async () => {
    const clientId = newId();
    const res = await logCheckinsAction(
      initial,
      checkinForm({
        profileId: PROFILE_ID,
        values: { [HABIT.key]: '1' },
        clientIds: { [HABIT.key]: clientId },
      }),
    );
    expect(res.ok).toBe(true);
    expect(getProfileByPublicId).toHaveBeenCalledWith(PROFILE_ID);
    expect(logCheckinEntries).toHaveBeenCalledWith(
      expect.objectContaining({
        profilePublicId: PROFILE_ID,
        day: localDay(),
        items: [{ activityKey: HABIT.activityKey, metricKey: null, value: 1, clientId }],
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith(athletePath(PROFILE_ID));
  });

  it('writes a mixed batch: a habit, a bool metric, and a rated metric', async () => {
    const res = await logCheckinsAction(
      initial,
      checkinForm({
        profileId: PROFILE_ID,
        values: { [HABIT.key]: '1', [BOOL_METRIC.key]: '1', [SCALE_METRIC.key]: '7' },
      }),
    );
    expect(res.ok).toBe(true);
    const items = vi.mocked(logCheckinEntries).mock.calls[0]![0].items;
    expect(items).toHaveLength(3);
    // A bare habit carries NEITHER source column — the shape V1-5 introduces.
    expect(items.find((i) => i.activityKey === HABIT.activityKey)!.metricKey).toBeNull();
    expect(items.find((i) => i.metricKey === BOOL_METRIC.metricKey)!.value).toBe(1);
    expect(items.find((i) => i.metricKey === SCALE_METRIC.metricKey)!.value).toBe(7);
    // `unit` is never on the wire — the DAL resolves it from the seeded catalog.
    for (const i of items) expect(i).not.toHaveProperty('unit');
  });

  it('fails gracefully (no write) when the profile is unknown', async () => {
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce(null);
    const res = await logCheckinsAction(
      initial,
      checkinForm({ profileId: PROFILE_ID, values: { [HABIT.key]: '1' } }),
    );
    expect(res.ok).toBe(false);
    expect(logCheckinEntries).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  // client_id UNIQUE is GLOBAL, not profile-scoped: a colliding id writes nothing.
  // Reporting success there would mask a lost write.
  it('reports failure when every item conflicted (nothing written)', async () => {
    vi.mocked(logCheckinEntries).mockResolvedValueOnce([
      { clientId: 'x', id: null, created: false },
    ]);
    const res = await logCheckinsAction(
      initial,
      checkinForm({ profileId: PROFILE_ID, values: { [HABIT.key]: '1' } }),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already logged/i);
  });
});

// ── V1-6a: calisthenics (accumulating count metrics) ─────────────────────────────
const CALIS = CHECKIN_FIELDS.find((f) => f.activityKey === 'calisthenics')!;

describe('logCheckinsAction — calisthenics counts', () => {
  it('logs a filled counter via the DAL (rides the V1-5 count path)', async () => {
    const clientId = newId();
    const res = await logCheckinsAction(
      initial,
      checkinForm({
        profileId: PROFILE_ID,
        values: { [CALIS.key]: '20' },
        clientIds: { [CALIS.key]: clientId },
      }),
    );
    expect(res.ok).toBe(true);
    const items = vi.mocked(logCheckinEntries).mock.calls[0]![0].items;
    expect(items).toEqual([
      { activityKey: 'calisthenics', metricKey: CALIS.metricKey, value: 20, clientId },
    ]);
  });

  it.each(['-1', '100000.5', 'abc'])(
    'rejects an out-of-range / non-int count (%s)',
    async (bad) => {
      const res = await logCheckinsAction(
        initial,
        checkinForm({ profileId: PROFILE_ID, values: { [CALIS.key]: bad } }),
      );
      expect(res.ok).toBe(false);
      expect(res.fieldErrors?.[CALIS.key]).toBeTruthy();
      expect(logCheckinEntries).not.toHaveBeenCalled();
    },
  );

  it('ignores a blank counter (not submitted)', async () => {
    const res = await logCheckinsAction(
      initial,
      checkinForm({ profileId: PROFILE_ID, values: { [CALIS.key]: '   ' } }),
    );
    expect(res.ok).toBe(false); // nothing submitted at all
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });
});

// ── V1-6c: the shared declared-day ±1 bound applies to ALL THREE writers ──────────
// resolveDeclaredDay bounds the rendered `day` to the active-tz today ±1, so a write lands
// on the day the user saw (even across local midnight) but a stale tab is rejected.
describe('declared-day ±1 bound (shared across writers)', () => {
  const bwForm = (day: string) =>
    form({ profileId: PROFILE_ID, value: '180', unit: 'lb', clientId: newId(), day });
  const strForm = (day: string) =>
    strengthForm({
      profileId: PROFILE_ID,
      movements: [{ movementName: 'Back squat', sets: [{ reps: '5', weight: '135' }] }],
      day,
    });
  const ciForm = (day: string) =>
    checkinForm({ profileId: PROFILE_ID, day, values: { [HABIT.key]: '1' } });

  it.each([-1, 0, 1])('accepts a day within ±1 (offset %s)', async (offset) => {
    const day = localDay(offset);
    expect((await logBodyweightAction(initial, bwForm(day))).ok).toBe(true);
    expect((await logStrengthSessionAction(initial, strForm(day))).ok).toBe(true);
    expect((await logCheckinsAction(initial, ciForm(day))).ok).toBe(true);
    // Sanity: the offset day is exactly ±1 (or 0) from the active-tz today.
    expect(Math.abs(isoDayDiff(day, localDay()))).toBeLessThanOrEqual(1);
  });

  it('rejects a day more than +1 ahead (stale/forward tab) on every writer', async () => {
    const day = localDay(2);
    const bw = await logBodyweightAction(initial, bwForm(day));
    const str = await logStrengthSessionAction(initial, strForm(day));
    const ci = await logCheckinsAction(initial, ciForm(day));
    for (const res of [bw, str, ci]) expect(res.ok).toBe(false);
    expect(logBodyweight).not.toHaveBeenCalled();
    expect(logStrengthSession).not.toHaveBeenCalled();
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });

  it('rejects a malformed day on bodyweight/strength (after zod, before the DAL)', async () => {
    expect((await logBodyweightAction(initial, bwForm('not-a-date'))).ok).toBe(false);
    expect((await logStrengthSessionAction(initial, strForm('2026-13-99'))).ok).toBe(false);
    expect(logBodyweight).not.toHaveBeenCalled();
    expect(logStrengthSession).not.toHaveBeenCalled();
  });
});

// ── V1-7: life activities (wake = timing event, wrestling_practice = one-tap duration) ──────
const lifeForm = (fields: Record<string, string>) =>
  form({ profileId: PROFILE_ID, clientId: newId(), ...fields });

describe('logLifeActivitiesAction — boundary', () => {
  it('rejects an activityKey not in the trusted life set (never trust the body)', async () => {
    const res = await logLifeActivitiesAction(
      initial,
      lifeForm({ activityKey: 'sc_lift' }), // a real activity, but not a life one
    );
    expect(res.ok).toBe(false);
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });

  it('rejects a missing/absent activityKey', async () => {
    const res = await logLifeActivitiesAction(
      initial,
      form({ profileId: PROFILE_ID, clientId: newId() }),
    );
    expect(res.ok).toBe(false);
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });

  it('rejects a missing/malformed profileId or clientId without touching the DAL', async () => {
    expect(
      (
        await logLifeActivitiesAction(
          initial,
          form({ activityKey: ACTIVITY_TYPE_KEYS.wake, clientId: newId() }),
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await logLifeActivitiesAction(
          initial,
          lifeForm({ activityKey: ACTIVITY_TYPE_KEYS.wake, clientId: 'nope' }),
        )
      ).ok,
    ).toBe(false);
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });

  it('rejects a stale day on wrestling practice (day-grain, bounded ±1)', async () => {
    const res = await logLifeActivitiesAction(
      initial,
      lifeForm({ activityKey: ACTIVITY_TYPE_KEYS.wrestling_practice, day: '2020-01-01' }),
    );
    expect(res.ok).toBe(false);
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });

  it('IGNORES the declared day for wake (a "now" event stamps its own day, no ±1 rejection)', async () => {
    // Wake derives day/minutes/event_at from now, so even a wildly stale rendered `day` still logs
    // (on today) — the cross-midnight-wrong-day bug the review caught can't happen.
    const res = await logLifeActivitiesAction(
      initial,
      lifeForm({ activityKey: ACTIVITY_TYPE_KEYS.wake, day: '2020-01-01' }),
    );
    expect(res.ok).toBe(true);
    expect(vi.mocked(logCheckinEntries).mock.calls[0]![0].day).toBe(localDay());
  });

  it('fails gracefully (no write) when the profile is unknown', async () => {
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce(null);
    const res = await logLifeActivitiesAction(
      initial,
      lifeForm({ activityKey: ACTIVITY_TYPE_KEYS.wrestling_practice }),
    );
    expect(res.ok).toBe(false);
    expect(logCheckinEntries).not.toHaveBeenCalled();
  });
});

describe('logLifeActivitiesAction — happy path', () => {
  it('logs wake as a timing event: metricKey null, eventAt a Date, value = local minutes (0–1439)', async () => {
    const clientId = newId();
    const res = await logLifeActivitiesAction(
      initial,
      lifeForm({ activityKey: ACTIVITY_TYPE_KEYS.wake, clientId }),
    );
    expect(res.ok).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith(athletePath(PROFILE_ID));
    const { items, day } = vi.mocked(logCheckinEntries).mock.calls[0]![0];
    expect(day).toBe(localDay());
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.activityKey).toBe(ACTIVITY_TYPE_KEYS.wake);
    expect(item.metricKey).toBeNull();
    expect(item.clientId).toBe(clientId);
    expect(item.eventAt).toBeInstanceOf(Date);
    expect(item.value).toBeGreaterThanOrEqual(0);
    expect(item.value).toBeLessThanOrEqual(1439);
    expect(Number.isInteger(item.value)).toBe(true);
  });

  it('logs wrestling practice one-tap: practice_minutes at the default, no eventAt', async () => {
    const res = await logLifeActivitiesAction(
      initial,
      lifeForm({ activityKey: ACTIVITY_TYPE_KEYS.wrestling_practice }),
    );
    expect(res.ok).toBe(true);
    const item = vi.mocked(logCheckinEntries).mock.calls[0]![0].items[0]!;
    expect(item.activityKey).toBe(ACTIVITY_TYPE_KEYS.wrestling_practice);
    expect(item.metricKey).toBe(METRIC_KEYS.practice_minutes);
    expect(item.value).toBe(DEFAULT_PRACTICE_MINUTES);
    expect(item.eventAt).toBeUndefined();
  });

  it('treats an idempotent replay (client_id conflict) as SUCCESS, not a destructive error', async () => {
    // A one-tap double-tap reuses the same fixed client_id → ON CONFLICT dedupe → created:false. The
    // end state is identical (the activity is logged), so it must return ok:true — never a red
    // "already logged" alert for an operation that in fact succeeded (review finding).
    vi.mocked(logCheckinEntries).mockResolvedValueOnce([
      { clientId: 'x', id: null, created: false },
    ]);
    const res = await logLifeActivitiesAction(
      initial,
      lifeForm({ activityKey: ACTIVITY_TYPE_KEYS.wake }),
    );
    expect(res.ok).toBe(true);
  });
});

// A fresh set id (UUIDv7) for the edit tests — the DAL is mocked, so it just needs to pass uuidSchema.
function editForm(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

describe('editStrengthSetAction — boundary (bad body → zod-reject)', () => {
  it('rejects a non-numeric reps without touching the DAL', async () => {
    const res = await editStrengthSetAction(
      initial,
      editForm({ profileId: PROFILE_ID, setId: newId(), reps: 'abc', weight: '135' }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.reps).toBeTruthy();
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(editStrengthSet).not.toHaveBeenCalled();
  });

  it('rejects a blank weight (blank must not slip past as 0)', async () => {
    const res = await editStrengthSetAction(
      initial,
      editForm({ profileId: PROFILE_ID, setId: newId(), reps: '5', weight: '' }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.weight).toBeTruthy();
    expect(editStrengthSet).not.toHaveBeenCalled();
  });

  it('rejects a non-UUID setId', async () => {
    const res = await editStrengthSetAction(
      initial,
      editForm({ profileId: PROFILE_ID, setId: 'not-a-uuid', reps: '5', weight: '135' }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.setId).toBeTruthy();
    expect(editStrengthSet).not.toHaveBeenCalled();
  });

  it('rejects a malformed profileId without touching the DAL', async () => {
    const res = await editStrengthSetAction(
      initial,
      editForm({ profileId: 'not-a-uuid', setId: newId(), reps: '5', weight: '135' }),
    );
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.profileId).toBeTruthy();
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(editStrengthSet).not.toHaveBeenCalled();
  });
});

describe('editStrengthSetAction — happy path + not-found', () => {
  it('edits a valid set via the DAL and revalidates the scoped Today', async () => {
    const setId = newId();
    const res = await editStrengthSetAction(
      initial,
      editForm({ profileId: PROFILE_ID, setId, reps: '7', weight: '142.5' }),
    );
    expect(res.ok).toBe(true);
    expect(getProfileByPublicId).toHaveBeenCalledWith(PROFILE_ID);
    expect(editStrengthSet).toHaveBeenCalledWith(
      expect.objectContaining({ profilePublicId: PROFILE_ID, setId, reps: 7, weight: 142.5 }),
    );
    expect(revalidatePath).toHaveBeenCalledWith(athletePath(PROFILE_ID));
  });

  it('maps a not-found set (wrong owner / stale id) to the shared typed error, and revalidates', async () => {
    // The guarded UPDATE matched no row → the DAL returns null. That is an EXPECTED outcome, so the
    // action returns { ok:false }, never a throw to error.tsx.
    vi.mocked(editStrengthSet).mockResolvedValueOnce(null);
    const res = await editStrengthSetAction(
      initial,
      editForm({ profileId: PROFILE_ID, setId: newId(), reps: '7', weight: '142.5' }),
    );
    expect(res.ok).toBe(false);
    // The SAME copy the bodyweight amend uses, and a revalidate so "the page now shows what's saved"
    // is true. A revalidate tells a crafted request nothing a stale one wouldn't.
    expect(res.error).toBe(AMEND_ERROR_COPY.notFound('set'));
    expect(revalidatePath).toHaveBeenCalledWith(athletePath(PROFILE_ID));
  });
});

// ── V1-18 PR 2: the coach routine editor ─────────────────────────────────────────
// The routine rides as ONE hidden `routine` JSON field (an ordered variable-length list, the
// strength-form idiom). `validateRoutineForWrite` is the trust boundary — it REJECTS an empty /
// non-catalog / duplicate order against the REAL ROUTINE_CATALOG (no drop-and-store). Two real catalog
// keys keep these tests bound to the live catalog, not re-typed strings.
const [ROUTINE_K1, ROUTINE_K2] = ROUTINE_CATALOG; // 'strength', then the first check-in key
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
  editForm({
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
    expect(res.error).toBe(AMEND_ERROR_COPY.notFound('weight'));
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

/**
 * MANDATORY wrong-owner → forbid (AGENTS.md → Backend / API PR rules) — **satisfiable for the first
 * time in this repo.** Until TEN-1 1b there was no notion of whose request this was, and `actions.ts`
 * said so in as many words: *"any known profile id writes to that profile."*
 *
 * ⚠️ **What this suite proves, stated precisely, because the panel caught the first draft
 * over-claiming it (A2 · S1 · C7).** `getProfileByPublicId` is mocked wholesale here, so a
 * foreign-household id and an unknown id are byte-identical AT THIS BOUNDARY — and that is the point:
 * this proves the **action layer's** half, that a `null` resolution refuses with the shared copy,
 * calls no writer and revalidates nothing, for all seven actions. It would stay green with the
 * household conjunct deleted, which is exactly why **the scoping itself is proved in `db:verify`'s
 * two-household matrix**, in both directions, against a real database. Two vehicles, each honest
 * about its own half.
 *
 * The `null` also covers the **no-scope** path: a zero-household database resolves no scope, so
 * `getProfileByPublicId` returns `null` and every action takes this same route — dark, not leaky.
 *
 * ⚠️ Each case needs a body that would otherwise SUCCEED. An action that zod-rejects first never
 * reaches the ownership check, and a suite built on `form({ profileId })` would have proved nothing
 * while looking identical in the report.
 */
describe('every Server Action — wrong household → the same refusal as not-found (TEN-1)', () => {
  it('every action has a body that reaches the ownership check (no vacuous case)', async () => {
    // The guard on the guard: with the default mocks every one of these must SUCCEED, so a case that
    // refuses below is refusing for the reason this suite is about.
    // 🔴 PROFILE-ADDRESSED ONLY (WP-1). These three sites make a `profileId` foreign; an action
    // with no `profileId` in its body cannot be driven that way, so a `household` entry is
    // excluded here by scope rather than by being forgotten. ⚠️ The unauth and rate-limit
    // suites above stay over ALL entries on purpose — a household action must still be
    // rate-limited, and `addAthleteAction` is the one that grows a table without bound.
    for (const [name, action] of PROFILE_ACTIONS.map(([n, a]) => [n, a] as const)) {
      vi.clearAllMocks();
      const res = await action(initial, VALID_BODY[name]!());
      expect(
        res.ok,
        `${name}: the valid body must succeed, or its refusal case proves nothing`,
      ).toBe(true);
    }
  });

  it.each(PROFILE_ACTIONS)(
    '%s refuses a profile outside the request’s household',
    async (name, action, notFound) => {
      vi.mocked(getProfileByPublicId).mockResolvedValue(null);
      const res = await action(initial, VALID_BODY[name]!());
      expect(res).toEqual({ ok: false, error: notFound });
      // The session passed and the profile WAS looked up — the authZ refusal, not the authN one.
      // ⚠️ Switched from `hasGateAccess` at 1d: the point is that the EARLIER conjunct ran and
      // passed, so this must track whichever check is first, not be dropped.
      expect(sessionUserOrNull).toHaveBeenCalled();
      expect(getProfileByPublicId).toHaveBeenCalledWith(PROFILE_ID);
      for (const write of ALL_WRITERS) expect(write).not.toHaveBeenCalled();
      expect(updateProfileRoutine).not.toHaveBeenCalled();
      // No revalidate: a refusal must not even confirm which path exists.
      expect(revalidatePath).not.toHaveBeenCalled();
      vi.mocked(getProfileByPublicId).mockReset();
    },
  );

  it('the refusal is byte-identical to the no-session one, for every action', async () => {
    // The whole 404-never-403 argument (ADR 0006). If these two ever diverge the envelope becomes an
    // oracle for "that profile exists, just not for you".
    for (const [name, action, notFound] of PROFILE_ACTIONS) {
      vi.clearAllMocks();
      vi.mocked(sessionUserOrNull).mockResolvedValueOnce(null);
      const unauthed = await action(initial, VALID_BODY[name]!());

      vi.clearAllMocks();
      vi.mocked(getProfileByPublicId).mockResolvedValue(null);
      const foreign = await action(initial, VALID_BODY[name]!());
      vi.mocked(getProfileByPublicId).mockReset();

      expect(foreign, `${name}: foreign-household and unauthed must be indistinguishable`).toEqual(
        unauthed,
      );
      expect(foreign.error).toBe(notFound);
    }
  });
});

/**
 * AUTH-1 1b-bis. `ACTION_FNS` being a `Record<MutatingActionName, ActionFn>` means the suite cannot
 * SKIP an action in `MUTATING_ACTIONS` — that is a type error. This closes the other direction: an
 * action added to `actions.ts` and never added to `MUTATING_ACTIONS` would be invisible to every
 * boundary suite in this file, which is exactly the hole `docs/features/write-path.md` invariant 1
 * admitted in writing ("only if you add it to that suite: do").
 *
 * It reads the module's SOURCE rather than its exports because `actions.ts` is mocked to the eyeballs
 * in this file — importing it for reflection would return the mocks, not the real surface.
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
 * missing from the registry fails here, and once it is in the registry
 * `Record<MatrixActionName, Binding>` forces a binding, and every matrix runs it. **Detecting an
 * unlisted module would NOT have been enough** — that is bookkeeping, and the action would still be
 * untested. This is why PROF-1 a-r is gated on WP-1: it registers `renameAthleteAction` while that
 * function lives in `app/p/profile-actions.ts`, which would have made the old assertion fail with 8
 * keys against 7 exports.
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
    expect(excludedActionNames()).toEqual([]);
  });

  /**
   * A name exported by two modules would make the registry ambiguous and silently drop one from the
   * sorted equality above. Cheap to pin, impossible to debug if it ever happens.
   */
  it('no action name is exported by two modules', () => {
    const names = modules.flatMap((m) => exportedActionNames(m));
    expect(names.length).toBe(new Set(names).size);
  });
});

/**
 * 🔴 **The HOUSEHOLD matrix (PROF-1 a-1w) — the proof a household-addressed action has no other way
 * to get.**
 *
 * Every other mutating action carries a `profileId`, and the wrong-household suite makes it foreign.
 * `addAthleteAction` carries none: there is nothing to point at another household. So the isolation
 * question lives in `createProfile`'s two scoped reads and is proved in `db:verify` against a real
 * two-household database (mutation patch `20` shows that proof can fail). What belongs HERE is the
 * tier above it: when the DAL reports that **no household resolved**, the action must answer exactly
 * as it does to a stranger, write nothing, and navigate nowhere.
 *
 * WP-1's plan accepted this suite and the two binding fields it needs (R1, R7) and shipped neither —
 * so until this file, the only matrix rows that could reach a household action were unauth and
 * rate-limit, with **no wrong-owner row at all**.
 */
describe('every HOUSEHOLD-addressed Server Action — a scope miss answers like a stranger', () => {
  /**
   * ⚠️ **The floor, first.** `it.each([])` passes silently in vitest, so a suite whose rows come from
   * a filtered registry can go green by matching nothing — which is precisely how this suite would
   * have reported success on the day `addAthleteAction` was registered with the wrong scope.
   */
  it('drives at least one action (an empty matrix passes everything below)', () => {
    expect(HOUSEHOLD_ACTIONS.length).toBeGreaterThan(0);
  });

  it.each(HOUSEHOLD_ACTIONS)(
    '%s succeeds on the happy path, or its refusal case proves nothing',
    async (name, action) => {
      vi.clearAllMocks();
      const res = await action(initial, VALID_BODY[name]!()).catch((e: Error) => e);
      // ⚠️ **The default is real, not documentation.** `succeeded?.(…)` alone meant a binding without
      // one asserted NOTHING here — and `.catch` has already swallowed any throw, so the row would
      // pass for an action that failed outright. Today's single entry defines `succeeded`; the next
      // one that does not must still be held to `ok`.
      const binding = ACTION_BINDINGS[name as MatrixActionName];
      if (binding.succeeded) binding.succeeded(res as ActionState);
      else expect(res, `${name}: a valid body must succeed`).toMatchObject({ ok: true });
    },
  );

  it.each(HOUSEHOLD_ACTIONS)(
    '%s refuses a scope miss with the not-found bytes, and writes nothing',
    async (name, action, refusal) => {
      vi.clearAllMocks();
      ACTION_BINDINGS[name as MatrixActionName].scopeMiss?.();
      const res = await action(initial, VALID_BODY[name]!());

      expect(res).toEqual({ ok: false, error: refusal });
      // 🔴 Nothing navigated and nothing was revalidated — a refusal that redirected would put the
      // caller on a page they have no business seeing, and one that revalidated would churn caches
      // for a write that never happened.
      expect(redirect).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it('the scope-miss refusal is byte-identical to the no-session one, for every action', async () => {
    for (const [name, action, refusal] of HOUSEHOLD_ACTIONS) {
      vi.clearAllMocks();
      ACTION_BINDINGS[name as MatrixActionName].scopeMiss?.();
      const missed = await action(initial, VALID_BODY[name]!());

      vi.clearAllMocks();
      vi.mocked(sessionUserOrNull).mockResolvedValueOnce(null);
      const unauthed = await action(initial, VALID_BODY[name]!());

      expect(
        missed,
        `${name}: a signed-in caller with no household and an unauthenticated one must be indistinguishable`,
      ).toEqual(unauthed);
      expect(unauthed).toEqual({ ok: false, error: refusal });
    }
  });
});
