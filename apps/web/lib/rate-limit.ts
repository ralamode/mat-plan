import 'server-only';

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

import { env } from './env';

/**
 * Rate limiting (V1-14a) — one seam, deliberately applied to **one** endpoint.
 *
 * WHAT IS LIMITED, AND WHY ONLY THAT: the access gate (`app/gate/actions.ts`) is an unauthenticated
 * password oracle for `ACCESS_GATE_PASSWORD`, the app's only shared secret — SECURITY.md lists "auth"
 * first in its rate-limit line. The six mutating Server Actions are deliberately NOT limited yet: the
 * only identifier they carry is `profileId`, which is `formData.get('profileId')` — caller-supplied
 * and unauthenticated, so an attacker rotates a fresh UUID per request for a fresh bucket, while real
 * ids are non-enumerable UUIDv7 (SECURITY.md's anti-IDOR design) and therefore unreachable by guess.
 * Such a limit would constrain only the household. Mutation limits land with Clerk at v1.5, when
 * `getCurrentUser()` provides a real identifier — see docs/tech-debt.md.
 *
 * IDENTIFIER: the client IP as computed by **Vercel Proxy** (`x-real-ip`, read via `@vercel/functions`
 * at the call site). Not the `mp_gate` cookie: that is a deterministic hash of the shared code, so every
 * household member AND every attacker holding the code would share one bucket — and a brute-forcer, who
 * by definition does NOT have the code, sends no cookie at all and would land in a single anonymous
 * bucket. IP is the only identifier that separates the attacker from the family.
 */

/**
 * Gate attempts allowed per window, per IP. Sized so a household fumbling the code is never affected
 * (10 tries in 10 minutes is far past normal human error) while a brute-forcer gets ~1440 guesses/day
 * against a ≥8-character code instead of thousands per second.
 *
 * App-only policy, so it lives HERE and not in `packages/shared` — that package is for cross-boundary
 * values feeding zod + types + the DB seed (AGENTS.md's blast-radius rule); a requests-per-window number
 * is the same class as `COOKIE_MAX_AGE`.
 */
export const GATE_RATE_LIMIT = { attempts: 10, window: '10 m' } as const;

/**
 * The per-user mutation limit (AUTH-1 1c-1). **Sized for a human on a gym floor, not for a gate.**
 * A kid logging a strength session writes one action per movement and can amend a set twice while
 * the keyboard is up, so a working session is plausibly 20-40 mutations in a few minutes — which is
 * why this is NOT the gate's 10-per-10-minutes. The gate limits *guesses at a secret*; this limits
 * *a signed-in person doing their actual work*, and the failure mode of being too tight is an
 * athlete who cannot log.
 *
 * ⚠️ Keyed by Clerk user id, so it survives a household sharing one NAT — which the gate's IP key
 * does not, and which `runbooks.md` already records as the tail of the gate's recovery story.
 */
export const MUTATION_RATE_LIMIT = { attempts: 120, window: '5 m' } as const;

/**
 * Upstash's own network-failure escape hatch. Its DEFAULT is 5000ms — which on a phone is a five-second
 * hang before a tap registers, blowing the INP budget in ADR-0001. 800ms keeps the fail-open property
 * while staying inside a plausible interaction budget.
 */
const UPSTASH_TIMEOUT_MS = 800;

/**
 * The limiter, or `null` when Upstash is unconfigured. Module-level so the `ephemeralCache` actually
 * caches across requests within a warm lambda (a per-call instance would make it useless).
 *
 * Unconfigured is a FIRST-CLASS state, not a degraded one: local dev (`pnpm dev` against embedded
 * Postgres), CI (no external network call may gate a build), and previews before the Vercel env is
 * wired all legitimately run without credentials.
 */
