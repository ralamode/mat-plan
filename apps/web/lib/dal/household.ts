import 'server-only';

import {
  householdScopeForRequest,
  type HouseholdScope,
  liveHouseholdIds,
  schema,
} from '@mat-plan/db';
import * as Sentry from '@sentry/nextjs';
import { and, eq, isNull } from 'drizzle-orm';
import { cache } from 'react';

import { db } from './db';

/**
 * **THE household scope point (TEN-1).** The one place in the repo that DERIVES a household for a
 * request; everything else is handed the result.
 *
 * ## How it resolves, before AUTH-1
 *
 * There is no principal yet — the access gate is a shared code, not an identity — so the scope is
 * *"the one live household, and nothing if that is ambiguous"*:
 *
 * ```sql
 * SELECT id FROM households WHERE deleted_at IS NULL LIMIT 2
 * ```
 *
 * - **exactly one row** → that household.
 * - **ZERO rows** → `null`. A genuinely empty database; the picker's empty state is the honest
 *   answer, and a Sentry **message** (not an exception — an empty database is not a server fault)
 *   records that it happened. The payload is the fixed message plus `scope_outcome`, and
 *   deliberately carries **no count, no id and no name**, so SECURITY.md → Logging is satisfied by
 *   construction rather than by judgement.
 * - **TWO rows** → **THROW**. The server cannot tell whose data it holds. That is an unexpected
 *   server state, not a user error, so `write-path.md` invariant 4 routes it to a throw →
 *   `error.tsx` + a Sentry exception with a stack.
 *
 * ⚠️ **The `LIMIT 2` exists to DETECT ambiguity. `rows[0]` must NEVER be read as a pick.** *"Just use
 * the first one"* is exactly the edit a later author makes to "fix" a dark app, and it is a silent
 * cross-wire between two families. There is deliberately **no `ORDER BY`**: there is no correct
 * ordering, because there is no correct answer.
 *
 * ⚠️ **Zero and ≥2 must not share a path.** Returning `null` for both would map an invariant
 * violation onto the unknown-profile path, which renders the picker's empty state — so *"the server
 * cannot tell whose data this is"* would reach the operator as *"your data does not exist"*, with a
 * production write as the suggested remedy. A Sentry message is loud to a dashboard; the empty state
 * is what a parent reads on a gym floor at 6:30pm.
 *
 * It does **NOT** select `households.synthetic` — that column ships dark until OBS-2, and reading it
 * here would make a deploy that lands ahead of migration 0014 a `42703` on every route (the plan's
 * §Design 1a).
 *
 * ## Why `cache()`
 *
 * `catalog.ts` is the established precedent for request-memoised reference reads in this repo, and it
 * is already exercised from Server Actions. One page request fans out to ~11 DAL calls (the Today
 * page alone makes three in one `Promise.all`); without `cache()` that is 11 identical 2-row queries.
 *
 * **And `cache()` is safe even where it does not memoise** (the export Route Handler, say): the
 * function is deterministic for the request, so a miss costs **one extra 2-row query and never a
 * different answer**. `cache()` here is a performance device, not a correctness device — which is
 * precisely why it is acceptable on the *resolution* half while the *propagation* half is
 * compiler-checked by `isLiveProfile`'s required parameter.
 *
 * ## What AUTH-1 changes
 *
 * **Only this function's body** — session → `household_members` → household. No page, action or
 * Route Handler signature holds a scope, so nothing else moves.
 */
export const getHouseholdScope = cache(async (): Promise<HouseholdScope | null> => {
  // Single-sourced in `packages/db/src/queries/household-scope.ts` so `db:verify` proves THIS
  // query — including that a soft-deleted household stops resolving — against a real database.
  const rows = await liveHouseholdIds(db);

  if (rows.length === 1) return householdScopeForRequest(rows[0].id);

  if (rows.length === 0) {
    // Not an exception: an empty database is a deployment state, not a fault. The fixed message and
    // the `scope_outcome` tag are the WHOLE payload — no count, no ids, no names.
    Sentry.captureMessage('household scope unresolved: no live household', {
      level: 'warning',
      tags: { scope_outcome: 'no_household' },
    });
    return null;
  }

  // ≥ 2 live households before AUTH-1. Loud on purpose: "pick one" is a silent cross-wire, and the
  // empty state would misreport this as "your data does not exist".
  throw new Error(
    'household scope is ambiguous: more than one live household exists before AUTH-1, so the ' +
      'server cannot tell whose data it holds',
  );
});

/**
 * The two answers `householdState()` can give. Hoisted rather than inlined so the page and the tests
 * compare against the same symbol — the `SCOPE_MISS_OUTCOME` idiom forty lines below, and
 * AGENTS.md → "Constants, enums & shared values" ("tests use the same constant as the app").
 */
