import { MAX_HOUSEHOLD_ATHLETES } from '@mat-plan/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

// V1-14a. `lib/rate-limit.ts` builds its limiter at MODULE LOAD from `env`, so each case here has to
// re-import the module with a different env/mock — hence `vi.resetModules()` + dynamic import rather
// than a top-level import. The behaviour under test is the fail-open contract, which is the whole
// safety property: this module must never be able to lock the household out of their own log.

const UPSTASH_ENV = {
  UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'token',
};

/** Load `rate-limit.ts` fresh with a given env and a given `Ratelimit.limit` behaviour. */
/** What each `new Ratelimit(...)` was constructed with — the only thing that pins the consts to the
 *  instances. Reset by `loadWith`. */
const built: { attempts: number; window: string; prefix: string }[] = [];

async function loadWith(opts: {
  env: Record<string, string | undefined>;
  // AUTH-1 1c-1 widened this: the mutation tests assert the IDENTIFIER each limiter is called with,
  // which is how "the two policies are separate instances" is proved behaviourally rather than read.
  limit?: (identifier: string) => Promise<{ success: boolean }>;
}) {
  vi.resetModules();
  vi.doMock('./env', () => ({ env: opts.env }));
  vi.doMock('@upstash/redis', () => ({ Redis: class {} }));
  // 🔴 STATEFUL and POLICY-AWARE, and it has to be. The first version of this mock discarded the
  // policy (`static slidingWindow = () => ({})`) and was a pure function of the identifier — so a
  // regression that built BOTH limiters from one shared policy passed every test in this file. A
  // probe confirmed it: shipped and bugged implementations produced identical results.
  built.length = 0;
  vi.doMock('@upstash/ratelimit', () => ({
    Ratelimit: class {
      static slidingWindow = (attempts: number, window: string) => ({ attempts, window });
      cfg: { limiter: { attempts: number; window: string }; prefix: string };
      used = 0;
      constructor(cfg: { limiter: { attempts: number; window: string }; prefix: string }) {
        this.cfg = cfg;
        built.push({ ...cfg.limiter, prefix: cfg.prefix });
      }
      limit = async (identifier: string) =>
        opts.limit ? opts.limit(identifier) : { success: ++this.used <= this.cfg.limiter.attempts };
    },
  }));
  return import('./rate-limit');
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('./env');
});

/**
 * ⚠️ **These three suites changed SUBJECT at AUTH-1 1d, not shape.** They exercised `checkRateLimit`,
 * the gate's IP-keyed checker, which `1d` deletes along with the gate. The fail-open contract they
 * prove is the safety property of this whole module — it must never lock a household out of their own
 * log — so they are repointed at the surviving checker rather than deleted with their old subject.
 */
describe('checkMutationLimit — unconfigured is a first-class state, not a degraded one', () => {
  it('allows when Upstash env is absent (local dev, CI, un-wired previews)', async () => {
    const { checkMutationLimit, isRateLimitConfigured } = await loadWith({ env: {} });
    expect(isRateLimitConfigured).toBe(false);
    await expect(checkMutationLimit('user_abc')).resolves.toEqual({
      allowed: true,
      reason: 'unconfigured',
    });
  });

  it('allows when only ONE of the two vars is set (a half-configured env must not half-work)', async () => {
    const { checkMutationLimit } = await loadWith({
      env: { UPSTASH_REDIS_REST_URL: UPSTASH_ENV.UPSTASH_REDIS_REST_URL },
    });
    await expect(checkMutationLimit('user_abc')).resolves.toEqual({
      allowed: true,
      reason: 'unconfigured',
    });
  });
});

describe('checkMutationLimit — configured', () => {
  it('allows while under the limit', async () => {
    const { checkMutationLimit, isRateLimitConfigured } = await loadWith({
      env: UPSTASH_ENV,
      limit: async () => ({ success: true }),
    });
    expect(isRateLimitConfigured).toBe(true);
    await expect(checkMutationLimit('user_abc')).resolves.toEqual({ allowed: true, reason: 'ok' });
  });

  it('BLOCKS past the limit — the one case that must actually deny', async () => {
    const { checkMutationLimit } = await loadWith({
      env: UPSTASH_ENV,
      limit: async () => ({ success: false }),
    });
    await expect(checkMutationLimit('user_abc')).resolves.toEqual({
      allowed: false,
      reason: 'limited',
    });
  });
});