/**
 * 🔴 **A FACTORY, not one limiter — because the window is baked in at construction.**
 * `Ratelimit.slidingWindow(...)` is fixed when the instance is built, and `checkRateLimit` takes no
 * policy argument. So before AUTH-1 there was exactly one policy, and adding a `MUTATION_RATE_LIMIT`
 * const without this change would have left the seven actions limited at **the gate's**
 * 10-per-10-minutes while a sizing test asserted the new number and passed — "a boundary test that
 * cannot fail is worse than none", applied to a constant nothing reads.
 *
 * Each policy gets its own instance **and its own `prefix`**, so their windows cannot collide in
 * Redis, and its own `ephemeralCache` (module-level, so a warm lambda actually reuses it).
 */
function buildLimiter(
  policy: { attempts: number; window: string },
  prefix: string,
): Ratelimit | null {
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return null;
  return new Ratelimit({
    redis: new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    }),
    limiter: Ratelimit.slidingWindow(
      policy.attempts,
      policy.window as Parameters<typeof Ratelimit.slidingWindow>[1],
    ),
    timeout: UPSTASH_TIMEOUT_MS,
    analytics: false, // an extra Redis write per check, for a dashboard nobody reads at this scale
    ephemeralCache: new Map(),
    prefix,
  });
}

const limiter = buildLimiter(GATE_RATE_LIMIT, 'mat-plan');

/**
 * The mutation limiter. **Ships DARK in 1c-1** — `1c-3` is what calls `checkMutationLimit` from the
 * seven actions, once they have a `userId` to key on.
 */
const mutationLimiter = buildLimiter(MUTATION_RATE_LIMIT, 'mat-plan:mutate');

/** Whether the limiter is wired — exported so a runbook/health check can tell "off" from "broken". */
export const isRateLimitConfigured = limiter !== null;

/**
 * Check `identifier` against the limit. **Fails OPEN**, always: this is a personal training log, and a
 * Redis outage locking Ray out of his own app is a worse outcome than an outage briefly widening the
 * brute-force window. Upstash's `timeout` already fails open on network trouble; the `catch` covers the
 * rest (a bad token throws rather than timing out).
 *
 * Returns `{ allowed, reason }` rather than a bare boolean so the caller can distinguish "allowed
 * because under the limit" from "allowed because the limiter is off/broken" — the latter is worth a
 * breadcrumb so a permanently-dead limiter is visible instead of silent.
 */
/**
 * The per-user mutation check (AUTH-1 1c-1). Owns its `mutate:` key shape so no call site builds the
 * identifier by hand — the seven actions pass a `userId` and nothing else, which is also what keeps
 * the source guard in `pages-are-gated.test.ts` matching one spelling.
 *
 * Same fail-OPEN contract as {@link checkRateLimit}, for the same reason: a Redis outage that stops a
 * kid logging a set is worse than an outage that briefly widens a window on a three-person app.
 *
 * ⚠️ **Ships DARK.** `1c-3` adds the call sites, once the actions have a principal.
 */
export async function checkMutationLimit(
  userId: string,
): Promise<{ allowed: boolean; reason: 'ok' | 'unconfigured' | 'limiter-error' | 'limited' }> {
  if (!mutationLimiter) return { allowed: true, reason: 'unconfigured' };
  try {
    const { success } = await mutationLimiter.limit(`mutate:${userId}`);
    return success ? { allowed: true, reason: 'ok' } : { allowed: false, reason: 'limited' };
  } catch {
    return { allowed: true, reason: 'limiter-error' };
  }
}

export async function checkRateLimit(
  identifier: string,
): Promise<{ allowed: boolean; reason: 'ok' | 'unconfigured' | 'limiter-error' | 'limited' }> {
  if (!limiter) return { allowed: true, reason: 'unconfigured' };
  try {
    const { success } = await limiter.limit(identifier);
    return success ? { allowed: true, reason: 'ok' } : { allowed: false, reason: 'limited' };
  } catch {
    // Deliberately swallowed — see the fail-open rationale above. The caller records a breadcrumb.
    return { allowed: true, reason: 'limiter-error' };
  }
}
