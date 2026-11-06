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
    // ⚠️ `toEqual` on the whole array, so a SECOND `new Ratelimit(...)` is a failure too: this is the
    // assertion that notices a limiter nobody meant to build.
    const { MUTATION_RATE_LIMIT } = await loadWith({
      env: { UPSTASH_REDIS_REST_URL: 'https://x', UPSTASH_REDIS_REST_TOKEN: 't' },
    });
    expect(built).toEqual([{ ...MUTATION_RATE_LIMIT, prefix: 'mat-plan:mutate' }]);
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