export const HOUSEHOLD_STATE = { none: 'none', resolved: 'resolved' } as const;
export type HouseholdState = (typeof HOUSEHOLD_STATE)[keyof typeof HOUSEHOLD_STATE];

/**
 * AUTH-1 1c-2 — **does this request resolve a household, without handing out the scope?**
 *
 * The picker needs to tell "no household" from "a household with no athletes yet", and today it
 * cannot: `listProfiles` returns `[]` for both (`if (!scope) return []`), so both land on
 * `PICKER_EMPTY_COPY` — which tells a signed-in parent to change this deployment's seed data.
 *
 * 🔴 **A boolean in the DAL, not a branch in the page.** The obvious patch is to have `p/page.tsx`
 * call `getHouseholdScope()` — but that puts a `HouseholdScope` in `app/`, breaking
 * `write-path.md` invariant 2 and promise 2. This returns **no scope**, so the capability never
 * leaves the DAL, and it rides the same `cache()`d resolver above, so it costs no extra query.
 * `packages/db/src/scope.test.ts` fails the build if a page or component names the resolver.
 *
 * ⚠️ **Deliberately COARSER than the causes it collapses**, and that is not laziness: five causes
 * have one honest screen between them (see `NO_HOUSEHOLD_COPY`), and the ones that differ for the
 * maintainer are carried by `scope_outcome` in Sentry and by the runbook. Widening this union to put
 * a cause on screen is how a family gets told something only an operator can act on. If you need the
 * cause, read the telemetry — `getHouseholdScope()` already tags it. (The resolver has **three**
 * outcomes — scope, `null`, throw; the five are the causes that collapse into `null`.)
 *
 * 🔴 **Callers must establish a PRINCIPAL first** (`requireSession()` / `sessionUserOrNull()`).
 * Today `'none'` is a property of the deployment; after 1c-4 it is a property of the requester, and
 * it absorbs *no session* and a missing `household_members` table too (the plan's § Design 3.2, B
 * and B′). A sessionless caller would therefore be shown a wrong-Google-account explanation — the
 * exact class of wrong-audience copy this screen exists to delete. `p/page.tsx` is safe because
 * 1c-3 puts `requireSession()` ahead of this call; any NEW call site owes the same ordering.
 *
 * ⚠️ **The plan placed this in `lib/dal/session.ts`** (`auth-1-clerk-google.md` § file table). It
 * lands here instead because at 1c-4 `household.ts` imports `getCurrentUser` from `session.ts`
 * (§ Design 3.1), so the reverse import would make the two modules a cycle — a cost the plan did not
 * price. It is also a pure projection of the resolver directly above it, which is the
 * `catalog.ts` / `household.ts` "resolver and its satellites together" shape § Design 2 argues for.
 */
export async function householdState(): Promise<HouseholdState> {
  return (await getHouseholdScope()) ? HOUSEHOLD_STATE.resolved : HOUSEHOLD_STATE.none;
}

/**
 * What a scope miss was, as the event records it. **Three values, because two would lie.**
 *
 * With no resolvable scope *every* lookup misses and the unscoped re-resolve below *finds* the row —
 * so a naive implementation would emit `cross_household` for every legitimate request against an
 * empty database. `no_scope` is that state; `unknown_resource` is an id that exists nowhere.
 */
const SCOPE_MISS_OUTCOME = {
  crossHousehold: 'cross_household',
  unknownResource: 'unknown_resource',
  noScope: 'no_scope',
} as const;

type ScopeMissOutcome = (typeof SCOPE_MISS_OUTCOME)[keyof typeof SCOPE_MISS_OUTCOME];

/** The actions that can miss. One string per surface, so a rate alert can key on it. */
export const SCOPE_MISS_ACTION = {
  resolveProfile: 'resolve_profile',
} as const;

export type ScopeMissAction = (typeof SCOPE_MISS_ACTION)[keyof typeof SCOPE_MISS_ACTION];

/**
 * The event's payload, **exhaustively typed**. `Required<…>` is the point: a field added to this
 * shape is a compile error until every builder decides it, which is the `SENTRY_DATA_COLLECTION`
 * idiom in `lib/sentry-scrub.ts`.
 *
 * ⚠️ **What it must never carry**, each for its own reason:
 * - **a profile name or any logged value** — SECURITY.md: kid bodyweight is privileged, never logged;
 * - **any `DrizzleQueryError`** — SEC-3's scar: its message embeds query params and has already
 *   shipped a kid's bodyweight to Sentry once. The probe below therefore catches its own errors.
 *   `lib/sentry-scrub.ts` strips denied headers and anything named `params`, but it has **no
 *   allowlist for hand-built contexts**, so a later `setContext({ name })` here would ship a child's
 *   name to a third party unscrubbed;
 * - **the OWNING household's id** — a requester→owner mapping in a third-party store is a
 *   cross-tenant linkage over minors' health data. The *requester's* scope is not named either; the
 *   outcome already says whether one existed.
 */
