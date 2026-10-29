import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AUTH-1 1c-3a — **when may the test session bypass arm?**
 *
 * `lib/env.ts` owns that decision, and this file is the reason it is safe to put an authentication
 * bypass in production code at all. `lib/dal/session.ts` deliberately re-checks nothing, so every
 * guarantee the app has about this lives here.
 *
 * 🔴 **The first draft of this plan gated on `process.env.VERCEL` and was DEFAULT-OPEN.** `VERCEL`
 * and `VERCEL_ENV` are Vercel *system* variables, gated on the project's "Enable access to System
 * Environment Variables" toggle — `packages/shared/src/db-environment.ts` records this, and OPS-1
 * re-keyed its own guard off database **locality** for exactly that reason. With the toggle off, a
 * `VERCEL`-keyed rule silently no-ops: here that would mean a synthetic principal returned to every
 * unauthenticated request on a live Production deployment. The locality case below is the one that
 * would have caught it, which is why it is first.
 *
 * ⚠️ Each case re-imports the module, because the refusal is at **module scope**: a request-time
 * throw would let a mis-wired deployment build green, promote, and be discovered by whoever happened
 * to hit a gated route rather than by the deploy that caused it.
 */

const FIXTURE = 'user_000000000000000000000000e2e';
const LOCAL_DB = 'postgres://mat:mat@127.0.0.1:5432/mat_plan_test';
/** Shaped like the real thing — a Neon host, which `isLocalDbHost` must reject. */
const REMOTE_DB = 'postgres://u:p@ep-example-123.us-east-2.aws.neon.tech/neondb';

/** Fresh module graph per case: the guard runs once, at import. */
async function importEnv() {
  vi.resetModules();
  return import('./env');
}

describe('the test session bypass arms only in a local throwaway harness (AUTH-1 1c-3a)', () => {
  beforeEach(() => {
    vi.stubEnv('E2E_SESSION_BYPASS_USER_ID', '');
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('DATABASE_URL', LOCAL_DB);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('local database, no Vercel markers → arms, and hands back that principal', async () => {
    vi.stubEnv('E2E_SESSION_BYPASS_USER_ID', FIXTURE);
    const { sessionBypassUserId } = await importEnv();
    expect(sessionBypassUserId()).toBe(FIXTURE);
  });

  it('a REMOTE database refuses at import — OPS-1 gets there first', async () => {
    // Worth knowing which guard fires: `assertDatabaseEnvironment` already refuses a remote host
    // with no `ALLOW_LIVE_DB`, so the bypass never gets a say. Defence in depth, and the message
    // names the database rather than the bypass. The case below is the one this guard uniquely owns.
    vi.stubEnv('E2E_SESSION_BYPASS_USER_ID', FIXTURE);
    vi.stubEnv('DATABASE_URL', REMOTE_DB);
    await expect(importEnv()).rejects.toThrow(/refusing to conn/i);
  });

  it('🔴 ALLOW_LIVE_DB + a remote database → THIS guard refuses, where OPS-1 deliberately allows', async () => {
    // The hole this guard uniquely closes, and it is a real path rather than a hypothetical:
    // `pnpm dev:prod` exists to point a local process at live Neon on purpose, so OPS-1 lets
    // `ALLOW_LIVE_DB=1` through by design. A bypass keyed only on "not Vercel" would arm there and
    // hand a synthetic principal real household data on a developer's laptop.
    vi.stubEnv('E2E_SESSION_BYPASS_USER_ID', FIXTURE);
    vi.stubEnv('DATABASE_URL', REMOTE_DB);
    vi.stubEnv('ALLOW_LIVE_DB', '1');
    await expect(importEnv()).rejects.toThrow(/authentication bypass/i);
  });

  it('refuses at import on a Vercel deployment (the second belt)', async () => {
    vi.stubEnv('E2E_SESSION_BYPASS_USER_ID', FIXTURE);
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('DATABASE_URL', REMOTE_DB);
    await expect(importEnv()).rejects.toThrow(/authentication bypass/i);
  });

  it('unset → the module imports cleanly and the predicate answers null', async () => {
    // Production's permanent state. The guard must be invisible when the variable is absent, or it
    // would be a boot risk of its own.
    const { sessionBypassUserId } = await importEnv();
    expect(sessionBypassUserId()).toBeNull();
  });

  it('unset → a REMOTE database still imports cleanly', async () => {
    // Production exactly: Neon, on Vercel, no bypass variable. The guard must not fire here, and
    // this is the case that would break every deployment if the condition were ever inverted.
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('DATABASE_URL', REMOTE_DB);
    const { sessionBypassUserId } = await importEnv();
    expect(sessionBypassUserId()).toBeNull();
  });
});
