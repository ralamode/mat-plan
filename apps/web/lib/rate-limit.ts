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
const limiter =
  env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
    ? new Ratelimit({
        redis: new Redis({
          url: env.UPSTASH_REDIS_REST_URL,
          token: env.UPSTASH_REDIS_REST_TOKEN,
        }),
        limiter: Ratelimit.slidingWindow(GATE_RATE_LIMIT.attempts, GATE_RATE_LIMIT.window),
        timeout: UPSTASH_TIMEOUT_MS,
        analytics: false, // an extra Redis write per check, for a dashboard nobody reads at this scale
        ephemeralCache: new Map(),
        prefix: 'mat-plan',
      })
    : null;

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
