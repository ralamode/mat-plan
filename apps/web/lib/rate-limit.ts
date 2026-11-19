import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

import { env } from './env';

/**
 * Rate limiting (V1-14a) — one seam, and **three limiter instances**: two for mutations (FAM-1 step
 * 0b; one from AUTH-1 1d until then) and one for the zip export (the FAM-1 export follow-up,
 * [plan](../../../docs/plans/fam-1-export-owner-only.md) PR A). All are keyed on the **Clerk
 * principal**.
 *
 * - **Every mutating Server Action**, through `enterMutation` (`app/p/mutation-entry.ts`): the caller
 *   names one of the two mutation policies and gets that policy's own instance; the default is
 *   `MUTATION_RATE_LIMIT`.
 * - **The zip export** (`app/p/[profileId]/export/route.ts`), through `checkExportLimit`, its own
 *   function with its own budget, so an export never spends a parent's ✓ budget and the reverse.
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
 * The zip export, the most expensive single request in the app, is limited since the FAM-1 export
 * follow-up (below). `/api/sync` is the one surface `docs/tech-debt.md` still counts as owed, and it
 * is not a surface yet.
 *
 * IDENTIFIER: the **Clerk user id**. ⚠️ The long argument that used to sit here was about the gate's
 * IP key — why an IP beat the `mp_gate` cookie, which was a deterministic hash of a shared code and
 * so put every household member and every code-holding attacker in one bucket. It is gone with the
 * gate. A principal is strictly better than either: the caller cannot choose it, and it survives a
 * household sharing one NAT, which an IP key does not.
 */

/**
 * The per-user mutation limit (AUTH-1 1c-1), and the DEFAULT policy: every action that does not name
 * another one is limited by this. (From `1d` to FAM-1 step 0b it was the only policy in this file.)
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
 * The per-user limit for **row writes** on the day page: ✓, un-tick, re-tick and Change
 * (FAM-1 D23, [plan](../../../docs/plans/fam-1-family-program.md) §1).
 *
 * **Why a second number rather than a bigger first one.** On the FAM-1 day page a ✓ is a write: one
 * action per row, so that a failed tick can be retried and replayed alone. A parent logging two
 * athletes' full days in one sitting is about 100 ✓ in a few minutes, before a single correction. At
 * 120 per 5 minutes the default would refuse that parent in the middle of logging, which is the
 * failure mode this module is sized against. Raising the default instead would loosen every other
 * mutation (add an athlete, save a workout) for the sake of one screen, and batching the rows into
 * one action would lose the per-row replay. So the row writes get their own budget, five times the
 * default over the same window, and everything else keeps 120.
 *
 * **Its callers are FAM-1's row actions** (`app/p/[profileId]/row-actions.ts`, step 12b): log,
 * un-tick and re-tick; whether a page serves them yet is that module's docblock. Step 0b added the
 * policy and the parameter on `enterMutation`.
 *
 * ⚠️ It is still a bound: 600 writes in 5 minutes is two a second, sustained, which no person on a
 * phone does. A runaway client is refused here exactly as it is by the default.
 */
export const ROW_WRITE_RATE_LIMIT = { attempts: 600, window: '5 m' } as const;

/**
 * The policies a mutation may be limited by: **a closed set of named consts, not a shape.**
 *
 * `enterMutation` takes one of these. It is deliberately not `{ attempts: number; window: … }`: a
 * caller that could pass any numbers could write itself an unlimited budget at the call site, where
 * no test in this file would see it. A new policy is a const here, a limiter instance below and a
 * branch in `limiterFor`, in one diff.
 */
export type MutationLimitPolicy = typeof MUTATION_RATE_LIMIT | typeof ROW_WRITE_RATE_LIMIT;

/**
 * The per-user **export** limit (FAM-1 export follow-up, PR A): one zip download per tap, counted
 * only for an export of a profile the caller's household holds.
 *
 * **Sized from the household cap, not from a typical family.** An owner taking every athlete's data
 * out, which the privacy notice tells them to do before deleting anything, taps one link per athlete,
 * and a household holds up to `MAX_HOUSEHOLD_ATHLETES` (25), archived athletes included (the cap
 * counts them).
 * Thirty in ten minutes fits that pass, the headroom covers a retried download or two, and it still
 * refuses a loop. `rate-limit.test.ts`
 * pins `attempts >= MAX_HOUSEHOLD_ATHLETES`, so raising the cap fails a test, not a parent.
 *
 * ⚠️ **Not a `MutationLimitPolicy`, on purpose.** It has its own checker (`checkExportLimit`, no policy
 * parameter), so no Server Action can pass it to `enterMutation`, and `limiterFor`'s fallback still
 * fails toward the stricter mutation limit.
 */
