# AUTH-1 — Clerk, Google, invitation-only

> Backlog: [plan.md](../plan.md) row **AUTH-1**. Milestone:
> [beta-1.md](../milestones/beta-1.md) § 3 (Beta 0, step 3).
> This plan ships on `docs/auth-1-clerk-plan`; the implementing chunks get
> `feat/auth-1a-clerk-wired` … `feat/auth-1d-retire-the-gate`.
>
> **Plan only. No implementation code, no migration file, no Clerk dependency is added by this PR.**
>
> ⚠️ **Citations in this document are `path:symbol`, not `path:line`.** TEN-1's last two chunks are
> open as **#268** (`feat/ten-1c-dal-2-tail`) and **#269** (`feat/ten-1d-guards-and-verdict`) and
> moved under this plan while it was being written; `docs/plans/ten-1-household-scope.md` → "1d as
> built" had to re-find three predicates by symbol for exactly this reason. Everything below that
> describes TEN-1 behaviour was read from the **1d branch**, which is stated at each claim.

## Goal

Replace one shared access code with per-person identity, so that a household's data is reachable only
by a person who proved who they are — and so that the access that was granted to "whoever has the
code" can be revoked from one person without rotating for everyone. This is the PR that makes
**`getHouseholdScope()` resolve a principal** instead of counting rows, which is what turns TEN-1's
_consistent scoping_ into _authorized isolation_. It is Beta 0's step 3 and the last thing between the
milestone and step 4's self-serve work.

It is also the one change in Beta 0 where the failure mode is not "a bug" but "the app is either dark
or open". So the shape of this plan is dictated less by what Clerk needs than by **never having a
window in which neither the gate nor the session is the boundary** — which is why the gate and the
session are deliberately enforced _together_ for the span of two chunks, and why the gate is deleted
last rather than first.

## Acceptance

**Verbatim, [plan.md](../plan.md) → AUTH-1:**

> **Narrowed the same day for [Beta 0](./milestones/beta-1.md): Google only, via Clerk, sign-up
> invitation-only; Ray's existing household is claimed by a guarded correction before the gate goes; a
> `household_members` table; every entry point rejects a caller with no session. Facebook waits for a
> tester to ask.** Replaces the shared access code with per-person identity.

**Verbatim, [beta-1.md](../milestones/beta-1.md) → Beta 0 exit criteria (the two AUTH-1 rows):**

> - [ ] Every action, page and route handler rejects a caller with no session; a profile outside the
>       session's household is a 404; per-user data is never cached across users (AUTH-1).
> - [ ] An uninvited Google account cannot create a household. Ray's existing household is reachable
>       after he signs in, and only by him.

**Done when — observable:**

1. `pnpm --filter web test` contains a test that **enumerates every exported function of every
   `'use server'` module in `apps/web/app` from the filesystem** and fails if one does not require a
   session. Adding a new action without the check is a red build, not a review miss. (This is a new
   test, not an extension — see § "What `beta-1.md` § 3 calls the export-enumeration test".)
2. `apps/web/lib/dal/household.ts:getHouseholdScope` derives the household from `auth()` →
   `household_members` → `households`, and **nothing else in the repo changed shape** to make that
   true. Its diff is one function body, one new `getCurrentUser()` neighbour, and the three outcome
   states' handling.
3. Migration `0015` adds `household_members`; `pnpm db:verify` proves (a) a member resolves to
   exactly their household, (b) a user with no membership resolves to no household, (c) two members
   of two households each reach only their own, and (d) the claim correction's own dry run binds the
   household it was told to and refuses when it cannot find it.
4. `db:correct` lists a `household-claim-<date>` correction; its dry run prints the household it
   would bind and the user it would bind it to, **and writes nothing**; a second `--apply` reports 0
   rows. The **Applied** table in
   [corrections/README.md](../../packages/db/scripts/corrections/README.md) carries its date.
5. `grep -rn 'ACCESS_GATE_PASSWORD\|GATE_COOKIE_NAME\|hasGateAccess\|gateTokenFor' apps packages
.github` returns nothing outside `docs/` after chunk 1d. `apps/web/app/gate/` does not exist.
6. A signed-in user whose Google account has no membership sees a **"this account has no household"**
   screen — never the picker's _"Seed the database to get started"_, and never another household's
   data.
7. A profile `public_id` belonging to another household is **byte-identically** the 404 an unknown id
   gets, at all three surfaces, and `db:verify` proves it at the row level (it already does, from
   TEN-1 — AUTH-1 adds the session half).
8. The seven mutating Server Actions are rate-limited by **Clerk user id**; a signed-out caller never
   reaches the limiter because it never reaches the action.
9. The runbook checklist in [runbooks.md](../runbooks.md) → "AUTH-1 — the consent and dashboard
   checklist" has every box ticked with what was actually read off the Clerk and Google consoles, and
   the two "verify, do not assume" boxes record the answer found rather than the assumption.
10. [notice.md](../privacy/notice.md) and
    [data-inventory.md](../privacy/data-inventory.md) § 7 describe Clerk and Google in the **present
    tense**, merged **before** sign-in is live in production.

---

## What TEN-1 hands AUTH-1 — each promise verified against the 1d branch

`#269`'s report claims five things. Four hold. **One is over-stated, and it changes a test
obligation.** Verified by reading `git show feat/ten-1d-guards-and-verdict:<path>`.

| #     | The promise                                                                                                                   | Verdict                                     | What I found                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1** | `getHouseholdScope()` is the single place a household is derived from a request, so AUTH-1 replaces only that function's body | ✅ **holds, and is enforced**               | `apps/web/lib/dal/household.ts:getHouseholdScope` is the only request-path derivation. `packages/db/src/scope.test.ts` asserts the set of files naming `householdScopeForRequest` is exactly `{apps/web/lib/dal/household.ts, apps/web/scripts/screenshot-ephemeral.ts}` and that nothing under `apps/web/{app,lib,components}/` mints a scope. 13 callers, all in `apps/web/lib/dal/`.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **2** | No page, action or Route Handler signature holds a scope                                                                      | ✅ **holds** (one footnote)                 | True for every page, all 7 actions, the one Route Handler, and every **exported** `lib/dal` function. One module-private app function does carry one: `apps/web/lib/dal/export.ts:prescribedFor`. It crosses no boundary, and #269's body names it — but the short form of the promise does not, so read it as "no boundary carries a scope", not "no app function does".                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **3** | `isLiveProfile`'s required positional `scope` makes a missed site a compile error                                             | ✅ **holds**                                | `packages/db/src/writers/ownership.ts:isLiveProfile(profilePublicId, scope)`. `packages/db` is consumed as source (`"main": "./src/index.ts"`), so arity is a real `tsc` error under `pnpm typecheck` and CI's `Typecheck`. The one edit that would void it silently — a defaulted parameter — is itself failed by `packages/db/src/scope.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **4** | A wrong household is already byte-identically the 404 an unknown id gets (`NO_PROFILE_LOG`)                                   | ⚠️ **holds, with two measurable asterisks** | The **copy** is byte-identical and structurally so: all three surfaces map one `null` from `getProfileByPublicId` onto `notFound()` / `NO_PROFILE_LOG` / a 404 body, and `actions.test.ts:ALL_ACTIONS` asserts through the const rather than a literal. But a **miss costs one extra query a hit does not** (`reportScopeMiss`'s probe), and a **non-UUID** id short-circuits before the probe — so hit-vs-miss and malformed-vs-miss are timing-distinguishable. Cross-household vs unknown-id is **not**, which is the distinction that matters. Noted, not filed: this is the shape ADR 0006 chose knowingly.                                                                                                                                                                                                               |
| **5** | The miss-path event exists and its `cross_household` branch cannot fire today, so it is AUTH-1's boundary-test contract       | 🔴 **the "cannot fire" half is wrong**      | The branch **is narrowly reachable in production today.** `packages/db/src/queries/household-scope.ts:liveHouseholdIds` filters `households.deleted_at IS NULL`, but `reportScopeMiss`'s probe has **no household conjunct at all** — so a profile still pointing at a **soft-deleted** household, with exactly one live household remaining, yields `found && scope` → `cross_household`. The resolver only throws on ≥2 **live** households. It also already has a **mocked** unit assertion (`apps/web/lib/dal/household.test.ts` → `describe('reportScopeMiss — the miss-path event')`, 5 cases incl. `cross_household`). **So AUTH-1 does not owe "make it fire for the first time"; it owes the row-level proof in `db:verify` with two live households, which is the thing that genuinely cannot exist until this PR.** |

**Why promise 5 matters beyond pedantry.** If "it cannot fire" were true, a `cross_household` event
arriving in Sentry before AUTH-1 would be proof of a bug in the emitter. It is not: it is also the
correct report of an orphaned-by-soft-delete household. The runbook's alert rule
([runbooks.md](../runbooks.md) → "A cross-household scope miss") is written for a post-AUTH-1 world
and should say so. **Chunk 1c carries that one-line runbook correction**, because it is the chunk that
changes what `actor` means.

---

## The six questions this plan was told to settle, not dodge

### Q1 · Is a household a Clerk Organization? — **Recommendation: no, not in Beta 0.** _(The maintainer's call;_ [beta-1.md](../milestones/beta-1.md)_'s decisions table defers it here.)_

**What Organizations would genuinely buy:** email-bound invitations with native expiry and
revocation, memberships and roles maintained by the vendor, an organization switcher, and the
`org`-scoped Clerk API key `.github/SECURITY.md` → Tokens/secrets already assumes for the v3 MCP
token.

**Why the recommendation is still "not yet", in order of weight:**

