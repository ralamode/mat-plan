import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * TEN-1 1b — `getHouseholdScope()`'s three states, pinned (the plan's acceptance 8).
 *
 * Before AUTH-1 there is no principal, so the scope is *"the one live household, and nothing if that
 * is ambiguous"*. The reason this needs a test rather than a comment is that **zero and ≥2 are
 * different states that must not share a path**:
 *
 * - **zero** → `null`, the app goes dark, and the picker's empty state is the honest answer;
 * - **≥2** → **throws**, because the server cannot tell whose data it holds. Returning `null` here
 *   would render *"No profiles found. Seed the database to get started."* — reporting an invariant
 *   violation to a parent as *"your data does not exist"*, with a production write as the suggested
 *   remedy.
 *
 * And the third thing, which is the one a later author would break: **`rows[0]` must never be read
 * as a pick.** *"Just use the first one"* is exactly the edit someone makes to "fix" a dark app, and
 * it is a silent cross-wire between two families.
 */
const { state, recording, captureMessage } = await vi.hoisted(async () => {
  const { createRecordingDb } = await import('./recording-db');
  const state = { households: [] as unknown[][] };
  const recording = createRecordingDb((sql) =>
    /from "households"/.test(sql) ? state.households : [],
  );
  const { vi: v } = await import('vitest');
  return { state, recording, captureMessage: v.fn() };
});

vi.mock('./db', () => ({ db: recording.db }));
vi.mock('@sentry/nextjs', () => ({ captureMessage }));

import { getHouseholdScope } from './household';

beforeEach(() => {
  state.households = [];
  recording.queries.length = 0;
  captureMessage.mockClear();
});

describe('getHouseholdScope — the one place a household is derived from a request', () => {
  it('exactly one live household → that household’s scope', async () => {
    state.households = [[11]];
    await expect(getHouseholdScope()).resolves.toEqual({ householdId: 11 });
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('zero live households → null, and a Sentry MESSAGE naming no ids', async () => {
    await expect(getHouseholdScope()).resolves.toBeNull();
    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [message, options] = captureMessage.mock.calls[0];
    expect(message).toMatch(/no live household/);
    // A household COUNT is not personal data; an id or a name would be.
    expect(JSON.stringify(options)).not.toMatch(/\d{4}/);
  });

  it('two live households → THROWS (never "pick the first")', async () => {
    state.households = [[11], [22]];
    await expect(getHouseholdScope()).rejects.toThrow(/ambiguous/);
  });

  it('probes with LIMIT 2 and no ORDER BY — an ambiguity probe, not a pick', async () => {
    state.households = [[11]];
    await getHouseholdScope();
    const probe = recording.queries.find((q) => /from "households"/.test(q.text));
    expect(probe?.text).toMatch(/limit \$\d/i);
    expect(probe?.values).toContain(2);
    expect(probe?.text.toLowerCase()).not.toContain('order by');
    expect(probe?.text).toContain('"households"."deleted_at" is null');
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
  async function miss(households: unknown[][], profileExists: boolean) {
    const { createRecordingDb } = await import('./recording-db');
    const rec = createRecordingDb((sql) =>
      /from "households"/.test(sql) ? households : profileExists ? [[FOREIGN]] : [],
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

  it('carries the id and NOTHING else — no name, no value, no owning household', async () => {
    const call = await miss([[11]], true);
    const ctx = (call?.[1] as { contexts: { scope_miss: Record<string, unknown> } }).contexts
      .scope_miss;
    expect(Object.keys(ctx).sort()).toEqual(['action', 'actor', 'outcome', 'resource']);
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
