import {
  E2E_SESSION_BYPASS_USER,
  PROFILE_KIND,
  PROFILE_KINDS,
  PROFILE_NAME_MAX,
  foldName,
} from '@mat-plan/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * INTEGRATION TIER — `renameAthleteAction` as a plain async function, with its boundaries mocked
 * (AGENTS.md: Server Actions aren't HTTP routes). PROF-1 a-r.
 *
 * 🔴 **This file is NOT where the boundary matrices live, and that is the WP-1 convention.** The
 * mandatory unauth / rate-limit / wrong-household / byte-identical-refusal suites run over the
 * REGISTRY, in `app/p/[profileId]/actions.test.ts`, so they cover every module at once and a new
 * action cannot be added without entering them. What belongs here is the per-action behaviour those
 * matrices cannot express: which bodies zod refuses, what a success returns, and which paths are
 * revalidated.
 */
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// Throws like Next's, so a redirect misplaced inside a try cannot pass silently.
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
  RedirectType: { replace: 'replace', push: 'push' },
}));
vi.mock('@/lib/dal/session', () => ({
  sessionUserOrNull: vi.fn(async () => ({ userId: PRINCIPAL })),
}));
// The limiter fails open and is `null` under vitest, so a refusal is only reachable through a mock.
vi.mock('@/lib/rate-limit', () => ({
  checkMutationLimit: vi.fn(async () => ({ allowed: true, reason: 'ok' })),
}));
vi.mock('@/lib/dal/profiles', () => ({
  getProfileByPublicId: vi.fn(async () => ({
    id: PROFILE_ID,
    name: 'Athlete One',
    kind: PROFILE_KIND.kid,
    avatar: null,
    routine: { version: 1, order: [] },
    firstDay: '2026-01-01',
  })),
  renameAthlete: vi.fn(async () => ({ ok: true, publicId: PROFILE_ID })),
  // PROF-1 b — the DISCRIMINATED result, because these two own the refusal order.
  archiveAthlete: vi.fn(async () => ({ ok: true, id: PROFILE_ID })),
  restoreAthlete: vi.fn(async () => ({ ok: true, id: PROFILE_ID })),
  // PROF-1 a-1w.
  createAthlete: vi.fn(async () => ({ ok: true, id: PROFILE_ID })),
}));

import { revalidatePath } from 'next/cache';
import { redirect, RedirectType } from 'next/navigation';

import {
  APP_HOME_PATH,
  athleteEditPath,
  athletePath,
  NO_ATHLETE_SAVE,
  HOUSEHOLD_FULL,
  NO_ATHLETE_ADD,
  OWNER_ONLY_ATHLETE,
  RATE_LIMITED,
  SETTINGS_PATH,
} from '@/lib/constants';
import {
  archiveAthlete,
  createAthlete,
  getProfileByPublicId,
  renameAthlete,
  restoreAthlete,
} from '@/lib/dal/profiles';
import { checkMutationLimit } from '@/lib/rate-limit';

import type { ActionState } from './[profileId]/action-state';
import {
  addAthleteAction,
  archiveAthleteAction,
  renameAthleteAction,
  restoreAthleteAction,
} from './profile-actions';

const PRINCIPAL = E2E_SESSION_BYPASS_USER;
const PROFILE_ID = '019826b4-0000-7000-8000-000000000001';
const initial: ActionState = { ok: false, error: null };

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

beforeEach(() => vi.clearAllMocks());