1. **It does not remove the table; it only changes the key.** You cannot FK to a Clerk organization,
   and `profiles.household_id` → `households.id` is the authorization root of an 18-table schema
   ([data-inventory.md](../privacy/data-inventory.md) § 1a). So a local row per household survives
   either way, and the only question is whether membership is a column in Postgres or a claim in a
   JWT. Organizations trade one table for one column plus a vendor dependency.
2. **It makes the milestone's own deliverable unprovable.** Beta 0's exit criteria say isolation is
   proved _"by tests, not by convention"_, and the vehicle is `db:verify` on **PGlite — no Docker, no
   Postgres install, no network** (AGENTS.md → "Local hooks vs CI merge-gates"). If membership lives
   in Clerk, _"this user resolves to exactly this household"_ cannot be asserted against a database
   at all; it becomes an integration test against a third party, in the one milestone whose point is
   provable tenancy. Keeping membership in Postgres keeps the proof in the vehicle that already
   exists.
3. **Three operational procedures already assume SQL membership.** The household deletion runbook
   records Clerk user ids **from the database before the transaction**
   ([runbooks.md](../runbooks.md) → "Delete a household and everyone in it", step 0b); the deletion
   ledger "holds a household `public_id`, Clerk user ids" ([data-inventory.md](../privacy/data-inventory.md) § 8);
   and `PRIV-3` wraps that deletion in a script with a `db:verify` proof. All three need to enumerate
   a household's members without a network call.