describe('checkMutationLimit — fails OPEN, and says so', () => {
  it('allows when the limiter throws (a Redis outage must not lock Ray out of his own app)', async () => {
    const { checkMutationLimit } = await loadWith({
      env: UPSTASH_ENV,
      limit: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    await expect(checkMutationLimit('user_abc')).resolves.toEqual({
      allowed: true,
      reason: 'limiter-error',
    });
  });

  it('distinguishes "allowed, healthy" from "allowed, broken" so a dead limiter is not silent', async () => {
    const healthy = await loadWith({ env: UPSTASH_ENV, limit: async () => ({ success: true }) });
    const broken = await loadWith({
      env: UPSTASH_ENV,
      limit: async () => {
        throw new Error('boom');
      },
    });
    // Both ALLOW — but the caller can tell them apart and leave a breadcrumb for the broken one.
    const a = await healthy.checkMutationLimit('user_x');
    const b = await broken.checkMutationLimit('user_x');
    expect(a.allowed).toBe(b.allowed);
    expect(a.reason).not.toBe(b.reason);
  });
});

describe('MUTATION_RATE_LIMIT — sized for a kid logging, not for a brute-forcer (AUTH-1 1c-1)', () => {
  it('is sized in ABSOLUTE terms — it limits work, not guesses', async () => {
    const { MUTATION_RATE_LIMIT } = await loadWith({ env: {} });
    // ⚠️ **Was `toBeGreaterThan(GATE_RATE_LIMIT.attempts)` until `1d`.** That comparand is deleted,
    // and a relative bound was always the weaker assertion: it would have been satisfied by 11.
    // A strength session is one action per movement plus amendments, so a real session is plausibly
    // 20-40 mutations in a few minutes, and the failure mode that matters is too TIGHT — an athlete
    // who cannot log mid-session.
    expect(MUTATION_RATE_LIMIT.attempts).toBeGreaterThanOrEqual(60);
    // …while still bounding a runaway client rather than letting it write without limit.
    expect(MUTATION_RATE_LIMIT.attempts).toBeLessThanOrEqual(500);
    expect(MUTATION_RATE_LIMIT.window).toMatch(/^\d+\s*[smhd]$/);
  });

  it('🔴 is ENFORCED at its OWN number, not merely declared', async () => {
    // The defect this guards: `slidingWindow()` bakes the window in at construction and the checker
    // takes no policy argument, so a limiter built from the wrong const would silently apply the
    // wrong budget while the sizing test above asserted the right number and passed.
    //
    // ⚠️ **Before `1d` this was "exhaust one and not the other"** — it drained the gate limiter and
    // showed the mutation limiter untouched, which proved they were separate INSTANCES. With one
    // limiter left there is no "other", so the claim narrows to what is still observable: the
    // surviving limiter refuses at exactly its own declared number. The mock counts calls against
    // the policy it was BUILT with, so a limiter built from a different const goes red here.
    const { checkMutationLimit, MUTATION_RATE_LIMIT } = await loadWith({
      env: { UPSTASH_REDIS_REST_URL: 'https://x', UPSTASH_REDIS_REST_TOKEN: 't' },
    });

    for (let n = 0; n < MUTATION_RATE_LIMIT.attempts; n += 1) {
      expect((await checkMutationLimit('user_abc')).allowed).toBe(true);
    }
    expect((await checkMutationLimit('user_abc')).allowed).toBe(false);
  });

  it('🔴 pins the CONST to the INSTANCE, and the KEYSPACE with it', async () => {
    // Without this, building the limiter from any other policy object is undetectable: no other test
    // observes the constructor config, and `isRateLimitConfigured` is true in every such world.
    // 🔴 **The `prefix` is asserted, not incidental.** It is the limiter's keyspace, and `1d` deleted
    // the sibling that owned `'mat-plan'` — so an edit that drops the `:mutate` suffix would silently
    // move every mutation counter into a namespace a future policy may claim.
    // ⚠️ `toEqual` on the whole array, so an EXTRA `new Ratelimit(...)` is a failure too: this is the
    // assertion that notices a limiter nobody meant to build.
    // 🔴 **Edited at FAM-1 step 0b, which is this assertion doing its job.** It held one entry from
    // `1d`; the row-write limiter is the second, meant, and named here with its own const and its
    // own prefix. A third instance, or either one built from the other's policy, is still red.
    // The export limiter (FAM-1 export follow-up) is the third, meant, with its own sibling prefix.
    const { EXPORT_RATE_LIMIT, MUTATION_RATE_LIMIT, ROW_WRITE_RATE_LIMIT } = await loadWith({
      env: { UPSTASH_REDIS_REST_URL: 'https://x', UPSTASH_REDIS_REST_TOKEN: 't' },
    });
    expect(built).toEqual([
      { ...MUTATION_RATE_LIMIT, prefix: 'mat-plan:mutate' },
      { ...ROW_WRITE_RATE_LIMIT, prefix: 'mat-plan:row-write' },
      { ...EXPORT_RATE_LIMIT, prefix: 'mat-plan:export' },
    ]);
  });

  it('owns its key shape, so no call site builds an identifier by hand', async () => {
    const seen: string[] = [];
    const { checkMutationLimit } = await loadWith({
      env: { UPSTASH_REDIS_REST_URL: 'https://x', UPSTASH_REDIS_REST_TOKEN: 't' },
      limit: async (id: string) => {
        seen.push(id);
        return { success: true };
      },
    });
    await checkMutationLimit('user_abc');
    // The `mutate:` lives in the PREFIX (`mat-plan:mutate`), so the identifier must NOT repeat it —
    // Upstash joins `[prefix, identifier]`, and the first draft produced `mat-plan:mutate:mutate:…`.
    expect(seen).toEqual(['user_abc']);
  });

  it('fails OPEN when the limiter is unconfigured or throws — a kid must not be blocked', async () => {
    const off = await loadWith({ env: {} });
    expect(await off.checkMutationLimit('user_abc')).toEqual({
      allowed: true,
      reason: 'unconfigured',
    });

    const broken = await loadWith({
      env: { UPSTASH_REDIS_REST_URL: 'https://x', UPSTASH_REDIS_REST_TOKEN: 't' },
      limit: async () => {
        throw new Error('redis is down');
      },
    });
    expect(await broken.checkMutationLimit('user_abc')).toEqual({
      allowed: true,
      reason: 'limiter-error',
    });
  });
});

/**
 * FAM-1 step 0b (D23): the second policy. On the day page a ✓ is one write, so a parent logging two
 * athletes' days is about 100 writes in a few minutes, and the default 120 would refuse them
 * mid-logging. Row writes therefore count against their own budget.
 *
 * ⚠️ **No action passes this policy yet** (the first is step 12b), so these cases are the only thing
 * that exercises the second limiter at all. They restore the shape `1d` had to narrow when it left
 * one limiter: "drain one and the other is untouched" is what proves two INSTANCES rather than two
 * consts over one instance.
 */
describe('ROW_WRITE_RATE_LIMIT — row writes have their own budget (FAM-1 D23)', () => {
  const CONFIGURED = { UPSTASH_REDIS_REST_URL: 'https://x', UPSTASH_REDIS_REST_TOKEN: 't' };

  it('is the plan’s number, over the same window as the default, and looser than it', async () => {
    const { MUTATION_RATE_LIMIT, ROW_WRITE_RATE_LIMIT } = await loadWith({ env: {} });
    // The contract pin: the literal belongs on the assertion side exactly once (AGENTS.md).
    expect(ROW_WRITE_RATE_LIMIT).toEqual({ attempts: 600, window: '5 m' });
    expect(ROW_WRITE_RATE_LIMIT.window).toBe(MUTATION_RATE_LIMIT.window);
    expect(ROW_WRITE_RATE_LIMIT.attempts).toBeGreaterThan(MUTATION_RATE_LIMIT.attempts);
  });

  it('🔴 a caller passing the row policy is limited at ITS number, not the default’s', async () => {
    const { checkMutationLimit, MUTATION_RATE_LIMIT, ROW_WRITE_RATE_LIMIT } = await loadWith({
      env: CONFIGURED,
    });

    // Past the default's limit and still allowed: this is the request the default would refuse.
    for (let n = 0; n < MUTATION_RATE_LIMIT.attempts + 1; n += 1) {
      expect((await checkMutationLimit('user_abc', ROW_WRITE_RATE_LIMIT)).allowed).toBe(true);
    }
    // …and refused at exactly its own number, so it is a limit and not an exemption.
    for (let n = MUTATION_RATE_LIMIT.attempts + 1; n < ROW_WRITE_RATE_LIMIT.attempts; n += 1) {
      expect((await checkMutationLimit('user_abc', ROW_WRITE_RATE_LIMIT)).allowed).toBe(true);
    }
    expect(await checkMutationLimit('user_abc', ROW_WRITE_RATE_LIMIT)).toEqual({
      allowed: false,
      reason: 'limited',
    });
  });

  it('🔴 the two budgets are separate: draining either leaves the other untouched', async () => {
    const { checkMutationLimit, MUTATION_RATE_LIMIT, ROW_WRITE_RATE_LIMIT } = await loadWith({
      env: CONFIGURED,
    });

    for (let n = 0; n < ROW_WRITE_RATE_LIMIT.attempts; n += 1) {
      await checkMutationLimit('user_abc', ROW_WRITE_RATE_LIMIT);
    }
    expect((await checkMutationLimit('user_abc', ROW_WRITE_RATE_LIMIT)).allowed).toBe(false);
    // A drained row budget has spent nothing of the default one: all 120 are still there…
    for (let n = 0; n < MUTATION_RATE_LIMIT.attempts; n += 1) {
      expect((await checkMutationLimit('user_abc')).allowed).toBe(true);
    }
    // …and the default still refuses at its own number, with the row budget already exhausted.
    expect((await checkMutationLimit('user_abc')).allowed).toBe(false);
  });

  it('the default is what a call without a policy gets, and what the default const names', async () => {
    const seen: string[] = [];
    const { checkMutationLimit, MUTATION_RATE_LIMIT } = await loadWith({ env: CONFIGURED });
    // Both forms drain the SAME budget: 60 of one and 60 of the other reach the default's limit.
    for (let n = 0; n < MUTATION_RATE_LIMIT.attempts / 2; n += 1) {
      seen.push((await checkMutationLimit('user_abc')).reason);
      seen.push((await checkMutationLimit('user_abc', MUTATION_RATE_LIMIT)).reason);
    }
    expect(new Set(seen)).toEqual(new Set(['ok']));
    expect((await checkMutationLimit('user_abc')).allowed).toBe(false);
  });

  it('🔴 a look-alike policy object buys nothing: it is counted against the default', async () => {
    // Selection is by identity. An object with the row policy's numbers that is not the exported
    // const (built at a call site, pushed past the type) falls to the tighter limiter.
    const { checkMutationLimit, MUTATION_RATE_LIMIT, ROW_WRITE_RATE_LIMIT } = await loadWith({
      env: CONFIGURED,
    });
    const lookAlike = { ...ROW_WRITE_RATE_LIMIT };
    for (let n = 0; n < MUTATION_RATE_LIMIT.attempts; n += 1) {
      expect((await checkMutationLimit('user_abc', lookAlike)).allowed).toBe(true);
    }
    expect((await checkMutationLimit('user_abc', lookAlike)).allowed).toBe(false);
  });

  it('keys the row limiter on the bare user id too, in its own keyspace', async () => {
    const seen: string[] = [];
    const { checkMutationLimit, ROW_WRITE_RATE_LIMIT } = await loadWith({
      env: CONFIGURED,
      limit: async (id: string) => {
        seen.push(id);
        return { success: true };
      },
    });
    await checkMutationLimit('user_abc', ROW_WRITE_RATE_LIMIT);
    // The keyspace is the instance's prefix (pinned above as `mat-plan:row-write`); the identifier
    // is the principal and nothing else, exactly as for the default.
    expect(seen).toEqual(['user_abc']);
  });

  it('fails OPEN like the default: unconfigured, or a limiter that throws', async () => {
    const off = await loadWith({ env: {} });
    expect(await off.checkMutationLimit('user_abc', off.ROW_WRITE_RATE_LIMIT)).toEqual({
      allowed: true,
      reason: 'unconfigured',
    });

    const broken = await loadWith({
      env: CONFIGURED,
      limit: async () => {
        throw new Error('redis is down');
      },
    });
    expect(await broken.checkMutationLimit('user_abc', broken.ROW_WRITE_RATE_LIMIT)).toEqual({
      allowed: true,
      reason: 'limiter-error',
    });
  });

  /**
   * The same claim one layer up, through the real `enterMutation` and the real limiter module (only
   * Upstash, the env and the session are replaced). `app/p/mutation-entry.test.ts` mocks the check,
   * so it can show the policy is forwarded but not that forwarding it changes who gets refused.
   */
  it('🔴 through enterMutation: the row policy admits the request the default refuses', async () => {
    const { MUTATION_RATE_LIMIT, ROW_WRITE_RATE_LIMIT } = await loadWith({ env: CONFIGURED });
    vi.doMock('@sentry/nextjs', () => ({ addBreadcrumb: vi.fn() }));
    vi.doMock('@/lib/dal/session', () => ({
      sessionUserOrNull: async () => ({ userId: 'user_abc' }),
    }));
    const { enterMutation } = await import('@/app/p/mutation-entry');
    const { RATE_LIMITED } = await import('@/lib/constants');
    const entered = { ok: true, userId: 'user_abc' };
    const limited = { ok: false, error: RATE_LIMITED };

    try {
      // A default caller is refused on request 121…
      for (let n = 0; n < MUTATION_RATE_LIMIT.attempts; n += 1) {
        expect(await enterMutation('refused')).toEqual(entered);
      }
      expect(await enterMutation('refused')).toEqual(limited);
      // …while a row-write caller, for the same person, is not, until its own 601st.
      for (let n = 0; n < ROW_WRITE_RATE_LIMIT.attempts; n += 1) {
        expect(await enterMutation('refused', ROW_WRITE_RATE_LIMIT)).toEqual(entered);
      }
      expect(await enterMutation('refused', ROW_WRITE_RATE_LIMIT)).toEqual(limited);
    } finally {
      vi.doUnmock('@sentry/nextjs');
      vi.doUnmock('@/lib/dal/session');
    }
  });
});

/**
 * The FAM-1 export follow-up (PR A): the zip export's own budget, through its own checker. The same
 * three properties the row-write suite proves for its policy: the number, enforcement at that number,
 * and a counter that never shares with another.
 */
describe('EXPORT_RATE_LIMIT — the export has its own budget (FAM-1 export follow-up)', () => {
  const CONFIGURED = { UPSTASH_REDIS_REST_URL: 'https://x', UPSTASH_REDIS_REST_TOKEN: 't' };

  it('is the plan’s number, and one export of every athlete in a full household fits', async () => {
    const { EXPORT_RATE_LIMIT } = await loadWith({ env: {} });
    // The contract pin: the literal belongs on the assertion side exactly once (AGENTS.md).
    expect(EXPORT_RATE_LIMIT).toEqual({ attempts: 30, window: '10 m' });
    // Raising the household cap past the budget fails here, not on a parent exporting everyone.
    expect(EXPORT_RATE_LIMIT.attempts).toBeGreaterThanOrEqual(MAX_HOUSEHOLD_ATHLETES);
  });

  it('🔴 is enforced at ITS number', async () => {
    const { checkExportLimit, EXPORT_RATE_LIMIT } = await loadWith({ env: CONFIGURED });
    for (let n = 0; n < EXPORT_RATE_LIMIT.attempts; n += 1) {
      expect((await checkExportLimit('user_abc')).allowed).toBe(true);
    }
    expect(await checkExportLimit('user_abc')).toEqual({ allowed: false, reason: 'limited' });
  });

  it('🔴 an export never spends the ✓ budget, and a ✓ never spends an export', async () => {
    const { checkExportLimit, checkMutationLimit, EXPORT_RATE_LIMIT, MUTATION_RATE_LIMIT } =
      await loadWith({ env: CONFIGURED });
    for (let n = 0; n < EXPORT_RATE_LIMIT.attempts; n += 1) await checkExportLimit('user_abc');
    expect((await checkExportLimit('user_abc')).allowed).toBe(false);
    expect((await checkMutationLimit('user_abc')).allowed).toBe(true);

    const fresh = await loadWith({ env: CONFIGURED });
    for (let n = 0; n < MUTATION_RATE_LIMIT.attempts; n += 1) await fresh.checkMutationLimit('u');
    expect((await fresh.checkMutationLimit('u')).allowed).toBe(false);
    expect((await fresh.checkExportLimit('u')).allowed).toBe(true);
  });

  it('fails OPEN, and says which way', async () => {
    const off = await loadWith({ env: {} });
    expect(await off.checkExportLimit('user_abc')).toEqual({
      allowed: true,
      reason: 'unconfigured',
    });
    const broken = await loadWith({
      env: CONFIGURED,
      limit: async () => {
        throw new Error('redis is down');
      },
    });
    expect(await broken.checkExportLimit('user_abc')).toEqual({
      allowed: true,
      reason: 'limiter-error',
    });
  });
});
