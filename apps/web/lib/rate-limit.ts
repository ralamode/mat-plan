import 'server-only';

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

import { env } from './env';

/**
 * Rate limiting (V1-14a) — one seam, ONE limiter instance since AUTH-1 1d:
 *
 * **Every mutating Server Action**, through `enterMutation` (`app/p/[profileId]/mutation-entry.ts`),
 * keyed on the **Clerk principal**.
 *
 * 🔴 **`1d` deleted the other one, and with it this app's only IP-keyed limiter.** It guarded the
 * access gate — an unauthenticated password oracle for `ACCESS_GATE_PASSWORD` — and there is no
 * password and no oracle. ⚠️ **Consequences that are NOT bookkeeping:** `SECURITY.md` listed "auth"
 * first among rate-limited surfaces and no longer can; and **Upstash stops receiving a client IP
 * entirely**, which is a reduction in what a processor sees and is recorded as such in
 * `docs/privacy/notice.md` and `data-inventory.md`. The surviving limiter is keyed on a Clerk user
 * id, never an IP.
 *
 * ⚠️ **WHY (2) WAITED, which is the part worth keeping.** Through 1c-2 the only identifier an action
 * carried was `formData.get('profileId')` — caller-supplied and unauthenticated, so an attacker
 * rotates a fresh UUID per request for a fresh bucket, while real ids are non-enumerable UUIDv7
 * (SECURITY.md's anti-IDOR design) and therefore unreachable by guess. Such a limit would have
 * constrained **only the household**. 1c-3b is what supplies a principal the caller cannot choose,
 * which is the whole reason the limiter call sits AFTER the session check and BEFORE the zod parse.
 *
 * ⏳ **The zip export route is still unlimited** — the one EXISTING surface `docs/tech-debt.md`
 * counts as owed, and the most expensive single request in the app. Deferred to `1c-4`. (`/api/sync`
 * is the other thing that entry owes, and it is not a surface yet.)
 *
 * IDENTIFIER: the **Clerk user id**. ⚠️ The long argument that used to sit here was about the gate's
 * IP key — why an IP beat the `mp_gate` cookie, which was a deterministic hash of a shared code and
 * so put every household member and every code-holding attacker in one bucket. It is gone with the
 * gate. A principal is strictly better than either: the caller cannot choose it, and it survives a
 * household sharing one NAT, which an IP key does not.
 */

/**
 * The per-user mutation limit (AUTH-1 1c-1), and since `1d` the only policy in this file.
 * **Sized for a human on a gym floor.** A kid logging a strength session writes one action per
 * movement and can amend a set twice while the keyboard is up, so a working session is plausibly
 * 20-40 mutations in a few minutes; the failure mode of being too tight is an athlete who cannot log.
 *
 * ⚠️ The deleted gate policy was 10-per-10-minutes, two orders of magnitude tighter, because it
 * limited *guesses at a secret* rather than *a signed-in person doing their work*. Recorded so the
 * next author does not read 120-per-5-minutes as loose by comparison with something that is gone.
 *
 * App-only policy, so it lives HERE and not in `packages/shared` — that package is for
 * cross-boundary values feeding zod + types + the DB seed (AGENTS.md's blast-radius rule); a
 * requests-per-window number is the same class as `COOKIE_MAX_AGE`.
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
 * 🔴 **Still a FACTORY with one caller, deliberately — because the window is baked in at
 * construction.** `Ratelimit.slidingWindow(...)` is fixed when the instance is built and the check
 * function takes no policy argument, so a second policy CANNOT be added by writing a const: before
 * AUTH-1 there was one limiter, and adding `MUTATION_RATE_LIMIT` without this factory would have left
 * the seven actions limited at the gate's 10-per-10-minutes while a sizing test asserted the new
 * number and passed — "a boundary test that cannot fail is worse than none", applied to a constant
 * nothing reads.
 *
 * ⚠️ **`1d` left this with a single call site, and it is kept anyway.** Inlining it would re-create
 * exactly the shape above: the next policy (the zip export, `/api/sync`) would be a const beside a
 * hard-coded instance. The factory is what makes a second policy a two-line change that cannot
 * silently inherit the first one's window.
 *
 * ⚠️ **A prefix does NOT make collision impossible**, and an earlier draft of this comment claimed it
 * did. `mat-plan:*` is a *parent* namespace of `mat-plan:mutate:*`, so a checker called with a
 * hand-built `'mutate:…'` identifier would land in this limiter's keyspace, where two different
 * window sizes produce indices that can coincide. What keeps policies apart is that **each limiter
 * owns its identifier shape** and no caller builds one by hand. Keep it that way.
 *
 * ⚠️ `window` is typed as Upstash's `Duration` template literal, NOT `string`.
 * `Ratelimit.slidingWindow` calls `ms(window)` EAGERLY and throws on anything it cannot parse — and
 * this runs at MODULE SCOPE, so a typo would take down every importer of this file. Typed properly,
 * `'5 mins'` is a compile error instead.
 */
function buildLimiter(
  policy: { attempts: number; window: Parameters<typeof Ratelimit.slidingWindow>[1] },
  prefix: string,
): Ratelimit | null {
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return null;
  return new Ratelimit({
    redis: new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    }),
    limiter: Ratelimit.slidingWindow(policy.attempts, policy.window),
    timeout: UPSTASH_TIMEOUT_MS,
    analytics: false, // an extra Redis write per check, for a dashboard nobody reads at this scale
    ephemeralCache: new Map(),
    prefix,
  });
}

/**
 * The mutation limiter. Landed dark in `1c-1`; **live since `1c-3b`**, called once from
 * `enterMutation` on behalf of all seven actions.
 */
const mutationLimiter = buildLimiter(MUTATION_RATE_LIMIT, 'mat-plan:mutate');

/**
 * Whether the limiter is wired — exported so a runbook/health check can tell "off" from "broken".
 * 🔴 **REBOUND at `1d` from the deleted gate limiter to `mutationLimiter`.** Not cosmetic: without
 * this the module does not compile, and `docs/plans/ai-1-nl-logging.md` cites this export as a live
 * mitigation, so it had to keep meaning "the limiter this app actually uses is wired".
 */
export const isRateLimitConfigured = mutationLimiter !== null;

/**
 * The per-user mutation check (AUTH-1 1c-1). Owns its `mutate:` key shape so no call site builds the
 * identifier by hand.
 *
 * **Fails OPEN**, always: a Redis outage that stops a
 * kid logging a set is worse than an outage that briefly widens a window on a three-person app.
 *
 * 🔴 **ONE caller since `1c-3b`: `enterMutation`.** It is not called from an action directly, and the
 * guard in `pages-need-a-session.test.ts` asserts it appears there in order, after the session check —
 * because the key is the principal, and fail-open plus an unconfigured limiter under vitest means no
 * behavioural test can see this call misplaced or missing.
 */
export async function checkMutationLimit(
  userId: string,
): Promise<{ allowed: boolean; reason: 'ok' | 'unconfigured' | 'limiter-error' | 'limited' }> {
  if (!mutationLimiter) return { allowed: true, reason: 'unconfigured' };
  try {
    const { success } = await mutationLimiter.limit(userId);
    return success ? { allowed: true, reason: 'ok' } : { allowed: false, reason: 'limited' };
  } catch {
    return { allowed: true, reason: 'limiter-error' };
  }
}
