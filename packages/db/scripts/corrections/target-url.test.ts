import {
  E2E_SESSION_BYPASS_USER,
  newId,
  SEED_HOUSEHOLD_PUBLIC_ID,
  SEED_PROFILE_PUBLIC_ID,
} from '@mat-plan/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  correctionTargetIsLocal,
  correctionTargetIsPreview,
  correctionTargetUrl,
  fixtureBindIsAllowed,
  seedHouseholdClaimIsAllowed,
} from './target-url';

/**
 * `AUTH-1` 1c-4a — the guard that keeps the committed e2e fixture principal off any database but a
 * local one.
 *
 * 🔴 **This file is also the proof that `packages/*&#47;scripts` is covered at all.** The vitest
 * `include` in `apps/web/vitest.config.ts` was `packages/*&#47;src/**` until this chunk, so a test
 * written here ran **nowhere** — it would have shipped green without executing, which is the exact
 * failure its own neighbouring comment describes for `packages/**`. The glob was widened in the same
 * commit; if this suite ever stops appearing in the run, that is the regression, not a passing test.
 */
const ENV_KEYS = ['DATABASE_URL', 'DATABASE_URL_UNPOOLED'] as const;

const LOCAL = 'postgres://u:p@localhost:5432/mat_plan';
const PROD = 'postgres://u:p@ep-nameless-hall-123456.us-east-1.aws.neon.tech/mat_plan';
const PREVIEW = 'postgres://u:p@ep-nameless-hall-654321.us-east-1.aws.neon.tech/mat_plan_preview';

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('correctionTargetUrl — the one expression both the runner and the guard read', () => {
  it('prefers the UNPOOLED string, because that is what the runner connects with', () => {
    process.env.DATABASE_URL = LOCAL;
    process.env.DATABASE_URL_UNPOOLED = PROD;
    expect(correctionTargetUrl()).toBe(PROD);
  });

  it('falls back to DATABASE_URL when there is no unpooled string', () => {
    process.env.DATABASE_URL = LOCAL;
    expect(correctionTargetUrl()).toBe(LOCAL);
  });

  it('is undefined when neither is set, so a caller must decide what that means', () => {
    expect(correctionTargetUrl()).toBeUndefined();
  });
});

describe('fixtureBindIsAllowed — the fixture principal, and only it, is pinned to a local database', () => {
  it('🔴 REFUSES the fixture id when a production unpooled string sits beside a local DATABASE_URL', () => {
    // The whole reason this guard reads the unpooled variable first. This is not a contrived
    // environment: `runbooks.md`'s claim-correction procedure puts a production unpooled string on
    // the command line, and `pnpm dev` leaves a local `DATABASE_URL` behind. A guard reading
    // `DATABASE_URL` would see localhost, pass, and watch the write land on Neon.
    process.env.DATABASE_URL = LOCAL;
    process.env.DATABASE_URL_UNPOOLED = PROD;
    expect(fixtureBindIsAllowed(E2E_SESSION_BYPASS_USER)).toBe(false);
  });

  it('refuses the fixture id against a plain production string', () => {
    process.env.DATABASE_URL = PROD;
    expect(fixtureBindIsAllowed(E2E_SESSION_BYPASS_USER)).toBe(false);
  });

  it('refuses the fixture id when no target is set at all — unknown is not local', () => {
    expect(fixtureBindIsAllowed(E2E_SESSION_BYPASS_USER)).toBe(false);
  });

  it('allows the fixture id against the local harness database', () => {
    process.env.DATABASE_URL = LOCAL;
    process.env.DATABASE_URL_UNPOOLED = LOCAL;
    expect(fixtureBindIsAllowed(E2E_SESSION_BYPASS_USER)).toBe(true);
  });

  it('does NOT constrain a real Clerk id — the production claim is unaffected', () => {
    // The guard is narrow by design. Widening it to "no correction may touch production" would
    // break the one job this correction exists for.
    process.env.DATABASE_URL_UNPOOLED = PROD;
    expect(fixtureBindIsAllowed('user_3LNIsomethingRealFromTheDashboard')).toBe(true);
  });

  it('is not fooled by a percent-encoded host override — it rides the hardened predicate', () => {
    // `isLocalDbHost` decodes before checking `host`/`hostaddr`; `?%68ost=` was a real evasion found
    // and fixed in 1c-3a. Pinned here so a future "simplification" of that predicate fails loudly
    // from this side too.
    process.env.DATABASE_URL_UNPOOLED = `${LOCAL}?%68ost=evil.example.com`;
    expect(fixtureBindIsAllowed(E2E_SESSION_BYPASS_USER)).toBe(false);
  });
});

