import 'server-only';

import {
  householdScopeForRequest,
  type HouseholdScope,
  membershipHousehold,
  schema,
  type Membership,
} from '@mat-plan/db';
import * as Sentry from '@sentry/nextjs';
import { and, eq, isNull } from 'drizzle-orm';
import { cache } from 'react';

import { db } from './db';
import { getCurrentUser } from './session';

/**
 * **THE household scope point (TEN-1).** The one place in the repo that DERIVES a household for a
 * request; everything else is handed the result.
 *
 * ## How it resolves — FIVE outcomes, since `AUTH-1` 1c-4
 *
 * It reads the **principal**, then that principal's membership. It never counts households.
 *
 * ```sql
 * SELECT household_id FROM household_members
 *   INNER JOIN households ON households.id = household_members.household_id
 *  WHERE clerk_user_id = $1 AND household_members.deleted_at IS NULL
 *    AND households.deleted_at IS NULL
 *  LIMIT 2
 * ```
 *
 * | #   | condition                       | answer                                                     |
 * | --- | ------------------------------- | ---------------------------------------------------------- |
 * | A   | one live membership             | that household's scope                                     |
 * | B   | no principal                    | `null`, **silently** — 1c-3b refused that caller upstream   |
 * | B′  | `household_members` missing     | `null` + `scope_outcome: schema_missing` (`42P01`/`42703`)  |
 * | C   | principal, no live membership   | `null` + `scope_outcome: no_membership`                     |
 * | D   | principal, **two** memberships  | **THROW** — "pick one" is a silent cross-wire               |
 *
 * ⚠️ **This block used to describe the pre-AUTH-1 algorithm as current** — `SELECT id FROM
 * households … LIMIT 2`, with *"ZERO rows → a genuinely empty database"* and *"TWO rows → THROW"*.
 * None of that is true now: zero means **this account has no membership**, which is the common case,
 * and nothing throws on a second live household (two of them is the intended Beta 0 end state once a
 * family is invited). `liveHouseholdIds` survives for `db:verify` and one fixture script only.
 *
 * ⚠️ **The `LIMIT 2` exists to DETECT ambiguity. `rows[0]` must NEVER be read as a pick.** *"Just use
 * the first one"* is exactly the edit a later author makes to "fix" a dark app, and it is a silent
 * cross-wire between two families. There is deliberately **no `ORDER BY`**: there is no correct
 * ordering, because there is no correct answer.
 *
 * ⚠️ **`null` and the throw must not share a path.** Returning `null` for D too would map an
 * invariant violation onto the unknown-profile path, which renders the picker's empty state — so
 * *"the server cannot tell whose data this is"* would reach the operator as *"your data does not
 * exist"*, with a production write as the suggested remedy. A Sentry message is loud to a dashboard;
 * the empty state is what a parent reads on a gym floor at 6:30pm.
 *
 * ⚠️ **And a state-C fallback to "the one live household" must never be written.** It would
 * reinstate exactly the widening 1c-4 removed, which is what made `1d` safe.
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
 * ## What `AUTH-1` 1c-4 changed
 *
 * **Only this function's body** — session → `household_members` → household. No page, action or
 * Route Handler signature holds a scope, so nothing else moved, which is the whole reason the seam
 * landed before its consumers.
 *
 * ⚠️ **`queries/household-scope.ts` did NOT go with it**, contrary to what that module and this
 * docblock both said until 1c-4. `liveHouseholdIds` survives for two script consumers — the
 * screenshot harness's fixture scope and `db:verify` section 0 — neither of which is a request.
 *
 * 🔴 **This is what makes `1d` safe.** Before it, a session proved only *that* you are someone the
 * Clerk instance admits; the household came from "whichever one is live". Deleting the access gate
 * at that point would have widened access rather than narrowing it. From here a session proves
 * **whose** data you get, which is the property `1d` removes the gate against.
 */