export const EXPORT_RATE_LIMIT = { attempts: 30, window: '10 m' } as const;

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
 * 🔴 **A FACTORY, deliberately — because the window is baked in at construction.**
 * `Ratelimit.slidingWindow(...)` is fixed when the instance is built, so a second policy CANNOT be
 * added by writing a const and passing it to the check: it needs its own instance. Before
 * AUTH-1 there was one limiter, and adding `MUTATION_RATE_LIMIT` without this factory would have left
 * the seven actions limited at the gate's 10-per-10-minutes while a sizing test asserted the new
 * number and passed — "a boundary test that cannot fail is worse than none", applied to a constant
 * nothing reads.
 *
 * ✅ **`1d` left this with a single call site and it was kept anyway, for the second policy that
 * FAM-1 step 0b then added** (`ROW_WRITE_RATE_LIMIT`). Inlining it would have re-created exactly the
 * shape above: a const beside a hard-coded instance. The factory is what made the second policy a
 * few lines that cannot silently inherit the first one's window, and `rate-limit.test.ts` drains
 * each instance to its own number to show it.
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
 * `enterMutation` on behalf of every action that names no other policy, which today is all of them.
 */
const mutationLimiter = buildLimiter(MUTATION_RATE_LIMIT, 'mat-plan:mutate');

/**
 * The row-write limiter (FAM-1 step 0b). **Its callers are the row actions (step 12b).**
 *
 * ⚠️ **Its prefix is a SIBLING of `mat-plan:mutate`, never a child of it.** `buildLimiter`'s docblock
 * says why: a prefix that is a parent of another puts two window sizes in one keyspace. So this is
 * `mat-plan:row-write`, not `mat-plan:mutate:row`. The identifier is the same Clerk user id, so a
 * person has one counter per policy and exhausting one says nothing about the other.
 */
const rowWriteLimiter = buildLimiter(ROW_WRITE_RATE_LIMIT, 'mat-plan:row-write');

/**
 * The export limiter. A SIBLING prefix again (`mat-plan:export`), never a child of another, for the
 * same reason as the row-write one: its own counter per person, its own window.
 */
const exportLimiter = buildLimiter(EXPORT_RATE_LIMIT, 'mat-plan:export');

/**
 * The instance that enforces a policy.
 *
 * 🔴 **By identity, and anything that is not THE row-write const gets the default.** The default is
 * the tighter of the two, so the fallback fails toward the stricter limit: an object that merely
 * looks like `ROW_WRITE_RATE_LIMIT` (same numbers, built at a call site, past the type by a cast)
 * buys nothing.
 */
function limiterFor(policy: MutationLimitPolicy): Ratelimit | null {
  return policy === ROW_WRITE_RATE_LIMIT ? rowWriteLimiter : mutationLimiter;
}

/**
 * Whether the limiter is wired — exported so a runbook/health check can tell "off" from "broken".
 * 🔴 **REBOUND at `1d` from the deleted gate limiter to `mutationLimiter`.** Not cosmetic: without
 * this the module does not compile, and `docs/plans/ai-1-nl-logging.md` cites this export as a live
 * mitigation, so it had to keep meaning "the limiter this app actually uses is wired".
 * Every instance is built from the same two env vars, so this one answer covers all three.
 */
export const isRateLimitConfigured = mutationLimiter !== null;

/**
 * The per-user mutation check (AUTH-1 1c-1). Owns its key shape so no call site builds the
 * identifier by hand: the prefix belongs to the policy's instance, the identifier is the user id.
 *
 * @param policy which budget to count against. Defaults to `MUTATION_RATE_LIMIT`; a row write
 *   passes `ROW_WRITE_RATE_LIMIT` (through `enterMutation`, never directly).
 *
 * **Fails OPEN**, always: a Redis outage that stops a
 * kid logging a set is worse than an outage that briefly widens a window on a three-person app.
 *
 * 🔴 **ONE caller since `1c-3b`: `enterMutation`** (the export has its own checker, below). It is not called from an action directly, and the
 * guard in `pages-need-a-session.test.ts` asserts it appears there in order, after the session check —
 * because the key is the principal, and fail-open plus an unconfigured limiter under vitest means no
 * behavioural test can see this call misplaced or missing.
 */
