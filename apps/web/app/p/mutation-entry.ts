import 'server-only';

import { TRANSPORT_REFUSALS, type TransportRefusal } from '@mat-plan/shared';
import * as Sentry from '@sentry/nextjs';

import { RATE_LIMITED } from '@/lib/constants';
import { sessionUserOrNull } from '@/lib/dal/session';
import {
  checkMutationLimit,
  MUTATION_RATE_LIMIT,
  type MutationLimitPolicy,
} from '@/lib/rate-limit';

// ⚠️ `action-state.ts` did NOT move with this file (WP-1): it is imported by the route's form
// components as well as by actions, so it stays beside them. The alias avoids spelling the dynamic
// segment in a relative path.
import type { ActionState } from '@/app/p/[profileId]/action-state';

/**
 * A refusal is an `ActionState` **by type, not by resemblance**, so an action can `return entry`
 * directly and a later change to `ActionState` breaks the compile here instead of silently producing
 * an envelope the form islands cannot read.
 */
type MutationRefusal = ActionState & { ok: false };

export type MutationEntry = { ok: true; userId: string } | MutationRefusal;

/**
 * The entry of an action that speaks the FAM-1 contract (`ProgramActions`, `DayActions`): the same
 * two checks, refused in the contract's words. `TransportRefusal` is a valid `ProgramResult` and a
 * valid `RowResult`, so such an action writes `if (!entry.ok) return entry;` exactly as a form
 * action does, and the source guard reads both the same way.
 */
export type ContractEntry = { ok: true; userId: string } | TransportRefusal;

/**
 * 🔴 **The entry check every mutating Server Action under `/p` runs first — in BOTH modules since
 * PROF-1 a-r (`[profileId]/actions.ts` and `profile-actions.ts`), and two
 * checks, in this order, and the order is the design (AUTH-1 1c-3b, narrowed at 1d).**
 *
 *  1. the **SESSION**, and as of `1d` it is the whole boundary. It used to be the second of three:
 *     `1c-3b` added it BESIDE the gate rather than swapping the gate out, because until `1c-4` the
 *     household scope did not consult the principal, so a session alone meant only "someone this
 *     Clerk instance admits". `1c-4` discharged that, and `1d` deletes the gate.
 *     ⚠️ **Dropping the gate conjunct narrowed the CHECK, not the boundary.** The gate was a shared
 *     code — anyone holding it could use it, so it never identified a caller. What authorizes is the
 *     household-scoped session, re-checked here rather than inherited from the proxy
 *     (CVE-2025-29927; SEC-1's scar was a prefetch header skipping the matcher).
 *     A caller must not be able to tell "no session" from "wrong household" — `actions.test.ts` pins
 *     that the refusals are byte-identical, which is ADR 0006's 404-never-403 argument. Hence
 *     `refusal` is a parameter: the caller supplies its own copy (`NO_PROFILE_LOG` /
 *     `NO_PROFILE_SAVE`).
 *  2. the **LIMITER**, keyed on the principal — so it comes after the session, and callers run this
 *     BEFORE their zod parse and `getProfileByPublicId`. An unauthenticated flood then does zero
 *     Redis and zero DB work, and the key is never caller-supplied.
 *     **The caller picks the POLICY, never the key** (FAM-1 step 0b, D23): `policy` defaults to
 *     `MUTATION_RATE_LIMIT`, and a row write on the day page will pass `ROW_WRITE_RATE_LIMIT`. It is
 *     one of the named consts in `lib/rate-limit.ts`, not a pair of numbers, so an action cannot
 *     write itself a budget. ⚠️ The parameter changes WHICH budget is counted against; it does not
 *     move the call, so the order above and its source guard are exactly as they were. No action
 *     passes one yet, and the action matrix (`test/action-matrix.ts`) pins that: every action's
 *     limiter call carries the default unless its binding declares otherwise.
 *
 * ⚠️ **Why this is ONE function and not seven copies.** It was seven, byte-identical but for the
 * refusal string — the shape V1-24 had already collapsed once in this folder for the Sentry wrapper.
 * Seven copies of a security predicate is seven places for the next author to land one conjunct
 * short, and six of those are only caught by a reviewer noticing an absence. Raised in review on
 * #323 _(maintainer, 2026-11-01)_.
 *
 * ⚠️ **The limiter fails OPEN, and under vitest `mutationLimiter` is always `null`** — so every call
 * answers `allowed: true`, and a `checkMutationLimit` placed after the write, or whose result is
 * ignored, is invisible to any behavioural test. Hence the **source** guard in
 * `app/pages-need-a-session.test.ts` (PR C renames it `pages-need-a-session.test.ts`): per action, the
 * awaited `enterMutation` call, that its refusal is RETURNED, and that the import comes from this
 * module; and once, here, that the two conjuncts appear in the order above. Collapsing to one function is what made that order assertable at all.
 *
 * 📌 The behavioural half is real and is not redundant: `actions.test.ts` runs the real
 * `enterMutation` against mocked dependencies, so a missing or result-discarded call fails all three
 * refusal suites for every enumerated action. The source guard covers what those cannot — placement
 * and order — not the whole claim.
 *
 * 🔴 **ONE function for both envelopes, on purpose (FAM-1 contract change C7).** An action that
 * speaks the FAM-1 contract takes a typed input and resolves a `ProgramResult` or a `RowResult`, not
 * an `ActionState`. It passes `TRANSPORT_REFUSALS` (`@mat-plan/shared`) where a form action passes
 * its copy, and is refused with `{ ok: false, reason }`: `not_found` for no session, `retry` for
 * the limit. A second entry function would have needed the source guard to accept either name,
 * which is the alternation `pages-need-a-session.test.ts` forbids, and would have put the two
 * conjuncts and their order in two places. Here the checks below are written once and only the
 * shape of the answer differs.
 * ⚠️ **The argument only chooses the envelope; the two words are read from the const**, never from
 * what the caller passed, so a look-alike object pushed past the type by a cast cannot change what
 * a refused caller is told.
 *
 * @param refusal what a caller with no session is answered with: a form action's copy (never
 *   distinguishable from any other refusal to a caller), or `TRANSPORT_REFUSALS` for an action that
 *   speaks the FAM-1 contract.
 * @param policy the rate-limit budget this mutation counts against; the default for everything
 *   that is not a day-page row write.
 */
export async function enterMutation(
  refusal: string,
  policy?: MutationLimitPolicy,
): Promise<MutationEntry>;
export async function enterMutation(
  refusal: typeof TRANSPORT_REFUSALS,
  policy?: MutationLimitPolicy,
): Promise<ContractEntry>;
export async function enterMutation(
  refusal: string | typeof TRANSPORT_REFUSALS,
  policy: MutationLimitPolicy = MUTATION_RATE_LIMIT,
): Promise<MutationEntry | ContractEntry> {
  const user = await sessionUserOrNull();
  if (!user) {
    return typeof refusal === 'string'
      ? { ok: false, error: refusal }
      : { ok: false, reason: TRANSPORT_REFUSALS.noSession };
  }

  const limit = await checkMutationLimit(user.userId, policy);
  if (!limit.allowed) {
    return typeof refusal === 'string'
      ? { ok: false, error: RATE_LIMITED }
      : { ok: false, reason: TRANSPORT_REFUSALS.rateLimited };
  }
  if (limit.reason === 'limiter-error') {
    // A permanently-dead fail-open limiter is otherwise completely silent.
    Sentry.addBreadcrumb({
      category: 'rate-limit',
      level: 'warning',
      message: 'mutation limiter unavailable',
    });
  }

  return { ok: true, userId: user.userId };
}
