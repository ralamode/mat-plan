import 'server-only';

import * as Sentry from '@sentry/nextjs';

import { RATE_LIMITED } from '@/lib/constants';
import { hasGateAccess } from '@/lib/dal/gate';
import { sessionUserOrNull } from '@/lib/dal/session';
import { checkMutationLimit } from '@/lib/rate-limit';

import type { ActionState } from './action-state';

/**
 * A refusal is an `ActionState` **by type, not by resemblance**, so an action can `return entry`
 * directly and a later change to `ActionState` breaks the compile here instead of silently producing
 * an envelope the form islands cannot read.
 */
type MutationRefusal = ActionState & { ok: false };

export type MutationEntry = { ok: true; userId: string } | MutationRefusal;

/**
 * 🔴 **The entry check every mutating Server Action under `/p/[profileId]` runs first — three
 * checks, in this order, and the order is the design (AUTH-1 1c-3b).**
 *
 *  1. the **GATE**, unchanged. 1c-3b ADDS a session rather than swapping the gate out:
 *     `getHouseholdScope()` does not consult the principal until 1c-4, so a session alone would mean
 *     "anyone this Clerk instance admits", and a swap would leave `mp_gate` enforced by the proxy
 *     alone — which `SECURITY.md` refuses to call a boundary. Deleted at **1d**, after 1c-4.
 *  2. the **SESSION**. Same refusal copy as the gate on purpose: a caller must not be able to tell
 *     "no code" from "no session" from "wrong household" — `actions.test.ts` pins that the three
 *     refusals are byte-identical, which is ADR 0006's 404-never-403 argument. Hence `refusal` is a
 *     parameter: the caller supplies its own copy (`NO_PROFILE_LOG` / `NO_PROFILE_SAVE`) and both
 *     branches above use that one string.
 *  3. the **LIMITER**, keyed on the principal — so it comes after the session, and callers run this
 *     BEFORE their zod parse and `getProfileByPublicId`. An unauthenticated flood then does zero
 *     Redis and zero DB work, and the key is never caller-supplied.
 *
 * ⚠️ **Why this is ONE function and not seven copies.** It was seven, byte-identical but for the
 * refusal string — the shape V1-24 had already collapsed once in this folder for the Sentry wrapper.
 * Seven copies of a security predicate is seven places for the next author to land one conjunct
 * short, and six of those are only caught by a reviewer noticing an absence. Raised in review on
 * #323 _(maintainer, 2026-11-01)_.
 *
 * ⚠️ **The limiter fails OPEN, and under vitest `mutationLimiter` is always `null`** — so every call
 * answers `allowed: true` and no behavioural test can see this function misplaced or missing. The
 * guard is `app/pages-are-gated.test.ts`: it requires every exported action to call `enterMutation`,
 * pins the import to this module, and asserts the three conjuncts appear HERE in the order above.
 * Collapsing to one function is what made that order assertable at all.
 *
 * @param refusal the copy for both "no gate" and "no session" — never distinguishable to a caller.
 */
export async function enterMutation(refusal: string): Promise<MutationEntry> {
  if (!(await hasGateAccess())) return { ok: false, error: refusal };
  const user = await sessionUserOrNull();
  if (!user) return { ok: false, error: refusal };

  const limit = await checkMutationLimit(user.userId);
  if (!limit.allowed) return { ok: false, error: RATE_LIMITED };
  if (limit.reason === 'limiter-error') {
    // The gate action's idiom: a permanently-dead fail-open limiter is otherwise silent.
    Sentry.addBreadcrumb({
      category: 'rate-limit',
      level: 'warning',
      message: 'mutation limiter unavailable',
    });
  }

  return { ok: true, userId: user.userId };
}
