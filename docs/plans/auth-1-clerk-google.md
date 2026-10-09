# AUTH-1 — Clerk, Google, invitation-only

> Backlog: [plan.md](../plan.md) row **AUTH-1**. Milestone:
> [beta-1.md](../milestones/beta-1.md) § 3 (Beta 0, step 3).
> This plan ships on `docs/auth-1-clerk-plan`; the implementing chunks get
> `feat/auth-1a-clerk-wired` … `feat/auth-1d-retire-the-gate`.
>
> **Plan only. No implementation code, no migration file, no Clerk dependency is added by this PR.**
>
> ⚠️ **Citations in this document are `path:symbol`, not `path:line`.** TEN-1's last two chunks were
> open as **#268** (`feat/ten-1c-dal-2-tail`) and **#269** (`feat/ten-1d-guards-and-verdict`) while
> this plan was being drafted; `docs/plans/ten-1-household-scope.md` → "1d as built" had to re-find
> three predicates by symbol for exactly this reason.
>
> ✅ **TEN-1 is now fully merged on `main`** (#266/#268/#269), and `OPS-1` is closed out (#270). The
> seven-lens panel below **re-verified every TEN-1 claim against `main`, not against a branch**, and
> the five-promise table and the six answers were corrected where `main` disagreed. Where a claim is
> still stated as read off the 1d branch, the panel's re-check is recorded in the
> [review-response log](#review-response-log-adversarial-panel).

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
> invitation-only; [the maintainer]'s existing household is claimed by a guarded correction before the
> gate goes; a `household_members` table; every entry point rejects a caller with no session. Facebook
> waits for a tester to ask.** Replaces the shared access code with per-person identity.

⚠️ **The two quotes in this section are substituted, not verbatim.** `docs/plan.md` and
`beta-1.md` both name the maintainer, and AGENTS.md → "No personal names in PRs, plans, ADRs,
changelog fragments or commit messages" binds a file created after that rule. `[the maintainer]`
stands where the name was. **And the limit is worth saying rather than letting the substitution read
as a fix:** `git log -S` still finds the name in both source documents, and the commit author and
email are in every commit regardless — the same caveat `data-inventory.md` § 9 records for the
`OSS-1` sweep. Sweeping the two source documents is not this plan's PR.

**Verbatim, [beta-1.md](../milestones/beta-1.md) → Beta 0 exit criteria (the two AUTH-1 rows):**

> - [ ] Every action, page and route handler rejects a caller with no session; a profile outside the
>       session's household is a 404; per-user data is never cached across users (AUTH-1).
> - [ ] An uninvited Google account cannot create a household. [The maintainer]'s existing household
>       is reachable after they sign in, and only by them.

**Done when — observable:**

1. `pnpm --filter web test` contains a guard that **enumerates every exported function of every
   `'use server'` module under `apps/web` from the filesystem** — not just `apps/web/app` — and fails
   if one does not require a session, **except the gate's own action, which is allowlisted until 1d
   deletes it along with its allowlist entry.** Adding a new action without the check is a red build,
   not a review miss. The discovered `'use server'` file set must **equal** a pinned list, so a new
   action module anywhere in the app is a visible test edit rather than a silent gap (§ Design 7).
2. `apps/web/lib/dal/household.ts:getHouseholdScope` derives the household from `auth()` →
   `household_members` → `households`, **with both `deleted_at IS NULL` conjuncts and a `limit(2)`
   ambiguity probe** (§ Design 3), and **nothing above `lib/dal` changed shape** to make that true.
   Its diff is one function body, one new `getCurrentUser()` neighbour, one new `householdState()`
   neighbour, and the four outcome states' handling.
3. Migration `0015` adds `household_members`; `pnpm db:verify` proves (a) a member resolves to
   exactly their household, (b) a user with no membership resolves to no household, (c) two members
   of two households each reach only their own, (d) a soft-deleted **membership** stops resolving,
   (e) **a live membership pointing at a soft-deleted household resolves to no household**, (f) the
   claim correction's own dry run binds the household it was told to and refuses on each of its three
   refusal cases, and (g) **each of the four constraints `0015` creates rejects what it is for** — the
   role CHECK, the partial unique on `clerk_user_id` **in both directions**, the `public_id` unique,
   and the FK. Plus `assertCheckCoversConst('household_members_role_check', HOUSEHOLD_ROLES)`.
4. `db:correct` lists a `household-claim-<date>` correction; its dry run prints the household it
   would bind and the user it would bind it to, **and writes nothing**; a second `--apply` reports 0
   rows. The **Applied** table in
   [corrections/README.md](../../packages/db/scripts/corrections/README.md) carries its date.
5. `grep -rn 'ACCESS_GATE_PASSWORD\|GATE_COOKIE_NAME\|hasGateAccess\|gateTokenFor' apps packages
.github` returns nothing outside `docs/` after chunk 1d. `apps/web/app/gate/` does not exist.
6. A signed-in user whose Google account has no membership sees a **"this account has no household"**
   screen — never `apps/web/lib/constants.ts:PICKER_EMPTY_COPY` (_"No athletes yet"_ / _"Adding an
   athlete isn't in the app yet — it takes a change to this deployment's seed data"_, with its GitHub
   link), and never another household's data. The discriminator is a **DAL** function, not the page
   asking `getCurrentUser()` (§ Design 3).
7. A profile `public_id` belonging to another household is **byte-identically** the 404 an unknown id
   gets, at all three surfaces, and `db:verify` proves it at the row level (it already does, from
   TEN-1 — AUTH-1 adds the session half).
8. The seven mutating Server Actions are rate-limited by **Clerk user id**; a signed-out caller never
   reaches the limiter because it never reaches the action.
9. The runbook checklist in [runbooks.md](../runbooks.md) → "AUTH-1 — the consent and dashboard
   checklist" has every box ticked with what was actually read off the Clerk and Google consoles, and
   the two "verify, do not assume" boxes record the answer found rather than the assumption.
10. **Every place in [docs/privacy/](../privacy/) that AUTH-1 falsifies is corrected in the chunk that
    falsifies it** — not just [notice.md](../privacy/notice.md) → "What is changing" and
    [data-inventory.md](../privacy/data-inventory.md) § 7. The full list, with its chunk, is in § Q3;
    it spans the egress claim, the "no email address" parenthetical, "no photos", § 1a's
    exhaustive-table claim and its 18-table count, § 4's two gate rows, § 8's three retention rows,
    the Upstash processor row, and the derivation stamp. `data-inventory.md`'s own **re-review
    triggers** fire on 1a (a new processor), 1b (the schema) and 1c (the DAL and logging), so each of
    those chunks owes a privacy-doc diff.
11. `apps/web/proxy.test.ts` pins **every CSP source Clerk required**, by exact origin and never a
    wildcard, and `apps/web/e2e/theme.spec.ts`'s zero-`securitypolicyviolation` assertion covers
    `/sign-in` (§ Design 6b).
12. `pnpm db:mutations` is green with **all** patches, each still reddening **the assertion its
    `.expect` names** — not merely "turning `db:verify` red".

---

## What TEN-1 hands AUTH-1 — each promise verified against the 1d branch

`#269`'s report claims five things. Four hold. **One is over-stated, and it changes a test
obligation.** Originally verified by reading `git show feat/ten-1d-guards-and-verdict:<path>`;
**re-verified against `main` by four lenses of the panel** (correctness, architecture, security,
reuse), which independently confirmed promises 1–4 and the promise-5 correction.

⚠️ **One count in the table below was wrong, and the correction is worth more than the number.** The
cell for promise 1 said "13 callers". On `main`, `grep -rn 'await getHouseholdScope()' apps/web`
returns **16 sites — 14 outside tests**, of which one is `household.ts:reportScopeMiss` itself (the
caller whose behaviour changes most). Three lenses re-derived it and got 12, 13 and 14 depending on
whether tests and the same-file call are counted — which is the point: **a count inherited rather
than re-derived is exactly the defect promise 5 is an instance of.** The table now says 14 and says
what it counts.

| #     | The promise                                                                                                                   | Verdict                                     | What I found                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1** | `getHouseholdScope()` is the single place a household is derived from a request, so AUTH-1 replaces only that function's body | ✅ **holds, and is enforced**               | `apps/web/lib/dal/household.ts:getHouseholdScope` is the only request-path derivation. `packages/db/src/scope.test.ts` asserts the set of files naming `householdScopeForRequest` is exactly `{apps/web/lib/dal/household.ts, apps/web/scripts/screenshot-ephemeral.ts}` and that nothing under `apps/web/{app,lib,components}/` mints a scope. **14 non-test call sites** (`entries.ts` 7, `profiles.ts` 3, `export.ts` 1, `programming.ts` 1, `adherence.ts` 1, plus `household.ts:reportScopeMiss`), all in `apps/web/lib/dal/`.                                                                                                                                                                                                                                                                                            |
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

**The cost of being wrong — and the first draft of this paragraph under-priced it.** The panel's
architecture lens showed that the number the maintainer is being asked to decide on was low in three
identifiable ways. In full, if Organizations turn out to be right:

- add `households.clerk_org_id` (nullable, additive) — **one additive migration**;
- change `getHouseholdScope()`'s body a second time — **one function body**;
- **plus a later _contract_ migration to retire `household_members`.** You cannot discard the table in
  one migration: AGENTS.md → Database rules and `.squawk.toml` forbid `DROP TABLE` alongside app code
  and require expand→contract across separate deploys — the same ceremony this plan invokes against
  the "owner column" alternative, so it has to count here too. (Dropping the partial unique index is
  likewise a `DROP INDEX`, not "an additive migration", as decision 2 below originally implied.)
- **plus the three operational procedures argument 3 above banks as a reason _not_ to adopt orgs** —
  the deletion runbook's step 0b, `data-inventory.md` § 8's deletion ledger, and `PRIV-3`'s scripted
  deletion with its `db:verify` proof. All three get rewritten against the Clerk API. **An argument
  cannot be weight on the "don't" side and absent from the "cost of being wrong" side**, which is what
  the first draft did.
- **plus the rest of the discard:** `HOUSEHOLD_ROLES` in `packages/shared` (const + zod + type), the
  role CHECK and its `assertCheckCoversConst` proof, the indexes, `membershipHousehold`, `db:verify`'s
  membership matrix, the new `db:mutations` patches, `architecture.md` § 4, and the claim correction
  itself — which becomes "set `clerk_org_id`", a different correction.

**And one cost of _declining_ them, listed above as a benefit of adopting and never charged to the
recommendation:** `.github/SECURITY.md` → Tokens/secrets specifies _"a separate, **org-scoped**,
least-privilege … revocable Clerk API key"_ for the v3 MCP token. With no organizations that sentence
is unbuildable as written, and no chunk here amends it (1d touches SECURITY.md only for the
shared-access-code row). It is filed in § Out-of-scope as v3's problem — **named, not silently
inherited.**

The asymmetric cost still runs the other way: adopting orgs now and reversing means unwinding vendor
state that already holds a real family's membership, with no SQL record of what it was. **The
recommendation is unchanged, and three lenses said why:** argument 2 — membership in Clerk makes
_"this user resolves to exactly this household"_ unprovable on PGlite, in the one milestone whose
deliverable is provable tenancy — is the strongest argument in the plan. **It was the arithmetic that
was dishonest, not the conclusion. The decision box stays unsigned either way.**

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

| State                              | Gate                      | Session                   | Who can reach the app                                                                         |
| ---------------------------------- | ------------------------- | ------------------------- | --------------------------------------------------------------------------------------------- |
| today                              | ✅ proxy **+ re-checked** | —                         | anyone with the shared code                                                                   |
| after **1a** (Clerk wired, dark)   | ✅ proxy **+ re-checked** | wired, authorizes nothing | anyone with the shared code. Clerk can mint a session; nothing consults it.                   |
| after **1b** (table + claim, dark) | ✅ proxy **+ re-checked** | ↑                         | unchanged. The membership row exists and nothing reads it.                                    |
| after **1c** (the boundary moves)  | ⚠️ **proxy only**         | ✅ **re-checked**         | **the code AND a session with a membership.** Strictly narrower than either state on its own. |
| after **1d** (gate retired)        | —                         | ✅ **re-checked**         | a session with a membership.                                                                  |

There is **no row in which neither holds**, and no row in which the weaker control is the only one.
The ordering constraint is one sentence: **the session must be enforced before the gate is deleted**,
which is why 1d cannot be merged before 1c, and why 1c is the chunk that owes the enumeration test
(it is the chunk whose completeness the whole cutover rests on).

⚠️ **The 1c row originally read "✅ / ✅" and that over-stated it.** § Design 2 replaces
`apps/web/lib/dal/gate.ts`'s two functions **one-for-one**, so from 1c the gate is no longer
_re-checked_ at the page/action/handler layer — it survives only as `apps/web/proxy.ts`'s bounce. That
is exactly the posture SEC-1 fixed, and `gate.ts`'s own docblock is the sentence being given up:
_"Every Server Action and every gated page calls one of these first, so a future matcher edit, rewrite
or route move can't open the app again."_ **The trade is defensible — the session is strictly stronger
than a shared code, and it is the thing that is re-checked** — but the honest statement of 1c is "a
proxy-enforced gate AND a re-checked session", not two re-checked boundaries. Saying it the loose way
understates what 1c gives up, which matters because 1c is the one-way door.

**What happens to an in-flight session at the moment of cutover** — three cases, all of them answered
from code rather than hope:

- **At 1c's deploy.** A browser holding a valid `mp_gate` cookie and no Clerk session is redirected to
  `/sign-in` **by each page's own `requireSession()`** — _not_ by the proxy, which 1c never touches
  (`apps/web/proxy.ts` is in 1a's and 1d's tables only). The export Route Handler does not redirect at
  all; it 404s. The correction does not change the conclusion, but the mechanism matters: after 1c the
  redirect is page-level, so a surface that forgets the call is open, which is why the enumeration test
  is 1c's and not 1d's. Nothing is lost: the
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

### Q3 · What PRIV-2 must land first — **a hard dependency on _configuring the production instance_, not on merging 1a**

> ⚠️ **Revised by the panel.** The first draft made `PRIV-2` a **merge** prerequisite of chunk 1a. The
> scope lens showed that costs more than it buys and that `beta-1.md` already draws the line in the
> right place: _"**Live** means `PRIV-2` has shipped `/privacy`."_ `docs/plan.md` records that PRIV-2
> is _"⚠️ Not a one-file PR"_ — it needs a markdown pipeline that does not exist, the choice is
> explicitly the maintainer's, it owes a UX reviewer, and **its acceptance carries PRIV-1's four
> unfilled blanks** (the Neon / Sentry / Vercel retention windows and a contact route, i.e. vendor
> research). At ~4h/week, making that a merge gate on 1a serializes the entire AUTH-1 chain behind an
> undecided PR, for a URL that is only needed when the **console** is configured.
>
> **So the dependency is restated, in three parts:**
>
> 1. **`PRIV-2` is a prerequisite of configuring the production Clerk instance and of ticking the
>    runbook's privacy-policy-URL box** — the point at which a consent screen needs a URL that exists.
>    It is **not** a prerequisite of merging 1a.
> 2. **1a's own prerequisite is weaker and nameable: a Clerk _development_ instance exists** (which
>    OPS-1 requires anyway for the Preview environment).
> 3. **Nothing about the privacy-doc debt is relaxed.** 1a still ships `@clerk/nextjs` to production,
>    so Clerk is a processor from 1a, and the notice/inventory edits still ride in **1a** — see "What
>    AUTH-1 owes privacy in return" below, which the panel expanded rather than shrank. The difference
>    is that a notice in `docs/` is enough for a PR whose only reachable user holds the gate code,
>    while `/privacy` is required before the consent screen is configured.
>
> The two original arguments are kept below because both are true; only the thing they gate moved.

Two separate reasons, and only the first is the one usually cited:

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

**What AUTH-1 owes privacy in return**, and it is not optional. The first draft named three edits. The
privacy lens opened both documents and found **ten**, and — the part that actually matters — found that
**chunks 1b and 1c edited no privacy document at all**, while `data-inventory.md`'s own **re-review
triggers** fire on 1a (a new processor), 1b (the schema) and 1c (the DAL and logging). So each of those
chunks owes a privacy diff, and here is the assignment:

| Goes stale                                                                                                                                                                                                                                                      | Chunk  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `notice.md` → "What is changing" + `data-inventory.md` § 7's Clerk and Google rows — **future tense, _"not wired"_**                                                                                                                                            | **1a** |
| `data-inventory.md` § 7's **egress paragraph** (_"no data egress from the browser to any external host… The egress claim is the one that holds"_) — see § Design 6b                                                                                             | **1a** |
| `notice.md` → "No tracking" (_"Your browser talks to this app and nothing else"_; _"there is no error reporting in your browser at all"_) — same cause                                                                                                          | **1a** |
| `notice.md` → "What we never ask for": _"no email address *(until sign-in arrives…)*"_ — the parenthetical stops being future tense                                                                                                                             | **1a** |
| `notice.md` → "What we never ask for": **_"no photos"_**, and `profiles.avatar` (§ 2's _"what it would then hold is a picture of a child"_) — only if the OAuth scope set includes `profile`/`picture`; see the scopes box in § Runbook                         | **1a** |
| `notice.md` → "Getting your data out" (_"ask and you will be sent a full copy"_) — the full copy now has a Clerk-held component                                                                                                                                 | **1a** |
| `data-inventory.md` header's **derivation stamp** and its staleness command, which globs `schema.ts`, `lib/dal`, `proxy.ts`, `lib/rate-limit.ts` and `.github/workflows` — AUTH-1 touches all five                                                              | 1a–1d  |
| `data-inventory.md` § 1a — **no row for `household_members`**, against a table that claims to be exhaustive (_"**18 tables**… Listed exhaustively… **absence is a claim too**"_). The count becomes 19                                                          | **1b** |
| `data-inventory.md` § 8 — the **retention** answer for a soft-deleted membership's `clerk_user_id` (§ 5: _"no hard `DELETE` anywhere… stays in the database indefinitely"_)                                                                                     | **1b** |
| `data-inventory.md` § 7's **Upstash** row and § 8's rate-limit-counter row — all four facts change (§ Design 8)                                                                                                                                                 | **1c** |
| `data-inventory.md` § 8 / `notice.md` → "How long we keep it": the **session-cookie lifetime is a Clerk fact**, not `apps/web/lib/constants.ts:COOKIE_MAX_AGE`                                                                                                  | 1c/1d  |
| `notice.md` → "Who can see it" limitations **1** and **3** (_"one shared access code… no way to revoke access for one person"_; _"anyone with your access code can download any athlete's full history"_) — `notice.md` was **absent from 1d's table entirely** | **1d** |
| `data-inventory.md` § 4's **two** AUTH-1 rows — the shared-access-code row **and** the export-route row, whose _"the consequence has NOT changed"_ paragraph is what AUTH-1 discharges                                                                          | **1d** |

The timing argument is unchanged and is why 1a carries the bulk: the inventory's own standard is "what
the running system does", and the moment `@clerk/nextjs` is in a `package.json` deployed to production,
Clerk is a processor. Checklist box (d) says "before sign-in goes live"; 1a is the earliest honest
moment and the one where the diff that makes it true is visible.

### Q4 · `SEC-6`'s seeded ids — **the rotation stays its own row; AUTH-1 must simply not depend on them**

ADR 0006 already decided this once, and it decided it the right way:

> ✅ **The seed-id rotation is filed as its own row (`SEC-6`), not folded into AUTH-1.** It is live
> today and independent of addressing, so attaching it to AUTH-1 would gate a current exposure on the
> AUTH-1 chain.

That reasoning is unchanged by the claim correction, **provided the correction does not hardcode the
household it claims.** So the design constraint is the inverse of the question: rather than AUTH-1
absorbing SEC-6, **AUTH-1 is built to be rotation-agnostic.**

🔴 **But "the two rows can then land in either order with no interaction" was false, and the panel's
security lens found why.** The _correction_ is rotation-agnostic; the **seed is not**, and it runs
against production on every push:

- `packages/db/src/seed.ts` inserts the household with
  `.onConflictDoNothing({ target: schema.households.publicId })` — the arbiter is the **committed
  constant** `packages/shared/src/seed-ids.ts:SEED_HOUSEHOLD_PUBLIC_ID`.
- `.github/workflows/migrate.yml` runs `pnpm --filter @mat-plan/db db:seed` against **production** on
  every push to `main`, by design (_"safe to always run… `db:seed` is idempotent"_).
- SEC-6's fix **necessarily changes that constant**. If the new constant lands on `main` before the
  rotation correction has run in production, the next seed's arbiter matches nothing and **inserts a
  second live household, plus two seed profiles into it.**

So the two rows commute **only after 1b makes the seed's household insert conditional on no live
household existing** — an existence check, not a `public_id` arbiter. That edit is now 1b's, with its
reason, and it is what makes Q4's claim true rather than hopeful. It is also one half of the fix for
Q5's non-request path; see Q5.

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

- create a household from any **request** path (above);
- 🔴 **leave a _non-request_ path that can create household #2 — and there is one, it is automated, and
  the first draft of this list missed it entirely.** `packages/db/src/seed.ts` + `migrate.yml` seed
  **production** on every push, keyed on the committed `SEED_HOUSEHOLD_PUBLIC_ID` (Q4). Rotate that
  constant before the rotation correction has run and the next seed inserts a second live household.
  Q5's own sentence — _"household #2 then comes into existence only through an operator action"_ — was
  therefore wrong. **1b makes the seed's household insert conditional on no live household existing**,
  with the reason in the code, and `db:verify` asserts that seeding a database which already holds one
  live household **with a different `public_id`** creates no second row;
- 🔴 **lose the loud detector when the throw goes.** Today household #2 is **loud**:
  `getHouseholdScope()` throws on ≥2 rows from `liveHouseholdIds`. After 1c the resolver is
  session-driven and that throw is gone — so a seed-created household #2 becomes **silent**, exactly
  when `TEN-1` 1d's proven cross-tenant catalog **write** primitive
  (`apps/web/lib/dal/catalog.ts:findOrCreateMovementId`) is live. The resolver no longer needs the
  count; **the operator does.** So 1c emits a Sentry **message** (not an exception — the same posture
  `getHouseholdScope`'s zero-household `captureMessage` already takes) when `liveHouseholdIds` returns
  ≥2, reading _"the catalog leak's precondition is met and TEN-2b has not landed"_, with a
  `docs/runbooks.md` alert row. The first draft discharged this with a sentence in a PR body, which is
  not a detector. **This is also why `liveHouseholdIds` survives 1c** — see § Design 3;
- **weaken the record of what moved.** The `findOrCreateMovementId` allowlist entry in
  `apps/web/lib/dal/scoped.test.ts` is still standing and TEN-2's dead-entry assertion is what deletes
  it. 1c **says in the PR body that the catalog leak is now gated only by TEN-2b, the invite and the
  new ≥2-household alert**, so the transfer of that guarantee from code to schedule is recorded where a
  reviewer sees it;
- claim in any document that isolation is complete. After AUTH-1 it is complete **except the movement
  catalog**, which is proved to leak. `docs/features/write-path.md`'s invariant 2 already carries that
  carve-out in red; 1c must not tidy it.

**One thing Q5 leaves genuinely open, named rather than hidden.** After AUTH-1 the system has **no
sanctioned way to make its second tenant at all** — `households` rows come only from `seed.ts`, and
there is no create script, correction or action. Deferring the request path (above) is right; leaving
no path is how hand-written production SQL becomes the de facto one, which is the thing
`packages/db/scripts/corrections/` exists to prevent. **So: the second household arrives via a
`TEN-2b`-gated correction or script, and that is `TEN-2b`'s or the invite row's deliverable, not
AUTH-1's.** Recorded in § Out-of-scope so it is a deferral rather than an omission.

### Q6 · How big is this really? — **six chunks, and the panel moved one boundary the first draft said could not move**

> 🔴 **Revised by the panel; this is the largest single change it made.** The first draft said "four
> chunks, and none of the three boundaries can move". Two independent lenses (scope, architecture)
> showed that **one of them had to move**, and a third (scope) showed the line estimates were refuted
> by this repo's own history. Both corrections are below, then the revised table.
>
> **1 · The Clerk/Playwright/screenshot story is a prerequisite of 1c, not 1d.** The first draft
> asserted twice that 1c was insulated — _"1c keeps the existing smoke green **through the gate**,
> which is possible because the gate is still enforced"_ and _"1c keeps the gate path working for the
> screenshot script only"_. **Both are false, and Q2's own AND-composition says why: the gate
> surviving is necessary, not sufficient.** From the code:
>
> - `apps/web/e2e/gate-login.ts:gateLogin` ends `await page.waitForURL(APP_HOME_PATH)` then asserts the
>   picker heading is visible. After 1c, `apps/web/app/p/page.tsx` calls `requireSession()` →
>   `redirect(SIGN_IN_PATH)`, so `gateLogin` never reaches `/p`.
> - `apps/web/e2e/global.setup.ts` mints `storageState` via `gateLogin` and the chromium project has
>   `dependencies: ['setup']` — so **every spec in the smoke goes red at 1c**.
> - `apps/web/scripts/capture.ts` (`if (!isUngatedPath(pathname)) await gateLogin(page)`) fails
>   identically, which takes `pnpm --filter web screenshot:ephemeral` with it — **taxing every
>   subsequent UI PR in the repo, not just AUTH-1's.**
> - There is **no** "keep the gate path working for the screenshot script only": `requireSession()`
>   lives in the app and has no per-caller branch. The only mechanism is a test-only session the app
>   honours — the option § Design 10 calls _"the single worst place in this repo to put one"_.
> - And a second half the first draft never stated: **1b deliberately makes the seed write no
>   membership row** (correctly — `migrate.yml` seeds production). So even a minted Clerk session lands
>   in state **C**. The ephemeral fixture needs a membership row the seed is forbidden to create.
> - It also means **1c cannot satisfy the repo's own UI rules for its own new screen**: the "this
>   account has no household" screen owes a full 3-lens UX panel and Playwright screenshots at three
>   widths, and that state is unreachable from `screenshot:ephemeral` at 1c by construction.
>
> **So § Design 10's resolution becomes chunk `1c-pre`, landed while the gate still works** — which is
> the same AND-composition argument this plan uses everywhere else, and it leaves 1d a pure deletion.
>
> **2 · Pre-split, don't contingently split.** The first draft's trigger was _"if 1c exceeds ~400
> lines, lift the enumeration test"_ — a judgement made under pressure, after 1c is written. **This
> repo has already run that experiment and it failed:** `docs/plans/ten-1-household-scope.md`'s panel
> finding P7 was accepted with exactly that contingency (_"if 1b exceeds ~400 lines, the full matrix
> moves to 1c"_), 1b was budgeted _"~400 lines of non-test source"_, and the same row records **"As
> built: ~2,000 lines across 27 files."** The merged chunks are **1,054 and 1,710 insertions**
> (`f68cf0f`, `f7f7fd6`) — so AUTH-1's whole-feature estimate of ~1,100–1,400 was below what TEN-1's
> last **two** chunks cost. The enumeration guard is inert and revert-safe and lands **before** 1c as
> `1b-bis`, which converts 1c's largest unknown (an entry point nobody converted) into a verified fact.
> **The `~Lines` column is relabelled "non-test source, order of magnitude" and is not a budget.**

Six chunks. The boundaries are not convenience; each is "the previous thing must be **deployed or
run** before the next can be written".

| Chunk      | What                                                                                                                                                                                                                                                                                                                                                 | Non-test source (order of magnitude, **not a budget**) | Why the boundary before it cannot move                                                                                                                                                                                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1a**     | Clerk wired and dark: dependency, env (both keys **optional**, composed only when present), **the CSP widening** (§ Design 6b), `clerkMiddleware` composed into `proxy.ts` behind the gate with a stated order and response merge, `/sign-in`, the `access-gate.ts` split, the `/api` matcher fix + its tech-debt strike, the privacy-doc edits (Q3) | ~350–450                                               | —                                                                                                                                                                                                                                                                                       |
| **1b-bis** | The **enumeration guard alone**, asserted against `hasGateAccess` — plus `apps/web/test/source-scan.ts` and the single-source action list (§ Design 7)                                                                                                                                                                                               | ~150                                                   | Needs only 1a's merge, and nothing at all in principle. **Landed early on purpose**: it is inert, revert-safe, and it turns 1c's biggest unknown into a verified fact before 1c is written.                                                                                             |
| **1b**     | `household_members` (migration `0015`), the `insertHouseholdMember` writer, the claim correction, the seed's existence check (Q4/Q5), the constraint + membership proofs, the deletion-order runbook edit — all dark                                                                                                                                 | ~300–400                                               | **The maintainer cannot be bound to a household until they have a Clerk user id**, and they get one by signing in — which needs 1a deployed. A correction cannot name a user that does not exist.                                                                                       |
| **1c-pre** | § Design 10's answer: the Playwright/screenshot session story, **landed while the gate still works**                                                                                                                                                                                                                                                 | ~200, **or its own plan**                              | **It must exist before 1c, because 1c breaks the smoke and `screenshot:ephemeral` the moment `requireSession()` lands** (above). Landing it while the gate still works is the AND-composition argument again.                                                                           |
| **1c**     | The boundary moves: `getCurrentUser()` + `householdState()`, `getHouseholdScope()`'s new body, `requireSession` across **12** entry points (7 actions + 4 pages + 1 Route Handler), the mutation limiter, the no-household screen, `pages-are-gated.test.ts`'s conversion, the ≥2-household alert                                                    | ~500–700                                               | **The membership row must exist in production before any code reads it.** A resolver deployed ahead of `0015` is `42P01` on every route — a total outage, not a dark app. TEN-1 § Design 1a paid for this hazard once already and the answer was "land the column dark, read it later". |
| **1d**     | Retire the gate: delete `/gate`, `lib/dal/gate.ts`, the gate half of `access-gate.ts`, `ACCESS_GATE_PASSWORD` from **all 19 sites**, `GATE_COPY`, the gate's e2e specs; `mp_gate` deleted on the next response                                                                                                                                       | ~400–500                                               | **Deleting the gate before the session is enforced is the window where neither holds.** This is the whole ordering constraint of Q2.                                                                                                                                                    |

⚠️ **The 1c row says 12 entry points; the first draft said 11.** § Design 2's own table lists 7 actions

- 4 pages + 1 Route Handler. The 11 came from `reportScopeMiss`'s docblock, which counts _"11
  profile-addressed entry points"_ — a different set. The enumeration test's non-vacuity floor depends on
  counting right, so it is derived from the single-source action list (§ Design 7), never re-typed.

**What stayed folded, and what unfolded.**

- **Still folded: the table and the correction are one PR (1b)**, because a correction merges before it
  runs (`corrections/README.md` → **Applied** _"a row lands here as `pending` and is dated in a
  follow-up commit"_), so "migration + correction, both inert, run the correction between 1b and 1c" is
  one PR and one operator action, not two.
- **Still folded: the rate limiter is in 1c**, because the identifier it needs — the Clerk user id —
  first exists in 1c, and the gate's limiter (the only limiter today) stands until 1d, so there is
  never an unlimited window. ⚠️ **But see § Design 8: it is not the one-line change the first draft
  described**, and whether it belongs in AUTH-1 at all is now an open question for the maintainer,
  because cutting it edits a signed milestone deliverable.
- **Unfolded: the enumeration guard is `1b-bis`, pre-split** (above), not a contingency.
- **Unfolded: § Design 10's answer is `1c-pre`** (above), not 1d's problem.

**One boundary claim the first draft got wrong, stated so the others are not read as soft.** The
preamble said each boundary is _"the previous thing must be **deployed or run** before the next can be
written"_. That is true of **1b→1c** (R1: a resolver ahead of `0015` is `42P01`) and of **1c-pre→1c**
and **1c→1d**. It is **not** true of **1a→1b**: 1b's artifacts are a migration and a `Correction` whose
household id and Clerk user id both come from the environment **at run time** (§ Design 5), so nothing
in 1b needs a Clerk user id to exist in order to be written, reviewed or merged — only to be **run**.
The 1a→1b boundary is a concern separation plus R8's cheap-failure argument. Both are good reasons;
they are just different reasons, and saying so stops a reader discovering the rule does not hold and
concluding the rest are soft.

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

Three properties the implementation must have, the third added by the panel:

- **`auth()` inside a `try`, `null` on throw.** Clerk's `auth()` is documented to throw when
  `clerkMiddleware()` has not run. Letting that propagate turns a matcher gap into a 500; returning
  `null` turns it into a refusal. _Fail closed_ is the exit criterion's own word.
- **`cache()`d, so one request resolves one principal.** Same precedent as
  `apps/web/lib/dal/catalog.ts` and `getHouseholdScope` itself, and the same honest caveat: `cache()`
  is **per-request** React `cache`, never cross-request — a performance device here, not a correctness
  device. Saying that in the docblock is cheap and forestalls the misreading that matters most.
- 🔴 **The swallowed throw must be LOUD to a dashboard.** Swallowing it is right; swallowing it
  **silently** is not, and the first draft's sketch had no capture. Compose it with § Design 2/3: a
  sessionless caller, a member-less principal, a wrong household and an unknown id all produce the
  **same bytes** — so a wholly misconfigured Clerk produces an app that refuses _everyone_ with
  `NO_PROFILE_LOG`/404 while emitting, at most, `no_scope` events indistinguishable from ordinary
  anonymous probing. The runbook's scope-miss alert is the only consumer and it cannot tell the two
  apart. **The repo's own answer is the opposite of silence:** `getHouseholdScope`'s zero-household
  branch emits `Sentry.captureMessage(…, { tags: { scope_outcome: 'no_household' } })` and its docblock
  argues why — _"A Sentry message is loud to a dashboard; the empty state is what a parent reads on a
  gym floor at 6:30pm."_ So the `catch` captures, tagged `auth_outcome: 'auth_unavailable'`, carrying
  **no headers, no cookie and no `params`** (SEC-3's scar — `reportScopeMiss`'s docblock states the
  rule), with a Vitest case asserting both that it fires **and** that nothing header-shaped is
  attached. That outcome value is also the honest resolution of Open question 5 — see § Design 3.

### 2 · The refusal — **one module, and the principal is returned, not just a boolean**

> 🔴 **Revised by the panel; two lenses (reuse, architecture) found the same two faults.**
>
> **Fault 1 — `hasSession(): Promise<boolean>` is the wrong shape.** The first draft replaced
> `hasGateAccess` _"shape-for-shape"_, which works only because the gate has no principal. But
> § Design 8 then needs ``checkRateLimit(`mutate:${userId}`)`` _"after `hasSession()`"_ — **and a
> boolean cannot supply a `userId`.** Every one of the seven actions would call `getCurrentUser()` a
> second time to get the key it had just proved exists, which is two shapes asking one question at one
> call site; worse, § Design 7's source guard would then match the **weaker** of the two calls.
> `apps/web/lib/rate-limit.ts`'s own docblock already names the right shape: _"Mutation limits land
> with Clerk at v1.5, when **`getCurrentUser()`** provides a real identifier."_
>
> **Fault 2 — the module split was left to "a 1c detail", in a plan whose job is to decide it.** The
> first draft said _"New in `apps/web/lib/dal/session.ts` (or `user.ts`; placement is a 1c detail)"_
> while 1c's file table committed to **both** as NEW. Today `apps/web/lib/dal/gate.ts` holds the
> predicate **and** the redirect in one 28-line module, and `catalog.ts` / `household.ts` both keep a
> resolver and its satellites together. A `session.ts` whose functions are thin wrappers over
> `user.ts`'s one is a split personality, not a seam. **Decided: one module.**

**`apps/web/lib/dal/session.ts`**, `import 'server-only'`, holding `getCurrentUser()` (§ Design 1) and
the two refusals built on it:

| Today (`lib/dal/gate.ts`)                                   | 1c                                                                                       | Call sites                                                                                                                                                              |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hasGateAccess(): Promise<boolean>`                         | **`sessionUserOrNull(): Promise<{ userId: string } \| null>`** — the principal or `null` | the 7 actions' first line, and the export Route Handler (which today calls `isValidGateCookie` **directly**, not `hasGateAccess` — one of the two shapes 1c normalises) |
| `requireGatedPage(): Promise<void>` → `redirect(GATE_PATH)` | **`requireSession(): Promise<{ userId: string }>`** → `redirect(SIGN_IN_PATH)`           | the 4 gated pages                                                                                                                                                       |

So an action gets its refusal **and** its limiter key from one call:

```ts
const user = await sessionUserOrNull();
if (!user) return { ok: false, error: NO_PROFILE_LOG };
const limit = await checkMutationLimit(user.userId); // § Design 8
```

`getCurrentUser()` stays the one place `auth()` is called; these two are its only consumers, and
§ Design 7's accepted call set is **exactly these two names** — so the guard and the code are one rule
rather than two.

The refusal copy does not change. `NO_PROFILE_LOG` / `NO_PROFILE_SAVE` already carry the
one-answer-for-three-states argument (`apps/web/lib/constants.ts`), and ADR 0006 made the byte-identity
structural. **A sessionless caller gets the same refusal as a wrong household and an unknown id** —
which is now a fourth state folded into the same answer, and the reason the enumeration test asserts
through the const.

### 3 · `getHouseholdScope()` — the new body, its FIVE outcomes, and the predicate written out

Only the body changes (promise 1, verified against `main`). **The first draft of this section was the
single most heavily corrected part of the plan** — two lenses independently found that the resolution
as described dropped the conjunct TEN-1 extracted the query to protect, and that the B/C discriminator
answered a question nobody asks.

#### 3.1 · The predicate, written out — because the first draft only named the function

The first draft said: _"a `membershipHousehold(db, clerkUserId)` query beside `liveHouseholdIds`,
single-sourced so `db:verify` proves **this** query"_. The shape is right. **The predicate was never
written down, and both missing conjuncts are ones this plan itself proves matter.**

```sql
-- packages/db/src/queries/household-membership.ts : membershipHousehold(db, clerkUserId)
SELECT h.id
  FROM household_members m
  JOIN households h ON h.id = m.household_id
 WHERE m.clerk_user_id = $1
   AND m.deleted_at IS NULL      -- the membership is live
   AND h.deleted_at IS NULL      -- 🔴 AND SO IS THE HOUSEHOLD
 LIMIT 2                         -- an AMBIGUITY PROBE, not a pick. No ORDER BY.
```

- 🔴 **`h.deleted_at IS NULL` is the conjunct the first draft lost.**
  `packages/db/src/queries/household-scope.ts:liveHouseholdIds`'s docblock states why that function
  exists at all: _"**`deleted_at IS NULL` is the load-bearing conjunct** … a soft-deleted household
  must stop resolving, so its profiles become unreachable even though `profiles.household_id` still
  points at it."_ Without it, **a live membership pointing at a soft-deleted household _resurrects_
  that household's profiles for its member** — the exact thing TEN-1 paid to prevent. And the state is
  not hypothetical: it is **the same state this plan's own promise-5 finding is about.** Test-plan
  assertion 4 proved a soft-deleted _membership_ stops resolving; nothing proved a soft-deleted
  _household_ does.
- 🔴 **`LIMIT 2` and no `ORDER BY`, for `liveHouseholdIds`'s stated reason:** _"`LIMIT 2` is an
  AMBIGUITY PROBE, not a pick … 'just use the first one' is a silent cross-wire between two families."_
  Written with `limit(1)`, **state D below is undetectable in the app**, and the only guard left is the
  partial unique index that § Design 4 decision 2 says `COACH-1` removes.
- **Select `households.id` only — never `households.synthetic`.** `getHouseholdScope`'s docblock records
  why: that column ships dark until OBS-2, and reading it would make a deploy landing ahead of migration
  `0014` a `42703` on every route.
- **Module:** `packages/db/src/queries/household-membership.ts`, **not** "beside `liveHouseholdIds`" —
  see 3.4 for why that module's own docblock makes "beside" the wrong place.

#### 3.2 · The five outcome states

| #      | State                                              | Today                          | After 1c                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------ | -------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A      | resolved                                           | exactly one live household     | the session's user has exactly one live membership **to a live household** → that household                                                                                                                                                                                                                                                                                                                                   |
| B      | no principal                                       | n/a                            | `getCurrentUser()` → `null`. **Return `null`.** The caller already maps `null` → the existing 404/refusal path.                                                                                                                                                                                                                                                                                                               |
| **B′** | **the table is not there yet**                     | n/a                            | 🔴 **New, from the panel.** A `42P01`/`42703` from `membershipHousehold` is caught and returns **`null`** — the no-household state the app already has a screen for. § Design 1 wraps `auth()` in a `try` so a _matcher_ gap is a refusal rather than a 500; **the same two lines must make a _schema_ gap a refusal rather than a total outage** (R1's own words). Tagged `scope_outcome: 'schema_missing'`, loud to Sentry. |
| C      | a principal with **no** membership                 | n/a                            | **Return `null`, and render a DIFFERENT screen** — see 3.3. A Sentry **message**, not an exception.                                                                                                                                                                                                                                                                                                                           |
| D      | a principal with **more than one** live membership | ≥2 live households → **throw** | **Still throw** — and 3.1's `LIMIT 2` is what makes it detectable. Beta 0 has one household per person; two memberships is an invariant violation, not a choice.                                                                                                                                                                                                                                                              |

⚠️ **State D's "multi-household belongs to `COACH-1`" was wrong and the first draft repeated a folding
ADR 0006's own panel rejected** (its architecture lens, A5). Multi-**membership** is the
`getHouseholdScope(profilePublicId)` **inversion** the ADR owns; `COACH-1` is a _grant_ that widens the
seam's **return type**. § Out-of-scope now names the inversion path rather than re-folding them.

#### 3.3 · The B/C screen — and why the first draft's discriminator could not work

**The trap.** Today `null` renders the picker's empty state. TEN-1's § Design 1a split zero from ≥2
**precisely** so an invariant violation would not be reported to a parent as "your data does not
exist". AUTH-1 re-creates the hazard in a new place: state **C** is a signed-in human with no
household.

⚠️ **The copy the first draft quoted is stale.** It said _"No profiles found. Seed the database to get
started."_; `ONB-0` replaced that with `apps/web/lib/constants.ts:PICKER_EMPTY_COPY` — _"No athletes
yet"_ / _"Adding an athlete isn't in the app yet — it takes a change to this deployment's seed data"_,
plus a GitHub link. **The trap argument gets stronger with the real copy, not weaker:** telling a
signed-in parent with no household to change this deployment's seed data, with a link to a repository,
is worse than useless.

🔴 **And the first draft's discriminator answers the wrong question.** It recommended _"have the
**page** ask `getCurrentUser()` for the B/C distinction"_. But at the picker **B is already
unreachable**: `apps/web/app/p/page.tsx` awaits `requireSession()` first, so a null principal has
redirected before any scope resolves. The distinction the page actually needs is **C vs A-with-zero-
profiles** — and `getCurrentUser()` returns a non-null principal in _both_.
`apps/web/lib/dal/profiles.ts:listProfiles` returns `[]` for both (`if (!scope) return []`), and the
page's only branch is `profiles.length === 0` → `PickerEmptyState`. **So state C lands on
`PICKER_EMPTY_COPY`, which is acceptance criterion 6's explicit failure.** The obvious patch is worse:
having the page call `getHouseholdScope()` puts a `HouseholdScope` in `app/`, breaking promise 2 and
`write-path.md` invariant 2.

**Decided: one boolean in the DAL, not a branch in the page.** 1c adds
`apps/web/lib/dal/session.ts:householdState(): Promise<'none' | 'resolved'>`, derived from the same
`cache()`d resolver and **returning no scope**. One new DAL export, one page branch, all 14 existing
call sites untouched, the DAL's return type unchanged, and `PickerEmptyState` keeps its real meaning (a
household with no athletes _yet_). So 1c owes:

- a distinct **"this account has no household"** screen, with the honest next step (contact the person
  who invited you — Beta 0 has no self-serve household creation, by Q5);
- `householdState()` as the discriminator, in the DAL, where the scope already lives.

#### 3.4 · `liveHouseholdIds` SURVIVES 1c — and three committed claims say it does not

Two lenses found this independently. `packages/db/src/queries/household-scope.ts:liveHouseholdIds`'s
docblock ends: _"AUTH-1 replaces `getHouseholdScope()`'s body … at which point this query stops being
the resolution and **this module goes with it**."_ It has **three** consumers on `main`, and two are
not requests:

- `apps/web/lib/dal/household.ts` — 1c removes this one **as the resolution**, but Q5 now requires 1c
  to keep calling it for the **≥2-live-households alert**;
- `apps/web/scripts/screenshot-ephemeral.ts` — the **one** allowlisted fixture deriver
  (`packages/db/src/scope.test.ts:FIXTURE_DERIVES_SCOPE`), which _derives_ rather than naming an id
  precisely so it needs no script constructor;
- `packages/db/scripts/verify.ts` — labelled _"(0) The RESOLVER's own query (`liveHouseholdIds`, the
  one `getHouseholdScope()` runs)"_.

**So the function stays, the module stays, and three committed claims become false at 1c.** 1c
therefore: states that `liveHouseholdIds` is retained and for which consumers, **corrects its own
docblock**, **re-labels `verify.ts` section (0)** so it stops claiming to be the resolver's query, and
folds `write-path.md`'s fixture bullet (_"It **derives** one … through `liveHouseholdIds`, the
resolver's own probe"_) into its guide edit. Otherwise the next reader deletes a function two proofs
depend on — which is the same class of defect as promise 5, one chunk later.

#### 3.5 · `reportScopeMiss`, and the Sentry rule that has to be repo-wide

`reportScopeMiss` changes in three places, all typed so the compiler finds them:

- `ScopeMissEvent['actor']` is the literal `'gate_session'`. It becomes the **presence** of a principal,
  never the id — its own docblock forbids an owner↔requester linkage in a third-party store over
  minors' health data, and a requester id is the other half of that linkage. The privacy lens confirmed
  the event **does not already create the linkage** (`resource` is the profile `public_id` the caller
  already sent; no household id is in the payload), so keeping the id out is sufficient _for this
  event_. ⚠️ **But the recommended union `'session' | 'anonymous'` ships a dead member:** after 1c every
  caller of `getProfileByPublicId` refuses before the DAL, so `reportScopeMiss` only ever fires with a
  session, and the runbook's alert rule would inherit an unreachable value. **The honest third value is
  § Design 1's: `auth_unavailable`.** Recommended shape: a `SCOPE_MISS_ACTOR` `as const` map beside
  `SCOPE_MISS_OUTCOME` and `SCOPE_MISS_ACTION`, so the file keeps one idiom and `household.test.ts` has
  something to import rather than a re-typed literal. **Open question 5 stays unsigned** — this narrows
  the recommendation, it does not sign it.
- `SCOPE_MISS_OUTCOME.noScope`'s meaning moves from _"the database has no live household"_ to _"this
  principal has no membership"_. Same string, different cause.
- **The runbook edit is bigger than "the alert rule".** 1c must re-read `docs/runbooks.md` → "A
  cross-household scope miss" for: `actor`'s new values, `no_scope`'s new cause, **promise 5's
  correction** (`cross_household` was reachable before AUTH-1, via a soft-deleted household — so a
  pre-AUTH-1 event was never proof of an emitter bug), **triage step 2's remedy** (_"Rotate the
  access-gate code"_, which does not exist after 1d), and **triage step 4** (the
  `household scope is ambiguous` outage, whose condition state D changes).

🔴 **And one rule this section cannot keep local, from the privacy lens.** The `actor` fix guards one
event; the hazard after AUTH-1 is global, in two ways:

- **AGENTS.md → Server conventions → Observability says, verbatim:** _"Sentry — … `enableLogs` +
  structured context (**userId, householdId**, batchId)."_ Followed literally in 1c that puts exactly
  the forbidden pair on **every** event. **An implementer reading AGENTS.md will add it.**
- **`apps/web/lib/sentry-scrub.ts:scrubSentryEvent` never touches `event.user`** — verified on `main`;
  the only occurrence of "user" in that file is a comment. So a `Sentry.setUser({ id: clerkUserId })`,
  whether ours or the Clerk SDK's own integration, ships unscrubbed. `dataCollection`'s
  `userInfo: false` governs the **SDK's** collection, not an explicit `setUser` — **verify, do not
  assume**, off the Sentry 11 docs at the pinned version, the way dependency PR `38f62de` did.

**So 1c states it repo-wide: no Clerk user id and no household id reaches Sentry at all in Beta 0.**
It adds `event.user` (and `contexts.user`) deletion to `scrubSentryEvent` with a unit test, so a later
`setUser` cannot reopen it, and it files a one-line amendment to AGENTS.md → Observability recording
that this app's `userId`/`householdId` context is deliberately **not** set, and why. Otherwise the two
documents contradict each other and the next action author resolves it the wrong way.

### 4 · `household_members` — migration `0015`

Latest migration is `0014_household_synthetic` (`packages/db/migrations/meta/_journal.json`, 15
entries, `idx: 14`) — **re-confirmed against `main` by the DB-safety lens**, so `0015` is still the
right number. It is **additive only** — a new table, so Squawk's destructive rules do not engage and
expand→contract has nothing to contract.

✅ **Squawk passes this DDL as written, and the lens ran the real gate to find out** (`squawk-cli`
2.66.0 against `.squawk.toml`, on a drizzle-shaped `0015` built from this section): **0 issues, no
`-- squawk-ignore` needed anywhere.** The same `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY` in a file
that does _not_ create the table fires three warnings, so the exemption is Squawk tracking "created in
this file", not luck. `packages/db/migrations/0011_gap3_quantities_expand.sql` is the in-repo precedent
(new table, three un-`NOT VALID` FKs, partial unique indexes, passed the gate).

```sql
-- CREATE TABLE emits the columns, the PK, the CHECK and the column UNIQUE …
household_members
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY
  public_id      uuid NOT NULL UNIQUE                -- UUIDv7 from newId(); see decision 4
  household_id   bigint NOT NULL                     -- FK added separately, below
  clerk_user_id  text NOT NULL
  role           text NOT NULL                        -- text + CHECK; NO native pgEnum (AGENTS.md)
  created_at / updated_at / deleted_at                -- the shared `timestamps` helper
  CONSTRAINT household_members_role_check CHECK (role IN ('owner','member'))   -- literals INLINED; see decision 1

-- … then a separate ALTER TABLE …
ALTER TABLE household_members ADD CONSTRAINT household_members_household_id_fk
  FOREIGN KEY (household_id) REFERENCES households(id);   -- ON DELETE NO ACTION; see decision 6

-- … then separate CREATE INDEX statements.
CREATE INDEX idx_household_members_household ON household_members (household_id);
CREATE UNIQUE INDEX uq_household_members_clerk_user ON household_members (clerk_user_id)
  WHERE deleted_at IS NULL;   -- state D's constraint AND the resolver's access path
```

Seven decisions, each with its reason:

1. 🔴 **`role` is `text` + `CHECK` whose literals are INLINED, with `db:verify` binding them to
   `packages/shared`.** The first draft said the CHECK is _"sourced from"_ `HOUSEHOLD_ROLES` and cited
   `profiles_kind_check` as the precedent. **Two lenses showed both halves are wrong:**
   - **Interpolating a const into drizzle's `sql` template emits a bound parameter, not DDL.**
     `packages/db/migrations/0012_bodyweight_one_per_day.sql` says so in its own comment: _"The
     literals are deliberate (drizzle-kit renders an interpolated const as `$1` in DDL)."_ Every CHECK
     in `packages/db/src/schema.ts` therefore hardcodes its literals, and `schema.ts` states the rule
     next to `DAY_ROLES`: _"Inlines the shared … literals (**a CHECK can't import a const**);
     db:verify pins the accepted set … via assertCheckCoversConst."_
   - **`profiles_kind_check` is the one enum CHECK with NO `assertCheckCoversConst` call** — a comment
     only. Citing it reproduced the single gap in the file instead of the pattern. The real mechanism
     is `packages/db/scripts/verify.ts:assertCheckCoversConst`, which reads `pg_get_constraintdef` and
     asserts the CHECK's literal set **equals** the shared const in both directions. **Eight**
     constraints are pinned that way (`units_dimension_check`, `quantity_slots_dimension_check`,
     `activity_types_input_shape_check`, `movements_pattern_check`, the two `metric_definitions_*`,
     `sessions_day_role_check`, `prescriptions_day_role_check`).

   So: `HOUSEHOLD_ROLES` goes in `packages/shared/src/enums.ts` (decision 7), the CHECK **inlines**
   `('owner','member')` with the standard mirror comment, and the Test plan adds
   `assertCheckCoversConst('household_members_role_check', HOUSEHOLD_ROLES)`. Cite
   `sessions_day_role_check` as the precedent, never `profiles.kind`. **Two values, not four**; Beta 1's
   `COACH-1` is a cross-household grant and gets its own shape, not a role string reserved in advance.

2. **`uq_household_members_clerk_user` — ONE partial unique index, not two indexes.** The first draft
   also listed `idx_household_members_clerk_user (clerk_user_id) WHERE deleted_at IS NULL`. **That is
   the same column with the same predicate**; a partial unique index is a btree index and already
   serves the resolver's `WHERE clerk_user_id = $1 AND deleted_at IS NULL` lookup, so the second buys
   nothing and costs a write on every insert and soft-delete. Repo precedent agrees: `uq_entries_client_id`
   is a partial unique on `client_id` with no companion `idx_entries_client`. AGENTS.md → Schema
   conventions caps indexes at ~5–10/table; this table needs two. Renamed to `uq_` per the repo's
   `uq_` vs `idx_` convention, and the SQL comment says it is **both** the state-D constraint and the
   access path. ⚠️ It is the line `COACH-1` removes — which is a `DROP INDEX`, **not** "an additive
   migration" as the first draft said (see Q1's corrected pricing).

   **Pushed back:** the architecture lens suggested _also_ adding the permanent
   `UNIQUE (household_id, clerk_user_id) WHERE deleted_at IS NULL` now, so Beta 1 drops one index
   instead of dropping one and adding another. **Rejected as YAGNI** — Beta 0 has one member, the
   second index is unreachable until `COACH-1` exists, and a `CREATE UNIQUE INDEX` is the single
   cheapest migration this repo writes. `COACH-1` can add it in the PR that needs it.

3. **`clerk_user_id` is `text`, not a FK to anything.** There is no users table and will not be one in
   Beta 0: the person's email and Google identifier live in Clerk, which is the point of using Clerk
   (`data-inventory.md` § 7). Storing the Clerk id and nothing else is the data-minimisation answer —
   **no email column.** ⚠️ **Two consequences the first draft did not state, both now owed to
   `data-inventory.md` in 1b** (Q3): it is a **new identifier class** the database did not hold before
   (an opaque but _stable_ third-party account id for a named adult), and because § 5 of that document
   records _"no hard `DELETE` anywhere … a soft-deleted row **stays in the database indefinitely** …
   Nothing purges them"_, **a soft-deleted membership retains that identifier indefinitely** — the
   household deletion (decision 6) is its only purge. § 8 gets a retention row saying so.
4. **`public_id` even though nothing addresses a membership by URL yet** — but **not** because "the
   Keys rule is unconditional", which the first draft claimed and two lenses corrected. The rule is
   scoped to _"Public/URL/API IDs"_, and `packages/db/src/schema.ts:entrySetQuantities` is a
   household-reachable table with **no** `public_id` — the in-repo counter-example. The honest
   justification is **precedent plus cheapness**: all 15 entity tables carry `publicId` and only the
   three reference tables do not, and the deletion runbook and `PRIV-3` will want a stable non-internal
   handle. Costs one column. **No `client_id`**, and the reason is the config-table idiom `schema.ts`
   already states for the prescriptions/program blocks (_"Config → no client_id; natural key …"_): a
   membership is never written by an offline client.
5. **No `consent_at` column**, deliberately. `runbooks.md`'s checklist box (c) already decided it:
   _"Beta 0 has no account table and no consent column, so **the invitation is the record**… Storing a
   consent timestamp is a Beta 1 item."_ Adding one here would be a new personal-data field with no
   consumer. 🔴 **But the privacy lens found the gap is elsewhere, and it is real: nowhere in the repo
   says where the invitation record lives, what it contains, or how long it is kept.** Contrast the
   deletion ledger, which got an explicit where-it-lives / field-table / retention spec in the same
   runbook. Without that, AUTH-1 **cannot show consent was given** for a household whose children's
   health data it holds — which is the substance, independent of whether a column is the vehicle. So
   **1a specifies the invitation record the way the ledger is specified**: where it lives (outside git,
   with the operational credentials), its fields (the invited email, the date asked, the date accepted,
   the notice version linked), and its retention — as a runbook box, so ticking it requires recording
   what was written. And 1a's notice edit must **name the mechanism box (b) actually returns**, because
   `notice.md` → "What is changing" already _promises_ _"you will be asked to agree to it as part of
   signing up"_.
6. 🔴 **The FK is `ON DELETE NO ACTION` (drizzle's default) — and that makes `household_members` the
   13th row of a hand-maintained delete order nobody updated.** This is the privacy lens's BLOCKING
   finding and it is the one that would have bitten in production.
   `docs/runbooks.md` → "Delete a household and everyone in it" step **4c** deletes 12 tables ending at
   `households`, and step **5** states the safety property: _"Every FK except the two cascades is `NO
ACTION`, so a table this procedure missed would have aborted the transaction rather than silently
   orphaning rows."_ **With a live `household_members` row, `DELETE FROM households WHERE id = H`
   violates this FK and the whole transaction rolls back** — the household cannot be deleted at all,
   against a `notice.md` promise that data is _"permanently removed from the database"_. `docs/plan.md`
   → PRIV-3 predicted exactly this class in writing: the `db:verify` proof is _"the only thing that
   catches a **19th per-household table** escaping the runbook's hand-maintained delete order"_ —
   and `household_members` **is** the 19th table.

   **So 1b edits `docs/runbooks.md`** (a row its file table was missing entirely): insert
   `household_members` into the step-4c order table **between `profiles` and `households`**, scoped by
   `household_id = H`; add it to the step-3 / 4b count block and the 4d zero-proof; and add a
   `db:verify` assertion that after the runbook's order, zero rows remain for H **and the transaction
   commits**. **`NO ACTION` rather than `ON DELETE CASCADE` is deliberate**, for the reason the runbook
   already gives for `entry_sets`: a cascade would make the count-based proof report nothing.

7. **`HOUSEHOLD_ROLES` lives in `packages/shared/src/enums.ts`, with four symbols, not three.** The
   first draft proposed a new `packages/shared/src/household.ts` and then disagreed with itself (the 1b
   table said _"or an existing module"_). `enums.ts`'s own header is the home declaration: _"Small
   domain enums stored as text + CHECK … Defined once here so the zod validators and TS types stay in
   sync; the DB CHECK constraints mirror these literal lists."_ `PROFILE_KINDS` — the direct analogue —
   lives there and ships **four** symbols via the file's `keyBySelf` helper. So:
   `HOUSEHOLD_ROLES`, `HouseholdRole`, `householdRoleSchema`, and **`HOUSEHOLD_ROLE = keyBySelf(HOUSEHOLD_ROLES)`**
   — plus the explicit re-export in `packages/shared/src/index.ts`, which is a list and not a glob.
   Without the member map the plan re-types the literal three times (the SQL, § Design 5's dry run, the
   correction's insert), which is exactly the `ENTRY_KIND.bodyweight`-not-`'bodyweight'` rule. ⚠️ **The
   zod half has no input to validate in Beta 0** — nothing accepts a user-supplied role — so say so in
   the plan, deliberately unused until `COACH-1`, rather than leaving a reviewer hunting for its call
   site.

**Migration mechanics — the first draft described SQL `drizzle-kit` does not emit, and the DB-safety
lens corrected all four claims.**

- **Indexes are never inline.** `drizzle-kit generate` emits `CREATE TABLE` → `ALTER TABLE … ADD
CONSTRAINT … FOREIGN KEY` → `CREATE INDEX`, in that fixed order (`docs/lessons.md` → Database entry 1
  depends on it; `0000` and `0011` show it). **And the partial unique _cannot_ be a table constraint:
  Postgres has no partial `UNIQUE` constraint, only a partial unique index** — so the first draft's DDL
  block, which listed `UNIQUE (clerk_user_id) WHERE deleted_at IS NULL` beside the `CHECK`, was invalid
  SQL. The block above is corrected.
- **No `CREATE TABLE IF NOT EXISTS`.** It has no precedent here and the repo argues against the idiom:
  `0012` reasons _"No IF NOT EXISTS: it would silently skip a same-named index with a different
  predicate"_, and `0013` records that file-level re-runnability is unachievable anyway — _"the FILE is
  NOT re-runnable as a whole: Postgres has no ADD CONSTRAINT IF NOT EXISTS"_. What guarantees one
  application is `_journal.json`.
- **`SET lock_timeout` + `statement_timeout` at the top**, and a comment that `CONCURRENTLY` is
  neither needed nor allowed (a brand-new empty table takes no meaningful lock, and it cannot run in
  drizzle-kit's per-file transaction) so a later reader does not "fix" it.
- **The FK carve-out must be written down.** AGENTS.md's _"New FK/UNIQUE as `NOT VALID` → `VALIDATE`"_
  is stated unconditionally, so the next reader will check `0015` against it, and "Squawk's destructive
  rules do not engage" does not answer it (the FK rule is not a destructive rule). The reason it is safe
  is the argument `0013` wrote above its own CHECK: **the table is created in the same file, so the
  validating scan reads zero rows — and in one file `NOT VALID` and `VALIDATE` share a transaction and
  buy nothing.**
- **The "what `db:verify` does not prove" note**, which every hand-hardened migration since `0013`
  carries: PGlite is single-connection, so `lock_timeout` is never exercised (`0014`'s own words), and
  `db:verify` applies to an **empty** database, so the FK's lock interaction with a populated
  `households` is never seen.

So `0015` owes **four** SQL comments: the FK/`NOT VALID` carve-out, the not-`CONCURRENTLY` note, the
`db:verify`-does-not-prove note, and the if-it-fails/wedge note (R11). Generated by `drizzle-kit
generate`, then hand-hardened; the generated SQL is the reviewed artifact. One migration in the PR.

### 5 · The claim correction — `household-claim-<date>`

A `Correction` entry in `packages/db/scripts/corrections/registry.ts` (interface:
`{ name, what, issue, run: (db, apply) => Promise<string[]> }`).

```
HOUSEHOLD_PUBLIC_ID=<the household to claim>  CLERK_USER_ID=<user_…>  \
  pnpm --filter @mat-plan/db db:correct household-claim-<date>            # dry run, writes nothing
… --apply
```

- **Both targets come from the environment**, never from a committed constant (Q4). ⚠️ **And that needs
  justifying against a rule the first draft routed around without saying so.**
  `corrections/README.md` **rule 8** records that a target-taking correction is _"**not** a drop-in
  entry: `Correction.run` takes no target and the runner ignores positional args, so it needs a
  `--household <public_id>` flag — a runner change, with its own plan."_ Reading the targets from
  `process.env` inside `run()` is a **new input channel** (today only `packages/db/scripts/correct.ts`
  reads `process.env`, for the DB URL; operator input arrives via `process.argv`). **The justification:**
  env keeps the Clerk user id out of `process.argv`, which `correct.ts` would otherwise be tempted to
  echo, and it is one chunk rather than a runner change plus a plan. **The alternative is better and is
  the maintainer's to weigh:** land `--household` / `--user` flags here, which makes `PRIV-3` cheaper
  because it needs the same flag. Filed as an open question rather than decided in passing.
- 🔴 **The guard is a read-then-branch, not an `INSERT … WHERE NOT EXISTS` — because two lenses showed
  the single statement cannot do what the first draft's very next sentence claimed.** The first draft
  had `INSERT … WHERE NOT EXISTS (SELECT 1 FROM household_members WHERE household_id = $1 AND
deleted_at IS NULL)` and then said _"It refuses rather than overwrites if a **different** live
  membership already exists."_ It cannot:
  - `WHERE NOT EXISTS` makes **any** live membership on that household a silent 0-row no-op, so
    "already claimed by me" (the idempotent re-run rule 2 wants) and "already claimed by **someone
    else**" (an operator error) are **byte-identical output**. Test-plan proof 5's _"refuses on a
    household that already has a live member"_ was therefore unachievable.
  - **The guard keys on the wrong column.** Uniqueness is on `clerk_user_id`, not `household_id`. So
    the realistic second-run typo — **same Clerk id, different household `public_id`**, which SEC-6's
    id rotation makes _more_ likely — passes the `NOT EXISTS` guard, hits
    `uq_household_members_clerk_user`, and **dies mid-transaction on a bare `23505`** instead of the
    clean refusal rule 2 exists for. `0012`'s `DO $$` block exists precisely so this class of collision
    is a message naming the runbook rather than a raw Postgres error.
  - Nothing enforces one-live-membership-**per-household** anyway (the partial unique is on the user),
    so the first draft's invariant was advisory, and a read-then-write is not race-safe for it. Beta 0
    has one operator, so this is a correctness-of-the-spec problem rather than a live one — but **the
    spec is what gets implemented.**

  **So, inside the one transaction:** read live memberships for the household **and** for the Clerk id,
  then branch —
  1. a live row with **this** `household_id` **and this** `clerk_user_id` → return `[]` (idempotent, 0
     rows reported);
  2. a live row on this household with a **different** `clerk_user_id`, **or** a live row for this
     `clerk_user_id` on **another** household → **throw**, with a message naming **which** side
     matched;
  3. otherwise insert, `role: HOUSEHOLD_ROLE.owner`, `publicId: newId()`.

  If anyone reaches for `ON CONFLICT` instead, `docs/lessons.md` → Database entry 2 applies: the
  partial index only arbitrates when the statement repeats `WHERE deleted_at IS NULL`.

- 🔴 **The insert goes through a writer, because the correction cannot legally hold a `household_id`.**
  The first draft had no `packages/db/src/writers/*` row at all, and the correctness lens found why that
  breaks: `packages/db/src/scope.test.ts` → `it('exactly one module reads \`scope.householdId\` …')`scans`packages/db/src/**`**and`packages/db/scripts/**`** and asserts the reader set equals
`['packages/db/src/writers/ownership.ts']`. So `registry.ts`**cannot unwrap** the`HouseholdScope`it is handed, and selecting`households.id`directly evades the regex while contradicting`ownership.ts`'s own 1d record: _"**no correction holds a raw `household_id`either**, and ADR 0006's
capability rule holds in the scripts too."_ **So 1b adds`packages/db/src/writers/household-members.ts:insertHouseholdMember(db, { scope, clerkUserId, role, publicId })`**,
with the scope unwrapped behind `ownership.ts`'s seam exactly as `inHousehold`does — and the
correction **and** the`db:verify` proofs both drive **that** writer, which is also what makes proofs
  1–3 prove the shipped code rather than a lookalike.
- **It refuses via `requireLiveHouseholdScope`, which already exists** — the first draft named the
  nullable `liveHouseholdScope` and then re-described the throw in its own words, making this the third
  copy of a refusal the repo single-sourced. `packages/db/scripts/corrections/registry.ts:requireLiveHouseholdScope`
  throws `household ${publicId} is missing or soft-deleted here — wrong target?`, and its docblock
  records that it was _"extracted at its second consumer … which carried the same refusal block word
  for word."_ Use it by name. It also refuses when either env var is absent, and when the Clerk id does
  not match `/^user_[A-Za-z0-9]+$/` (one regex, defined once beside the correction).
- **The dry run prints the Clerk id IN FULL.** ⚠️ The first draft truncated it to `user_2abc…` — and the
  DB-safety lens showed that **defeats the property Q4 rests on**: Q4's safety argument is that an
  operator-supplied target is safe _"because the dry run prints the household's `name` and profile count
  so the operator confirms the target"_, and truncating the user half hides exactly the characters a
  typo would differ in, then binds it permanently. `corrections/README.md` rule 9 is about **pasting**
  output into a public PR, not about printing to a local terminal. So: print the household's `name`, its
  live profile count, the role, and the **full** Clerk id — and rule 9 stays as the paste-time
  instruction, restated in the runbook. One extra runbook line covers the other end: read the id from
  the Clerk dashboard each time and clear it from shell history, so the redaction is end-to-end.
- **`updated_at = now()`** (rule 4), **`deleted_at IS NULL`** throughout (rule 5), **one
  `db.transaction`** (rule 7), name describes the **defect** not the person (rule 10 — `household-claim`,
  the state being corrected: a household with no owner).
- **The committed `Applied` row carries neither the household `public_id` nor the Clerk id.** The first
  draft stated that rule for the dry-run print and not for the row that lands in a **public** repo
  forever. `docs/plan.md` → PRIV-3 makes the same point about the `Applied` table.
- **`issue`** points at **AUTH-1**: the cause is that no household-creation path assigns an owner, and
  the row that fixes the cause is the invite/creation work after `TEN-2b` (Q5).
- **Reviewer's note for 1b:** the correction reaches `householdScopeForScript` only via
  `requireLiveHouseholdScope` — the constructor `packages/db/src/index.ts` deliberately does **not**
  re-export — so it cannot be reached from `apps/web`. No new escape hatch.
- ⚠️ **Proof 5 needs a stated mechanism, which the first draft did not give it.**
  `packages/db/scripts/verify.ts` drives corrections as `nullRoutineCorrection.run(asCorrectionDb, false)`
  with no inputs, so an env-driven correction forces `db:verify` to mutate `process.env` **three** times
  (bind / unknown household / already-claimed) inside one process. Either say that explicitly, or take
  the targets as `run` arguments — which is the same trade as the rule-8 open question above, and
  another reason to prefer the flags.

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

#### 6.1 · Composition order, the response merge, and the query string — three mechanics the first draft left unsaid

_"`clerkMiddleware()` composed inside `proxy`, keeping the CSP pipeline exactly as it is"_ was the whole
specification. The security lens showed two of the omissions are security properties, not niceties, and
both are facts about **our** code, readable today:

- 🔴 **The gate bounce destroys the query string.** `apps/web/proxy.ts:proxy` does
  `url.search = ''` before `url.searchParams.set('from', pathname)`, so **every** query parameter on a
  gated request is discarded and `from=` carries only the pathname. During 1a–1c `/sign-in` and its
  children are deliberately left **gated**, so any Clerk handshake / OAuth-callback parameters arriving
  on those paths before the cookie is present are **silently destroyed**, and the post-gate return lands
  on a bare path with no handshake — a loop, not a flow. The first draft filed this under "verify
  against the development instance", which is right about the vendor half and wrong that nothing here is
  readable. **Decided: the sign-in child path joins `PUBLIC_PATHS` in 1a** — the first draft's
  parenthetical exception, promoted to the default — with the `/sign-inevil` negative test, **and** the
  bounce preserves the query string for paths under `SIGN_IN_PATH`.
- 🔴 **A composed response must be merged, never replaced.** `forward()` builds a **fresh**
  `NextResponse.next({ request: { headers } })`. A `clerkMiddleware()` that returns its own response — a
  handshake redirect, or a `next()` carrying rotated session `Set-Cookie` headers — has that response
  **discarded** if `proxy` returns `withSecurityHeaders(forward(...))` on its own. Dropped session
  cookies present as a user silently signed out, or as `getCurrentUser()` → `null` for a legitimate
  caller — R3's second horn, a dark app for the only user, blamed on Clerk. **So § Design 6 states the
  order (Clerk first or gate first, and why), and that Clerk's response headers and cookies are merged
  into the CSP/headers response through one named helper**, with `proxy.test.ts` cases: a gated request
  carrying unrelated query params keeps them, and a composed response's `Set-Cookie` survives
  `withSecurityHeaders`.
- **1a's `proxy.test.ts` row also asserts the gate still bounces.** The first draft named only _"Clerk
  composition does not bypass `withSecurityHeaders`"_. In 1a Clerk authorizes nothing, so a
  composition-order bug there is the "app is open" half of this plan's own failure mode. Pages still
  re-check independently, which is why this is a test row and not a redesign.

⚠️ **One claim in R3 is too strong and this is the place to say so.** _"1a removes the `/api` exclusion
so there is no matcher-shaped gap left"_ — `_next/static/`, `_next/image` and `favicon.ico` stay
excluded, and `/_next/image` is a live request-handling surface (the optimizer) that a Clerk or Google
avatar would widen via `images.remotePatterns`. **The honest claim is "no gap at any entry point that
reads household data"**, held by the per-page / per-action / per-handler checks — not by the matcher.
Relatedly, `docs/tech-debt.md`'s own prescription for the `/api` hole is **"Do both"** (drop the
exclusion **and** prove a check per handler), so **1a** strikes that entry on the strength of the
matcher edit _plus_ `pages-are-gated.test.ts`'s handler suite — and that suite currently has **no
non-vacuity assertion** (its sibling page suite does), so 1a adds `expect(handlers.length).toBeGreaterThan(0)`.
**The strike lands in 1a, not "wherever it lands first"** — "status rides with the work" is per-PR.

### 6b · The CSP — the widening `beta-1.md` assigned to this plan by name

🔴 **The first draft said the opposite of this section, in three places, and two independent lenses
caught it.** § Design 6 said _"keeping the CSP pipeline exactly as it is"_; 1a's file table said _"CSP
pipeline untouched"_; and `grep -n "connect-src\|frame-src" docs/plans/auth-1-clerk-google.md` returned
**nothing**. Meanwhile `docs/milestones/beta-1.md` → Risks says, verbatim:

> **Clerk is a new runtime dependency on the auth path, and its scripts need a reviewed widening of the
> strict CSP.** Its outage is the app's outage; acceptable for a beta, **recorded in AUTH-1's plan.**

**The milestone delegated this analysis to this document, and the document recorded nothing.**

**Why it cannot work as written.** `apps/web/proxy.ts:buildCsp` emits, in production:
`default-src 'self'`, `script-src 'self' 'nonce-…' 'strict-dynamic'`, `style-src 'self' 'nonce-…'`,
`img-src 'self' blob: data:`, `font-src 'self'`, `connect-src 'self'`, no `frame-src`, no `worker-src`,
`frame-ancestors 'none'`. A browser-side Clerk SDK — which `<ClerkProvider>` and the prebuilt
`/sign-in` both require — needs at minimum its Frontend-API host in `connect-src`; a Google avatar
needs `img-src`; a bot-protection challenge widget needs `frame-src`; and a nonce'd `style-src` makes
`'unsafe-inline'` inert for injected styles. **This repo has already written the same consequence down
three times**, which is what makes it a finding rather than a guess: `apps/web/next.config.ts` — _"the
front-end SDK isn't shipped (the CSP's `connect-src 'self'` would block its ingest POST)"_ — and the
same sentence in `docs/plan.md` and `docs/plans/v1-14a-hardening.md`.

**It is BLOCKING rather than a 1a detail** because a CSP widening discovered at deploy time is widened
_under pressure, in production_, by whoever is trying to make sign-in work on a Saturday — the exact
failure the milestone wanted recorded in advance. And it is permanent: a vendor origin in `script-src`
/ `connect-src` is the one security-header change in Beta 0 nobody will ever revisit.

**So 1a owes, as design rather than discovery:**

1. **Each directive and each source Clerk requires, read off Clerk's own documentation or source at the
   exact pinned version** — not its README, and not from here. Neither this plan nor any lens could
   verify it offline: `@clerk/nextjs` is absent from `node_modules` and `pnpm-lock.yaml`. This is a
   **"verify, do not assume, and record what you read"** box, the same standard § Design 10 sets for
   the Playwright helpers.
2. **The `style-src` nonce question answered explicitly** — whether `<ClerkProvider>` accepts a nonce
   (the existing `x-nonce` header is right there), or whether `style-src` must be relaxed, **and what
   that costs the nonce argument § Design 11 leans on.** If Clerk cannot run under a nonce'd
   `style-src`, that is a finding for the maintainer **before 1a merges**, beside Q1's conditional
   reversal.
3. **Whether bot protection is on for the instance**, and therefore whether `frame-src` is needed.
4. **Every added source pinned in `apps/web/proxy.test.ts` by exact origin, never a wildcard**, beside
   the existing `frame-ancestors 'none'` assertion.
5. **A proof, which already exists and costs nothing:** `apps/web/e2e/theme.spec.ts` asserts **zero
   `securitypolicyviolation` events** on a page load (with one known benign report recorded in
   `docs/lessons.md`). `/sign-in` is reachable without a Clerk session, so that spec can cover it **in
   1a** without touching § Design 10's unsolved problem.
6. **The privacy consequence, in the same chunk** (Q3): `data-inventory.md` § 7's egress paragraph
   (_"no data egress from the browser to any external host … The egress claim is the one that holds"_)
   and `notice.md`'s _"Your browser talks to this app and nothing else"_ both become **false** the
   moment this works. They are 1a's edits, not 1d's.
7. **The supply-chain consequence `pnpm audit` cannot see:** `clerk-js` is fetched from Clerk's CDN at
   runtime, so it is **outside the lockfile and outside the SEC-5 gate**. Say so in 1a's PR body.

📌 **And a correction to this plan's own CI premise, from the security lens:** `pnpm audit --prod` **is**
a CI gate now — `.github/workflows/ci.yml` runs `pnpm audit:check` in a "Production audit (high+,
--prod)" step, and `.github/SECURITY.md` → Supply chain documents it. **AGENTS.md is the stale document
here** (it still says the audit runs only in local `pnpm verify`). 1a's file-table line _"the privacy
lens and `pnpm audit:check` both see it"_ is correct as written; the AGENTS.md correction is its own
one-line row, not this plan's PR.

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

🔴 **The vehicle is right; the first draft's four steps were not implementable as written.** Four
lenses converged on this section, and the biggest problem is step 3 — the step the plan itself calls
_"the assertion that actually closes the gap"_.

**The four faults, each verified against `main`:**

1. **`ALL_ACTIONS` has no importable source.** `apps/web/app/p/[profileId]/actions.test.ts` declares
   `const ALL_ACTIONS` — **not exported** — in a file with ~20 module-level `vi.mock` factories and
   20+ `describe` blocks, and it holds **function references**. A second spec cannot import it without
   exporting from a `.test.ts` **and** re-registering that entire suite inside the importing file. Nor
   can the list move into `actions.ts`: that module is `'use server'`, and `use-server-exports.test.ts`
   exists precisely to fail a non-async export there.
2. **The equality must subtract the allowlist.** In 1c the walk finds **8** exported actions
   (`actions.ts`'s 7 + `app/gate/actions.ts:submitGate`) against 7 `ALL_ACTIONS` names. Step 3 said the
   sets _"equal"_; step 4 introduced the allowlist only for the session-call assertion. **As written the
   test is red on day one.**
3. **Step 1's over-match is wrong _here_, and there is a live counter-example.**
   `apps/web/app/p/[profileId]/action-state.ts` contains the string `'use server'` **in a docblock**
   (so does `actions.ts`). Including `action-state.ts` would demand `requireSession()` inside
   `INITIAL_ACTION_STATE`. `pages-are-gated.test.ts`'s "over-matching is the safe direction" applies to
   a _different_ question. **Fix: strip comments FIRST (`code()`), then test the directive**, keeping
   `use-server-exports.test.ts`'s anchored `/^\s*['"]use server['"]/` as the selector.
4. **The enumeration domain is narrower than the attack surface.** `use-server-exports.test.ts:walk` is
   rooted at `join(process.cwd(), 'app')`. **A `'use server'` module under `apps/web/components/` or
   `apps/web/lib/` is a real Server Action and is invisible to both the existing guard and the planned
   one.** Today there are exactly two such modules, both under `app/` — which is the only time this is
   cheap to fix.

**So the revised shape, and it is smaller than the first draft's _and_ stronger:**

- **No new guard file.** `apps/web/app/pages-are-gated.test.ts` already defines `code()` (the
  comment-stripped reader step 2 asks for), the `app(pattern)` glob, `USE_SERVER_RE`, a non-vacuity
  floor and a "the detector is not vacuous" case. It is already the file whose job is _"every entry
  point re-checks the boundary itself"_, and 1d already renames it. **The presence check becomes a
  third `describe` there**; the cross-check goes **inside `actions.test.ts`**, where the list already
  lives and the filesystem walk is ~10 lines with no import problem. That also satisfies `beta-1.md`
  § 3's literal wording ("extending the existing…"), which retires the § Alternatives row defending the
  deviation — **though the substance of this section's finding stands: the test the milestone _named_
  is an export-shape guard and cannot carry an auth assertion. It is the file that was wrong, not the
  intent.**
- **One single source for the action list**, in a **non-`'use server'` sibling** —
  `apps/web/app/p/[profileId]/mutating-actions.ts`, exporting
  `MUTATING_ACTIONS: Record<string, typeof NO_PROFILE_LOG>` (the `action-state.ts` precedent for "a
  non-action module beside the actions"). `actions.test.ts` builds its tuples from it; the enumeration
  guard compares against it; **the non-vacuity floor is `Object.keys(MUTATING_ACTIONS).length`, never a
  re-typed `7` or `≥7`.**
- **`apps/web/test/source-scan.ts`** (that directory already exists, for `server-only-stub.ts`) exports
  `code`, `USE_SERVER_RE` and a **glob-based** `appSources()`. ⚠️ **`walk` is NOT promoted:** it is a
  hand-rolled `readdirSync` recursion and the only copy, while both guards this section models itself on
  use `globSync` — promoting it would add a _third_ enumeration idiom. And `docs/tech-debt.md` records
  that _"the comment-stripping `code()` test helper has five copies"_ with the fix _"extract once into a
  small test-support module"_; 1c already edits two of those five, so it **converts the copies it
  touches and narrows that debt entry in the same PR** rather than becoming the sixth copy.
- **The set comparison subtracts the allowlist.** In 1b-bis/1c the allowlist holds
  `app/gate/actions.ts` (the gate action issues the gate and cannot require a session), with the
  **dead-entry** assertion from `scoped.test.ts` — so **1d deleting that file forces the allowlist entry
  to go with it.** ⚠️ 1d must also repoint `pages-are-gated.test.ts`'s non-vacuity probe, which
  hard-codes `join(APP_DIR, 'gate', 'actions.ts')` — after 1d that throws `ENOENT`.
- **The discovered `'use server'` file set must EQUAL a pinned list**, with the walk rooted at
  `apps/web` (excluding `.next`/`node_modules`), so a new action module **anywhere in the app** is a
  visible test edit rather than a silent gap.
- **The accepted call set is exactly § Design 2's two names** (`sessionUserOrNull`, `requireSession`),
  never an alternation with the gate's. ⚠️ **1c must switch the regex, never widen it** — a guard
  matching `hasGateAccess|hasSession` passes on either and therefore proves neither, and that is the
  fix an author reaches for when the suite goes red under time pressure.

⚠️ **This is a source-text guard, which is a real limitation and must be written down rather than
over-sold.** It proves the call is present, not that it is reached before the DAL — that is
`ALL_ACTIONS`'s `expect(getProfileByPublicId).not.toHaveBeenCalled()` job, which is why the cross-check
exists. Both halves together are the claim; neither alone is. **Three things it explicitly does not
cover, named in the test's own docblock rather than left to be discovered:** an **inline** `'use server'`
closure inside a page or component (an action that is not an export, so neither step sees it); an
**anonymous default export** (no name for the set comparison); and a Route Handler, which
`pages-are-gated.test.ts`'s handler suite covers separately. **Re-exports are already closed** — by
`use-server-exports.test.ts`, which fails any export that is not
`export (default )?async function` / `export type X` / `export interface`, so `export { x } from './y'`
is already a red build. Say so: it converts a listed bypass into a closed one.

### 8 · The per-user mutation rate limit — **not the small change the first draft claimed**

`beta-1.md` § 3 calls this _"the existing Upstash limiter re-keyed from IP to user id"_. That wording is
**off, and correctly so in the first draft**: the existing limiter's one call site is
`app/gate/actions.ts:submitGate`, which **1d deletes**. There is nothing to re-key.

🔴 **But the first draft then said _"this is small"_, and two lenses showed it is not.**
`apps/web/lib/rate-limit.ts:checkRateLimit(identifier)` is generic **in the identifier only.** The
module builds **one module-level `Ratelimit`** whose window is baked in at construction —
`limiter: Ratelimit.slidingWindow(GATE_RATE_LIMIT.attempts, GATE_RATE_LIMIT.window)` — and
`checkRateLimit` takes no policy argument. So as first written:

- the seven mutating actions would be limited at **the gate's** 10-per-10-minutes, whatever
  `MUTATION_RATE_LIMIT` said, and **the new const would be read by nothing**. A sizing test modelled on
  `rate-limit.test.ts` → `describe('GATE_RATE_LIMIT — sized for humans…')` would **pass while enforcing
  a different number** — "a boundary test that cannot fail is worse than none", this plan's own words;
- **1d then "drops `GATE_RATE_LIMIT`", which is the value the only surviving limiter is built from.**

**So what AUTH-1 actually does:**

- **adds one exported `checkMutationLimit(userId)`** in `lib/rate-limit.ts` that owns the
  `` `mutate:${userId}` `` prefix **and** a second `Ratelimit` instance constructed from
  `MUTATION_RATE_LIMIT` (or refactors `limiter` into a small per-policy factory — either way, **the
  const is the value the limiter is constructed from**, stated explicitly). The prefix is written
  **once**, not at seven call sites: `app/gate/actions.ts`'s `` `gate:${ip}` `` is one occurrence of one
  prefix, and seven is the extraction trigger (AGENTS.md → Constants).
- **takes its `userId` from § Design 2's `sessionUserOrNull()`**, which returns the principal — so the
  action does not ask the same question twice;
- **returns the same typed envelope** a refusal already returns (a throw would render `error.tsx` and
  lose the user's place — `submitGate`'s existing comment is the precedent);
- **deletes the false premise** in that file's docblock (Q4);
- **in 1d, drops the gate _instance_ and `GATE_RATE_LIMIT` only**, with `app/gate/actions.ts`.

🔴 **And it starts sending a stable person-identifier to Upstash, which the first draft discussed purely
as a security control** — the words "Upstash", "privacy" and "inventory" did not appear in the section.
The limiter is constructed with `prefix: 'mat-plan'`, so the stored key is
`mat-plan:mutate:user_<clerk id>`. `data-inventory.md` § 7's Upstash row currently reads: _"The
**visitor's IP address**, in the plaintext key `mat-plan:gate:<ip>`, **on gate submits only**. 10
attempts / 10 minutes."_ **All four facts change** — a rotating IP becomes a stable third-party account
id for a named adult, one submit becomes seven mutating actions, the window becomes
`MUTATION_RATE_LIMIT`, and after 1d this is the **only** limiter. OPS-1 also provisioned a **second**
Upstash database for Preview, so there are two stores to say it about. `data-inventory.md`'s re-review
trigger 1 is verbatim: _"A new processor, **or a change to what an existing one receives**."_

**So § Design 8 decides the key shape rather than defaulting into it, and 1c edits § 7's Upstash row and
§ 8's retention row** (Q3). Two minimisations to weigh explicitly: key on a **salted hash** of the Clerk
id — the limiter needs a stable bucket, not a readable id, and SECURITY.md → Logging already says never
log PII, which an Upstash key is — and **state the counter's TTL** so § 8 has a retention answer. If the
plaintext id is kept, that is a decision with a reason, held to the standard the deletion ledger was.

⚠️ **State C is an authenticated amplification path the limiter does not cover.** With a session and no
membership, every `/p/<uuid>` view reaches `getProfileByPublicId` → `scope === null` →
`reportScopeMiss`, which runs the allowlisted **unscoped** DB probe plus a `Sentry.captureMessage`
**per request** — and this limiter covers only the seven _mutating_ actions, so reads are unlimited.
`no_scope` has no diagnostic value in that state, so 1c short-circuits or samples the event when the
principal has no membership.

Brute-forcing the sign-in itself is **Clerk's** problem after 1d — it owns the credential endpoint, and
there is no longer an in-app password oracle. That is the single biggest security win of retiring the
gate and should be said in 1d's PR body rather than assumed.

⚠️ `UPSTASH_*` are optional by design in `apps/web/lib/env.ts` (dev, CI, un-wired previews), so an
unconfigured environment has **no** mutation limit. That is the existing, deliberate posture, not a
regression — but after AUTH-1 it is the only limiter in the app, so 1c's PR body states it and
`isRateLimitConfigured` stays exported for the health check that tells "off" from "broken".

📌 **Open for the maintainer, because cutting it edits a signed milestone.** The scope lens argued the
limiter should **leave AUTH-1** for its own row beside `/api/sync`'s limiter (`docs/tech-debt.md`
already groups them): after 1c every caller is authenticated **and invited** (one person), the limit is
absent in dev/CI/preview by design, and brute force is Clerk's. That is ~60 lines of source plus tests
out of the heaviest chunk for no Beta 0 risk. **The counter-argument is that `beta-1.md` § 3 names it as
an AUTH-1 deliverable**, so removing it is a milestone edit, not a plan decision. Filed in § Open
questions, **unsigned**.

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
- 🔴 **"With no Clerk keys the app is dark, not open" was ASSERTED as fact, and both of its plausible
  failure modes are worse than dark.** This is the security lens's finding, and no lens could verify it
  offline — `@clerk/nextjs` is absent from `node_modules` and `pnpm-lock.yaml`, so there is no pinned
  source to read. The assertion is not safe to carry, because § Design 6 composes `clerkMiddleware()`
  **inside `proxy`**, which runs on **every** matched request including the public landing `/` and
  (after PRIV-2) `/privacy`:
  - **If `clerkMiddleware()` itself throws on a missing key**, the throw is in the **proxy**, not in
    `getCurrentUser()` — so `getCurrentUser()`'s fail-closed branch never runs, and the result is
    **every route 500ing, including the two unauthenticated ones**, in exactly the environments this
    plan says legitimately run without keys (local dev, CI's `next build`, un-wired previews). That is
    not a dark app.
  - **If the pinned version has a keyless / auto-provisioning development path**, "no keys" could mean
    _a live Clerk application provisioned from a developer's or CI's machine_ — a new processor
    relationship created by a `pnpm dev`, which is the **opposite** of dark. Not asserted; the point is
    that this plan's safety property is **void** if it is true, and nothing in the plan would catch it.

  **So: (a) it becomes a 1a prerequisite probe with a recorded result** — three cases: no keys at
  `next build`, no keys at boot, no keys per-request — the same "verify, do not assume, and record what
  you read" standard the sign-up-restriction box already carries; **and (b) the behaviour is made to
  hold independently of the answer: `clerkMiddleware()` is composed only when BOTH keys are present in
  `env`.** Then the un-wired case is a deliberate branch in our code rather than a vendor behaviour we
  hope for, and `getCurrentUser()` returns `null` **by construction** in that state. 1a adds the
  keyless kill-switch (name read off the pinned source) to `.env.example` and `ci.yml`'s env, and a
  `proxy.test.ts` case asserting the **public landing still renders with no Clerk keys set**.

- ⚠️ **One mechanical note on the `NEXT_PUBLIC_` declaration.** `apps/web/lib/env.ts` is
  `import 'server-only'` with `client: {}`. A `NEXT_PUBLIC_` var must be declared in `client:`, and a
  `server-only` module cannot be imported from a client component — so the declaration buys
  **validation only**, and `<ClerkProvider>` still receives the key through Next's build-time inlining.
  Worth one sentence, because "optional" then means CI's `next build` can inline `undefined` into the
  client bundle and produce an artifact whose auth fails **in the browser** rather than refusing on the
  server. The prefix itself is correctly used — the publishable key is not a secret — which is the
  thing 1a's PR body says out loud.
- **1c also means `pnpm dev` goes dark unless `.env.local` has Clerk dev keys.** 1c updates
  `.env.example` and the dev-setup note in the same PR, because the first person to hit this is the
  maintainer on a Saturday.
- **1d removes `ACCESS_GATE_PASSWORD` from all 19 sites**, not the five the first draft listed. The
  reuse lens ran 1d's **own** acceptance-criterion-5 grep and found the table omits
  `apps/web/vitest.config.ts`, `apps/web/proxy.test.ts`, `apps/web/scripts/screenshot.ts`,
  `apps/web/scripts/dev-local.ts` and `.github/scripts/check-preview-isolation.test.sh` — so 1d as
  planned **fails its own acceptance criterion.** The full set is
  `grep -rln ACCESS_GATE_PASSWORD apps packages .github` = **19 files**, plus the Vercel/GitHub secret
  stores (a runbook step, § Runbook). Order matters inside 1d: remove the **reads** before the
  **secret**, or the app refuses to boot.

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
at all. A Clerk dependency makes every future UI PR's screenshot step need a Clerk instance. If the
answer is a test-only path, it belongs to `screenshot-ephemeral.ts` alone — which already lives outside
the request tree and is already allowlisted **by name** in
`packages/db/src/scope.test.ts:FIXTURE_DERIVES_SCOPE` — never to the app.

🔴 **This is `1c-pre`, not 1d. The first draft got the ordering wrong and said so twice.** Q6 carries
the full argument; the short version is that the gate surviving in 1c is **necessary, not sufficient**,
so `global.setup.ts` and `capture.ts` both break the moment `requireSession()` lands. **And one half the
first draft never stated:** 1b deliberately makes the seed write **no** membership row (correctly —
`migrate.yml` seeds production), so even a minted Clerk session lands in state **C**. **The ephemeral
fixture therefore needs a membership row the seed is forbidden to create**, which `1c-pre` must say how
it gets — most likely the same `insertHouseholdMember` writer the correction uses (§ Design 5), called
from the fixture path that is already allowlisted.

🔴 **And the rejection of the test-only bypass was a preference, not a bar.** "Rejected unless the above
proves unworkable" gives an implementer under pressure no test to apply. **So: what must be true for a
test-only bypass to be acceptable at all — and the repo already has all three shapes:**

1. **The enabling variable is absent from every Vercel scope, and `pnpm preview:check` FAILS if it
   exists** — the `ALLOW_LIVE_DB` / `SKIP_ENV_VALIDATION` precedent, whose reasoning is written out in
   `apps/web/lib/env.ts`'s guard docblock.
2. **The bypass module is unreachable from the request tree, proved by a guard test** — the way
   `apps/web/scripts/screenshot-ephemeral.ts` is already allowlisted by name in
   `packages/db/src/scope.test.ts`.
3. **It can mint a _session_, never a _membership_, and only against a database it provisioned
   itself.**

With those three written down, **Open question 4 ("does 1d get its own plan?") becomes a scoping call
rather than a way to defer the decision** — and it is `1c-pre` that would get the plan, since that is
where the work now sits. 1d remains **last** and **alone**, but it is now a comparatively pure
deletion.

### 11 · Caching — the exit criterion that is already satisfied, and must stay so

_"per-user data is never cached across users"_. Already true and already proved: the root layout is
`export const dynamic = 'force-dynamic'` (the nonce CSP requires it) and
`apps/web/app/tenancy-is-not-cached.test.ts` pins it, including `it('the export Route Handler is
dynamic on its own (a handler inherits no segment config)')`. ADR 0006 cites this as the obligation it
discharged.

**AUTH-1's job is not to add caching discipline but not to lose it.** Three hazards — and the third is
the one the first draft created:

- Clerk's middleware and components must not introduce a statically-rendered shell. Any new route
  (`/sign-in`) is `force-dynamic` by inheritance.
- `cache()` on `getCurrentUser()` is **per-request** (React `cache`), not cross-request. Saying so in
  the docblock is cheap and forestalls the misreading that matters most here.
- 🔴 **A session check that reads cookies through a vendor is NOT an explicit dynamic opt-in — and 1c
  as first written turns this exit criterion's own assertion red.** Two lenses found it independently.
  `apps/web/app/p/[profileId]/export/route.ts:GET` is dynamic **only** because it calls
  `(await cookies()).get(GATE_COOKIE_NAME)`, and
  `apps/web/app/tenancy-is-not-cached.test.ts` → `it('the export Route Handler is dynamic on its own (a
handler inherits no segment config)')` asserts exactly
  `/\bcookies\(\)/.test(handler) || /export\s+const\s+dynamic\s*=\s*'force-dynamic'/.test(handler)`.
  **1c's `isValidGateCookie` → `sessionUserOrNull` swap deletes that `cookies()` call, so neither
  disjunct matches** — on the one route that streams a child's whole training history, and against the
  criterion ADR 0006 obligation 2 is pinned on. The test's own docblock exists to prevent precisely
  this: _"A Route Handler does NOT inherit a layout's segment config."_

  **Fix, one line, in 1c, in the same commit as the swap:** `export const dynamic = 'force-dynamic'` in
  `export/route.ts`, with a comment saying the gate-cookie read that used to carry this is gone.

⚠️ **And the edit the first draft prescribed for that file is impossible.** 1c's row said _"`/sign-in`
added to the enumerated routes"_ and this section said the test _"should gain the new routes rather than
be left enumerating the old set"_ — **the test enumerates no routes.** It has four suites:
`layout.tsx` declares `force-dynamic`; the layout comment names tenancy; the export-handler disjunct
above; and a repo-wide sweep for `unstable_cache|'use cache'|cacheTag|export const revalidate`. The
"enumerated routes" claim is withdrawn, and 1c lists that file for the **real** reason.

---

## Chunks, in order

### 1a — Clerk wired, and dark · `feat/auth-1a-clerk-wired`

**Prerequisite: a Clerk _development_ instance exists** (Q3, as revised — `PRIV-2` gates _configuring
the production instance_, not merging this). **Gate still the only boundary.**
**Two "verify, do not assume" boxes must be answered before this merges:** Clerk's CSP requirements at
the pinned version (§ Design 6b) and the no-keys behaviour (§ Design 9).

| Path                                        | Change | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/package.json`                     | EDIT   | `@clerk/nextjs` at an exact version. One dependency; the privacy lens and `pnpm audit:check` both see it.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/web/lib/env.ts`                       | EDIT   | `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, both **optional** (§ Design 9), with the rationale block.                                                                                                                                                                                                                                                                                                                                                                                                            |
| `.env.example`                              | EDIT   | Both vars, with the "Clerk development instance" note.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/web/proxy.ts`                         | EDIT   | 🔴 **`buildCsp` widened for Clerk** — exact origins, read off the pinned version (§ Design 6b). `clerkMiddleware()` composed **only when both keys are present** (§ Design 9), with a **stated order** and the composed response's headers/cookies **merged, never replaced** (§ Design 6.1); **`api` exclusion removed from the matcher**; the bounce **preserves the query string** under `SIGN_IN_PATH`.                                                                                                                   |
| `apps/web/proxy.test.ts`                    | EDIT   | Each added CSP source pinned **by exact origin, never a wildcard**; `/api/...` now matching; **the gate still bounces with Clerk composed**; a composed `Set-Cookie` survives `withSecurityHeaders`; a gated request keeps unrelated query params; **the public landing renders with no Clerk keys set**.                                                                                                                                                                                                                     |
| `apps/web/lib/access-gate.ts` → **split**   | EDIT   | 🔴 **The split moves here from 1d** (architecture lens): `lib/safe-redirect.ts` takes `safeInternalPath` / `internalPathname` (SEC-4's open-redirect clamp — **not** "public paths", which is why `lib/public-paths.ts` misnamed two of its three survivors), `lib/public-paths.ts` takes `PUBLIC_PATHS` / `isPublicPath` with the **child-path arm**. 1a already edits this file; splitting now leaves `access-gate.ts` holding only the gate, makes **1d a pure delete**, and keeps rename churn out of the heaviest chunk. |
| `apps/web/lib/access-gate.test.ts`          | EDIT   | The `/sign-inevil` negative test, in the same commit as the arm; suites follow the split.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/web/lib/constants.ts`                 | EDIT   | `SIGN_IN_PATH` lands **here**, beside `APP_HOME_PATH` / `TOKEN_SETS_PATH` — **not** in `access-gate.ts`, the module being split. Then it never moves. Says in a comment that `SIGN_IN_PATH` / `APP_HOME_PATH` feed `<ClerkProvider>`'s props rather than a second `NEXT_PUBLIC_CLERK_SIGN_IN_URL` copy.                                                                                                                                                                                                                       |
| `apps/web/app/sign-in/[[...rest]]/page.tsx` | NEW    | Clerk's prebuilt sign-in, Google only. **A screen a person sees → owes a UX panel** (§ Panels).                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/web/app/pages-are-gated.test.ts`      | EDIT   | 🔴 **Missing from the first draft; 1a is red without it.** The suite globs `**/page.tsx` and requires `await requireGatedPage()` **or** `isUngatedPath(route)`; Clerk's prebuilt `/sign-in/[[...rest]]` does neither. The exemption comes from `PUBLIC_PATHS`'s new sign-in entry (§ Design 6.1), which is why that decision moved into 1a. **Also adds `expect(handlers.length).toBeGreaterThan(0)`** — the handler suite has no non-vacuity floor today, and the `/api` strike leans on it.                                 |
| `apps/web/app/layout.tsx`                   | EDIT   | `<ClerkProvider>`, inside the existing nonce/theme providers, with the nonce passed if the pinned version accepts one (§ Design 6b).                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/web/e2e/theme.spec.ts`                | EDIT   | Extend the existing **zero-`securitypolicyviolation`** assertion to `/sign-in`, which needs no session (§ Design 6b proof 5).                                                                                                                                                                                                                                                                                                                                                                                                 |
| `docs/privacy/notice.md`                    | EDIT   | **Six** edits, not one (Q3): "What is changing" → present tense; **"No tracking"**; **"no email address"**; **"no photos"** if the scopes require it; "Getting your data out"; the consent-mechanism sentence box (b) returns.                                                                                                                                                                                                                                                                                                |
| `docs/privacy/data-inventory.md`            | EDIT   | § 7's Clerk/Google rows **and the egress paragraph**; the derivation stamp (Q3).                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `docs/runbooks.md`                          | EDIT   | The dashboard half of the AUTH-1 checklist (§ Runbook's **delta only**): Google OAuth credentials, Google-only strategy, the **sign-up restriction**, the domain, free-tier limits, **the OAuth scope list**, **Clerk's region and retention**, **`@clerk/nextjs` telemetry**, **the `'use server'` grep**, **the invitation record's spec**.                                                                                                                                                                                 |
| `docs/architecture.md`                      | EDIT   | 🔴 **Unassigned in the first draft.** § 1's containers diagram draws Clerk only as a dashed server-side `auth()` dependency; 1a adds a **browser→Clerk egress edge**. AGENTS.md → Diagrams: this file is the diagram home and the PR description must agree with it.                                                                                                                                                                                                                                                          |
| `docs/tech-debt.md`                         | EDIT   | The `/api` matcher-hole entry struck **here**, by the chunk that closes it (§ Design 6.1) — not "wherever it lands first".                                                                                                                                                                                                                                                                                                                                                                                                    |

🔴 **REVISED: the sign-in path joins `PUBLIC_PATHS` in 1a.** The first draft kept it gated through the
overlap, on the reasoning that the only person signing in holds the code anyway, and filed the
alternative as a parenthetical exception. **Two things forced the exception to become the default:**

1. **`apps/web/proxy.ts` sets `url.search = ''` on the gate bounce**, so a gated `/sign-in/...` loses
   every Clerk handshake parameter — a loop, not a flow (§ Design 6.1). That is a fact about our code,
   readable today, not a vendor question.
2. **`pages-are-gated.test.ts` requires every `page.tsx` to await `requireGatedPage()` or be an ungated
   path**, and Clerk's prebuilt page does neither — so 1a is red unless the exemption exists.

The surface this widens is a sign-in screen that reads no household data and queries nothing, which is
the same shape as the public landing `/` that `PUBLIC_PATHS` already holds. The `/sign-inevil` negative
test lands in the same commit as the arm. **The vendor half still needs running against the development
instance before 1a merges** — which parameters the callback actually carries — but the plan no longer
depends on the answer.

### 1b-bis — the enumeration guard, alone and early · `test/auth-1b-bis-actions-need-a-session`

**New chunk, pre-split by the panel** (Q6). **Prerequisite: none beyond 1a's merge.** Asserted against
`hasGateAccess` — **inert, revert-safe, and it turns 1c's largest unknown into a verified fact before
1c is written.** It may land in parallel with 1b.

| Path                                                               | Change | What & why                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/test/source-scan.ts`                                     | NEW    | `code`, `USE_SERVER_RE`, a **glob-based** `appSources()` rooted at `apps/web` (§ Design 7). **Not** a promoted `walk`.                                                                                                                                                                  |
| `apps/web/app/p/[profileId]/mutating-actions.ts`                   | NEW    | `MUTATING_ACTIONS: Record<string, typeof NO_PROFILE_LOG>` — the **one** source for the action list. A non-`'use server'` sibling, on the `action-state.ts` precedent, so both tests can import it (§ Design 7).                                                                         |
| `apps/web/app/p/[profileId]/actions.test.ts`                       | EDIT   | `ALL_ACTIONS` builds its tuples **from `MUTATING_ACTIONS`**; the filesystem cross-check lands **here**, where the list lives and there is no import problem.                                                                                                                            |
| `apps/web/app/pages-are-gated.test.ts`                             | EDIT   | A third `describe`: every exported function of every `'use server'` module **under `apps/web`** contains the accepted boundary call, comments stripped **before** the directive test; the pinned file set; the allowlist holding `app/gate/actions.ts` with a **dead-entry** assertion. |
| `apps/web/lib/dal/scoped.test.ts`, `tenancy-is-not-cached.test.ts` | EDIT   | Converted to `source-scan.ts`'s `code` — two of the **five** copies `docs/tech-debt.md` records.                                                                                                                                                                                        |
| `docs/tech-debt.md`                                                | EDIT   | The `code()`-has-five-copies entry **narrowed** in the same PR as the extraction.                                                                                                                                                                                                       |
| `docs/features/write-path.md`                                      | EDIT   | **Owned-file, CI-enforced** (`apps/web/lib/dal/`). Invariant 1's _"only if you add it to that suite: do."_ admission is what this chunk retires.                                                                                                                                        |

### 1b — `household_members` + the claim correction, both dark · `db/auth-1b-household-members`

**Prerequisite: 1a deployed and the maintainer has signed in once** (so a Clerk user id exists).
**Nothing reads the table.** ⚠️ Per Q6, this is a **concern-separation** boundary, not a
"must-be-deployed" one: the correction takes its targets at run time, so 1b can be written and reviewed
before anyone signs in — only **running** it needs the user to exist.

| Path                                                 | Change | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/enums.ts`                       | EDIT   | 🔴 **Here, not a new `household.ts`** (§ Design 4 decision 7). **Four** symbols: `HOUSEHOLD_ROLES`, `HouseholdRole`, `householdRoleSchema`, `HOUSEHOLD_ROLE = keyBySelf(HOUSEHOLD_ROLES)`. The zod half is deliberately unused until `COACH-1`; say so.                                                                                                                                                                                                                                                                                                                             |
| `packages/shared/src/index.ts`                       | EDIT   | The explicit re-export — this file is a list, not a glob.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `packages/db/src/schema.ts`                          | EDIT   | `householdMembers` (§ Design 4). CHECK literals **INLINED** with the standard mirror comment (a CHECK cannot import a const); **one** partial unique `uq_household_members_clerk_user`; the `⚠️ THE SEED MUST NEVER NAME THIS TABLE` docblock, mirroring `households.synthetic`.                                                                                                                                                                                                                                                                                                    |
| `packages/db/migrations/0015_*.sql`                  | NEW    | `drizzle-kit generate`, then hand-hardened: timeouts, **no `IF NOT EXISTS`**, separate `ALTER TABLE` FK and `CREATE INDEX` statements, and the **four** required comments (§ Design 4).                                                                                                                                                                                                                                                                                                                                                                                             |
| `packages/db/src/writers/household-members.ts`       | NEW    | 🔴 **Missing from the first draft.** `insertHouseholdMember(db, { scope, clerkUserId, role, publicId })` — the correction **cannot** unwrap a `HouseholdScope` itself (`packages/db/src/scope.test.ts` caps the readers of `scope.householdId` at `ownership.ts`). Both the correction and `db:verify` drive this writer (§ Design 5).                                                                                                                                                                                                                                              |
| `packages/db/src/queries/household-membership.ts`    | NEW    | `membershipHousehold(db, clerkUserId)` — **its own module**, not "beside `liveHouseholdIds`" (§ Design 3.1/3.4). Lands dark in 1b so 1c's diff is the resolver body only.                                                                                                                                                                                                                                                                                                                                                                                                           |
| `packages/db/src/seed.ts`                            | EDIT   | 🔴 **A real edit, not an assertion.** (a) It writes **no membership** — and the guard for that is behavioural, in `verify.ts`, mirroring `households.synthetic`'s both-directions proof, because _a no-op edit to a file is not a test and CI cannot see it._ (b) 🔴 **The household insert becomes conditional on no live household existing**, replacing the `SEED_HOUSEHOLD_PUBLIC_ID` arbiter — which is what stops SEC-6's rotation inserting household #2 (Q4/Q5).                                                                                                            |
| `packages/db/scripts/corrections/registry.ts`        | EDIT   | The `household-claim-<date>` correction: **read-then-branch**, `requireLiveHouseholdScope`, the writer, the **full** Clerk id printed locally (§ Design 5).                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `packages/db/scripts/corrections/README.md`          | EDIT   | An **Applied** row as `pending`, carrying **neither** the household `public_id` nor the Clerk id.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `packages/db/scripts/verify.ts`                      | EDIT   | The membership matrix, the **four constraint rejections**, `assertCheckCoversConst`, the soft-deleted-household proof, the seed twin, the deletion-order proof, and the correction's three refusals — **appended AFTER the existing TEN-1 block** (§ Test plan).                                                                                                                                                                                                                                                                                                                    |
| `packages/db/scripts/mutations/NN-*.sql` + `.expect` | NEW    | 🔴 **Missing from the first draft.** Two patches, each with the `.expect` naming **the assertion that actually fails first** (§ Test plan).                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `packages/db/scripts/mutations/README.md`            | EDIT   | The new rows in its table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `docs/runbooks.md`                                   | EDIT   | 🔴 **Two sections, both missing from the first draft.** (a) `household_members` inserted into "Delete a household and everyone in it" step **4c** between `profiles` and `households`, plus the step-3/4b counts and the 4d zero-proof (§ Design 4 decision 6). (b) A new **"Before chunk 1c of AUTH-1"** section with all **three** checks `runbooks.md` already specifies for `0013` — the merge-SHA `gh run list`, `information_schema.columns`, and `pg_get_constraintdef` — because R1's one-line "confirm by hand" drops the one check that catches `migrate.yml`'s `exit 0`. |
| `docs/privacy/data-inventory.md`                     | EDIT   | 🔴 **1b edited no privacy doc in the first draft.** § 1a gains the `household_members` row and the count moves 18 → **19**; § 8 gains the soft-deleted-membership retention row (Q3).                                                                                                                                                                                                                                                                                                                                                                                               |
| `docs/features/write-path.md`                        | EDIT   | 🔴 **Owned-file, CI-enforced, and missing from the first draft.** The guide owns `packages/db/src/seed.ts` **and** (by prefix) the new `packages/db/src/writers/` + `queries/` files. `pnpm guides:check` fails without this row.                                                                                                                                                                                                                                                                                                                                                   |
| `docs/architecture.md`                               | EDIT   | § 4's data model gains `household_members`; § 2b's routing diagram is **1c's** edit, § 1's containers edge was **1a's**.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### 1c-pre — the Playwright/screenshot session story · `test/auth-1c-pre-session-login`

**New chunk, moved here from 1d by the panel** (Q6, § Design 10). **Prerequisite: 1a deployed.**
**Landed while the gate still works**, which is the only reason it is cheap. ⚠️ **This is the chunk
Open question 4 is about — it may need its own plan**, and if it does, that plan gets its own panel.

| Path                                                          | Change | What & why                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/e2e/gate-login.ts` → `session-login.ts`             | EDIT   | Mint a Clerk session alongside the gate, so the helper works in **both** worlds across the 1c boundary. The single-helper/two-consumers shape is preserved.                                                                                                                         |
| `apps/web/e2e/global.setup.ts`, `apps/web/scripts/capture.ts` | EDIT   | The two consumers. Both call `gateLogin` today and both break at 1c without this.                                                                                                                                                                                                   |
| `apps/web/scripts/screenshot-ephemeral.ts`                    | EDIT   | ⚠️ **The sharper half.** It boots a throwaway embedded Postgres with **no network and no credentials** by design. It must also **seed a membership row the seed itself is forbidden to write** — most likely via `insertHouseholdMember` from the already-allowlisted fixture path. |
| `packages/db/src/scope.test.ts`                               | EDIT   | If the fixture path grows, its `FIXTURE_DERIVES_SCOPE` allowlist is the file that must say so.                                                                                                                                                                                      |
| `docs/runbooks.md` / `docs/tech-debt.md`                      | EDIT   | Whichever of § Design 10's three options is taken, **with the three bars written down** if it is the test-only one.                                                                                                                                                                 |

### 1c — the boundary moves · `feat/auth-1c-session-is-the-boundary`

**Prerequisites: `0015` applied in production (confirmed by the three checks in the new runbook
section, not by a green `migrate.yml`) AND the claim correction run with `--apply` AND `1b-bis` and
`1c-pre` merged.** **Gate enforced by the proxy; session re-checked everywhere.** This is the chunk the
exit criteria are about, and the one-way door.

| Path                                                                                              | Change | What & why                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib/dal/session.ts`                                                                     | NEW    | 🔴 **ONE module, not two** (§ Design 2): `getCurrentUser()` (`cache()`d, fails closed, **captures on the swallowed throw**), `sessionUserOrNull()` returning the **principal**, `requireSession()`, and `householdState()`.                                                                                                                                                               |
| `apps/web/lib/dal/household.ts`                                                                   | EDIT   | `getHouseholdScope()`'s **body only** — the predicate of § Design 3.1 (**both `deleted_at` conjuncts**, `limit(2)`, no `ORDER BY`), the **five** outcome states incl. **B′**'s `42P01` catch, `ScopeMissEvent['actor']` → a `SCOPE_MISS_ACTOR` map, `noScope`'s new cause, the **≥2-live-households Sentry message** (Q5), and `liveHouseholdIds`' **corrected docblock** (§ Design 3.4). |
| `apps/web/lib/sentry-scrub.ts`                                                                    | EDIT   | 🔴 **`event.user` / `contexts.user` deletion + a unit test**, so a later `setUser` cannot reopen the owner↔requester linkage (§ Design 3.5).                                                                                                                                                                                                                                              |
| `apps/web/app/p/[profileId]/actions.ts`                                                           | EDIT   | 7 × `hasGateAccess` → `sessionUserOrNull`; `checkMutationLimit(user.userId)` after it; refusal copy unchanged.                                                                                                                                                                                                                                                                            |
| `apps/web/app/p/page.tsx`, `p/[profileId]/page.tsx`, `routine/page.tsx`, `design/tokens/page.tsx` | EDIT   | 4 × `requireGatedPage` → `requireSession`.                                                                                                                                                                                                                                                                                                                                                |
| `apps/web/app/p/[profileId]/export/route.ts`                                                      | EDIT   | `isValidGateCookie` → `sessionUserOrNull` — the one surface that checks the cookie **directly**. 🔴 **AND `export const dynamic = 'force-dynamic'` in the SAME commit**, because the swap deletes the `cookies()` call this route's dynamic-ness is pinned on (§ Design 11).                                                                                                              |
| `apps/web/app/pages-are-gated.test.ts` → `pages-need-a-session.test.ts`                           | EDIT   | 🔴 **Moved here from 1d, where the first draft filed it; 1c is red without it.** The suite requires `await requireGatedPage()` per page (4 failures) and `isValidGateCookie\|hasGateAccess` per handler (a 5th). ⚠️ **Switch the regex, never widen it to an alternation** — a guard matching either proves neither. The gate suite is deleted in 1d.                                     |
| `apps/web/app/p/page.tsx` (+ a new component)                                                     | EDIT   | The **"this account has no household"** state, branching on `householdState()` — **not** on `getCurrentUser()`, which cannot tell C from A-with-zero-profiles (§ Design 3.3). **UI → owes a full 3-lens UX panel.**                                                                                                                                                                       |
| `apps/web/app/p/[profileId]/actions.test.ts`                                                      | EDIT   | The unauth suite mocks `sessionUserOrNull`; a **no-membership** case beside the wrong-household one; the full `{no session, no membership, wrong household, unknown id}` × `MUTATING_ACTIONS` matrix.                                                                                                                                                                                     |
| `apps/web/app/pages-are-gated.test.ts` (3rd suite)                                                | EDIT   | The accepted call set switches to § Design 2's two names (the suite itself landed in `1b-bis`).                                                                                                                                                                                                                                                                                           |
| `apps/web/lib/dal/household.test.ts`                                                              | EDIT   | The five outcome states; `reportScopeMiss`'s new `actor`; the `auth_unavailable` capture.                                                                                                                                                                                                                                                                                                 |
| `apps/web/lib/rate-limit.ts`                                                                      | EDIT   | 🔴 **A second `Ratelimit` instance built from `MUTATION_RATE_LIMIT`** (or a per-policy factory) plus `checkMutationLimit(userId)` owning the prefix — **not** a const nothing reads (§ Design 8); the false-premise paragraph deleted (Q4).                                                                                                                                               |
| `apps/web/app/tenancy-is-not-cached.test.ts`                                                      | EDIT   | 🔴 **For the export handler's `force-dynamic`, not "the enumerated routes"** — that test enumerates no routes (§ Design 11).                                                                                                                                                                                                                                                              |
| `docs/features/write-path.md`                                                                     | EDIT   | **Owned-file, CI-enforced.** Invariant 1's `hasGateAccess()` sentence; invariant 2's "scoping is not authorization" caveat — which **AUTH-1 discharges** and must be rewritten, not deleted; the catalog carve-out **stays**; and the fixture bullet's `liveHouseholdIds` description (§ Design 3.4).                                                                                     |
| `docs/runbooks.md`                                                                                | EDIT   | The scope-miss section: `actor`'s new values, `no_scope`'s new cause, **promise 5's correction**, **triage step 2's rotate-the-code remedy** (gone after 1d) and **triage step 4** (state D's new condition); plus the new **≥2-live-households** alert row.                                                                                                                              |
| `docs/privacy/data-inventory.md`                                                                  | EDIT   | 🔴 **1c edited no privacy doc in the first draft**, though it trips two re-review triggers (the DAL, logging). § 7's **Upstash** row and § 8's counter row (§ Design 8); the session-cookie lifetime (Q3).                                                                                                                                                                                |
| `AGENTS.md`                                                                                       | EDIT   | 🔴 One line under Observability: this app deliberately does **not** set `userId`/`householdId` Sentry context, and why — otherwise AGENTS.md and `ScopeMissEvent`'s docblock contradict each other (§ Design 3.5).                                                                                                                                                                        |
| `docs/architecture.md`                                                                            | EDIT   | § 2b — the routing diagram gains sign-in → session → membership → scope. ADR 0006 assigned § 2b's scope edit to TEN-1 1d; this is the session edit on top.                                                                                                                                                                                                                                |
| `packages/db/scripts/verify.ts`                                                                   | EDIT   | Re-label section **(0)** so it stops claiming `liveHouseholdIds` is _"the one `getHouseholdScope()` runs"_ (§ Design 3.4).                                                                                                                                                                                                                                                                |

### 1d — retire the gate · `feat/auth-1d-retire-the-gate`

**Prerequisite: 1c in production and confirmed.** ⚠️ **Likely needs its own plan for § Design 10.**

| Path                                                                                              | Change | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/app/gate/` (`page.tsx`, `actions.ts`, `actions.test.ts`, components)                    | DELETE | The gate's UI and action.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/web/lib/dal/gate.ts`, `gate.test.ts`                                                        | DELETE | Replaced by `session.ts` in 1c.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/web/lib/access-gate.ts`                                                                     | DELETE | 🔴 **A pure delete now, because 1a did the split.** `safeInternalPath` / `internalPathname` already live in `lib/safe-redirect.ts` and `PUBLIC_PATHS` / `isPublicPath` in `lib/public-paths.ts`, so nothing has to be rescued from a module being renamed in the heaviest deletion. The first draft's `lib/public-paths.ts` name also **misnamed two of its three survivors** — SEC-4's open-redirect clamp is not a public path.                                                                                              |
| `apps/web/lib/access-gate.test.ts`                                                                | DELETE | Its gate-token and cookie-contract suites go; `safeInternalPath`'s open-redirect suite **moved intact to `safe-redirect.test.ts` in 1a** and stays, in full.                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/web/app/pages-need-a-session.test.ts`                                                       | EDIT   | The **gate** suite is deleted (1c already switched the predicates). ⚠️ **Repoint the non-vacuity probe**, which hard-codes `join(APP_DIR, 'gate', 'actions.ts')` — after this chunk that throws `ENOENT`. And **delete the allowlist entry for `app/gate/actions.ts`**, which the dead-entry assertion forces (§ Design 7).                                                                                                                                                                                                    |
| `apps/web/lib/env.ts` + **all 19 `ACCESS_GATE_PASSWORD` sites**                                   | EDIT   | 🔴 **The first draft listed five and would have failed its own acceptance criterion 5.** The set is `grep -rln ACCESS_GATE_PASSWORD apps packages .github`: `env.ts`, `.env.example`, `ci.yml`, `proxy.ts`, `proxy.test.ts`, `vitest.config.ts`, `rate-limit.ts`, `scripts/{e2e-local,screenshot-ephemeral,screenshot,dev-local,capture}.ts`, `e2e/gate-login.ts`, `lib/dal/gate*.ts`, `app/gate/actions*.ts`, `export/route.ts`, `.github/scripts/check-preview-isolation.test.sh`. **Reads before the secret** (§ Design 9). |
| `apps/web/lib/constants.ts`                                                                       | EDIT   | 🔴 Missing from the first draft: **`GATE_COPY`** and `COOKIE_MAX_AGE`'s gate half.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/web/app/page.tsx`                                                                           | EDIT   | 🔴 Missing from the first draft: the landing's gate-aware copy and link.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/web/e2e/gate-prefetch.spec.ts`, `landing.spec.ts`, `a11y.spec.ts`, `lib/rate-limit.test.ts` | EDIT   | 🔴 Missing from the first draft. **`gate-prefetch.spec.ts` is SEC-1's regression spec** — its session equivalent needs an explicit owner, or the prefetch lesson loses its only e2e.                                                                                                                                                                                                                                                                                                                                           |
| `apps/web/proxy.ts`                                                                               | EDIT   | Gate bounce → Clerk. ⚠️ **`mp_gate` deletion needs a named carrier:** the `response.cookies.delete(GATE_COOKIE_NAME)` must ride a response the proxy returns on **every** path for one release (the public landing included), because `COOKIE_MAX_AGE` is a year, so a browser that misses that one response keeps a credential-shaped value. Name the branch it lives on.                                                                                                                                                     |
| `apps/web/lib/rate-limit.ts`                                                                      | EDIT   | The gate **instance** and `GATE_RATE_LIMIT` gone — **not** the mutation instance § Design 8 built (that is what the first draft's wording would have deleted).                                                                                                                                                                                                                                                                                                                                                                 |
| `docs/runbooks.md`                                                                                | EDIT   | "Rotate a secret" loses the access-gate code; "Verifying V1-14a hardening" § 2 is rewritten for the mutation limiter; the scope-miss **triage step 2** loses its rotate-the-code remedy; and the household-deletion runbook's **step 0b and step 6 become live** — ⚠️ **but see below: they become live earlier than 1d.**                                                                                                                                                                                                     |
| `.github/SECURITY.md`                                                                             | EDIT   | The "one shared access code, no per-person revocation" row — **the row AUTH-1 exists to delete.**                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `docs/privacy/data-inventory.md` § 4 + `docs/privacy/notice.md`                                   | EDIT   | 🔴 **Two § 4 rows, not one** — the shared-access-code row **and** the export-route row, whose _"the consequence has NOT changed"_ paragraph is exactly what AUTH-1 discharges. And **`notice.md` was absent from the first draft's table entirely**: "Who can see it" limitations **1** and **3** are gate-era prose (Q3).                                                                                                                                                                                                     |
| `docs/features/write-path.md`                                                                     | EDIT   | 🔴 **Owned-file, CI-enforced, and missing from the first draft.** Deleting `apps/web/lib/dal/gate.ts` is under the guide's owned prefix, so `pnpm guides:check` fails without this row — and invariant 1's re-auth sentence plus the `lib/dal/gate.ts` Files row are edits nobody else can make.                                                                                                                                                                                                                               |

⚠️ **Two runbook steps go live EARLIER than 1d, and the first draft put both here.** By this plan's own
_"what the running system does"_ standard, a Clerk account holding a real email exists from **1a** (the
maintainer signs in between 1a and 1b), and step 0b (_record Clerk user ids from the database_) becomes
executable at **1b**, when the table exists. Leaving both at 1d means the deletion runbook reads
_"after `AUTH-1`"_ for three chunks while real Clerk accounts exist. **So: step 6 (delete the Clerk
users) goes live in 1a, step 0b in 1b.**

---

## Test plan

**`db:verify` (PGlite, no Docker) — the membership matrix.** The vehicle TEN-1 built, extended. ⚠️ **The
whole block is APPENDED AFTER the existing TEN-1 block**, and that is a constraint rather than a
preference: `db:verify` is fail-fast (`node:assert`), so inserting assertions **above** an existing
`.expect` target changes which assertion fails first for the five committed mutation patches —
`02-wrong-scope-everywhere.expect` is the exposed one if the new block rides `A_SCOPE`. ⚠️ And the
proofs assert against the existing `A_SCOPE` / `B_SCOPE`, **never a scope minted from
`membershipHousehold`'s result**: `packages/db/src/scope.test.ts` → `it('db:verify mints exactly two
named scopes')` caps `householdScopeForScript(` in `verify.ts` at **two**.

1. a member resolves to **exactly** their household (the positive), **driven through
   `insertHouseholdMember`** so the proof exercises the shipped writer, not a lookalike;
2. a user id with **no** membership resolves to **no** household — and the twin that keeps it honest:
   an _unscoped_ membership lookup finds rows, so the negative cannot pass for free (the shape TEN-1 1d
   used for the correction proof);
3. **two** members of two households each reach only their own, driven through the same scoped reads
   the two-household matrix already drives — this is the row-level proof that promise 5 actually owes
   (`cross_household` with two **live** households, which cannot exist before this PR);
4. a **soft-deleted membership** stops resolving;
5. 🔴 **a live membership pointing at a SOFT-DELETED HOUSEHOLD resolves to no household** — the proof
   the first draft had no assertion for, and the state its own promise-5 finding is about (§ Design 3.1);
6. 🔴 **two live memberships → the resolver throws** — state D, which only `limit(2)` makes detectable;
7. 🔴 **each of the four constraints `0015` creates rejects what it is for**, which the first draft had
   **zero** proofs of: `expectRejectedBy('household_members_role_check', …)`; the partial unique
   **both directions** — a live duplicate is rejected, then soft-deleting it frees the slot to
   re-insert, the named idiom `verify.ts` already uses around
   `uq_prescription_targets_prescription_profile` (_"the V1-5 soft-delete lesson"_);
   `expectRejectedBy('household_members_public_id_unique', …)`; and an FK rejection on a non-existent
   `household_id`. These land in the existing `V1-10: FK + CHECK + partial-unique (both directions)
rejections` block;
8. 🔴 **`assertCheckCoversConst('household_members_role_check', HOUSEHOLD_ROLES)`** — the repo's actual
   single-source mechanism (§ Design 4 decision 1), applied to eight constraints already;
9. 🔴 **the seed twin, in both directions**, mirroring `households.synthetic`'s proof: after the
   harness's two seed runs `count(*) from household_members` is **0**; then insert a membership,
   re-seed, and assert it **survives** — so the proof cannot pass by the table being unreachable. Plus
   **seeding a database that already holds one live household with a _different_ `public_id` creates no
   second row** (Q4/Q5);
10. 🔴 **the deletion order commits** — after the runbook's step-4c order, zero `household_members` rows
    remain for H **and the transaction does not abort** (§ Design 4 decision 6);
11. the claim correction's **own dry run** binds the household it was told to, writes nothing, and
    **refuses** on **three** cases, not two: an unknown household id; a household that already has a
    live member with a different Clerk id; and **the same Clerk id already bound to another household**
    (the realistic typo, § Design 5). ⚠️ **Mechanism:** `verify.ts` drives corrections as
    `correction.run(asCorrectionDb, false)` with no inputs, so an env-driven correction forces three
    `process.env` mutations in one process — another argument for the `--household` / `--user` flags
    (§ Open questions).

**`pnpm db:mutations`** — 🔴 **the first draft's single patch named the wrong first failure.**
`packages/db/scripts/mutations.mjs` compares the **first** assertion failure against a sibling
`.expect`, and `db:verify` is fail-fast. With the `clerk_user_id` conjunct deleted,
`membershipHousehold` returns _some_ live membership for _any_ input — so **proof 2 fails before proof
3 is reached**, and the run would fail on an `.expect` mismatch. `db:mutations` is inside `pnpm verify`,
so the implementer eats it. **So: two patches, each reddening a proof only it catches** — one dropping
the `clerk_user_id` conjunct with proof 2's message as its `.expect`, one dropping the
`households.deleted_at` conjunct with proof 5's. (A third, widening `limit(2)` to `limit(1)` against
proof 6, is worth it if it is cheap.) **And the acceptance is "all patches green, each still reddening
the assertion its `.expect` names"** — not merely "turning `db:verify` red". A boundary test that cannot
fail is worse than none (TEN-1's own words), and a membership lookup driven by a fixture is exactly
where a vacuous assertion hides.

**Vitest.** `getCurrentUser()` (no session → `null`; `auth()` throws → `null`, **not** a rethrow, **and
the `auth_unavailable` capture fires with nothing header-shaped attached**); `getHouseholdScope()`'s
**five** states incl. B′'s `42P01` catch; `reportScopeMiss`'s new `actor` and `noScope`;
`scrubSentryEvent` strips `event.user`; the mutation limiter (limited → the typed envelope, never a
throw; `limiter-error` → allowed + breadcrumb) **and that it is constructed from `MUTATION_RATE_LIMIT`,
not `GATE_RATE_LIMIT`**; `MUTATING_ACTIONS` × {no session, no membership, wrong household, unknown id}
all returning the **same const**; the enumeration guard's own non-vacuity and its pinned file set.

**Playwright.** 🔴 **The first draft said "1c keeps the existing smoke green through the gate". It does
not** — `global.setup.ts` and `capture.ts` both break the moment `requireSession()` lands (§ Design 10,
Q6). **`1c-pre` is what keeps the smoke green across 1c**, which is why it exists. `e2e` is non-blocking
until PR 28; that slack now buys `1c-pre` its verification, not 1d.

**Manual, on a preview** (⚠️ previews are behind Vercel Authentication since OPS-1, so this is the
maintainer's box): sign in with the invited Google account → land on the picker → a second,
_uninvited_ Google account cannot sign up at all → a signed-in account with no membership sees the
no-household screen → a `/p/<other household's public_id>` deep link 404s → **and the browser console
shows no CSP violation on `/sign-in`** (§ Design 6b).

---

## Risks / rollback

| Risk                                                                                                                               | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R1 · 1c deploys before `0015` is applied** → `42P01` on every route, a total outage, not a dark app.                             | The chunk split exists for this. ⚠️ **`migrate.yml` exits 0 with a warning when `DATABASE_URL_UNPOOLED` is absent** (re-verified on `main`), so a green migrate run does not prove the table exists. 🔴 **The first draft's one-line "confirm by hand" dropped the check that actually catches that**, and `runbooks.md` already specifies the right procedure for `0013`: **three** checks — (1) `gh run list --workflow migrate.yml --branch main -L 3` succeeded **on the merge SHA**, (2) `information_schema.columns`, (3) `pg_get_constraintdef`. **1b adds a named "Before chunk 1c of AUTH-1" runbook section with all three** (it must exist before 1b merges, not 1c). **And the code half: § Design 3's state B′ catches `42P01` and returns `null`**, so a schema gap is the no-household screen rather than a total outage — the same two lines § Design 1 spends to make a _matcher_ gap a refusal. |
| **R2 · the claim correction is not run** → the maintainer signs in to a no-household screen and the app is dark for its only user. | 1c's prerequisite is the correction **applied**, not merged. The **Applied** table's date is the artifact. Recovery is to run it; nothing is lost.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **R3 · `auth()` throws on a route the matcher misses** → a 500 or a refusal of a legitimate caller.                                | `getCurrentUser()` fails closed by design, and 1a removes the `/api` exclusion. ⚠️ **"No matcher-shaped gap left" was too strong** (§ Design 6.1): `_next/static/`, `_next/image` and `favicon.ico` stay excluded, and `/_next/image` is a live surface a Clerk/Google avatar would widen. **The honest claim is "no gap at any entry point that reads household data"**, held by the per-page/action/handler checks — not by the matcher, which SEC-1 says must never be the boundary.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **R4 · the enumeration test is a source-text guard** and proves presence, not ordering.                                            | Stated, not sold (§ Design 7). `ALL_ACTIONS`'s `not.toHaveBeenCalled()` assertions are the ordering half, and step 3 cross-checks that the two lists agree.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **R5 · household #2 before `TEN-2b`** → the proven cross-tenant catalog write.                                                     | 🔴 **The first draft's mitigation was incomplete: `seed.ts` + `migrate.yml` can create household #2 with no request path at all**, and 1c deletes the ≥2-household throw that currently makes it loud (Q5). Three parts now: no request path; **1b's seed existence check** with its `db:verify` proof; and **1c's ≥2-live-households Sentry message** so the state stays loud after the throw goes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **R6 · the Clerk e2e story is unsolved and `e2e` becomes required at PR 28.**                                                      | 🔴 **Restated: it is a prerequisite of 1c, not 1d's problem** — "1c keeps the smoke green through the gate" was false (§ Design 10, Q6). `1c-pre` is the chunk, landed while the gate still works. If it is not solved by then, `ci-skip-e2e` is **visible on the PR** by design — but it is a schedule debt to name, not a plan. **And `screenshot:ephemeral` breaking taxes every subsequent UI PR in the repo, not just AUTH-1's.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **R7 · the Clerk free tier's limits** (MAU, Organizations, custom domain) are a vendor fact nobody has read.                       | A runbook checklist box in 1a, read off the console. It is also an argument for Q1's recommendation: fewer vendor features, fewer vendor limits.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **R8 · `@clerk/nextjs` compatibility with Next 16.3.8.** This repo is on a very recent Next.                                       | 1a's first commit is the dependency and a `next build`. If it does not build, that is the cheapest possible failure and it happens in the smallest PR.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **R9 · the notice goes stale in the other direction** — 1a says Clerk is wired, and 1d is where it actually gates anything.        | 1a's notice edit describes what the **running system** does, which is the inventory's own standard: from 1a, Clerk receives data. The sentence is "sign-in is being rolled out", not "sign-in is how you get in".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **R10 · a reviewer reads AUTH-1 as "isolation is done".**                                                                          | It is not: the movement catalog is proved to leak and `TEN-2b` is what closes it. 1c's PR body and `write-path.md`'s invariant 2 both say so.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

**Rollback.** 1a/1b revert cleanly (both inert; the migration is additive and the correction leaves one
harmless row). 1c reverts to the gate as the sole boundary. 1d is the asymmetric one — reverting needs
`ACCESS_GATE_PASSWORD` restored to three secret stores first. No destructive migration, so no Neon
RESTORE branch is required; cut one anyway before running the claim correction with `--apply`, per
AGENTS.md, because it is the first authored write to a table that did not exist yesterday.

---

## Alternatives considered and rejected

| Alternative                                                     | Rejected because                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Clerk Organizations as the tenancy model**                    | Q1. Recommended against, **not ruled out** — the maintainer's call. The reversal is one additive migration **plus a contract migration plus three operational procedures**; Q1's pricing was corrected by the panel and the recommendation survived it.                                                                                                                                                                                     |
| **Retire the gate and land the session in one PR**              | The window where neither holds is a single deploy wide, and "either dark or open" is the failure mode. Q2's AND-composition costs one extra PR.                                                                                                                                                                                                                                                                                             |
| **Keep the gate permanently as a second factor**                | It has no per-person revocation, which is AUTH-1's whole rationale. Two credentials where one is un-revocable is not defence in depth; it is a credential nobody rotates.                                                                                                                                                                                                                                                                   |
| **An owner column on `households` instead of a table**          | Beta 1 needs a second member (a coach, a second parent) and a column cannot hold two. A one-row table now is cheaper than an expand→contract later, and `households` is the authorization root of 18 tables — the table nobody wants to migrate twice.                                                                                                                                                                                      |
| **A `users` table mirroring Clerk (email, name)**               | Data minimisation: the app would start holding adults' email addresses with no consumer. `clerk_user_id` is the only field anything needs, and `data-inventory.md` § 7 keeps Clerk as the processor that holds the rest.                                                                                                                                                                                                                    |
| **Auto-create a household on first sign-in**                    | Q5. It opens the proven catalog leak, and it is the clause `.github/SECURITY.md` and ADR 0006 both already converted into a sequencing constraint.                                                                                                                                                                                                                                                                                          |
| **A `consent_at` column on `household_members`**                | `runbooks.md` box (c) decided it: the invitation is the record for Beta 0. A new personal-data field with no reader is the wrong direction in this app.                                                                                                                                                                                                                                                                                     |
| **Extend `use-server-exports.test.ts` as `beta-1.md` § 3 says** | It is an export-**shape** guard and cannot carry an auth assertion (§ Design 7) — a finding that stands. **But the panel showed the conclusion "therefore a new file" did not follow:** `pages-are-gated.test.ts` already has every helper, and the cross-check belongs in `actions.test.ts` where the list lives. So the milestone's intent **and** its "extend the existing" wording are both honoured; only the file it named was wrong. |
| **A new guard file, `app/actions-need-a-session.test.ts`**      | 🔴 **Rejected by the panel, having been the first draft's choice.** Its load-bearing step — the `ALL_ACTIONS` cross-check — was not implementable: the array is a module-private `const` holding function references, in a file with ~20 `vi.mock` factories. Two existing files already do the job (§ Design 7).                                                                                                                           |
| **A second index on `clerk_user_id`**                           | The partial unique **is** a btree index with the same column and predicate, so it already serves the resolver (`uq_entries_client_id` has no companion). Two indexes for one access path is a write cost for nothing.                                                                                                                                                                                                                       |
| **Also adding `UNIQUE (household_id, clerk_user_id)` now**      | **Pushed back** against the architecture lens: it is unreachable until `COACH-1` exists, and `CREATE UNIQUE INDEX` is the cheapest migration this repo writes. `COACH-1` adds it in the PR that needs it.                                                                                                                                                                                                                                   |
| **`PRIV-2` as a merge prerequisite of 1a**                      | 🔴 **Relaxed by the panel** (Q3): it gates _configuring the production instance_ and the runbook's URL box, which is where `beta-1.md` already puts it. `PRIV-2` is _"not a one-file PR"_ and carries PRIV-1's four blanks, so a merge gate serialized the whole chain behind an undecided PR for a URL only the console needs. The privacy-doc edits still ride in 1a.                                                                     |
| **Cutting the mutation limiter from AUTH-1**                    | **Not rejected — escalated.** The scope lens's argument is strong (one authenticated, invited caller; no limit in dev/CI/preview by design; brute force is Clerk's). But `beta-1.md` § 3 names it as an AUTH-1 deliverable, so removing it is a milestone edit. § Open questions, **unsigned**.                                                                                                                                             |
| **Fold the `SEC-6` id rotation into the claim correction**      | Q4, and ADR 0006 decided it once already. The correction is built rotation-agnostic instead — **and 1b's seed existence check is what makes "the two rows commute" true rather than hopeful**, which the first draft asserted without it.                                                                                                                                                                                                   |
| **Thread the principal through page/action signatures**         | TEN-1 rejected the same shape for the scope, for the same reason: a threading mistake one layer up is a leak the compiler cannot see. `write-path.md` invariant 8 keeps ambient server state in `lib/dal`.                                                                                                                                                                                                                                  |

---

## Panels this plan and its chunks owe

**No UX panel is owed for this plan**, and that is deliberate rather than an omission: it adds no
screen, no copy and no interaction — it is six chunk descriptions and a set of decisions. AGENTS.md's
rule is _"scale the depth, never the existence"_, and the thing it scales is **a UI change**; there is
none here.

**The implementing PRs that do owe one** — named now so none is reached late:

| Chunk                 | UI it introduces                                                                                                         | Panel owed                                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1a**                | the **sign-in screen** (`/sign-in`), even using Clerk's prebuilt component                                               | **Full, 3 lenses.** A new screen and the app's new front door. Clerk's component is themeable, so 360px, tap targets and focus-visible are ours, not the vendor's.                                                                     |
| **1c**                | the **"this account has no household"** screen, and the refusal copy a sessionless caller sees                           | **Full, 3 lenses.** It is a dead end by design, and the trust lens is the one that matters: what does a parent do next, and does the copy ask them for anything they cannot supply?                                                    |
| **1d**                | the **removal** of the gate page; a changed first-run path                                                               | **One reviewer.** A deletion plus a redirect, with before/after screenshots at three widths.                                                                                                                                           |
| **1a**, conditionally | 🔴 **an in-app CONSENT STEP**, if runbook box (b) comes back saying Clerk's legal-consent setting does not block sign-up | **Full, 3 lenses** — it asks a parent to agree to something about their children's health data, which is the trust lens's core case. Missing from the first draft's table entirely, even though the box already names the contingency. |

⚠️ **1c's UX panel has a prerequisite the first draft did not notice.** AGENTS.md → UI PR rules
requires screenshots **captured with Playwright at three widths**, and the "this account has no
household" screen renders **only** for a session with no membership — a state `screenshot:ephemeral`
cannot reach at 1c by construction. **`1c-pre` is what makes 1c's own UI rules satisfiable** (Q6,
§ Design 10).

**Engineering panels.** This plan gets the full seven (four standing + DB-safety + security + privacy),
**which it has now had** — see the review-response log. 1b gets DB-safety again on the generated SQL.
1c gets security + correctness again on the resolver and the enumeration guard. `1c-pre`, if it needs
its own plan (Open question 4), gets that plan's own panel.

---

## Runbook — what belongs there, not in code

`beta-1.md` § 3: _"The dashboard settings live nowhere in code, so they go in a runbook checklist."_
[runbooks.md](../runbooks.md) → "AUTH-1 — the consent and dashboard checklist" already holds PRIV-1's
**privacy half** (5 boxes).

🔴 **The first draft reproduced the box TEXT here, and the scope lens was right that that is a defect.**
Plans are kept **as-merged** (`docs/plans/README.md`: _"not retro-edited to match drift"_) and **1a
writes these same boxes into `runbooks.md`** — so a second copy of an operational checklist is
guaranteed to drift from the live one, which is the duplication AGENTS.md's DRY rule exists to stop and
the one kind of prose that costs forever at ~4h/week. **So this section is now the DELTA only — box
titles, with the bodies living in `runbooks.md` where they are executed.** The live checklist is the
source of truth.

**What 1a adds to that checklist (titles; `runbooks.md` carries the bodies):**

- [ ] **Google only** — every other strategy disabled, or invitation-only has a second door.
- [ ] **Sign-up restricted to invited emails.** ⚠️ **Verify, do not assume, and record what you read:**
      whether it exists at the pinned version, what it is called, and **whether it blocks sign-up or
      only warns.** If it does not block, Q1's recommendation flips and 1a does not merge until that is
      decided. 📌 **And the panel's answer to "is a dashboard setting an acceptable control?"** — yes
      for **account creation**, and it cannot be anything else: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is
      public by design, so Clerk's Frontend API is reachable without going through this app at all and
      no code in this repo can sit in front of sign-up. **But that is not the exit criterion.** The
      criterion is _"an uninvited Google account cannot create a **household**"_, and **that is held in
      code** — by § Design 3 state C plus Q5's no-creation-path. Say which half is vendor and which is
      code. **And record the residual even if the setting works:** an unrestricted instance means
      **Clerk holds uninvited people's email addresses**, which is a `data-inventory.md` § 7 re-review
      trigger, not merely an availability concern.
- [ ] **The production instance's own Google OAuth credentials**, development instance kept separate.
- [ ] 🔴 **The exact OAuth SCOPE list, pinned to the minimum that signs a user in.** New. The word
      "scope" never appeared in the first draft in an OAuth sense, yet `data-inventory.md` § 7 pins the
      claim to _"an email address and a Google account identifier"_ — and a conventional
      `openid email profile` request also returns `name`, `given_name`, `family_name` and `picture`. If
      `profile`/`picture` is unavoidable, § 7's Clerk row **and** `notice.md`'s _"no photos"_ claim are
      edited in the same chunk, and a § Design line says **nothing may write `profiles.avatar` from
      Clerk** (§ 2 already flags that column: _"what it would then hold is a picture of a child"_).
- [ ] 🔴 **Clerk's data region**, and whether it is selectable on the tier in use. New.
- [ ] 🔴 **Clerk's retention** for user records and sign-in/session logs → a `data-inventory.md` § 8
      row. New. `beta-1.md`'s exit criterion requires the notice to ship **with no blanks**, so adding
      a fourth `⏳ not confirmed` after PRIV-2 closed three is the wrong direction — read it at 1a,
      while the console is open for the free-tier box anyway.
- [ ] 🔴 **Whether `@clerk/nextjs` at the pinned version emits TELEMETRY**, what it contains, and how
      it is disabled. New. Clerk's SDKs have historically shipped an anonymous collector enabled by
      default; **no lens could verify that at the pinned version offline and none asserted it.** If it
      exists, disable it **in code, not only by env**, and note it in § 7.
- [ ] 🔴 **`grep -rl "use server" node_modules/@clerk/nextjs/dist`** at the pinned version, with the
      result recorded in 1a's PR body. New, and the reason is specific: `/` is a public path, and
      `pages-are-gated.test.ts`'s **public-page module-graph suite** exists because such a function _"would be bundled for that page, and so invokable by an
      unauthenticated POST"_. Its stated limitation is that it **follows local imports only**. 1a puts
      `<ClerkProvider>` in the root layout, which is in **every** public page's graph — so
      `@clerk/nextjs` becomes the first third-party package there, and any `'use server'` export inside
      it an unauthenticated POST endpoint on this origin. If the set is non-empty, either extend the
      guard to follow `@clerk/*` or state which actions exist and what each requires. **Re-check on
      every `@clerk/nextjs` bump**, and give a Clerk bump the treatment `.github/SECURITY.md` already
      gives `claude-code-action`: its own PR, re-verified by hand — otherwise the next auth-path bump
      arrives as routine Dependabot noise.
- [ ] 🔴 **Clerk's CSP requirements** at the pinned version (§ Design 6b), recorded as read.
- [ ] 🔴 **The no-keys behaviour**, three cases, recorded as read (§ Design 9).
- [ ] 🔴 **Bot/abuse protection enabled**, and **the session lifetime actually configured.** New.
- [ ] 🔴 **The invitation record's spec** — where it lives, its fields, its retention (§ Design 4
      decision 5). New, and it is what makes "the invitation is the record" an actual record.
- [ ] **Free-tier limits** (R7): MAU, custom domain, Organizations.
- [ ] **The Clerk keys into Vercel** — production and preview **separately**, per OPS-1.
- [ ] **1b:** read the Clerk user id from the dashboard for the claim correction, and **clear it from
      shell history** afterwards; never paste the dry-run output into a PR (§ Design 5).
- [ ] **1b:** the pre-1c check — **all three** of `gh run list` on the merge SHA,
      `information_schema.columns` and `pg_get_constraintdef` (R1).
- [ ] **1d:** `ACCESS_GATE_PASSWORD` **removed** from Vercel (all environments), GitHub Actions and
      `.env.local` — **after** the code that reads it is gone, never before.
- [ ] **1d:** "Rotate a secret" loses the access-gate code.
- [ ] ⚠️ **Moved earlier than 1d:** the household-deletion runbook's **step 6** (delete the Clerk users)
      becomes live in **1a** and **step 0b** (record Clerk user ids) in **1b**, because that is when
      Clerk accounts and the table respectively exist.

---

## Out-of-scope / deferred

- **Facebook, email links, passwords, child accounts, kid PINs** (`pin_hash` stays reserved and unused).
- **Invitations in the app.** Beta 1. Beta 0 invites by hand, through the Clerk dashboard allowlist and
  whatever contact route `PRIV-2` publishes.
- **Household creation from a request path.** Q5 — moves to the invite row, gated on `TEN-2b`.
  ⚠️ **And so does the _sanctioned_ path for creating one at all:** after AUTH-1 the system has no
  create script, correction or action, which is how hand-written production SQL becomes the de facto
  path. **The second household arrives via a `TEN-2b`-gated correction or script**, owned by `TEN-2b`
  or the invite row — a deferral, not an omission (Q5).
- **Roles doing anything.** `role` is stored and checked by a CHECK; no code branches on it. `COACH-1`
  is the row that gives it meaning.
- **Step-up auth for bodyweight.** Beta 1 (`beta-1.md`).
- **An audit log.** A Beta 1 exit criterion; `reportScopeMiss` is the one structured event today.
- **The `SEC-6` id rotation.** Its own row (Q4).
- **`TEN-2a/b/c`.** Beside AUTH-1, not inside it; `TEN-2b` gates the invite.
- **`PRIV-3`** (the deletion script) and the `--household` runner flag it needs.
- **Multi-household membership**, organization switching, and anything the partial unique index
  forbids. ⚠️ **Named as the right path, since the first draft folded it into `COACH-1` and ADR 0006's
  own panel rejected that folding:** multi-membership is the `getHouseholdScope(profilePublicId)`
  **inversion** the ADR owns; `COACH-1` is a _grant_ that widens the seam's **return type**. Two
  different changes.
- **The MCP org-scoped Clerk API key.** v3 — and ⚠️ `.github/SECURITY.md` → Tokens/secrets specifies an
  **org-scoped** key, a sentence that is unbuildable as written if Q1's recommendation stands. **Named
  here rather than silently inherited** (Q1); no chunk in this plan amends it.
- **ADR 0006's two "Noted against AUTH-1" items**, neither picked up nor silently dropped: **naming the
  household on the picker** (in the `PICKER_COPY` function-member idiom, with `households.name` on the
  picker's read DTO and **never** on `HouseholdScope`) and the `households.name` DTO itself. Deferred,
  not forgotten.
- **The AGENTS.md correction that `pnpm audit --prod` IS a CI gate** (§ Design 6b). A one-line edit to
  the document that defines the bar; its own row, not this plan's PR.
- **Sweeping the maintainer's name out of `docs/plan.md` and `beta-1.md`.** The going-forward rule binds
  this file (§ Acceptance); retro-sweeping two signed documents is a separate, and partly
  unachievable, exercise.

---

## Open questions — the maintainer's calls

⚠️ **Every box below is UNSIGNED, and the panel was told it may argue a recommendation is wrong but may
not mark one accepted.** It did argue — Q1's pricing was corrected and question 6 is new because a lens
disagreed with the plan — and **no box was signed by any lens or by the reconciliation.** Signing is the
maintainer's, in a later commit.

1. 🔴 **Is a household a Clerk Organization?** Recommendation: **no, not in Beta 0** (Q1). ⚠️ **The
   price of being wrong was corrected by the panel and is higher than the first draft said:** one
   additive migration + one function body **+ a later contract migration + three operational procedures
   - the shared const and the proof matrix**, plus the `.github/SECURITY.md` org-scoped-key sentence on
     the declining side. **Three lenses independently called argument 2 (membership in Clerk is
     unprovable on PGlite, in the one milestone whose deliverable is provable tenancy) the strongest
     argument in the plan, and none argued the conclusion is wrong.** **Unsigned.** Conditional reversal
     unchanged: if the instance-level sign-up restriction does not block sign-up at the pinned version,
     organization invitations may be the only mechanism and this flips.
2. 🔴 **Does _"a new user gets a new, empty household"_ leave AUTH-1?** Recommendation: **yes**, onto
   the invite row, gated on `TEN-2b` (Q5). This edits a signed milestone (`beta-1.md` § 3), so it is
   not a plan decision. ⚠️ **And the panel found the clause is not the only way household #2 arrives:**
   `seed.ts` + `migrate.yml` can create one with no request path at all, which is now 1b's seed
   existence check plus 1c's ≥2-household alert. **Removing the clause is necessary but was never
   sufficient.** **Unsigned.**
3. **"Household" or "club"?** Recommendation: keep `household` (Q1b). `beta-1.md` deferred the name to
   this plan; this plan declines to spend Beta 0 on it. No lens argued otherwise. **Unsigned.**
4. **Does the Clerk/Playwright/screenshot story get its own plan?** Recommendation: **yes** (§ Design 10) — a tooling subsystem change with a third-party dependency and a test-only-bypass temptation.
   ⚠️ **Revised: the chunk is `1c-pre`, not 1d**, because 1c breaks the smoke and `screenshot:ephemeral`
   the moment `requireSession()` lands (Q6). And § Design 10 now states **the three bars** a test-only
   bypass must clear, so this is a scoping call rather than a way to defer the decision. **Unsigned.**
5. **The scope-miss event's `actor`.** Recommended **`'session' | 'auth_unavailable'`** — never the
   Clerk user id, because its own docblock forbids a requester↔owner linkage in a third-party store
   over minors' health data (§ Design 3.5). ⚠️ **Narrowed by the panel, not signed:** the privacy lens
   confirmed the event does **not** already create the linkage, so keeping the id out is sufficient for
   this event; but `'anonymous'` is a **dead member** after 1c (every caller refuses before the DAL), so
   the honest third value is § Design 1's `auth_unavailable`. **And the lens showed the rule cannot stay
   local:** AGENTS.md → Observability instructs the opposite in writing, and `scrubSentryEvent` never
   touches `event.user` — both now 1c's to close. **Unsigned.**
6. 🔴 **NEW — does the per-user mutation rate limiter stay in AUTH-1?** The scope lens argued it should
   leave for its own row beside `/api/sync`'s limiter: after 1c every caller is authenticated **and
   invited** (one person), `UPSTASH_*` is optional so there is no limit in dev/CI/preview by design, and
   brute-forcing the credential is Clerk's problem. That is ~60 lines of source plus tests out of the
   heaviest chunk for no Beta 0 risk. **Against:** `beta-1.md` § 3 names it as an AUTH-1 deliverable, so
   cutting it edits a signed milestone — which is exactly why this is a box and not a plan decision. **No
   recommendation is recorded here on purpose; both sides are in § Design 8.** **Unsigned.**
7. 🔴 **NEW — does the claim correction take its targets from `process.env`, or does `db:correct` get
   `--household` / `--user` flags?** `corrections/README.md` **rule 8** already records that a
   target-taking correction needs the flags and that it is _"a runner change, with its own plan"_.
   `process.env` routes around that in one chunk; the flags cost a runner change but **make `PRIV-3`
   cheaper** (it needs the same flag) and spare `db:verify` three `process.env` mutations in one process
   (§ Test plan proof 11). **Unsigned.**

## Review-response log (adversarial panel)

**Seven lenses, run in parallel against this plan on `docs/auth-1-clerk-plan`, with `main` at `acfe2c1`
— so TEN-1 (all four chunks) and OPS-1 were merged and every lens was told to verify against `main`,
not against a branch.** Each was pointed at the two load-bearing sections (§ What TEN-1 hands AUTH-1,
§ The six questions) and told that the six maintainer decisions may be argued but **not signed**. No
lens had to be relaunched. Round 1 produced **26 BLOCKING, 23 SHOULD** and ~40 NIT/also-found items.

**What the panel did to this plan, in one paragraph.** It did not overturn the promise-5 finding or any
of the six answers — four lenses re-verified promise 5 independently and three called Q1's argument 2
the strongest in the document. What it overturned was **mechanism**: the resolution query was missing
the conjunct TEN-1 extracted it to protect; the B/C discriminator answered a question nobody asks; the
enumeration test's load-bearing assertion was not implementable; the CHECK could not be sourced the way
the plan said; the correction's guard could not do what the next sentence claimed; the rate-limit const
could not be read by the limiter; one chunk boundary had to move; and **three chunks were red by
construction** against guards already committed in this repo. Eleven findings were pushed back on.

### Convergences — findings two or more independent lenses reached (highest confidence)

| Finding                                                                                 | Lenses                              |
| --------------------------------------------------------------------------------------- | ----------------------------------- |
| The CSP is never widened, and `beta-1.md` → Risks assigns that to this plan **by name** | security, architecture              |
| The smoke and `screenshot:ephemeral` break at **1c**, not 1d                            | scope, architecture                 |
| `membershipHousehold`'s predicate drops `households.deleted_at` / `limit(2)`            | correctness, architecture           |
| `pages-are-gated.test.ts` goes red in 1c but is filed in 1d                             | correctness, architecture, security |
| `docs/features/write-path.md` missing from 1b and 1d (CI-enforced)                      | correctness, architecture, reuse    |
| `ALL_ACTIONS` has no importable source, so § Design 7 step 3 cannot be written          | correctness, reuse, scope           |
| A CHECK cannot import a const; `profiles_kind_check` is the wrong precedent             | db-safety, reuse, correctness       |
| `MUTATION_RATE_LIMIT` cannot be read by the single module-level limiter                 | scope, reuse                        |
| The claim correction's guard contradicts its own next sentence                          | db-safety, correctness              |
| `hasSession(): boolean` is the wrong shape; one module, not two                         | reuse, architecture                 |
| `liveHouseholdIds` survives 1c, and three committed claims say it does not              | reuse, architecture                 |
| The export handler loses its `cookies()` dynamic marker                                 | correctness, security               |
| The new `db:mutations` patch names the wrong first failure                              | db-safety, correctness              |
| Q5 bullet 2 contradicts § Design 3 state D                                              | correctness, reuse                  |

### Round 1 — BLOCKING

| #      | Lens         | Critique (short)                                                                                                                                            | Verdict      | Resolution                                                                                                                                                                               |
| ------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C1** | Correctness  | State A drops `households.deleted_at`; a live membership on a soft-deleted household **resurrects** its profiles                                            | **accepted** | § Design 3.1 writes the predicate out with both conjuncts; Test plan proof 5 + a second `db:mutations` patch. **The single most important finding of the panel.**                        |
| **C2** | Correctness  | The B/C discriminator answers the wrong question — at the picker B is unreachable, so state C lands on `PICKER_EMPTY_COPY` and acceptance 6 fails by design | **accepted** | § Design 3.3: `householdState()` in the DAL. Rejected the alternative (page calls `getHouseholdScope()`) — it puts a scope in `app/`, breaking promise 2.                                |
| **C3** | Correctness  | 1c deletes the `cookies()` call that is the export handler's only dynamic marker; `tenancy-is-not-cached` goes red                                          | **accepted** | § Design 11 hazard 3 + `force-dynamic` in the same commit; the "enumerated routes" claim withdrawn (that test enumerates none).                                                          |
| **C4** | Correctness  | Three chunk tables omit files CI forces them to touch; **1a and 1c are red by construction**                                                                | **accepted** | `pages-are-gated.test.ts` → 1a and 1c; `write-path.md` → 1b and 1d; the `ENOENT` probe → 1d.                                                                                             |
| **C5** | Correctness  | The correction has no legal way to obtain `household_id` — `scope.test.ts` caps readers of `scope.householdId`                                              | **accepted** | § Design 5 + 1b: `packages/db/src/writers/household-members.ts:insertHouseholdMember`, and `db:verify` drives it too.                                                                    |
| **S1** | Scope        | The Clerk e2e story is a prerequisite of 1c, and the plan's fallback is the bypass § Design 10 rejects                                                      | **accepted** | New chunk `1c-pre`; both "1c is insulated" sentences deleted; Q6, R6 and § Panels restated.                                                                                              |
| **S2** | Scope        | § Design 7's new guard file is unnecessary **and** step 3 is not implementable                                                                              | **accepted** | No new file: presence check into `pages-are-gated.test.ts`, cross-check into `actions.test.ts`, list into `mutating-actions.ts`.                                                         |
| **S3** | Scope        | The status edits already claim a panel that has not run                                                                                                     | **rejected** | The log and the claim land in the **same squash-merged PR**, so the claim is true at merge. The first commit's own subject says "unpanelled draft". Changelog wording tightened instead. |
| **A1** | Architecture | The CSP is never widened; `beta-1.md` → Risks assigned that analysis here by name                                                                           | **accepted** | New **§ Design 6b**, seven obligations, with the proof (`theme.spec.ts`'s zero-violation assertion) and the privacy consequence in 1a.                                                   |
| **A2** | Architecture | Same as S1, reached independently from `global.setup.ts`'s call chain — plus: 1b's seed writes no membership, so even a minted session lands in state C     | **accepted** | `1c-pre`'s table says how the fixture gets its membership row.                                                                                                                           |
| **A3** | Architecture | `membershipHousehold`'s predicate unspecified in both ways that decide correctness                                                                          | **accepted** | Same as C1; also the `limit(2)` ambiguity probe and "never select `households.synthetic`".                                                                                               |
| **A4** | Architecture | `pages-are-gated.test.ts` red in 1c; and Q2's 1c row over-states what is re-checked                                                                         | **accepted** | Test moved to 1c; **Q2's table now says "proxy only" for the gate at 1c**, with `gate.ts`'s own docblock quoted as the sentence being given up.                                          |
| **A5** | Architecture | `write-path.md` edits missing from 1b and 1d (prefix-owned, CI-enforced)                                                                                    | **accepted** | Rows added to both, with what each owes.                                                                                                                                                 |
| **D1** | DB-safety    | "CHECK sourced from a `packages/shared` const" cannot be implemented, and cites the one precedent with no proof                                             | **accepted** | § Design 4 decision 1 rewritten: literals **inlined** + `assertCheckCoversConst`; precedent re-cited as `sessions_day_role_check`.                                                       |
| **D2** | DB-safety    | Four new constraints, **zero** `db:verify` proofs                                                                                                           | **accepted** | Test plan proofs 7–8, incl. the partial unique **both directions** (the V1-5 soft-delete idiom).                                                                                         |
| **D3** | DB-safety    | § Design 5's guard cannot refuse an already-claimed household, keys on the wrong column, and raises a bare `23505`                                          | **accepted** | Rewritten as a read-then-branch with three outcomes; proof 11 gains the third refusal.                                                                                                   |
| **E1** | Security     | The CSP (same as A1), reached from `next.config.ts`'s own three recorded statements of the consequence                                                      | **accepted** | § Design 6b, plus the `clerk-js`-from-CDN supply-chain note `pnpm audit` cannot see.                                                                                                     |
| **E2** | Security     | Same as C3                                                                                                                                                  | **accepted** | § Design 11.                                                                                                                                                                             |
| **E3** | Security     | 🔴 `seed.ts` + `migrate.yml` can create household #2 with **no request path**, and 1c deletes the detector that makes it loud                               | **accepted** | **The most dangerous finding of the panel.** Q5 gains two bullets; Q4's "the two rows commute" corrected; 1b's seed existence check; 1c's ≥2-household Sentry message; R5 rewritten.     |
| **E4** | Security     | "No Clerk keys ⇒ dark, not open" is asserted, and both failure modes are worse than dark                                                                    | **accepted** | § Design 9: a recorded three-case probe **and** composition only when both keys are present, so the property holds regardless of the vendor's answer.                                    |
| **P1** | Privacy      | 🔴 `household_members` makes the household-deletion transaction **abort**; it is PRIV-3's predicted "19th table"                                            | **accepted** | § Design 4 decision 6 + a `docs/runbooks.md` row in 1b (step 4c order, counts, zero-proof) + Test plan proof 10.                                                                         |
| **P2** | Privacy      | Clerk in the browser is the app's first browser→third-party egress, against an inventory claim that says there is none                                      | **accepted** | § Design 6b obligation 6; the egress paragraph and `notice.md`'s "No tracking" are **1a's** edits.                                                                                       |
| **P3** | Privacy      | The 1a privacy edit list names 3 of 10 places, and **1b and 1c edit no privacy doc at all** despite tripping re-review triggers                             | **accepted** | Q3's three-item list replaced by a 13-row table assigned per chunk; rows added to 1b, 1c and 1d; acceptance 10 broadened.                                                                |
| **P4** | Privacy      | § Design 8 silently starts sending a stable person-identifier to Upstash in a plaintext key                                                                 | **accepted** | § Design 8 decides the key shape (salted hash + TTL weighed explicitly); 1c edits § 7's Upstash row and § 8.                                                                             |
| **P5** | Privacy      | Consent has no specified record, and 1a has no budget for the in-app fallback its own runbook box requires                                                  | **accepted** | § Design 4 decision 5 specifies the invitation record like the ledger; § Panels gains the conditional consent-step panel; the runbook box is 1a's.                                       |

### Round 1 — SHOULD (and the material NITs)

| #       | Lens                      | Critique (short)                                                                                                                       | Verdict                                          | Resolution                                                                                                                                                     |
| ------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C6**  | Correctness               | The `db:mutations` patch names the wrong first failure; inserting above an `.expect` target breaks the existing five                   | **accepted**                                     | Test plan: two patches with correct `.expect`s, block **appended** after TEN-1's, acceptance restated as "each reddens the assertion its `.expect` names".     |
| **C7**  | Correctness               | § Design 7's over-match includes `action-state.ts` (`'use server'` in a docblock); the set equality must subtract the allowlist        | **accepted**                                     | Strip comments **first**; the equality subtracts the allowlist; the non-coverage cases named in the docblock.                                                  |
| **C8**  | Correctness               | Q2 attributes 1c's redirect to the proxy, which 1c never touches                                                                       | **accepted**                                     | Corrected to each page's `requireSession()`; the export handler 404s rather than redirecting.                                                                  |
| **S4**  | Scope                     | `1b-bis` is the right split with the wrong trigger; TEN-1's own P7 ran this experiment and the estimate missed by 5×                   | **accepted**                                     | Pre-split, not contingent; the `~Lines` column relabelled "order of magnitude, **not a budget**" with the TEN-1 evidence cited.                                |
| **S5**  | Scope                     | The limiter is not "small": the const cannot be read, and 1d deletes the value the survivor is built from                              | **accepted** (mechanism) / **escalated** (scope) | § Design 8 rewritten with `checkMutationLimit` + a second instance. **Cutting it entirely edits a signed milestone → Open question 6, unsigned.**              |
| **S6**  | Scope                     | Q3's PRIV-2 dependency is production-dashboard coupling, not a merge gate; PRIV-2 is itself undecided                                  | **accepted**                                     | Q3 restated in three parts; 1a's prerequisite becomes "a Clerk development instance exists"; the privacy-doc edits stay in 1a.                                 |
| **S7**  | Scope                     | § Runbook duplicates the checklist 1a will write, and leaves the in-app-consent branch unpriced                                        | **accepted**                                     | § Runbook is now **titles only**, pointing at `runbooks.md`; the consent branch is in § Panels and 1a.                                                         |
| **A6**  | Architecture              | `hasSession(): boolean` cannot supply the limiter's key; the two-module split was left undecided                                       | **accepted**                                     | § Design 2 rewritten: **one** `lib/dal/session.ts`, `sessionUserOrNull()` returns the principal.                                                               |
| **A7**  | Architecture              | Q1's reversal price omits the contract migration, the three procedures, and the org-scoped-key cost                                    | **accepted** (arithmetic only)                   | Q1's cost paragraph rewritten in five bullets. **The recommendation is unchanged and the box stays unsigned** — the lens said so too.                          |
| **A8**  | Architecture              | `liveHouseholdIds` survives 1c; its docblock, `verify.ts` § (0) and `write-path.md` all become false                                   | **accepted**                                     | § Design 3.4; 1c corrects all three. Reinforced by Q5, which now **requires** a caller for the ≥2 alert.                                                       |
| **D4**  | DB-safety                 | The migration-mechanics paragraph describes SQL drizzle does not emit; the partial unique as a table constraint is invalid SQL         | **accepted**                                     | Rewritten; the DDL block corrected; `IF NOT EXISTS` dropped with `0012`/`0013`'s reasoning; four required comments listed.                                     |
| **D5**  | DB-safety                 | The second `clerk_user_id` index is redundant with the partial unique                                                                  | **accepted**                                     | Deleted; renamed `uq_`; `uq_entries_client_id` cited.                                                                                                          |
| **D6**  | DB-safety                 | R1's mitigation is a third of the procedure the repo already wrote, and no chunk creates it                                            | **accepted**                                     | 1b adds a named runbook section with all three checks; state **B′** catches `42P01`; **R11** added for the pending-migration wedge.                            |
| **D7**  | DB-safety                 | 1b's seed note points at the wrong file; "assert it writes no membership" is not a test                                                | **accepted**                                     | The guard is behavioural in `verify.ts`, both directions, mirroring `households.synthetic`; 1b's seed edit is now the **existence check** (E3).                |
| **E5**  | Security                  | `getCurrentUser()` swallows the throw with no telemetry, so a misconfiguration looks like anonymous traffic                            | **accepted**                                     | § Design 1's third property: capture tagged `auth_unavailable`, no headers/cookie/`params`, with a test. It is also Open question 5's honest third value.      |
| **E6**  | Security                  | § Design 6 does not state composition order or the response merge, and the gate bounce destroys the query string                       | **accepted**                                     | New § Design 6.1; **the sign-in path joins `PUBLIC_PATHS` in 1a** (the parenthetical exception promoted to the default).                                       |
| **E7**  | Security                  | The enumeration guard's domain is narrower than the attack surface; the handler suite is vacuous                                       | **accepted**                                     | Walk rooted at `apps/web` with a **pinned file set**; `expect(handlers.length)` added in 1a; "switch the regex, never widen it".                               |
| **E8**  | Security                  | 1a puts the first third-party package into the ungated landing's module graph, and the guard that covers that case cannot see packages | **accepted**                                     | A runbook box: `grep -rl "use server" node_modules/@clerk/nextjs/dist` at the pinned version, recorded, re-checked on every bump.                              |
| **P6**  | Privacy                   | The `actor` fix is local; `Sentry.setUser` and AGENTS.md → Observability reopen the linkage repo-wide                                  | **accepted**                                     | § Design 3.5 states it repo-wide; 1c scrubs `event.user` and amends AGENTS.md. **Open question 5 stays unsigned.**                                             |
| **P7**  | Privacy                   | A new dependency that may phone home, with no decision recorded                                                                        | **accepted**                                     | A 1a telemetry box, with "disable in code, not only by env" and the pinned-version caveat.                                                                     |
| **P8**  | Privacy                   | The Google OAuth **scopes** are never named, so § 7's claim may already be wrong; Clerk's region/retention have no box                 | **accepted**                                     | Three new runbook boxes; the `notice.md` "no photos" and `profiles.avatar` consequences named in Q3's table.                                                   |
| **P9**  | Privacy                   | The plan carries a personal first name twice                                                                                           | **accepted**                                     | Substituted to `[the maintainer]` with the quote marked as substituted — **and the limit stated** (`git log -S`, the commit author) rather than read as a fix. |
| **R1**  | Reuse                     | `HOUSEHOLD_ROLES` belongs in `enums.ts` with `keyBySelf`, four symbols, and the plan disagreed with itself                             | **accepted**                                     | § Design 4 decision 7; 1b's row is `packages/shared/src/enums.ts` + the `index.ts` re-export.                                                                  |
| **R2**  | Reuse                     | 1c adds the **sixth** copy of `code()`, and `walk` is the wrong helper to promote                                                      | **accepted**                                     | `apps/web/test/source-scan.ts` in `1b-bis`, glob-based, converting the two copies it touches and **narrowing the tech-debt entry** in the same PR.             |
| **R3**  | Reuse                     | § Design 5 re-writes the refusal `requireLiveHouseholdScope` already single-sources                                                    | **accepted**                                     | Cited by name, with its message.                                                                                                                               |
| **R4**  | Reuse                     | 1d's table omits five live `ACCESS_GATE_PASSWORD` sites its **own** acceptance grep would fail on                                      | **accepted**                                     | § Design 9 and 1d now say **19 sites**, enumerated.                                                                                                            |
| **R5**  | Reuse                     | `SIGN_IN_PATH` placed in the module 1d half-deletes                                                                                    | **accepted**                                     | Moved to `apps/web/lib/constants.ts`, beside `APP_HOME_PATH`; with the `<ClerkProvider>`-props note so there is no env-var copy.                               |
| **A9**  | Architecture              | The `access-gate.ts` split belongs in 1a, and `lib/public-paths.ts` misnames two of three survivors                                    | **accepted**                                     | Split into `lib/safe-redirect.ts` + `lib/public-paths.ts` in **1a**; **1d becomes a pure delete**.                                                             |
| **A10** | Architecture              | `docs/architecture.md` § 1 is unassigned, and 1a adds a browser→Clerk edge                                                             | **accepted**                                     | A § 1 row in 1a; § 4 stays 1b's, § 2b stays 1c's.                                                                                                              |
| **A11** | Architecture              | Q5 names no artifact for "an operator action", so the system has no sanctioned second tenant                                           | **accepted**                                     | Q5's closing paragraph and § Out-of-scope: a `TEN-2b`-gated correction or script, owned there.                                                                 |
| **A12** | Architecture              | State D attributes multi-household to `COACH-1`, a folding ADR 0006's own panel rejected                                               | **accepted**                                     | § Design 3.2's note and § Out-of-scope now name the **inversion** path.                                                                                        |
| **E9**  | Security                  | `actor: 'anonymous'` is unreachable after 1c                                                                                           | **accepted**                                     | Open question 5's recommendation narrowed to `'session' \| 'auth_unavailable'`.                                                                                |
| **E10** | Security                  | State C is an unlimited authenticated amplification path (an unscoped probe + a Sentry message per read)                               | **accepted**                                     | § Design 8's closing note: 1c short-circuits or samples `no_scope` when the principal has no membership.                                                       |
| **E11** | Security                  | R3's "no matcher-shaped gap left" is false; and tech-debt's `/api` prescription is "do both"                                           | **accepted**                                     | R3 and § Design 6.1 corrected; the strike lands in **1a**, on the matcher edit **plus** the handler suite.                                                     |
| **E12** | Security                  | § Design 10's rejection of a test-only bypass is a preference, not a bar                                                               | **accepted**                                     | The **three bars** written out, each with its in-repo precedent.                                                                                               |
| **E13** | Security                  | 1d's `mp_gate` deletion has no carrier                                                                                                 | **accepted**                                     | 1d's row names the branch it must ride, and why `COOKIE_MAX_AGE` makes it matter.                                                                              |
| **D8**  | DB-safety                 | § Design 5 contradicts `corrections/README.md` rule 8 without acknowledging it                                                         | **accepted**                                     | Acknowledged in § Design 5 **and escalated** to Open question 7 (env vs `--household`/`--user` flags), because the flags make `PRIV-3` cheaper.                |
| **D9**  | DB-safety                 | Truncating the Clerk id defeats the property Q4 rests on                                                                               | **accepted**                                     | Printed **in full** locally; rule 9 restated as the paste-time instruction; a runbook line covers shell history.                                               |
| **D10** | DB-safety                 | Proof 5 has no stated mechanism for an env-driven correction                                                                           | **accepted**                                     | Stated in Test plan proof 11, as a third argument for the flags.                                                                                               |
| **N1**  | Scope                     | Q6's "deployed or run" boundary rule is false for 1a→1b                                                                                | **accepted**                                     | Q6 says so and gives 1a→1b's real reasons, so the others are not read as soft.                                                                                 |
| **N2**  | several                   | `public_id`'s "the Keys rule is unconditional" is a misreading (`entrySetQuantities` is the counter-example)                           | **accepted**                                     | Decision 4 re-argued on **precedent plus cheapness**; the `client_id` omission also given its reason.                                                          |
| **N3**  | correctness, architecture | Three counts disagree: 13 vs 14 callers, 11 vs 12 entry points                                                                         | **accepted**                                     | Both corrected and **what they count is stated**; the enumeration floor derives from `MUTATING_ACTIONS`, never a re-typed number.                              |
| **N4**  | correctness               | The picker's empty-state copy is quoted from before `ONB-0`                                                                            | **accepted**                                     | Replaced with `PICKER_EMPTY_COPY`; the trap argument is **stronger** with the real copy.                                                                       |
| **N5**  | correctness               | § Design 5's "rule 3" quote is from `registry.ts`'s docblock, not rule 3                                                               | **accepted**                                     | Cited correctly.                                                                                                                                               |
| **N6**  | security                  | `pnpm audit --prod` **is** a CI gate now; AGENTS.md is the stale document                                                              | **accepted** (noted)                             | § Design 6b records it; the AGENTS.md fix is **its own row**, not this plan's PR (§ Out-of-scope).                                                             |
| **N7**  | privacy                   | `beta-1.md` § 3 says "(PRIV-1 first)" where `PRIV-2` ships `/privacy`                                                                  | **accepted**                                     | A one-word fix, landed in this PR since it is the sentence Q3 is about.                                                                                        |
| **N8**  | reuse                     | § Design 9's `NEXT_PUBLIC_` declaration buys validation only (`env.ts` is `server-only`, `client: {}`)                                 | **accepted**                                     | § Design 9's mechanical note, including what "optional" means for CI's `next build`.                                                                           |

### Pushbacks — recorded, as the point of the log

| #        | Lens         | Critique                                                                                                                                                                      | Why rejected / limited                                                                                                                                                                                                                                   |
| -------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S3**   | Scope        | The status edits claim a panel that has not run                                                                                                                               | **Rejected.** The log and the claim are in the **same squash-merged PR**, so the claim is true the moment it is on `main`; the pre-panel commit's own subject is "unpanelled draft". Only the changelog's "written and panelled" phrasing was tightened. |
| **A13**  | Architecture | Also add the permanent `UNIQUE (household_id, clerk_user_id)` index now                                                                                                       | **Rejected as YAGNI.** Unreachable until `COACH-1` exists, and `CREATE UNIQUE INDEX` is the cheapest migration this repo writes. Recorded in § Alternatives so `COACH-1` finds the reasoning.                                                            |
| **S5b**  | Scope        | Cut the mutation limiter from AUTH-1 entirely                                                                                                                                 | **Not rejected — escalated.** The argument is good, but `beta-1.md` § 3 names the limiter as an AUTH-1 deliverable, so cutting it is a **milestone edit, not a plan decision**. Open question 6, unsigned, with both sides stated.                       |
| **A7b**  | Architecture | (implicitly) Q1's conclusion should be revisited given the higher price                                                                                                       | **Limited to the arithmetic.** The lens itself said the recommendation still reads as the stronger side. The price was corrected; the conclusion was not changed; **the box stays unsigned.**                                                            |
| **S6b**  | Scope        | Drop the privacy-doc edits from 1a along with the PRIV-2 merge gate                                                                                                           | **Rejected.** 1a ships `@clerk/nextjs` to production, so Clerk is a processor from 1a and the inventory's standard is "what the running system does". Only the `/privacy` **URL** dependency moved; the notice edits did not.                            |
| **E12b** | Security     | Prefer the Clerk Playwright helpers over a test-only path                                                                                                                     | **Accepted as a preference, not a decision.** Both remain in § Design 10's table; `1c-pre` chooses, and the three bars now constrain the choice if it is the bypass.                                                                                     |
| **D5b**  | DB-safety    | (Implied) drop `public_id` since it has no consumer                                                                                                                           | **Not adopted.** The lens's point about the _justification_ was accepted (N2); the column stays on precedent plus cheapness, and `PRIV-3` is a named future consumer.                                                                                    |
| **R2b**  | Reuse        | Convert all five `code()` copies                                                                                                                                              | **Limited to the two 1c/1b-bis already touches.** Converting the other three is a separate refactor; the tech-debt entry is **narrowed**, not closed, which is the honest state.                                                                         |
| **P9b**  | Privacy      | Sweep the maintainer's name from `plan.md` and `beta-1.md`                                                                                                                    | **Rejected for this PR.** The rule is going-forward and binds this new file; sweeping two signed documents is its own change, and `git log -S` plus the commit author make it partly unachievable anyway — which § Acceptance now says out loud.         |
| **A14**  | Architecture | The plan is 103KB and quotes signed documents verbatim, risking drift                                                                                                         | **Partly accepted.** § Runbook's duplication was removed (S7) and Q3's quote trimmed. The remaining quotes are load-bearing (they are the thing being contradicted), and promise 5 is the demonstration — so they are kept **with their source named**.  |
| **—**    | several      | Various "also found" items outside this plan's scope (`SECURITY.md`'s stale OSS-1 line, the handler suite's pre-existing vacuity, `'Not found'` re-typed in the export route) | **Recorded, not charged here.** The handler-suite floor is adopted by 1a because 1a leans on that suite; the rest are their own rows.                                                                                                                    |

### What the panel did NOT overturn

- **The promise-5 finding stands**, re-verified independently by four lenses: `reportScopeMiss`'s probe
  is `publicId = ? AND deleted_at IS NULL` with **no household conjunct**, and `liveHouseholdIds`
  filters `households.deleted_at IS NULL` — so `cross_household` is reachable **today** via a live
  profile pointing at a soft-deleted household. What AUTH-1 owes is the row-level `db:verify` proof, not
  a first firing. Promises 1–4 also re-verified against `main`.
- **None of the six maintainer answers was overturned, and none was signed.** Q1's recommendation
  survived a corrected price; Q1b drew no objection; Q2's AND-composition survived with its 1c row
  corrected; Q3's dependency was _relocated_, not removed; Q4 survived with the seed gap closed; Q5
  survived and got stronger. **Two new boxes were added because lenses disagreed with the plan** (the
  limiter's scope; env vs runner flags) — both unsigned.
- **The chunking survived in shape but not in count:** the ordering logic is intact and every original
  boundary still holds, but **six chunks, not four** — `1b-bis` pre-split and `1c-pre` moved forward
  out of 1d.

### Gates at the time of this log

`pnpm verify` ✅ · `pnpm guides:check` ✅ · `pnpm status:check` ✅. **This remains a plan-only PR:** no
implementation code, no migration file, no Clerk dependency. Every finding above that says code must
change is recorded as an obligation on the chunk that owns it.