export const getHouseholdScope = cache(async (): Promise<HouseholdScope | null> => {
  // (B) No principal. SILENT: 1c-3b already refused this caller at all twelve entry points, so by
  // the time anything calls this with no session the refusal has happened and a Sentry message would
  // be noise on a path that is working as designed.
  const user = await getCurrentUser();
  if (!user) return null;

  // Single-sourced in `packages/db/src/queries/household-membership.ts` so `db:verify` proves THIS
  // query — both `deleted_at` conjuncts, and the LIMIT 2 ambiguity probe — against a real database.
  let rows: Membership[];
  try {
    rows = await membershipHousehold(db, user.userId);
  } catch (error) {
    // (B′) The table is not there yet: a deploy that beat migration `0019`, or a preview on an
    // un-migrated database. `null` rather than a throw, for the same reason zero households is
    // `null` — a schema that has not caught up is a deployment state, not a fault — and the cause
    // rides `scope_outcome` to a dashboard instead of a line on a family's screen.
    //
    // 🔴 **MATCH THE CODE, RETHROW EVERYTHING ELSE.** A bare `catch { return null }` would map
    // `ECONNREFUSED`, pool exhaustion and a statement timeout onto "no household for this account",
    // so during a database outage the real family reads *"Nothing is linked to this account"* and
    // the operator goes looking for a membership problem.
    //
    // ⚠️ **The code is on `error.cause`, not on `error`** — drizzle wraps the driver's error. A test
    // that fabricates `{ code: '42P01' }` on the error itself passes while production rethrows, which
    // is a `42P01` on every route: the total outage this branch exists to prevent.
    if (!isSchemaMissing(error)) throw error;
    // ⚠️ **FIXED MESSAGE AND TAG ONLY — never the error, never `extra`.** The caught error is a
    // `DrizzleQueryError` whose message embeds `params:`, and the param here IS the Clerk user id.
    // `scrubSentryEvent` has no allowlist for hand-built contexts; the DAL does not rely on it.
    if (!schemaMissingReported) {
      schemaMissingReported = true;
      Sentry.captureMessage('household scope unresolved: membership schema missing', {
        level: 'error',
        tags: { scope_outcome: SCOPE_OUTCOME.schemaMissing },
      });
    }
    return null;
  }

  // (A) The only resolvable answer.
  // 🔴 **The role rides the SAME row as the id (PROF-1 b-s).** `membershipHousehold` selects both,
  // so there is no second lookup to forget a `deleted_at` conjunct on and no TOCTOU window between
  // reading the role and the write it authorizes — see that query's docblock for the soft-deleted
  // `owner` row that makes this a safety property rather than a saved round trip.
  if (rows.length === 1) return householdScopeForRequest(rows[0].householdId, rows[0].role);

  if (rows.length === 0) {
    // (C) A principal with no membership — THE state this chunk makes reachable by a person. Five
    // causes share one screen (`NO_HOUSEHOLD_COPY`) on purpose, because telemetry carries the cause;
    // so this needs its OWN outcome, or "the maintainer is locked out before the claim correction"
    // and "somebody signed in with the wrong Google account" are the same dashboard row.
    //
    // The fixed message and the tag are the WHOLE payload — no count, no ids, and above all not the
    // Clerk user id (ADR 0006 obligation 3: a requester→owner mapping at a third party is the
    // cross-tenant linkage the owning household id is forbidden for).
    if (shouldReportUnresolved(user.userId, SCOPE_OUTCOME.noMembership)) {
      Sentry.captureMessage('household scope unresolved: principal has no live membership', {
        level: 'warning',
        tags: { scope_outcome: SCOPE_OUTCOME.noMembership },
      });
    }
    return null;
  }

  // (D) ≥2 live memberships for one principal. Loud on purpose: "pick one" is a silent cross-wire
  // between two families, and the empty state would misreport it as "your data does not exist".
  //
  // ⚠️ **Unreachable in production, and that is a property of a constraint rather than of this
  // code**: `uq_household_members_clerk_user` is partial-unique on `clerk_user_id` alone. Its test
  // mocks the query — an implementer trying to construct the row will not manage it. Its blast
  // radius is now PER-PRINCIPAL: this account gets `error.tsx` everywhere, everyone else is fine.
  throw new Error(
    'household scope is ambiguous: this account holds more than one live membership, so the ' +
      'server cannot tell whose data it holds',
  );
});

/**
 * 🔴 **Why the resolver's own `scope_outcome` values are a const (AUTH-1 1c-4).**
 *
 * They were two inline literals — `'no_household'` for zero live households and nothing else, since
 * every other path either resolved or threw. ⚠️ **Count carefully, because two different counts are
 * in play:** the resolver has **five outcomes** (A resolve · B no principal · B′ schema missing · C
 * no membership · D throw) and exactly **two of them emit a tag**, which is what this map holds. A
 * resolves, B is silent by design (1c-3b refused that caller upstream) and D throws. `no_membership`
 * is the one a PERSON now reaches: an invited parent whose account was never linked, the wrong
 * Google account, or the maintainer before the claim correction.
 *
 * `constants.ts`'s `NO_HOUSEHOLD_COPY` argues that all of those causes deliberately share ONE screen
 * **because the telemetry carries the cause**. That argument is only true if the telemetry actually
 * distinguishes them — a single `no_household` for both "the database is empty" and "this account
 * has no membership" collapses a deployment fault and a per-person one into the same dashboard row,
 * and `runbooks.md`'s triage keys on this field.
 *
 * ⚠️ **No value here ever carries an identifier.** The tag is the whole payload; the Clerk user id
 * must not reach Sentry (ADR 0006 obligation 3).
 */
