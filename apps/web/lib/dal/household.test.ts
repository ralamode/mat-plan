import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `getHouseholdScope()`'s states, pinned — TEN-1 1b's three, then `AUTH-1` 1c-4's five.
 *
 * ⚠️ **This docblock described the pre-AUTH-1 algorithm as current** (*"before AUTH-1 there is no
 * principal, so the scope is the one live household"*). Since 1c-4 the resolver reads the principal
 * and then that principal's membership, and never counts households. The reason these need tests
 * rather than comments is unchanged: **`null` and the throw are different states that must not share
 * a path**:
 *
 * - **no live membership** → `null` + `scope_outcome: no_membership`, and the no-household screen is
 *   the honest answer;
 * - **≥2 memberships for one principal** → **throws**, because the server cannot tell whose data it
 *   holds. Returning `null` here would render the empty state — reporting an invariant violation to a
 *   parent as *"your data does not exist"*, with a production write as the suggested remedy.
 *
 * And the third thing, which is the one a later author would break: **`rows[0]` must never be read
 * as a pick.** *"Just use the first one"* is exactly the edit someone makes to "fix" a dark app, and
 * it is a silent cross-wire between two families.
 */
const { state, recording, captureMessage } = await vi.hoisted(async () => {
  const { createRecordingDb } = await import('./recording-db');
  const state = {
    /** Rows the MEMBERSHIP probe answers — one per live membership for this principal. */
    memberships: [] as unknown[][],
    /** The principal. `null` is outcome B, which `getCurrentUser()` cannot produce under vitest. */
    principal: { userId: 'user_householdSuiteFixturePrincipal' } as { userId: string } | null,
    /** Set to make the probe throw, for the schema-missing branch. */
    probeThrows: null as unknown,
  };
  const recording = createRecordingDb((sql) => {
    if (!/from "household_members"/.test(sql)) return [];
    if (state.probeThrows) throw state.probeThrows;
    return state.memberships;
  });
  const { vi: v } = await import('vitest');
  return { state, recording, captureMessage: v.fn() };
});

vi.mock('./db', () => ({ db: recording.db }));
vi.mock('@sentry/nextjs', () => ({ captureMessage }));
// AUTH-1 1c-4: the resolver consults the principal first. `./session` is the seam rather than the
// three-mock Clerk stack — `getCurrentUser()`'s own contract is `session.test.ts`'s job.
vi.mock('./session', () => ({ getCurrentUser: async () => state.principal }));

import { getHouseholdScope, HOUSEHOLD_STATE, householdState } from './household';

/**
 * ⚠️ **A fresh principal per test, and that is load-bearing.** `household.ts` bounds its B′/C
 * captures to once per principal (an unbounded capture on a page read is a Sentry-quota drain any
 * admitted account can pull), and the `Set` behind that bound is module-level — so a shared fixture
 * id would make the SECOND test to reach B′ or C capture nothing, and every single-capture assertion
 * in this file would pass or fail by test ORDER. One test pins the bound deliberately, below.
 */
let principalSeq = 0;
const nextPrincipal = () => ({ userId: `user_householdSuiteFixturePrincipal${++principalSeq}` });

beforeEach(() => {
  state.memberships = [];
  state.principal = nextPrincipal();
  state.probeThrows = null;
  recording.queries.length = 0;
  captureMessage.mockClear();
});

/**
 * 🔴 **The five outcomes, one case each (`AUTH-1` 1c-4).** The resolver answers *whose* data this
 * request gets, so every branch is a boundary and none may be inferred from another.
 *
 * ⚠️ Three of these were previously written against the **households** probe, which the resolver no
 * longer emits. Had they been left, `cross_household` and `unknown_resource` below would have gone
 * red (visible) while `no_scope` went **green for the wrong reason** — the scope unresolvable
 * because the principal was missing rather than because of what the test names.
 */
describe('getHouseholdScope — the one place a household is derived from a request', () => {
  it('(A) exactly one live membership → that household’s scope', async () => {
    state.memberships = [[11]];
    await expect(getHouseholdScope()).resolves.toEqual({ householdId: 11 });
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('(B) no principal → null, SILENTLY, and without touching the database', async () => {
    // 1c-3b refuses a sessionless caller at all twelve entry points, so reaching here with no
    // principal is a path working as designed — a Sentry message would be noise. And the probe must
    // not run: an unauthenticated flood should cost zero database work.
    state.principal = null;
    await expect(getHouseholdScope()).resolves.toBeNull();
    expect(captureMessage).not.toHaveBeenCalled();
    expect(recording.queries).toHaveLength(0);
  });

  it('(B′) the membership table is missing → null, tagged, and NOT the error object', async () => {
    // drizzle wraps the driver error, so the code is on `.cause`. Fixed message and tag only: the
    // caught error's message embeds `params:`, and the param here IS the Clerk user id.
    // ⚠️ The REAL shape: pg throws an error carrying `.code`, and drizzle wraps it — so what the
    // resolver catches is a `DrizzleQueryError` whose `.cause` is this object. Writing
    // `{ cause: { code } }` here instead would sit one level too deep and the branch would never
    // fire, which is how a lenient implementation and a wrong test agree with each other.
    state.probeThrows = Object.assign(new Error('relation does not exist'), { code: '42P01' });
    await expect(getHouseholdScope()).resolves.toBeNull();
    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [message, options] = captureMessage.mock.calls[0];
    expect(message).toMatch(/schema missing/);
    expect(options).toMatchObject({ tags: { scope_outcome: 'schema_missing' } });
    const payload = JSON.stringify(options);
    expect(payload).not.toMatch(/params/);
    expect(payload).not.toContain('user_');
  });

  it('(B′) any OTHER database failure propagates — an outage is not "no household"', async () => {
    // A bare `catch { return null }` would tell the one family that does have data that nothing is
    // linked to their account, and send the operator looking for a membership problem.
    state.probeThrows = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
    // ⚠️ The message asserted is drizzle's wrapper ("Failed query: …"), not the driver's — which is
    // itself the point: what propagates is the real error, cause and all, rather than a `null` the
    // picker would render as "nothing is linked to this account".
    await expect(getHouseholdScope()).rejects.toThrow();
    const rejection = await getHouseholdScope().catch((e: unknown) => e);
    expect((rejection as { cause?: { code?: string } }).cause?.code).toBe('ECONNREFUSED');
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('(C) a principal with no membership → null, tagged `no_membership`, naming no ids', async () => {
    await expect(getHouseholdScope()).resolves.toBeNull();
    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [message, options] = captureMessage.mock.calls[0];
    expect(message).toMatch(/no live membership/);
    // 🔴 DISTINCT from `no_household`. Five causes share one screen because telemetry carries the
    // cause; one tag for both would make "the maintainer is locked out" and "wrong Google account"
    // the same dashboard row, and `runbooks.md`'s triage keys on this field.
    expect(options).toMatchObject({ tags: { scope_outcome: 'no_membership' } });
    const payload = JSON.stringify(options);
    expect(payload).not.toContain('user_');
    expect(payload).not.toMatch(/\d{4}/);
  });

  it('(D) two live memberships → THROWS (never "pick the first")', async () => {
    // ⚠️ Unreachable in production — `uq_household_members_clerk_user` is partial-unique on
    // `clerk_user_id` alone, proved by rejection in `db:verify`. So this case MOCKS the query; an
    // implementer trying to construct the row will not manage it.
    state.memberships = [[11], [22]];
    await expect(getHouseholdScope()).rejects.toThrow(/ambiguous/);
  });

  it('probes with LIMIT 2 and no ORDER BY — an ambiguity probe, not a pick', async () => {
    state.memberships = [[11]];
    await getHouseholdScope();
    const probe = recording.queries.find((q) => /from "household_members"/.test(q.text));
    expect(probe?.text).toMatch(/limit \$\d/i);
    expect(probe?.values).toContain(2);
    expect(probe?.text.toLowerCase()).not.toContain('order by');
    // BOTH conjuncts: a member of a soft-deleted household must not resolve a working scope. The
    // first version of the query lost the second one.
    expect(probe?.text).toContain('"household_members"."deleted_at" is null');
    expect(probe?.text).toContain('"households"."deleted_at" is null');
  });

  it('binds the PRINCIPAL, not something the caller supplied', async () => {
    state.memberships = [[11]];
    await getHouseholdScope();
    const probe = recording.queries.find((q) => /from "household_members"/.test(q.text));
    expect(probe?.values).toContain(state.principal?.userId);
  });

  it('(C) bounds its capture to ONCE per principal, and still reports the NEXT principal', async () => {
    // The bound is why `no_membership` is safe on an unlimited page read. Three calls, one event —
    // and then a different account still gets its own, which once-per-process would have swallowed.
    // That distinction is the whole argument for C having its own outcome.
    await getHouseholdScope();
    await getHouseholdScope();
    await getHouseholdScope();
    expect(captureMessage).toHaveBeenCalledTimes(1);

    state.principal = nextPrincipal();
    await getHouseholdScope();
    expect(captureMessage).toHaveBeenCalledTimes(2);
  });

  it("🔴 (B′) is ONCE PER PROCESS, so a flood of (C) cannot starve 'production is dark'", async () => {
    // B′ means `household_members` is absent — a deploy ahead of `0019`, dark for EVERYONE. It used
    // to share one never-evicted 100-slot budget with C, which is attacker-fillable on an
    // unlimited page read: 100 distinct no-membership principals silenced this alarm for the life of
    // the process. Two assertions, because both halves have to hold.
    const { createRecordingDb } = await import('./recording-db');
    const missing = Object.assign(new Error('relation does not exist'), { code: '42P01' });
    const rec = createRecordingDb(() => {
      throw missing;
    });
    vi.doMock('./db', () => ({ db: rec.db }));
    vi.resetModules();
    const mod = await import('./household');
    captureMessage.mockClear();

    // (1) Deployment-wide, so one event however many principals meet it.
    state.principal = nextPrincipal();
    await mod.getHouseholdScope();
    state.principal = nextPrincipal();
    await mod.getHouseholdScope();
    const schemaEvents = () =>
      captureMessage.mock.calls.filter(
        (c) =>
          (c[1] as { tags?: { scope_outcome?: string } })?.tags?.scope_outcome === 'schema_missing',
      );
    expect(schemaEvents()).toHaveLength(1);

    vi.doUnmock('./db');
    vi.resetModules();
  });
});

/**
 * ADR 0006 obligation 3 — the structured cross-household event on the miss path.
 *
 * The scoped predicate returns "no row" for both *"unknown id"* and *"exists elsewhere"*, so the
 * server cannot tell them apart — and the threat model's #1 risk becomes the one event that produces
 * no signal. These assert the three things that make the event useful rather than noise or a leak:
 * the outcome distinguishes `no_scope` from `cross_household`, the payload carries nothing but the
 * id the caller already sent, and the probe never turns a 404 into a 500.
 */
describe('reportScopeMiss — the miss-path event', () => {
  const FOREIGN = '019826b4-0000-7000-8000-0000000000aa';

  /** Fresh module graph per case: `getHouseholdScope` is `cache()`d and the probe reads the pool. */
  async function miss(memberships: unknown[][], profileExists: boolean) {
    const { createRecordingDb } = await import('./recording-db');
    // ⚠️ The resolver's probe is the MEMBERSHIP lookup since `AUTH-1` 1c-4. Keyed on the old
    // `from "households"` this answers nothing, every case resolves no scope, and `no_scope` goes
    // GREEN for the wrong reason — which would leave the only assertion standing between
    // `reportScopeMiss` and reporting every legitimate request as a cross-household probe.
    const rec = createRecordingDb((sql) =>
      /from "household_members"/.test(sql) ? memberships : profileExists ? [[FOREIGN]] : [],
    );
    vi.doMock('./db', () => ({ db: rec.db }));
    vi.resetModules();
    const mod = await import('./household');
    await mod.reportScopeMiss({
      action: mod.SCOPE_MISS_ACTION.resolveProfile,
      profilePublicId: FOREIGN,
    });
    vi.doUnmock('./db');
    vi.resetModules();
    return captureMessage.mock.calls.at(-1);
  }

  it('a resolvable scope + a row that exists elsewhere → cross_household', async () => {
    const call = await miss([[11]], true);
    expect(call?.[0]).toMatch(/cross_household/);
    expect(call?.[1]).toMatchObject({
      contexts: { scope_miss: { outcome: 'cross_household', resource: FOREIGN } },
    });
  });

  it('a resolvable scope + an id that exists nowhere → unknown_resource', async () => {
    const call = await miss([[11]], false);
    expect(call?.[1]).toMatchObject({ contexts: { scope_miss: { outcome: 'unknown_resource' } } });
  });

  it('NO resolvable scope → no_scope, never cross_household', async () => {
    // Without this value every legitimate request against an empty database would report a
    // cross-household probe: with no scope every lookup misses and the unscoped re-resolve FINDS
    // the row.
    const call = await miss([], true);
    expect(call?.[1]).toMatchObject({ contexts: { scope_miss: { outcome: 'no_scope' } } });
  });

  /** The captures carrying one `scope_outcome` tag. The tag is what the runbook triages on. */
  const tagged = (calls: unknown[][], outcome: string) =>
    calls.filter(
      (c) => (c[1] as { tags?: { scope_outcome?: string } })?.tags?.scope_outcome === outcome,
    );

  /** Two calls in ONE module graph, so the module-level bound is shared between them. */
  async function missTwice(memberships: unknown[][], profileExists: boolean) {
    const { createRecordingDb } = await import('./recording-db');
    const rec = createRecordingDb((sql) =>
      /from "household_members"/.test(sql) ? memberships : profileExists ? [[FOREIGN]] : [],
    );
    vi.doMock('./db', () => ({ db: rec.db }));
    vi.resetModules();
    const mod = await import('./household');
    const args = { action: mod.SCOPE_MISS_ACTION.resolveProfile, profilePublicId: FOREIGN };
    captureMessage.mockClear();
    await mod.reportScopeMiss(args);
    await mod.reportScopeMiss(args);
    vi.doUnmock('./db');
    vi.resetModules();
    return captureMessage.mock.calls;
  }

  it('🔴 no_scope is BOUNDED per principal — it is the one a no-membership account can loop', async () => {
    // Without this the bound on the resolver's own captures is half a bound: the same account
    // looping `GET /p/<id>` emits one `no_membership` and then one `no_scope` PER REQUEST, so the
    // stream survives under a different value — and what it buries is `cross_household`.
    // Count by TAG, and count each outcome separately: state C also emits the resolver's own
    // `no_membership` on the way past, which the same helper bounds — so a bare length assertion
    // would pass for the wrong reason. The tag rather than the message, because the resolver's
    // message reads "has no live membership" and only the tag carries the value an operator filters.
    const calls = await missTwice([], true);
    expect(tagged(calls, 'no_scope')).toHaveLength(1);
    expect(tagged(calls, 'no_membership')).toHaveLength(1);
  });

  it('🔴 cross_household is NOT bounded — capping the signal would defeat the event', async () => {
    // ADR 0006 obligation 3 exists to make this one noticeable, and `runbooks.md`'s alert rule is
    // "more than 3 events in 1 hour" — a bound here would make that rule unreachable.
    const calls = await missTwice([[11]], true);
    expect(tagged(calls, 'cross_household')).toHaveLength(2);
  });

  it('carries the id and NOTHING else — no name, no value, no owning household', async () => {
    const call = await miss([[11]], true);
    const ctx = (call?.[1] as { contexts: { scope_miss: Record<string, unknown> } }).contexts
      .scope_miss;
    expect(Object.keys(ctx).sort()).toEqual(['action', 'actor', 'outcome', 'resource']);
    // 🔴 The VALUE, not just the key. `actor` is a CONSTANT describing the KIND of principal, never
    // the user id — a requester→owner mapping in a third-party store is the same cross-tenant
    // linkage the owning household id is forbidden for below. It changed `gate_session` →
    // `clerk_session` at 1c-3b with nothing pinning either, and `runbooks.md`'s triage procedure
    // filters on it. The literal belongs here, once, on the assertion side.
    expect(ctx.actor).toBe('clerk_session');
    // SEC-3's scar: a `DrizzleQueryError` message embeds query params, and that has already shipped
    // a kid's bodyweight to Sentry once.
    expect(JSON.stringify(call?.[1])).not.toMatch(/params/);
  });

  it('swallows its own driver failure — a telemetry probe never turns a 404 into a 500', async () => {
    vi.doMock('./db', () => ({
      db: {
        select: () => {
          throw new Error('Failed query: select … \nparams: [84.5]');
        },
      },
    }));
    vi.resetModules();
    const mod = await import('./household');
    await expect(
      mod.reportScopeMiss({
        action: mod.SCOPE_MISS_ACTION.resolveProfile,
        profilePublicId: FOREIGN,
      }),
    ).resolves.toBeUndefined();
    vi.doUnmock('./db');
    vi.resetModules();
  });
});

/**
 * AUTH-1 1c-2 — the picker's discriminator. Three things, each of which a later author could break:
 *
 * - it **returns no scope**, which is the entire reason it exists rather than `p/page.tsx` calling
 *   `getHouseholdScope()` itself (`write-path.md` invariant 2 — a `HouseholdScope` must not reach
 *   `app/`). ⚠️ That half is **structural, not behavioural**, so it is not pinned here: asserting
 *   `typeof value === 'string'` only restates the return type. `packages/db/src/scope.test.ts`
 *   enforces it, by failing the build if any file under `app/` or `components/` names the resolver;
 * - it is **coarser than the resolver on purpose**, collapsing five causes into one honest screen;
 * - it does **NOT** collapse the ambiguous case: **≥2 live MEMBERSHIPS for one principal** still
 *   throws. Reporting "no household for this account" when the server cannot tell *whose* data it
 *   holds would tell a family their data is gone and send the operator looking in the wrong place.
 *
 * ⚠️ **These three titles named "live households" until 1c-4.** The bodies always set
 * `state.memberships`, so the assertions were right and only the labels were wrong — but a failure
 * here would then print the name of a state that cannot occur, which is how a reader learns the
 * wrong model from a red test.
 */
describe('householdState — "does this request resolve a household", without handing out the scope', () => {
  it('exactly one live membership → resolved', async () => {
    state.memberships = [[11]];
    await expect(householdState()).resolves.toBe(HOUSEHOLD_STATE.resolved);
  });

  it('no live membership → none', async () => {
    await expect(householdState()).resolves.toBe(HOUSEHOLD_STATE.none);
  });

  it('two live memberships for one principal → THROWS; it must not degrade to "none"', async () => {
    state.memberships = [[11], [22]];
    await expect(householdState()).rejects.toThrow(/ambiguous/);
  });
});