export async function checkMutationLimit(
  userId: string,
  policy: MutationLimitPolicy = MUTATION_RATE_LIMIT,
): Promise<LimitCheck> {
  return check(limiterFor(policy), userId);
}

/**
 * The per-user **export** check (FAM-1 export follow-up, PR A). **No policy parameter**: there is one
 * export budget, so a call site cannot pass the wrong one or fall back to the ✓ budget by omission.
 * Fails open, like every check here.
 *
 * **One caller: the export route**, AFTER its session check and its profile check, so only an export
 * of a profile the caller's household holds is counted and a cross-site page cannot spend a parent's
 * budget with a made-up id. `export/route.test.ts` pins the order.
 */
export async function checkExportLimit(userId: string): Promise<LimitCheck> {
  return check(exportLimiter, userId);
}

/**
 * Which limiter FAMILY a caller found dead: the event's one tag besides the outcome. `mutation` covers
 * both mutation policies (`enterMutation` reports for either); `export` is the export's.
 */
export type LimiterName = 'mutation' | 'export';

/** The limiters already reported dead in this process. Two names, so it cannot grow. */
const reportedUnavailable = new Set<LimiterName>();

/**
 * **A dead limiter, said out loud** (#665's P2, the board's fix, 2026-11-19). Every check here fails
 * open, so a limiter that is down for good looks exactly like a healthy one. A breadcrumb alone is not
 * a signal: Sentry sends breadcrumbs only with a later event, and a request the dead limiter let
 * through succeeds and sends none. So the caller's `limiter-error` raises one real event, **once per
 * process per limiter family** (the `session.ts` `auth() unavailable` shape), and keeps the breadcrumb for an
 * error that does follow.
 *
 * What it carries: the fixed message and two tags. No user id, no profile id, no count; the limiter
 * name is one of two fixed words.
 */
export function reportLimiterUnavailable(limiter: LimiterName): void {
  Sentry.addBreadcrumb({
    category: 'rate-limit',
    level: 'warning',
    message: `${limiter} limiter unavailable`,
  });
  if (reportedUnavailable.has(limiter)) return;
  reportedUnavailable.add(limiter);
  Sentry.captureMessage('rate limiter unavailable', {
    level: 'warning',
    tags: { rate_limit_outcome: 'limiter_unavailable', limiter },
    // 🔴 **The fingerprint is load-bearing.** Sentry's default Dedupe integration drops an event whose
    // message, fingerprint and stacktrace match the previous one, ignoring tags. All three limiters
    // share one Redis, so an outage reports `mutation` first and the `export` event, identical but
    // for its tag, would be dropped, with this process never trying again. A per-family fingerprint
    // keeps the two apart, and files them as two issues.
    fingerprint: ['rate-limiter-unavailable', limiter],
  });
}

/** What a limit check answers. `allowed` is true on every reason but `limited` (fail-open). */
export type LimitCheck = {
  allowed: boolean;
  reason: 'ok' | 'unconfigured' | 'limiter-error' | 'limited';
};

/** One check against one instance: the body both exported checkers share. */
async function check(limiter: Ratelimit | null, userId: string): Promise<LimitCheck> {
  if (!limiter) return { allowed: true, reason: 'unconfigured' };
  try {
    const { success, reason } = await limiter.limit(userId);
    // 🔴 **A timeout RESOLVES, it does not throw.** With `timeout` set, `@upstash/ratelimit` 2.2.0
    // races Redis against a timer that answers `{ success: true, reason: 'timeout' }`. Read as `ok`,
    // a hanging Redis would be indistinguishable from a healthy one; it is the dead-limiter case.
    if (reason === 'timeout') return { allowed: true, reason: 'limiter-error' };
    return success ? { allowed: true, reason: 'ok' } : { allowed: false, reason: 'limited' };
  } catch {
    return { allowed: true, reason: 'limiter-error' };
  }
}