type ScopeMissEvent = Required<{
  /** Pre-AUTH-1 there is no principal: the gate is a shared code. AUTH-1 replaces this with a user. */
  actor: 'gate_session';
  action: ScopeMissAction;
  /** The PUBLIC id the request asked for — already in the URL the caller sent. Never an internal id. */
  resource: string;
  outcome: ScopeMissOutcome;
}>;

/**
 * **ADR 0006 obligation 3** — the structured cross-household event, on the miss path only.
 *
 * A single scoped predicate (`public_id ∧ deleted_at IS NULL ∧ household_id = scope`) returns "no
 * row" for both *"unknown id"* and *"exists elsewhere"*, so the server **cannot tell them apart** —
 * and the #1 risk in the threat model becomes the one event that produces no signal. ADR 0006's
 * answer: on a miss, re-resolve the public id **without** the household conjunct and emit one
 * structured event. **Externally the answer is still 404**, byte-identical to an unknown id.
 *
 * ## The five constraints that make this an event rather than noise or a leak
 *
 * 1. **It is emitted from ONE site** — `getProfileByPublicId` in `lib/dal/profiles.ts`, the single
 *    resolve point all 11 profile-addressed entry points funnel through. Not from the predicate
 *    (which lives in `packages/db` and must do no IO and hold no request context), and not by
 *    re-resolving at 11 call sites. On a miss every entry point returns before resolving a second
 *    time — including the export route, which 404s before `buildExportEntries` re-resolves — so
 *    "emit once per request" falls out of the call graph rather than depending on `cache()`
 *    memoising, which it may not in a Route Handler.
 * 2. **The probe runs identically for both miss reasons.** A different code path (or an awaited
 *    flush) only in the `cross_household` case would be a measurable per-request timing oracle on
 *    exactly the case an attacker is probing for. Nothing here awaits a Sentry flush.
 * 3. **It returns `void`, never a row.** This is a `lib/dal` read that reaches `db` with **no
 *    scope** — the one thing 1d's structural guard exists to fail. It is allowlisted *here*, with
 *    this reason beside it, and returning `void` means the allowlisted unscoped read cannot be
 *    copied into something that returns data.
 * 4. **It swallows its own failures.** A driver error from the probe must not become the request's
 *    error, and must not reach Sentry carrying `params:` (SEC-3).
 * 5. **The payload is built in one place** against an exhaustive type — see `ScopeMissEvent`.
 *
 * ## Who consumes it
 *
 * `docs/runbooks.md` → "A cross-household scope miss" carries the alert rule. The ADR justifies the
 * event as what makes rate-limiting id probing possible; `lib/rate-limit.ts` deliberately does not
 * limit the mutating actions yet, so **the limiter is AUTH-1's** (it re-keys from IP to user id) and
 * the alert is the consumer today.
 */
export async function reportScopeMiss(args: {
  action: ScopeMissAction;
  profilePublicId: string;
}): Promise<void> {
  try {
    const scope = await getHouseholdScope();
    // The ALLOWLISTED UNSCOPED READ. Existence only — `limit(1)` over `public_id`, selecting a
    // literal rather than a column, so nothing about the row can be returned or logged.
    const [found] = await db
      .select({ exists: schema.profiles.publicId })
      .from(schema.profiles)
      .where(
        and(eq(schema.profiles.publicId, args.profilePublicId), isNull(schema.profiles.deletedAt)),
      )
      .limit(1);

    const outcome: ScopeMissOutcome = !scope
      ? SCOPE_MISS_OUTCOME.noScope
      : found
        ? SCOPE_MISS_OUTCOME.crossHousehold
        : SCOPE_MISS_OUTCOME.unknownResource;

    const event: ScopeMissEvent = {
      actor: 'gate_session',
      action: args.action,
      resource: args.profilePublicId,
      outcome,
    };

    Sentry.captureMessage(`profile scope miss: ${outcome}`, {
      level: outcome === SCOPE_MISS_OUTCOME.crossHousehold ? 'warning' : 'info',
      tags: { scope_outcome: outcome, scope_action: event.action },
      contexts: { scope_miss: { ...event } },
    });
  } catch {
    // Constraint 4. A `DrizzleQueryError` here embeds query params (SEC-3), and a telemetry probe
    // must never turn a 404 into a 500. Deliberately silent: the next miss emits again.
  }
}