4. **The thing Organizations are best at is not in Beta 0.** Invitations are a **Beta 1** row
   ([beta-1.md](../milestones/beta-1.md) → Beta 1: _"invites, roles, step-up"_). Beta 0 has **one
   member** — ADR 0006 states this explicitly (_"Beta has no user the path serves. Invitation-only,
   one member at AUTH-1, coaches in Beta 1"_). Adopting a tenancy model now to get a feature we will
   not build for months is paying the coupling before the benefit.
5. **Invitation-only sign-up does not need Organizations.** It is a Clerk **restrictions / allowlist**
   dashboard setting on the instance, independent of orgs — which is why `beta-1.md` § 3 files it as a
   runbook item.
6. **"Household" may become "club"** ([beta-1.md](../milestones/beta-1.md)'s decisions table defers
   the name to this plan too — see Q1b). A rename inside our own schema is a copy change; a rename
   that is also a Clerk organization migration is not.

**The cost of being wrong, stated plainly.** If Organizations turn out to be right, the correction is:
add `households.clerk_org_id` (nullable, additive), change `getHouseholdScope()`'s body a second time,
and discard a `household_members` table with one row in it. **That is one additive migration and one
function body** — the same cheapness TEN-1 bought and the reason this decision is safe to defer. The
asymmetric cost runs the other way: adopting orgs now and reversing means unwinding vendor state that
already holds a real family's membership, with no SQL record of what it was.

**What would change the recommendation:** if Clerk's instance-level sign-up restriction turns out not
to exist or not to block sign-up at the pinned version, and **organization invitations are the only
mechanism that does**, then invitation-only is only reachable through Organizations and the trade
flips. That is a vendor fact, not a judgement — it is box (b) and the new allowlist box on the runbook
checklist (§ Runbook), and chunk 1a does not merge until it is read off the console.

### Q1b · "Household" or "club"? — **Recommendation: keep `household`.** _(Also deferred here by_ [beta-1.md](../milestones/beta-1.md)_.)_

`households` is the authorization root of 18 tables and `household_members` is the first table that
would carry the name forward. The schema is generic (`households.name` is free text), so a product
rename is copy, not a migration — unless we rename the table, which expand→contract makes a
three-PR exercise for zero behaviour change. HH-1's club argument is untouched and survives; this
plan declines to spend Beta 0's budget on it.

### Q2 · The cutover — **the gate and the session are both the boundary, deliberately, for two chunks**

The premise that they "cannot both be the boundary" is the thing to reject. They compose with **AND**,
and AND is exactly what removes the window:

| State                              | Gate | Session                   | Who can reach the app                                                                         |
| ---------------------------------- | ---- | ------------------------- | --------------------------------------------------------------------------------------------- |
| today                              | ✅   | —                         | anyone with the shared code                                                                   |
| after **1a** (Clerk wired, dark)   | ✅   | wired, authorizes nothing | anyone with the shared code. Clerk can mint a session; nothing consults it.                   |
| after **1b** (table + claim, dark) | ✅   | ↑                         | unchanged. The membership row exists and nothing reads it.                                    |
| after **1c** (the boundary moves)  | ✅   | ✅                        | **the code AND a session with a membership.** Strictly narrower than either state on its own. |
| after **1d** (gate retired)        | —    | ✅                        | a session with a membership.                                                                  |

There is **no row in which neither holds**, and no row in which the weaker control is the only one.
The ordering constraint is one sentence: **the session must be enforced before the gate is deleted**,
which is why 1d cannot be merged before 1c, and why 1c is the chunk that owes the enumeration test
(it is the chunk whose completeness the whole cutover rests on).

**What happens to an in-flight session at the moment of cutover** — three cases, all of them answered
from code rather than hope:

- **At 1c's deploy.** A browser holding a valid `mp_gate` cookie and no Clerk session is redirected to
  `/sign-in` by the proxy, and every page/action/handler refuses independently. Nothing is lost: the
  cookie is one year long (`apps/web/lib/constants.ts:COOKIE_MAX_AGE`), so after signing in the caller
  passes both checks without re-entering the code. **Only the maintainer is affected**, because
  invitation-only sign-up means nobody else has an account; and the maintainer holds the code, so a
  gate re-prompt is survivable too.
- **At 1c's deploy, a form mid-submit.** A Server Action POST in flight when the new build goes live
  lands on the new code and refuses with `NO_PROFILE_LOG` through `useActionState` — the typed
  envelope, not `error.tsx`, because the session check returns the same shape the gate check already
  returns (`apps/web/app/p/[profileId]/actions.ts`, every action's first line). The user retaps. There
  is no partial write: the action refuses before the DAL.
- **At 1d's deploy.** `mp_gate` becomes inert — nothing reads it. 1d **deletes it explicitly** on the
  next response (`response.cookies.delete(GATE_COOKIE_NAME)` in the proxy, kept for one release and
  then removed) rather than leaving a year-long credential-shaped value sitting in a browser. Clerk
  sessions are untouched; a signed-in user notices nothing.

**Rollback at each boundary.** 1a/1b are inert, so reverting them is a plain revert. **1c is the only
one-way door**, and it is one-way for an operational reason rather than a code one: reverting it
restores the gate as the sole boundary, which is survivable, but the claim correction has already run,
and `household_members` has a row. Both are additive and harmless under the reverted code. **1d is
the point of no easy return** — it drops `ACCESS_GATE_PASSWORD` from env, so reverting 1d means
re-adding the secret to Vercel, GitHub Actions and `.env.local` before the revert will boot. That
asymmetry is why 1d is last and alone.

### Q3 · What PRIV-2 must land first — **a hard dependency, in two places**

`PRIV-2` (serve the notice at `/privacy` on the app's own domain) is **a merge prerequisite of chunk
1a**, not a parallel nicety. Two separate reasons, and only the first is the one usually cited:

1. **The consent screen needs a URL.** Google's OAuth consent screen and Clerk's legal-consent setting
   both take a privacy-policy URL, and `docs/runbooks.md` → "AUTH-1 — the consent and dashboard
   checklist" box (a) already records the gate: _"Point it at `/privacy` on the app's own domain —
   which means **`PRIV-2` lands first**"_, plus the "verify, do not assume" note about an unverified
   domain. A `docs/` file is not a URL a consent screen can point at; `beta-1.md`'s exit criterion
   says the same (_"**Live** means `PRIV-2` has shipped `/privacy`"_).
2. **`/privacy` must be reachable with no session, and AUTH-1 rewrites the list that makes a path
   reachable.** `apps/web/lib/access-gate.ts:PUBLIC_PATHS` is `['/'] as const` with **exact**
   membership and a test that pins its contents, and its own docblock says _"AUTH-1 inherits this list
   as 'routes that need no session'"_. If PRIV-2 lands after 1a, it has to add its entry to a list
   whose meaning is mid-migration. If it lands first, 1a inherits `['/', '/privacy']` and the Google
   console verification can be done once, before any Clerk configuration exists.

**Also sequenced before 1a, from the same source:** `PRIV-1`'s four unfilled blanks (the Neon, Sentry
and Vercel retention windows and the contact route) are `PRIV-2`'s acceptance, and
`beta-1.md`'s criterion requires the notice to ship **with no blanks**. The notice is what the consent
screen links to, so a notice with `⏳ _A permanent contact address will be published here_` in it is
not a notice a consent screen should point at.

**What AUTH-1 owes privacy in return**, and it is not optional: `notice.md` → "What is changing" and
`data-inventory.md` § 7 both describe Clerk and Google in the **future tense** and mark them _"not
wired"_. Those edits ride in **chunk 1a, the PR that adds the dependency** — not in 1d — because the
inventory's own standard is "what the running system does", and the moment `@clerk/nextjs` is in a
`package.json` deployed to production, Clerk is a processor. Checklist box (d) says "before sign-in
goes live"; 1a is the earliest honest moment and the one where the diff that makes it true is visible.

### Q4 · `SEC-6`'s seeded ids — **the rotation stays its own row; AUTH-1 must simply not depend on them**

ADR 0006 already decided this once, and it decided it the right way:

> ✅ **The seed-id rotation is filed as its own row (`SEC-6`), not folded into AUTH-1.** It is live
> today and independent of addressing, so attaching it to AUTH-1 would gate a current exposure on the
> AUTH-1 chain.

That reasoning is unchanged by the claim correction, **provided the correction does not hardcode the
household it claims.** So the design constraint is the inverse of the question: rather than AUTH-1
absorbing SEC-6, **AUTH-1 is built to be rotation-agnostic**, and the two rows can then land in either
order with no interaction.

Concretely: the claim correction takes **both** the household `public_id` and the Clerk user id from
the environment at run time (§ Design 4). It never imports `SEED_HOUSEHOLD_PUBLIC_ID`. Three reasons,
each independent:

- **`beta-1.md` § 3 forbids the alternative.** _"No code path may ever treat 'the seed household' or
  'the first sign-in' as an owner — its ids are public."_ A correction that defaults its target to
  `SEED_HOUSEHOLD_PUBLIC_ID` is a code path that treats the seed household as the thing to own.
- **It is the only form that survives SEC-6.** If the rotation lands first, a correction naming the
  constant would claim a household that no longer has that id. Taking the id at run time makes the
  order irrelevant.
- **`corrections/README.md` rule 3** requires targeting by stable `public_id`, which an operator-
  supplied id satisfies — and the dry run prints the household's `name` and profile count so the
  operator confirms the target before `--apply`, which is what makes "supplied" safe.

**The one piece of SEC-6 that AUTH-1 does touch, and must:** `apps/web/lib/rate-limit.ts`'s docblock
asserts the six mutating actions need no limiter because _"real ids are non-enumerable UUIDv7 … and
therefore unreachable by guess"_ — the false premise SEC-6 names. **Chunk 1c deletes that paragraph**,
because it is the chunk that adds the limiter and the rationale cannot survive the thing it argued
against. SEC-6 keeps the id rotation and the acceptance criterion _"no committed constant equals a live
production `public_id`"_; AUTH-1 does not claim it. If SEC-6 lands first, 1c finds the paragraph
already corrected and says so in its PR body.

### Q5 · TEN-2's window — **AUTH-1 must not ship a code path that creates household #2**

TEN-1 1d's verdict is precise about the window:

> **The leak needs two households, and nothing can serve two before AUTH-1.** `getHouseholdScope()`
> **throws** on a second live household today, deliberately … **It opens the moment household #2
> exists**, which is AUTH-1's _"a new user gets a new, empty household"_.

So the thing AUTH-1 must not do is name itself: **`beta-1.md` § 3's clause _"A new user gets a new,
empty household"_ is the clause that opens a proven cross-tenant write primitive, and this plan
recommends it leave AUTH-1.**

The argument, in three steps:

1. **Beta 0 does not need it.** There is **one** household and **one** member until step 4's invite.
   Household creation has **no existing writer to extend** — `households` rows come only from
   `packages/db/src/seed.ts` — so this is net-new code, not a conversion.
2. **Leaving it in means the control is operational, not code.** With auto-creation shipped, the only
   thing stopping household #2 is "nobody has been invited yet". `.github/SECURITY.md` already flags
   exactly this shape as the live concern it is (_"⛔ **The control that holds today is operational,
   not code**"_), and ADR 0006 turned the same fact into a **sequencing constraint** rather than a
   hope. Shipping an unreachable-by-policy creation path re-creates the thing both documents objected
   to.
3. **Taking it out closes the window in code, for free.** A signed-in user with no membership gets a
   refusal (§ Design 3, state **C**). Household #2 then comes into existence only through an operator
   action — which cannot happen before `TEN-2b`, because the operator is the person reading
   `beta-1.md`.

**Recommended amendment to `beta-1.md` § 3** _(the maintainer's call, because it edits a signed
milestone)_: move _"a new user gets a new, empty household"_ out of AUTH-1 and onto the **invite** row,
gated on `TEN-2b`. The parenthetical _"(a TEN-1 proof)"_ is already satisfied — `db:verify`'s
two-household matrix exists and ships in #266/#269; it is the **production code path** that moves, not
the proof.

**And the rest of the list, so it is a list and not one item.** Before `TEN-2b` lands, AUTH-1 must not:

- create a household from any request path (above);
- remove or weaken `getHouseholdScope()`'s ≥2-live-households throw **as a safety net** — after AUTH-1
  the resolver is session-driven and the throw is no longer the ambiguity detector, but the
  **`findOrCreateMovementId` allowlist entry in `apps/web/lib/dal/scoped.test.ts` is still standing**
  and TEN-2's dead-entry assertion is what deletes it. 1c replaces the throw with the
  no-membership refusal and **says in the PR body that the catalog leak is now gated only by TEN-2b
  and the invite**, so the transfer of that guarantee from code to schedule is recorded where a
  reviewer sees it;
- claim in any document that isolation is complete. After AUTH-1 it is complete **except the movement
  catalog**, which is proved to leak. `docs/features/write-path.md`'s invariant 2 already carries that
  carve-out in red; 1c must not tidy it.

### Q6 · How big is this really? — **four chunks, and none of the three boundaries can move**

~1,100–1,400 lines across four PRs. The boundaries are not convenience; each is "the previous thing
must be **deployed or run** before the next can be written".

| Chunk  | What                                                                                                                                                                                                                             | ~Lines | Why the boundary before it cannot move                                                                                                                                                                                                                                                            |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1a** | Clerk wired and dark: dependency, env, `clerkMiddleware` composed into `proxy.ts` behind the gate, `/sign-in`, `PUBLIC_PATHS` child-path arm, the privacy-doc tense fix                                                          | ~300   | —                                                                                                                                                                                                                                                                                                 |
| **1b** | `household_members` (migration `0015`) + the claim correction, both dark                                                                                                                                                         | ~250   | **The maintainer cannot be bound to a household until they have a Clerk user id**, and they get one by signing in — which needs 1a deployed. A correction cannot name a user that does not exist.                                                                                                 |
| **1c** | The boundary moves: `getCurrentUser()`, `getHouseholdScope()`'s new body, `requireSession` across 11 entry points, the action-enumeration test, the per-user mutation limiter, the no-membership screen                          | ~500   | **The membership row must exist in production before any code reads it.** A resolver deployed ahead of migration `0015` is `42P01` on every route — a total outage, not a dark app. TEN-1 § Design 1a paid for this hazard once already and the answer was "land the column dark, read it later". |
| **1d** | Retire the gate: delete `/gate`, `lib/dal/gate.ts`, the gate half of `access-gate.ts`, `ACCESS_GATE_PASSWORD` from env and every CI/e2e/screenshot injection; rewrite `gate-login.ts` → Clerk; rewrite `pages-are-gated.test.ts` | ~350   | **Deleting the gate before the session is enforced is the window where neither holds.** This is the whole ordering constraint of Q2.                                                                                                                                                              |

**What was folded in, so the count is honest.** An earlier shape had six chunks. Two folded:

- **the table and the correction became one PR (1b)**, because a correction merges before it runs
  (`corrections/README.md` → **Applied** _"a row lands here as `pending` and is dated in a follow-up
  commit"_), so "migration + correction, both inert, run the correction between 1b and 1c" is one PR
  and one operator action, not two PRs;
- **the rate limiter folded into 1c**, because the identifier it needs — the Clerk user id — first
  exists in 1c, and the gate's limiter (the only limiter today) is still standing until 1d, so there
  is never an unlimited window.

**What may yet split out of 1c, and the trigger:** the action-enumeration test is self-contained and
land-able on its own against the _gate_ check (it would assert `hasGateAccess`, then change one
identifier in 1c). If 1c exceeds AGENTS.md's ~400-line target, **that is the piece to lift into a
`1b-bis`** — it is the only part of 1c that does not have to be in the same commit as the resolver
swap. Named here so the split is a decision already made rather than a judgement under pressure.

---

## Design

### 1 · `getCurrentUser()` — the principal, where AGENTS.md says it goes

New `apps/web/lib/dal/user.ts`, `import 'server-only'`:

```ts
/**
 * THE principal for this request. AGENTS.md → DAL: "(1) getCurrentUser() (Clerk auth(), React
 * cache()d)". The ONE place `auth()` is called, for the same reason getHouseholdScope() is the one
 * place a household is derived: a second call site is a second place the fail-closed branch can be
 * written differently.
 *
 * FAILS CLOSED, and that is the whole contract. `auth()` throws when clerkMiddleware() did not run
 * on this request (SEC-1's lesson generalised: the matcher is not the boundary, so a route the
 * matcher misses must refuse rather than resolve). It returns null for "no session" and for
 * "`auth()` could not tell" alike, because a caller that cannot distinguish them cannot get the
 * distinction wrong.
 */
export const getCurrentUser = cache(async (): Promise<{ userId: string } | null> => { … });
```

Two properties the implementation must have, both of them AUTH-1's reason for existing:

- **`auth()` inside a `try`, `null` on throw.** Clerk's `auth()` is documented to throw when
  `clerkMiddleware()` has not run. Letting that propagate turns a matcher gap into a 500; returning
  `null` turns it into a refusal. _Fail closed_ is the exit criterion's own word.
- **`cache()`d, so one request resolves one principal.** Same precedent as
  `apps/web/lib/dal/catalog.ts` and `getHouseholdScope` itself, and the same honest caveat: `cache()`
  is a performance device here, not a correctness device.

### 2 · `requireSession()` — the one refusal, replacing `hasGateAccess()` one-for-one

New in `apps/web/lib/dal/session.ts` (or `user.ts`; placement is a 1c detail), replacing
`apps/web/lib/dal/gate.ts`'s two functions **shape-for-shape**, which is what keeps 1c mechanical:

| Today (`lib/dal/gate.ts`)                                   | 1c                                                           | Call sites                                                                                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hasGateAccess(): Promise<boolean>`                         | `hasSession(): Promise<boolean>`                             | the 7 actions' first line, and the export Route Handler (which today calls `isValidGateCookie` **directly**, not `hasGateAccess` — one of the two shapes 1c normalises) |
| `requireGatedPage(): Promise<void>` → `redirect(GATE_PATH)` | `requireSession(): Promise<void>` → `redirect(SIGN_IN_PATH)` | the 4 gated pages                                                                                                                                                       |

The refusal copy does not change. `NO_PROFILE_LOG` / `NO_PROFILE_SAVE` already carry the
one-answer-for-three-states argument (`apps/web/lib/constants.ts`), and ADR 0006 made the byte-identity
structural. **A sessionless caller gets the same refusal as a wrong household and an unknown id** —
which is now a fourth state folded into the same answer, and the reason the enumeration test asserts
through the const.

### 3 · `getHouseholdScope()` — the new body, and its three outcomes

Only the body changes (promise 1, verified). The three states are **not** the three it has today, and
getting the mapping wrong is the single most likely defect in this PR:

| #   | State                                              | Today                          | After 1c                                                                                                                                             |
| --- | -------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | resolved                                           | exactly one live household     | the session's user has exactly one live membership → that household                                                                                  |
| B   | no principal                                       | n/a                            | `getCurrentUser()` → `null`. **Return `null`.** The caller already maps `null` → the existing 404/refusal path.                                      |
| C   | a principal with **no** membership                 | n/a                            | **Return `null`, and render a DIFFERENT screen** — see below. A Sentry **message**, not an exception.                                                |
| D   | a principal with **more than one** live membership | ≥2 live households → **throw** | **Still throw.** Beta 0 has one household per person; two memberships is an invariant violation, not a choice. Multi-household belongs to `COACH-1`. |

**The trap, and it is the one the UX panel will be asked about.** Today `null` renders the picker's
empty state — _"No profiles found. Seed the database to get started."_ TEN-1's § Design 1a split zero
from ≥2 **precisely** so an invariant violation would not be reported to a parent as "your data does
not exist". AUTH-1 re-creates the same hazard in a new place: state **C** is a signed-in human with no
household, and telling them to _seed the database_ is worse than useless. So 1c owes:

- a distinct **"this account has no household"** screen, with the honest next step (contact the person
  who invited you — Beta 0 has no self-serve household creation, by Q5);
- `getHouseholdScope()` returning enough for the caller to tell **B** from **C** without widening its
  return type into a union every call site must narrow. Recommended: keep `Promise<HouseholdScope |
null>` and have the **page** ask `getCurrentUser()` for the B/C distinction — the DAL stays one
  type, and only the picker page branches. This is deliberately the smaller change; the alternative
  (a three-state return) touches 13 call sites for one screen.

**`reportScopeMiss` changes in exactly two places**, and both are typed so the compiler finds them:

- `ScopeMissEvent['actor']` is the literal type `'gate_session'`. It becomes the Clerk user id's
  presence, not the id itself — **the event must not carry the user id**: its own docblock forbids an
  owner↔requester linkage in a third-party store over minors' health data, and a requester id is the
  other half of that linkage. Recommended: `actor: 'session' | 'anonymous'`. The `Required<…>` wrapper
  makes a forgotten field a compile error, which is the idiom to keep.
- `SCOPE_MISS_OUTCOME.noScope`'s meaning moves from _"the database has no live household"_ to _"this
  principal has no membership"_. Same string, different cause; the runbook's alert rule
  ([runbooks.md](../runbooks.md) → "A cross-household scope miss") is what has to be re-read, and 1c
  carries that edit — together with the promise-5 correction (`cross_household` was reachable before
  AUTH-1, via a soft-deleted household).

### 4 · `household_members` — migration `0015`

Latest migration is `0014_household_synthetic` (`packages/db/migrations/meta/_journal.json`, 15
entries, `idx: 14`). This is `0015`, and it is **additive only** — a new table, so Squawk's
destructive rules do not engage and expand→contract has nothing to contract.

```
household_members
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY
  public_id      uuid NOT NULL UNIQUE                -- UUIDv7 from newId(); anti-IDOR, per the Keys rule
  household_id   bigint NOT NULL REFERENCES households(id)
  clerk_user_id  text NOT NULL
  role           text NOT NULL                        -- text + CHECK; NO native pgEnum (AGENTS.md)
  created_at / updated_at / deleted_at                -- the shared `timestamps` helper
  CHECK (role IN ('owner','member'))                  -- from a packages/shared const array, see below
  UNIQUE (clerk_user_id) WHERE deleted_at IS NULL     -- partial: ONE live household per person in Beta 0
  INDEX idx_household_members_household (household_id)        -- FK + hot path
  INDEX idx_household_members_clerk_user (clerk_user_id) WHERE deleted_at IS NULL   -- the resolver's path
```

Five decisions in there, each with its reason:

1. **`role` is `text` + `CHECK`, sourced from `packages/shared`.** AGENTS.md → Constants: every enum
   is an `as const` array + a zod enum + a `z.infer` type in `packages/shared`, and
   `profiles.kind`'s `profiles_kind_check` is the in-repo precedent (`packages/db/src/schema.ts`). So
   `HOUSEHOLD_ROLES = ['owner', 'member'] as const` lands in `packages/shared` and feeds the CHECK,
   the zod schema and the type. **Two values, not four**; Beta 1's `COACH-1` is a cross-household
   grant and gets its own shape, not a role string reserved in advance.
2. **`UNIQUE (clerk_user_id) WHERE deleted_at IS NULL` is the schema enforcing state D.** The resolver
   throws on ≥2 memberships; this index means the database refuses to create them. Belt and braces,
   and it is the cheaper of the two to get right. ⚠️ It is also the line `COACH-1` removes, which is
   fine — a constraint that correctly encodes "one household per person **in Beta 0**" is better than
   no constraint, and dropping a partial unique index is an additive migration.
3. **`clerk_user_id` is `text`, not a FK to anything.** There is no users table and will not be one in
   Beta 0: the person's email and Google identifier live in Clerk, which is the point of using Clerk
   (`data-inventory.md` § 7: Clerk receives _"an email address and a Google account identifier"_).
   Storing the Clerk id and nothing else is the data-minimisation answer — **no email column**, so
   the database holds no new personal data it did not hold before beyond an opaque vendor identifier.
4. **`public_id` even though nothing addresses a membership by URL yet.** AGENTS.md's Keys rule is
   unconditional, and the deletion runbook and `PRIV-3` will want a stable non-internal handle. Costs
   one column.
5. **No `consent_at` column**, deliberately. `runbooks.md`'s checklist box (c) already decided it:
   _"Beta 0 has no account table and no consent column, so **the invitation is the record**… Storing a
   consent timestamp is a Beta 1 item."_ Adding one here would be a new personal-data field with no
   consumer. **1a's notice edit must say which of those is true**, which is what box (c) asks for.

**Migration mechanics, per AGENTS.md → Database rules:** `SET lock_timeout` + `statement_timeout` at
the top; `CREATE TABLE IF NOT EXISTS`; indexes created inline with the table (a brand-new empty table
takes no meaningful lock, so `CONCURRENTLY` — which cannot run in drizzle-kit's per-file transaction
— is neither needed nor allowed here, and that is worth one comment in the SQL so a later reader does
not "fix" it). Generated by `drizzle-kit generate`, then hand-hardened, and the generated SQL is the
reviewed artifact. One migration in the PR.

### 5 · The claim correction — `household-claim-<date>`

A `Correction` entry in `packages/db/scripts/corrections/registry.ts` (interface:
`{ name, what, issue, run: (db, apply) => Promise<string[]> }`).

```
HOUSEHOLD_PUBLIC_ID=<the household to claim>  CLERK_USER_ID=<user_…>  \
  pnpm --filter @mat-plan/db db:correct household-claim-<date>            # dry run, writes nothing
… --apply
```

- **Both targets come from the environment**, never from a committed constant (Q4). The correction
  **refuses** — throws, as `bodyweightDuplicates` does when a target has moved — when either is
  absent, when `liveHouseholdScope(db, publicId)` returns `null` (rule 3's "a correction that cannot
  find its target must refuse, never guess"), or when the Clerk id does not match
  `/^user_[A-Za-z0-9]+$/`.
- **The dry run prints what it would bind**: the household's `name`, its live profile count, the role
  (`owner`), and the Clerk id **truncated** — `user_2abc…`. A Clerk user id is a stable identifier for
  a real person, and corrections rule 9 ("redact privileged values before pasting output") plus
  AGENTS.md's no-personal-names rule mean the full id must not end up pasted into a PR. The operator
  sees enough to confirm the target; the clipboard does not carry the whole identifier.
- **Guarded and idempotent by rule 2**, with existence as the from-value: `INSERT … WHERE NOT EXISTS
(SELECT 1 FROM household_members WHERE household_id = $1 AND deleted_at IS NULL)`. A second run
  reports 0. It refuses rather than overwrites if a _different_ live membership already exists —
  claiming an already-claimed household is an operator error, not a no-op.
- **`updated_at = now()`** (rule 4), **`deleted_at IS NULL`** throughout (rule 5), **one
  `db.transaction`** (rule 7), name describes the **defect** not the person (rule 10 — `household-claim`,
  which is the state being corrected: a household with no owner).
- **`issue`** points at **AUTH-1**: the cause is that no household-creation path assigns an owner, and
  the row that fixes the cause is the invite/creation work after `TEN-2b` (Q5).
- **Reviewer's note for 1b:** this correction uses `householdScopeForScript` via the registry's
  existing `liveHouseholdScope` helper — the constructor `packages/db/src/index.ts` deliberately does
  **not** re-export — so it cannot be reached from `apps/web`. No new escape hatch.

### 6 · The proxy — `clerkMiddleware` composed, and the `/api` hole it closes

`apps/web/proxy.ts` has two jobs today (the gate bounce, and the nonce CSP + headers) and **there is
no `middleware.ts`** — Next 16 renamed it. 1a composes Clerk **inside** `proxy`, keeping the CSP
pipeline exactly as it is, because the nonce plumbing (`forward()` → `x-nonce` header) is load-bearing
for `style-src 'nonce-…'` and must not be routed around.

🔴 **The matcher has to change, and this is the finding with the longest tail.** Today:

```
'/((?!api(?:/|$)|_next/static/|_next/image(?:/|$)|favicon\\.ico$).*)'
```

`/api` is **excluded entirely** — the `/api` matcher hole `.github/SECURITY.md` names as a live
concern and `docs/tech-debt.md` carries. It is latent rather than live today (the export handler is at
`/p/[profileId]/export`, deliberately, and its own docblock says so: a handler at `/api/export` would
be _"completely ungated"_). But **Clerk's `auth()` throws when `clerkMiddleware()` did not run on the
request**, so after 1a an `/api` route handler could not authenticate at all — it would 500 instead of
refusing, or, with `getCurrentUser()` failing closed, refuse every caller including a legitimate one.

So: **1a removes the `api` exclusion from the matcher**, which closes the hole as a side effect, and
the matcher change gets its own assertion in `apps/web/proxy.test.ts` → `describe('proxy matcher')`
(which already exists). ⚠️ **This must not be read as "the matcher is now the boundary"** — SEC-1's
whole lesson is that it is not, which is why `getCurrentUser()` fails closed independently and the
enumeration test checks each entry point. The matcher change is about `auth()` being _able_ to answer,
not about it being trusted.

**`PUBLIC_PATHS` gains the child-path arm its docblock already predicted:**

> when a path with children arrives (`/sign-in/callback` at AUTH-1) the arm is added together with the
> negative test that proves `/sign-inevil` stays gated.

So `isPublicPath` grows from exact membership to `p === entry || p.startsWith(entry + '/')`, with the
`/sign-inevil` negative test in `apps/web/lib/access-gate.test.ts` in the **same commit**. DUALS-1's
scar is the reason, and `access-gate.test.ts` already pins the list's contents so the addition is a
visible test edit.

### 7 · The action-enumeration test — a rewrite, not an extension

`beta-1.md` § 3 says the check is _"enforced by extending the existing export-enumeration test so a
new action without the check fails CI"_. **The test it names cannot do that job, and saying so is the
point of this section.**

`apps/web/app/p/[profileId]/use-server-exports.test.ts` → `describe("'use server' modules export only
async functions")` walks `apps/web/app`, keeps files whose source **starts with** `'use server'`, and
flags any `export ` line that is not `export (default )?async function `, `export type X` or
`export interface `. It is an **export-shape** guard (V1-9: a non-async export becomes a runtime
`ReferenceError` the build does not catch). It would pass `export async function evilAction()` with no
auth, no zod and no gate check.

The behavioural coverage is a **hand-maintained array**: `actions.test.ts:ALL_ACTIONS`, seven tuples,
consumed by `describe('every Server Action — unauth → reject before any DAL call (SEC-1)')` and
TEN-1's wrong-household twin. **Nothing cross-checks it against the module's real exports** — which
`docs/features/write-path.md` invariant 1 already admits in writing: _"A new action without it fails
the unauth suite in `actions.test.ts` **only if you add it to that suite: do.**"_

So 1c adds **`apps/web/app/actions-need-a-session.test.ts`**, modelled on the two guards in this repo
that already work this way — `apps/web/app/pages-are-gated.test.ts` (comment-stripped source match per
route, globbed from the filesystem) and `apps/web/lib/dal/scoped.test.ts` (per top-level declaration,
with named allowlists and a **dead-entry** assertion):

1. **Enumerate from the filesystem.** Walk `apps/web/app` for files containing `'use server'`
   (`use-server-exports.test.ts:walk` is the function to reuse, lifted to a shared helper rather than
   copied — AGENTS.md → Constants, "reuse small logic too"). Over-match on the directive, as
   `pages-are-gated.test.ts` does: _"over-matching is the safe direction here"_.
2. **Enumerate each file's exported functions** from the stripped source, and assert each one's body
   contains `await hasSession()` / `await requireSession()`. Comments stripped by the existing `code()`
   helper so a `// TODO: requireSession()` cannot satisfy it.
3. **Cross-check `ALL_ACTIONS`.** Assert the set of enumerated exports **equals** the names in
   `actions.test.ts:ALL_ACTIONS`, so the behavioural suite cannot silently miss one. This is the
   assertion that actually closes the gap, and it is the one `beta-1.md` was reaching for.
4. **Non-vacuity + a dead-entry allowlist.** Assert the walk finds ≥7 actions (an empty glob passes
   everything — `pages-are-gated.test.ts` guards exactly this), and keep an allowlist that must not
   contain a path that no longer exists. In 1c the allowlist holds `app/gate/actions.ts` (the gate
   action issues the gate and cannot require a session); **1d deletes that file, and the dead-entry
   assertion is what forces the allowlist entry to go with it.**

⚠️ **This is a source-text guard, which is a real limitation and must be written down rather than
over-sold.** It proves the call is present, not that it is reached before the DAL — that is
`ALL_ACTIONS`'s `expect(getProfileByPublicId).not.toHaveBeenCalled()` job, which is why step 3 exists.
Both halves together are the claim; neither alone is.

### 8 · The per-user mutation rate limit

`apps/web/lib/rate-limit.ts:checkRateLimit(identifier)` is already generic and already fails open on
both `unconfigured` and `limiter-error`. So this is small, and the wording in `beta-1.md` § 3 —
_"the existing Upstash limiter re-keyed from IP to user id"_ — is **slightly off in a way worth
correcting**: the existing limiter's one call site is `app/gate/actions.ts:submitGate`, which **1d
deletes**. There is nothing to re-key. What AUTH-1 actually does:

- **adds** `checkRateLimit(\`mutate:${userId}\`)`to the seven mutating actions, after`hasSession()`and before anything else, returning the **same typed envelope** a refusal already
returns (a throw would render`error.tsx`and lose the user's place —`submitGate`'s existing
  comment is the precedent);
- **adds** `MUTATION_RATE_LIMIT = { attempts: …, window: … } as const` beside `GATE_RATE_LIMIT`, in
  `lib/rate-limit.ts` (app-only policy; the existing docblock already argues why this class of
  constant does not go in `packages/shared`);
- **deletes the false premise** in that file's docblock (Q4);
- **drops** the gate limiter and `GATE_RATE_LIMIT` in 1d, with `app/gate/actions.ts`.

Brute-forcing the sign-in itself is **Clerk's** problem after 1d — it owns the credential endpoint, and
there is no longer an in-app password oracle. That is the single biggest security win of retiring the
gate and should be said in 1d's PR body rather than assumed.

⚠️ `UPSTASH_*` are optional by design in `apps/web/lib/env.ts` (dev, CI, un-wired previews), so an
unconfigured environment has **no** mutation limit. That is the existing, deliberate posture, not a
regression — but after AUTH-1 it is the only limiter in the app, so 1c's PR body states it and
`isRateLimitConfigured` stays exported for the health check that tells "off" from "broken".

### 9 · Env, and the one thing that must stay optional

`apps/web/lib/env.ts` is the single `process.env` reader and **refuses to boot** on a missing var.
Today `ACCESS_GATE_PASSWORD: z.string().min(8)` is **required**, which is why it appears in
`ci.yml`'s Build step (`ACCESS_GATE_PASSWORD: ci-build-placeholder`), `e2e-local.ts`,
`screenshot-ephemeral.ts` (`SCREENSHOT_GATE_PASSWORD`) and `.env.local`.

- **1a adds `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` as _optional_**, with the same
  rationale block V1-14a's optional vars carry: local dev, CI and un-wired previews legitimately run
  without them, and making them required breaks `pnpm dev` and CI the day it merges. ⚠️ The
  publishable key is the one legitimate `NEXT_PUBLIC_` in this repo — AGENTS.md forbids the prefix on
  **secrets**, and Clerk's publishable key is public by design. **1a's PR body must say that out
  loud**, because "a new `NEXT_PUBLIC_` var in the auth PR" is exactly what a security reviewer should
  stop on.
- **1c is where "optional" has teeth**: with no Clerk keys, `getCurrentUser()` fails closed and the
  app is **dark**, not open. That is the correct behaviour and it is what makes an un-wired preview
  safe — but it also means `pnpm dev` goes dark at 1c unless `.env.local` has Clerk dev keys.
  **1c updates `.env.example` and the dev-setup note in the same PR**, because the first person to
  hit this is the maintainer on a Saturday.
- **1d removes `ACCESS_GATE_PASSWORD`** from `env.ts`, `.env.example`, `ci.yml`, `e2e-local.ts`,
  `screenshot-ephemeral.ts` and the Vercel/GitHub secret stores (a runbook step, § Runbook). Order
  matters inside 1d: remove the **reads** before the **secret**, or the app refuses to boot.

### 10 · e2e, screenshots and the cost nobody has priced yet

This is 1d's real weight, and it is the one place this plan says "probably its own plan".

`apps/web/e2e/gate-login.ts:gateLogin` drives the **real** form — `goto(GATE_PATH)` →
`getByLabel('Access code')` → `getByRole('button', { name: 'Enter' })` → `waitForURL(APP_HOME_PATH)`.
Consumers: `e2e/global.setup.ts` (mints `storageState`, then warms two cold Server Actions,
`setup.setTimeout(180_000)`) and `apps/web/scripts/capture.ts` (`if (!isUngatedPath(pathname)) await
gateLogin(page)`). `screenshot-ephemeral.ts` injects its own gate password into the server env.

**Google OAuth has no "drive the real form" equivalent** — Playwright cannot complete a Google consent
flow against a real Google account in CI, and should not try. The options, with what each costs:

| Option                                                                                        | Cost                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Clerk's official Playwright helpers + a testing token** (recommended, pending verification) | The smoke and `screenshot:ephemeral` now need a Clerk **development instance** and `CLERK_SECRET_KEY` in CI — a network dependency and a secret in the `e2e` job, where there is none today. Must be verified against Clerk's own docs at the **pinned version**, not its README (AGENTS.md → plan-with-panel: the DX-1 lesson). |
| **Inject a session cookie / stub `auth()` behind a test-only env flag**                       | No network, no secret — but a test-only auth bypass in the auth PR, which is the single worst place in this repo to put one. Rejected unless the above proves unworkable, and then only with the flag unreadable in production.                                                                                                  |
| **Drop e2e coverage of authenticated screens**                                                | `e2e` becomes required at PR 28 and the smoke's whole job is proving the pieces are wired. Rejected.                                                                                                                                                                                                                             |

⚠️ **`screenshot:ephemeral` is the sharper problem**, because it boots a **throwaway embedded
Postgres** with no network and no credentials by design — that is why UI screenshots are local-runnable
at all. A Clerk dependency makes every future UI PR's screenshot step need a Clerk instance. **1d must
answer this and the answer is not obvious**; if the answer is a test-only path, it belongs to
`screenshot-ephemeral.ts` alone (which already lives outside the request tree and is already
allowlisted by name in `packages/db/src/scope.test.ts`), never to the app.

**So: 1d is flagged as likely to need its own plan**, and this plan does not pretend to have settled
it. What this plan does settle is that 1d is **last**, **alone**, and does not block 1c from
delivering the boundary.

### 11 · Caching — the exit criterion that is already satisfied, and must stay so

_"per-user data is never cached across users"_. Already true and already proved: the root layout is
`export const dynamic = 'force-dynamic'` (the nonce CSP requires it) and
`apps/web/app/tenancy-is-not-cached.test.ts` pins it, including `it('the export Route Handler is
dynamic on its own (a handler inherits no segment config)')`. ADR 0006 cites this as the obligation it
discharged.

**AUTH-1's job is not to add caching discipline but not to lose it.** Two specific hazards:

- Clerk's middleware and components must not introduce a statically-rendered shell. Any new route
  (`/sign-in`) is `force-dynamic` by inheritance, and `tenancy-is-not-cached.test.ts` should gain the
  new routes rather than be left enumerating the old set.
- `cache()` on `getCurrentUser()` is **per-request** (React `cache`), not cross-request. Saying so in
  the docblock is cheap and forestalls the misreading that matters most here.

---

## Chunks, in order

### 1a — Clerk wired, and dark · `feat/auth-1a-clerk-wired`

**Prerequisite: `PRIV-2` merged and `/privacy` live** (Q3). **Gate still the only boundary.**

| Path                                        | Change | What & why                                                                                                                                          |
| ------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/package.json`                     | EDIT   | `@clerk/nextjs` at an exact version. One dependency; the privacy lens and `pnpm audit:check` both see it.                                           |
| `apps/web/lib/env.ts`                       | EDIT   | `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, both **optional** (§ Design 9), with the rationale block.                                  |
| `.env.example`                              | EDIT   | Both vars, with the "Clerk development instance" note.                                                                                              |
| `apps/web/proxy.ts`                         | EDIT   | `clerkMiddleware()` composed inside `proxy`, CSP pipeline untouched; **`api` exclusion removed from the matcher** (§ Design 6).                     |
| `apps/web/proxy.test.ts`                    | EDIT   | Matcher assertions for `/api/...` now matching; Clerk composition does not bypass `withSecurityHeaders`.                                            |
| `apps/web/lib/access-gate.ts`               | EDIT   | `isPublicPath` child-path arm; `SIGN_IN_PATH` const. `PUBLIC_PATHS` unchanged in 1a (the sign-in page is **gated** during the overlap — see below). |
| `apps/web/lib/access-gate.test.ts`          | EDIT   | The `/sign-inevil` negative test, in the same commit as the arm.                                                                                    |
| `apps/web/app/sign-in/[[...rest]]/page.tsx` | NEW    | Clerk's prebuilt sign-in, Google only. **A screen a person sees → owes a UX panel** (§ Panels).                                                     |
| `apps/web/app/layout.tsx`                   | EDIT   | `<ClerkProvider>`, inside the existing nonce/theme providers.                                                                                       |
| `docs/privacy/notice.md`                    | EDIT   | "What is changing" → present tense; the processor row; box (c)'s "the invitation is the record" sentence.                                           |
| `docs/privacy/data-inventory.md`            | EDIT   | § 7: Clerk and Google from **"not wired"** to wired, with what each receives.                                                                       |
| `docs/runbooks.md`                          | EDIT   | The dashboard half of the AUTH-1 checklist: Google OAuth credentials, Google-only strategy, the **sign-up restriction**, the domain.                |

**Why the sign-in page is gated during the overlap, and it is not an oversight.** Adding `/sign-in` to
`PUBLIC_PATHS` in 1a would mean the sign-in page is reachable without the code — which is correct
_after_ 1d and unnecessary before it, since the only person signing in is the maintainer, who has the
code. Keeping it gated means 1a cannot accidentally widen the surface. **1d moves it into the
no-session list**, together with the rest of that list's change of meaning. _(Exception: if Clerk's
OAuth callback must be reachable without the gate for the redirect to complete, the callback child
path — and only it — joins `PUBLIC_PATHS` in 1a, with the `/sign-inevil` test. Verify by running the
flow against the development instance before 1a merges; this is the one thing in 1a that cannot be
settled from reading.)_

### 1b — `household_members` + the claim correction, both dark · `db/auth-1b-household-members`

**Prerequisite: 1a deployed and the maintainer has signed in once** (so a Clerk user id exists).
**Nothing reads the table.**

| Path                                                       | Change   | What & why                                                                                                                                                                                                                     |
| ---------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/shared/src/household.ts` (or an existing module) | NEW/EDIT | `HOUSEHOLD_ROLES` const array + zod enum + `z.infer` type. One definition; CHECK, zod and types all read it.                                                                                                                   |
| `packages/db/src/schema.ts`                                | EDIT     | `householdMembers` table (§ Design 4), indexes, CHECK sourced from `HOUSEHOLD_ROLES`.                                                                                                                                          |
| `packages/db/migrations/0015_*.sql`                        | NEW      | `drizzle-kit generate`, then hand-hardened: timeouts, `IF NOT EXISTS`, the inline-index comment.                                                                                                                               |
| `packages/db/src/seed.ts`                                  | EDIT     | ⚠️ **Only to assert it writes no membership.** `migrate.yml` seeds **production** on every push; a seeded owner would hand a real family's household to a committed identity. Same rule `households.synthetic` carries in red. |
| `packages/db/scripts/corrections/registry.ts`              | EDIT     | The `household-claim-<date>` correction (§ Design 5).                                                                                                                                                                          |
| `packages/db/scripts/corrections/README.md`                | EDIT     | An **Applied** row as `pending`, dated in a follow-up commit once it has run.                                                                                                                                                  |
| `packages/db/scripts/verify.ts`                            | EDIT     | The membership proofs (§ Test plan) + the correction's own dry run, the vehicle 1d of TEN-1 established.                                                                                                                       |
| `docs/architecture.md`                                     | EDIT     | § 4 data model gains `household_members`; § 2b's routing diagram is **1c's** edit, not this one.                                                                                                                               |

### 1c — the boundary moves · `feat/auth-1c-session-is-the-boundary`

**Prerequisite: `0015` applied in production AND the claim correction run with `--apply`.** **Gate and
session both enforced.** This is the chunk the exit criteria are about.

| Path                                                                                              | Change | What & why                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib/dal/user.ts`                                                                        | NEW    | `getCurrentUser()`, `cache()`d, fails closed (§ Design 1).                                                                                                                                                                                                 |
| `apps/web/lib/dal/session.ts`                                                                     | NEW    | `hasSession()` / `requireSession()`, one-for-one with `gate.ts`'s two (§ Design 2).                                                                                                                                                                        |
| `apps/web/lib/dal/household.ts`                                                                   | EDIT   | `getHouseholdScope()`'s **body only**; the four outcome states; `ScopeMissEvent['actor']`; `noScope`'s new meaning.                                                                                                                                        |
| `packages/db/src/queries/household-scope.ts`                                                      | EDIT   | A `membershipHousehold(db, clerkUserId)` query beside `liveHouseholdIds`, single-sourced so `db:verify` proves **this** query (the precedent `liveHouseholdIds` set).                                                                                      |
| `apps/web/app/p/[profileId]/actions.ts`                                                           | EDIT   | 7 × `hasGateAccess` → `hasSession`; the mutation limiter after it; refusal copy unchanged.                                                                                                                                                                 |
| `apps/web/app/p/page.tsx`, `p/[profileId]/page.tsx`, `routine/page.tsx`, `design/tokens/page.tsx` | EDIT   | 4 × `requireGatedPage` → `requireSession`.                                                                                                                                                                                                                 |
| `apps/web/app/p/[profileId]/export/route.ts`                                                      | EDIT   | `isValidGateCookie` → `hasSession` — the one surface that checks the cookie **directly**; normalised here.                                                                                                                                                 |
| `apps/web/app/p/page.tsx` (+ a new component)                                                     | EDIT   | The **"this account has no household"** state (§ Design 3). **UI → owes a UX panel.**                                                                                                                                                                      |
| `apps/web/app/actions-need-a-session.test.ts`                                                     | NEW    | The enumeration test (§ Design 7), including the `ALL_ACTIONS` cross-check and the dead-entry allowlist.                                                                                                                                                   |
| `apps/web/app/p/[profileId]/use-server-exports.test.ts`                                           | EDIT   | `walk` lifted to a shared helper rather than copied.                                                                                                                                                                                                       |
| `apps/web/app/p/[profileId]/actions.test.ts`                                                      | EDIT   | `ALL_ACTIONS`'s unauth suite mocks `hasSession`; a **no-membership** case beside the wrong-household one.                                                                                                                                                  |
| `apps/web/lib/dal/household.test.ts`                                                              | EDIT   | The four outcome states; `reportScopeMiss`'s new `actor`.                                                                                                                                                                                                  |
| `apps/web/lib/rate-limit.ts`                                                                      | EDIT   | `MUTATION_RATE_LIMIT`; the false-premise paragraph deleted (Q4).                                                                                                                                                                                           |
| `apps/web/app/tenancy-is-not-cached.test.ts`                                                      | EDIT   | `/sign-in` added to the enumerated routes.                                                                                                                                                                                                                 |
| `apps/web/scripts/screenshot-ephemeral.ts`                                                        | EDIT   | ⚠️ Goes dark at 1c unless it can mint a session. **If § Design 10's answer is not ready, 1c keeps the gate path working for the screenshot script only** — which it can, because the gate is still enforced in 1c. That is a second reason 1d is separate. |
| `docs/features/write-path.md`                                                                     | EDIT   | **Owned-file, CI-enforced.** Invariant 1's `hasGateAccess()` sentence; invariant 2's "scoping is not authorization" caveat — which **AUTH-1 discharges** and must be rewritten, not deleted; the catalog carve-out stays.                                  |
| `docs/runbooks.md`                                                                                | EDIT   | The scope-miss alert rule: `actor`, `no_scope`'s new cause, and promise 5's correction.                                                                                                                                                                    |
| `docs/architecture.md`                                                                            | EDIT   | § 2b — the routing diagram gains sign-in → session → membership → scope. ADR 0006 assigned § 2b's scope edit to TEN-1 1d; this is the session edit on top.                                                                                                 |

### 1d — retire the gate · `feat/auth-1d-retire-the-gate`

**Prerequisite: 1c in production and confirmed.** ⚠️ **Likely needs its own plan for § Design 10.**

| Path                                                                                                                                                  | Change | What & why                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/app/gate/` (`page.tsx`, `actions.ts`, `actions.test.ts`, components)                                                                        | DELETE | The gate's UI and action.                                                                                                                                                                                                                                                                                               |
| `apps/web/lib/dal/gate.ts`, `gate.test.ts`                                                                                                            | DELETE | Replaced by `session.ts` in 1c.                                                                                                                                                                                                                                                                                         |
| `apps/web/lib/access-gate.ts`                                                                                                                         | EDIT   | `GATE_COOKIE_NAME`, `GATE_PATH`, `gateTokenFor`, `isValidGateCookie`, `isUngatedPath` deleted. **`safeInternalPath` / `internalPathname` / `PUBLIC_PATHS` STAY** — SEC-4 hardened the first two and a sign-in `?redirect_url=` is their next consumer; the module is renamed to what it now is (`lib/public-paths.ts`). |
| `apps/web/lib/access-gate.test.ts`                                                                                                                    | EDIT   | The gate-token and cookie-contract suites go; `safeInternalPath`'s open-redirect suite **stays, in full**.                                                                                                                                                                                                              |
| `apps/web/app/pages-are-gated.test.ts`                                                                                                                | EDIT   | → `pages-need-a-session.test.ts`: `requireGatedPage` → `requireSession`, `isValidGateCookie                                                                                                                                                                                                                             | hasGateAccess`→`hasSession`. The three-suite structure is kept; it is the model for 1c's new test. |
| `apps/web/lib/env.ts`, `.env.example`, `.github/workflows/ci.yml`                                                                                     | EDIT   | `ACCESS_GATE_PASSWORD` gone. **Reads before the secret** (§ Design 9).                                                                                                                                                                                                                                                  |
| `apps/web/e2e/gate-login.ts` → `session-login.ts`, `global.setup.ts`, `scripts/capture.ts`, `scripts/e2e-local.ts`, `scripts/screenshot-ephemeral.ts` | EDIT   | § Design 10. The single-helper/two-consumers shape is preserved.                                                                                                                                                                                                                                                        |
| `apps/web/proxy.ts`                                                                                                                                   | EDIT   | Gate bounce → Clerk; `/sign-in` into the no-session list; **`mp_gate` deleted on the next response**, for one release.                                                                                                                                                                                                  |
| `apps/web/lib/rate-limit.ts`                                                                                                                          | EDIT   | `GATE_RATE_LIMIT` and the gate rationale gone.                                                                                                                                                                                                                                                                          |
| `docs/runbooks.md`                                                                                                                                    | EDIT   | "Rotate a secret" loses the access-gate code; "Verifying V1-14a hardening" § 2 ("The gate rate limit is enforcing") is rewritten for the mutation limiter.                                                                                                                                                              |
| `.github/SECURITY.md`, `docs/privacy/data-inventory.md` § 4                                                                                           | EDIT   | The "one shared access code, no per-person revocation" row — **the row AUTH-1 exists to delete**.                                                                                                                                                                                                                       |
| `docs/tech-debt.md`                                                                                                                                   | EDIT   | The `/api` matcher hole, closed in 1a, struck here or there (wherever it lands first).                                                                                                                                                                                                                                  |

---

## Test plan

**`db:verify` (PGlite, no Docker) — the membership matrix.** The vehicle TEN-1 built, extended:

1. a member resolves to **exactly** their household (the positive);
2. a user id with **no** membership resolves to **no** household — and the twin that keeps it honest:
   an _unscoped_ membership lookup finds rows, so the negative cannot pass for free (the shape 1d of
   TEN-1 used for the correction proof);
3. **two** members of two households each reach only their own, driven through the same scoped reads
   the two-household matrix already drives — this is the row-level proof that promise 5 actually owes
   (`cross_household` with two **live** households, which cannot exist before this PR);
4. a **soft-deleted** membership stops resolving (the same `deleted_at` discipline `liveHouseholdIds`
   proves for households);
5. the claim correction's **own dry run** binds the household it was told to, writes nothing, and
   **refuses** on an unknown household id and on a household that already has a live member.

**`pnpm db:mutations`** — the five committed patches must each still turn `db:verify` red, and AUTH-1
adds one: **delete the `clerk_user_id` conjunct from `membershipHousehold`** and assertion 3 must go
red. A boundary test that cannot fail is worse than none (TEN-1's own words), and a membership lookup
driven by a fixture is exactly where a vacuous assertion hides.

**Vitest.** `getCurrentUser()` (no session → `null`; `auth()` throws → `null`, **not** a rethrow);
`getHouseholdScope()`'s four states; `reportScopeMiss`'s new `actor` and `noScope`; the mutation
limiter (limited → the typed envelope, never a throw; `limiter-error` → allowed + breadcrumb);
`ALL_ACTIONS` × {no session, no membership, wrong household, unknown id} all returning the **same
const**; the enumeration test's own non-vacuity.

**Playwright.** 1c keeps the existing smoke green **through the gate**, which is possible because the
gate is still enforced. 1d rewrites the login helper and is where the smoke's auth story is decided
(§ Design 10). `e2e` is non-blocking until PR 28, which buys 1d exactly one piece of slack and should
not be spent on anything else.

**Manual, on a preview** (⚠️ previews are behind Vercel Authentication since OPS-1, so this is the
maintainer's box): sign in with the invited Google account → land on the picker → a second,
_uninvited_ Google account cannot sign up at all → a signed-in account with no membership sees the
no-household screen → a `/p/<other household's public_id>` deep link 404s.

---

## Risks / rollback

| Risk                                                                                                                               | Mitigation                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R1 · 1c deploys before `0015` is applied** → `42P01` on every route, a total outage, not a dark app.                             | The 1a/1b/1c split exists for this. ⚠️ **`migrate.yml` exits 0 with a warning when `DATABASE_URL_UNPOOLED` is absent**, so a green migrate run does not prove the table exists (TEN-1 § Design 1a found this). **1c's runbook step is: confirm `household_members` exists in prod by hand before merging.** |
| **R2 · the claim correction is not run** → the maintainer signs in to a no-household screen and the app is dark for its only user. | 1c's prerequisite is the correction **applied**, not merged. The **Applied** table's date is the artifact. Recovery is to run it; nothing is lost.                                                                                                                                                          |
| **R3 · `auth()` throws on a route the matcher misses** → a 500 or a refusal of a legitimate caller.                                | `getCurrentUser()` fails closed by design, and 1a removes the `/api` exclusion so there is no matcher-shaped gap left. The enumeration test proves every entry point refuses rather than resolves.                                                                                                          |
| **R4 · the enumeration test is a source-text guard** and proves presence, not ordering.                                            | Stated, not sold (§ Design 7). `ALL_ACTIONS`'s `not.toHaveBeenCalled()` assertions are the ordering half, and step 3 cross-checks that the two lists agree.                                                                                                                                                 |
| **R5 · household #2 before `TEN-2b`** → the proven cross-tenant catalog write.                                                     | Q5: no request path creates a household in AUTH-1. The only path is an operator action after `TEN-2b`.                                                                                                                                                                                                      |
| **R6 · the Clerk e2e story is unsolved and `e2e` becomes required at PR 28.**                                                      | 1d is last and alone, and 1c keeps the smoke green through the gate. If § Design 10 is not solved by PR 28, `ci-skip-e2e` is **visible on the PR** by design — but it is a schedule debt to name, not a plan.                                                                                               |
| **R7 · the Clerk free tier's limits** (MAU, Organizations, custom domain) are a vendor fact nobody has read.                       | A runbook checklist box in 1a, read off the console. It is also an argument for Q1's recommendation: fewer vendor features, fewer vendor limits.                                                                                                                                                            |
| **R8 · `@clerk/nextjs` compatibility with Next 16.3.8.** This repo is on a very recent Next.                                       | 1a's first commit is the dependency and a `next build`. If it does not build, that is the cheapest possible failure and it happens in the smallest PR.                                                                                                                                                      |
| **R9 · the notice goes stale in the other direction** — 1a says Clerk is wired, and 1d is where it actually gates anything.        | 1a's notice edit describes what the **running system** does, which is the inventory's own standard: from 1a, Clerk receives data. The sentence is "sign-in is being rolled out", not "sign-in is how you get in".                                                                                           |
| **R10 · a reviewer reads AUTH-1 as "isolation is done".**                                                                          | It is not: the movement catalog is proved to leak and `TEN-2b` is what closes it. 1c's PR body and `write-path.md`'s invariant 2 both say so.                                                                                                                                                               |

**Rollback.** 1a/1b revert cleanly (both inert; the migration is additive and the correction leaves one
harmless row). 1c reverts to the gate as the sole boundary. 1d is the asymmetric one — reverting needs
`ACCESS_GATE_PASSWORD` restored to three secret stores first. No destructive migration, so no Neon
RESTORE branch is required; cut one anyway before running the claim correction with `--apply`, per
AGENTS.md, because it is the first authored write to a table that did not exist yesterday.

---

## Alternatives considered and rejected

| Alternative                                                     | Rejected because                                                                                                                                                                                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Clerk Organizations as the tenancy model**                    | Q1. Recommended against, not ruled out — it is the maintainer's call, and the reversal is one additive migration.                                                                                                                                      |
| **Retire the gate and land the session in one PR**              | The window where neither holds is a single deploy wide, and "either dark or open" is the failure mode. Q2's AND-composition costs one extra PR.                                                                                                        |
| **Keep the gate permanently as a second factor**                | It has no per-person revocation, which is AUTH-1's whole rationale. Two credentials where one is un-revocable is not defence in depth; it is a credential nobody rotates.                                                                              |
| **An owner column on `households` instead of a table**          | Beta 1 needs a second member (a coach, a second parent) and a column cannot hold two. A one-row table now is cheaper than an expand→contract later, and `households` is the authorization root of 18 tables — the table nobody wants to migrate twice. |
| **A `users` table mirroring Clerk (email, name)**               | Data minimisation: the app would start holding adults' email addresses with no consumer. `clerk_user_id` is the only field anything needs, and `data-inventory.md` § 7 keeps Clerk as the processor that holds the rest.                               |
| **Auto-create a household on first sign-in**                    | Q5. It opens the proven catalog leak, and it is the clause `.github/SECURITY.md` and ADR 0006 both already converted into a sequencing constraint.                                                                                                     |
| **A `consent_at` column on `household_members`**                | `runbooks.md` box (c) decided it: the invitation is the record for Beta 0. A new personal-data field with no reader is the wrong direction in this app.                                                                                                |
| **Extend `use-server-exports.test.ts` as `beta-1.md` § 3 says** | It is an export-**shape** guard and cannot carry an auth assertion (§ Design 7). The milestone's intent is honoured; its named vehicle is not the one that works.                                                                                      |
| **Fold the `SEC-6` id rotation into the claim correction**      | Q4, and ADR 0006 decided it once already. The correction is built rotation-agnostic instead, so the two rows commute.                                                                                                                                  |
| **Thread the principal through page/action signatures**         | TEN-1 rejected the same shape for the scope, for the same reason: a threading mistake one layer up is a leak the compiler cannot see. `write-path.md` invariant 8 keeps ambient server state in `lib/dal`.                                             |

---

## Panels this plan and its chunks owe

**No UX panel is owed for this plan**, and that is deliberate rather than an omission: it adds no
screen, no copy and no interaction — it is four chunk descriptions and a set of decisions. AGENTS.md's
rule is _"scale the depth, never the existence"_, and the thing it scales is **a UI change**; there is
none here.

**The implementing PRs that do owe one** — named now so none is reached late:

| Chunk  | UI it introduces                                                                               | Panel owed                                                                                                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1a** | the **sign-in screen** (`/sign-in`), even using Clerk's prebuilt component                     | **Full, 3 lenses.** A new screen and the app's new front door. Clerk's component is themeable, so 360px, tap targets and focus-visible are ours, not the vendor's.                  |
| **1c** | the **"this account has no household"** screen, and the refusal copy a sessionless caller sees | **Full, 3 lenses.** It is a dead end by design, and the trust lens is the one that matters: what does a parent do next, and does the copy ask them for anything they cannot supply? |
| **1d** | the **removal** of the gate page; a changed first-run path                                     | **One reviewer.** A deletion plus a redirect, with before/after screenshots at three widths.                                                                                        |

**Engineering panels.** This plan gets the full seven (four standing + DB-safety + security + privacy).
1b gets DB-safety again on the generated SQL. 1c gets security + correctness again on the resolver and
the enumeration test. 1d, if § Design 10 needs its own plan, gets that plan's own panel.

---

## Runbook — what belongs there, not in code

`beta-1.md` § 3: _"The dashboard settings live nowhere in code, so they go in a runbook checklist."_
[runbooks.md](../runbooks.md) → "AUTH-1 — the consent and dashboard checklist" already holds PRIV-1's
**privacy half** (5 boxes). AUTH-1 adds the rest, in **1a**:

- [ ] **Google only.** Every other strategy disabled on the production instance — email links and
      passwords included, or the invitation-only property has a second door.
- [ ] **Sign-up restricted to invited emails.** The instance-level restriction/allowlist setting.
      ⚠️ **Verify, do not assume, and record what you read**: whether it exists at the pinned version,
      what it is called, and **whether it blocks sign-up or only warns**. If it does not block, Q1's
      recommendation flips (organization invitations become the only mechanism) and the plan's chunk 1a
      does not merge until that is decided.
- [ ] **The production instance's own Google OAuth credentials**, not Clerk's shared development
      keys — and the **development** instance kept separate, which OPS-1 requires anyway (_"a separate
      Clerk development instance"_ in the Preview environment).
- [ ] **The domain**, and the consent screen's privacy-policy URL → `/privacy` (**PRIV-2 first**).
- [ ] **Free-tier limits read off the console** (R7): MAU, and whether a custom domain or Organizations
      cost anything.
- [ ] **The Clerk keys into Vercel** — production and preview **separately**, per OPS-1, and
      `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is the one var that is public on purpose.
- [ ] **1d:** `ACCESS_GATE_PASSWORD` **removed** from Vercel (all environments), GitHub Actions and
      `.env.local` — **after** the code that reads it is gone, never before.
- [ ] **1d:** "Rotate a secret" loses the access-gate code; the household-deletion runbook's step 0b
      (record Clerk user ids) and step 6 (delete the Clerk users) become **live** rather than
      _"after `AUTH-1`"_.

---

## Out-of-scope / deferred

- **Facebook, email links, passwords, child accounts, kid PINs** (`pin_hash` stays reserved and unused).
- **Invitations in the app.** Beta 1. Beta 0 invites by hand, through the Clerk dashboard allowlist and
  whatever contact route `PRIV-2` publishes.
- **Household creation from a request path.** Q5 — moves to the invite row, gated on `TEN-2b`.
- **Roles doing anything.** `role` is stored and checked by a CHECK; no code branches on it. `COACH-1`
  is the row that gives it meaning.
- **Step-up auth for bodyweight.** Beta 1 (`beta-1.md`).
- **An audit log.** A Beta 1 exit criterion; `reportScopeMiss` is the one structured event today.
- **The `SEC-6` id rotation.** Its own row (Q4).
- **`TEN-2a/b/c`.** Beside AUTH-1, not inside it; `TEN-2b` gates the invite.
- **`PRIV-3`** (the deletion script) and the `--household` runner flag it needs.
- **Multi-household membership**, organization switching, and anything the partial unique index
  forbids.
- **The MCP org-scoped Clerk API key.** v3.

---

## Open questions — the maintainer's calls

1. 🔴 **Is a household a Clerk Organization?** Recommendation: **no, not in Beta 0** (Q1), with the
   cost of being wrong priced at one additive migration and one function body. **Unsigned.**
   Conditional reversal: if the instance-level sign-up restriction does not block sign-up at the
   pinned version, organization invitations may be the only mechanism and this flips.
2. 🔴 **Does _"a new user gets a new, empty household"_ leave AUTH-1?** Recommendation: **yes**, onto
   the invite row, gated on `TEN-2b` (Q5). This edits a signed milestone (`beta-1.md` § 3), so it is
   not a plan decision. **Unsigned.**
3. **"Household" or "club"?** Recommendation: keep `household` (Q1b). `beta-1.md` deferred the name to
   this plan; this plan declines to spend Beta 0 on it. **Unsigned.**
4. **Does chunk 1d get its own plan?** Recommendation: **yes**, for the Clerk/Playwright/screenshot
   story (§ Design 10) — it is a tooling subsystem change with a third-party dependency and a
   test-only-bypass temptation. **Unsigned.**
5. **The scope-miss event's `actor`.** Recommended `'session' | 'anonymous'` — never the Clerk user id,
   because its own docblock forbids a requester↔owner linkage in a third-party store over minors'
   health data (§ Design 3). Flagged rather than assumed because it is the one place an obvious
   "improvement" would be a privacy regression.

## Review-response log (adversarial panel)

_To be filled by the seven-lens panel before any implementation code is committed._