describe('renameAthleteAction — boundary (bad body → zod-reject, nothing written)', () => {
  it.each([
    ['a blank name', { profileId: PROFILE_ID, name: '' }],
    ['a whitespace-only name', { profileId: PROFILE_ID, name: '   ' }],
    ['a name one over the cap', { profileId: PROFILE_ID, name: 'a'.repeat(PROFILE_NAME_MAX + 1) }],
    ['a name that folds to nothing', { profileId: PROFILE_ID, name: '́̂' }],
    ['a NUL byte', { profileId: PROFILE_ID, name: '\u0000Ada' }],
    ['a zero-width space only', { profileId: PROFILE_ID, name: '\u200b' }],
  ])('refuses %s as a FIELD error and never reaches the DAL', async (_label, fields) => {
    const res = await renameAthleteAction(initial, form(fields));

    expect(res.ok).toBe(false);
    // A field error, not a page-level alert: the input is what the parent has to fix.
    expect(res.fieldErrors?.name?.length).toBeGreaterThan(0);
    expect(res.error).toBeNull();
    // 🔴 The zod parse comes BEFORE the ownership read, so neither the read nor the write ran.
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(renameAthlete).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  /**
   * A line break in a NAME is COLLAPSED, not refused — see `athleteNameSchema`'s step 2. It is the
   * one case here that reaches the DAL, so it is asserted as a success rather than left unstated.
   */
  it('collapses a pasted line break instead of refusing it', async () => {
    const res = await renameAthleteAction(
      initial,
      form({ profileId: PROFILE_ID, name: 'Ada\nMae' }),
    );
    expect(res.ok).toBe(true);
    expect(vi.mocked(renameAthlete).mock.calls[0]!.slice(0, 2)).toEqual([PROFILE_ID, 'Ada Mae']);
  });

  it('refuses a missing name field (no `name` in the body at all)', async () => {
    const res = await renameAthleteAction(initial, form({ profileId: PROFILE_ID }));
    expect(res.ok).toBe(false);
    expect(renameAthlete).not.toHaveBeenCalled();
  });

  /**
   * 🔴 A malformed `profileId` answers with the NOT-FOUND refusal, not a field error — the id is a
   * hidden field, so a `fieldErrors.name` the form would render as an invalid name input is the wrong
   * answer, and answering differently from an unknown id would make a bad id an oracle for "that one
   * was at least shaped like an athlete".
   */
  it('answers a non-uuid profileId exactly as an unknown athlete', async () => {
    const res = await renameAthleteAction(initial, form({ profileId: 'new', name: 'Ada' }));
    expect(res).toEqual({ ok: false, error: NO_ATHLETE_SAVE });
    expect(res.fieldErrors).toBeUndefined();
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(renameAthlete).not.toHaveBeenCalled();
  });
});

describe('renameAthleteAction — happy path', () => {
  it('stores the collapsed, trimmed name and revalidates the three surfaces that render it', async () => {
    const res = await renameAthleteAction(
      initial,
      form({ profileId: PROFILE_ID, name: '  Ada   Mae  ' }),
    );

    expect(res).toEqual({ ok: true, error: null });
    // 🔴 The name reaching the DAL is the SCHEMA's output, not the raw field: whitespace-collapsed,
    // so the stored name matches what `foldName` will compare and what a-1d's warning will quote.
    expect(vi.mocked(renameAthlete).mock.calls[0]!.slice(0, 2)).toEqual([PROFILE_ID, 'Ada Mae']);
    // The ownership seam ran first, on the id from the body.
    expect(getProfileByPublicId).toHaveBeenCalledWith(PROFILE_ID);

    const paths = vi.mocked(revalidatePath).mock.calls.map(([p]) => p);
    expect(paths).toEqual([APP_HOME_PATH, athletePath(PROFILE_ID), athleteEditPath(PROFILE_ID)]);
  });

  /**
   * The action threads the id the DAL RESOLVED, never the one from the body. They are equal here, so
   * this asserts the plumbing rather than a difference — which is exactly what would silently break
   * if a future edit revalidated `parsed.data.profileId` instead.
   */
  it('revalidates using the id the DAL returned', async () => {
    const OTHER = '019826b4-0000-7000-8000-0000000000ff';
    vi.mocked(renameAthlete).mockResolvedValueOnce({ ok: true, publicId: OTHER });
    await renameAthleteAction(initial, form({ profileId: PROFILE_ID, name: 'Ada' }));
    const paths = vi.mocked(revalidatePath).mock.calls.map(([p]) => p);
    expect(paths).toContain(athletePath(OTHER));
  });

  /** An accent is stored as typed — folding is for comparison only, never for storage. */
  it('stores a name with combining marks as typed', async () => {
    await renameAthleteAction(initial, form({ profileId: PROFILE_ID, name: 'Zoë' }));
    expect(vi.mocked(renameAthlete).mock.calls[0]!.slice(0, 2)).toEqual([PROFILE_ID, 'Zoë']);
  });
});

describe('renameAthleteAction — the duplicate warning (PROF-1 a-1d-ren)', () => {
  const match = {
    publicId: 'p-match',
    name: 'Ada',
    kind: PROFILE_KIND.kid,
    archived: false,
  };

  it('maps a duplicate to the envelope, with NO atCap — a rename creates nothing', async () => {
    vi.mocked(renameAthlete).mockResolvedValueOnce({ ok: false, reason: 'duplicate', match });
    const res = await renameAthleteAction(initial, form({ profileId: PROFILE_ID, name: 'Ada' }));
    // 🔴 `toEqual`, so the absence of `atCap` is pinned rather than merely untested. The add form's
    // envelope carries it because an archived twin occupies a slot in a full household; a rename
    // consults no quota, so a value there would always be `false` and read as meaningful.
    expect(res).toEqual({
      ok: false,
      error: null,
      duplicate: { match, folded: foldName('Ada') },
    });
    // A warning is not a write: nothing may be revalidated.
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('threads the acknowledgement to the DAL, re-derived from the PARSED name', async () => {
    const f = form({ profileId: PROFILE_ID, name: '  Ada  ' });
    f.set('acknowledgedDuplicate', foldName('Ada'));
    await renameAthleteAction(initial, f);
    expect(vi.mocked(renameAthlete).mock.calls[0]![2]).toMatchObject({
      acknowledgedDuplicate: foldName('Ada'),
    });
  });

  it('an OVERSIZE acknowledgement is a page-level refusal, and never reaches the DAL', async () => {
    const f = form({ profileId: PROFILE_ID, name: 'Ada' });
    f.set('acknowledgedDuplicate', 'x'.repeat(PROFILE_NAME_MAX * 20 + 1));
    expect(await renameAthleteAction(initial, f)).toEqual({ ok: false, error: NO_ATHLETE_SAVE });
    expect(renameAthlete).not.toHaveBeenCalled();
  });
});

describe('renameAthleteAction — the DAL refuses', () => {
  /**
   * `renameAthlete` answers `refused` when the UPDATE matched 0 rows — the id raced a soft delete
   * between the read and the write. The read passing and the write refusing is a real interleaving,
   * not a redundant branch, and it must answer with the same bytes as every other refusal.
   */
  it('maps a 0-row UPDATE to the same refusal, with no revalidation', async () => {
    vi.mocked(renameAthlete).mockResolvedValueOnce({ ok: false, reason: 'refused' });
    const res = await renameAthleteAction(initial, form({ profileId: PROFILE_ID, name: 'Ada' }));
    expect(res).toEqual({ ok: false, error: NO_ATHLETE_SAVE });
    // A refusal must not even confirm which path exists.
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('refuses when the profile does not resolve, before any write', async () => {
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce(null);
    const res = await renameAthleteAction(initial, form({ profileId: PROFILE_ID, name: 'Ada' }));
    expect(res).toEqual({ ok: false, error: NO_ATHLETE_SAVE });
    expect(renameAthlete).not.toHaveBeenCalled();
  });

  /**
   * The rate-limit refusal is the one with something to do about it, so it does NOT borrow
   * `NO_ATHLETE_SAVE` — that would lie to the parent and blur the 404-never-403 argument. The
   * registry matrix asserts the copy; this asserts that the DAL is untouched, which it cannot see.
   */
  it('a rate-limited call writes nothing', async () => {
    vi.mocked(checkMutationLimit).mockResolvedValueOnce({ allowed: false, reason: 'limited' });
    const res = await renameAthleteAction(initial, form({ profileId: PROFILE_ID, name: 'Ada' }));
    expect(res).toEqual({ ok: false, error: RATE_LIMITED });
    expect(getProfileByPublicId).not.toHaveBeenCalled();
    expect(renameAthlete).not.toHaveBeenCalled();
  });
});

/**
 * PROF-1 b — `archiveAthleteAction` / `restoreAthleteAction`, the per-action behaviour the registry
 * matrices cannot express.
 *
 * The matrices in `[profileId]/actions.test.ts` already cover unauth, rate-limit, wrong-household and
 * byte-identical-refusal for both. What is left, and what lives here:
 *
 * - the **`not_owner`** branch, which **no matrix row can construct**: it needs an id INSIDE the
 *   caller's own household, and every matrix row makes the id foreign;
 * - which three paths are revalidated;
 * - that Undo's replay is a success rather than an error;
 * - that the two actions answer a malformed id identically.
 */
describe('archiveAthleteAction / restoreAthleteAction (PROF-1 b)', () => {
  const idForm = (profileId: string) => {
    const f = new FormData();
    f.set('profileId', profileId);
    return f;
  };

  it('archives, and revalidates the picker, settings and the athlete’s day page', async () => {
    const res = await archiveAthleteAction(initial, idForm(PROFILE_ID));
    expect(res).toEqual({ ok: true, error: null, savedId: PROFILE_ID });
    // The three surfaces an archive changes: the tiles the athlete leaves, the settings list they
    // move within, and their own day page (the notice and the read-only gate).
    expect(vi.mocked(revalidatePath).mock.calls.map(([p]) => p)).toEqual([
      APP_HOME_PATH,
      SETTINGS_PATH,
      athletePath(PROFILE_ID),
    ]);
  });

  /**
   * 🔴 **The owner-only refusal, which only this tier can reach.** The UI renders no Archive control
   * for a member, so in production this answer requires a crafted POST — which is exactly why it must
   * be pinned rather than assumed, and why the DAL emits a signal when it fires.
   */
  it('a MEMBER gets the owner-only refusal, NOT the 404-shaped one', async () => {
    vi.mocked(archiveAthlete).mockResolvedValueOnce({ ok: false, reason: 'not_owner' });
    const res = await archiveAthleteAction(initial, idForm(PROFILE_ID));
    expect(res).toEqual({ ok: false, error: OWNER_ONLY_ATHLETE });
    // …and nothing was revalidated, because nothing changed.
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('a not_found from the DAL is the ordinary refusal, byte-identical to no-session', async () => {
    vi.mocked(archiveAthlete).mockResolvedValueOnce({ ok: false, reason: 'not_found' });
    expect(await archiveAthleteAction(initial, idForm(PROFILE_ID))).toEqual({
      ok: false,
      error: NO_ATHLETE_SAVE,
    });
  });

  it('restores — the same shape, and it is what Undo calls', async () => {
    const res = await restoreAthleteAction(initial, idForm(PROFILE_ID));
    expect(res).toEqual({ ok: true, error: null, savedId: PROFILE_ID });
  });

  /**
   * Undo may fire twice (a double tap, a replayed submit). The writer makes that a no-op rather than
   * an error — `db:verify` asserts it at the SQL level — so the action must not turn the second one
   * into a refusal the person has to interpret.
   */
  it('restoring twice calls the writer twice with the same id — no app-level short-circuit', async () => {
    // ⚠️ **The first version asserted `.ok` twice against an unconditional mock** — a review lens
    // called it vacuous and was right: it named idempotency and proved nothing the test above did
    // not. What matters at THIS tier is that the action does not try to be clever and swallow the
    // second call; idempotency itself is the writer's, proved by `db:verify` (`COALESCE`, and a
    // restore over a live row).
    vi.mocked(restoreAthlete).mockClear();
    await restoreAthleteAction(initial, idForm(PROFILE_ID));
    await restoreAthleteAction(initial, idForm(PROFILE_ID));
    expect(restoreAthlete).toHaveBeenCalledTimes(2);
    expect(vi.mocked(restoreAthlete).mock.calls).toEqual([[PROFILE_ID], [PROFILE_ID]]);
  });

  it.each([
    ['archive', archiveAthleteAction, archiveAthlete],
    ['restore', restoreAthleteAction, restoreAthlete],
  ])('%s refuses a malformed id WITHOUT touching the DAL', async (_label, action, write) => {
    const res = await action(initial, idForm('not-a-uuid'));
    // Not a field error: the id is a hidden field, so there is no input to mark invalid — and it must
    // answer exactly as an unknown id does, or a malformed id becomes an oracle.
    expect(res).toEqual({ ok: false, error: NO_ATHLETE_SAVE });
    expect(write).not.toHaveBeenCalled();
  });

  it('an unknown athlete refuses before the DAL writer is reached', async () => {
    vi.mocked(getProfileByPublicId).mockResolvedValueOnce(null);
    const res = await archiveAthleteAction(initial, idForm(PROFILE_ID));
    expect(res).toEqual({ ok: false, error: NO_ATHLETE_SAVE });
    expect(archiveAthlete).not.toHaveBeenCalled();
  });
});

/**
 * PROF-1 a-1w — `addAthleteAction`'s own behaviour, which the matrices cannot express.
 *
 * The household matrix in `[profileId]/actions.test.ts` covers unauth, rate-limit, the scope miss and
 * the byte-identical refusal. What is left is this action's two distinctive answers: the quota, which
 * is the one refusal that NAMES its cause, and a bad hidden field.
 */
describe('addAthleteAction (PROF-1 a-1w)', () => {
  /** The hidden field's value, named once: two assertions below thread it and must not re-type it. */
  const CLIENT_ID = '019826b4-0000-7000-8000-0000000000c1';
  const body = (over: Record<string, string> = {}) => {
    const f = new FormData();
    f.set('name', 'Added Athlete');
    f.set('kind', PROFILE_KIND.kid);
    f.set('clientId', CLIENT_ID);
    for (const [k, v] of Object.entries(over)) f.set(k, v);
    return f;
  };

  it('revalidates the picker and settings, then redirects to the new athlete', async () => {
    await expect(addAthleteAction(initial, body())).rejects.toThrow('NEXT_REDIRECT');
    // 🔴 **What the DAL was called WITH, not merely that the action redirected.** The mock answers
    // `ok` for any input, so without this an action that passed `formData.get('name')` raw instead
    // of `parsed.data.name`, swapped two fields, or dropped `clientId` — killing idempotency —
    // would redirect correctly and pass every other assertion in this PR.
    // ⚠️ `toMatchObject`, not `toHaveBeenCalledWith` (lessons.md → Vitest). The action now always
    // passes `acknowledgedDuplicate`, so exact equality would quietly treat `undefined` as absent
    // and stop distinguishing the two.
    expect(vi.mocked(createAthlete).mock.calls[0]![0]).toMatchObject({
      name: 'Added Athlete',
      kind: PROFILE_KIND.kid,
      clientId: CLIENT_ID,
    });
    expect(vi.mocked(revalidatePath).mock.calls.map(([p]) => p)).toEqual([
      APP_HOME_PATH,
      SETTINGS_PATH,
    ]);
    expect(redirect).toHaveBeenCalledWith(athletePath(PROFILE_ID), RedirectType.replace);
  });

  /**
   * 🔴 **The one refusal that names its cause.** `full` is reachable only AFTER the household scope
   * resolved, and it states a fact about the caller's own household that they can already see on the
   * picker — so "couldn't add this athlete" would send a parent retrying a request that can never
   * succeed.
   */
  it('a FULL household gets the quota message, not the generic refusal', async () => {
    vi.mocked(createAthlete).mockResolvedValueOnce({ ok: false, reason: 'full' });
    const res = await addAthleteAction(initial, body());
    expect(res).toEqual({ ok: false, error: HOUSEHOLD_FULL });
    expect(res.error).not.toBe(NO_ATHLETE_ADD);
    expect(redirect).not.toHaveBeenCalled();
  });

  /**
   * The PARSED value reaches the DAL, not the raw field. `athleteNameSchema` trims and collapses, so
   * a name typed with stray spaces must arrive normalised — otherwise two athletes differ only by
   * whitespace and a-1d's duplicate fold has nothing to fold.
   */
  it('passes the PARSED name, trimmed and collapsed, not the raw field', async () => {
    await expect(addAthleteAction(initial, body({ name: '  Added   Athlete  ' }))).rejects.toThrow(
      'NEXT_REDIRECT',
    );
    // The WHOLE object, not `objectContaining` (lessons.md → Vitest): a partial matcher would pass
    // while the action quietly threaded a wrong `kind` or a mangled `clientId` alongside the name.
    expect(createAthlete).toHaveBeenCalledWith({
      name: 'Added Athlete',
      kind: PROFILE_KIND.kid,
      clientId: CLIENT_ID,
    });
  });

  /**
   * PROF-1 a-1d — the duplicate branch.
   *
   * 🔴 **These exist because the `atCap` wiring had no test between the writer and the screen.**
   * `db:verify` proves `createProfile` returns the flag and a form test proves the UI hides "Add
   * another" when handed one — but nothing connected them, so flipping `atCap` to `false` in the
   * DAL or here left **every tier green** while the screen offered a button the endpoint refuses.
   */
  it('maps a duplicate to a typed envelope carrying the match, atCap and the fold', async () => {
    const match = {
      publicId: 'p-match',
      name: 'Added Athlete',
      kind: PROFILE_KIND.kid,
      archived: true,
    };
    vi.mocked(createAthlete).mockResolvedValueOnce({
      ok: false,
      reason: 'duplicate',
      match,
      atCap: true,
    } as Awaited<ReturnType<typeof createAthlete>>);

    const state = await addAthleteAction(initial, body());
    // Not a `fieldError`: the name is not invalid, and `aria-invalid` on a correct value is a lie.
    // 🔴 `toEqual`, not `toMatchObject`, on purpose: this pins the envelope's WHOLE shape, so a
    // field added to it has to be a deliberate act. It earned that when `typed`/`chosenKind` were
    // added for an unhydrated render and then removed again — see `docs/tech-debt.md`.
    expect(state).toEqual({
      ok: false,
      error: null,
      duplicate: { match, atCap: true, folded: foldName('Added Athlete') },
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it('threads the acknowledgement through to the DAL', async () => {
    const f = body();
    f.set('acknowledgedDuplicate', foldName('Added Athlete'));
    await expect(addAthleteAction(initial, f)).rejects.toThrow('NEXT_REDIRECT');
    expect(vi.mocked(createAthlete).mock.calls[0]![0]).toMatchObject({
      acknowledgedDuplicate: foldName('Added Athlete'),
    });
  });

  it('an OVERSIZE acknowledgement is a page-level refusal, and never reaches the DAL', async () => {
    // AGENTS.md makes "bad body → zod-reject" mandatory for every new field. NFKD can expand 40
    // characters into hundreds, so the field is bounded — and a crafted body must not be told which
    // hidden field it got wrong, so this answers with the generic refusal.
    const f = body();
    f.set('acknowledgedDuplicate', 'x'.repeat(PROFILE_NAME_MAX * 20 + 1));
    expect(await addAthleteAction(initial, f)).toEqual({ ok: false, error: NO_ATHLETE_ADD });
    expect(createAthlete).not.toHaveBeenCalled();
  });

  it('a spent client_id is the generic refusal — it says nothing about the other household', async () => {
    vi.mocked(createAthlete).mockResolvedValueOnce({ ok: false, reason: 'refused' });
    expect(await addAthleteAction(initial, body())).toEqual({ ok: false, error: NO_ATHLETE_ADD });
  });

  it.each([
    ['a blank name', { name: '   ' }, 'name'],
    ['a kind that is not one', { kind: 'grown-up' }, 'kind'],
  ])('%s is a FIELD error, and the DAL is never reached', async (_l, over, field) => {
    const res = await addAthleteAction(initial, body(over));
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.[field]?.length).toBeGreaterThan(0);
    expect(createAthlete).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ **A bad `clientId` is NOT a field error.** It is a hidden field the form mints itself, so
   * there is nothing for a parent to correct and `fieldErrors` would render an invalid-but-
   * unexplained form. It must also answer exactly as a spent key does.
   */
  it('a malformed clientId is the page-level refusal, never a field error', async () => {
    const res = await addAthleteAction(initial, body({ clientId: 'not-a-uuid' }));
    expect(res).toEqual({ ok: false, error: NO_ATHLETE_ADD });
    expect(res.fieldErrors).toBeUndefined();
    expect(createAthlete).not.toHaveBeenCalled();
  });

  /** The refusal copy must never print the stored value — a parent reads "Child", never `kid`. */
  it('the kind refusal is in the person’s words, not the column’s', async () => {
    const res = await addAthleteAction(initial, body({ kind: 'grown-up' }));
    const message = res.fieldErrors?.kind?.[0] ?? '';
    expect(message).toBe('Choose Child or Adult.');
    for (const stored of PROFILE_KINDS) expect(message).not.toContain(stored);
  });
});