export const SCOPE_OUTCOME = {
  /**
   * A principal with no live membership. THE state 1c-4 makes person-reachable.
   *
   * ⚠️ **`no_household` is RETIRED at 1c-4 and is deliberately absent from this map.** The resolver
   * no longer counts households, so nothing can emit it — and a member nothing can produce is a
   * state a reader will believe in. An event carrying it in Sentry is therefore pre-1c-4, which is
   * the one fact an operator triaging an old alert needs. (It lives in this member's doc rather than
   * its own block above: two consecutive JSDoc blocks attach only the second, so the note was
   * invisible at the hover that is the one place a reader meets it.)
   */
  noMembership: 'no_membership',
  /** `household_members` is not there: a deploy ahead of `0019`, or an un-migrated preview. */
  schemaMissing: 'schema_missing',
} as const;

/** The two values this map can emit — the type `shouldReportUnresolved` keys its bound on. */
export type ScopeOutcome = (typeof SCOPE_OUTCOME)[keyof typeof SCOPE_OUTCOME];

/**
 * 🔴 **BOUNDED, per principal — the bound `session.ts` already called "the `scope_outcome`
 * precedent" while this path did not have one.**
 *
 * States B′ and C are reachable on every **page read**, and page reads are not rate-limited at all
 * (`checkMutationLimit` covers the seven mutating actions). So one signed-in account with no
 * membership looping `GET /p/<id>` emits an unbounded stream — a Sentry-quota drain anyone admitted
 * by the Clerk instance can pull, and worse than the cost: a flood of `no_membership` is what buries
 * the `cross_household` event ADR 0006 obligation 3 exists to make noticeable. At `1d`, the chunk
 * this one unblocks, "admitted by the instance" is the only requirement left.
 *
 * ⚠️ **Per principal rather than once per process**, which is the whole argument for giving C its own
 * outcome: once-per-process would hide the second affected family behind the first. ⚠️ **What that
 * buys is a COUNT, not an identity** — the payload is a fixed message and one tag, so two
 * principals' events are byte-identical and group into one Sentry issue. Keying per principal means
 * the event count tracks how many accounts are unresolved; it cannot tell the operator *which*, and
 * nothing here may (ADR 0006 obligation 3). `REPORT_CAP` bounds the set itself, so a loop over many
 * accounts cannot grow it without limit, and an attacker holding one account burns one slot rather
 * than every slot. Reaching the cap **emits once**, so the blackout that follows is visible rather
 * than inferred from silence.
 *
 * 🔴 **`schema_missing` is NOT in that budget, and sharing one was a starvation path.** B′ means
 * `household_members` is absent — a deploy ahead of migration `0019`: **production is dark for
 * everyone**, not one person. Keyed per principal it was wrong in both directions — up to 100
 * identical events for one outage, then none — and, sharing a never-evicted cap with the
 * attacker-fillable C, 100 distinct no-membership principals could **silence that alarm for the life
 * of the process**. The cheap hostile signal must not starve the expensive operator-critical one, so
 * B′ gets `session.ts`'s shape instead: one boolean, once per process, which is the right shape for
 * a deployment-wide condition anyway.
 *
 * 🔴 **`reportScopeMiss`'s `no_scope` rides the SAME bound, and leaving it out made this docblock
 * claim more than the code did.** The loop above emits `no_membership` once — and then, on a
 * profile-addressed request, `profiles.ts`'s null-scope branch emitted one **uncapped**
 * `profile scope miss: no_scope` per request, so the stream this bound exists to stop survived under
 * a different value. `cross_household` and `unknown_resource` stay **uncapped on purpose**: those
 * two ARE the signal ADR 0006 obligation 3 exists to raise, and `runbooks.md`'s *"more than 3 events
 * in 1 hour"* rule is written against them.
 *
 * The ids stay in **process memory only**: never logged, never emitted (the tag is still the whole
 * payload), and gone on the next deploy. Deliberately the plaintext id rather than a digest — the
 * request already holds it, `reportedUnresolved` is module-private and unexported, and a hash would
 * add a second representation of the same identifier to reason about for no change in what is
 * retained.
 */
