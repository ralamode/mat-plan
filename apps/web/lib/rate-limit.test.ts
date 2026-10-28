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
async function loadWith(opts: {
  env: Record<string, string | undefined>;
  // AUTH-1 1c-1 widened this: the mutation tests assert the IDENTIFIER each limiter is called with,
  // which is how "the two policies are separate instances" is proved behaviourally rather than read.
  limit?: (identifier: string) => Promise<{ success: boolean }>;
}) {
  vi.resetModules();
  vi.doMock('./env', () => ({ env: opts.env }));
  vi.doMock('@upstash/redis', () => ({ Redis: class {} }));
  vi.doMock('@upstash/ratelimit', () => ({
    Ratelimit: class {
      static slidingWindow = () => ({});
      limit = opts.limit ?? (async () => ({ success: true }));
    },
  }));
  return import('./rate-limit');
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('./env');
});

describe('checkRateLimit — unconfigured is a first-class state, not a degraded one', () => {
  it('allows when Upstash env is absent (local dev, CI, un-wired previews)', async () => {
    const { checkRateLimit, isRateLimitConfigured } = await loadWith({ env: {} });
    expect(isRateLimitConfigured).toBe(false);
    await expect(checkRateLimit('gate:1.2.3.4')).resolves.toEqual({
      allowed: true,
      reason: 'unconfigured',
    });
  });

  it('allows when only ONE of the two vars is set (a half-configured env must not half-work)', async () => {
    const { checkRateLimit } = await loadWith({
      env: { UPSTASH_REDIS_REST_URL: UPSTASH_ENV.UPSTASH_REDIS_REST_URL },
    });
    await expect(checkRateLimit('gate:1.2.3.4')).resolves.toEqual({
      allowed: true,
      reason: 'unconfigured',
    });
  });
});

describe('checkRateLimit — configured', () => {
  it('allows while under the limit', async () => {
    const { checkRateLimit, isRateLimitConfigured } = await loadWith({
      env: UPSTASH_ENV,
      limit: async () => ({ success: true }),
    });
    expect(isRateLimitConfigured).toBe(true);
    await expect(checkRateLimit('gate:1.2.3.4')).resolves.toEqual({ allowed: true, reason: 'ok' });
  });

  it('BLOCKS past the limit — the one case that must actually deny', async () => {
    const { checkRateLimit } = await loadWith({
      env: UPSTASH_ENV,
      limit: async () => ({ success: false }),
    });
    await expect(checkRateLimit('gate:1.2.3.4')).resolves.toEqual({
      allowed: false,
      reason: 'limited',
    });
  });
});

describe('checkRateLimit — fails OPEN, and says so', () => {
  it('allows when the limiter throws (a Redis outage must not lock Ray out of his own app)', async () => {
    const { checkRateLimit } = await loadWith({
      env: UPSTASH_ENV,
      limit: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    await expect(checkRateLimit('gate:1.2.3.4')).resolves.toEqual({
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
    const a = await healthy.checkRateLimit('gate:x');
    const b = await broken.checkRateLimit('gate:x');
    expect(a.allowed).toBe(b.allowed);
    expect(a.reason).not.toBe(b.reason);
  });
});

describe('GATE_RATE_LIMIT — sized for humans, not for a brute-forcer', () => {
  it('leaves ample room for a household fumbling the code', async () => {
    const { GATE_RATE_LIMIT } = await loadWith({ env: {} });
    expect(GATE_RATE_LIMIT.attempts).toBeGreaterThanOrEqual(5);
    // …while still bounding guesses to ~1.4k/day rather than thousands per second.
    expect(GATE_RATE_LIMIT.attempts).toBeLessThanOrEqual(20);
    expect(GATE_RATE_LIMIT.window).toMatch(/^\d+\s*[smhd]$/);
  });
});

describe('MUTATION_RATE_LIMIT — sized for a kid logging, not for a brute-forcer (AUTH-1 1c-1)', () => {
  it('is far looser than the gate, because it limits work rather than guesses', async () => {
    const { MUTATION_RATE_LIMIT, GATE_RATE_LIMIT } = await loadWith({ env: {} });
    // A strength session is one action per movement plus amendments, so a real session is plausibly
    // 20-40 mutations in a few minutes. Limiting that at the GATE's rate would stop an athlete
    // mid-session — the failure mode that matters here is too tight, not too loose.
    expect(MUTATION_RATE_LIMIT.attempts).toBeGreaterThan(GATE_RATE_LIMIT.attempts);
    expect(MUTATION_RATE_LIMIT.attempts).toBeGreaterThanOrEqual(60);
    // …while still bounding a runaway client rather than letting it write without limit.
    expect(MUTATION_RATE_LIMIT.attempts).toBeLessThanOrEqual(500);
    expect(MUTATION_RATE_LIMIT.window).toMatch(/^\d+\s*[smhd]$/);
  });

  it('🔴 is ENFORCED, not merely declared — the two policies get separate limiters', async () => {
    // The defect this guards: `Ratelimit.slidingWindow(...)` bakes the window in at construction and
    // `checkRateLimit` takes no policy argument. With one module-level limiter, adding the const
    // above would have left the actions limited at the GATE's rate while this file asserted the new
    // number and passed. The proof is behavioural: exhaust one limiter, the other still allows.
    const seen: string[] = [];
    const { checkRateLimit, checkMutationLimit } = await loadWith({
      env: { UPSTASH_REDIS_REST_URL: 'https://x', UPSTASH_REDIS_REST_TOKEN: 't' },
      limit: async (id: string) => {
        seen.push(id);
        // Only the GATE's identifier is over its limit.
        return { success: !id.startsWith('ip:') };
      },
    });

    expect((await checkRateLimit('ip:1.2.3.4')).allowed).toBe(false);
    expect((await checkMutationLimit('user_abc')).allowed).toBe(true);
    expect(seen).toEqual(['ip:1.2.3.4', 'mutate:user_abc']);
  });

  it('owns the `mutate:` key shape, so no call site builds an identifier by hand', async () => {
    const seen: string[] = [];
    const { checkMutationLimit } = await loadWith({
      env: { UPSTASH_REDIS_REST_URL: 'https://x', UPSTASH_REDIS_REST_TOKEN: 't' },
      limit: async (id: string) => {
        seen.push(id);
        return { success: true };
      },
    });
    await checkMutationLimit('user_abc');
    expect(seen).toEqual(['mutate:user_abc']);
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