describe("correctionTargetIsLocal / correctionTargetIsPreview — read from the runner's own target", () => {
  it('a production unpooled string beside a local DATABASE_URL is neither local nor the preview', () => {
    process.env.DATABASE_URL = LOCAL;
    process.env.DATABASE_URL_UNPOOLED = PROD;
    expect(correctionTargetIsLocal()).toBe(false);
    expect(correctionTargetIsPreview()).toBe(false);
  });

  it('a local target is local and not the preview', () => {
    process.env.DATABASE_URL = LOCAL;
    expect(correctionTargetIsLocal()).toBe(true);
    expect(correctionTargetIsPreview()).toBe(false);
  });

  it('the preview database is recognised by name, and is not local', () => {
    process.env.DATABASE_URL_UNPOOLED = PREVIEW;
    expect(correctionTargetIsPreview()).toBe(true);
    expect(correctionTargetIsLocal()).toBe(false);
  });

  it('no target at all is neither — unknown is the riskier case for every caller', () => {
    expect(correctionTargetIsLocal()).toBe(false);
    expect(correctionTargetIsPreview()).toBe(false);
  });
});

describe("seedHouseholdClaimIsAllowed — a seed household only where the seed's fixtures may live (PRIV-3 RC, D6)", () => {
  it('🔴 refuses the seeded household on a production target, even with a local DATABASE_URL beside it', () => {
    process.env.DATABASE_URL = LOCAL;
    process.env.DATABASE_URL_UNPOOLED = PROD;
    expect(seedHouseholdClaimIsAllowed(SEED_HOUSEHOLD_PUBLIC_ID)).toBe(false);
  });

  it('refuses the seeded household when no target is set', () => {
    expect(seedHouseholdClaimIsAllowed(SEED_HOUSEHOLD_PUBLIC_ID)).toBe(false);
  });

  it('refuses any member of SEED_PUBLIC_IDS, not only the household id', () => {
    process.env.DATABASE_URL_UNPOOLED = PROD;
    expect(seedHouseholdClaimIsAllowed(SEED_PROFILE_PUBLIC_ID)).toBe(false);
  });

  it.each([
    ['upper case', SEED_HOUSEHOLD_PUBLIC_ID.toUpperCase()],
    ['braces', `{${SEED_HOUSEHOLD_PUBLIC_ID}}`],
    ['no hyphens', SEED_HOUSEHOLD_PUBLIC_ID.replace(/-/g, '')],
  ])(
    'refuses the seeded household spelt with %s — Postgres reads it as the same uuid',
    (_l, id) => {
      process.env.DATABASE_URL_UNPOOLED = PROD;
      expect(seedHouseholdClaimIsAllowed(id)).toBe(false);
    },
  );

  it("allows the seeded household on a local target (the e2e harness, a developer's claim)", () => {
    process.env.DATABASE_URL = LOCAL;
    process.env.DATABASE_URL_UNPOOLED = LOCAL;
    expect(seedHouseholdClaimIsAllowed(SEED_HOUSEHOLD_PUBLIC_ID)).toBe(true);
  });

  it('allows the seeded household on the preview database (the only way a preview gets a member)', () => {
    process.env.DATABASE_URL_UNPOOLED = PREVIEW;
    expect(seedHouseholdClaimIsAllowed(SEED_HOUSEHOLD_PUBLIC_ID)).toBe(true);
  });

  it('does not constrain an ordinary household id on production', () => {
    process.env.DATABASE_URL_UNPOOLED = PROD;
    expect(seedHouseholdClaimIsAllowed(newId())).toBe(true);
  });
});