const REPORT_CAP = 100;
const reportedUnresolved = new Set<string>();

/** B′ is deployment-wide, so it is once per PROCESS — `session.ts`'s shape, not a per-principal key. */
let schemaMissingReported = false;

function shouldReportUnresolved(
  userId: string | null,
  outcome: ScopeOutcome | ScopeMissOutcome,
): boolean {
  // No principal collapses to once per process, which is correct rather than a compromise: there is
  // nothing to tell two anonymous callers apart by, and 1c-3b refuses them upstream anyway.
  const key = `${outcome}:${userId ?? 'anonymous'}`;
  if (reportedUnresolved.has(key)) return false;
  if (reportedUnresolved.size > REPORT_CAP) return false;
  reportedUnresolved.add(key);
  // The cap's own event, so an operator sees the blackout start instead of inferring it from
  // silence. It takes the last slot, which is why the comparison above is `>` and not `>=`.
  if (reportedUnresolved.size > REPORT_CAP) {
    Sentry.captureMessage('household scope unresolved: per-principal report cap reached', {
      level: 'warning',
      tags: { scope_outcome: 'report_cap_reached' },
    });
    return false;
  }
  return true;
}

/**
 * Postgres codes that mean "the schema has not caught up", and nothing else.
 *
 * `42P01` undefined_table · `42703` undefined_column. Deliberately NOT a catch-all: every other code
 * — a connection failure, pool exhaustion, a statement timeout, `42501` insufficient_privilege —
 * must propagate, or a database outage renders as *"Nothing is linked to this account"* to the one
 * family that does have data.
 */
const SCHEMA_MISSING_CODES = new Set(['42P01', '42703']);

/**
 * ⚠️ **The code is on `error.cause`, not on `error`.** drizzle wraps the driver's error in a
 * `DrizzleQueryError`; reading `error.code` finds nothing and this returns `false`, which rethrows —
 * so the failure mode of getting this wrong is a `42P01` on every route rather than a silent
 * mis-classification. A test must therefore be built on a REAL wrapped error, not a fabricated
 * `{ code }`, or it passes while production is down.
 *
 * This is the repo's first pg-error-code check: TEN-2d deleted the only other one, and
 * `isUniqueViolationOn` was never written. Later ones should follow this shape.
 */
function isSchemaMissing(error: unknown): boolean {
  const e = error as { cause?: { code?: unknown }; code?: unknown } | null;
  // `cause` FIRST, then the error itself. pg puts the code on the error it throws; drizzle wraps
  // that in a `DrizzleQueryError` whose `cause` is the pg error — so the live shape is `.cause.code`
  // and the bare shape is what a caller sees if it ever reaches here unwrapped. Reading only `.code`
  // finds nothing in production; reading only `.cause.code` misses the unwrapped case.
  const code = e?.cause?.code ?? e?.code;
  return typeof code === 'string' && SCHEMA_MISSING_CODES.has(code);
}

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
  /**
   * AUTH-1 1c-3b: there IS a principal now, so the label says so. 🔴 **A constant, never the id.**
   * The obvious "improvement" — putting the requester's Clerk id here — is the same cross-tenant
   * linkage the owning-household id is forbidden for two lines above, and it would be a new flow of
   * personal data to a third party. The outcome already says whether a scope existed; who asked is
   * not what this event is for.
   */
  actor: 'clerk_session';
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
      actor: 'clerk_session',
      action: args.action,
      resource: args.profilePublicId,
      outcome,
    };

    // 🔴 **`no_scope` is BOUNDED per principal; the other two are not.** A signed-in account with no
    // membership reaches this on every profile-addressed request, so an uncapped `no_scope` is the
    // same quota drain the resolver's own captures are bounded against — and the thing it buries is
    // `cross_household`, which is why that one and `unknown_resource` are never capped.
    if (
      outcome !== SCOPE_MISS_OUTCOME.noScope ||
      shouldReportUnresolved((await getCurrentUser())?.userId ?? null, outcome)
    ) {
      Sentry.captureMessage(`profile scope miss: ${outcome}`, {
        level: outcome === SCOPE_MISS_OUTCOME.crossHousehold ? 'warning' : 'info',
        tags: { scope_outcome: outcome, scope_action: event.action },
        contexts: { scope_miss: { ...event } },
      });
    }
  } catch {
    // Constraint 4. A `DrizzleQueryError` here embeds query params (SEC-3), and a telemetry probe
    // must never turn a 404 into a 500. Deliberately silent: the next miss emits again.
  }
}
